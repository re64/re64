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

## Checked against the human disassembly

`gridrunner.asm` is 65KB of somebody's reverse engineering, and its
auto-generated labels encode their own address — `b8D1A` is a branch target at
`$8D1A`. So every one is an address a *person's* disassembler called an
instruction start, which makes the oracle usable for the decode and not only for
the names.

**141 of 141 agree.** Two of them did not before the fix: `$8D1A` and `$8D24`,
both inside `PlayNewLevelSounds`. That is the independent evidence that the 32
recovered instructions are real code and not a decode this analysis talked itself
into — which matters, because "the walk found more" is exactly the claim that
needs a witness other than the walk.

Three apparent disagreements were the extraction being naive, and one of them
found something worth keeping. The reference uses `=*+$01` **exactly twice in
65KB**, and both times to name an address *inside* an instruction: `b8737` is the
operand byte of `BNE` at `$8736`, `b8D5A` the operand byte of `STA` at `$8D59`.
An equate is what an assembler makes you reach for when a label cannot be placed
inline — which is the same gap CLAUDE.md records from the other side, where
`add_label` on a mid-instruction address succeeds and renders nowhere.

So that gap now has a measured size and a known-good rendering: it cost the human
twice in one program, and an equate line is how they paid it.

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

## How often this actually destroyed somebody's work

The label vocabulary was rewritten because experiment 7 destroyed 123 names
across 74 addresses and told nobody. The region write has never been counted, so
here it is, from the request logs of all nine experiment runs.

**Six.** Cross-agent overwrites of a region inside a single shared project: one
in experiment 3, five in experiment 7, none anywhere else. Against 172 region
declarations in those two runs, which is about 3.5%.

Each is a disagreement rather than a duplicate, which is what makes it a loss:

| | |
|---|---|
| `$5E00-$5ED0` | amber `data/highScoreTable` → basalt `text/highScoreTable` |
| `$6700-$87D0` | beryl `data/waveTable` → amber `data/zoneDataTable` |
| `$6320-$64B4` | amber `tuneVoice2` → basalt `introTuneVoice2` |
| `$9D21-$9D29` | basalt `messageColourCycle` → amber `messageFlashColours` |
| `$C112-$C11F` | basalt `filenamePad` → amber `highScoreNamePad` |
| `$8080-$80A0` | amber `text/TitleCopyrightLine` → agate `data/txtCopyrightPressFire` (exp 3) |

`messageColourCycle` against `messageFlashColours` is two readers concluding
different things about eight bytes. `waveTable` against `zoneDataTable` is the
same about 8,400. Both losers were told `ok`.

**The first count was 90, and it was wrong by 15×.** Experiments 2 and 5 put
agents on *independent clones* — that is the whole design of the convergence run,
so that agreement is not measured by contagion — but the request log is per
server, not per project, so a naive pass reads three projects as one and every
agent's independent naming of `$8000` as a collision. Grouping by the `project`
argument takes it to six.

Recorded because the inflated number was more persuasive and the small one is the
true one. It is also, on its own, an argument for the redesign that the redesign
did not need: six is small, and each is a conclusion somebody reached and lost.

## Merge, exercised rather than argued

`src/core/crdt/claims.test.ts` runs two peers through a real `Y.Doc`: build a
base, split, edit both copies with no communication, exchange updates in *both*
directions. Six properties hold.

| | |
|---|---|
| each declares the same span offline | both claims survive; the contradiction is reportable |
| each revises a *different* field of one claim | both land — `claim.set` is partial by construction |
| each revises the *same* field | converge, on one of the two values |
| a delete races a revision | a whole claim or none, never one field of a deleted one |
| undo scoped to an origin | takes one peer's work, leaves the other's |
| round trip through the document | unchanged, including frames, encodings and confidence |

The second row is the one `set_region` cannot do. It replaces the whole region,
which is the same shape as the `target.set` bug this project already found and
fixed — describing a target silently reverted somebody's layer list.

**The boundary test caught the prototype in the wrong directory, and was right
to.** `yjs` belongs only in `src/core/crdt`; `src/core/claims/` is domain and must
never see a CRDT type. Persisting a claim is a CRDT concern, so it moved — which
is where it would have had to live anyway. An allowlist asserted by a test
earning its keep on the first new root in a year.

