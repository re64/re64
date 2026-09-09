# The re64 document model, as it stands

What the model *is*, with no account of how it got here. `docs/decisions/` carries the
reasoning and the history; this carries the shape. Where the two disagree, read
the code — but this file is meant to be checked against it and kept true.

Written to be read cold, in about ten minutes, by somebody deciding what to
change. `docs/api.md` is how you reach it, and `docs/experiments.md` is where most of
this came from.

---

## 1. The document

A project is a Yjs document with nine roots. It is the truth; a `.re64` file is
an import source or an export target and is never synced to.

| root | holds | shape |
|---|---|---|
| `layers` | byte resources | array, order is declaration order |
| `claims` | everything anybody says about an address | map by id, flat |
| `targets` | named arrangements of layers | map by id |
| `constants` | `{id, name, value}` | map by id |
| `decoders` | `{id, name, source}` | map by id |
| `types` | `{id, name, size, fields}` | map by id, fields nested by offset |
| `files` | the binaries, content-addressed | map by name |
| `primaryLabels` | address → claim id | map |
| `meta` | `name`, `description`, `defaultTarget` | map |

Two further roots live in their own modules — `crdt/chat.ts` and
`crdt/participants.ts` — and are deliberately outside `projectFromDoc`'s
whitelist, so a message or an arrival never reaches a `Project`, never reaches
an export, and never moves the version.

---

## 2. Layers — byte resources

A layer holds bytes and knows nothing about where it sits.

```ts
type: "prg" | "raw" | "bytes" | "symbols" | "rom"
```

- **`prg`** — a file whose first two bytes are its load address
- **`raw`** — a file placed at an address the project gives
- **`bytes`** — inline hex, optionally repeated to a length
- **`symbols`** — names only, supplies no bytes, occupies no range
- **`rom`** — a machine ROM (`basic`, `kernal`, `characters`), resolved from the
  host, landing where the hardware decodes it

A layer may carry `reference: true` — bytes to resolve *through* rather than to
read. Default for `rom`. Reference layers answer every question and are left out
of the rendered listing.

A layer still owns its **comments**. It also still declares `labels` and
`regions` in the schema; those are read when migrating an older file and are
never written.

---

## 3. Targets — arrangements

A target is a memory map: which layers, in what order, at what address.

```json
{ "name": "runtime",
  "layers": ["lay_symbols", { "layer": "lay_runtime", "at": "$0100" }],
  "entryPoints": ["$C065"],
  "order": 2,
  "description": "the image the loader expands into" }
```

- **Order is z-order**, bottom-up: the last entry shadows the ones before it.
- A bare id links a layer at its own address; the object form moves it.
- A symbols layer is never linked and never filtered.
- A link naming a layer that has gone is skipped, not refused.

**There is no current target on the server.** A view is a parameter of the
request: every tool takes `target`, every answer reports the one it used, and a
project may declare `defaultTarget` for callers that name none. A project
without targets gets one derived from its layers in declaration order.

---

## 4. Claims — statements about addresses

One noun. Formerly two: a "label" is a claim with a `name`, a "region" is a
claim with an `extent` and an interpretation.

### In the model

```ts
interface Claim {
  id: string            // the only identity
  at: number            // absolute, always, in the domain
  origin: ClaimOrigin   // machinery or judgement
  frame?: Frame         // what it belongs to
  extent?: number       // how far it reaches; absent means a point
  name?: string
  says?: Interpretation // what the bytes are
  root?: RootKind       // decode from here
  description?: string  // what a name means on this machine
}
```

**`id`, `at` and `origin` are always present. Everything else is optional**, and
a write refuses a claim with none of `name`, `is` or `root` — a claim saying
nothing about an address is not a claim.

Who made it and how they know are **not here**: they belong to an act of
vouching, so they live on the evidence that names this claim. See §5.

### The four value types

```ts
Frame = { space: "address" }                        // the machine
      | { space: "layer";  layer: string }          // stored as an offset
      | { space: "target"; target: string }         // absolute in that target

Interpretation = { is: "data" }
               | { is: "text";   encoding?: TextEncoding; view?: string }
               | { is: "bitmap"; view?: string }
               | { is: "jumptable" }
               | { is: "record"; typeId: string }

RootKind    = "entry" | "routine" | "location" | "data"
ClaimOrigin = "user" | "layer" | "platform" | "auto" | "analysis"
```

### In the file and the API

`says` is flattened, so what a reader meets is thirteen flat keys:

```
id  at  extent  layer  target  name  is  encoding  view  typeId  root
description  origin
```

