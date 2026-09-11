# Claims, and what an address may say

The model itself — one noun, how it got there, and every case that shaped it: extents, structs, constants, comments, overlap, nesting, hygiene.

> **History, not reference.** Each entry is a decision with the bug that produced
> it. Entries are accurate as of when they were written and are **append-only**:
> a superseded decision keeps its text and gains a note pointing forward, because
> the value of a corrected decision is the correction. For what is true *now*, see
> `docs/05-model.md`, `docs/06-algebra.md`, `docs/07-api.md` and `docs/04-developer-guide.md`.

---

## Conceptual Model

Two layers of abstraction, where there used to be three.

**1. Memory Map & Layers** — the "physical" layer
- `MemoryMap` contains stacked `Layer` objects (FileLayer, BytesLayer)
- Layers provide actual bytes, stack and shadow each other (top wins)
- A layer knows what its bytes are *by default* — a PRG holds a program, a raw
  file holds data, a symbols layer holds nothing. Nobody decided these; they
  follow from what the file is.

**2. Claims** — everything anybody says about an address

One noun. A claim carries any of these, and at least one:

| | |
|---|---|
| `name` | what to call it |
| `says` | what the bytes are: `data`, `text`, `bitmap`, `jumptable` |
| `extent` | how many bytes it covers — absent means a point |
| `root` | decode from here regardless of what reaches it |

**Labels and regions were the same object wearing two schemas.** An assembler
source file has symbols and directives, so a model built to render one had a
`Label` for "what is this called" and a `Region` for "what is this" — with two
spellings for a span, two ways to be refused, and a rank invented so a region's
name could lose to a user's. The machine has neither. `src/core/claims/` is the
model; `Label` and `Region` no longer exist as types.

Three consequences worth knowing before reading any of it:

- **There is no `code` interpretation, and no `unknown`.** Code is what bytes
  are when nobody has said otherwise, so a claim never says it — "decode from
  here" is a `root`. And `unknown` was the absence of a claim wearing the name
  of a kind: not saying is how you do not say.
- **Several claims cover any interesting address, and that is the design.** The
  reference disassembly calls `$08` a scratch byte in most of a program and
  something specific in one routine, and both are true. So an address cannot
  identify a claim, every write is additive, and correcting one is by id.
- **Nothing resolves at rest.** Which name an operand shows, which reading a row
  uses, what nests inside what — all of it is derived when something asks.
  `disagreements()` reports where the project contradicts itself rather than
  picking a winner.

## Key Types

```
src/core/
├── memory/
│   ├── layer.ts         # Layer interface, BytesLayer
│   ├── file-layer.ts    # FileLayer (PRG/raw files)
│   ├── memory-map.ts    # MemoryMap (layer stack)
│   ├── label-type.ts    # LabelType: what a root means to the disassembler
│   └── region.ts        # LayerDefault, ByteReading, RegionIndex (holds claims)
├── claims/
│   ├── model.ts         # Claim, Interpretation, RootKind, compareClaims
│   ├── names.ts         # NameIndex: resolving a name for an address
│   ├── set.ts           # ClaimSet, disagreements
│   ├── graph.ts         # DecodeGraph: every address decoded exhaustively
│   ├── reach.ts         # Reachability as a query over that graph
│   ├── listing.ts       # One address-sorted emission
│   └── migrate.ts       # A legacy file's labels and regions, as claims
├── arch/
│   └── mos6502/
│       ├── opcodes.ts       # Complete 6502 opcode table (legal + illegal)
│       ├── instruction.ts   # Instruction type, operand formatting
│       ├── decoder.ts       # Single instruction decoder
│       └── disassembler.ts  # Work-queue disassembler
├── c64/
│   └── d64.ts           # D64 disk image parser
└── project/
    └── project.ts       # Project file schema and parser
```

## An operand inside a named array

The reference writes `LDA SCREEN_RAM + $000F,X`; re64 wrote `LDA dat_040F,X`,
losing that the operand indexes the screen at all. Forty-one sites in this one
game, and every screen coordinate had to be recovered by hex arithmetic.

The mechanism was already there and already applied to loads and stores —
`LDA droidXPositionArray-1,X` has always rendered. What stopped it was
`labelTolerance`, which defaults to **1**. Raising it is the wrong fix: a
distance threshold has no notion of whether an offset means anything, and at a
window wide enough to reach `$040F` from `$0400`, every address in the program
would borrow whatever name happened to be near it. That is the mistake that was
just removed from zero page.

So a label may declare an **extent** — how many bytes the name covers. Inside
it, an operand renders as `NAME + $000F`; outside, nothing. Either the operand
indexes that array or it does not, and there is no threshold to tune.

Two rules that took running it to find:

- **An extent beats an invented name, not a chosen one.** `dat_040F` is an exact
  match and would win by ordinary resolution, but it says nothing where
  `SCREEN_RAM + $000F` says which screen cell. A label a person put at that exact
  address stays, because they put it there on purpose.
- **Innermost wins** where arrays nest, so a row inside a screen is named for the
  row.

Extent does not replace tolerance. `table-1,X` encodes an operand *before* the
label — the 1-indexed table idiom — which no extent covers, so the ±1 window
stays. The two render differently on purpose: `NAME + $000F` says "element N of
this array", `NAME-1` says "just before this label", and they should not look
alike.

**Merging labels and regions made a named span's extent real, and that changed
four things in the listing.** It could not before: a region carried a span, and
the *label it generated* carried none — so everything in this section reached a
user label and never a region name. One claim carries both, and the golden hash
moved for it. Every change was a gain, which is the argument that the merge was
the right shape:

- **A named span renders its name.** `screenHeaderText` and four others were
  regions whose names appeared in no row of the listing at all.
- **A named span offers offsets**, so `dat_8F00` became
  `characterSetData + $0100`. This is the section above, finally applying where
  it was always meant to.
- **A control target gets its own name rather than an offset from a
  neighbour.** `BNE loc_821A` where it read `BNE CheckForPausePressed-1`, and
  `JMP loc_8BD2` where it read `JMP MaybeRestartLevel+1`. The human
  disassembly calls the first `b821A` and branches to it by name.