## One address-sorted listing: blocks and claims as peers

The parked question, answered by extending the rule that already settled
overlapping *instructions* to the whole listing:

> Emit **every** block in order of where it starts, and mark any whose start the
> walk has already passed.

`src/core/claims/listing.ts` collects all reachable basic blocks *and* all
reachable-or-rooted claims into one list, sorts by address, and falls back to a
hex dump for byte ranges nothing covers.

**An earlier version of this section got it wrong**, and the correction is the
point. `layoutClaims` decided per address which claim *owned* a byte, innermost
first. That is a resolution: it moved `getRegionAt`'s decision out of the data
structure and into a layout pass, where it is no more visible to the person the
disagreement belongs to. Nothing owns a byte. Several things describe it, all of
them are emitted, and "primary" means "starts first" and nothing else.

Three consequences:

- **A gap is a hex dump, not a kind.** Bytes nothing covers get no
  interpretation — which is what makes the absence of a claim the honest spelling
  of "nobody has explained this", and `find_undecoded` a question about gaps
  rather than a whitelist of explained kinds.
- **Inclusion is reachability, not annotation.** A claim appears because
  something reaches it or because it is rooted. A sprite bank nobody rooted is
  genuinely absent, which is a fact about the project rather than an oversight.
**Nothing splits, including a claim declared inside another.** That rule was
tried and removed, and why is worth more than the rule.

It assumes an interpretation is byte-local — that rendering `[a,b)` then `[c,d)`
equals rendering `[a,d)` minus the middle. True of hex, roughly true of text, and
**false for `bitmap` and for `snippet:<id>`**: a `char:8` sheet split at byte 37
breaks the glyph grid, and a decoder run over two fragments is not the decoder run
over the span. Two of the four interpretations that exist today.

It looked necessary because an 8,400-byte `data` claim called `zoneDataTable`
dumps to completion before the forty strings inside it appear. But that claim
**expresses 1,680 of its own 8,400 bytes — 20%**, and the missing 80% is not
missing analysis. From the Camels write-up:

> `$6700-$87CF`: 42 records of exactly 200 bytes, 152 bytes of template plus 8
> scalars plus a 40-character name. **Verified** three ways — the banner lands on
> `+$A0` in all 42, the code does `ADC #$C8`, and the credits say "THE GAME
> CONSISTS OF FORTY TWO DIFFERENT ATTACK WAVES."

…with nineteen template fields per creature type, "all named, all proved by the
copy in `sub_9772` rather than guessed". The reader knew the record count, the
stride, the field layout and the semantics. The model could hold **one field per
record** — the name at `+$A0`, which is the 42 `text` claims — and the rest became
one `data` blob with the finding living in prose.

So `zoneDataTable` is not an early step in the analysis. It is the finished
analysis, discarded, because the model had no shape for an array of structs.
Splitting made that read tolerably, which is compensating in the display for a
document problem: the mirror of a mistake this file already names in the other
direction.

Deleting the claim takes Camels from **6 gaps to 48**, and from **3,824
unexplained bytes to 10,544**. One placeholder was keeping 42 entries out of the
one list whose job is to show unexplained work.

So the rule underneath is about claims rather than rendering:

> **A claim should cover exactly what it explains.** One covering bytes it does
> not explain is a placeholder, and a placeholder belongs in the gap list rather
> than over it.

Composition is the real answer for spans that genuinely have parts, and it has to
be **declared rather than inferred from containment** — that is exactly the
difference between "this is a struct" and "these are forty strings and forty
unexplained runs". A hierarchy of interpretations, in which `text` is more
specific than `data`, would also justify splitting; neither exists yet, and
inferring one from geometry is how you get a rule that is right on the case you
tested and wrong on its transpose.

**"Handwritten assembler is too much of a mess for structs to matter" does not
survive the second real program.** Camels has the 42-record zone table above, and
it also has three blocks of the author's own BASIC-assembler source left in the
image, stored as a genuine linked list — `[link lo][link hi][line# lo][line# hi]
text $00`, and it was *the links resolving* that made the identification certain
rather than a lucky run of printable bytes. A structure whose proof is that its
pointers resolve is one the model cannot express, let alone check.

On Gridrunner's contested span:

