# Synchronization design

Most project objects should share a small set of edit and synchronization rules.
This document defines that common behavior beneath the
[architecture](02-architecture.md). Individual model definitions specify their
fields and identify any exceptions. The API exposes these operations without
exposing Yjs types.

The entity, field, deletion, and action rules below record the redesign direction.
They are not a claim that the current implementation already satisfies them.
The initial shared-data subset is maps with atomic values. Ordering, where
needed, comes from model properties and relationships rather than shared arrays.

## 1. Merge without a resolution step

Replicas that receive the same accepted updates must converge without asking a
participant to resolve a merge conflict. Independently editable fields preserve
independent changes. Competing writes to one field resolve to one value through
the CRDT's rule; that does not establish which interpretation is correct.

Here, last-writer-wins means a causally later write supersedes the value it saw,
and concurrent writes have a deterministic winner. It does not promise that the
largest wall-clock timestamp or the update arriving last at a server wins.
Attribution and action history remain separate from that selection.

Conflicting claims, overlapping record fields, duplicate names, and references
to deleted objects can remain in the record. Hygiene makes the relevant problems
discoverable. Convergence does not make these situations disappear or require
the participants to agree about them.

Malformed or incompatible input can be rejected at a boundary. Supported edits
must nevertheless be designed so that merging independently valid changes does
not require rejecting one because their combination is inconvenient. In
particular, reference checks and cross-object consistency checks must tolerate
the states ordinary concurrent editing can produce.

## 2. The shared building blocks

| Building block | Meaning | Operations needed |
|---|---|---|
| Entity | Stable identity with independently editable fields and a deletion marker | Add, update named fields, mark deleted, restore |
| Atomic value | One field whose entire value wins or loses together | Set a complete value; clear if the field permits absence |
| Collection of entities | Membership identified by entity IDs, not names, offsets, or display positions | Add an entity; inspect by ID; enumerate active or deleted members |

Placements, messages, and other independently editable members use the entity
rules. A priority, timestamp, offset, or predecessor reference is a model field,
not an additional shared collection type. An operation batch or a small atomic
value can still contain an ordinary array; the restriction concerns shared
sequence editing, not the use of arrays in JSON, queries, or application code.

A scalar property is a field of an entity. A **record field**, by contrast, is
itself an entity: it has an identity, name, offset, type, and possibly a description.
Renaming it and correcting its offset should not replace the whole record type.
Its offset is not its identity. Two record fields at the same offset survive
as two entities for inspection and hygiene.

Entity collections do not have an implicit semantic order. Where presentation
derives an order, such as record layout by offset, ties need a deterministic
rule such as stable ID order. Locale-dependent sorting and map insertion order
must not change the meaning or identity of a derived result.
An ID tie-break may make a display stable; it must not silently resolve a
substantive ambiguity such as two competing placements supplying machine bytes.

## 3. Field granularity and complete values

An update touches only the fields it names. A client must not read an entity,
change one property, and write the whole entity back: doing so reasserts values
that the client did not intend to edit.

Some fields have internal structure that must change together. A location may
be an asset and offset, or another supported location form. Its discriminator
and the fields required by that form constitute **one atomic value**. Concurrent
location changes select a complete location, never one change's asset paired
with another change's offset. The same principle applies to other discriminated
values whose alternatives require different properties.

Read-copy-edit-write is appropriate *within* that boundary. Changing just the
offset of a location means reading the location, constructing a new complete
location, and replacing that field. A competing location edit can supersede it;
unrelated properties of the entity remain independent. The copy must be a new
value rather than an in-place mutation of a JSON object held by the adapter.

Writing several independent keys in one transaction does not make them one
merge value. Transaction grouping and merge granularity answer different
questions. Represent the complete value as one register, or use an equivalent
representation that enforces that same outcome under concurrency.

Every model field must specify:

- its value type and, where relevant, allowed complete forms;
- whether it is required, optional, or permits an explicit null value;
- any initial default, and whether that default has substantive meaning;
- whether it is independently editable or part of an atomic value;
- the meaning of references, including absent and deleted referents.

Omitting a field from an update means leave it unchanged. Explicitly clearing an
optional field means make it absent. Setting a meaningful null value must be
distinguishable from clearing; the API chooses their spelling. Clearing a
required field is not a supported operation. Unknown machine values need their
own stated meaning rather than being inferred from every absent or null field.

Required structure should be protected by these value boundaries. Consistency
between independent entities, such as whether a record field still fits a
concurrently shortened record type, normally belongs to checking and hygiene.

## 4. Identity, deletion, and restoration

Two rules determine what deletion means:

- Any durable entity with stable identity that may be referenced by another
  durable entity is tombstoned rather than physically removed.
