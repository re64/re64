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
| `meta` | `name`, `description` | map |

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

**There is no current target, and no default one either.** A view is a parameter
of the request: every tool takes `target` and every answer reports the one it
used. A project declaring more than one **refuses** a call that names none and
lists them, because the bytes at an address differ between views and there is no
answer right for all of them. Where there is no choice — one target, or none,
which implies a single view over the whole stack — naming it is not required.

The document used to carry `defaultTarget`, and it is gone. It read as "what
this project is *for*", which is a reasonable thing for a file to say, but every
call that named no view was answered through it — so a document field was
answering a question about the reader. On the Camels silver image, which
declares five targets and no default, the invented answer was `loader`: one
layer, in which every claim framed on the runtime layer does not exist. Which
view somebody is reading is a property of the looker, and lives in their
session.

**So a write that touches no address needs no view.** A type, a field, a
constant, a decoder, a piece of evidence, a layer, a target: those are edits to
the *document*, and they go through a path that never builds a memory map.
`list_targets` is the case that settles it — asking which views exist cannot
itself require choosing one. Such an edit reports no instruction delta, because
there is no view for the count to be about and a zero would be a measurement
nobody took.

**A reference in the document is an id.** Not a name, not an address, not a
slot. This was stated as a rule about *write keying* — "adding always adds;
correcting is by id" — and read that way it looks satisfied. Read as a rule about
**references** it was not: a target frame stored the target's name, so renaming a
target orphaned every claim framed on it and two targets could share a name with
nothing able to tell them apart. Names stay usable at the API, where a person
types them, and are resolved at the boundary; what reaches the document is an id.

The same rule now holds inside a **field type**, which is where it was hardest.
A field type is one string and the references in it — another type, a constant
naming a count — were names. `u8[CreatureCount]` goes in; `u8[cst_kj39fa]` is
stored.

**Names survive as an alias layer, because the suggestion is worth having.**
`Creature[creatureIndex]` is something a reader can be wrong about out loud;
`typ_kj39fa[cst_x0plq2]` is something nobody can be wrong about because nobody
can read it. That bias is useful — it is how a mis-typed table gets noticed — so
it is kept where it belongs, in what a person writes and what a surface renders,
and never in what the document holds. Three spellings are accepted:

| | |
|---|---|
| `typ_kj39fa` | an id, always, never ambiguous |
| `Creature` | a name, when exactly one thing answers to it |
| `Creature@typ_kj39fa` | when more than one does |

A bare name two things answer to is **refused**, with both `@id` forms in the
message, and the same form is accepted straight back. The refusal is the point:
a reader who meets it learns the document has grown a second `Creature`, which
is a thing they wanted to know. `list_types` renders the suffix for the same
reason — it is the notice that the plain name is no longer resolvable.

**Resolution asks what *this session* knows** — and the opposite was tried first,
which is worth recording because it looked like the careful answer. Resolving
against the server's current document was defended by citing the offline rule,
and it *is* the failure the rule names: "an operation whose correctness depends
on having seen what everyone else did fails the first direction." Whether a write
succeeded depended on whether somebody else had concurrently declared a second
`Creature`, and an offline participant could not know.

An MCP session is a proxy for a browser tab, and `src/client/session.ts` was
already the model. Each holds its own copy of the document. A name resolves
there, the resolved operation carries ids, and it merges whatever anyone else
did. Two participants resolving one name to different ids is *correct* — the
same shape as two readers naming one routine differently, which this model
tolerates by design and hygiene reports.

Ambiguity is therefore **local**: two `Creature`s in my view must be
disambiguated; somebody else's concurrent second one does not change what my
operation meant.

**One invariant holds this up**: no field-type spelling can be mistaken for an
id. An id is three letters, an underscore and six of `[0-9a-z]`; `u8`, `u16be`,
`char(n)`, `bytes(n)` and `bits(n)` contain no underscore. It is true by
construction and asserted anyway, in `identity.test.ts`, because it would stop
being true the moment a spelling with an underscore was added.