```
$8CD5-$8CF6  data sizeOfDroidSquadsForLevels
$8CF6-$8D18  data laserFrameRateForLevel
$8D16-$8D1A  2 instruction(s)  [also decodes from here, sharing bytes above]
$8D1A-$8D24  4 instruction(s)
```

On Camels, where a claim sits inside another:

```
$6700-$87D0  data zoneDataTable
$67A0-$67C8  text  [also reads these bytes, shared above]
$6868-$6890  text  [also reads these bytes, shared above]
```

Every mark there is *true* — those bytes are shared — and it is the placeholder
being visible rather than noise. A project whose claims each covered what they
explained would show no marks here at all.

One smaller thing the rule needed: **the high-water mark is not seeded with the
window edge.** An item extending into the view from before it has been passed by
nothing, and seeding with the window makes the same listing read differently
depending on where you started reading — the viewport-dependent classification the
arrow gutter rules already forbid, arriving by a different door.

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

## `set_region` was not the last one

Calling it the last surviving instance of upsert-by-inference was an assumption.
Auditing the write surface found two more, and the audit produced a rule that is
checkable by reading one line of any write:

| write | identity from | offline == online? |
|---|---|---|
| `set_target`, `tag_project` | a **name, keyed as such in the document** | yes — two writers converge field by field |
| `set_region` | the **span**, matched against what the writer can see | no |
| `set_constant` | the **name**, matched against what the writer can see | no |
| `set_decoder` | the **name**, matched against what the writer can see | no |

> If a write infers identity from anything other than an id it was given, it is
> offline/online asymmetric.

Name-keying in the *document* is fine, and the distinction matters: a target is
its name, both peers write the same key, and a merge resolves field by field with
nothing destroyed that was not overwritten on purpose. Inferring an id at write
time is different, because the inference reads state that a disconnected writer
does not have.

**The constant case has a tell the region case lacks.** `hygiene` reports
`constant.nameShared` — "several constants hold one name with different values" —
and connected writers *cannot produce that state*, because the second write
reuses the first's id. So the check can only ever fire on a merge of work done
apart. The model plainly tolerates the state the write path unilaterally refuses,
which is the contradiction in one sentence.

Under claims this cannot recur for regions and labels. Constants and decoders are
separate objects and would need the same treatment — mint an id at the writer, let
duplicates stand, report them — which is a small, independent change that does not
wait for any of the rest of this.

## What it would cost

Counted rather than estimated, because "how big is this" is the question that
decides whether it happens.

**Code.** 18 non-test files mention a region type, 24 mention a label type, and
the work concentrates in six:

| | mentions | what changes |
|---|---|---|
| `src/server/workspace.ts` | 16 | the tool surface, mostly deletion |
| `src/core/view/rows.ts` | 15 | row strategy keys on an interpretation, plus the layout above |
| `src/core/memory/region.ts` | 11 | becomes `claims/` |
| `src/core/memory/label.ts` | 11 | merges into it |
| `src/core/ops/edits.ts` | 10 | three ops replace four, and the heuristic goes |
| `src/core/analysis/program.ts` | 9 | roots replace `entryPointsFor` |

The rest is one or two call sites each. Nothing in `src/core/il/`, nothing in
`src/core/analysis/values.ts`, nothing in the effects or call-graph work — which
is the appendix's finding stated as a number.

**Data.** 24 `.re64` files in the repository, 11 of which carry regions, 475
regions in total:

| kind | count | migration |
|---|---|---|
| `text` | 188 | claim with an extent |
| `data` | 170 | claim with an extent |
| `bitmap` | 19 | claim with an extent |
| `jumptable` | 10 | claim with an extent |
| `code` | 88 (18%) | **a root with no extent** |
| `unknown` | 0 | would be dropped |

The `code` row is the one that changes meaning rather than shape, and at 18% it
is not a corner case — every project with regions has them. That nothing is
`unknown` is worth noting too: the kind exists, and in four years of real use
nobody has written one, which is what "the absence of a claim" being the honest
spelling looks like from the data side.

## Corrections found while planning the implementation

The design above was written from a prototype. Planning the landing sequence
against the real codebase found nine things wrong with it. **The first four block
implementation.**

**1. ~~The rank collision~~ — measured, and it dissolves.** `LABEL_RANK` is
`user:4, region:3, layer:2, platform:1, auto:0`, and `Provenance.source` has no
member where `region` sat. The obvious reading is that the claim model cannot
express the ordering and something must be added to it.

