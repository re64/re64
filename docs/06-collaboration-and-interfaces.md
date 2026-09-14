# Collaboration and interface design

These notes preserve the current implementation direction beneath the
[architecture](02-architecture.md). Detailed schemas and protocols remain to be
specified and checked under [#70](https://github.com/re64/re64/issues/70).

## Replicas, synchronization, and persistence

Each session works with a replica, its own editable copy of project state.
Participants see their own changes immediately. Updates from other sessions
can be announced before they are incorporated; merging is requested explicitly
or by the participant's chosen policy. Notification is not an implicit merge.

The chosen synchronization direction is a CRDT, a conflict-free replicated data
type. Replicas receiving the same updates converge on the same document.
That property does not itself guarantee correct edit semantics: independent
edits must preserve their independence, and a logically atomic change must not
be represented as independently competing fragments. Contradictory assertions
can legitimately coexist.

The [synchronization design](07-synchronization.md) defines the common entity,
field, deletion, and action rules using maps and atomic values. Domain properties
and relationships supply ordering where needed. It is the home for those
synchronization contracts.

The server persists shared project state and edit history, assets, captures,
attribution, and discussion. Stored data supports reconstruction of session
replicas; retained results remain available without rerunning their producer.
The participant's local state and the server's durable state have distinct roles
whose failure and update semantics need explicit contracts.

The intended placement gives each agent session a server-held replica and each
web UI tab a browser-held replica. Storage layout, update transport, the undo
adapter, and durability failures remain specification work under those rules.
Correctness checks must exercise the intended operation semantics, not only
convergence.

> **Mutant Camels — coordination through chat.** Two readers reported different
> conclusions about a possible zone-skip cheat. Their discussion prompted a
> check that confirmed a key-value write but did not establish the proposed
> skip. Chat preserved both the lead and the limit of the demonstration.
> [Editorial notes][notes]

## Chat arrival and history

Messages are identifiable entities in a map. Their durable record can include
a locally supplied creation timestamp and a reference to the last message the
writer had seen. The latter supplies a predecessor relationship even when clocks
disagree; it is not a complete record of everything the writer saw or an
acknowledgement of its content. A single predecessor need not capture every
visible branch of a conversation.

During a session, newly incorporated messages arrive at the bottom. Previously
displayed messages do not reshuffle as other messages arrive. This live arrival
order is local presentation state, not a shared sequence that participants edit.

When reopening a project, the view reconstructs a stable history from the durable
metadata. The working approach respects predecessor relationships, uses timestamps
to order independent branches, and uses stable IDs for deterministic display ties.
Tombstoned messages retain their identity and relationships. The exact metadata
schema remains open, but neither live arrival nor reconstructed history requires
a shared array. The reconstructed order is a reading order, not proof of exact
real-world chronology.

## Shared operations and views

The current component direction puts the model, edits, and view construction in
a shared core. Analysis and execution consume their stated inputs and produce
results. Presentation turns those results into listings and visual views.
The server supplies persistence and session coordination; UI and MCP adapters
translate participant actions into the shared operations.

A resolved machine view combines a machine state with the knowledge participating in
its analysis. It resolves placement, mapping, execution changes, and relevant
interpretations while preserving their origins. Asset-scoped tools need the
same semantic consistency without constructing a machine view unnecessarily.

Caching can avoid repeated construction, but cached and reconstructed answers
must agree for the same inputs. Cache identity must account for actual material,
configuration, and definitions. Neither a cached view nor an exported listing
becomes a second editable authority for the current project state. Retained
historical outputs have a different role: recording what was examined earlier.

API design must distinguish temporary reads, proposed analytical outputs,
accepted edits, and retained results. Equivalent operations through MCP and the
UI use the same context and report the same substantive outcome. Name resolution,
stable identity, ambiguity, and missing-input errors need explicit rules.

## One field, two presentations

The first Mutant Camels zone name occupies 40 bytes at `$67A0`. With the zone
table interpreted as an array of `ZoneRecord`, a view identifies it as
`zoneTable[0].name` and decodes it using the game's character set.
[Record analysis][zones]

The formats below are illustrative, not a proposed tool schema. The surrounding
query identifies the machine state and interpretation used. A disassembly can show:

```asm
$67A0  zoneTable[0].name:
       .text "       ASSORTED EASY AVIAN ALIENS!!     "
```

An MCP result can expose the same information as JSON:

```json
{
  "address": "$67A0",
  "path": "zoneTable[0].name",
  "type": "char(40)",
  "text": "       ASSORTED EASY AVIAN ALIENS!!     "
}
```

The address, field association, and decoded value come from the same view.
Actual response contracts must retain the necessary context when results are
saved or referenced independently of the query.

[notes]: https://github.com/re64/re64/blob/7cba76315230f8516eda0233026ffdc19e550814/experiments/09-editorial/run1/editorial-notes.md
[zones]: https://github.com/re64/re64/blob/7cba76315230f8516eda0233026ffdc19e550814/experiments/09-editorial/run1/report-reader-one.md#L43-L58
