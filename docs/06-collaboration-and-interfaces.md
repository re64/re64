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
web UI tab a browser-held replica. Each session owns its undo/redo record and
evaluates local commands against that replica. Other sessions receive the
resulting shared edits, including undo/redo effects, without sharing the undo
record or replaying the originating command. Storage layout, update transport,
the undo adapter, and durability failures remain specification work under those
rules.
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
visible branch of a conversation. Creation timestamps and predecessor references
are fixed at creation. When a writer records a predecessor while composing a
message, it identifies a message already seen. Admitting or reconstructing the
stored message does not require that predecessor to exist in the receiving
document. Editing message content does not change this ordering metadata.

Chat presentation belongs to views. The shared model supplies messages and
optional last-seen references, not one mandatory presentation order. A view can
sort by time alone, use the predecessor-aware policy below, or display the
relationships as a graph. Last-seen references record an observation relationship;
they do not define reply threads. They can expose inconsistent timestamp orderings
and support future clock-correction heuristics, but do not establish which clock
is wrong or a corrected timestamp by themselves.

During a session, newly incorporated messages initially appear at the bottom.
The view can later adopt their reconstructed positions: on reopening or explicit
refresh, after an idle interval, or when affected messages leave the viewport.
Adoption timing is local presentation policy; it should preserve the reader's
position using message identity. Live positions need not match across views.
The same incorporated records and reconstruction policy produce the same order.
Neither order is a shared sequence that participants edit.

In the predecessor-aware policy, tombstoned messages participate in
reconstruction and are hidden only afterward. This preserves predecessor
relationships through deleted messages. The resulting
order is a reading order, not proof of exact real-world chronology.

Message content, including author information and text, can be cleared
independently of the tombstone and ordering metadata. Clearing content preserves
the message's identity, creation timestamp, and predecessor reference, so it
does not change its recorded ordering information or remove the message entity.
The same state is admissible at creation: a message may already be tombstoned
or have cleared content, including when reconstructed from serialized data.

### A predecessor-aware chronological view

This view policy uses a time-first pass with a holding set for messages whose
predecessors have not yet been placed. Work on a fixed snapshot of the incorporated message records,
including tombstones. Content and author information do not affect the order.

The comparison key is creation timestamp, then stable ID in lexicographic
UTF-16 code-unit order, without locale collation. A timestamp, when present, is
an integer count of Unix milliseconds. Missing timestamps sort after dated
messages, with ID breaking ties. No local arrival time or current wall clock
enters this key.

Prepare a working copy of the predecessor links:

- A missing predecessor imposes no ordering constraint in this reconstruction;
  retain the stored reference and report it as unresolved. If that message later
  arrives, the next reconstruction uses the link and may move messages.
- Find cycles, including self-links, by iteratively following predecessors.
  In each cycle, ignore the predecessor link of the message with the smallest
  comparison key. Report the cycle and ignored link. Stored references remain
  unchanged; this is a deterministic reading fallback, not a correction of the
  conversation. All remaining links must be respected.

Each message has at most one predecessor. Cycle detection therefore needs only
visited states and the current path, with no recursion: mark completed paths so
each message is visited once. The prepared links form an acyclic graph.

Sort the messages by the comparison key, then scan once:

1. If a message has a remaining predecessor that has not been emitted, put it
   in a holding set indexed by predecessor ID. Continue scanning.
2. Otherwise, put the message in a ready min-heap ordered by the same key.
3. Drain that heap before continuing the scan. Emit its earliest message, then
   release any messages waiting for it into the heap. Repeat until the heap is
   empty. Newly released messages compete by time with all other ready messages;
   do not recursively finish one branch before considering another.

This preserves timestamp order whenever it already respects dependencies. An
early-dated message with a later predecessor waits, while unrelated messages
continue to appear. It is equivalent to choosing the earliest available message
in a topological ordering, rather than grouping messages into dependency levels.

Every message is scanned and emitted once, and enters the heap at most once.
With cycles handled before scanning, no holding chain can wait forever. Sorting
and heap operations take O(n log n) time; links, holding sets, and working state
use O(n) memory. Filtering tombstones happens after ordering. Repeated delivery
of a CRDT update supplies no additional message identity to this computation.

| Case | Reconstructed order |
|---|---|
| N(time 0) follows M(time 100); Q(time 50) is independent | Q, M, N. N waits while Q can be placed. |
| Same case with M tombstoned | Full order Q, M, N; visible order Q, N. Removing M before ordering would incorrectly put N first. |
| Same case before M has arrived | N, Q, with N's reference unresolved. After M arrives, reconstruction gives Q, M, N. |
| B(time 1) and D(time 2) follow A(time 100); C(time 3) follows B | A, B, D, C. Releasing C does not put it ahead of the earlier ready D. |
| A(time 10) follows B(time 20), and B follows A | Ignore A's predecessor link for ordering, report the cycle, and emit A, B. |

A clock far in the future can place a message late and pull its successors late
as well. Using timestamps to order unrelated messages in a dependency-first
approach has the same clock limitation. This policy uses recorded times without
clamping, voting, or inferred clock corrections. Live append makes arrivals
visible immediately; reconstruction promises determinism, not recovered chronology.

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