Measuring says otherwise. `compareClaims` sorts by position, then **narrowest
span first**, and a label has no extent while a region has one — so the label
already wins, and for a better reason than rank did. **`user > region` was
encoding specificity, not authority**: a region-generated label names a *span*, a
user label names an *address*, and a name on one address is more specific than a
name on a span that merely starts there. That is the same "innermost wins" rule
the model already applies to nesting, one level over.

Across all 24 projects, 215 addresses carry two named claims. **205 resolve
exactly as rank did.** The 10 that differ are all cases where somebody declared a
label with a span one or two bytes wider than a region — `tuneVoice1` (76)
against `shortTuneVoice1` (78), `moveHandlerTable` (6) against `moveHandlerLo`
(7) — near-synonyms for the same bytes where neither name is clearly right. One
is region-against-region, which rank could not arbitrate either and settled by id.

**None of them is in the reference project**, whose eight collisions all resolve
to the label. So the golden hash is safe through the projection, and no
`Provenance` member and no 215 pinned `primaryLabels` entries are needed —
either of which would have baked a rule we are deliberately replacing into the
data. Pinned by a test, because it is a decision rather than an accident.

**2. `adapt.ts` is not the migration.** It says so — *"a translation rather than
a migration… Nothing writes back through it"* — and it does **not** auto-root
interpretation claims, which migration must do or a project loses every span
nothing references. Using it as the migration quietly reintroduces the loss this
document warns about two sections earlier.

**3. Id preservation is never stated, and everything depends on it.** A migration
that mints fresh ids dangles every `primaryLabels` entry, every `labelUses`
binding and every inverse in the `ops` history, and two peers migrating the same
file independently produce disjoint claim sets. Ids carry across verbatim, prefix
and all: `rgn_1jmk1o` becomes claim `rgn_1jmk1o`. `clm_` is only for claims minted
afterwards, and `isId`'s regex — hardcoded `/^(lbl|rgn|lay)_/` — needs it.

**4. `claim.set` cannot clear a field.** `Partial<Omit<Claim, "id">>` cannot
distinguish "not mentioned" from "clear this", and `applyClaimOp` skips
`undefined`. So `clear_root`, removing an extent and un-saying an interpretation
are all unexpressible — and the *inverse* of "set a root on a claim that had
none" cannot be written, which `runOps` requires on every write. Note `assign()`
in the same file uses the opposite convention, so two writers there would
disagree. Needs an explicit spelling.

The remaining five are smaller and three are already fixed:

- **`RootKind` was exported twice with different members** from one directory —
  `model.ts` (`entry|routine|location|data`) and `reach.ts` (`code|data`). The
  second is now `SeedKind`: a claim's `root` says what somebody *declared*, and
  a seed kind says what a walk *does* with it. **Fixed.**
- **`ClaimOp` lives behind the CRDT boundary** in `crdt/claims.ts`, and
  `boundary.test.ts` asserts `src/core/ops/**` never mentions yjs. The op
  vocabulary must move to `ops/types.ts`; only the encoding belongs where it is.
- **Region `comment` versus claim `description`.** `adapt.ts` maps one to the
  other, but `description` is documented as *what a name means on this machine*
  and is deliberately not a comment — while `rows.ts` renders a region's comment
  as comment rows at its start. There are 168 region comments across nine
  experiment projects and **none in Gridrunner**, so the golden test will not
  catch this. Either `Claim` keeps both fields, or migration makes real `Comment`
  objects.
- **Three sections appeared twice**, from a scripted insertion that ran against a
  matching anchor more than once. **Fixed.**
- **`src/core/claims/layout.ts` was cited by this document and by CLAUDE.md after
  being deleted.** `listing.ts` supersedes it. **Fixed.**

The general shape, since this document is now the fourth artifact here to be
caught by it: **a design written from a prototype describes what the prototype
does, not what the codebase requires.** Every one of the four blocking items is a
place where the prototype was free to be silent — it had no ranks to reconcile, no
ids to preserve, no inverses to compute — and the real thing is not.

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
- **Banking**, as above.
- **What a `bitmap` claim draws inside a second reading.** The layout below says
  which claim owns which bytes; what each one *renders* is still the row
  builder's business, and a marked alternate that is a picture has no established
  shape.