**Five are conditional on another field's value:**

| field | meaningful only when |
|---|---|
| `encoding` | `is: "text"` |
| `view` | `is: "text"` or `is: "bitmap"` |
| `typeId` | `is: "record"` — and required there |
| `layer` | layer-framed |
| `target` | target-framed |

`extent` is not conditional but means three different things: a span with `is`,
an array's reach with `name`, and a record count with `is: "record"`.

### What actually does something

Worth stating, because the answer is not obvious from the shape and because a
field nothing reads is this project's most repeated defect:

| field | effect |
|---|---|
| `says.is` | picks the row strategy, and drives the `interpretation` disagreement |
| `says.encoding` / `.view` / `.typeId` | how the bytes render |
| `extent` + `says` | whether operands render as an offset into it |
| `root` | seeds the decode; drives the `rootInData` disagreement |
| `frame` | whether the claim moves when a layer is relinked |
| `name` | renders; drives the `nameShared` disagreement |
| `origin` | **name ranking, platform-name hiding, and the hygiene gate** |
| `description` | informational |

`origin` is the load-bearing one and the reason it stayed on the claim when the
rest of provenance left: `CLAIM_RANK` in `claims/names.ts` orders names by it,
`view/rows.ts` hides platform names with it, and hygiene skips generated names
with it. A seeded Camels project has 383 `platform` names and 472 `auto` ones
against none by hand, which is the scale that makes the gate matter.

### Scope

Derived from the address, never chosen: the topmost layer supplying the byte,
else the target. A layer-framed claim stores an **offset** into that layer's
bytes; the loader adds the layer's start back. Offsets never appear in any tool
argument or answer. Every write reports the scope it derived.

`view` values: `char:N`, `bits:N`, `sprite`, `sprite-multi`, `snippet:<id>`.

---

## 5. The three declaration tables

Each splits a declaration from its uses, for the same reason: a declaration
describes no bytes, so there is no layer for it to travel with.

| | declaration (project) | use |
|---|---|---|
| constant | `{id, name, value}` | `{id, address, constant}` in the owning layer |
| decoder | `{id, name, source}` | `view: "snippet:<id>"` on a claim |
| type | `{id, name, size, fields}` | `says: {is: "record", typeId}` on a claim |

**Types.** `size` is bytes per record, declared rather than summed, so holes are
legal. `fields` is keyed by offset and each carries an **id**: two fields cannot
share an offset, so the key is enough for *storage*, but an offset is a property
of a field and moving one would otherwise be a delete plus a create, losing its
description. Fields merge by offset, so two readers adding different fields to
one record both survive. Field types: `u8`, `i8`, `u16`, `u16be`,
`ptr`, `ptrbe`, `char(n)`, `char(n,encoding)`, `bytes(n)`, or another type's
name. How many records a claim holds is `extent / size`, derived.

Any of them takes `[n]` for an array — `u8[8]`, `Creature[42]`, `char(40)[3]` —
or `[first..last]` where the first index is not zero, which some tables are.
`u8[4][8]` nests the way C reads it, outer dimension first. An array is a
modifier on a field type rather than a kind of its own, so it needed no change
to the schema, the CRDT, the operations or the file format: a field type is one
string.

**A count may name a constant** — `u8[CreatureCount]`, `u8[1..LevelCount]` —
which is the equate an assembler source would write. It earns its keep when the
same number appears more than once: two arrays written `[CreatureCount]` say
their counts are the *same* count, which is the whole content of a shared index
without a new noun, and binding that constant to the immediate the code compares
against ties the layout to the program. Resolved on load and never stored: the
document holds the text, so changing the constant changes the layout that named
it, and a constant that has gone falls back to the number it had.

**A bitmask is a record at bit granularity.** `unit: "bits"` makes a type's
field offsets count bits instead of bytes, and fields in one take `bits(n)`.
`$D011` is seven fields in one byte — three bits of scroll, a row select, a
blank, a bitmap flag and the ninth raster bit — which is structurally a record:
named things at offsets, holes legal, two people editing different offsets. Bit
*n* is the one worth 2^*n*, as every datasheet numbers them; the listing prints
them high to low, because that is how a byte is written and it is a display
choice rather than what an offset means.

**`size` stays in bytes either way, and so does `fieldSize`.** A unit that
silently changed what an existing number meant is the defect shape this project
keeps catching, so a bit record of `size: 1` occupies one byte and nothing that
already reads a size has to learn anything. Only code walking *inside* one asks
`fieldBits`. A bit record nests inside a byte record like any other type, which
is what gives `zones[2].flags.doubleWidth` with no new path machinery.