- **Where an extent and the 1-indexed idiom compete, the idiom wins.** This is
  the case the rule above did not anticipate — it says the idiom survives
  because "no extent covers" the byte before a table, and once a span offers
  offsets, the *preceding* array's tail covers it exactly. `LDA
  screenHeaderColors,X` with X from 1 to $28 never reads $8847, so
  `screenHeaderText + $0027` names a byte the instruction does not touch. The
  last byte of an array is the one offset an indexed load cannot mean.

Two rules keep the gain without the losses, and both turn on what an invented
name *says*:

- **An extent beats an invented name only when that name says nothing.**
  `dat_040F` encodes its own address; `loc_8D16` says control arrives here,
  which no offset carries. Letting an extent beat one turned `JMP loc_8D16`
  into `JMP laserFrameRateForLevel + $0020` — a jump into the middle of a
  table. A root is exactly the difference: `dat_` has none, `loc_` and `sub_`
  do.
- **A control target inside somebody's array still gets a name.** Auto-naming
  skips an address that already resolves, and being inside an extent counts as
  resolving — so the enclosing array silently suppressed the label its own
  jump needed. Being inside an array is not being named.

## Structs: what a claim alone cannot say

`zoneDataTable` in Revenge of the Mutant Camels is 8,400 bytes. What a reader
established was **42 records of exactly 200** — 152 of template plus 8 scalars
plus a 40-character name — verified three ways, with nineteen named fields per
creature type proved from the copy routine at `sub_9772`.

The model could hold **one field per record**: the name at `+$A0`, as 42 `text`
claims. The other 80% became one `data` blob and the finding lives in prose.
That is not incomplete analysis — it is finished analysis, discarded for want of
a shape.

**A type is a project-level declaration and a claim references it**, which is
exactly the split a constant has, and the justification transfers word for word:
a way of *reading* bytes describes none of its own, so there is no layer for it
to move with when the stack is reordered.

| | declaration | use |
|---|---|---|
| constant | `{id, name, value}` at project level | `{id, address, constantId}` in the layer |
| decoder | `{id, name, source}` at project level | `view: "snippet:<id>"` on the claim |
| type | `{id, name, size, fields}` at project level | `says: {is: "record", typeId}` on the claim |

**Holes are legal, and that is the whole design.** `size` is declared rather
than derived from the fields, so a reader who has proved nineteen fields of a
200-byte record can say so without inventing padding for the rest. The gaps are
real gaps in interpretation, and filling them with a `.BYTE` field nobody proved
would be the `zoneDataTable` cop-out one level down. `unexplainedBytes` on
`list_types` reports how much is left, which is a work queue rather than a
fault.

**How many records is derived**, from `extent / size`. Storing a count would be
a third fact that can disagree with the other two — the same reason the equate
block is derived and the region tree is derived.

**Fields are keyed by offset and carry no ids.** The identity rule this file
states first — an address cannot identify a label, because several share one —
does not transfer: two fields cannot share an offset, and there are no unions.
So the key *is* the identity, and two people adding different fields to one
record touch different keys and both survive, which is the whole merge property
ids exist for. A `Y.Map` is unordered and need not be, because order derives
from offset. **The nesting is load-bearing**: writing the field list as one
value would make it last-writer-wins over the lot, and losing a field somebody
proved from a copy routine is the silent destruction this project has now been
caught by three times.

**Endianness is in the type, not beside it.** `u16` and `u16be` are two types
rather than one type and a flag, because a flag is a second field every reader
has to remember to look at — which is how a region's `comment` and 382 platform
`description`s reached no consumer at all. A 6502 is little-endian and a
hand-written table need not be.

**A pointer is not a `u16`**, and the difference is what it renders as: a name.
The reference disassembly identified Camels' own linked list of assembler
fragments *because the links resolve*, and that is an invariant a listing can
only show if it resolves them.

**A dangling type renders the bytes.** Same rule as a dangling constant and a
dangling `primaryLabels` entry: deletion needs no sweep, and a delete racing a
binding heals itself.

**Additive from the start**, which is this file's own rule finally applied
before rather than after being caught: `add_type` mints and **returns the id**,
`edit_type` corrects by that id. Keying a write by name is what made
`set_constant` and `set_decoder` fail the offline/online test — a reader who had
synced somebody else's declaration of that name replaced it, one who had not
made a second, so the same call did two different things depending on what had
reached you. Declaring a field the parser cannot read is partial and reported,
like every batch here: one bad field must not lose the nineteen somebody proved.

**Not absorbing `text`, `bitmap` and `data`.** Those are what a reader reaches
for on the first day, and folding them into a type system would make saying
"this is text" require declaring a type first.

Field rows render in the **row model**, not in the view — the same reason
comment wrapping is there: a terminal cannot soft-wrap a listing into something
readable, so anything living in CodeMirror could never serve the CLI. Each field
carries **its own address**, unlike bitmap art which repeats one, because a
field is a place in memory and a reader clicking it means to go there. A hole
chunks in eights like a data run: 157 unexplained bytes is the ordinary case
early on, and one row of 470 characters would be unreadable exactly where the
work is still to be done.

## Constants: a value has no single meaning

A label names an address and an address means one thing. A constant names a
**value**, and a value does not. The reference disassembly settles this by
itself:

```
LEFT_ZAPPER   = $01        WHITE = $01
BOTTOM_ZAPPER = $02        RED   = $02
```

The same number carries two names in the same program, so there is no
value-to-name map to be had and **nothing infers one**. `LDA #$01` stays `#$01`
until someone says which of the two they meant. That is the same stance taken
everywhere else here: an explicit gap beats a confident wrong answer.

So it is two objects, which is what an assembler's equate and its source text
already are:

- **A declaration** — `{id, name, value}` — at **project** level, beside
  `primaryLabels`. It describes no bytes, so there is no layer for it to move
  with when the stack is reordered.
- **A use** — `{id, address, constantId}` — in the **layer** holding that
  instruction, because it is about those bytes.

Keyed by address with no operand slot, because the 6502 has exactly one
immediate addressing mode out of thirteen and no instruction takes two
immediates — so the "which operand" index that would make this a mess does not
exist on this architecture. Keying by address also leaves `.BYTE EXPLOSION1`
reachable later without changing the shape.

**A dangling use renders the literal.** Delete a declaration and every site
bound to it falls back to `#$08` rather than breaking. Same rule as a dangling
`primaryLabels` entry: deletion needs no sweep, and a delete racing a bind heals
itself.

**The equate block is derived, never stored.** `ConstantIndex.used(within?)`
returns the constants actually meant inside a span, so a listing's block stays in
step with the bindings by construction — and exporting one layer can emit just
what that layer means. The consequence, worth saying out loud: a declared but
unbound constant does not appear in a listing. Nothing is lost, because the
`.re64` holds declarations explicitly and is the export that round-trips; the
listing is a listing.

Naming a value is a judgement, so both consumers get the same shape of help
rather than an answer: `find_immediates(value)` returns every site loading it
with whatever is already bound there, which is the query behind a dropdown for a
person and a batch for an agent.

## Naming what has no bytes

`set_label` on zero page used to be refused with "add a layer of type symbols"
— advice the API had no tool to follow. On a 6502 program every variable lives
in zero page, so it made roughly half of what a person contributes to a listing
impossible to say.

The model already had the answer: a `symbols` layer names addresses with no
loaded bytes, and the built-in C64 table is one. So naming or commenting an
address nothing owns **creates one**, in the same action, and says so in the
result. `add_layer` exists for choosing its name or keeping a second set apart.

Creating rather than relaxing ownership. The rule that an annotation belongs to
the layer supplying its bytes is what makes reordering the stack move
annotations with the content they describe; letting anything hold anything
would bring back precisely the bug it prevents.

Two things this needed that were missing and would have been missed:

- **`diffProjects` did not diff layers.** It compared labels, regions and
  comments only, so a label written into a freshly created layer produced an
  operation naming a layer the exported file did not have. Layer additions come
  first and removals last, since a label needs its layer to exist and a layer
  must be empty before it goes.
- **`insertLayer` was not idempotent.** Undo checks whether replaying an
  operation forward changes anything — if it does, someone else has been there
  and the stored inverse no longer means what it said. An insert that appended a
  duplicate rather than doing nothing failed that check, so creating a layer
  could never be undone.

An empty symbols layer is now legal. It used to be refused as "almost always a
mistake", which stopped being true when one could be created deliberately and
exists for an instant between adding the layer and putting the first name in it.

**Fuzzy label matching is off below `$0100`.** Every byte in zero page is its
own variable, so a neighbour's name is not a near miss but a different thing:
`$1A` rendered as `laserAndPodInterval+1` where the reference calls it
`leftLaserYPosition`. The raw address says less and says nothing false. Above
the first page an offset usually does mean "just inside this table", so those
stay.

## Comments are objects, not a field on something else

A comment has an id and an address, like everything else that can be edited.
It was a field on a label, which meant a comment could not exist anywhere a
label did not: commenting an instruction meant inventing a name for it and
putting a name in the listing nobody wanted there. The field was also dead —
stored, carried through the model, rendered nowhere, and used by no project.

**Placement is the only axis**, `before` or `inline`, and length follows from
it. A `before` comment owns its own rows and may run to several lines; an
`inline` one shares a row with an instruction and therefore cannot. Treating
"long" and "short" as a separate field would permit a long inline comment,
which has no rendering.