Answered since this was written: how a listing lays out two live interpretations
— see the section above. `narrowest()` is the right pick *per address*, and the
claims that lose are emitted after it, marked.

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
most valuable deletion: it is the worst instance of upsert-by-inference,
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

---

# Part two: types

*Reached by conversation on 2026-09-05, after the claims work landed. Nothing
here is built. It is written down because it was arrived at in one session and
would otherwise exist only there.*

## Why this stopped being optional

`zoneDataTable` is the case. 8,400 bytes, and what the reader actually
established was:

> 42 records of exactly 200 bytes, 152 bytes of template plus 8 scalars plus a
> 40-character name. **Verified** three ways — the banner lands on `+$A0` in all
> 42, the code does `ADC #$C8`, and the credits say "THE GAME CONSISTS OF FORTY
> TWO DIFFERENT ATTACK WAVES."

…with nineteen template fields per creature type, proved from the copy routine at
`sub_9772`. The model could hold **one field per record** — the name — and the
rest became a `data` blob with the finding living in prose.

The same binary carries three blocks of the author's own BASIC-assembler source,
stored as a genuine linked list: `[link lo][link hi][line# lo][line# hi] text
$00`. The identification was certain **because the links resolve** — a structural
invariant over the data, which a model that cannot express the structure cannot
express the proof of either.

So "handwritten assembler is too much of a mess for structs to matter" does not
survive the second real program.

## The machine argues for a layout C cannot name

The dominant array layout on a 6502 is **struct-of-arrays**, and it is forced
rather than chosen. From the reference project:

```
podLoPtrArray   / podHiPtrArray
droidXPositionArray / droidYPositionArray
explosionXPosArray  / explosionYPosArray
screenLineLoPtr / screenLineHiPtr
```

Two ISA facts do it: **there is no multiply**, and **the index register is 8
bits**. Array-of-structs indexing is `base + i × stride`, so any stride but 1
costs a shift-add sequence or a table. Struct-of-arrays makes the stride 1 for
every field, so the entity index *is* the addressing index:

```
b873D   LDA podScreenLoPtr
        STA podLoPtrArray,X      ; one index, X = pod slot
        LDA podScreenHiPtr
        STA podHiPtrArray,X      ; same index, other array
```

`podLoPtrArray`/`podHiPtrArray` is one 16-bit value whose two bytes live in
different arrays. C's model has array-of-structs as its natural case, cannot name
struct-of-arrays, and cannot represent a split value at all. **Adopting C syntax
would import defaults that are wrong for this machine.**

It also explains something already measured. A record stride of 200 cannot be
reached by `abs,X` at all, so the code must compute a pointer and use `($3E),Y` —
which is why "8400 bytes, 21% of the program, were invisible to every reference
tool". There is a real relationship here:

| layout | access | visible to static xrefs |
|---|---|---|
| stride 1 (split arrays) | `LDA field,X` | yes |
| stride > 1, or > 256 bytes | `($zp),Y` | no |

**A declared stride is the missing input that makes the invisible half
resolvable.** That is what makes this analysis rather than documentation.

## Where the boundary with decoders is

A decoder cannot do this, and the reason is the property that makes decoders
safe:

> A decoder is a pure function from bytes to **data** … a function that can only
> return numbers cannot inject anything.

A decoder over `podLoPtrArray`/`podHiPtrArray` produces 25 correct addresses that
**the analysis never sees as addresses**. No xrefs, no reachability, no operand
resolution. So:

> **Built in if the analysis must compute with it** — addresses it must follow,
> strides it must index by. **A decoder if the result is only ever looked at.**

| | | |
|---|---|---|
| split pointer array | produces addresses | built in |
| record stride | makes `($3E),Y` resolvable | built in |
| text, charsets, sprites | only ever looked at | claim fields, already there |
| RLE title screen | assembler logic | decoder |

**The sandbox does not need loosening for any of this**, and an earlier draft of
this conversation wrongly implied it did. Two rules are bundled in that sentence:
SES and no ambient authority is about what a decoder may *do*, and
`validateDecoded` is about what it may *produce*. Widening the return shape to a
**closed** structured vocabulary keeps the check as strong as it is — closed for
the same reason `src/core/ops/` is closed — and touches the sandbox not at all.