- Configuration state that cannot be durably referenced, and derived/cache
  state, may be physically removed when doing so cannot invalidate a durable
  reference or destroy retained provenance.

“May be referenced” describes what the model permits, not whether a reference
happens to exist in the current replica. A reusable type definition can be
configuration and still require tombstoning. A retained analytical result is
likewise not disposable merely because it was originally derived.

An entity's ID is stable and never reused for a different entity. Adding creates
its identity and initial required fields. Retrying an add must not replace an
existing entity or reset fields another participant has edited. Replaying a
Yjs update and retrying an application command are different operations; both
need to avoid accidental duplication.

For entities protected by the first rule, deletion sets a model-visible marker,
the tombstone. It does not erase the entity, remove references to it, or
recursively delete its dependents. Normal views omit deleted entities;
inspection and hygiene can still resolve their
identity, describe them as deleted, and find the references that need attention.
Deleting a parent does not erase its children.

Updating ordinary fields does not implicitly restore an entity. An update
concurrent with deletion can survive in the retained entity while the deletion
marker keeps it inactive. Restoration changes that marker explicitly and keeps
the same identity and current retained fields, including intervening edits.
It does not roll the entity back to a pre-deletion snapshot.

Delete and restore compete on the same lifecycle field. A restore that has seen
a deletion supersedes it; concurrent delete and restore use the ordinary
deterministic field rule. An unseen concurrent deletion can therefore still
win. Restoration of an entity is separate from adopting it as valid evidence or
endorsing its claims.

Undo and redo of these lifecycle operations change the deletion marker:

| Original action | Undo | Redo |
|---|---|---|
| Create an entity | Mark it deleted | Clear the tombstone, restoring the same entity |
| Delete an entity | Clear the tombstone, restoring the same entity | Mark it deleted again |
| Restore an entity | Mark it deleted again | Clear the tombstone again |

These reversals preserve the identity and retained fields, including subsequent
edits by other participants. Redo of creation does not replay initialization or
reset the entity's content. The lifecycle writes follow the concurrent-edit and
undo rules in this document.

A permanent purge of tombstoned entities is outside ordinary editing and needs
a separate retention design; removal permitted by the second rule does not
require such a purge.

Yjs's internal deletion bookkeeping is not this model-visible marker. Keeping
internal history does not by itself make a deleted entity available to normal
lookup, hygiene, or export. Clearing an optional scalar property is also
different from deleting an identifiable entity.

## 5. Ordering belongs to the model

Maps retain independently identifiable members. Each model specifies whether
order comes from explicit properties, relationships, or an atomic sequence value.
A numerical list index is a position in a particular view, not a durable identity.
The current design needs no generic insert-between or move-in-sequence primitive,
fractional positions, or sequence rebalancing.