`before` renders *above* the label, because the comment introduces the routine
and the label is its name — which is how a hand-written disassembly reads.
`after` renders below the row, for an observation about what happens next: the
reference writes `;Returns` under a `JMP`, and inline would attach that to the
jump itself and say something slightly untrue.

**Every comment at an address is shown, and there is no index choosing one.**
`primaryLabels` exists because operand rendering must substitute exactly one
name for an address: a forced single choice, where concurrent promotions would
otherwise both stand with nothing able to repair it. Nothing forces a choice
here, so the same machinery would have no consumer. Two comments are both
rendered, ordered by id — arbitrary, but stable and identical on every peer
without coordination — and a second inline comment is indented under the first,
where the redundancy is visible enough that whoever sees it removes one.

**Adding and revising are different operations, and conflating them cost real
work.** There used to be one `set_comment` that matched by `(address,
placement)` and reused the id it found — an upsert keyed by *slot*, justified as
"one person changing their mind rather than two comments". True of one author.
False the moment there are two, and the justification was never revisited when
collaboration arrived: in experiment 3 an agent's `before` comment silently
replaced another's, and **three of the four readers across two runs** invented
the same bad workaround — using the `inline` slot as a second channel to dodge
the collision, which corrupts what placement *means*. One asked for
`append_comment` by name.

The model always supported this. Several comments at an address are all
rendered; only the write path could not reach it. So the vocabulary is
`add_comment` (mints, never overwrites, returns the id), `list_comments`
(returns ids, or nothing downstream is reachable), `edit_comment` (by id) and
`remove_comment` (by id) — which is this file's own identity rule finally
applied here: *an address cannot identify a comment*, for exactly the reason it
cannot identify a label.

**Order is a field now, because arbitrary-but-stable stopped being enough.**
Ordering was by id: identical on every peer, which is what merge needs, and
meaningless, which is fine while an address carries one comment and useless once
adding freely and arranging later is the *intended* flow. `reorder_comments`
takes the ids in the order wanted rather than nudging one past another, so the
result does not depend on what the caller believed the order was; ids left out
keep their places after the ones named. Last-writer-wins per comment, like every
other field here — two peers arranging one address concurrently converge on
something neither chose, which for prose is untidy rather than wrong.

**A description is not a comment, and the difference is where it lives.** The
built-in C64 table carried a one-line gloss for every symbol — `CHROUT`, "write
byte to output channel" — and `createPlatformLabel` dropped the argument, so all
382 of them reached no consumer at all. The fourth instance of the shape this
file keeps recording: the vocabulary being closed is checked by the compiler, and
whether anything ever *reads* a field is not.

Making them `Comment` objects was the obvious fix and is wrong. A comment is what
somebody wrote about an address **in this project**; this is what a name means on
this **machine**, and it travels with the name. The practical difference decides
it: nothing supplies the bytes at `$FFD2` in an ordinary game, so a comment there
would render nowhere — while `description` on the label is reachable everywhere
the name is, which is what `list_claims` now returns.

It does not reintroduce the field that was removed from labels. That one was the
*only* home for a comment, so commenting an instruction meant inventing a name
for it. Comments are still their own objects and still reach any address; this
carries documentation for names the project did not choose.

In a listing it renders directly above its own label row — below any `before`
comment, since what somebody wrote about this address outranks a built-in gloss.
On Gridrunner that changes nothing, because the game's KERNAL calls point outside
its own map; on a project holding the ROM, every entry point introduces itself.

A **region's** `comment` is deliberately not this. It describes a span and is a
property of the region object alongside its name — but it renders in the listing
too, where the region begins, because a description that appeared only in the
memory map made `set_region comment:` look like it had worked and then show up
nowhere a reader was looking.

Data rows break at a region boundary as well as at a label or a comment. They
chunk in eights, so two adjacent regions shared a row and the distinction
somebody drew between them was invisible.

Comments belong to layers, like labels and regions, so reordering the stack
moves them with the bytes they describe — and so a comment on zero page needs
the same symbols layer a label there does.

One consequence in the row builder: a data run breaks at a commented address as
well as at a labelled one, or a comment written about an address inside a chunk
would be swallowed by the row and appear nowhere.

## The claims redesign, landed

**It is done.** `docs/05-model.md` is the model as it stands; read that first.
`docs/redesign-claims.md` is the design document it was built from, kept because
every number in it is something the code measured — but it describes a plan, and
the plan was executed. What follows is the argument, not a proposal.

The one-line version: **labels and regions are two halves of one noun, and the
line between them was drawn by an assembler source file rather than by the
machine.** Both carry an id, both nest, both resolve innermost-first, and the
pair is implemented twice. A `code` region is not an interpretation at all —
for the walk it is indistinguishable from `unknown` and from silence — so it
becomes a *root*, and what a person declares is either a root (decode from here)
or an interpretation (these bytes are not instructions).

What it put in `src/core/claims/` and `src/core/crdt/claims.ts`, all of it now
the live model rather than beside it:

- `model.ts` — one `Claim`: an id, a position, an optional extent, an optional
  name, an optional interpretation, an optional root, and **who made it**.
- `graph.ts` / `reach.ts` — the decode as a fact about bytes, computed once for
  all 64K (2.6ms on Gridrunner, 4.1ms on Camels), with reachability a 0.8ms query
  from a root set. Decode once, ask many times.
- `set.ts` — nothing resolves at rest; picking is a named function a consumer
  calls.
- `listing.ts` — one address-sorted emission where blocks and claims are peers,
  hex dump for what nothing covers. Two live interpretations render the way
  overlapping blocks do: both, in start order, the later marked. Nothing splits,
  including a claim inside another — that rule was tried and is unsound, because
  it assumes an interpretation is byte-local, which is false for `bitmap` and
  `snippet:<id>`.
- `crdt/claims.ts` — two peers who never met, merged, with nobody's work lost.

What has **landed**, because it was a real bug rather than a design: a claim can
no longer stop control flow. See the section above.

The design document carried nine corrections found while planning, four of them
blocking. All four are settled: the rank collision dissolved once `compareClaims`
turned out to be encoding specificity rather than authority; `adapt.ts` was the
measurement adapter and is deleted; migration preserves ids verbatim; and
`claim.set` clears a field with `null`, which is the distinction `Partial<>`
cannot make.

Three things it is worth knowing before touching any of this:

- **Containment is refinement, partial overlap is contradiction.** Reporting
  nesting as a conflict fires 43 times on one real project.
- **Report at the coarsest unit that explains the finding.** This was got wrong
  three times in one evening — per address instead of per overlap (1,832 findings
  instead of 46), per instruction instead of per run, and per nested claim
  instead of per outermost.
- **The measured cost of the current design is six.** Cross-agent region
  overwrites inside a shared project across all nine experiment runs, from
  `npm run experiments:collisions`. Small, and every one destroyed a conclusion
  somebody reached.

## Where the algebra is incomplete

Written down because it is the kind of thing that is obvious while building and
invisible six weeks later. None of it is urgent; all of it is real.

**One hole left in the operation vocabulary.** There is `layer.add` and
`layer.remove`, and no `layer.set` — so a layer still cannot be renamed.

**Reordering is no longer part of that hole**, and how it stopped being one is
the interesting half. Z-order was invoked throughout this file as the *reason*
annotations belong to layers, with the honest note that nothing could perform
it — a documented behaviour with no operation behind it, which reads as
supported. The missing operation turned out not to be missing so much as *on the
wrong object*: z-order is a property of an arrangement, not of a resource, so a
target holds the ordered link list and `set_target` reorders it.

Byte layers are `add_byte_layer` and ROMs are `add_rom_layer`; `add_layer` makes
symbols layers only, which is now a naming wart rather than a gap.

**The debt is really in the surfaces, and it is lopsided:**