**And the better use of a decoder here is search, not decoding.** Sandboxed code
that scans 47K and proposes "42 records of 200 bytes, fields here and here" is
inferring structure, and its output should be *claims* carrying
`by: {author: "decoder:zoneRecords", source: "analysis", confidence: "inferred"}`.
Proposals are claims like any other — attributed, additive, rejectable in bulk by
author — which is the weak commitment this redesign wanted, now with a mechanical
author. The escape hatch stops being where unmodellable things go and becomes
where *finding instances* happens.

## The model

**Atomic types absorb the interpretation union rather than extending it.** Look
at what `Interpretation` already is:

| current | as a type |
|---|---|
| `data` | `u8[]` |
| `text` + `encoding` | `char(petscii)[]` |
| `jumptable` | `addr[]` |
| `bitmap` + `view` | `u8[]` **and a view** |

Three of four are types wearing enum clothing, and the fourth is the tell:
`bitmap` is `u8[]` plus a `view`, which the region already carried as a separate
field. So `bitmap` was never an interpretation — it is a rendering that got into
the interpretation slot for want of anywhere else, exactly as `code` was a root
that got into it. Two of six region kinds turn out to be other things.

The primitives, and they are few because the evidence is:

```
u8 | i8 | u16 | i16      the 16-bit ones carry the stride between their bytes
addr                     NOT u16 — an addr generates a reference
char(encoding)           the encoding claims already carry
T[n]                     fixed array
record                   named fields at offsets
```

**Endianness is the stride between the bytes, which unifies it with split
arrays.** They are the same question at different distances:

| | hi − lo |
|---|---|
| little-endian, contiguous | `+1` |
| big-endian, contiguous | `−1` |
| split arrays | `+N` |

The projection still prints `u16le`; "stride −1" is not what a reader wants to
see. Honest caveat: there is evidence for little-endian and for split, **none**
for big-endian on this machine — the value of the unification is that it makes
*split* first-class and big-endian falls out free. The one real big-endian case
known here is BASIC's 5-byte float, exponent first then mantissa MSB first.

`u16le` must mean what `lift.ts` already means by it, including the page-wrap
quirk where `JMP ($10FF)` takes its high byte from `$1000`. Two notions of "how
two bytes make a word" would drift.

## Where a type lives

A **new root**, `types`, beside `constants` and `decoders` — the same shape, not
the same table. A constant is `{id, name, value}`; a type is
`{id, name, size, fields}`. One map holding both means a discriminator and two
shapes behind one name, which is how `code` became a region kind.

The shape is borrowed because the justification is verbatim, now for the third
time:

> a way of reading bytes describes none of its own, so there is no layer for it
> to move with when the stack is reordered

| | declaration | use |
|---|---|---|
| constant | `{id, name, value}` at project level | `{id, address, constantId}` in the layer |
| decoder | `{id, name, source}` at project level | `view: "snippet:<id>"` on the region |
| **type** | `{id, name, size, fields}` at project level | `says: {is: "record", typeId}` on the claim |

**Fields are keyed by offset, and carry no ids.** This was the correction that
mattered, and it came from asking whether the identity rule's *justification*
transfers rather than whether the rule applies:

> An address cannot identify a label — several share one, and a rename changes
> the field you would key on.

Several fields **cannot** share an offset in a record. Without unions — for which
there is no evidence — the offset is unique by construction. So:

```
types/<typeId>            { name, size }
types/<typeId>/fields/12  { name: "lifetime", type: "u8" }
types/<typeId>/fields/13  { name: "nextType", type: "u8" }
```

Two agents adding different fields touch different keys, which is the whole merge
property ids were for, and "one field per offset" becomes structural rather than
checked. `Y.Map` is not ordered and does not need to be: **order is derived from
offset**, like the region tree and the equate block and the blocks.

It costs one race — renaming a field while somebody else moves it loses the
rename — which is narrow, last-writer-wins is defensible for it, and whether
fields get moved at all is the sort of thing to learn from a run.

**Size is stored, count is derived.** `Zone` is 200 bytes; the claim at `$6700`
has extent 8,400; 42 follows. Storing the count too would be a third fact that
can disagree with the other two, and an extent that is not a multiple of the size
becomes a hygiene finding — the same shape as `oddJumptable`.

