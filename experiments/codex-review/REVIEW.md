# Document model and MCP review — 2026-09-09

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

- [edit_type](../../src/server/mcp/tools.ts#L1334) requires `name`, `size` and `fields`, while [setType](../../src/server/workspace.ts#L2499) sends them through `type.set` and reuses field identities by offset. This contradicts `docs/algebra.md`’s statement that parent edits exclude children and revisions name only changed fields. Adding `edit_field` did not remove the older competing edit route. Renaming a type should not require resending its size or expose an offset-based field replacement path.
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