| | reaches |
|---|---|
| MCP | 72 tools — the whole vocabulary |
| CLI | labels, regions, undo/redo, import/export, migrate, transcript |
| Browser | `addLabel`, `removeLabel`, `setRegion`, `removeRegion`, `undo`, `redo` |

The browser cannot write a comment, declare a constant, or set a primary label,
though all three are modelled, rendered and reachable by an agent. For a project
whose premise is *four consumers and none of them primary*, the human's surface
is the least capable by a wide margin.

**That skew is deliberate, and it is not debt in the usual sense.** The agent
surface is being built out first on purpose, for three reasons worth writing
down because the lopsided table above otherwise looks like neglect:

- **The deep work is surface-independent.** Basic blocks, the P-Code lifter,
  decoders, the analysis cache — all of it had to exist whatever consumed it.
  Which surface exposes it first changes nothing about whether it gets built.
- **A tool is cheaper than a panel.** Exposing something through MCP is a schema
  and a `Workspace` method. The same thing in the browser is markup, styles,
  state, event wiring and repaint discipline — and the repaint discipline is the
  part that keeps going wrong.
- **Agents are not gated on the author.** Progress through MCP does not wait for
  anyone to sit down and click.

So "when and whether it appears in the web UI" is a genuinely separable
question for most features, and deferring it is a schedule, not an oversight.

`layer.set` is missing for the same kind of reason, and it is worth stating so it
does not read as forgotten: **every experiment so far has handed agents a project
that already existed.** Analysing one needs no layer editing at all. It becomes
relevant the moment they are given a pile of disks and asked to *build* the
project — which is the intended shape of a later run.

That scenario needs a cluster rather than a single op, and the last item is the
one that decides whether it is possible at all:

- `layer.set`, so a stack can be renamed and **reordered** — the property this
  file cites as the reason annotations belong to layers, and which nothing can
  currently exercise.
- `add_layer` that can make **file** layers. It creates `symbols` layers only,
  so an agent cannot add a PRG, let alone one out of a disk image.
- The D64 reader reachable from a tool. `src/core/c64/d64.ts` exists and only
  the CLI can get at it, so nothing can ask what is on a disk.
- **The overlay question, which is the real wall.** A game like Bard's Tale
  loads a level over memory that held code a moment ago, and both readings are
  correct at different times. Layers do not express that: shadowing is static
  z-order decided at analysis time, so stacking two layers over one range hides
  one rather than representing both. See "One interpretation per address" below
  — building a project from disks runs into it immediately, and it needs a
  decision about what a row means before it can be built rather than after.

Nor is human-side evidence actually missing, which an earlier version of this
note got wrong. It arrives directly from whoever is building this — line
wrapping, the arrow gutter, pictures in a sidebar, the chat panel, and the
observation that *sliding the width until an image appears* is the whole
pleasure of the thing. None of that came out of an agent transcript, and none of
it would have.

## Overlap: every reading is kept, and shown

The decoder now follows a contested address as its **own stream**, with its own
occupancy so the two readings do not fight over the same bytes, stopping where
it rejoins the main decode — which is the natural end, since a byte read two
ways converges again as soon as both agree where an instruction starts. Bounded
at 64 instructions and 32 streams so a pathological binary cannot fork forever.
Shadow references are deliberately not collected: a speculative reading's idea
of what refers to what would be mixed into the graph with no way to tell it
apart.

`DisassemblyResult.shadows` carries them, `buildBlocks(..., {alternate: true})`
marks the blocks, and the listing emits an alternate immediately after the
instruction whose bytes it shares, out of address order and marked.

**Provenance, never geometry.** Two blocks of the *same* decode intersect
routinely — a block beginning inside a longer one's span is ordinary — so
"does this overlap something" is the wrong question and reported main-decode
instructions as second readings. Only a block from a shadow stream is an
alternate.

**Which reading is "primary" turned out not to be a question.** It looked like a
policy decision — fall-through wins, or the declared entry point wins, or the
longer decode wins — and every candidate was arbitrary. It dissolves instead:
emit **every** block in order of where it starts, and mark any whose start the
walk has already passed. "Primary" then means nothing more than "reached first
in address order", and nothing has to be chosen.

The listing shows all of it. Declaring a label one byte inside `STA $35`:

```
8D57  A5 35      LDA selectedLevel
8D59  85 35      STA selectedLevel
8D5A  ; also decodes from here, sharing bytes above
8D5A  35 4C      AND $4C,X            <- the label's reading
8D5C  8E 8D CE   STX dat_CE8D
...
8D5B  ; also decodes from here, sharing bytes above
8D5B  4C 8E 8D   JMP DisplayTitleScreen   <- the reading that used to be destroyed
8D5C  8E 8D CE   STX dat_CE8D
```

Two details found while building it. A jump target that lands *inside* an
instruction never becomes a block leader, because `leaders()` gates on
`instructions.has(target)` and that map is keyed by instruction start — which is
exactly why such a target falls through to the contested path instead. And the
main decode can overlap *itself*: `Occupancy.covering` reports an address inside
an instruction but not one that starts a new instruction over claimed bytes, so
two main blocks can share a byte. Emitting by position rather than by provenance
covers that case too, without knowing it was there.

## A claim about bytes cannot stop control flow

A region says how to *read* bytes. Whether execution passes through it is a
different question — and for years this file answered it the wrong way round,
letting the first veto the second.

Resuming after the region was implemented and reverted, correctly: it assumes
execution runs through the bytes, which is true of `NOP` filler and false of the
lookup table the same rule would apply to. **The reason recorded for the revert
was wrong, and the error hid a real bug for months.** It said the resume decoded
"`PlayNewLevelSounds` — a routine nothing in the analysis reaches — purely
because a routine is what usually follows a table". The routine *is* reached:
`$8D75` holds `4c 16 8d`, an unconditional `JMP $8D16`.

What was actually happening on the reference project:

```
laserFrameRateForLevel   declared $8CF6-$8D18   data
PlayNewLevelSounds       actually starts $8D16
$8D75                    JMP $8D16
```

The region overruns the routine's entry by **two bytes**, `shouldDisassemble`
refused the address, and the jump was refused with it — losing 32 instructions:
`PlayNewLevelSounds` with `Waste20Cycles` and `SoundEffect`, all three in the
human reference, instruction for instruction. It hid behind its own damage,
because the label `PlayNewLevelSounds` sits at `$8D18`, two bytes late, placed
where the bad boundary left room. The *name* was in the listing at an address
with no routine under it, and the 32 missing instructions read as ordinary
undecoded space. The golden test pinned all of it.

So **the arrival decides whether a claim may refuse an address**, and only the
program itself outranks a claim:

| | claim wins? | |
|---|---|---|
| `declared` | yes | an entry point or a jumptable entry |
| `fallthrough` | yes | control ran off the end of the previous instruction |
| `transferred` | no | a decoded `JMP`, `JSR` or branch names this address |
| `continued` | no | fall-through from an instruction that already overrode |

Two of the four were wrong first, and both corrections are the interesting part.

**A declared root is not evidence.** `declared` was `transferred` at first, on the
reasoning that an entry point is somebody saying "this is code". But entry points
are mostly *derived* — a PRG load address, every `function` and `code` label,
every code region's start — so that let a root overrule an explicit `bitmap`
claim at the same address and render a picture as instructions. Two declarations
disagreeing is a disagreement; only the program breaks the tie.

**The veto is over the arrival, not over the run.** `continued` was missing, so a
contested routine decoded exactly one instruction deep. Once a transfer has
justified decoding an address inside a claim, the next instruction executes if
that one does — which is the machine rather than an assumption. It does not
reopen the resume-after-a-table mistake, because fall-through from code that
overrode nothing is still `fallthrough` and still stops.

