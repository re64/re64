# The document

How a project is stored, synchronised and attributed: the CRDT, the storage, sessions, undo, chat, and what three readers on one document actually collide over.

> **History, not reference.** Each entry is a decision with the bug that produced
> it. Entries are accurate as of when they were written and are **append-only**:
> a superseded decision keeps its text and gains a note pointing forward, because
> the value of a corrected decision is the correction. For what is true *now*, see
> `docs/model.md`, `docs/algebra.md`, `docs/api.md` and `docs/developer-guide.md`.

---

## Project Files

Project files (`.re64`) are JSON with this schema:

```typescript
interface Project {
  name?: string;
  description?: string;
  layers: ProjectLayer[];      // Required: each layer owns its annotations
  entryPoints?: (number | string)[];  // Disassembly entry points
}

interface ProjectLayer {
  type: "prg" | "raw" | "bytes" | "symbols";
  path?: string;        // For prg/raw
  address?: number | string;  // For raw/bytes
  bytes?: string;       // Hex string for bytes type
  length?: number;      // Optional length for repeat/fill
  noAutoEntry?: boolean;  // Suppress auto entry point for PRG
  name?: string;        // Display name; defaults to file basename
  labels?: ProjectLabel[];    // Labels owned by this layer
  regions?: ProjectRegion[];  // Regions carved out of this layer
}

interface ProjectLabel {
  address: number | string;  // "$8000" or 32768
  name: string;
  type?: "entry" | "function" | "code" | "address";  // Default: "address"
  comment?: string;
}

interface ProjectRegion {
  start: number | string;
  end: number | string;   // Can use "+length" format: "+$100"
  kind: "code" | "data" | "text" | "jumptable" | "unknown";
  name?: string;
  comment?: string;
}
```

Addresses can be decimal (32768) or hex strings ("$8000", "0x8000").

**Annotations belong to layers.** Labels and regions nest inside the layer that
owns them, so reordering the layer stack moves them with the bytes they
describe rather than leaving them pointing at whatever else lands at that
address. Region and kind resolution asks the topmost layer supplying a byte —
the same z-order rule as `readByte`.

A `symbols` layer carries names for addresses with no loaded bytes (zero page,
I/O registers, KERNAL entry points). It supplies no bytes, so it never shadows
and occupies no address range. A built-in C64 platform layer of this kind sits
at the bottom of every stack, supplying standard hardware and KERNAL names; a
project's own labels outrank it, so `ROM_CHROUT` beats the built-in `CHROUT`.

Name priority is explicit rather than insertion order:
`user > analysis > layer > platform > auto`, then the **narrower** claim, then
id.

`region` is gone from that list and its absence is the point. A named span used
to generate a label of its own, ranking between `layer` and `user` — which is
where the rank collision came from: a person's name for an address and their
name for the table starting there were two objects competing at one rank, and
eight addresses in the reference project carried both. One claim carries both
now, and where two of a person's claims tie on source the narrower wins, which
is the specific answer rather than a rank nobody could see.

## Model-is-truth, not buffer-is-truth

The displayed text is *derived* from the three-layer model (bytes → regions →
labels). Users never type assembler; they edit specific fields — a label's name,
a comment, a region's kind. Therefore:

- The document is a list of rows keyed by **address**, not a text buffer.
- CRDT sync operates on the project model (`labels`, `comments`, `regions`) —
  the same structures already in the `.re64` schema — never on characters.
- Two users renaming the same label is a clean conflict on one field, rather
  than overlapping character edits in a generated string.

Rejected alternative: holding generated text in an editor buffer and parsing
edits back. That round-trips derived text through a parser and puts conflicts at
the wrong granularity.

## Identity, operations, and collaboration

Settled and built. Reasoning about *merge* found three flaws that were real
regardless of whether a CRDT ever shipped, so the modelling landed first.

**Everything has an id.** Labels, regions, and layers each carry one. An address
cannot identify a label — several share one, and a rename changes the field you
would key on. A region's start moves, so keying on it makes "extend this region"
indistinguishable from delete-plus-create. Files without ids stay loadable: the
loader derives them from content so every client agrees, and the next write
persists real ones. `re64 migrate` does it eagerly.