**A path is derived from a type, never stored.** Given a record claim and an
address inside it, `zones[2].name` — or `zones[0].slots[3]`, or
`waves[1].name + 2` where the address is inside a fixed string rather than at
its start. Silent in a hole, because a hole is a real gap in interpretation.
`where` answers with it. The same brackets index the machine's arrays:
`screen[10,2]`, `sprite[13]`.

A reference to a declaration that has gone renders the bytes, the literal, or
the plain value. Nothing sweeps.

### Provenance lives on the evidence, not on the claim

A claim carries **`origin`** — `user | layer | platform | auto | analysis` — and
nothing else about who. That is intrinsic: it says whether this is somebody's
judgement or machinery, and hygiene gates on it because 855 of a seeded Camels
project's names are `platform` or `auto`.

**Who vouched and how they know are properties of an act of vouching**, so they
sit on an evidence record: `{author, method?, when?}` beside `kind`. `add_claim`
mints one — a `supports` — alongside the claim, which is two operations under
one changeset.

The reason is merging. A claim carrying its own author cannot be shared: two
readers reaching the same finding produce two claims, and merging them would
erase one. Four runs on Camels independently re-derived the zone table, the
cheat, the IRQ handler and the high-score file — one finding with four accounts,
which the old shape could only say as four findings. Now it is **one claim with
four supporting records**, each keeping its author and method, and "do these
accounts differ" is finally computable rather than a thing `method` could only
hint at.

**Two verbs, and two more were rejected.** An `asserts` kind for "created it"
would distinguish only *arrival order*, which the log already records, and it
breaks under parallel collaboration — two agents independently creating one
claim both assert it, and merging would mean rewriting one into a support to
preserve a fact that carries no information.

`supersedes` existed and was removed. It said "an earlier reading, replaced" —
neither support nor refutation — and it stored an **ordering**, which is the one
thing a conflict-free merge cannot supply: two peers offline can each supersede
the same claim with a different replacement, and the document converges on two
parallel supersessions with nothing to break the tie. Chains compound it. Every
other ordering question here is answered by a single-valued key, and the key for
this one already existed: **`primaryLabels` is "which reading is current"**, one
entry per address, last writer wins, and read by the renderer — which
`supersedes` never was. A second mechanism for one question is how the two drift
apart.

Nobody wanted it, either. Of every `add_evidence` call the runs have made, all
are `supports` or `refutes`, and the one facing exactly the case `supersedes`
was designed for — an earlier framing of some bytes as cut music, replaced —
wrote *"Refutes the earlier framing of this as new/cut music."*

**Both remaining kinds are read.** `refutes` reports a declared disagreement;
`supports` backs a claim, and two of them by different authors with different
methods is an independent confirmation. The switch is exhaustive with a `never`
default, because for a long time only `refutes` was read at all.

Strength lives in `method` and in whether a scenario is attached, never in the
verb.

### Evidence, field by field

```
id  claim  kind  author  method  when  scenario  capture  other  note
```

| field | present | effect |
|---|---|---|
| `claim` | **always** | what it is about — a *claim*, never an address |
| `kind` | **always** | `supports` \| `refutes` |
| `author` | on anything a person or agent wrote | reported by `claims_at`; **the corroboration reading** |
| `method` | optional | `guessed \| transcribed \| read \| derived \| ran` |
| `when` | optional | informational |
| `scenario` | optional | **the strongest form**: it re-runs |
| `capture` | optional | so the check can be read without re-running |
| `other` | optional | another claim, for a refutation that names one |
| `note` | optional | prose |

**One rule is enforced at the write**, and it is the only one: a `refutes` with
neither `other` nor `note` is refused — an opinion with no handle on it.

**Strongest to weakest**, which is worth stating because the model does not rank
them and a reader has to:

1. A claim with a `supports` naming a **scenario** — it re-runs, and trusts nobody
2. Two of those, by different authors, exercising different paths — *not
   currently expressible; there is nothing that says two checks are independent*
3. Two accounts agreeing with **different** methods — an agreement you have
   reason to believe is not correlated
4. Two agreeing with the **same** method — one account, not two
5. `method` alone

`method` is a *negative* discriminator and not a strength: its job, from
experiment 0, is to catch an agreement that is really one account arriving
twice. Both agents there concluded glyphs `$03`/`$04` were never drawn, both
were wrong, and they agreed because they shared a blind spot. A confidence
number cannot see that; a method can.

### What reads a disagreement, and what reads hygiene