`flowIntoData` keeps its meaning and gains a sibling. `codeInClaim` names the
transferring instruction, because the two have opposite likely causes: falling
into a table usually means the decode leading there is wrong; an explicit jump
usually means the claim is wrong. A single warning conflating them is what let
this read as an unknowable three-way ambiguity for so long.

The general lesson, and this file has now been caught by it twice: **a warning
that offers explanations it has not checked will be believed.** The original text
offered three and named no evidence, when the evidence — one `JMP` — was in the
xref index the whole time.

This is the first landed piece of the claims redesign; `docs/redesign-claims.md`
carries the rest, with the measurements behind it.

**NOP filler between routines is code**, and should be declared `code`. A
listing showing `.BYTE $EA` is making a rendering choice, not claiming that
execution stops; declaring it data claims exactly that, and is wrong. Rendering
it as `NOP NOP NOP` also says more.

What is genuinely missing, and neither position supplies: a way to say **"this
is code, render it as bytes"**. That is a display preference, and a region kind
is the wrong place for it.

## One interpretation per address, and where that runs out

The row model is address-ordered with one row per address, so a byte gets one
reading. Three things want more than that, and they are the same limitation
wearing different clothes:

- **Overlapping instructions**, where a byte is an operand on one path and an
  opcode on another. Described below; the only case that currently produces a
  *wrong* listing rather than an incomplete one.
- **Overlays.** A C64 game loads a level over memory that held code a moment
  ago. Both readings are correct, at different times. **Targets are most of the
  answer to this one** — see below — which leaves banking as the genuinely
  unsolved half rather than the pair.
- **Bank switching.** `$D000` is VIC registers or character ROM depending on
  `$01`. Same address, same instant, different contents.

**Layers are not banks.** Shadowing is static z-order decided at analysis time —
the top layer supplying a byte wins, always. Banking is runtime alternation,
selected by state the disassembler does not model. Stacking two layers over
`$D000` does not represent a bank; it hides one of them. Anyone reaching for
layers to solve banking should stop here.

What *is* solved is **naming**: a label use binds a site to one of several
labels at an address, so `$08` can read `randomValue` in one routine and
`gridXPos` in another, and `$D000` can be named for whichever bank the code
around it assumes. That is the affordance overlays and banking most need, and it
is worth having on its own — the reference disassembly uses a second name for one
zero-page byte with no banking involved at all.

Do not mistake it for a solution to the bytes. Whenever the byte problem is
taken on, it is one piece of work covering all three, and it starts with what a
row means.

## A label inside an instruction: fixed, and the label is still invisible

**This section described a defect that the overlap work removed, and said so for
too long.** An agent in experiment 2 checked it and reported the correction,
which is the most useful thing a stale note can produce.

What actually happens now, and it turns on the label's *type* — because only
`entry`, `function` and `code` are queued for decoding, and `address` is not:

```
set_label $8D5A type=address    delta 0, decode untouched
set_label $8D5A type=function

    8D59  85 35      STA selectedLevel
    8D5A  ; also decodes from here, sharing bytes above
    8D5A  35 4C      AND $4C,X
```

The second reading is *shown*, marked, and shares its bytes with the first,
because the disassembler follows a contested address as its own stream and
`rows.ts` emits every block in order of where it starts. The `JMP` that used to
become an orphan byte, and the garbage that resynchronised one byte late, are
gone. Branching into the middle of an instruction stays legitimate 6502 — the
reference disassembly of Gridrunner does it twice — and the model represents it
rather than refusing it.

**What is still true:** the label itself renders nowhere. `add_claim` on a
mid-instruction address reports success, the name resolves correctly in operands
(`LDA CopyrightLine,X` at `$807F` has always worked), and the listing shows no
row for it. That is a real gap and a small one, and it is the whole of what is
left here.

## Where a claim lives, and who decides

A claim is never global. It belongs to a **layer** or to a **target**, and
nothing else — `platform` is the built-in C64 table and only that. An agent
naming `$D020` `borderDuringExplosion` is not amending the machine definition,
it is saying what this program does with the register, which is a fact about the
arrangement. So a third of the decision disappears before it starts.

**Layer-scoped claims are stored relative to the layer's bytes**, offset 0 being
the first byte after the PRG header. Absolute is `link.loadAddress + at`.

The alternative — absolute against a default load address, relocated when the
link deviates — fails the offline/online test, which is the check that has
caught things here that reasoning did not. It makes every claim's meaning depend
on a field living on *another object*: A edits the layer's default address while
B, offline, names `$8010`, and after the merge B's claim points at bytes B never
looked at, with no conflict and nothing reported. One field silently reindexes a
whole body of annotation. It also stores a derived fact — the true position
becomes `stored + (actual − default)`, two numbers that can drift — and it needs
a relocation step that every consumer can forget, which is a class of bug that
looks like success. Relative has no step to forget: relinking moves the claims
by arithmetic rather than by promise.

**Offsets never cross the wire.** Every tool stays absolute — `add_claim at:
"$8010"`, `claims_at`, `list_claims`, the listing — and the offset is computed
from `map.layerAt`, the same lookup that already decides annotation ownership.
No agent ever calculates one, and the stored form is invisible the way "nothing
resolves at rest" makes every other derived answer invisible.

**Scope is derived, not chosen, and there is no `scope` argument.** The topmost
layer in the current target supplying that byte, else the target. It is total,
so no write can fail on it. An override was considered and rejected because its
only *reachable* power is the wrong answer: layer-scoping a byte no layer
supplies is not expressible, so the one thing a `scope:` argument could do is
bind a claim to a layer that does not supply those bytes — which is exactly the
bug layer ownership exists to prevent, and would turn a write that cannot fail
into one that has to be validated.

**The escape hatch is `target:` on the write, matching `read_bytes`.** The real
case behind wanting an override is "I mean the loader's bytes at `$0810`, not
the runtime image's", and the natural way to say that is to name the *view* —
which the agent already has a concept for, and from which the scope still
derives by the same rule. Experiment 7 is the reason it must not require
`select_target`: a whole target went unread for a run because moving the shared
selection changes it for everybody and nobody was willing.

**It is reported on the write and on the reads** — `scope: {layer: "revenge
fixed"}` or `scope: {target: "runtime"}` — not because the agent chooses it, but
because it decides whether a claim travels when the stack is reordered, and a
property only the writer can observe is one that gets fought over. That is what
the invisible extent cost two readers in the same run.

**Scope follows the start address**, so a claim whose extent runs past its
layer's end is layer-scoped with a tail hanging off it. Representable and
occasionally right — a table that genuinely continues into the next layer — so
it is a hygiene finding rather than a refusal.

Two things this buys that are worth having on their own: the **symbols-layer
invention disappears**, since naming a byteless address is a target claim rather
than a reason to fabricate a layer to hold it; and the documented promise that
reordering the stack moves annotations with the bytes they describe stops being
a promise and becomes arithmetic.

**Built.** Two things landed with it that are worth recording because neither
was the point. `it.fails("keeps a layer's annotations with the target that shows
it")` had been sitting in the suite as a marker; framing claims on their layers
turned it green, which is the whole feature stated as one assertion. And the
round-trip harness caught a real inverse bug the moment its fixture had a framed
claim in it: `claim.add` over an existing claim restored only the fields the old
one *had*, so anything the add introduced survived the undo — invisible until a
frame was the field that differed. The fix names every field and clears the
absent ones, which is what `ClaimEdit`'s `null` exists for.

One consequence worth stating plainly: **removing a layer no longer keeps the
names made against it.** They are framed on that layer, so with it gone there is
no address to add their offsets to and they appear in no view — but they are not
destroyed, and the export proves it. Same rule as a dangling type, a dangling
constant and a dangling `primaryLabels` entry: the reference outlives what it
points at, and heals if that comes back.