**The primary label is an index, not a flag.** `primaryLabels` maps an address to
a label id at project level. That makes "one primary per address" structural:
concurrent promotions write one map key and converge, where a per-label flag
would leave both set with nothing able to repair it. A dangling id means no
primary and falls back to rank, so a delete racing a promote self-heals.
Resolution is **explicit primary → source rank → id** — id, not name, so a rename
does not silently move the primary.

**Operations are the interface, not the mechanism.** `src/core/ops/` holds a
closed vocabulary, each op with a computable inverse. They are the agent API,
the durable history, and the undo description at both ends — agents send them,
history displays them. What changed with the Yjs-first move is that they no
longer *apply to text*: `applyOpsToDoc` puts them into the document, and the
text is derived. `applyOp`/`invertOp` over text survive for the CLI and the
line-editing serializer that keeps an export diff small.

**The CRDT stays behind an allowlist**, asserted by a test. The property is that
the **domain never sees a CRDT type**: `yjs` only in `src/core/crdt`,
`y-protocols`/`lib0` only there and in `src/server/sync.ts`, `y-websocket` only
in `src/ui/doc-client.ts`. That last one is what keeps the transport
replaceable — `main.ts` being on the deny-list is the assertion, not an
oversight. Tests are exempt, because they stand in for a browser on purpose.

**The export is regenerated, and that is a retreat taken knowingly.** The
line-editing serializer exists so a one-label rename is a one-line diff, and a
document cannot promise that — it knows the content everyone agreed on, not
which labels a blank line grouped or what order regions were declared in. Hand
authored layout in a `.re64` no longer survives a round trip. It is still
diffable, because the projection has a defined order.

## Yjs-first: the document is the project

Read Yjs's own documentation before touching any of this. Its model is: **every
participant holds a `Y.Doc`, persistence stores that document's update log, and
readable formats are exports.** re64 spent a while doing the opposite — JSON
canonical, the document rebuilt from it each session and flattened back — and
almost every complication that arose descended from that inversion:
`doc.clientID = 0` (assigning a field Yjs documents as readonly), deterministic
construction, a base-revision guard, a three-way `absorb`, a file watcher,
whole-document PUT with 409s, and the question "does merge happen on the client
or the server?" — which in canonical Yjs does not arise, because everyone has a
document and updates are commutative and idempotent.

The giveaway that this was always meant to be client-side: `doc.ts`'s own
comment says determinism exists so "two clients loading the same JSON produce
byte-identical documents, giving **their** edits a common ancestor". That is
meaningless with one server-side document.

So: **the document is the truth.** A `.re64` is an *import source* or an *export
target*, never synced to and never flattened into. `docFromProject` survives as
the one-time conversion at import, kept as the first snapshot — the only place
it is reached from, and why its determinism no longer has to hold across
clients.

## Storage: one database, many projects

| Path | Holds | Committed? |
|---|---|---|
| `<name>.re64db` | projects, users, sessions, updates, blobs | no — gitignored |
| `<name>.re64` | the export | yes — what a diff shows and what you hand someone |

Blobs are global and content-addressed, so two projects annotating the same game
share one copy. Everything else is scoped by project id, and file names are
unique per project rather than globally.

Storage is what a Yjs persistence provider is: append an update blob, read them
back. Ordering and transactions are not needed for correctness — updates are
commutative and idempotent — which is a *weaker* requirement than the text store
this replaced.

`snapshots` is **not compaction**: the updates it covers stay exactly where they
are. It exists so loading is not proportional to every edit ever made, which
matters because the CLI runs in a fresh process to rename one label.

Compaction is deliberately not done. `gc: false` on every document, and it must
match on every peer — two documents disagreeing about collection can reach
different conclusions about the same history. The growth warnings in the Yjs
literature are written for text editing, where every character ever typed is a
struct; this document holds maps of scalars.

## The wire, and the browser

`y-protocols/sync`, with the y-websocket envelope, so a stock client
interoperates and so this is replaceable by Hocuspocus or y-sweet without
touching the browser. The client opens with SyncStep1, the server answers
SyncStep2 then its own SyncStep1, the client answers SyncStep2; the server only
ever replies.

The browser holds a `Y.Doc` too, via `WebsocketProvider` in `src/ui/doc-client.ts`
— the only file that knows how synchronisation reaches the network. It starts
**empty** and is filled by the server. Building a base locally from JSON both
sides are assumed to share only works while those bytes are provably identical
and fails silently when they are not, because both bases claim the same client
id for different content.

