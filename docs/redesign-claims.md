# One claim, and a decode nothing can stop

*Written 2026-09-05, on branch `redesign/claims`, after tagging `re64-v0.1`.
Everything measured here is reproducible: `npx vitest run src/core/claims`.*

## Why now

re64 began as a tool for one person: set labels and functions, and a CodeMirror
widget renders the analysis live. That made the *listing* the primary form, and
the document grew the shape a listing needs.

The move to agentic-first MCP changed the primary consumer and never changed the
document. The reward was real — bugs surfaced faster, and agents drove the
abstract interpretation, because they ask questions that would be prohibitively
slow for a person to ask by hand. The cost is that seven experiments' worth of
friction all trace to one place, and it is not the renderer.

**The nouns came from the file format.** Labels, regions and comments are
symbols, directives and semicolons: an assembler source file's entire vocabulary,
and the entire vocabulary of the document. Nothing designed that. The evidence is
what happened to everything with no analogue in an asm file — constants,
decoders, targets, files, chat, participants each had to be added as a new
top-level root, each argued from first principles. The roots that came free are
the ones a 1990s listing already had.

## What dissolves, and what does not

A `code` region does exactly three jobs, and the disassembler proves it cannot
be one of them:

```
disassembler.ts:157   return kind === "code" || kind === "unknown";
disassembler.ts:151   if (!kind) return true;      // nothing mapped = assume code
```