The symbols-layer invention is gone from the claim path. It survives for
**comments**, which still need an owning layer — left alone deliberately, since
whether a comment belongs to a layer or a target is the kind of thing to settle
with evidence, having already been burned once by `set_comment` being keyed by
slot on a justification nobody revisited.

**Settled by reasoning, and open to evidence, which is not the same as
undecided.** Two rules here were justified for a single author and survived the
arrival of a second unrevisited — `set_comment` keyed by slot, `set_label` keyed
by address — and both times an experiment had to find it. So the specific things
to watch, named now so they are not rationalised later:

- **An agent inventing a `scope` argument** is the signal the derivation is
  wrong, not that the argument should exist. Inventing a tool name is an
  unguarded statement about what the API should have had, and the finding is
  usually that the *general* thing is missing something.
- **Agents checking scope before writing** would mean the derivation surprises
  them, which is the same shape as the extent nobody could see.
- **`target:` going unused while agents complain about the wrong layer** would
  mean the escape hatch is in the wrong place.

Read the log for whether it happened and the reports for what to look for; where
they disagree the log wins, because an agent works silently around whatever
actually hurt.

**Succession is still not built**, deliberately: the decrunched target is what
the loader *produces*, and re64 knows because `run_program` with `capture` is
what made it. That is provenance rather than presentation, and it should wait for
somebody to want it.

## A name that reaches two addresses, and project hygiene

Two labels can share a name, and in a CRDT that cannot be prevented: peers name
things without seeing each other and a merge brings both in. So the question is
not how to refuse a collision but how to render one without lying — and the
listing did lie. With `scoreDigits` at `$0410` and at `$0413`, both rendered as
bare `scoreDigits`, and `scoreDigits+4` meant `$0414` against one and `$0417`
against the other. Both neutral readers in experiment 3's control run hit it, and
one described the result exactly: *a wrong answer that looks right*.

**`primaryLabels` does not help, and it is worth saying why.** It picks one name
among the labels at *one address*. This is the transpose — one name across
*several addresses* — and nothing arbitrated it.

**A name held twice at one address is qualified too, but only in its own rows.**
The two cases are not the same question. One name reaching two *addresses* makes
an operand ambiguous — `levelTable-1` means one address against one label and a
different one against the other — so it is qualified everywhere, through
`displayName`. One name held twice at a *single* address leaves the operand
perfectly clear, since `$1000` is `$1000` whichever label you read it through, so
qualifying it there would be noise; only the label rows need telling apart.

The row builder shows each name at an address once, which is right for the
ordinary pair — a user name beside the region-generated one carrying it, ten
times over in the reference project — and wrong for two labels a person made,
because hiding one hides a real object somebody wrote. So it renders both,
qualified, when more than one *user* label holds the name. Same predicate as the
hygiene check, which is the sign it is the right one.

**Every colliding label is qualified, not one of them.** `name@<id>`, on all
holders. Symmetry is what makes it simple: there is no winner to elect, so no
tie-break rule, and rendering becomes a pure function of the name, the id, and
whether the name is shared. The invariant bought is the one that matters —
**every name that appears identifies exactly one label** — and a bare name is
therefore trustworthy without cross-checking. The cost is that a collision
changes how *both* labels render, including one somebody had been reading for an
hour; that is the honest signal, and it is what makes the collision impossible to
miss.

**Ambiguity is one name reaching two *addresses*, not two labels.** That
distinction is the whole check. Two labels at one address holding one name is
duplication — `COLOR_RAM` still identifies `$D800`, the row renders once, nothing
is unclear — and the reference project has ten such pairs. A first version
counted labels rather than addresses and reported all ten on a project with
nothing wrong with it.

Which is the general rule, and it is worth more than the instance:

## Hygiene is not analysis, and a check that fires on a healthy project is not a check

`ProgramAnalysis.hygiene` is deliberately a separate collection from `warnings`,
because the two have different subjects. A warning is a fact about *the program*
— "flow reaches `$8D16`, which is declared data" — and you investigate it. A
hygiene finding is a fact about *your own annotations* — "two labels are called
scoreDigits" — and you tidy it. One list holding both makes a reader triage prose
to discover which kind they are looking at.

Two rules decide what belongs, and the second is what keeps the list readable:

- **It renders wrong, renders nowhere, or renders ambiguously.** Tied to a
  consequence in the listing rather than to taste — which is what excludes two
  constants sharing a value under different names, since that is
  `LEFT_ZAPPER`/`WHITE` and the model working as designed.
- **Zero is the resting state.** `find_undecoded` counts *incompleteness*: it
  starts at the whole binary and shrinks as work proceeds, so it is a work queue
  and belongs nowhere near here. A list that always has entries gets ignored, and
  the one entry that mattered gets ignored with it.

The starting set is shared label names, constants declared with one name and two
values, annotations sitting inside an instruction, regions naming a decoder that
is gone, and several inline comments on one row. **The same chosen name twice at
one address** joined it when naming became additive: the write that would make
one used to refuse, so it could not arise, and a retry or a re-run of a batch is
now the ordinary way to get one. It is not ambiguity — the name still reaches
exactly one address, which is the distinction the collision check turns on — but
the row builder shows each name at an address once, so the second **renders
nowhere**, which is the admission rule almost word for word. Restricted to labels
a person chose, because pairing a user name with a layer's or a region's is the
thing the reference project does ten times over with nothing wrong. It should grow from evidence — a
run tripping on something — rather than from a tidiness instinct, which is how
the ten false findings above were nearly shipped.

**Cost is a boundary, not a hope.** Every check is O(n) over structures the
analysis already built, measured at 0.15ms against 10–20ms for the disassembly
itself; the label-name map is needed for rendering anyway, so the collision list
falls out of work already done. Anything requiring its own traversal — "is this
named routine reachable" — goes in a separate on-demand function from the start
rather than being added here and discovered to be slow later.

## Name the observation; let the caller bring the knowledge