Consequence worth knowing: the browser cannot know which binaries a project
needs until the document arrives, so the first paint waits on a socket round
trip rather than a fetch.

**One relay per project**, made on first use, rather than one relay made
multi-tenant. A project has its own document, participants and idle timer. The
room is the path segment a stock client already appends, so a project is chosen
once, on upgrade, before the handshake — which is where an access check goes.

## Sessions, not users

**One connection, one document, one undo stack — not one person.** Two tabs are
two sessions with two client ids, genuinely concurrent peers who can conflict
with each other, and neither may undo the other's work. That falls out of
scoping undo to the session id rather than to whoever is sitting there.

`sessions` records the Yjs client id alongside the user who claimed it, learned
from the traffic rather than trusted from the claim. That is what makes an edit
attributable later: a struct carries a client id and nothing else. Authentication
is faked outright — picking a name is all it takes — and real accounts will
change how a session is issued, not what one is.

Presence is `y-protocols/awareness`, relayed but never persisted: who is looking
at what is not part of the project. **Membership is, and that is a reversal.**

The distinction the original decision missed is between a *cursor* and *being
here*. Where somebody's caret is right now is momentary and worthless a second
later, and awareness is right for it. Whether somebody is in this project is
neither, and the practical consequence of treating them alike was that awareness
rides on a socket — so a browser could see every participant and an agent, which
has no socket, could see none. For a project whose premise is four consumers and
none of them primary, that is the wrong asymmetry, and the fix is not a query
tool bolted onto the side: it is to make membership a data structure that both
consumers read the same way.

So `participants` is a **sixth root**, and joining or leaving is a **state
change** rather than an insertion or a deletion. An entry is created once and
thereafter toggles `online`. Three things fall out of that, and the second is
why it is worth doing at all:

- Arrival and departure become the same kind of event, so a client rendering the
  list has no special case for somebody going away.
- The list survives them. Who has *ever* been in a project is the more
  interesting question once several people have worked it, and a deletion throws
  that away.
- A browser observes the root; an agent calls `list_participants`. Neither needs
  a mechanism the other lacks.

**Stale membership is cleared on the way up, not on the way down.** Recording
departures at shutdown cannot be the whole answer, because a process that
crashes never runs its close handler and every session it held would stay
`online` for ever. `markAllOffline` runs when a `SyncServer` is constructed —
correct after a clean stop and after a crash alike — and the per-socket departure
is skipped while closing, since writing one update per socket into storage that
is being torn down is both pointless and a way to fail on the way out.

Like `chat`, it is outside `projectFromDoc`'s whitelist, so it never reaches a
`Project`, never reaches the export, never moves `version()`, and re-analyses
nothing. Asserted by a test, for the same reason chat's exclusion is: a property
that holds by omission is one a later edit can quietly take away.

The cost, stated rather than buried: `gc: false` means an entry is never really
gone, so this grows by one map per session that has ever joined. That is bounded
by sessions rather than by edits, which is a far slower thing to grow by, but it
is not nothing on a project worked for years.

**An identity that matches nothing is kept, not swapped.** `resolveCaller` used
to end in `?? known[0]`, so an unrecognised claim silently became *the first row
of the users table*. Three agents in experiment 2 announced themselves as
`reader-1/2/3` and every edit they made was recorded as `usr_agent` with nothing
said — and that database merely happens to list `agent` first; had it listed
`you` first, every agent edit would have been attributed to the person watching.

Three outcomes now, kept apart, and the source is **stated** on the `Caller`
rather than inferred by comparing id to label:

| claim | identity |
|---|---|
| matches a user by id or name | `user` |
| present, matches nothing | `claimed` — believed and recorded as given |
| absent | `anonymous` |

Believing an unmatched claim rather than refusing it is what the socket already
does with `?author=`, so this makes the two surfaces agree instead of inventing
a third rule. Nothing downstream needs the caller to exist: `sessions.user_id`
and `ops.author` are unconstrained text, and `changes_since` resolves display
names from the sessions table.

The session key is **deliberately not salted** for the anonymous case. Two
callers presenting neither a handle nor an identity are indistinguishable by
definition, so a fresh key would not tell them apart — it would hand one caller
a new client id, lease and undo scope on every call. Sharing is the honest
answer; `sharedSession` reports it and `whoami` is how a caller sees it.

`whoami` exists because an agent invented and called it during experiment 2.
Identity rides on a header and is never a tool argument, so there was no way to
ask — and an edit recorded against the wrong name is invisible until somebody
reads the history.