**A binding is keyed by its site**, which is what the algebra always said it is:
an address-to-id map, where binding again is how one is updated. It was keyed by
a minted use id, so every bind added a competitor — two uses at one site, the
loaded index keeping whichever sorted last by an id nobody chose, and unbinding
leaving the other still resolving.

**Open, and decided but not built**, as
[#26](https://github.com/re64/re64/issues/26). A binding names an instruction's
operand, so it should travel with its layer when the layer is relocated — and a
target frame should be available as the escape hatch when relocation is wrong,
exactly as a claim has one. Uses are stored inside a layer with an *absolute*
address today, so they stay behind. That is the same `Frame` the claims carry and
wants doing the same way.

Still breaking the id rule, and named here rather than left to be discovered: a
**capture refers to its bytes by filename** — R8 fixed which bytes a name means,
not that a name is the reference — and a **layer refers to its file by path**.
Both are one missing id and are [#27](https://github.com/re64/re64/issues/27).

**Which arrangement a claim is about, and the default.** A claim on a byte no
layer supplies — zero page, an I/O register, a KERNAL vector — is framed on the
**address space**: a fact about the machine this program runs on, true in every
arrangement of it. The target frame exists for a claim that really is about one
arrangement, is honoured on the way in and filtered on the way out, and nothing
emits one by default.

That default was measured rather than chosen. Camels' 68 hand-named zero-page
addresses were written while reading `runtime`. Framed there and honestly
filtered, they disappear from the other four views — and `patched` is the same
program with eleven byte patches over it, `machine` the same program with the
ROMs banked in. `$02` is `printColumn` in all of them. **Which writes should be
able to ask for a target frame is undecided**, and is the same question as scoped
names.

### Freshness is not correctness

**Only the inbox is deferred.** A write applies to the session's own copy and
propagates at once, so "add a constant, then use it" batches — the session knows
what it just made. There is no outbox and no offline write queue, because a
connected session has no reason to hold its own work.

**Nothing forces a merge.** A session may work from an out-of-date view for as
long as it likes, however online its connection is. Its writes still converge.
What it risks is doing something somebody has already done, which surfaces
afterwards as two names for one routine — a state this model keeps rather than
prevents. So `pending` on an answer says how much is waiting and from whom,
absent when nothing is; `changes_since` says what it is without taking it in;
and `merge` takes it in, explicitly.

**There is no `expectVersion` any more.** A write could refuse if the whole
document had moved since you read it, which is refusing to merge in a system
whose premise is that concurrent edits merge — and an offline participant can
never supply a valid whole-document hash, so it was a second mode by
construction. A write carries ids; there is nothing for a concurrent edit to
make it mean differently.

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

### One concept, one argument name

The surface names an address three ways, and the difference is real:

| | | |
|---|---|---|
| `address` | a **point** | 19 tools |
| `start` + `length`/`lines` | a **span you read** | 6 tools |
| `from` + `to` | a **range you filter** | 2 tools |

It used to name it four ways: `at` on the three claim tools and `from` on
`run_program`, against `address` everywhere else, with nothing to justify the
split. **Three independent readers paid for it** — experiment 10's editor missed
on three tools in a row, the silver image's build script took 238 refusals
passing `at` to `add_comment`, and experiment 11's reviewer took six passing
`address` to `preview` and never registered the message.

`at` did not move in the *model*: a claim's position is `at`, in the document
and in the file. Only the wire spelling changed, and `api-doc.test.ts` records
it as persisted-and-deliberately-unwritable so the two cannot quietly diverge.

Nested structures keep their own names — a scenario step is `{kind, at}` and a
target link is `{layer, at}` — because those are stored in documents, and
renaming them would rewrite every scenario in every project.

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

**A field is an entity, not an attribute of one.** It has an id, and
`field.add` / `field.set` / `field.remove` address it by that id the way every
other entity is addressed — including a move, which rewrites the offset key and
keeps the id, so the description survives. `type.set` therefore never carries
`fields`: it names the type's own name, size and unit and leaves the children
alone. Editing a record by resending its whole field list is how one writer's
new field disappears when another writer resends a list minted before it, and
being nested inside a type is no reason for a field to be exposed to that.

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

**Every kind is read.** `refutes` reports a declared disagreement; `supports`
backs a claim, and two of them by different authors with different methods is an
independent confirmation. The switch is exhaustive with a `never` default,
because for a long time only `refutes` was read at all.

Strength lives in `method` and in whether a scenario is attached, never in the
verb.

### Retiring

**Refuting did not solve the problem it looked like it solved.** A refuted claim
still renders, still competes for the name at its address, still appears in
`claims_at` — so a reader arriving later meets the contradiction with nothing
marking which half is live. The document accumulates settled arguments in the
working set, and the more careful the project the worse it gets.

The fix is *not* to make refutation hide its target. `disagreements()` reports
contradiction and never picks a winner, and one writer refuting another's
reading is precisely the case where nobody has won yet. So retiring is a
separate act, and `retires` is the third evidence kind.

| | says | the claim |
|---|---|---|
| `refutes` | this is wrong, and here is what shows it | stands, and is reported |
| `retires` | this is out | leaves the working set, stays in the document |

**A claim is retired when a live `retires` record names it** — derived on every
read, never stored, so there is no flag to keep in sync and restoring is
removing the record. `retire_claim` and `restore_claim` are conveniences over
`evidence.add` and `evidence.remove`; retirement needed no operation of its own,
which is the test that the shape is right.

**Filtered in one place**: `loader.ts`, where `ProjectClaim[]` becomes `Claim[]`
for a target. Rendering, naming, hygiene and `disagreements` all read that list,
so none of them needs to know retirement exists — the alternative is nine
filters, eight of which are correct.

**Anyone may retire anything.** It was nearly called `withdraws`, which is wrong
for a reason worth keeping: only a claim's author can withdraw it, and the case
this exists for is the second reader clearing up after the first.

**Retiring is not deleting, and deleting is not destroying.** A retired claim is
still in the file, with its evidence, so it exports and `list_retired` shows it
with what took it out. A *removed* claim is out of the document and lives in the
operations log, where `claim.remove`'s inverse carries the whole of it — the
right answer for a claim entered by mistake, the wrong one for a reading
somebody honestly held.

**And it is counted.** `describe_project` reports how many claims are retired,
because hiding something is itself a confident answer and a document that looks
tidier than it is has told the reader something false.

**This is not `supersedes` returning.** That one stored an *ordering* between two
claims, which a merge cannot supply. `retires` is a unary predicate on one
claim: two peers retiring the same claim while apart converge on two records that
agree, and a retirement names no chain it has to stay consistent with. It may
carry `other` to point at what replaced it, and nothing reads that as a rank.

### Evidence, field by field

```
id  claim  kind  author  method  when  scenario  capture  other  note
```

| field | present | effect |
|---|---|---|
| `claim` | **always** | what it is about — a *claim*, never an address |
| `kind` | **always** | `supports` \| `refutes` \| `retires` |
| `author` | on anything a person or agent wrote | reported by `claims_at`; **the corroboration reading** |
| `method` | optional | `guessed \| transcribed \| read \| derived \| ran` |
| `when` | optional | informational |
| `scenario` | optional | **the strongest form**: it re-runs |
| `capture` | optional | so the check can be read without re-running |
| `other` | optional | another claim: what a refutation contradicts, or what replaced a retired one |
| `note` | optional | prose |

**Two rules are enforced at the write**, and they are the same rule: a `refutes`
with neither `other` nor `note` is refused, and so is a retirement — an opinion
with no handle on it, and the second one takes a claim out of sight.

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

**`layer.set` exists in the vocabulary and reaches no tool.** The operation is
declared, applied and inverted; nothing on the MCP or HTTP surface emits one, so
a layer still cannot be renamed by anybody using this. That is F1 in its usual
form and it is the gap, stated the right way round — this file said the
*operation* did not exist, which was wrong and hid which half was missing.