`code`, `unknown` and *no region at all* are the same answer. So the three jobs
are: seed the decode (a root's job), not be one of the other kinds (satisfied
equally by silence), and pick a row strategy (a view's job). None is "say what
these bytes are."

The comment above the first is a confession we wrote ourselves:

> It used to do nothing unless the region also carried a name… So "this is code"
> was inert exactly when it was most needed — on a span nothing reaches — and the
> only way through was to declare it a subroutine, which forces a fabricated
> `sub_` name onto an address nobody wanted to name.

That is: *we wanted an anonymous decode root, there was no noun for one, so we
spelled it as a region kind.*

**Regions and labels had converged already.** Both carry an id. Both nest. Both
resolve innermost-first — `getRegionAt` returns the smallest cover, and extents
document "innermost wins where arrays nest". Two structures, the same containment
semantics, the same resolution rule, implemented twice.

**The interval is not the artefact.** On this machine contiguity is often a
hardware fact: the VIC reads a sprite as 63 consecutive bytes, a glyph is 8, a
screen is 1000. What *is* an artefact is the requirement that every byte have
exactly one covering interval, resolved inside the data structure before anyone
asks. That requirement exists so a row can pick a strategy.

The test for whether something is a linearisation artefact: **does the
single-valuedness come from the row, or from the machine, or from a question that
is inherently single-valued?**

| | source | verdict |
|---|---|---|
| one covering region per byte | row | artefact |
| comment `placement`: before / inline | row | artefact |
| comments wrapped at column 100, in the model | row | artefact |
| `code` as a region kind | file format | artefact |
| a claim's extent | machine (sprite, glyph, screen) | real |
| one primary label per address | an operand is one token in any view | real |
| layer z-order | memory model | real |

We already ran this experiment on code and won it. Routine extents were
intervals; measuring found 20 of 50 routines are not contiguous and one has
twelve spans; the fix made membership a question about *blocks*, and `spans`
survived demoted to a display aid. Interval as presentation, set as truth. It was
never carried to data.

## The model

One noun. `src/core/claims/model.ts`.

```ts
interface Claim {
  id: string;
  at: number;              // absolute address, or an offset into a layer
  frame?: Frame;           // { space: "address" } | { space: "layer", layer }
  extent?: number;         // absent = a point
  name?: string;           // a claim may be anonymous
  says?: Interpretation;   // data | text | bitmap | jumptable — never code
  root?: RootKind;         // entry | routine | location | data
  description?: string;
  by: Provenance;          // author, source, when, confidence
}
```

*Label* and *region* survive as words: a label is a claim with no extent, a
region is a claim with one. Both are shorthand for shapes of one object, which is
what makes the pair honest rather than a half-retreat.

Four properties, each a thing the old model could not do.

**Code is never claimed.** There is no `code` interpretation and no `unknown`
one. Code is what bytes are when nobody has said otherwise; `unknown` is the
*absence* of a claim rather than a claim of absence — which turns "unexplained"
into a question about the claim set instead of a kind to filter for.

**Rootness is orthogonal to interpretation.** A root says "surface this
regardless of what reaches it". The code roles are the old `LabelType` minus
`address`, kept apart on the grounds already recorded: they behave alike only
because the disassembler queues all three. `data` is new, and it is what an
unreferenced sprite sheet needs — which makes entry points and "show me this
sprite sheet" one list instead of two mechanisms.

**Nothing resolves at rest.** `ClaimSet.covering()` returns every claim in a
stable order. Picking happens in a named function a consumer calls — `narrowest()`
— so a caller that wants to *show* a disagreement simply does not call it.

**Every claim carries who made it.** The reason a collaborator's lens is foggy
and the reason agents overwrite each other are the same reason: the document
recorded conclusions and never who reached them. `confidence` is how a weak
commitment gets spelled — an agent that thinks a span is probably a sprite sheet
previously had to either assert it and overwrite somebody, or say nothing.

## The decode is claim-independent

`src/core/claims/graph.ts` decodes every address once. No roots, no regions, no
walk. Reachability (`reach.ts`) is a query over it from a root set the caller
supplies.

| | mapped bytes | one `analyzeProgram` | graph build | one reachability query |
|---|---|---|---|---|
| Gridrunner | 4,096 | 15.7 ms | **2.6 ms** | **0.76 ms** |
| Mutant Camels (exp 7) | 47,390 | 19.9 ms | **4.1 ms** | **0.88 ms** |

Decode once, ask many times. Today changing target re-runs the whole analysis;
here it is a sub-millisecond walk. "What would this look like if `$8E00` were a
routine" stops being a rebuild.

Three things follow, and the second is why it matters:

- **Claims become masks over the graph, not barriers to a walk.** A data claim
  hides blocks from a listing; it does not stop them existing.
- **`flowIntoData` stops being bespoke machinery.** It is an ordinary
  disagreement between two things the system knows. So is `oddJumptable`.
- **"What reaches this byte" becomes answerable.** The walk keeps no predecessor
  edges, so the backwards question could only ever be asked about addresses the
  walk had already accepted. `potentialPredecessorsOf` answers it for any address.

## What this found in the reference project

Gridrunner's own `.re64`, checked in, used as the golden test.

```
laserFrameRateForLevel   declared $8CF6-$8D18   kind: data
PlayNewLevelSounds       actually starts $8D16
$8D75                    JMP $8D16
```

The region overruns the routine's entry by **two bytes**. `shouldDisassemble`
therefore refuses `$8D16` — and refuses it to an explicit unconditional jump.
Thirty-two instructions vanish: a named routine plus two subroutines,
`Waste20Cycles` and `SoundEffect`, matching the human reference instruction for
instruction including `STA $D95F` = `COLOR_RAM + $015F`.

What the analysis said about it:

> `$8D16`: this analysis arrives here and it is declared data, so decoding stops.
> It may not be data; the code leading here may be read wrongly; or the program
> may do something here that a static walk cannot follow.

Worded as though the walk were the doubtful party, when a `JMP` points straight
at it. And the damage propagated: the project's label `PlayNewLevelSounds` sits
at **`$8D18`**, two bytes late, placed where the bad boundary left room — so the
*name* survives at the wrong address and the error is nearly invisible.

**And CLAUDE.md's record of this is wrong in a way worth keeping.** The note on
`flowIntoData` says resuming after a region "decoded `PlayNewLevelSounds` — a
routine nothing in the analysis reaches — purely because a routine is what
usually follows a table." The routine *is* reached, by `$8D75: 4c 16 8d`, an
unconditional jump. The decision to revert blind resumption was still right — a
table is not reliably followed by code — but its stated justification was a
factual error, and that error is what kept a real bug looking like a design
choice for months. The correct fix was never "resume after the region"; it is
that a claim about bytes cannot stop a jump at all.

A two-byte error in one claim silently deleted a named routine from the analysis,
from the golden test, and from every listing anyone has read. That is the whole
argument for the redesign in one asset: **a claim about what bytes mean must not
be able to stop control flow.**

Under the prototype, both statements stand and the report says which is suspect:

```
$8D16: 1 instruction(s) decode here and something jumps here,
       inside laserFrameRateForLevel declared data by project
```

`targeted` separates the two causes a single warning conflated: falling into a
table is usually the *decode* being wrong; something jumping here is usually the
*claim* being wrong.

## What it found in the agents' own project

`experiments/07-scale/run/final.re64`, 514 claims from three agents:

- `"orphanTuneStream" names 2 addresses: $64B4, $64BA` — the name-ambiguity case,
  live.
- `$5900-$5906 is claimed as text and data` — a six-byte boundary clash between a
  sprite set and a tune stream. Two agents, no containment, silently resolved.
- `$87F0 is an entry root inside padBeforeCode declared data` — the `$8D16` shape
  again, produced by agents, in the same run.

## Three reporting corrections, and they are one lesson

Every finding must be reported at the coarsest unit that explains it. This bit
three times in one evening:

| | naive | corrected |
|---|---|---|
| interpretation overlaps | 1,832 (per address) | 46 (per overlap) |
| nesting counted as conflict | 46 | **3** (nesting is refinement) |
| unreferenced 8K table | 67 (per nested claim) | **24** (outermost only) |

The middle one is a design rule, not a filter: **containment is refinement,
partial overlap is contradiction.** "This 8K block is the zone table" and "these
40 bytes inside it are text" are both true — the model was changed to nest rather
than replace precisely so they could both stand. Reporting that would make the
ordinary way of working look like a fault. An overlap neither claim contains, or
an identical span read two ways, is a real conflict. On camels that rule takes 44
findings to one, and the one is real.

## Operand reachability, and what is left over

A claim is surfaced because something reaches it. Code reachability extends to
operands: `LDA characterSetData,X` reaches the character set.

It needs the same ±1 window the label resolver already uses. `LDA table-1,X` is
the 1-indexed table idiom, so the operand names the byte *before* the claim —
without the window, `copyrightLine`, `txtBattleStations` and `screenHeaderColors`
each read as dead, missed by exactly one byte.

**What stays unreached triages into three kinds, and that is the argument for
reporting it.** After the window, Gridrunner has two and Camels has 24:

| kind | examples | why the closure misses it |
|---|---|---|
| read by hardware | `initJumpTable`, `initData` (cartridge header); `spriteBank0..3`, `residentSprites` | the VIC and the reset vector fetch these; no CPU operand ever names them |
| reached through a pointer | `zoneDataTable` ($6700+8400), `introTuneVoice1..3`, `attractScrollText` | indirect addressing, which is the blind spot `find_references` already states on every answer |
| genuinely dead filler | `tunePadding1/2`, `zoneTablePad`, `tailFiller`, `highScoreNamePad` | nothing reads them, and that is the correct answer |

Only the first needs a root because the machine reads it. The second is a gap in
the *closure*, and it names the work that would close it: `pointers.ts` already
resolves indirect accesses by running the block, and feeding those results into
the data closure would move most of this column into "reached". The third is the
report working.

An earlier draft of this section claimed the unreached set was "precisely the
bytes the hardware reads". That was wrong, and the list is more useful than the
tidy version: a finding that separates *the machine reads this*, *my analysis
cannot see this*, and *nothing reads this* is worth three times one that does
not.

Migration must root every existing interpretation claim, so nothing disappears
from a project that already exists; the discipline applies to new work.

## Layers demoted, targets promoted

Claims stop belonging to layers. The recorded justification — reordering the
stack moves annotations with their bytes — rests on a property **nothing can
exercise**, because there is no `layer.set` and the stack cannot be reordered.

Against that, layer ownership costs four pieces of machinery that exist for no
other reason than that an annotation must have an owner:

- naming a byteless address creates a `symbols` layer;
- `add_layer` exists to control that creation;
- an empty symbols layer had to be made legal, because one exists for an instant;
- and the offline/online test caught a bug where the new layer was written into
  every target's layer list.

All four vanish if a claim can name an address the target does not load. The
built-in C64 platform layer becomes a built-in claim set, which is what it always
was — it supplies no bytes.

**Layer-relative claims are a relocatable object file.** Layers are sections, a
target is a link configuration, a claim is a symbol at a section offset resolved
at link time. This makes possible something currently impossible: Mutant Camels
relocates its decruncher onto the stack page and jumps to the copy, so one set of
bytes is genuinely at two addresses. Annotate it once relative to its layer:

```
one claim, resolved at: $0110 $0810
```

Each resolution keeps a distinct id, so an id-keyed map holds both, and each
remembers the offset it was authored against.

**Banking is still not solved, and this is where it would attach.** A placement
with a condition is the right shape, but a target is a *moment* in the program's
life and banking is alternation *within* a moment, selected per instruction by
`$01`. Targets give the overlay sequence; they do not give two readings of
`$D000` in the same instant.

## What this does to the document and the API

### CRDT roots

Claims become a **top-level root**, not a field on layers and not nested inside
targets. Flat is what merges: a claim is one map entry edited independently, and
moving it between targets is a field write rather than a move between containers.

```
layers        dumb byte stores: file, bytes, or nothing
targets       named views: which layers, placed where, plus the root set
claims        flat, id-keyed, each with a frame and provenance
constants     unchanged
decoders      unchanged
files         unchanged
meta          unchanged
primaryLabels unchanged — an operand is one token in any view
chat          unchanged
participants  unchanged
```

### Operations

`region.set` disappears, and with it the three-case heuristic that infers a
region's identity from its start address. That inference is the third instance of
the bug this project has named twice — `set_comment` keyed by slot, `set_label`
keyed by address — and the only one still standing. Claims are id-identified and
additive, so it cannot recur.

```
label.set + label.delete + region.set + region.delete   →   claim.add
                                                            claim.set
                                                            claim.remove
```

### Tools

Twelve tools collapse to six or so:

| now | becomes |
|---|---|
| `add_label`, `add_labels`, `set_region`, `set_regions` | `add_claim`, `add_claims` |
| `rename_label` | `rename_claim` (by id) |
| `remove_label`, `remove_region` | `remove_claim` |
| `mark_function`, `unmark_function` | `set_root`, `clear_root` |
| `set_primary_label`, `bind_label`, `unbind_label` | unchanged — still one token per operand |

New, and each answers something no tool can answer today:

- `claims_at(address)` — *all* of them, which is the read that makes an additive
  write safe.
- `disagreements()` — the conflicts, which currently have no home.
- `list_roots` / `add_root` / `remove_root` — the registry, now that entry points
  and "surface this sprite sheet" are one list.

Changed in definition rather than in shape:

- `find_undecoded` becomes "no claim, and no root reaches it" — one predicate
  instead of a whitelist of explained kinds.
- `describe_project` reports disagreements, which is the fog lifting: what a
  person watching agents wants to see is where two of them disagree.

## Ordering

1. **Claims in core, behind the adapter**, with the existing model still
   authoritative. Done, on this branch.
2. **The decode graph replaces the walk's guts**, keeping `disassemble()`'s
   signature. This is where `$8D16` gets fixed, and where the golden test changes
   by 32 instructions.
3. **The document root and the ops**, with `re64 migrate` writing claims and
   auto-rooting every existing interpretation claim.
4. **The tools**, which is mostly deletion.
5. **Layers demoted**, last, because it is the only step that changes the `.re64`
   shape.

Steps 1 and 2 are separable from the rest and carry most of the benefit.

## Open, and deliberately not decided here

- **Whether comments become claims.** They have an address, an id and an author,
  and `placement` is a listing artefact by the test above. But `before`/`inline`
  is doing real work in the row builder, and the honest answer is to settle it
  with evidence rather than symmetry — this project has been burned once by
  `set_comment`'s slot upsert being justified for a single author and never
  revisited.
- **Whether `narrowest()` is the right default pick** for a listing, or whether a
  listing should render an overlap the way it renders overlapping basic blocks —
  emit both, in position order, marked. The precedent argues for the second.
- **Banking**, as above.
- **What a row means when two interpretations are live.** The block precedent
  says: emit both, mark the second. That has not been built for claims.

---

# Appendix: the document model and the API, tool by tool

Reviewed against the 67 tools, 24 operations and 9 CRDT roots as they stand at
`re64-v0.1`.

## The write vocabulary collapses; the read vocabulary mostly does not

That asymmetry is the finding. The redesign is about what the document *holds*,
so it lands almost entirely on writes — 12 tools become 6 — while the analysis
tools (`effects`, `call_graph`, `run_block`, `find_instructions`) are untouched,
because they were never about labels and regions in the first place. They were
built on blocks, the lifter and the value domain, which this does not move.

### Collapses

| now | becomes | why |
|---|---|---|
| `add_label`, `add_labels` | `add_claim`, `add_claims` | a label is a claim with no extent |
| `set_region`, `set_regions` | same two | a region is a claim with one |
| `rename_label` | `rename_claim` | by id, unchanged in spirit |
| `remove_label`, `remove_region` | `remove_claim` | one id space |
| `mark_function`, `unmark_function` | `set_root`, `clear_root` | rootness is a field, not a label type |
| `add_layer` | *gone* | it exists only to make `symbols` layers, which exist only to own annotations |

`set_region`'s three-case identity heuristic goes with it, and that is the single
most valuable deletion: it is the last surviving instance of upsert-by-inference,
and `src/core/claims/offline.test.ts` shows it failing this project's own
offline/online rule outright — the same call reuses an id when you have synced
and mints one when you have not.

### Changes definition, not shape

- **`find_undecoded`** becomes "no claim covers it, and no root reaches it". One
  predicate replaces a whitelist of explained kinds, and it stops needing to know
  that `unknown` means "not really a kind".
- **`list_warnings`** already carries the new findings — `describeWarning` is
  called generically, so `codeInClaim` reached `list_warnings` and every write
  result with no wiring at all.
- **`describe_project`** should report disagreements. This is the fog lifting:
  what somebody watching agents wants is where two of them disagree, and today
  that has no home in the document at all.
- **`set_region`'s description** was already wrong before any of this: it
  promised that marking data stops disassembly, and carried a copy-paste artifact
  leaving a broken sentence. Both fixed.

### New, and each answers something nothing can answer today

- **`claims_at(address)`** — *all* of them. This is the read that makes an
  additive write safe, and its absence is why `set_region` had to guess.
- **`disagreements()`** — currently unrepresentable.
- **`list_roots` / `add_root` / `remove_root`** — the registry. Entry points and
  "surface this sprite sheet regardless" become one list, which is what operand
  reachability requires.

### Untouched

`set_primary_label`, `bind_label`, `unbind_label` all survive exactly as they
are. An operand substitutes one name, and an operand is one token in a graph view
as much as in a row — so this is not a linearisation artefact and does not
dissolve. Same for constants, decoders, comments, targets, files, chat, tags,
`undo` and `changes_since`.

## Operations

```
label.set  label.delete  region.set  region.delete   →   claim.add  claim.set  claim.remove
```

24 ops become 23, which understates it: `region.set` was the only op whose
*identity* was inferred rather than given, and every other op in the vocabulary
already names its target by id. This removes the exception rather than a member.

`layer.set` is still missing and still wanted — the stack cannot be reordered,
which is the property CLAUDE.md cites as the reason annotations belong to layers.
Under this redesign that justification is gone, so `layer.set` becomes an
ordinary missing feature rather than a hole under a documented behaviour.

## CRDT roots

Claims become a **top-level root**, not a field on layers and not nested inside
targets:

```
claims        NEW — flat, id-keyed, each with a frame, an extent and provenance
layers        byte stores only: file, bytes, or nothing
targets       named views: which layers, placed where, plus the root set
```

Flat is what merges. A claim is one map entry edited independently; moving one
between targets is a field write rather than a move between containers, and Yjs
handles a map of maps far better than nested arrays. It is also what lets a claim
name an address no layer supplies, which deletes the entire symbols-layer
apparatus.

`primaryLabels` stays as it is and keeps its name — it indexes claims now, and
the reasoning is unchanged: concurrent promotions must write one map key and
converge.

## The `.re64`

The export flattens, which is the only step that breaks the file shape:

```jsonc
{
  "layers":   [ /* path, address, name — no labels, no regions, no comments */ ],
  "targets":  [ /* name, layers, placements, roots, order, description */ ],
  "claims":   [ /* id, at, frame?, extent?, name?, says?, root?, by */ ],
  "constants": [], "decoders": [], "files": []
}
```

`re64 migrate` does the conversion, and two rules make it lossless:

- **Every `code` region becomes a root at its start, with no extent.** Its span
  never meant anything: for the walk, `code` was indistinguishable from `unknown`
  and from silence.
- **Every interpretation claim is auto-rooted.** Under operand reachability a
  claim is surfaced because something reaches it, so an existing project would
  otherwise lose exactly the 2 claims Gridrunner and 24 claims Camels have that
  nothing names. Rooting them preserves today's output; the discipline applies to
  new work.

`unknown` regions convert to nothing, which is the one deliberate loss and is not
a loss: absence of a claim is what `unknown` always meant.

## What this review changed about the plan

Two things, both from reading the code rather than from the argument:

1. **The read side barely moves.** An earlier draft assumed the redesign would
   ripple through the analysis tools. It does not: they were built on blocks and
   the lifter, which are already claim-independent. That makes the change smaller
   and more separable than it looked.
2. **The warning path needed no work.** `edit()` already diffs the warning set
   across a write, so the disagreement lands on the call that caused it. That was
   the mechanism missing when a region could overrun a routine and return `ok` —
   except it was not missing, only starved of anything to report.