This machine is full of things that look like defects and are idioms. `BIT $10A9`
is a two-byte skip that swallows its own `LDA #$10`, and it really does read
`$10A9`. `RDTIM` falls through into `SETTIM`, so reading the clock writes it back
and re-enables interrupts. `PLA PLA RTS` returns to its caller's caller. `JMP
($10FF)` takes its high byte from `$1000`. A `CLC` before `SBC` subtracts one
more than the operand reads, and is sometimes deliberate.

Trying to *resolve* these in the analysis is the losing move: each one wants its
own special case, and every special case is a place where a confident wrong
answer can hide. What the analysis can do well is **notice precisely and name
what it noticed**, and then let whoever is reading — a person, or an agent with
knowledge of the machine that no pass here encodes — settle it.

So an observation is a **kind**, not a sentence:

| | |
|---|---|
| `DisassemblyWarning` | `undefined`, `truncated`, `overlap`, `oddJumptable`, `flowIntoData`, `indirectJump` |
| `HygieneFinding` | `label.nameShared`, `constant.nameShared`, `region.missingDecoder`, … |
| `ReturnBehaviour` | `abandons`, `skips`, `ambiguous` |
| `EffectGap` | `unmodelledInstruction`, `calleeSkipsFrames`, `calleeNotDecoded` |

`EffectGap` was the last holdout and the most costly one, because it sits on the
field that answers *"can I trust this list"*. It was `string[]`: an agent that
knows perfectly well what `$F1CA` does could not say "ignore that gap" without
parsing English. Each type keeps a `describe*` beside it, so the prose is still
there for a reader and the kind is there for a caller. **Naming costs nothing and
un-naming is expensive**, which is the argument for doing it at the point the
observation is made rather than when somebody finally needs it.

The two failures this prevents are opposite, and this file has now made both:

- **Conflating two observations under one name.** `skipsFrames: 0` meant both
  "resets the stack" and "the analysis cannot tell", so a cut keyed on it threw
  away whole routine bodies. A fact about the program and an admission about the
  pass must never share a name.
- **Giving an observation no name at all**, which forces every consumer to
  either ignore it or parse it.

**One batch contract, across every batch tool:** apply what you can, report what
you declined in `rejected`, and fail only when nothing was applicable. `regions`
was the last write without a batch form, and the most used of all of them —
three readers on one project spent 129 of 648 calls on `set_region`, a round trip
each. The validation is shared rather than restated, since a batch that checked
less would be the obvious way to write the region a single call refuses. Undo stays
coherent because the changeset covers exactly what was applied. `bind_constants`
was made partial and `add_comments` was not, so two batch tools disagreed about
their own contract and a caller could not tell which it would get.

## Declaring a region inside another nests; it does not replace it

`regionSetOp` used to match an existing region by **start address** alone and
reuse its id, so declaring 32 bytes of a 512-byte `characterSetData` region a
bitmap *shrank* it to 32 bytes and left the other 480 explained by nothing,
silently.

Nesting is the right answer, and splitting the outer region is not: splitting
mutates a region the author never asked to change and invents a second one to
hold the remainder, where nesting leaves *"$8E00–$9000 is the character set
data"* true and adds a more specific statement inside it. Both are true at once,
which is what overlap is for. The model already supported it — regions may
overlap and `getRegionAt` resolves innermost-first — so the inner one renders
inside its span, the outer one either side, and nothing becomes unexplained.

**A claim has an id, and that is the way to name one.** `claims_at` reports
them and `set_claim`/`remove_claim` take them, which removes the inference
entirely: an id says *this* claim, however far its span has moved.
That is the same rule everything else here follows — "an address cannot identify
a label", and a region's start is no better, which the identity section said long
before regions could nest.

**The inference is gone, and it is worth knowing what it was.** A declaration
used to be matched against existing claims by start address, in three cases: the
same span exactly reused the id, the only one starting there was an extend or a
move, anything else nested. Checking the exact span first was load-bearing —
without it, re-declaring a span inside a larger one nested again on every call,
and two identical spans raced to be the innermost, which showed up as a test
that passed eight times and then failed twice.

It was an upsert wearing a heuristic, and experiment 8 found the last path still
going through it: `add_claim` with a `root` reused an existing claim's id and
replaced its name, under a tool whose description promises it never replaces.

**Adding always adds now, and correcting is by id.** What the heuristic was
trying to do — let somebody re-declare a span without minting a duplicate — is
not something the model needs done for it: several claims covering one address
is the design, `claims_at` is how you find the one you meant, and a duplicate is
a hygiene finding rather than a thing to prevent at the point of writing.

**Nesting also cost the start address its uniqueness**, which `remove_region`
had been relying on: two regions can now begin in the same place, and picking
whichever the array listed first would delete the wrong one silently. An
ambiguous start is refused and names the candidates, which is also how a caller
learns the ids it should have passed.

To shrink a region without naming it, remove it first. The edit result says so:
`nestedInside` names the enclosing region and how to replace it instead, because
"I declared 32 bytes and a 512-byte region is still there" should not have to be
discovered by reading the map afterwards.

## Text Region Rendering

A text region declares its **encoding**: `petscii`, `screen`, or `ascii`. Neither
C64 encoding is ASCII — `$01` is `A` on the screen and a control code in
PETSCII — so reading one as the other produces confident nonsense, which is what
this did for every game that puts its strings in screen codes.

Most of both encodings maps to plain ASCII. The graphics characters map to
Unicode that already existed for other reasons — box drawing, block elements,
card suits — plus the *Symbols for Legacy Computing* block added in Unicode 13
for exactly this. **Graphics coverage is deliberately partial**: every code that
carries text is exact, the common glyphs are there, and the rest renders `·`
rather than guessing. A wrong glyph is worse than a visible gap, and text is
what a reader is after.

A text row now shows its decoded content rather than a bare `.TEXT` directive.
That was not a missing feature so much as a defect: declaring a span text made
the listing *less* readable than leaving it as data, which at least printed an
ASCII column.

**Still not solved: custom character sets.** Many C64 games ship their own glyph
data — Gridrunner's copyright line reads `(c) 1982 HES` through the charset at
`$2000` and `<= 1982` through any built-in encoding. Getting that right means
either a byte-to-glyph mapping in the project file, or reading the game's own
charset and matching glyph bitmaps against known shapes. The first is a schema
addition and a decoder; the second is real work and would be the interesting
version.

What changed for the better meanwhile: the wrong answer is now *visible*.
`<= 1982` is obviously not English, where a bare `.TEXT` said nothing at all.

## Method, not confidence — and evidence about a claim

**2026-09-07.** `Provenance` carried `confidence: asserted | inferred | guess`. It
was reachable by nothing — no tool, no UI, no CLI — which is the sixth instance
of the shape this archive keeps recording, and the worst, because its own doc
comment called it *"the thing the old model had no way to spell"* and then
nothing was wired to spell it.

**Wiring it up would have been the wrong fix. It was on the wrong axis.**
Experiment-0 settled that: neither agent asked for strength, both asked for
*method*, and one of them said why in a sentence worth keeping —

> *"Agreement between two accounts is only evidence when the methods differ, and
> nothing in either document records **method** at claim granularity, so there is
> no way to tell an independent confirmation from a correlated one."*

Not abstract. Both agents concluded glyphs `$03`/`$04` were never drawn, both
were wrong, and the refutation was in one of their own screen dumps labelled
`# unused`. They agreed because they used the same static reasoning and shared
its blind spot. A number cannot detect that; `guessed | transcribed | read |
derived | ran` can.

`transcribed` earns its place separately. It is the category both agents' own
trust ledgers lacked, and one of them named it as *"the one that generated most
of the errors on both sides"* — a fact copied by hand carries the source's
mistakes and none of its own checking.

So `claims_at` reports the method, and `label.duplicated` says whether duplicates
were reached different ways: *"one account written down twice"* against *"reached
two different ways, so they do corroborate"*.

### Evidence is a thing said about a claim

The other half neither toolchain had, written out by one of the agents as the
thing they wanted and could not do:

