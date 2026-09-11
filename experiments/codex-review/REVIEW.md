# Document model and MCP review — 2026-09-09

## Follow-up review — 2026-09-10

The initial follow-up reviewed `main` at `29c9b29`, the ten repair pull requests
[#16](https://github.com/re64/re64/pull/16) through
[#25](https://github.com/re64/re64/pull/25), and the larger follow-up designs in
[#26](https://github.com/re64/re64/issues/26) and
[#27](https://github.com/re64/re64/issues/27). The original findings below are
retained as the baseline; this section supersedes their implementation status
and includes subsequent PR re-reviews through #25 at `1309dbb` and #22 at
`99523af`, #17 at `bbd2cca`, #16 at `f0fb9b7`, and #20 at `680c1f0`
(the latter re-reviewed on 2026-09-11).

The original baseline had eight fixes: **R1, R2, R5, R6, R10, R11, R12 and
R15**. R4's site-keying repair has since merged in PR #24 at `8d880c4`; its
coordinate follow-up remains #26. R3's repair was approved at `b57907d` and
merged in PR #23 at `7e7015c`. R9's commit/publication repair was approved
in PR #25 at `1309dbb` and merged at `fe91b72`. R8's read-path repair was
approved in PR #22 at `99523af` and merged at `4b59b58`; its file-reference
design remains #27.
R13's provenance repair was approved in PR #17 at `bbd2cca` and merged at
`b40f642`. R14's ordering repair was approved in PR #16 at `f0fb9b7` and
merged at `e9fe636`.
R7's scenario-cache repair was approved in PR #20 at `680c1f0`. All ten
original repair PRs are now approved or merged; the separate design and
follow-up issues remain open work.
The review also found one P1 regression in the new
session-replica design, tracked as
[#28](https://github.com/re64/re64/issues/28).

| Finding | Current disposition | Review result |
|---|---|---|
| R1 | [PR #21](https://github.com/re64/re64/pull/21), merged | **Resolved.** Caller, session, tool context and logging are captured per request before the body await. |
| R2 | merged on `main` | **Resolved.** `claim.set` now touches only the named keys and keeps structured groups atomic. |
| R3 | [PR #23](https://github.com/re64/re64/pull/23), merged at `7e7015c` | **Resolved.** Field identity, persisted migration, colliding-field preservation and legacy undo/redo semantics are verified. |
| R4 | [PR #24](https://github.com/re64/re64/pull/24), merged at `8d880c4` | **Site-keying repair merged.** Rebind undo, persisted-map migration, old undo/redo history and address normalization are verified. Coordinate/frame follow-up remains #26. |
| R5 | merged on `main` | **Resolved.** Target frames use stable target ids and are filtered at projection. |
| R6 | merged on `main` | **Resolved.** The name-based default was removed and target references use ids. |
| R7 | [PR #20](https://github.com/re64/re64/pull/20), approved at `680c1f0` | **Repair approved.** ROM changes rebuild cached maps, and execution keys use loaded ROM and character bytes; reused and fresh workspace verdicts agree. |
| R8 | [PR #22](https://github.com/re64/re64/pull/22), merged at `4b59b58` | **Read-path repair merged.** Recorded hashes govern normalized name lookups; missing content fails, conditional reads work, and import preserves existing file records. File-reference design remains #27. |
| R9 | [PR #25](https://github.com/re64/re64/pull/25), merged at `fe91b72` | **Resolved.** Rollback discards failed live state and queued updates; publication preserves committed notifications and isolates listener and reporter exceptions. |
| R10 | [PR #19](https://github.com/re64/re64/pull/19), merged | **Resolved.** Each inverse is derived against its own rolling pre-state and socket actions retain session and changeset grouping. |
| R11 | merged on `main` | **Resolved.** All accepted writes enter the feed and undo/redo append actions. |
| R12 | merged on `main` | **Resolved with R11.** Appended undo actions give redo an explicit order. |
| R13 | [PR #17](https://github.com/re64/re64/pull/17), merged at `b40f642` | **Resolved.** Provenance replacement, MCP method clears and undo/redo agree; canonical object-key comparison removes false conflicts while preserving real conflict protection. |
| R14 | [PR #16](https://github.com/re64/re64/pull/16), merged at `e9fe636` | **Resolved.** Root comparators and nested-field/export tie-breakers use deterministic ordering; mixed-name and cross-locale convergence probes pass, including after the rebase over #17. |
| R15 | [PR #18](https://github.com/re64/re64/pull/18), merged | **Resolved.** A shared whole-number parser rejects suffixes while preserving the advertised spellings. |

### What is now sound

The merged fixes preserve the original architecture while bringing several
storage contracts into line with it. Claim partial updates now have a genuinely
partial CRDT write set. A target frame names a stable entity and cannot leak into
another target. The changes feed is append-only across HTTP, socket, MCP and
undo/redo paths. Those are substantive model repairs rather than patches around
the probes.

The approved changes are similarly narrow and complete. PR #21 removes the
server-global identity closure from both execution and logging. PR #19 computes
socket inverses by walking the same intermediate states as `runOps`, and also
restores the action boundary the socket already knew. PR #18 accepts exactly the
three documented integer spellings across address, byte and flag inputs. Focused
validation passed for all three: 129 MCP transport tests for #21, 67 store tests
for #19, 131 MCP transport tests for #18, and typechecking on each branch.

### Repair branch follow-up

**R3 / PR #23 — approved at `b57907d` on 2026-09-10.** All previous blockers
are addressed. Legacy text fields receive deterministic ids, `type.set.fields`
is removed, and `Workspace.editField` checks actual offsets. The partial
`edit_type` API also addresses the original additional observation about
requiring a whole layout to rename a record. The store now persists migration
of old CRDT field maps, and the list-shaped `type.add` preserves colliding
fields during reconciliation and restoration. Independent probes verify the
previous failures are fixed, including edits/removals surviving reopening.

The compatibility reader added at `7149cd4` also fixes old type-add/remove
history and child-rename undo/redo. Independent real-database upgrade probes
confirm those fixes.

The final compatibility repair preserves legacy child replacement semantics,
including removal of omitted descriptions. Real-database upgrade probes now pass
absent → set → undo → redo and set → clear → undo → redo, including state after
reopening. Current `field.set` remains partial. Canonical field-key ordering in
exports prevents unchanged replays from being rejected by the store's text
comparison; the golden listing remains unchanged. The latest GitHub review
approves this head and supersedes all previous change requests. PR #23
subsequently merged at `7e7015c`.

**R4 / PR #24 — approved at `47371ac` on 2026-09-10.** All previous blockers
are addressed. The inverse restores the previous binding by layer and address.
Persisted use maps migrate to site keys, keeping the greatest use id where a
legacy site has duplicates under the stated policy. The migration is persisted
and idempotent. Old unbind operations/inverses without an address resolve by
their historical use id. Text writers compare parsed addresses and replace or
clear all entries at a requested site while preserving the narrower scope of
old id-only unbinds.

Independent probes using snapshots and real databases produced by current
`main` pass for both constants and labels: migration, rebind/undo/redo/unbind,
old bind and unbind history, numeric/hex spellings, neighbouring-site preservation,
and reopening. The latest GitHub review approves this head and supersedes the
previous change requests. PR #24 subsequently merged at `8d880c4`.
The coordinate/frame design remains #26.

PR #23 at `b57907d` is rebased over the merged #24. Both migration bodies are
retained under one `migrateDoc` export and store hook; both independent upgrade
probe sets pass on that combined head.

**R7 / PR #20 — approved at `680c1f0` on 2026-09-11.** The stale-map failure
reproduced at `0b8f8cc` is fixed. ROM content participates in the workspace cache
key so a replaced ROM rebuilds the loaded map, and execution fingerprints use
the ROM bytes in that map and the supplied character image.

The independent synthetic-KERNAL probe now changes the assertion from passing
to failing in the reused workspace, matching fresh workspaces with shared or
fresh checkpoint caches. Restoring the original ROM restores the passing
verdict. A retained map's execution key stays unchanged when only the disk
changes, while changing the supplied character bytes changes the key. The
earlier two repair commits are unchanged by the rebase onto `e9fe636`.

**R8 / PR #22 — approved at `99523af` on 2026-09-10.** All three failures
reproduced at `06be7dd` are fixed. Import adds layer-blob records while preserving
existing non-layer records and their hashes. A shared lookup normalizes both
recorded and requested names for HTTP and the workspace byte loader. Independent
probes verify aliases on either side, including import of an existing aliased
record. Missing recorded content remains an error: HTTP returns 404 without a
false ETag, including for conditional requests carrying the unavailable hash.

The ordinary upload-before-record and matching-ETag probes still pass. The
name-table fallback also continues to serve uploads without a document record.

The file-id and compound-selector design remains #27.

**R9 / PR #25 — approved at `1309dbb` on 2026-09-10.** The two failures
reproduced at `d69bea6` are fixed. Transaction execution and notification delivery
now have separate flags. A listener's failed transaction discards only its own
queued updates and drops the live document for reconstruction from committed
storage. Independent fault injection confirms agreement between live state,
a receiving replica and a fresh store. A successful listener write queued before
a second, failed write is still delivered, and subsequent writes work normally.

Listener exceptions and a throwing `onPublishError` are isolated from the
successful caller and from other listeners. Both earlier failure probes now
pass. The initial test-file syntax error was already corrected at `d69bea6`.
The non-blocking documentation correction was included before merge: nested
writes join the outer SQLite transaction rather than creating a savepoint.
PR #25 subsequently merged at `fe91b72`.

**R13 / PR #17 — approved at `bbd2cca` on 2026-09-10.** The false undo/redo
conflicts reproduced at `c0cfd43` are fixed. The store compares state with sorted
object keys while preserving array order, and the writer emits evidence keys in
a stable order. Independent full-clear, author-only replacement and omitted-field
probes pass through both adapters and durable undo/redo. MCP method set/clear and
clear-undo preserve author, timestamp and unrelated fields.

The broader conflict comparison still refuses undo when another writer changes
the provenance, while allowing undo to preserve an unrelated note edit. The
earlier two repair commits are unchanged by the rebase onto `4b59b58`. The
session-replica defect in #28 and wider schema-nullability audit in #29 remain
separate follow-ups. PR #17 subsequently merged at `b40f642`.

**R14 / PR #16 — approved at `f0fb9b7` on 2026-09-10.** Per-root comparator
selection fixes the numeric/text cycle, and code-unit root tie-breakers and
primary-label key sorting pass. Correction to the earlier review example:
`parseInt("2x")` returns 2, so `10 / 2x / 3` did not demonstrate the cycle.
The valid former cycle is `9 / $10 / $ZZ`, as the author correctly pointed out.

The nested-field failure reproduced at `cee9843` is now fixed too. Document
construction, field tie-breakers and export tie-breakers use code-unit ordering.
The same saved snapshot projects `fld_z` before `fld_ä` under both `en-US` and
`sv-SE`, with identical export hashes. The distinct IDs `fld_\u00e9` and
`fld_e\u0301` survive and project/export in the same order after peers exchange
updates. The earlier root-order probes still pass. The rebase over #17 arrived
while the initial approval was being posted; the combined head `f0fb9b7` was
then independently verified. It preserves both branches' serializer changes,
and the ordering and provenance undo/redo probes pass together. PR #16
subsequently merged at `e9fe636`.

### Follow-up design review

[#26](https://github.com/re64/re64/issues/26) correctly makes an operand binding
layer-relative by default, with a target frame for arrangement-specific meaning.
The migration must convert coordinates, not merely add a default frame: an
existing absolute use at `$8123` in a layer beginning at `$8000` becomes offset
`$0123`. A framed site key also includes frame identity; a layer offset and a
target address with the same number are not one site. Keeping target-framed uses
nested under a layer deserves scrutiny because the parent would no longer own
their coordinate or visibility.

[#27](https://github.com/re64/re64/issues/27) is the right completion of R8: a
file is an immutable content entity keyed by id, while names remain local aliases.
The CRDT files root must move from name keys to id keys as part of that change.
A layer path is sometimes a compound selector such as `disk.d64:ENTRY`, so the
model needs a file id plus a separate member/selector; migration cannot replace
the whole path with an id. Hash- or id-addressed blob URLs then make immutable
caching true and remove mutable-name fallback from established document reads.

### New finding · R16 / #28 · P1 — A session has two read documents and misses its own undo

The session-replica restructuring intends every MCP read to stay stable until an
explicit merge. `Workspace.document()` reads the replica, but `program()`,
`load()`, cache keying and `version()` still read the shared room store. Another
session's unmerged claim, comment, layer or byte edit is therefore immediately
visible through view-bound tools while document-level tools retain the old state;
the reported version can identify neither answer consistently.

Own writes are also applied twice as semantic operations: once to the shared
document and independently to the replica. Those create different CRDT items.
Undo tombstones the shared item and `Workspace.undo()` sends no update to the
replica, so the initiating session can see its supposedly undone value through
document reads while view reads show it gone.

**Fix:** make document reads, view construction, cache keys and response versions
derive from one selected read document. Capture the shared document's state
vector before a session write and apply the exact resulting Yjs delta to its
replica; do the same for its undo. Explicit merge remains the only operation
that imports other sessions. [Issue #28](https://github.com/re64/re64/issues/28)
contains the required two-session transport cases.

### Follow-up validation

- Initial `main` baseline (`29c9b29`): `npm test` — **1,721 passed, five skipped** across 102 passing
  test files and one skipped file; `npm run typecheck`, `npm run build`, and
  `npm run build:ui` passed.
- The original model/storage and transport probes were re-run before the three
  approved branches landed. They confirmed the five fixes already on that
  baseline and reproduced the other ten original findings; the transport server
  used OS-assigned loopback port **53202** and was stopped. Focused branch tests
  covered R1, R10 and R15 before merge.
- Approved PR branches: the focused suites and typechecks listed above passed in
  detached worktrees.
- PR #23 re-review at `82ae789`: **1,730 passed, five skipped** after copying the
  existing local experiment fixtures and ROMs into its detached worktree;
  typecheck, TypeScript build and UI build passed. Separate probes reproduced
  persisted-snapshot and colliding-field reconciliation/undo gaps, subsequently
  fixed at `ddb85d2`.
- PR #23 re-review at `ddb85d2`: **1,736 passed, five skipped**; typecheck,
  TypeScript build and UI build passed. The previous preservation probes now
  pass; real-database upgrade probes reproduced the history gap subsequently
  addressed at `7149cd4`.
- PR #23 re-review at `7149cd4`: **1,741 passed, five skipped**; typecheck,
  TypeScript build and UI build passed. Old type-add/remove and child-rename
  undo/redo probes pass; description replacement/clear probes expose the
  P2 subsequently fixed at `b57907d`.
- PR #23 approval at `b57907d`: **1,758 passed, five skipped**; typecheck,
  TypeScript build and UI build passed. Description undo/redo and all earlier
  field-preservation probes pass, as do the independent #24 binding upgrade
  probes on this rebased head. The golden listing passed unchanged.
- PR #24 re-review at `6d64b13`: **1,728 passed, five skipped** with the same
  local fixtures in a separate worktree; typecheck, TypeScript build and UI build
  passed. Separate probes verified rebind undo and reproduced the persisted-map,
  history-upgrade and address-spelling gaps, subsequently fixed at `47371ac`.
- PR #24 approval at `47371ac`: **1,735 passed, five skipped**; typecheck,
  TypeScript build and UI build passed. Independent upgrade, history and adapter
  probes passed for both constant and label bindings.
- PR #25 re-review at `d69bea6`: **1,761 passed, five skipped**; typecheck,
  TypeScript build and UI build passed on the identical source tree. The initial
  syntax error was fixed during the review. Independent fault-injection probes
  reproduce failed listener-write publication and error-reporter escape.
- PR #25 approval at `1309dbb`: **1,763 passed, five skipped**; typecheck,
  TypeScript build and UI build passed. Both earlier fault-injection probes pass,
  as does an additional check that rollback preserves previously committed queued
  notifications and subsequent writes. The golden listing passed unchanged.
- PR #22 re-review at `06be7dd`: **1,766 passed, five skipped**, with the same
  local ROM and experiment fixtures; typecheck, TypeScript build and UI build
  passed. The golden listing passed unchanged. Independent HTTP/loader/import
  probes verify the ordinary read and 304 fixes and reproduce import record loss,
  alias lookup bypass and missing-content fallback, subsequently fixed at
  `99523af`. HTTP probes used an OS-assigned port.
- PR #22 approval at `99523af`: **1,770 passed, five skipped**; typecheck,
  TypeScript build and UI build passed. The golden listing passed unchanged.
  All earlier independent probes pass, along with checks for existing aliased
  records, conditional requests for missing content and unrecorded uploads.
- PR #17 re-review at `c0cfd43`: **1,763 passed, five skipped**; typecheck,
  TypeScript build and UI build passed. The golden listing passed unchanged.
  Independent adapter and MCP probes verify method clears, author/timestamp
  preservation and omitted provenance; store and MCP undo/redo probes reproduce
  false conflicts from serialized property ordering, subsequently fixed at `bbd2cca`.
- PR #16 re-review at `cee9843`: **1,763 passed, five skipped**, including all
  5,040 mixed-name permutations; typecheck, TypeScript build and UI build passed.
  The golden listing passed unchanged. Independent root-order and exchanged-update
  probes pass; same-snapshot cross-locale and same-locale collation-tie probes
  reproduce differing nested field order, subsequently fixed at `7abf405`.
- PR #17 approval at `bbd2cca`: **1,776 passed, five skipped**; typecheck,
  TypeScript build and UI build passed. The golden listing passed unchanged.
  Independent adapter, store undo/redo and MCP clear-undo probes pass. Genuine
  conflicting provenance remains protected, and unrelated note edits survive undo.
- PR #16 approval at `7abf405`: **1,777 passed, five skipped**, including all
  5,040 mixed-name permutations; typecheck, TypeScript build and UI build passed.
  The golden listing passed unchanged. Independent cross-locale snapshot/export
  and synchronized-peer field-order probes pass, as do the earlier root probes.
- PR #16 rebase verification at `f0fb9b7`: **1,783 passed, five skipped**;
  typecheck, TypeScript build and UI build passed. Both the independent ordering
  probes and #17's adapter, store undo/redo, MCP clear and real-conflict protection
  probes pass on the combined head.
- PR #20 re-review at `0b8f8cc` on 2026-09-11: **1,763 passed, five skipped**;
  typecheck, TypeScript build and UI build passed. The golden listing passed
  unchanged. An independent synthetic-ROM probe reproduces disagreement between
  reused and fresh workspaces after ROM content changes. It used a temporary
  working directory without changing the host's ROM files or starting a server;
  the failure was subsequently fixed at `680c1f0`.
- PR #20 approval at `680c1f0` on 2026-09-11: **1,789 passed, five skipped**;
  typecheck, TypeScript build and UI build passed. The golden listing passed
  unchanged. Independent changed-ROM, restored-ROM and exact-input fingerprint
  probes pass; reused and fresh workspaces agree.
- GitHub review state: #16, #17, #18, #19, #21, #22, #23, #24 and #25 merged
  after approval; #20 is approved at `680c1f0`. No change requests remain on
  the ten original repair PRs.
- Design feedback was posted on #26 and #27; the new replica defect is #28.

The model has a sound organizing idea: preserve separate interpretations as claims, identify entities independently of their addresses, and derive analysis and presentation from a shared document. The implementation does not yet consistently preserve those semantics. I reproduced data loss under concurrent edits, incorrect caller attribution, incorrect target selection, false scenario results caused by caching, and divergence between recorded file content and the bytes actually served.

These are implementation findings against the current working tree, not objections to using Yjs. Several can occur sequentially, without concurrent clients.

## Scope and verification

Reviewed the working tree based on commit `e7c9b58b15666a16253437a2468c166ea0906f8f`, including the existing uncommitted MCP/workspace changes. Those changes and the existing asset edits were left intact. This review adds only this directory; generated build outputs were refreshed by the normal build commands.

Read the project brief, purpose, developer guide, invariants, algebra, model reference, and relevant decision history. Traced the model through operations, CRDT adapters, projection/loading, storage, synchronization, sessions, MCP schemas and handlers, and the browser client. Reviewed analysis and machine execution where their cache inputs and evidence outputs interact with the document. This was not an exhaustive CPU or UI audit.

Validation:

- `npm test`: **1,672 passed, five skipped**, across 102 passing test files and one skipped file. The golden listing test passed. The initial sandboxed attempt was stopped after socket-dependent hooks timed out; the successful run used unrestricted local sockets.
- `npm run typecheck`, `npm run build`, and `npm run build:ui`: passed.
- [reproduce.mjs](reproduce.mjs): 14 focused model/storage probes completed and asserted the defects described below.
- [transport.mjs](transport.mjs): three real HTTP/MCP probes completed. The test server used a temporary database and OS-assigned loopback port **64290**, and was shut down afterward. No Claude Code server or project database was used.

Run the probes from the repository root after building:

```sh
npm run build
node experiments/codex-review/reproduce.mjs
node experiments/codex-review/transport.mjs
```

The scripts deliberately assert **current defective behavior** so their results are reproducible. They are review evidence, not passing regression tests for the intended behavior, and are outside the normal `src/**/*.test.ts` suite. After fixing an issue, replace its assertions with the intended invariant in the appropriate production test suite.

Priorities below use **P1** for errors that can lose work, change its meaning, or give an incorrect substantive answer; **P2** for remaining correctness and API-contract defects. Each numbered finding was reproduced. Additional observations at the end are explicitly distinguished from those findings.

## Findings

### R1 · P1 — Overlapping MCP requests use another caller’s identity

Location: [server/index.ts:352](../../src/server/index.ts#L352), also the shared `callerFor` at line 204 and MCP context at line 291.

`callerFor` belongs to the server, is reassigned per request, and is then read later by the handler. There is an `await readBody(req)` between assignment and tool execution. Consequently, the closure for one request can be replaced by another while its body is arriving. Response logging also resolves the shared context later.

**Reproduction:** start Alice’s `add_claim` request but hold its body open; complete Bob’s `whoami`; finish Alice’s body. The claim and supporting evidence are recorded as **Bob**, under **Bob’s session**. Both requests supply explicit, distinct user and session headers.

This corrupts authorship and undo scope during normal overlap; it is independent of the deliberately unauthenticated identity design.

**Fix:** construct an immutable request context and pass it into the request’s server/transport registration. Keep that same captured identity for logging and presence. A request must never resolve its caller through server-global mutable state. Pin this with interleaved-body transport tests.

### R2 · P1 — Partial claim revisions overwrite unrelated concurrent edits

Location: [core/crdt/ops.ts:582](../../src/core/crdt/ops.ts#L582).

`claim.set` reads the entire claim, applies its partial patch, then writes **every encoded key** back into the Y.Map. Thus a change to `root` also reasserts the old `name`, `extent`, position, and other fields. The API is partial, but the CRDT write set is effectively the whole entity.

**Reproduction:** two peers start with `{name: "Original", root: "routine"}`. One renames it to `Renamed`; the other changes `root` to `location`. After exchanging updates, both converge on `{name: "Original", root: "location"}`. The rename is gone.

**Fix:** map each supplied patch field to its storage keys and touch only those keys. Define atomic groups for structured values such as interpretation and coordinate frame; clearing an interpretation’s dependent keys must not rewrite unrelated claim fields. Test both independent edits and concurrent interpretation/frame changes.

### R3 · P1 — Field storage loses partial edits and duplicates identities on moves

Location: [core/crdt/ops.ts:358](../../src/core/crdt/ops.ts#L358), and field construction in [core/crdt/doc.ts:244](../../src/core/crdt/doc.ts#L244).

A field is a plain object in a map keyed by offset. Changing a field property replaces the whole object; moving it deletes one key and inserts another. Giving the object an `id` does not make the storage identity-based.

**Reproductions:** concurrent rename and description edits lose the rename. Concurrent moves of `fld_a` from offset 0 to offsets 1 and 2 produce **two fields with the same ID**. `field.remove` then finds and removes only one; the supposedly removed entity remains in the document. Concurrent additions at the same offset also compete for one slot instead of preserving the separate entities.

**Fix:** store fields in a map keyed by field ID, with each field as a nested map and offset as a property. Derive the offset lookup and report collisions. This requires a persisted-schema migration. Parent `type.set` should not provide a second offset-based route that bypasses field identity.

### R4 · P1 — Binding again adds a competitor; unbinding does not clear the site

Location: [workspace.ts:4786](../../src/server/workspace.ts#L4786), batch equivalent at line 4838, [core/crdt/ops.ts:504](../../src/core/crdt/ops.ts#L504), and [workspace.ts:4872](../../src/server/workspace.ts#L4872).

The algebra describes an address-to-ID binding. The implementation mints a fresh use ID on every bind and stores uses under that ID. Projection sorts equal-address uses by ID; the loaded index then keeps the last use it sees. The selected value consequently depends on ID ordering, not on the later binding action.

**Reproduction:** bind `$8000` to `ONE`, then to `WHITE`, both representing `$01`. The document contains two uses for the site. Unbind `$8000`; one use remains and an operand name still resolves there. The second bind’s chance of becoming visible also depends on the randomly minted IDs.

The label-use path has the same storage shape.

**Fix:** implement the binding as a real position-keyed map. Use layer-relative site coordinates if the binding is meant to follow relocation. Migrate duplicate uses with an explicit resolution policy. Pin bind A → bind B → unbind, along with concurrent binds and bind/remove races.

### R5 · P1 — Target-framed claims are visible in unrelated targets

Location: [core/project/loader.ts:442](../../src/core/project/loader.ts#L442), [core/claims/model.ts:326](../../src/core/claims/model.ts#L326).

The loader checks whether a layer-framed claim can be placed, but never checks whether a target-framed claim belongs to the selected target. `resolveAt` simply returns the stored address for every non-layer frame.

**Reproduction:** a claim at `$0002`, framed on target A and named `OnlyInA`, appears in target B’s loaded claims. This applies to the zero-page and hardware meanings for which target framing exists, and can contaminate names, roots and disagreements across program phases.

**Fix:** filter target frames by the selected target’s stable identity at the central projection boundary. Preserve machine-global platform claims separately. Tests must distinguish target-owned claims, shared layer claims, and platform claims across two targets.

### R6 · P1 — Renaming the default target silently changes the memory map

Location: [core/project/loader.ts:205](../../src/core/project/loader.ts#L205), [workspace.ts:1116](../../src/server/workspace.ts#L1116), [core/project/serialize.ts:547](../../src/core/project/serialize.ts#L547).

Targets have IDs and are edited by ID, but `defaultTarget` and target resolution still use names. Renaming does not update the stored selection. When the old name no longer resolves, `projectForTarget` returns the whole project, including layers outside the intended target. Removal cleanup compares the default to an ID, although ordinary stored defaults are names.

**Reproduction:** A selects bytes containing `$01`; a separate B layer contains `$02` at the same address. Rename default target A by ID. An ordinary default-view read changes from `$01` to `$02`, with the stored default still `A`.

Duplicate target names are also admitted, while selection uses the first name match.

**Fix:** persist target references by ID, migrate legacy names, and resolve names only at read boundaries with ambiguity handling. An unresolved default must produce an explicit fallback or error, never silently enable every layer. Test rename, removal, duplicates, and default selection together.

### R7 · P1 — Scenario caching can turn a failing probe into a passing one

Location: [workspace.ts:2279](../../src/server/workspace.ts#L2279), [server/index.ts:310](../../src/server/index.ts#L310), [core/machine/scenario.ts:169](../../src/core/machine/scenario.ts#L169).

Scenario checkpoints are shared across a project. Their fingerprint is `this.version()`, which hashes the project document without including the selected target. The cache therefore treats identical steps over different target memory maps as identical executions. It restores saved checks as well as machine state.

**Reproduction:** the scenario asserts `$8001 == 1`. It passes on A. B supplies `2` at that address. Running B after A through the shared cache reports **passed: true**; running B with a fresh cache reports **passed: false**.

**Fix:** key checkpoints on the actual execution inputs: target identity and placements, effective binary/ROM content, machine configuration, and scenario prefix. Document version alone is not an execution fingerprint. Test warm-cache and cold-cache equality across targets and changed binaries. This should be fixed before treating scenarios as reproducible evidence.

### R8 · P1 — The file hash in the document does not determine the bytes read

Location: [store/sqlite-storage.ts:342](../../src/store/sqlite-storage.ts#L342), [store/sqlite-storage.ts:357](../../src/store/sqlite-storage.ts#L357), upload handling at [server/index.ts:519](../../src/server/index.ts#L519), and captures at [workspace.ts:2298](../../src/server/workspace.ts#L2298).

Blob contents are stored by hash, but reads follow a separate mutable SQL `files` name-to-hash mapping. `putBlob` replaces that mapping on a repeated name. The CRDT’s `file.add` records another mapping, and undo only changes the CRDT mapping. Captures reference filenames, so later output with the same name can also change what an earlier capture retrieves.

**Reproduction:** store A under `capture.prg`, record it, replace it with B and record that, then undo the replacement. The document contains A’s hash; `storage.blob("capture.prg")` still returns **B’s bytes**.

The HTTP route additionally serves these mutable name URLs with year-long `immutable` cache headers, and the browser caches fetched blobs by path.

**Fix:** make the document’s content hash authoritative for reads and exports. Captures must pin immutable content; repeated output names need distinct references or explicit versioning. Derived SQL indexes must follow document state, including undo/replay. Test old captures and open clients after replacement and undo.

### R9 · P1 — A failed database transaction leaves uncommitted changes live

Location: [store/project-store.ts:501](../../src/store/project-store.ts#L501), update observer at line 135, and [store/sqlite-storage.ts:390](../../src/store/sqlite-storage.ts#L390).

`runOps` applies edits to the live Y.Doc, persists update events, and notifies listeners before it appends the operation log and commits. SQL rollback cannot undo the already-mutated Y.Doc or recall notifications. The caller can receive an error while readers and peers see the failed edit; restarting reconstructs a different state.

**Reproduction:** inject an `appendOps` failure after a rename. `runOps` throws and SQLite rolls back. The live document says `Uncommitted`; a new store reconstructed from the same database says `Original`.

This is a local durability/commit defect, not a demand for distributed transaction atomicity, which invariant A5 correctly disclaims.

**Fix:** prepare changes on an isolated copy or otherwise stage their update bytes, commit document updates and intent records together, and publish only after commit. Define a failure policy that never keeps serving an uncommitted state. Test persistence failures at each boundary and verify both peer visibility and restart recovery.

### R10 · P1 — Socket history pairs operations with the wrong inverses

Location: [store/project-store.ts:263](../../src/store/project-store.ts#L263), especially `inverse: back[index] ?? op` at line 269.

The socket path independently computes forward and reverse project diffs and pairs them by array position. Both diffs order operations by entity/category rules; the reverse diff is not guaranteed to list the matching inverse at the same position.

**Reproduction:** one socket update removes `clm_a` and adds `clm_b`. The log pairs `remove clm_a` with **`remove clm_b`**, and `add clm_b` with **`add clm_a`**. Undoing those records can restore or delete the wrong entity.

Those rows also omit the socket’s session and changeset, although the relay knows the session. Group boundaries therefore disappear from this history path.

**Fix:** derive each inverse against the correct intermediate state, or store a whole update’s forward/reverse operation groups as one action. Preserve session attribution and action grouping. Cover add/remove mixtures, moves between parents, and multi-operation browser actions rather than only isolated renames.

### R11 · P2 — `changes_since` misses HTTP writes and undo actions

Location: [server/index.ts:424](../../src/server/index.ts#L424), [store/project-store.ts:254](../../src/store/project-store.ts#L254), [store/project-store.ts:615](../../src/store/project-store.ts#L615), [workspace.ts:3670](../../src/server/workspace.ts#L3670).

`PUT /api/project` directly applies CRDT operations with origin `http`. The store records automatic operation history only for origins its resolver recognizes, and the relay recognizes sockets only. Thus the edit reaches the document and export but not the operation log.

Undo similarly applies inverses and toggles old rows’ `undone` flags instead of appending a new action. An agent holding a cursor past those rows sees no new entry explaining the changed state.

**Reproductions:** a real HTTP PUT changes the description and returns 200, adding **zero operation rows**. After two renames, undo changes the document while `opsCursor()` remains **2**.

**Fix:** route all accepted writes through a common action recorder and append undo/redo events that reference the original action. Keep the historical feed append-only. Test `changes_since` from a cursor captured before each write path, including undo and HTTP.

### R12 · P2 — Redo gets stuck after two undos

Location: [store/project-store.ts:579](../../src/store/project-store.ts#L579).

Redo selects the highest original operation sequence marked undone, rather than the action undone most recently. It also walks each changeset in reverse order, as undo does, despite redo needing the original dependency order.

**Reproduction:** rename Original → First → Second in one session; undo twice. Redo tries to restore Second before First, rejects its own prerequisite state as “changed by someone else since,” and applies nothing. No collaborator participated.

**Fix:** maintain redo order explicitly, preferably from appended undo events, and apply a redo’s operations in forward order. Define behavior for a new edit after undo and for skipped actions. The reproduced failure is in the store’s redo method; the MCP surface currently exposes undo without a matching redo tool.

### R13 · P2 — Evidence provenance has incompatible clear semantics

Location: [core/crdt/ops.ts:481](../../src/core/crdt/ops.ts#L481), [core/ops/apply.ts:478](../../src/core/ops/apply.ts#L478), [workspace.ts:3901](../../src/server/workspace.ts#L3901).

The text adapter treats `evidence.set.fields.by` as a replacement and `null` as a clear. The CRDT adapter treats missing nested properties as unchanged; for `by: null` it supplies `undefined`, which `revise` ignores. In addition, `edit_claim method: null` builds provenance with the method omitted rather than explicitly cleared.

**Reproduction:** `by: null` removes author, method and timestamp on the text path but preserves all three in the CRDT. Clearing a claim’s existing `guessed` method through `Workspace.setClaim` returns successfully while the method remains `guessed`.

This invalidates assumptions in inverse generation and the stated cross-adapter round-trip contract.

**Fix:** choose one typed provenance patch contract, including explicit nested clears, and implement it identically in every adapter. Exercise absent → set → clear → undo for each provenance field, and assert untouched fields survive.

### R14 · P2 — Equal CRDT state produces different ordered projections

Location: [core/crdt/doc.ts:501](../../src/core/crdt/doc.ts#L501).

`sortedValues` parses every sort key as a number, including decoder/type/target names, capture filenames and evidence claim IDs. Ordinary strings produce `NaN`; the comparator returns it instead of taking the ID tiebreaker. Those arrays retain map insertion order, which can differ between peers.

**Reproduction:** two peers independently add decoders Alpha and Beta and exchange both updates. One projects `[dec_a, dec_b]`; the other projects `[dec_b, dec_a]`.

Because version hashes use `JSON.stringify(projectFromDoc(...))`, logical state is not enough to determine the version. Ordering can also affect first-match resolution and selection of an implicit default target when priorities tie.

**Fix:** provide separate numeric and textual comparators with deterministic ID tiebreakers. Canonicalize object maps included in serialization/hash inputs as well. Verify ordered projection and version equality after all update delivery permutations and after reconstruction from stored updates.

### R15 · P2 — Malformed addresses are accepted at a different address

Location: [server/mcp/tools.ts:90](../../src/server/mcp/tools.ts#L90), with the same prefix-parsing pattern in byte and flag transforms.

The schema applies `parseInt` and checks only the parsed result’s range. Trailing syntax is silently discarded. Strings such as `$8000+1`, decimal fractions, or numeric text followed by a typo can be accepted as a valid prefix.

**Reproduction:** a real MCP `add_claim` with address **`$8000+1`** succeeds and writes at **`$8000`**. Arithmetic is not advertised as supported, so this input should be refused rather than reinterpreted.

**Fix:** require a complete match for each supported numeric spelling before conversion, and keep the explicit place-expression parser separate. Apply this to addresses, bytes, flags and persisted numeric fields. Test malformed suffixes, fractions, empty prefixes and boundary values over the transport.

## Architectural assessment and additional observations

The separation between byte resources, target arrangements and interpretive claims is useful. Additive claims with separate evidence records can preserve disagreement without forcing a winner at write time. The shared DOM-free analysis and rendering code, actual MCP transport tests, generated API documentation, and explicit operation vocabulary are also valuable foundations.

The main weakness is that the **declared algebra and physical storage disagree**. Claims expose partial updates but rewrite whole records; fields expose IDs but are stored by offset; bindings claim to be keyed by position but are stored by random use IDs; targets have IDs while their references use names. Yjs can converge on each of these representations without preserving the semantics promised by the API. Changing the CRDT library would not correct that mismatch.

There are also multiple overlapping representations of truth: CRDT state, exported project text, inferred forward/reverse diffs, SQL operation rows, and SQL filename mappings. They are still used as writable inputs in different paths. Keep exports and secondary indexes derived, and define one durable action boundary for authoritative changes.

Additional code-reviewed API gaps, not counted in the 15 reproduced findings:

- [edit_type](../../src/server/mcp/tools.ts#L1334) requires `name`, `size` and `fields`, while [setType](../../src/server/workspace.ts#L2499) sends them through `type.set` and reuses field identities by offset. This contradicts `docs/06-algebra.md`’s statement that parent edits exclude children and revisions name only changed fields. Adding `edit_field` did not remove the older competing edit route. Renaming a type should not require resending its size or expose an offset-based field replacement path.
- [edit_target](../../src/server/mcp/tools.ts#L2153) cannot clear optional `description` or `order` with `null`, although the low-level target patch allows clears. Nullability should be checked across every entity schema, not only claim fields.
- [editEvidence](../../src/server/workspace.ts#L2103) does not recheck the resulting refutation’s explanation or its scenario references. `addEvidence` does perform some of these checks. A common request validator should enforce the same declared rules on additions and revisions without suppressing legitimate merged disagreements.
- Coordinate semantics need an explicit inventory beyond claims. Comments and operand uses remain absolute values nested inside layers, and primary choices are global address keys. Define how each should behave when a layer is relocated, shadowed, or used by multiple targets, and test those decisions together.
- The socket receiver accepts updates without validating the resulting project shape, and [receive](../../src/server/sync.ts#L236) has no outer decoding exception boundary. Robust handling of malformed messages and incompatible schemas needs a separate failure-path test. Authentication being intentionally absent does not settle input validation or process robustness.
- Stored evidence points to mutable claims and scenarios. Editing either can change what an earlier author appears to have vouched for. Decide whether evidence means “supports this evolving entity” or “supports this revision under these execution inputs”; retain revision/content identifiers if the latter is required. This is a product-model decision, not a claim that the current semantics were unintended.

Some current reference prose is stale: the developer guide still describes claim provenance and `supersedes` in their older forms, and the model reference lists `layer.set` as nonexistent although the operation is implemented. Historical decision files are explicitly append-only and should remain historical; present-tense reference documents should be reconciled with actual behavior.

## Why the existing tests did not catch these

The suite has good breadth but several tests prove a weaker property than their titles imply. For example, [the independent-claim-fields concurrency test](../../src/core/crdt/concurrency.test.ts#L62) checks replica agreement and that `root` is defined; it never requires both the requested rename and root revision to survive. It therefore passes R2.

The operation round-trip harness supplies one representative payload per operation. It establishes coverage of operation names, not every patch variant, clear operation, dependency sequence, or concurrent write pattern. Provenance clearing, field movement collisions, and mixed forward/reverse diff ordering need their own behavioral assertions. Likewise, asserting that every entity has `add/set/remove` verbs does not establish that its implementation obeys those verbs.

Useful next coverage is a matrix of properties: different fields of the same entity; same property under concurrent writes; same-ID moves; bind/rebind/unbind; add/edit/remove sequences; cross-target isolation; replay under reordered updates; and failure before durable commit. For each, compare the live projection, exported/reloaded project, restored store, recorded history, and client-visible answer where applicable.

## Recommended repair sequence

1. Isolate MCP request context and fix claim patch writes. Both are localized changes with direct collaboration impact.
2. Establish stable target references and target filtering; fix scenario execution fingerprints before relying on scenario results as evidence.
3. Migrate fields and bindings to storage shapes that implement their identity contracts; remove competing parent/offset edit routes.
4. Make blob content references authoritative, then fix the durable commit/publish boundary.
5. Repair operation-history inversion, session grouping, append-only undo events and redo order.
6. Align clear semantics, canonical projection order and strict numeric validation, then update current reference documents and strengthen the invariant tests.

These findings warrant targeted repairs and migrations. The byte/claim/target separation and the shared analysis core can remain; the work is to make storage, references, history and API behavior fulfill their existing contracts.
