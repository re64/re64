# Invariants

Properties that must hold, each with the bug that produced it and the thing that
pins it. **Read `docs/purpose.md` first** — that says what re64 is for; this says
what may not be broken while building it.

Why this file exists rather than another design document: `docs/decisions/redesign-claims.md`
was 1,206 lines describing a *target*, and planning it against the code found nine
corrections, four blocking. A document describing a target goes stale in weeks. A
property either holds or it does not, and a test says which.

**How to read the third column.** `unpinned` is not a defect — some of these are
stances rather than assertions. It is a *risk marker*: the `carrySites` paragraph
in `docs/decisions/analysis.md` names four sites where the code finds six, and it drifted precisely
because nothing pinned it. Every `unpinned` row is a candidate for the same.

**How to add one.** An invariant earns a row when breaking it produced a bug that
cost somebody real work. Not a preference, not a tidiness rule. Say what the bug
was, or leave it out.

---

## A. Identity and merge

**A1 · An address cannot identify a claim.** Several claims cover any interesting
address, and that is the design — `$08` is a scratch byte in most of a program and
something specific in one routine, and both are true.
*Origin:* `set_label` was an upsert keyed by address and destroyed 123 names across
74 addresses in experiment 7, telling neither writer nor loser. `set_comment` was
the same shape keyed by slot, found in experiment 3. Both were justified for a
single author and never revisited when a second arrived.
*Pinned:* `core/claims/offline.test.ts` — "revising a span requires saying which one, by id".

**A2 · Every write adds. Correcting is by id.** Even the same name twice adds; two
claims are told apart by id.
*Origin:* the same two bugs as A1. `add_claim` with a `root` was still reusing an
existing id in experiment 8, under a tool whose description promised it never replaces.
*Pinned:* `core/claims/offline.test.ts` — "declaring a span adds, whatever the writer had seen".

**A3 · What works offline must also work online, and the reverse.** There is no
second mode. An operation whose correctness depends on having seen what everybody
else did fails the first direction; one that assumes it is alone fails the second.
*Origin:* found a bug within a minute of being written down — naming a byteless
address wrote every target's whole layer list, so two people doing it at once
dropped each other's layers.
*Pinned:* `core/claims/offline.test.ts` (the file exists for this).

**A4 · Every entity gets a stable id at creation; a file without one stays loadable.**
The loader derives ids from content so every client agrees, and the next write
persists real ones.
*Origin:* an address cannot key a rename, and a region's start moves, so "extend
this" and "delete plus create" were indistinguishable.
*Pinned:* `core/project/identity.test.ts`; `core/crdt/roundtrip.test.ts` — "covers the whole vocabulary".

**A5 · Convergence is not atomicity.** A Yjs transaction is local batching, not a
distributed transaction. Grouping is a **record of intent** and can never be a
guarantee about state.
*Origin:* three renames from one peer interleaved with one from another converge
to a state where the group is partly superseded and nothing remembers there was a
group. Grouped undo is therefore partial and reported.
*Pinned:* `core/crdt/concurrency.test.ts` — eight assertions including "converges even when they sync in a chain".