> *"I wanted to write `COMMENTS[0x8DF9] = ("contains $3B — so $3B IS drawn",
> contradicts="findings.md §7", confidence="certain", by="A")`. Nothing in either
> toolchain accepts that shape."*

Three separate gaps hide in that one example.

**A refutation need not overlap.** `disagreements()` sweeps for claims covering
the same bytes, and neither real disagreement in that run had that shape: `$8DF9`
holding `$3B` refutes a claim about the *glyph* `$3B`, somewhere else entirely.
Declared refutations now come back as `kind: "declared"`, listed before the
geometric ones — somebody saying "this is wrong, and here is why" outranks
anything inferred from where the bytes sit.

**A refutation attaches to a reading, not a place.** The other agent put it
exactly: *"it isn't a comment on an address, it's a comment on an
interpretation."*

**Withdrawing is not deleting.** `remove_claim` destroys. A superseded claim now
stays with the reason, because *"the wrong model that led to the right place is
worth keeping, and prose deliverables silently discard it."*

### Evidence that re-verifies

A scenario can `assert`, which makes it a probe, and a claim can point at one.
Both agents asked for this in nearly the same words:

> *"Every check should have been a named, re-runnable probe kept alongside the
> artifacts."*

> *"Then 'how I know' is a filename and a line number, the whole thing
> re-verifies after any change to the emulator, and my colleague can trust the
> emulator because the checks pass rather than because I said so."*

Both had run their checks and lost them to shell history, so `findings.md` said
"verified in emulation" with the instrumentation gone. `run_scenario` now returns
`passed` and a line per check.

**A refutation or supersession that points at nothing is refused** — no `other`
and no `note`. That is a fact about the request rather than a judgement about the
result: the whole value is that a reader can follow it to what was wrong.

### What is deliberately still missing

**Negative results** — *"I looked for X and it is not there"* — and the
open-question queue. Both agents asked for them and both are probably a claim
with `method: "guessed"` and no supporting evidence, so nothing was built until
somebody trips over the absence rather than predicts it.

## Parked: what a field's *value* refers to

> **Note, appended: the array half is built; the three below are still parked.**
> A field can now be `u8[8]`, `Creature[42]`, `char(40)[3]`, or `u8[1..32]` where
> the first index is not zero. That is the *layout* half of what this entry
> wanted, and it was decided on different evidence from what is discussed below:
> a counted list from **two** programs rather than a prediction from one, which
> is the standard this entry itself asks for. Camels' zone record is nineteen
> fields each eight wide, one slot per creature type; Gridrunner's three level
> tables are `LevelParams[32]` each and nine more are declared `=*-$01`.
>
> The three rows in the table below — index-into, bitmask-over, enum — are
> untouched, and they are one mechanism rather than three: each is a field
> saying what its value *refers to*, and none can be built until there is a way
> to name the referent. The array is what makes that nameable, which is the
> order they had to come in.
>
> What the array already settles is smaller than it looks and larger than it
> sounds: `zones[2].name` is now derivable, and so is `zones[].nextType`. So an
> effect summary that today reads `reads: memory at a computed address` — which
> is what `effects` says about `$9A39`, the creature-ageing routine and the most
> important in the program — has both ends nameable for the first time. A
> relation **noun** stays parked for the reason given below, and this makes that
> refusal cheaper rather than harder.

**Not built, and the interesting part is why the usual signal cannot decide it.**

`add_type` answered "these 8,400 bytes are 42 records of 200" — the shape that
was missing when experiment 7 finished its analysis of `zoneDataTable` and had
to put it in prose. Experiment 9 then used it, declaring `ZoneRecord` with 41
fields. One evidence-driven slice, one for one.

The next thing the same table wants is a way for a field to say **what its value
refers to**, and Revenge of the Mutant Camels needs exactly three:

| | example | today |
|---|---|---|
| an **index** into another table | `+$10` is a sprite pointer: value × 64 + bank, not a literal address | `ptr` cannot say it |
| a **bitmask** over another field's index space | `+$9A` bit *n* means creature type *n* is double-width | prose |
| an **enum**: values drawn from a named set | `$C0` means the camel | constants exist and bind per *address*, not per field |

Its appeal is that it makes aggregation **derived rather than stored**. Declare
`+$38` an index into this zone's creature types and the transformation graph
falls out; declare `+$9A` a bitmask over them and "which creatures stretch"
falls out; declare `+$10` a sprite index and the pictures resolve. A relation
noun — triples, a semantic graph — would store those same facts a second time,
beside the bytes that already say them, and the two can disagree. That is the
failure this model exists to avoid, and it is why the shape here is a field type
rather than an edge.

It also gives a name to the thing a program actually manipulates. The code never
writes `$3000`; it writes `$C0`. A label names an address, a constant names a
value, and a sprite number is a value — so the handle wants to be
`sprite(CAMEL)` rather than a label on the bytes. Letting a place take a
constant is the small piece that would finish it. (A sprite pointer is unique
only within a bank — `$0801` and `$1001` hold identical artwork because *p* and
*p*+`$20` fetch the same image — so such a name is a fact about a bank, exactly
as `screen(10,2)` is a fact about a screen base, and wants stating the same way.)

### Why this is parked, and what would unpark it

The evidence is **weak and of the wrong kind**. What there is:

- Experiment 7, deep coverage on this binary: 400 labels, 114 regions, 18
  constants, 210 comments. It named sprite *banks* — `spriteBank0..3`,
  `residentSprites` — and never named a single sprite.
- Experiment 9, editorial over the same program: 41 type fields, and **zero
  constants**.

That is absence of use, and absence of use is not demand. Nobody asked for an
enum, an index type or a bitmask field.

**And the signal that decides everything else here cannot fire for this one.**
The rule is that when an agent invents a tool name, the finding is usually that
the general mechanism is missing something — `bind_decoder`, `find_strings`,
`screen_address`, `play_sid` all arrived that way. But an agent invents a name
for something *adjacent to what it already has*. It does not invent a category
it has never seen. So waiting for three readers to ask for enum fields is
waiting for a signal that is structurally unavailable, and reading the silence
as "not needed" would be reading a limitation of the method as a finding.

So the evidence has to be **manufactured deliberately**, and that is cheap: brief
a run to record *structure* rather than names, point it at types and constants,
and read the log for the workarounds rather than the wishes — binding constants
site by site, writing a mask's meaning into a comment, re-deriving the same
graph in a throwaway script on each question. Those are what "finished analysis,
discarded for want of a shape" looks like from the outside, and they are what
justified `add_type`. A wish is not required and, here, is not to be expected.

---

## Retiring, and why refutation was not enough

**September 2026.** The claims model has one rule about disagreement that
everything else follows: `disagreements()` reports contradiction and never picks
a winner. Two readers reading one span differently both stand, and the document
says so. That rule is right and is not what changed.

What changed is that it left no way to *finish* an argument. A refuted claim
still renders, still competes for the name at its address, still comes back from
`claims_at`. So a reader arriving on day thirty meets forty settled arguments
with nothing marking which half is live, and the more carefully the project has
been worked the worse the effect — every resolved question is still sitting in
the working set with its loser attached.

The tempting fix is to make `refutes` hide what it refutes. It is wrong, and
obviously so once written down: refuting is what one writer does to another
writer's reading, and hiding on refutation would let either of them unilaterally
win a live dispute. That is the exact thing the model refuses to do.

So the acts are separated. `refutes` says *this is wrong* and both claims stand.
`retires` says *this is out*, and is an editorial decision somebody takes and
signs.

### Three things about the name

**Not `withdraw`.** That was the first name, and it is wrong because only the
author of a claim can withdraw it — while the case this exists for is the second
reader clearing up after the first. Anyone may retire anything.

**Not `delete`, and the reason is not that deletion is destructive.** It is not:
`claim.remove`'s inverse carries the whole claim, the operations log is durable,
and undo reaches it. Both verbs are kept because they answer different
questions. Removing is for a claim entered by mistake, which the *document* has
no reason to remember. Retiring is for a reading somebody honestly held and has
now settled — the document should remember that, and it does, because the claim
and the reason stay in the file and export with it.

**Not `supersedes` coming back.** That kind was removed a week earlier for
storing an *ordering* between two claims, which a conflict-free merge cannot
supply: two peers offline could each supersede one claim with a different
replacement and the document converged on two parallel supersessions with
nothing to break the tie. `retires` is a **unary predicate on one claim**. Two
peers retiring the same claim converge on two records that agree; a retirement
names no chain and no replacement it must stay consistent with. It may carry
`other` to point at what took over, and nothing reads that as a rank.

### The shape

Retirement is **derived**, like everything else here: a claim is retired when a
live `retires` record names it. No flag on the claim, nothing to keep in sync,
and restoring is removing the record. `retire_claim` and `restore_claim` are
conveniences over `evidence.add` and `evidence.remove` — **no new operation**,
which is the same test `mergeClaims` had to pass and the reason to believe the
noun was already there.

It is filtered in **one** place, `loader.ts`, where stored claims become domain
claims for a target. Rendering, naming, hygiene and `disagreements` all read
that list. The alternative — teaching each surface about retirement — is this
project's most repeated defect written down in advance.

Two things are refused, both facts about the request rather than judgements
about the result: retiring with neither a note nor an `other` (an opinion with
no handle on it, and this one takes a claim out of sight), and retiring a claim
that is already retired.

And it is **counted**. `describe_project` reports how many claims are retired,
because hiding is itself a confident answer, and a document that looks tidier
than it is has told the reader something false. `list_retired` says which, and
what took each out.