## What three readers on one document actually collide over

Experiment 7 put three readers in one project holding Revenge of the Mutant
Camels, decrunched — 47KB, roughly ten times Gridrunner, and the first program
here big enough that two readers are not in the same routine merely because there
is nowhere else to be. Every collaboration run before it measured crowding.

**They partitioned themselves, with no machinery for it.** One took the front
end, one the high code, one the data; the third said so in as many words — *"I
lost a race for the code, so I took the data"* — and that was the whole
negotiation. 648 tool calls, unexplained bytes from 40,359 to 13. Nobody asked
for claims or leases, which is the second run in a row to decline the coordination
this file deliberately did not build.

**What they collided over was naming, and it was invisible.** `set_label` is an
upsert keyed by address: it reuses the id already there, so it *renames* rather
than adds. For one author that is the point — `dat_6700` becoming `zoneTable`.
For three it destroyed **123 names across 74 addresses, and told nobody**, writer
or loser. Both got `ok`.

The count understates it, because the losses were **disagreements rather than
duplicates**: `jumpTimer` against `jumpVelocity`, `shotInFlight` against
`laserSoundActive`. Two readers concluded different things about one byte and one
silently won — which is precisely the outcome a shared document exists to
prevent, and the reason a merge should surface a conflict rather than pick.

This is `set_comment`'s history repeating on the object this file states the rule
for *first*: **an address cannot identify a label.** Both times the upsert was
justified by single-author use, both times it survived the arrival of a second
author unrevisited, and both times an experiment had to find it.

**And the first fix was too timid.** Reporting the rename stops the silence and
leaves the destruction. The document could always hold several names at one
address — that is *why* `primaryLabels` exists — so nothing about the CRDT
required a name to be lost. The API was the whole problem, and its shape was the
tell: there were tools to mint a second name, to remove one by id and to choose
which renders, and **no tool to rename one by id at all**. Renaming could only be
done by the address-keyed call, so the destructive path was not the default by
choice; it was the only path.

So there is no "set" for a label any more — and the vocabulary that replaced it
keeps the shape, with `claim` in place of `label` once naming and interpreting
became one act:

| | |
|---|---|
| `add_claim`, `add_claims` | name an address — **always adds, never replaces** |
| `set_claim` | correct what you said, **by id**, one field at a time |
| `remove_claim` | by id |
| `set_primary_name` | the one thing anybody sets, last-write-wins |

Three rules fell out, and two of them came from being wrong first:

- **Even the same name twice adds.** Two labels are told apart by id, and two
  people each making one is simpler than making the second react to a merge they
  did not ask for. Duplication at one address is not ambiguity — the name still
  reaches exactly one address — and this project already tolerates it, ten times
  over in the reference file.
- **Adding pins what was showing**, unless somebody has chosen. Two user labels
  tie on rank so the winner falls to id order, which is random: without the pin a
  second name silently renames every reference to the address. The newcomer adds
  a name; it does not seize the display.
- **Only a name a *person* chose counts as somebody's judgement.** An invented
  `dat_XXXX`, a PRG layer's entry label named after its file, and a region's name
  are machinery, and warning about joining those would be noise on the first day
  of every project.

**An extent was shared state nobody could see.** It reshapes every operand in its
range and any writer can set one, and no read tool reported it: two readers each
hit the same 2K extent on `$1800` and each blamed the other. A field that only
the writer can observe is a field that will be fought over.

Two more worth keeping, both from the log rather than the reports:

- **`select_target` is shared by design, so nobody looked at the loader all run.**
  Reading another view means changing it for everybody, which nobody was willing
  to do — so a whole target went unread. The parked question of whether the
  shared selection would be contended has its answer, and it is not the one the
  note expected: not contention, avoidance. The selection stays shared, because a
  view is a fact about the project; `read_bytes` takes a `target` instead, since
  a read changes nothing and can answer for another view without moving anybody.
  Only the bytes — a disassembly of another target needs its own analysis, which
  is a real cost to spend when somebody asks rather than now.
- **`$A000-$BFFF` is where the flat memory model finally cost something real.**
  Eight kilobytes of zeros in the image, nothing writing `$00`/`$01`, so BASIC
  ROM is banked in and the game's random number generator — eleven callers —
  reads ROM bytes for entropy. re64 cannot see that, and this is the first time
  banking has been a missing answer rather than a hypothetical.