## Holes are first class

A type that accounts for 60% of its own size is a placeholder in exactly the way
`zoneDataTable` was, and the same rule applies one level down:

> A claim should cover exactly what it explains. One covering bytes it does not
> explain is a placeholder, and a placeholder belongs in the gap list rather than
> over it.

So the field list shows what nothing explains:

```
+0C     lifetime     u8
+0D     ???          3 bytes nothing explains
+10     nextType     u8
```

Which is the same thing the listing does with gaps, for the same reason and with
the same meaning.

## Rendering

**A `TYPE` block at the head of a listing, derived and never stored**, holding
only the types actually used within the span — the rule `ConstantIndex.used()`
already follows, with the same consequence: a declared but unused type does not
appear, and `list_types` is how you see them all. Dependencies first, so
`Creature` precedes `Zone`.

Unlike an equate, a record definition is not real assembler on any 6502 assembler
of the period. ca65 and 64tass have `.struct` if assemblability ever matters;
re64's listing is a reading artifact, so this is a free choice.

**The header block is the small half.** The payoff is that a typed claim
structures the *rows*:

```
6700  ; Zone[0]  "CAREFUL WITH THAT AXE, EUGENE"
6700  ..            creatures[0]  type=$03 lifetime=$0C nextType=$FF
...
67A0  ..            name
67C8  ; Zone[1]  "RAINDROPS KEEP FALLING ON MY BEAST"
```

That is where the 80% comes back. It gives the row builder a fourth strategy
beside instruction, data and comment — **field rows**, one address per line like
everything else — and it is one more reason the type must be in the document
rather than in a decoder: `analyze()` walks it synchronously.

## The UI, which is the same argument one level down

Not a textarea holding JSON. That is the alternative this project already
rejected:

> Users never type assembler; they edit specific fields. **Rejected
> alternative:** holding generated text in an editor buffer and parsing edits
> back.

Field rows with a type picker, an offset, delete and add — the same shape as the
inline label editor.

**Offsets are entered; auto-fill is a default, not a derivation.** In C you
author a layout so offsets follow from order and sizes. Here you are *recording*
one: `nextType` is at `+12` because Jeff Minter put it there. Adding a `u8` after
`+12` should suggest `+13` and let you overwrite it, because real layouts have
padding and fields nobody has found yet. It also means **reordering is not an
operation** — you cannot reorder fields in a struct that already exists in
memory; you can correct an offset, which is a field edit. So offset stays the key
and the ordering problem never returns.

Two things that panel wants: **where the type is used** ("1 claim at `$6700`, 42
records" — the read that verifies the write), and **live repaint**, since
changing a field's type re-renders 42 records with no round trip. That is the
first thing since the arrow gutter that is genuinely better in a browser than
through a tool call.

## Deliberately out

- **Variable length and pointer-chasing.** The BASIC fragments need both, they
  are the only instance, and they are dev residue rather than game data. "Links
  resolve" is an *invariant over a structure* rather than a shape, and inventing
  a syntax for invariants off one example is how you get a mechanism per oddity.
- **Unions, enums, bitfields, alignment.** No evidence. Bitfields will feel
  obviously necessary because C64 code tests flags with `AND #$10` constantly, and
  there is not one instance in what has been examined of a *declared* bitfield
  being the thing that was lost — the value analysis already tracks bits with
  nobody declaring anything.

**Enums are the one place types and constants would meet**, and worth recording
as the reason the two roots might one day join. `enum Colour { WHITE = 1 }` scopes
a value's name, which answers what the constant design records as unanswerable:

> The same number carries two names in the same program, so there is no
> value-to-name map to be had and nothing infers one.

`LEFT_ZAPPER = $01` and `WHITE = $01` stop competing once each belongs to a
different enum, because the use site says which. No evidence yet, and the current
refusal to guess is working.

## Split arrays: the one piece that does not land cleanly

The stride covers the *reading* — a claim at `podLoPtrArray` of `addr` with a
stride equal to the distance to `podHiPtrArray` — but it leaves the second array
with no claim of its own, when the reference project quite reasonably names it.
Either the hi array's claim is redundant, or a split is two claims plus a
relation, and this model has no relations. **Wants a second real instance before
being decided.**