For asset placements, changing priority is an ordinary field update. Two writers
adding different placements preserve both, even if their overlapping contents
leave an analysis without a resolved source. Concurrent priority changes on one
placement select one priority without duplicating that placement. Deletion and
restoration follow the entity rules; changing priority does not restore a deleted
placement. The [machine design](04-machine-design.md#machine-state-composition-and-memory)
owns precedence and ambiguity rules. Merge succeeds even when analysis must wait
for an explicit configuration choice.

Record layout is derived from field offsets. Colliding interpretations remain
inspectable; a stable display order does not select one as correct. Collections
whose purpose is membership, such as a set of entry points, do not acquire
sequence semantics merely because their API returns an array.

For chat, [collaboration design](06-collaboration-and-interfaces.md#chat-arrival-and-history)
distinguishes live local arrival order from a stable reconstructed history based
on timestamps and predecessor relationships. Neither requires a shared array.

Scenarios have triggers, conditions, dependencies, and actions, potentially with
small sequential action bodies. Their execution order is not necessarily one
linear list. [Machine design](04-machine-design.md#execution-controls-and-retained-results)
owns those semantics and the remaining editing-boundary choices. Where a small
sequence is intentionally replaced as one atomic value, its edits compete as a
whole; the model must make that granularity explicit.

## 6. Actions, history, and undo

An action groups operations performed for one participant intention. Record
its identity, contributor/session, operations, and relationship to an undo or
redo. Preserve its grouping independently of network packet boundaries: an
update transport may batch several actions or deliver one incrementally.

An operation's atomic values determine merge granularity. An application action
determines the user-visible change and usual undo step. A local transaction can
publish its constituent edits together to local observers; it does not make a
distributed action a globally indivisible winning value.

Validate an action's supported shapes before changing live state. A Yjs
transaction is not a database rollback boundary: throwing partway through does
not undo writes already made. The adapter must avoid reporting a rejected
action after leaving some of its edits behind.

Undo affects the selected participant action's contribution. It must not restore
a whole project snapshot over independent work. Where another writer has
superseded an affected value, undo may have nothing to reverse there; the
participant needs an accurate result. Redo is subject to the same principle.
An action can remain one undo step even if only some independent effects can
still be reversed. Truly coupled fields remain whole atomic values.

Undo and redo are new recorded actions referencing earlier work, not removal of
history. Attribution, durable logging, and participation in the undo stack are
separate policies. Chat participates in the shared record and attribution but
ordinary project undo must not take back messages. If message editing or
deletion is exposed, it is an explicit operation with its own policy.

Yjs UndoManager can help with origin-scoped undo and explicit grouping. It is
not the durable domain history, and its default reversal of entity insertion
does not implement the retained-identity rule above. Entity initialization and
lifecycle changes need an adapter that makes undo obey the model. UI and MCP
must share the same observable undo semantics rather than inheriting whichever
mechanism happens to serve each interface.

Exact undo-stack persistence across sessions, reporting of partial reversals,
and the lifecycle adapter remain implementation design. The shared rules above
are the requirements those choices must satisfy.

## 7. Yjs subset and integration boundary

The initial subset uses `Y.Map` for entity collections and editable records,
with JSON-compatible values for atomic fields. It does not use `Y.Array`.
Scalar strings are sufficient for ordinary descriptions and chat bodies.
Collaborative character editing with `Y.Text`, rich text/XML, subdocuments, and
other features are not required by this design. A concrete future need can
justify extending the subset; existing library features do not require adoption.

The adapter needs map lookup/set/clear and enumeration; transactions with local
origins; change observation; update encoding/application; and selective undo/redo.
Physical removal remains subject to the reference and provenance protections in
section 4. Shared Yjs containers stay behind this adapter; references between
domain entities are stable IDs, not embedded copies of mutable objects.

Yjs documents joining one project need a shared CRDT history. Reconstructing
identical visible JSON independently does not automatically give them shared
internal identities. Bootstrap, persistence, reconnect, and retained evidence
must preserve the information their respective contracts require. A model-visible
deleted entity does not on its own retain every historical definition examined
by evidence; that remains part of [knowledge design](05-knowledge-design.md).

Local transaction origins support undo attribution locally; they are not a
substitute for contributor and action metadata carried through the protocol and
retained by the server. The local replica can show pending work before it is
durable, but the interface must distinguish that state from successful persistence.
Existing visibility and incorporation rules remain in
[collaboration design](06-collaboration-and-interfaces.md).

The relevant library interfaces are documented in
[Y.Map](https://docs.yjs.dev/api/shared-types/y.map),
[Y.Doc](https://docs.yjs.dev/api/y.doc), and
[UndoManager](https://docs.yjs.dev/api/undo-manager). The model specifies behavior;
these are implementation facilities, not additional concepts participants need
to learn.

## 8. What the existing implementation uses

Inspected `main` at
[`f5b2720b38075edc96d851d42d73ae7afc277a13`](https://github.com/re64/re64/tree/f5b2720b38075edc96d851d42d73ae7afc277a13),
with Yjs 13.6.32 installed. The names in this inventory belong to that
implementation, not to the redesign's object vocabulary.

| Existing representation | Actual behavior and relevance |
|---|---|
| ID-keyed `Y.Map` collections with nested maps | Constants, types, files, targets, claims, decoders, scenarios, captures, evidence, and participants use maps. Most edits patch named properties. |
| Record fields in a nested ID-keyed map | Each field has independently editable properties; projection sorts by offset and ID. Fields are not ordered with `Y.Array`. |
| Site-keyed maps | Operand bindings and primary-label choices show another map use: one selection per site, rather than a bag of competing entity IDs. The redesign must specify the selection's key and value boundaries. |
| `Y.Array` roots | The global layer collection and chat are real Yjs arrays, containing entity maps. These are the only production shared-array roots found. |
| Target placements and entry-point arrays | Plain values stored in map fields; replacing a target's layer list replaces the whole list. The loader uses its sequence as byte precedence. |
| Scenario steps | A JSON string stored as one map value. Concurrent step edits compete for the whole sequence. |
| Arrays within scenario steps | Keyboard inputs, breakpoints, and watchpoints are ordinary arrays within that atomic scenario value, not shared arrays. |
| Claim frame and interpretation | Logical fields are flattened over several map keys. Patching only the owned keys preserves unrelated edits, but is not the single-register compound-value rule proposed here. |
| Removal | Entity remove operations generally call map or array deletion. `gc: false` retains internal content, but deleted entities are absent from the ordinary projection. |
| Clearing optional fields | The operation adapter treats omitted values as unchanged and `null` as clear. A future nullable field needs an unambiguous contract. |
| Client undo | Yjs UndoManager tracks selected roots and the session origin with `captureTimeout: 0`; chat is outside those tracked roots. |
| Server undo and durable log | A separate domain-operation mechanism groups changesets, checks whether effects still hold, reports skipped reversals, and appends undo/redo records. It is not the client's UndoManager stack. |
| Receiver validation | Updates are applied to a staged copy, projected, shape-checked, and checked for recordable differences before acceptance. Such gates must be checked against the redesign's permitted concurrent states. |
| Presence | `y-protocols` awareness carries live presence separately from the persistent entity maps. It is not another durable object collection or undoable action. |

Source anchors: [document representation][doc], [operations and client undo][ops],
[claim encoding][claims], [chat][chat], [server history and receiver][store], and
[placement order][loader]; [presence][presence] uses a separate protocol. No
`Y.Text` or Yjs XML shared types were found in the
production CRDT adapter. The application's CodeMirror text editor does not make
its strings collaborative Yjs text.

This inventory does not prescribe the redesign's subset. In particular, the
existing [Y.Array](https://docs.yjs.dev/api/shared-types/y.array) roots are replaced
in the current direction by identifiable entities and model-specific ordering.

Small probes against the installed Yjs version confirmed that separate location
keys can combine across transactions, a compound JSON location remains whole,
concurrent array moves by deletion/reinsertion can duplicate an ID, a deletion
marker preserves concurrent field edits through restoration, and raw UndoManager
undo of creation removes the entity from normal lookup even after a peer edits
it. A further probe confirmed that an exception does not roll back a Yjs
transaction. These check library behavior; they do not constitute an implementation of
this design or a full verification of existing undo paths.

## 9. Checks to carry into implementation

These cases are the minimum useful checks for the shared rules, exercised
through the actual operation adapter and both participant interfaces as they
are introduced. Deliver concurrent updates in both orders and include duplicate
delivery; check retained state and projected behavior, not just convergence.

| Concurrent or historical case | Required outcome |
|---|---|
| Rename an entity / edit its description | Both edits survive. |
| Set two alternative locations, including a change of location form | One complete supported location; no mixed subfields. |
| Add different record fields / move two fields to the same offset | Distinct identities survive; overlap is reportable. |
| Clear an optional field / change an unrelated field | Explicit absence and the independent edit survive. |
| Delete an entity / edit it / restore after observing both | Same identity, retained updated content, explicit lifecycle state. |
| Refer to an entity / concurrently delete that entity | Reference retained; deleted referent discoverable through hygiene. |
| Change one placement's priority twice / change priority and description / delete and change priority | One occurrence; independent edits survive; priority changes do not restore it. |
| Add overlapping placements with unresolved priorities | Both survive; affected analysis reports the ambiguity until an explicit priority resolves it. |
| Add placements in opposite delivery orders with a resolved priority relationship | The same backing bytes are selected; delivery order does not establish precedence. |
| Receive an earlier-timestamped chat message during a session / reopen the project | Live arrival appends without reshuffling; reopening reconstructs a stable history respecting recorded predecessors. |
| Undo creation after a peer adds a reference or edits the entity | Identity and contributions remain inspectable; undo cannot erase them. |
| Undo a grouped action after an overlapping peer edit | Independent peer work survives; reversed and unreversed effects are reported. |
| Post chat between two undoable edits | Chat remains recorded; undo steps follow actions, not elapsed time. |
| Retry add, reconnect, or replay updates | No new duplicate identities, reset properties, or false attribution. |

[doc]: https://github.com/re64/re64/blob/f5b2720b38075edc96d851d42d73ae7afc277a13/src/core/crdt/doc.ts
[ops]: https://github.com/re64/re64/blob/f5b2720b38075edc96d851d42d73ae7afc277a13/src/core/crdt/ops.ts
[claims]: https://github.com/re64/re64/blob/f5b2720b38075edc96d851d42d73ae7afc277a13/src/core/crdt/claims.ts
[chat]: https://github.com/re64/re64/blob/f5b2720b38075edc96d851d42d73ae7afc277a13/src/core/crdt/chat.ts
[store]: https://github.com/re64/re64/blob/f5b2720b38075edc96d851d42d73ae7afc277a13/src/store/project-store.ts
[loader]: https://github.com/re64/re64/blob/f5b2720b38075edc96d851d42d73ae7afc277a13/src/core/project/loader.ts
[presence]: https://github.com/re64/re64/blob/f5b2720b38075edc96d851d42d73ae7afc277a13/src/core/crdt/presence.ts