## Chat: the one root the project cannot see

People and agents working the same document need somewhere to talk, and a
message is not an annotation — it describes no bytes, belongs to no layer, and
has no business in a `.re64`. So it lives at a **fifth top-level root**, and that
single decision is what keeps it out of everything else.

`projectFromDoc` is an explicit whitelist of four roots. It never looks at
`chat`, so a message never reaches a `Project`, never reaches the export, never
moves `version()`, and produces no `ops` row. **Nothing was written to exclude
it** — which is exactly why there is a test: a property that holds by omission is
one a later edit can quietly take away, and the first symptom would be somebody's
conversation in a file they handed to someone else.

**Deliberately not an operation.** `src/core/ops` is a closed vocabulary of edits
with computable inverses, and "unsay that" is not one; the boundary test forbids
Yjs there anyway. For the same reason chat is outside the undo manager's tracked
roots, so Ctrl-Z cannot eat what somebody said.

**The trap, and it is the whole reason this needed care.** Every document update
bumps a counter that the browser rebuilds on and the server caches analysis
against. Left alone, *every line of conversation would re-derive the model and
re-analyse the program* — tens of milliseconds and a repaint, per message. Both
sides now check whether the **projection** actually changed before doing the
work, which costs a fraction of a millisecond and catches anything invisible to
the project rather than only the case known today. The browser check is in
`ProjectSession`; the server's is in `Workspace.key()`, which was already
computing the projection and merely keying on the wrong thing.

Messages are plain scalars in a `Y.Map`, never `Y.Text`: `gc: false` is justified
on the grounds that this document holds maps of scalars rather than
character-by-character text, and collaborative rich text here would undermine
that argument for the whole document to make a chat box marginally nicer. The
consequence to know: with collection off, a deleted message stays recoverable in
the update log forever. Chat is not private.

A message records **how its author was named at the time**, rather than resolving
the name on read — a log says who spoke *then*, and looking it up later would
rewrite history every time somebody was renamed. Agents post under their session
codename, because a user id is the same string for two agents sharing one
credential and a person watching needs to tell them apart.

## Undo: two features that must not be merged

- **In the browser**, `Y.UndoManager` scoped to the session. `captureTimeout: 0`,
  because the 500ms default merges anything done in quick succession — right for
  typing, wrong for two deliberate renames. Grouping is expressed by sharing a
  transaction (`applyOpsToDoc`), not by happening to be close in time.
- **In the CLI**, the `ops` table, which applies an inverse as a *new forward
  edit*. `UndoManager` needs a live document and cannot exist in a process that
  starts, edits and exits.

Browser edits get no ops row, so `re64 undo` cannot reach them. Taken
deliberately.

Two details that were not obvious. A description must be attached as a change is
made, since the stack holds structs that cannot say "renamed $8100"; and it
cannot be read off the entry being retired, because `stack-item-added` fires
**before** `stack-item-popped`, so it is stashed before the call. Connection
status must be read from the provider rather than subscribed to, since the
events fire before anything can listen.

**A whole-document PUT conflicts rather than merges.** An agent may send JSON
instead of operations, and it is routed through the shared document as a
synthetic client so connected sessions see it. But a whole document says "make
it look like this", which would revert a concurrent edit it never knew about —
so a stale one gets a 409 telling it to reload or send operations instead. The
version it is checked against is the **document**, not the file: during a live
session the file is stale by design, and comparing it would report "unchanged"
throughout and defeat the check.

**The file has one writer.** Both the socket and HTTP paths write it from the
whole document, never from one caller's own changes, or it would land in a mixed
state with an HTTP write on disk and a socket edit merged a moment earlier
missing. Writing the file and recording history are separate: a save is not a
session, and one history entry per keystroke would defeat the point.

Merge stays server-side, which holds only while the API serves *resolved state*
rather than broadcasting per-user logs. The moment clients receive raw logs they
need merge logic too, and the same code has to exist in both places.

**Open question, deliberately parked (2026-08-22): move to React?**
Not settled. The arguments, so they do not have to be reconstructed:

*For React (with Yjs beneath it):*
- A component library gives **nesting, layout composition, and a consistent
  look across advanced controls** — virtualized trees, data grids, comboboxes,
  context menus. Shoelace supplies widgets but is not a composition system,
  and this is the strongest argument on the table.
