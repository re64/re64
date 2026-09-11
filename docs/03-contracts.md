# Contracts and invariants

Read the [manifest](01-purpose.md), then the [architecture](02-architecture.md).
The architecture defines the nouns; this document states the obligations
between them. The [operation algebra](06-algebra.md) supplies detailed edit
semantics. Historical explanations belong in [decisions/](decisions/README.md).

These are required properties, not a claim that all paths have been verified.
Test references identify verification points; `unpinned` means no automated
check is established here. Known gaps must be named rather than treated as
exceptions. In particular, session visibility remains #28 and the general
surface-nullability audit remains #29.

Keep the existing A–F identifiers stable so code and reviews can cite them.
New contracts should state their scope, the failure they prevent and how they
can be checked. Product requirements can establish a contract before a bug
occurs; editorial requirements below are examples.

## S. Synchronization, durability and reproducibility

**S1 · An operation keeps the meaning it had for its author.** Caller, session,
selected target and any resolved references belong to that operation's context.
A concurrent request must not replace them. A session's read/merge policy must
be explicit and consistent across reads, edits and undo; #28 tracks the current
gap. This does not choose automatic versus deferred receipt of others' edits.
*Origin:* R1 ([#21](https://github.com/re64/re64/pull/21)): caller identity was
a server-global closure reassigned per request, so overlapping requests could
record one user's claim under another user. [#28](https://github.com/re64/re64/issues/28)
found a second split: `document()` read the session replica while `program()`,
`load()` and `version()` read the room. [#35](https://github.com/re64/re64/pull/35)
proposes the session repair; it is not yet merged.
*Verification:* `server/mcp/transport.test.ts`, `core/claims/offline.test.ts`;
complete session consistency remains open.

**S2 · Local application, durable commit and delivery are distinct events.**
An offline edit can exist locally before the server persists it. A successful
durable-write receipt must describe committed work. A rolled-back write must
not remain the served state or be delivered as a committed update; a failing
subscriber must not turn a committed write into a reported failure.
*Origin:* R9 ([#25](https://github.com/re64/re64/pull/25)): `runOps` published
before commit, so rollback could not recall the update. Follow-up review found
that a listener throwing after commit reported a failed write, and that a
listener's own failed transaction could publish its rolled-back update.
*Verification:* `store/project-store.test.ts`, `server/write-paths.test.ts`.

**S3 · Equal replicated state has one canonical projection.** Arrival order,
locale and presentation preferences must not change serialized state used for
versions. Sequences whose order is part of the data retain that order. This is
independent of whether two participants agree with the interpretations stored.
*Origin:* R14 ([#16](https://github.com/re64/re64/pull/16)): `NaN - NaN` left
seven roots in insertion order. Choosing numeric or textual comparison per pair
then produced a cycle (`9 < $10 < $ZZ < 9`). Finally, `localeCompare` ordered
`fld_ä` and `fld_z` differently across locales and treated distinct composed and
decomposed Unicode ids as equal, preserving their arrival order.
*Verification:* `core/crdt/concurrency.test.ts`, `core/crdt/roundtrip.test.ts`.

**S4 · Undo reverses an action without inventing a conflict or hiding a real one.**
Action grouping and attribution must survive every write path. Undo and redo
preserve unrelated edits, report operations they skip and compare values rather
than incidental object-key order. They do not rewind the entire shared document.
*Origin:* R10 ([#19](https://github.com/re64/re64/pull/19)): socket history
paired forward and inverse operations by array index and lost session/action
grouping. R13 ([#17](https://github.com/re64/re64/pull/17)) also exposed undo
refusing unchanged provenance as another writer's edit: replay had only moved
an object key, but text comparison treated it as a conflict.
*Verification:* `store/project-store.test.ts`, `server/mcp/transport.test.ts`.

**S5 · Migration preserves identity, contributions and usable history.** A
stored snapshot needs migration just as an imported file does. Later operations
must be able to reference migrated entities after restart. Compatibility rules
for recorded operations must be explicit; a new shape cannot silently reinterpret
old undo history.
*Origin:* the field and binding repairs
([#23](https://github.com/re64/re64/pull/23),
[#24](https://github.com/re64/re64/pull/24)) initially migrated imported files
without migrating persisted database snapshots. Existing fields and bindings
therefore remained unreachable through the new operation shapes after restart.
Older history rows also failed under the new shapes; compatibility had to
preserve their original operation semantics, including child replacement.
*Verification:* `core/crdt/doc.test.ts`, `core/crdt/roundtrip.test.ts`,
`store/project-store.test.ts`.

**S6 · A byte reference and an execution key describe the bytes actually used.**
When a document records a content hash, a missing blob is missing content, not
permission to substitute the latest bytes with the same name. Cached analysis
and scenario checkpoints must account for their actual target, resources, ROMs
and rendering inputs. Changing an input must not preserve a stale passing check.
The immutable-reference design is still #27; a document version alone is not an
execution fingerprint.
*Origin:* R7 ([#20](https://github.com/re64/re64/pull/20)): replacing a ROM
changed the execution fingerprint while a reused workspace still ran its old
memory map. R8 ([#22](https://github.com/re64/re64/pull/22)): a missing recorded
blob fell through to a filename lookup, serving different bytes under the
recorded hash's ETag.
*Verification:* `store/blobs.test.ts`, `server/database-mode.test.ts`,
`server/building.test.ts`, `core/machine/scenario.test.ts`.

## P. Editorial and publication contracts

These obligations guide the planned editorial workflow. The HTML experiments
demonstrate the workflow but do not implement an article schema or publication
versioning system.

**P1 · A significant factual assertion has inspectable support.** Preserve the
source material, relevant interpretation and verification conditions needed to
assess it. Historical claims may need external sources. Editorial selection
must not turn a hypothesis into an established observation.
*Verification:* editorial review; automated traceability is not yet specified.

**P2 · Media says how it was made.** Distinguish captured behavior, decoded
source data, reconstructed output and illustration. Record material limitations
of the machine or rendering method where they affect what a reader may conclude.
*Origin:* [experiment 9's editorial notes](../experiments/09-editorial/run1/editorial-notes.md).
*Verification:* captions and editorial review; not automated.

**P3 · A published edition remains an identifiable account.** Later investigation
must not silently change the evidence a released article relies on. How to retain
the article, referenced resources and verification inputs together is unresolved;
it must be designed before a publication mechanism promises this guarantee.
*Verification:* planned; requires the publication/reference design.

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

**A2 · Entity creation adds; correcting an entity is by id.** Even the same name twice adds; two
claims are told apart by id.
Bindings have the separate replacement semantics defined in the operation algebra.
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
`y-websocket` in `src/client/doc-client.ts` only. That last one is what keeps the
transport replaceable.
*Pinned:* `core/crdt/boundary.test.ts`.

**A8 · Chat is project history, not a program change.** Messages travel in the
project projection and export. `programFromDoc` excludes them from the program
version; participation is also outside that version. Program undo excludes chat.
*Origin:* the earlier rule excluded chat from export too. The document now
preserves the conversation while distinguishing it from program knowledge.
*Pinned:* `core/crdt/chat.test.ts`, `core/crdt/doc.ts` (`programFromDoc`).

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
supplying that byte owns a newly placed claim; without one, the current default
is address-space scope. Explicit target frames remain representable. See the
[model reference](05-model.md#4-claims-and-frames) for the coordinate shapes and
the open question of exposing explicit target framing to writers.
*Origin:* the only reachable power of a `scope:` argument is to bind a claim to a
layer that does not supply those bytes — the exact bug layer ownership prevents.
The former target fallback was superseded: names for unowned bytes such as
zero-page variables disappeared from other arrangements of the same program.
`placed` now uses address-space scope when there is no byte owner.
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

**D5 · For a clearable field, `null` clears; omitting it leaves the field alone.** The distinction
`Partial<>` cannot make, and without it a root could be declared and never taken off.
Required fields are not implicitly nullable. Structured replacement values such
as provenance follow the algebra's rules; a nested omission is not automatically
a partial edit. The remaining schema consistency audit is #29.
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

**D8 · Every write path leaves the same record.** Socket, HTTP, import/reconciliation and agent edits
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
**ten** instances: `meta.set` with no emitter; `layer.add` filtered to symbols;
`decoders` missing from `withIds`; `constants` missing from the undo whitelist; 382
platform `description`s reaching no consumer; `Provenance.confidence`, which
round-trips through five layers and is exposed by **no tool, no UI and no CLI**;
and then the same `layer.add` filter twice more — widened from symbols to `prg`
and `raw` and left stale under `rom`, so the machine view could be declared, run
against and reported, and vanished on export; and `bytes`, a layer kind the file
format always had and no operation could make.
The ninth is `unit` on a record type — carried by the operation, the diff and the
document schema, and dropped by the text serializer's hand-written key list, the
loader's hand-written field list, the CRDT's own `type.add`, and `list_types`.
Nothing failed: a bit record simply became a byte record on the next load, and
every offset in it silently meant something else.
The tenth is `EvidenceKind`: `refutes` was read by `disagreements()` and
`supports` and `supersedes` were read by **nothing**, having been written,
validated, stored, round-tripped and exposed by two tools. Now a `switch` with a
`never` default, so the next member cannot be added without deciding what reads
it — and the audit that forced the decision **removed** one rather than wiring
it up. `supersedes` stored an ordering, which a conflict-free merge cannot
supply, and duplicated `primaryLabels`, which answers the same question with a
single-valued key. *The lesson worth keeping: "what reads this" is a question
whose answer is sometimes "nothing should, and the member is wrong."*
*Note:* those are the instances that prove the shape is about *hand-written
lists*, not about new features. The fix is the one that could not go stale: the
diff now assigns `layer.type` to `LayerAddOp["layerType"]`, so the two
vocabularies are the same set or it does not compile.
*Pinned:* `core/crdt/roundtrip.test.ts` covers the ops — including a case per
layer kind through the diff — and
`server/mcp/api-doc.test.ts` covers the other half — it diffs what the document
persists on a claim against what a tool can write, asserting the orphaned set
*exactly*, so a seventh instance fails it and settling one fails it too. It found
`description` (deliberate: platform metadata, not a person's note) and
`confidence` (the real gap). Per **E10** the fix for `confidence` is not to wire
it up: it is on the wrong axis and should be replaced.

**F5 · A write's receipt must speak the caller's units.** A claim is stored as an
offset into the layer supplying its bytes, and `add_claim` at `$5199` answered
`name +$4998` — because the resolver rebuilt the memory map with a loader that
refuses to read files, and a `.prg` layer's load address is *in* its file, so it
threw on every real project and fell back to the offset. Every *read* surface
was correct. Only the confirmation a writer reads agreed with the mistake, and
that is how eighty claims imported one load address low survived three sessions
and an import. Found by the eleventh run's reviewer, not by anybody here.
*Pinned:* `server/building.test.ts` — a claim written at an address whose receipt
contains `+$` fails.

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