Two different questions, and they are answered by different code with different
rules — which matters, because they overlap on one case and disagree about it.

**`disagreements()`** — `core/claims/set.ts`, knows nothing about any analysis.
Reported per *overlap*, never per byte: a first version turned one disputed span
in experiment 7 into 1,832 findings.

| kind | when |
|---|---|
| `declared` | somebody wrote a `refutes`. **Need not overlap** — `$8DF9` holding `$3B` refutes a claim about the glyph `$3B`, at a different address entirely |
| `nameShared` | one name reaching two addresses |
| `interpretation` | two claims overlap, `says.is` differs, **and neither contains the other** |
| `rootInData` | a decode root inside somebody's "these are not instructions" |

**`checkHygiene()`** — `core/analysis/hygiene.ts`. About *your annotations*, and
zero is the resting state. It reads evidence in exactly one place: the
`label.duplicated` message gathers the **methods across everyone who vouched**
for each twin, so it can say whether two labels with one name corroborate each
other or are one account written down twice.

`label.duplicated` · `label.nameShared` · `constant.nameShared` ·
`annotation.insideInstruction` · `claim.noBytes` · `claim.missingDecoder` ·
`type.missing` · `type.extentMismatch` · `type.redundantClaim` ·
`comment.inlineDuplicated` · `claim.interpretationsDiffer`

**`findings()`** — `core/claims/review.ts`, where the claims and the decode graph
disagree: `codeInClaim`, `unreached`, `unexplained`. Needs both halves, so it is
kept apart from both of the above.

### The one rule that is stated twice, in opposite senses

`disagreements()` suppresses an `interpretation` finding when one claim contains
the other — *containment is refinement*. `checkHygiene()` fires
`claim.interpretationsDiffer` on exactly that case.

Both are defensible and they were written for different questions. Hygiene draws
the line in its own comment: **an inner claim saying nothing is naming a place
inside a structure; an inner claim saying something *else* is a disagreement.**
The forty-two zone names claimed as `text` inside the zone table's `data` span
are the case it was written for, and the silver image still has them.

It is recorded here rather than resolved, because a curated project will meet
the seam and should meet it knowing.

---

## 6. Comments

Their own objects: `{id, address, placement, text, order?}` with placement
`before | inline | after`. Owned by a **layer**, unlike claims. Every comment at
an address renders; there is no index choosing one.

---

## 7. What is derived and never stored

- which name an operand shows (all claims at the address, plus `primaryLabels`)
- whether a byte is code (a walk from the roots)
- the region tree, the equate block, the TYPE block
- how many records an array holds
- basic blocks, the call graph, routine extents, effects
- disagreements and hygiene findings
- the listing itself

---

## 8. Known tensions

Stated without recommendations.

**The claim object does six jobs.** Identity, position, naming, interpretation,
decoding, provenance — sixteen flat keys in the file, six of them conditional on
a neighbour's value. That is a discriminated union flattened into a record. The
flattening buys one-line diffs and costs comprehensibility.

**One concept, two spellings.** The model says `claim.says.is`; the file and API
say `is`. `primaryLabels` is named for an object that no longer exists — it is
indexed by claim id, and the tools are `bind_primary_name` / `unbind_primary_name`.

**"View" means two things.** `view` on a claim is a rendering format
(`char:8`). A *target* is also routinely called a view, including in tool
descriptions. Both can appear in one call.

**`record` is unlike its siblings.** `data`, `text`, `bitmap` and `jumptable`
are byte-local. `record` points at a project-level declaration and changes what
`extent` means. Nothing in the name says an array.

**`root` and `says` are not orthogonal in practice.** Every interpretation is
given `root: "data"` so it renders, so a field that reads as a separate concern
is usually a consequence of another.

**The reference project is still in the legacy shape.** `gridrunner.re64` holds
layer `labels` and `regions` and no `claims` key; it is migrated in memory on
every load. The golden test pins the legacy file. Anybody opening the repo's
canonical example to learn the format sees the model that was replaced.

**Surfaces are lopsided.** MCP reaches 72 tools. The CLI reaches labels,
regions, undo/redo, import/export. The browser's whole write surface is
`addLabel`, `removeLabel`, `setRegion`, `removeRegion`, `undo`, `redo` — no
comments, constants, decoders, types, targets, roots, or anything claims-native,
though all of them are modelled and reachable by an agent.

**`layer.set` does not exist.** A layer cannot be renamed. Reordering is now a
target edit, so the gap is narrower than it was, but a layer's own fields are
still immutable after creation.