- Reconciliation beats the current `renderMap()`, which clears its container
  and rebuilds the whole subtree. Irrelevant at three panels; not irrelevant
  as panels multiply.
- The port only gets more expensive: ~1000 lines of `src/ui/main.ts` today.
- CM6 in React is a solved pattern — mount once into a ref, drive with
  effects, never let React manage its internals. The earlier claim that CM6
  argues *against* React was overstated: it argues against React owning CM6's
  DOM, which nobody proposes.

*Layering, which an earlier version of this file got wrong:*
Redux and Yjs are not alternatives. Y.Doc would hold truth, sync, and
per-user undo (`UndoManager` with `trackedOrigins`, so Ctrl-Z reverts your
edits and not a collaborator's); a store is an immutable projection for
rendering. With Yjs authoritative, `useSyncExternalStore` may remove the need
for Redux entirely. The rule that matters: the projection stays one-way —
Yjs accepts writes, the store only mirrors. Two stores both accepting writes
is the trap; a read-only projection is not.

*Separable and unanswered:* **Yjs vs JSON as the persisted format.** Readable
JSON in git is a real advantage over panopticon's compressed-CBOR blob; Yjs's
native persistence is a binary update log. Keeping JSON means rebuilding the
Y.Doc on load and losing cross-session merge fidelity; keeping the Yjs log
means losing readability and diffs. This changes the file format, so it is
the expensive decision — and it is independent of the React question. React
can land first over the existing fetch-and-rebuild flow.

*How to settle it (planned, not yet run):* spawn one subagent per candidate
library, give each the **same** task — porting the memory map panel is a good
size — and the **same** verification loop, then compare what actually happened:
typecheck iterations, APIs hallucinated, lines written, whether it rendered
correctly first try. Same task and same loop in every arm, or the comparison
measures the task rather than the library.

This matters because the ranking below is *inference about failure modes*, not
evidence. Recorded here so it is not mistaken for a finding:

- What determines whether an AI maintainer gets a library right is whether its
  API lives in **types or in strings**. Typed props fail at compile time and
  cost one iteration; CSS class strings and stringly-typed props fail at
  runtime and cost a browser round-trip. Every error `tsc` could catch this
  session was caught immediately; every one that survived was string content
  (a versioned CSS class dropped from a template literal, blank lines
  stripped by a serializer).
- On that criterion Blueprint drops despite being the best *category* fit: its
  convention is versioned CSS classes (`bp3-`, `bp4-`, `bp5-`, `bp6-`), which
  is exactly the invisible failure mode. Fluent UI drops harder — v8 and v9 are
  different libraries sharing a name.
- Mantine ranks first because its styling is typed props rather than class
  strings, with the caveat that it has nine majors and v6→v7 rewrote styling.
- Whatever is chosen: **pin the version, and verify an unfamiliar API against
  the shipped `.d.ts` in node_modules before using it.** Reading node_modules
  is a cheap check a human would skip, and it collapses the version-blending
  risk.

*Not blocked by any of this, and since done:* annotation edits have undo.
`Mod-Z` / `Mod-Shift-Z` in `src/ui/main.ts`, over `ProjectSession`'s own stack
of operations paired with their inverses — separate from CodeMirror's
`history()`, which covers typing in the project JSON editor and nothing else.

There are buttons for it beside Back, whose titles name what they would revert —
a bare arrow says nothing about whether pressing it undoes a rename or a
deletion.

It is **session-local**: held in memory, discarded on reload, and invisible to
the `ops` table the CLI undoes from. The Debug tab says so in as many words,
because the two stacks looking alike and behaving differently is exactly the
sort of thing to be told rather than to discover. So `re64 undo --any` cannot reach a browser
edit, and a browser cannot reach the CLI's. Closing that means routing UI edits
through the server as operations rather than as whole-document PUTs, which
trades away the property `session.ts` is built around — that a rename shows
instantly and only the save crosses the wire.

## Where complexity belongs: not in the write

A governing rule, and one that arrived after a day of edits drifting the other
way.

> The basic operations that edit the document should be **simple, and have little
> reason to fail**. All complexity belongs in the **analysis** or in the
> **presentation**. Conflict-free merge means a non-ideal state is *reported by
> hygiene* and corrected by whoever is there — not prevented at the point of
> writing.

And the test that decides it, which is sharper than any of the above:

> **What works offline — locally, ignorant of every other edit — must also work
> online. And the reverse.**

There is no second mode. An operation whose correctness depends on having seen
what everybody else did fails the first direction; one that assumes it is alone
fails the second. Both are the same defect, and the test catches things no amount
of reasoning about layers does — it found one within a minute of being written
down, described below.

Three consequences worth stating, because each contradicts an instinct that keeps
resurfacing:

- **A write that refuses is a write that has taken a decision it was not
  entitled to.** There are exceptions — a request that names nothing real, or
  that would destroy data outright — but "this looks wrong" is not one of them.
  The state is allowed to be wrong; that is what hygiene is for.
- **Anything computed to keep the *display* steady belongs in the display.**
  Writing document state so a listing does not change under somebody is
  compensating in the wrong layer, and it makes an edit that could not fail into
  one that has opinions.
- **Two writers producing an untidy document is the expected outcome, not a bug
  to be engineered out.** It converges, it is visible, and somebody tidies it.
  The alternative — every writer checking what every other writer has done — is
  the coordination this project has deliberately not built.

The test to apply: *could this operation fail, and is the reason a fact about the
request or a judgement about the result?* A judgement about the result belongs
somewhere else.

**The first thing the offline test caught, an hour after the rule was written,
was a bug introduced that same day.** Naming a byteless address creates a symbols
layer, and a target is an allowlist of layer ids — so the new layer was being
added to every target by writing each target's layer list. `target.set` replaces
that list wholesale, so two people naming an address at the same time drop one
another's layers out of the view, and a name written offline lands outside a
target made since. Reasoning about which layer the complexity belonged in had not
found that; asking whether it worked offline found it immediately.

The fix removed code rather than adding it: **a symbols layer is never filtered
by a target at all.** It supplies no bytes, so it shadows nothing and occupies no
range, and a target is a view over which bytes you are reading — there is nothing
for it to say about a layer that has none. That is the shape a fix should have
under this rule, and it is a fair signal when it does not.

## Convergence is not atomicity

Yjs guarantees that replicas which have seen the same updates hold the same
state. That is all it guarantees. A `Y.Doc` transaction is **local batching** —
it coalesces changes into one update and one `UndoManager` stack item. It is not
a distributed transaction: no isolation, no rollback, nothing all-or-nothing
across peers. On merge, fields resolve independently, with no knowledge that
three of them were one thought.

So three renames from one peer interleaved with one from another converge to a
state where the group is partly superseded, and nothing in the document
remembers there was a group.

The consequence is the design rule: **grouping is a record of intent, and can
never be a guarantee about state.** That is not a shortfall, because everything
grouping is wanted for — review, undo, explanation — is about intent. It only
looks like one if a transaction was expected.

Two places this bites, both real today:

- **The record is per-op, not per-action.** `runOps` appends one `Change` per
  `Op`, so one `mark_function` producing two ops writes two rows and needs two
  undos. The browser does not behave this way: `applyOpsToDoc` uses one
  transaction, so `Y.UndoManager` treats a call as one unit. Browser undo is
  per-action, CLI and agent undo is per-op. That asymmetry was not chosen.
- **A stored inverse can revert someone else.** Inverses are computed when the
  change is recorded. If A sets `$8870`, B then changes it, and A undoes, A's
  inverse restores the value from before B — silently. Defensible as
  last-writer-wins, surprising as behaviour, and it gets worse per-changeset.

So grouped undo is **partial and reported**: skip any op whose target moved
since, and say so — *"undid 2 of 3; $8870 was changed by marcus since, left
alone."* Better than clobbering, better than refusing.

Grouping lives in the ops log, which is already unified across all four
consumers; the transaction boundary existed and simply went unrecorded. `ops`
now carries `session` and `changeset`, and `changes_since` returns `action` and
the acting codename so a feed groups by decision rather than by operation. If the
history ever has to travel with the project — export, a second server, an
offline browser — it moves into the document as an **append-only** intent log,
which is the one shape that merges without conflict precisely because nothing
is ever overwritten.

## Sessions are leases, and agents should have them

A browser tab is a session: one connection, one client id, one undo stack. An
agent is not. Its edits are attributed by a **string** passed to `runOps`, while
a browser's are attributable at the struct level by Yjs client id — two
mechanisms for one question. Undo compounds it: browser undo is scoped to the
session, agent undo to the *author*, so two agents claiming one identity undo
each other. And agents have no presence at all, so a person watching thirty
names change sees nobody there.

For a project whose premise is four consumers and none of them primary, that is
the wrong asymmetry to leave in.

The fix is to stop treating a session as an artifact of the transport. **A
session is a server-side lease over a document, keyed by whoever presents a
session handle, expiring on idle.** A browser gets one from its socket; an agent
gets one from a header. Both then have a client id, presence, and
session-scoped undo under the same rule.

It is deliberately **not** a session that holds its own document. Agent ops
still apply straight to the room. This is a session for attribution and
presence, not isolation — isolation is what cloning a project is for.

Sessions carry a **codename**, because a person reading a live transcript cannot
track UUIDs.

One consequence that outlives the lease: a session mints a Yjs client id which
is stamped permanently into every struct it writes. The `sessions` table is
therefore the only decoder for who a historical client id was, and **must not be
pruned like a session store** — expiring the lease is not the same as forgetting
what it wrote.

**Built.** `SessionLeases` in `src/server/sessions.ts`, claimed per MCP request.
The handle comes from `Mcp-Session-Id` when the host issues one — the protocol's
own answer to "which instance", so one credential yields many sessions and no
account per agent is needed — or from `X-Re64-Session` when a caller says so
itself.

**Still open, and now free to measure.** Whether N spawned agents are N MCP
clients or one shared client is a property of the *host*, not the protocol. With
one shared client they share a session id, fall back to being keyed by identity,
and collapse into one undo scope. That fallback is marked `sharedSession` rather
than tolerated silently, and the transcript records `clientInfo` and any session
id on every request — so counting distinct ids across the first experiment
answers it without setting anything up. Do not guess it in the meantime.

Note this also means "should agents have sessions" and "should MCP be stateful"
are less independent than the stateless decision above assumed.

---

## `defaultTarget`, and a document field answering the reader's question

**September 2026.** A target is a view over the layer stack, and the rule was
already right: there is no current target on the server, a view is a parameter
of the request, and two browser panes showing two targets are two calls rather
than a setting they fight over.

The document nonetheless carried `defaultTarget`, justified as *"a fact about
the project — somebody handed this file should see what it is for. It is
emphatically not a cursor."* Every call that named no view was then answered
through it. That is a cursor.

Worse, where a project declared none the loader **invented** one, taking the
target with the lowest `order`. The Camels silver image declares five and no
default, so every target-less call was answered through `loader` — a view
linking one layer, in which every claim framed on the runtime layer does not
exist. That is how `add_evidence` came to refuse three writes during the build
with the message that the claims were *retired*: they were not, they were simply
outside a view nobody had chosen.

Two mistakes, and they compound. A document field cannot answer a question about
which reader is asking. And no surface could set it anyway — `meta.set` carried
the key, `doc.ts` carried it in `META_KEYS`, the serializer wrote it, five
readers read it, and no tool, route or UI action wrote it. F1's eleventh
instance, and the reason the silver image could not declare what it was for even
if the field had been the right shape.

### What replaces it

**Nothing, at the document level.** The field is gone from `Project`, from
`META_KEYS`, from `MetaSetOp["key"]`, from the serializer and from the diff.
Which view a session is reading lives in the session: the browser keeps
`viewTarget` and opens on the first target the program lives through, seen by
nobody else and written nowhere.

**Naming no view is refused where there is a choice**, and the refusal lists the
targets. Where there is no choice — one declared, or none, which implies one over
the whole stack — a caller need say nothing.

**And a write that touches no address needs no view at all.** This is the half
that makes the refusal liveable, and it was always the right shape: a type, a
field, a constant, a decoder, a piece of evidence, a layer, a target are edits to
the *document*. They now go through `editDocument`, which never builds a memory
map, and they report no instruction delta — there is no view for the count to be
about, and reporting zero would be a measurement nobody took. `list_types` reads
the document's layouts and omits the addresses they are used at when no view was
named, rather than refusing an answer that mostly did not need one.

The test that this is the right line: the Camels silver image builds end to end
over MCP against a five-target project with no default anywhere — 981 objects,
zero refusals — every view-dependent call naming its target and every
document-level call needing none.

**Still open, and deliberately not done here.** `target` is still declared on all
94 tools, including the ones that now ignore it. A parameter a tool advertises
and does not use is a lie in the one place agents read, so the schemas want
splitting; that is a per-tool judgement over the whole surface and wants its own
pass.