**A6 · A dangling reference renders the fallback and heals if the target returns.**
True of constants, types, `primaryLabels` entries, target links, and claims framed
on a removed layer. Deletion needs no sweep; a delete racing a bind self-heals.
*Origin:* adopted as a rule after `primaryLabels`, then applied five more times.
*Pinned:* five of the six cases, in four files — `core/memory/type.test.ts`,
`core/memory/primary-label.test.ts` ("falls back to rank when the promoted label
is gone"), `core/project/links.test.ts`, `server/building.test.ts`, and
`server/mcp/transport.test.ts` ("leaves a claim readable when the layout it names
is taken away").

**A7 · The domain never sees a CRDT type.** `yjs` in `src/core/crdt` only;
`y-websocket` in `src/ui/doc-client.ts` only. That last one is what keeps the
transport replaceable.
*Pinned:* `core/crdt/boundary.test.ts`.

**A8 · Chat never reaches the project, the export, or the version hash.** A message
describes no bytes and belongs in no `.re64`.
*Origin:* nothing was written to exclude it — it holds by omission, which is
exactly why it needs a test. The first symptom would be somebody's conversation in
a file they handed to someone else.
*Pinned:* `core/crdt/chat.test.ts` — "does not reach the project", "leaves the projection identical".

**A9 · Every operation round-trips seven ways.** Applied to the document, carried
by `projectFromDoc`, survives the export, emitted by the diff, inverts to where it
started, taken back by undo, and its id minted when the file omits one.
*Origin:* six sites in this codebase fail *silently green* — an op accepted that
writes nothing, a root missing from a whitelist, an op nothing emits.
*Pinned:* `core/crdt/roundtrip.test.ts` — all six assertions.

---

## B. What a claim may say

**B1 · There is no `code` interpretation and no `unknown`.** Code is what bytes are
when nobody has said otherwise, so a claim never says it — "decode from here" is a
`root`. Not saying is how you do not say.
*Origin:* `RegionKind` conflated three things and had one compile-time guard with
nine silent sites; the runtime whitelist meant a missing case looked like a broken
tool.
*Pinned:* the compiler — `rowStrategy`'s `never` in `core/view/rows.ts`.

**B2 · Nothing resolves at rest.** Which name an operand shows, which reading a row
uses, what nests inside what — derived when something asks. `disagreements()`
reports contradiction and never picks a winner.
*Pinned:* `core/claims/offline.test.ts` — "claims keep both, and the disagreement is the output".

**B3 · A claim about bytes cannot stop control flow.** Only the program outranks a
claim: a decoded transfer beats a declaration, a declaration does not.
*Origin:* a region overran a routine entry by two bytes, `shouldDisassemble`
refused the address, and 32 instructions were lost for months behind a label
sitting two bytes late. The revert that caused it recorded a *wrong reason*, which
is what hid it.
*Pinned:* `golden.test.ts`; `core/claims/survey.test.ts` — "exactly one contested address, and it is $8D16".

**B4 · Every name that appears identifies exactly one claim.** A name reaching two
addresses is qualified on *all* holders, symmetrically — there is no winner to elect.
*Origin:* `scoreDigits` at two addresses rendered bare at both, so `scoreDigits+4`
meant different addresses depending on which you read it through. Both neutral
readers in experiment 3 hit it; one called it "a wrong answer that looks right".
*Pinned:* `server/workspace.test.ts` — "reports a name that points at two
addresses, and qualifies it in operands", which asserts both the hygiene finding
and the qualified rows. *This entry said "unpinned, highest-value gap" until it
was checked; it was pinned all along. A claim about coverage is worth exactly as
much as the grep behind it.*

**B5 · Every reading of contested bytes is kept and shown.** A byte that is an
operand on one path and an opcode on another gets both, emitted in start order with
the later marked. Which is "primary" is not a question — it means "reached first in
address order".
*Pinned:* `core/analysis/blocks.test.ts` — "keeps the second reading as its own stream", "does not call a main-decode block an alternate".

**B6 · Scope is derived, never chosen.** The topmost layer in the current target
supplying that byte, else the target. Total, so no write can fail on it.
*Origin:* the only reachable power of a `scope:` argument is to bind a claim to a
layer that does not supply those bytes — the exact bug layer ownership prevents.
*Pinned:* `server/mcp/transport.test.ts` — "says what a claim belongs to, without being asked to choose".

**B7 · Claims are stored relative to their layer; offsets never cross the wire.**
Absolute is `link.loadAddress + at`. Every tool stays absolute.
*Origin:* storing absolute against a default load address makes every claim's
meaning depend on a field on another object — one edit silently reindexes a whole
body of annotation, with no conflict and nothing reported.
*Pinned:* `core/claims/offline.test.ts` — "a claim written offline about an address no layer supplies still lands".

---

## C. The machine and its analyses

**C1 · The arithmetic is tested by running it, never by reading references.** Ghidra's
`6502.slaspec` and panopticon's `semantic.rs` are *both* wrong about `ADC`, and
wrong differently — so porting one and checking against the other would have
produced a wrong lifter whichever won.
*Pinned:* `core/il/functional.test.ts` — "runs the whole suite to its success
marker", all 45 groups; `core/il/known-bits.test.ts` — "gets signed overflow right
where both references get it wrong".

**C2 · Control enters a block only at its start, never in the middle.** Split at
every jump and branch target, after every branch, and after every call — a `JSR`
ends a block.
*Origin:* this is what lets an analysis treat a block as one transfer function, and
it is why `stackDelta` can be computed exactly. Caught a real bug when first
written: a `JMP` to the next address had its target discarded by a fall-through filter.
*Pinned:* `core/analysis/blocks.test.ts` — "lets control enter a block only at its start, on a real program".

**C3 · The abstract domain never claims a bit it does not hold.** Checked
exhaustively over every pair of one-byte patterns against every concretisation.
*Pinned:* `core/il/known-bits.test.ts` — "is exhaustively sound for the bitwise operations", "never claims a bit it does not hold".

**C4 · May, never must.** A union over reachable code is always answerable; an
intersection over paths often is not, and a "must" that is quietly sometimes a
"may" is worse than not offering one.
*Pinned:* unpinned as a property; the scopes are pinned individually in
`server/mcp/transport.test.ts` — "takes every value of follow, and defaults to calls".

**C5 · A check that cannot see something must say so, not skip it.** A silent skip
is indistinguishable from a proof at the point of use.
*Origin:* `canTouch` did `if (!block) continue`, so five unseen KERNAL callees were
assumed to touch nothing and `D` sailed through them. It reported 19 of 19 proved
binary. It was not a proof, it was an omission that looked like one.
*Pinned:* `core/analysis/flags.test.ts` — "is unknown after a call it cannot see,
rather than proved", with its converse "is proved again once something says what
the callee touches", so the rule is not just "give up on every call".

**C6 · Preservation is proved by identity, never sampled.** A value carries an
identifier that survives only operations which provably *move* a bit, and is
dropped by anything that computes.
*Origin:* running routines with complementary seeds finds 142 of 202 preserving `D`
and is a **check, not a proof** — a routine doing `if C then D := 0` passes
complementary seeds while preserving nothing. It was built, then taken back out.
*Pinned:* `core/c64/kernal-effects.test.ts` (regenerates and compares when a ROM is present).

**C7 · Statically reachable is strictly smaller than executed, and the gap is not a
defect.** Three explanations are always live for a disagreement with a human
listing: the annotation is wrong, the decode is wrong, or the program does
something no walk can follow.
*Origin:* an earlier `flowIntoData` warning offered exactly two and was wrong.
*Pinned:* `golden.test.ts` — "warns about KERNAL calls, and about one real disagreement".

**C8 · Flat memory is right for a decruncher, for a stated reason — not by luck.**
Writes to `$A000-$BFFF` and `$E000-$FFFF` always reach RAM whatever is banked;
the exception is `$D000-$DFFF` with I/O banked in, which is *reported* rather than
emulated.
*Pinned:* `core/il/program.test.ts` — "reports hardware it touched, since it does not emulate any".

**C9 · Code the program wrote is still the program.** The run stops where nothing
supplied a byte *and nothing wrote one* — a loader relocates itself and jumps to
the copy.
*Origin:* the first rule stopped at `$0100` after 1,258 of the 1,768,853
instructions that matter, because Camels moves its decruncher onto the stack page.
*Pinned:* `core/il/program.test.ts` — "follows code the program wrote and jumped to".

**C10 · A generated file that is committed must be regenerable and compared.**
`kernal-effects.ts` and `basic-effects.ts` ship while the ROMs never do.
*Origin:* a drift between the ROM and the table would surface as a wrong flag proof
somewhere else entirely, with nothing pointing back.
*Pinned:* `core/c64/kernal-effects.test.ts`, `core/c64/basic-effects.test.ts`.

---

## D. Surfaces

**D1 · A schema is not covered by testing what it calls.** `Workspace` was tested
thoroughly and network-free; the schema in front of it was tested by nothing, and
both `run_block` bugs shipped through a green suite. **If a tool grows an argument,
it grows a transport test.**
*Pinned:* `server/mcp/transport.test.ts` — 78 assertions, the only layer where this
class of bug exists.

**D1a · A handler that builds a `Workspace` passes the target.** A `Workspace`
*is* a view — constructed for a project **and** a target, which is why the target
reaches seventy methods without appearing in any of their signatures. So dropping
it does not fail; it answers correctly about the wrong program.
*Origin:* two tools shipped with it. `export_listing` returned the loader's bytes
whatever you asked for. `list_claims` reported **399** labels on a project holding
1,035 and one hand-made claim out of thirty-four — so the tool an agent uses to
ask "what has been named here" would have told the next run that a heavily
annotated project was nearly empty. Neither was reachable by testing what the
tools do: `Workspace` answers correctly for whatever view it is given, and the
defect is in the wiring.
*Pinned:* `server/mcp/target.test.ts` — reads the source and requires every
single-argument `workspace()` call to name a tool on an explicit list, each with
a written reason; plus `transport.test.ts` for the behaviour.

**D2 · No deprecation aliases, and retired names are asserted absent.** An MCP
surface is rediscovered from the schema each session and has no persisted callers.
*Pinned:* `server/mcp/transport.test.ts` — "refuses an argument it never declared".

**D3 · Every write returns the ids it made.** Two agents in one run made the same
decoder twice looking for an id `set_decoder` did not return.
*Pinned:* `server/mcp/transport.test.ts` — "adds rather than replaces, and hands back the id".

**D4 · One batch contract everywhere: apply what you can, report what you declined,
fail only when nothing was applicable.**
*Origin:* `bind_constants` rejected 167 good entries for one bad one, in both runs
that used it. `bind_constants` was made partial and `add_comments` was not, so two
batch tools disagreed about their own contract and a caller could not tell which
it would get.
*Pinned:* `server/mcp/transport.test.ts` — "declares several regions at once, and reports the ones it declined", "says several things at once and reports what it declined", "does not lose a whole batch to one comment on a byteless address".

**D5 · `null` clears a field; omitting it leaves the field alone.** The distinction
`Partial<>` cannot make, and without it a root could be declared and never taken off.
*Pinned:* `server/mcp/transport.test.ts` — "clears a field with null, which omitting it cannot say".

**D6 · Identity rides on a header, never in a tool schema.** A model can omit a
parameter, invent one, or claim to be someone else.
*Pinned:* `server/mcp/identity.test.ts`.

**D7 · An identity that matches nothing is kept, not swapped.** Three outcomes —
`user`, `claimed`, `anonymous` — and the source is stated rather than inferred.
*Origin:* `resolveCaller` ended in `?? known[0]`, so three agents announcing
themselves as `reader-1/2/3` were every one recorded as the first row of the users
table. Had that table listed `you` first, every agent edit would have been
attributed to the person watching.
*Pinned:* `server/mcp/identity.test.ts` — "believes a claim it does not recognise, rather than picking somebody else", "keeps two strangers apart".

**D8 · Every write path leaves the same record.** Socket, HTTP, CLI and agent edits
all reach `ops`, or `changes_since` would be blind to precisely what an agent most
needs to see. The log is append-only, or a held cursor silently changes meaning.
*Pinned:* `server/write-paths.test.ts` — "converges and records every author".

**D9 · Every consumer renders the same rows.** Wrapping, the arrow gutter, field
rows and bitmap art are in the **row model**, not in the view — a plain-text
consumer cannot soft-wrap a listing into something readable.
*Note (2026-09-07):* the CLI was removed, so the original wording — "a terminal
cannot soft-wrap" — no longer names a live consumer. The invariant stands because
`export_listing` is still a plain-text surface with the same constraint, but the
justification now has **one witness rather than two**. Anyone tempted to move
wrapping into the view should read this row first.
*Origin:* a soft-wrap toggle accreted a compartment, a hanging indent, a
dimmed-when-idle affordance and a `requestAnimationFrame` measurement purely to
stop looking broken. Machinery accreting to make a feature *appear* to work is the
signal it is in the wrong layer.
*Pinned:* `core/view/rows.test.ts`, `core/view/arrows.test.ts`; `ui/bundle.test.ts` — "carries no server".

**D10 · A pure function from bytes to data is the whole safety story for code
somebody else wrote.** A decoder never returns a picture or markup. SES removes the
authority; a worker thread supplies termination, which SES cannot.
*Pinned:* `sandbox/run.test.ts`.

---

## E. Honesty

**E1 · A confident wrong answer is worse than a gap.** The single most-invoked rule
here, and it decides cases that look unrelated: no statistical guessing about what a
span *is*; graphics coverage in the text encodings is deliberately partial and
renders `·` rather than a wrong glyph; `N` and `V` after a decimal `ADC` stay binary
and say so.
*Pinned:* per-instance. `core/c64/text.test.ts`, `core/il/bcd.test.ts`.

**E2 · Name the observation; let the caller bring the knowledge.** An observation is
a **kind**, not a sentence — `DisassemblyWarning`, `HygieneFinding`,
`ReturnBehaviour`, `EffectGap`. Naming costs nothing and un-naming is expensive.
*Origin:* `EffectGap` was `string[]`, so an agent that knew perfectly well what
`$F1CA` does could not say "ignore that gap" without parsing English.
*Pinned:* the compiler.

**E3 · A fact about the program and an admission about the pass must never share a
name.** `skipsFrames: 0` meant both "resets the stack" and "the analysis cannot
tell", and a cut keyed on it threw away whole routine bodies — SCNKEY reported
touching nothing at all. Now `abandons` / `skips` / `ambiguous`, and only
`abandons` cuts.
*Pinned:* `core/analysis/routines.test.ts`.

**E4 · A warning that offers explanations it has not checked will be believed.**
*Origin:* the `flowIntoData` text offered three causes and named no evidence, when
the evidence — one `JMP` — was in the xref index the whole time. It read as an
unknowable three-way ambiguity for months.
*Pinned:* unpinned as a property; individual warnings are pinned in `golden.test.ts`.

**E5 · Zero is the resting state for hygiene.** A check that fires on a healthy
project is not a check — a list that always has entries gets ignored, and the one
entry that mattered gets ignored with it. `find_undecoded` counts *incompleteness*
and belongs nowhere near hygiene.
*Origin:* a first version counted labels rather than addresses and reported ten
findings on a project with nothing wrong with it.
*Pinned:* `core/analysis/type-hygiene.test.ts` — "says nothing about a project that declares no types".

**E6 · Report at the coarsest unit that explains the finding.** Got wrong three
times in one evening — per address instead of per overlap (1,832 findings instead
of 46), per instruction instead of per run, per nested claim instead of per outermost.
*Pinned:* `core/claims/survey.test.ts`.

**E7 · A write path whose only failure channel is stderr has no failure channel.**
The export failed silently for a quarter of experiment 4's run while every tool
answered `ok`. Nothing downstream could distinguish "saved" from "silently not
saved", and no test could either, because every layer in isolation behaved correctly.
*Pinned:* `store/external-edits.test.ts`, `server/write-paths.test.ts`.

**E8 · Every value says where it came from.** `given` is as good as the caller,
`image` is usually false of anything initialised at runtime, `unknown` read as zero
and zero produces a real-looking result. A result that rests on assumptions says so.
*Pinned:* `server/mcp/transport.test.ts` — "says which values it had to assume".

**E10 · Agreement is evidence only when the methods differ.** Two accounts
reaching the same conclusion by the same method is one conclusion, not two, and
recording it as corroboration makes it look *more* verified rather than less.
*Origin:* experiment-0. Both agents concluded glyphs `$03`/`$04` were never drawn;
both were wrong, and the refutation was sitting in one of their own screen dumps
labelled `# unused`. B named the cause exactly — *"two independent analysts, the
same static-reasoning method, the same blind spot, mutually reinforcing"* — and the
consequence for the model: what a claim must record is **method**, not confidence,
because a strength score cannot distinguish an independent confirmation from a
correlated one.
*Pinned:* `core/analysis/hygiene.ts` — `label.duplicated` now says whether the
methods differ, so two claims agreeing reads as *"one account written down twice"*
or *"reached two different ways, so they do corroborate"*; and `claims_at` reports
`method` so a reader can tell. `Provenance.method` replaced `confidence`, which
was the strength axis and could not distinguish an independent confirmation from
a correlated one.

**E9 · Suppress no work to make an account tidy.** A merge reports contradiction; a
migration never deletes somebody's claims to make a layout fit.
*Pinned:* `core/analysis/type-hygiene.test.ts` — "reports the 42 claims the layout now also describes, and removes none".

---

## F. Process

**F1 · The vocabulary being closed is checked by the compiler. Whether anything
*emits* or *reads* a member of it is not.** This file's most repeated failure, now
**six** instances: `meta.set` with no emitter; `layer.add` filtered to symbols;
`decoders` missing from `withIds`; `constants` missing from the undo whitelist; 382
platform `description`s reaching no consumer; and `Provenance.confidence`, which
round-trips through five layers and is exposed by **no tool, no UI and no CLI**.
*Pinned:* `core/crdt/roundtrip.test.ts` covers the ops, and
`server/mcp/api-doc.test.ts` covers the other half — it diffs what the document
persists on a claim against what a tool can write, asserting the orphaned set
*exactly*, so a seventh instance fails it and settling one fails it too. It found
`description` (deliberate: platform metadata, not a person's note) and
`confidence` (the real gap). Per **E10** the fix for `confidence` is not to wire
it up: it is on the wrong axis and should be replaced.

**F2 · Where a report and the request log disagree, the log wins.** An agent is an
unreliable narrator of its own difficulty: it invents a tool name and then describes
the invention as a gap, and works silently around whatever actually hurt.
*Origin:* `changes_at` was built on a sentence in a report — *"the write side is
complete and the who-else-touched-this side is not"* — and removed an hour later
when the log showed neither reader had checked before writing.
*Pinned:* unpinned; `npm run experiments:collisions` is the measurement.

**F3 · An agent inventing a narrow tool means the *general* one is missing
something.** `find_hardware_access` was invented because `find_instructions` could
not see indirect writes. The finding is the gap in the general tool, not a licence
for the narrow one.
*Pinned:* unpinned — a reading rule.

**F4 · Only fix what blocks the next experiment — but a reproduced bug is not a
wish.** The rule protects against chasing every wish; a bug that has been reproduced
and located is not one. Reading it the other way cost a whole round: both of
experiment 5's builders lost a full rebuild to the same wrong `wrote` list.
*Pinned:* unpinned — a scheduling rule.

---

## The unpinned list, ranked

Re-audited 2026-09-07, and again after the evidence model landed — **E10 is now
pinned**, and `confidence` is gone from the known-gaps list because `method`
replaced it and `add_claim` takes it. The audit was worth more than the writing: **two
entries were pinned all along** (B4, A6) and had been marked as gaps on a
too-quick reading, while two real ones have since been closed (C5, F1's
structural half) and one more since (**E10**). What remains:

1. **C4** — may, never must. Pinned per-scope in the transport test; the property
   itself is a stance about what an answer means rather than an assertion.
2. **E4, F2, F3, F4** — stances, recorded as unpinned on purpose. They are read
   by people, not by CI: how to write a warning, how to read an experiment log,
   what an invented tool name means, and when a wish is not a bug.

The lesson from the audit, worth keeping: **a claim about coverage is worth
exactly as much as the grep behind it.** Four of thirteen entries were wrong in
the first pass, all in the direction of overstating the gap.
