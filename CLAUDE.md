# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/claude-code) when working with code in this repository.

## Project Overview

re64 is an agentic-first, AI-enabled C64 disassembler. Reverse engineering a
game is a long grind of recognising a routine, naming it, and moving on, and
that is work an agent can do alongside a person rather than instead of one.

Four consumers sit over one store, and none of them is the primary:

| Consumer | For |
|---|---|
| CLI | database visibility, export, patching |
| HTTP API | the low-level web surface |
| Web UI | humans, interactively |
| MCP | agents doing the workflows a human does in the UI |

They share a document, not a file format, so an agent naming a subroutine and a
person reading the same code see each other's work as it happens.

## Architecture

### Directory Structure

- `src/core/` - Platform-agnostic analysis, model, and operations
- `src/store/` - Persistence and the shared document
- `src/client/` - Joining a session; DOM-free, so the browser and an agent share it
- `src/server/` - HTTP, websocket, and `src/server/mcp/` for agents
- `src/ui/` - The browser front end
- `src/cli/` - Command-line interface using Commander
- `assets/` - Example files and project configurations

Keep core/ free of Node.js-specific APIs where possible to maintain web compatibility.

### Conceptual Model

The system has three layers of abstraction:

**1. Memory Map & Layers** - The "physical" layer
- `MemoryMap` contains stacked `Layer` objects (FileLayer, BytesLayer)
- Layers provide actual bytes, stack and shadow each other (top wins)
- This is the raw data being analyzed

**2. Regions** - Semantic "what is this?"
- Define what a range of memory *means* (code, data, text, jumptable, unknown)
- Not backed by bytes - they overlay the memory map
- Sources:
  - Auto-generated from layers via `defaultRegionKind` (PRG→code, raw→data)
  - User-defined in project file (finer granularity, overrides auto)
- Guide the disassembler on how to interpret bytes

**3. Labels** - Semantic "what is this called?"
- Mark individual addresses with names
- Sources:
  - Layer-generated (PRG entry points)
  - Region-generated (named region start addresses)
  - User-defined in project file
- Resolved in instruction operands (e.g., `JSR ROM_CHROUT` instead of `JSR $FFD2`)

### Key Types

```
src/core/
├── memory/
│   ├── layer.ts         # Layer interface, BytesLayer
│   ├── file-layer.ts    # FileLayer (PRG/raw files)
│   ├── memory-map.ts    # MemoryMap (layer stack)
│   ├── label.ts         # Label, LabelIndex, label factories
│   └── region.ts        # Region, RegionKind, RegionIndex
├── arch/
│   └── mos6502/
│       ├── opcodes.ts       # Complete 6502 opcode table (legal + illegal)
│       ├── instruction.ts   # Instruction type, operand formatting
│       ├── decoder.ts       # Single instruction decoder
│       └── disassembler.ts  # Work-queue disassembler
├── c64/
│   └── d64.ts           # D64 disk image parser
└── project/
    └── project.ts       # Project file schema and parser
```

### Disassembler Design

The 6502 disassembler uses a work-queue approach:
1. Start with entry points in the queue
2. Decode instruction at queue head
3. Add control flow targets (branches, jumps, fall-through) to queue
4. Skip addresses in non-code regions
5. Continue until queue is empty

This discovers all reachable code without disassembling data as instructions.

## Commands

- `npm run build` - Compile TypeScript
- `npm test` - Run tests once
- `npm run test:watch` - Run tests in watch mode
- `npm run dev` - Watch mode compilation
- `npm run typecheck` - Type check without emitting

## Testing

Tests live alongside source files with `.test.ts` suffix. Use vitest.

## Guidelines

- Minimal dependencies - only add packages when clearly beneficial. `ses` is the
  second knowing exception, after `@modelcontextprotocol/sdk`: it is bought to
  run **decoders somebody else wrote**, and the property it provides — a
  function with no ambient authority — is not one you can approximate by
  deleting globals, because a constructor chain gets them back. Verified rather
  than assumed: inside a compartment `fetch`, `process` and `require` are
  undefined, `Date.now()` and `Math.random()` throw, and
  `(function(){}).constructor("return typeof process")()` is refused.
  `@modelcontextprotocol/sdk` is the one place this was knowingly spent: **33 of
  the 43 production packages exist only for it**, including `hono`, `cors`, and
  `express-rate-limit`, which npm installs and this code never imports. Bought
  anyway, because the protocol is the point of the MCP surface and
  hand-rolling JSON-RPC framing would be re-implementing a spec that moves.
  It is *dynamically* imported, so nothing pays for it until `/mcp` is used
- Write unit tests for core functionality
- Keep abstractions simple until complexity is needed
- TypeScript strict mode is enabled

## Documentation

- Use TSDoc (`/** */`) for public interfaces and classes
- Document "why", not "what" - let types speak for themselves
- Keep comments minimal; add them for non-obvious design decisions or C64-specific knowledge
- Don't restate what the code or types already say

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

Label priority is explicit rather than insertion order:
`user > region > layer > platform > auto`.

## UI Design Decisions

The eventual web UI is built around a single central widget: a disassembly view
holding assembler lines, comments, cross-reference arrows, and inline editable
elements (labels, comments). These decisions are recorded here because they
constrain the core data model, not just the presentation layer.

### Model-is-truth, not buffer-is-truth

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

### UI stack: web components, no framework

Shoelace (`@shoelace-style/shoelace`) supplies application chrome — split
panels, and later menus, trees, dialogs, toolbars. Components are imported
individually so the bundle carries only what is used. Adoption is incremental:
add a component when a hand-rolled one would otherwise be written.

Rejected: **React with a data-dense component library** (Blueprint, Mantine).
The deciding factor is that CodeMirror 6 is the hero widget and is *already*
reactive — most of `src/ui/main.ts` is `StateField`/`StateEffect`/decoration
code. A framework would insert a wrapper and a boundary at exactly the most
complex point in the app, where CM6 manages its own DOM by design, while its
declarative-render benefit lands on the simplest panels — `renderMap()` is a
few dozen lines of plain DOM building.

Standard DOM is also the cheaper thing to reason about from cold. `<sl-split-panel>`
is an HTML tag: greppable, self-describing, documented outside this repo. A
bespoke component tree has to be reconstructed mentally before anything can be
changed, and this project is worked on in bursts across sessions.

The CRDT counter-argument is real but weaker than it looks: the server is
already the source of truth and the client already re-fetches and rebuilds, so
that *is* the re-render model, only explicit.

Nothing is foreclosed. `dockview-core` is also framework-agnostic, so if panels
later need true IDE docking it drops in beside this rather than replacing it.
Cost so far: +49KB, most of it the one-time Lit runtime.

### Identity, operations, and collaboration

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

### Yjs-first: the document is the project

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

### Storage: one database, many projects

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

### The wire, and the browser

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

### Sessions, not users

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

### Chat: the one root the project cannot see

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

### Undo: two features that must not be merged

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

### Widget: CodeMirror 6, read-only with decorations

Chosen over a hand-rolled virtualized list mainly because of **variable row
heights**. Inline multiline editing (a block comment expanding in place) breaks
naive virtualization: rows growing above the viewport cause scroll jump unless
anchoring is handled explicitly. CodeMirror 6's height map already handles
variable-height lines (soft wrapping produces them constantly) and anchors
scroll position across height changes.

What it provides:
- Virtualization — a full 64K map is tens of thousands of rows.
- Block widgets for multiline inline editors and standalone comment rows.
- Inline widgets for editable label tokens.
- Atomic/read-only ranges so generated assembler text is not directly editable.
- Gutters, for the cross-reference arrow layer.

Consequence: **edit inline, not in popups.** Block comments expand in place as
block widgets; label renames are in-place token editors. Popups/overlays are
reserved for things genuinely outside document flow — the aggregated xref list,
a region-kind picker.

Label editing uses both widget forms, picked by whether a label already exists:

- **Renaming** replaces the label token with an input (`Decoration.replace`), so
  the trailing `:` and xref stub stay put and the row does not reflow.
- **Naming a new address** has no token to replace, so the editor gets its own
  block row above the instruction (`Decoration.widget({block: true})`), indented
  to the label column — the row it is about to become.

Enter commits, Escape reverts, and **blur reverts rather than saving**: an empty
name means "delete this label", so a blur-commit would turn an accidentally
cleared field into a silent deletion.

**Line wrapping is a toggle, off by default** (`w`, or the Wrap button). A
disassembly is columnar and wrapping puts an operand under its own address, which
costs more than it saves on rows that fit; comments are the case it exists for,
since a paragraph about a routine has no columns to protect and is unreadable at
three screens wide. Wrapped rows get a hanging indent so continuations clear the
address column and the comment reads as one paragraph.

It lives in a `Compartment`, because `lineWrapping` cannot be added to a running
editor otherwise and rebuilding the state would throw away the scroll position
and selection while somebody is reading.

Two things that cost a browser round trip to find:

- **CodeMirror owns `view.dom.className` and rewrites it wholesale.** A class
  added with `dom.classList.add` survives until the first update that touches it
  — gaining `cm-focused` on the first click is enough — and then vanishes, taking
  whatever CSS depended on it. Go through `EditorView.editorAttributes` instead,
  inside the same compartment, so the class is part of the configuration rather
  than something applied beside it.
- **A duplicate key in a theme object silently drops the earlier rule.** It is a
  plain object literal, so adding a second entry for `.cm-arrow-gutter
  .cm-gutterElement` would have thrown away its font and padding without a
  warning. Merge, never append.

**Comments are wrapped in the row model, at a fixed column of 100.** A wrapped
line becomes *another comment row at the same address*, identical in every way to
one the author broke with a newline — so there is no continuation row to style,
no special case anywhere, and no way for the two to drift apart.

Three things fall out of putting it in the model rather than the view, and the
first is why it has to be there:

- **The CLI needs it.** A terminal cannot soft-wrap a listing into something
  readable; it needs real rows. Anything living in CodeMirror could never have
  served the consumer that most wants a wrapped comment.
- **The arrow gutter comes out right for free.** It is rendered per row, so a
  comment occupying three rows gets three cells and its verticals connect. A
  soft-wrapped line is still one document line and gets one cell, which is
  exactly where the connector broke.
- **Nothing depends on the viewport.** Wrapping to the window would make the row
  model depend on the window, so every resize would rebuild the document on top
  of whatever selection or inline editor was open. A column is a property of a
  listing, the way it is in a hand-written disassembly.

`AnalyzeOptions.commentWidth` is the seam for configuring it; nothing sets it
yet.

**There was briefly a soft-wrap toggle as well, and removing it is the lesson.**
It was added first, before the model wrap, and once comments wrapped at a column
it had nothing left to do on any normal pane — so it needed a compartment, a CSS
hanging indent, a dimmed-when-idle affordance and a `requestAnimationFrame`
measurement purely to stop looking broken. Machinery accreting around a feature
to make it *appear* to work is the signal that the feature is in the wrong layer.
One mechanism, in the model, serving all four consumers.

Two exemptions it deliberately keeps. An **inline** comment shares its row with
an instruction and cannot be broken, so those rows may still exceed the column —
they are the only ones that do, in the browser and in the CLI alike. And a
**word longer than the width** is left long rather than split, since it is
usually an identifier or an address and breaking it makes it unselectable.

Two gotchas worth remembering:Two gotchas worth remembering:

- A read-only view (`EditorView.editable.of(false)`) is **not focusable**. Without
  `contentAttributes: {tabindex: "0"}`, clicking a line leaves the keymap with no
  listener and every shortcut silently does nothing.
- Widgets holding form controls must return `true` from `ignoreEvent()` and stop
  propagation on keydown, or the editor's own keymap eats the typing.

Operands pointing outside the loaded map — zero-page variables, I/O registers,
KERNAL entry points — render as plain grey names rather than links. They are
named but have no bytes, and on 6502 they are common enough that making them
clickable means constantly landing on an error.

### An operand inside a named array

The reference writes `LDA SCREEN_RAM + $000F,X`; re64 wrote `LDA dat_040F,X`,
losing that the operand indexes the screen at all. Forty-one sites in this one
game, and every screen coordinate had to be recovered by hex arithmetic.

The mechanism was already there and already applied to loads and stores —
`LDA droidXPositionArray-1,X` has always rendered. What stopped it was
`labelTolerance`, which defaults to **1**. Raising it is the wrong fix: a
distance threshold has no notion of whether an offset means anything, and at a
window wide enough to reach `$040F` from `$0400`, every address in the program
would borrow whatever name happened to be near it. That is the mistake that was
just removed from zero page.

So a label may declare an **extent** — how many bytes the name covers. Inside
it, an operand renders as `NAME + $000F`; outside, nothing. Either the operand
indexes that array or it does not, and there is no threshold to tune.

Two rules that took running it to find:

- **An extent beats an invented name, not a chosen one.** `dat_040F` is an exact
  match and would win by ordinary resolution, but it says nothing where
  `SCREEN_RAM + $000F` says which screen cell. A label a person put at that exact
  address stays, because they put it there on purpose.
- **Innermost wins** where arrays nest, so a row inside a screen is named for the
  row.

Extent does not replace tolerance. `table-1,X` encodes an operand *before* the
label — the 1-indexed table idiom — which no extent covers, so the ±1 window
stays. The two render differently on purpose: `NAME + $000F` says "element N of
this array", `NAME-1` says "just before this label", and they should not look
alike.

### Constants: a value has no single meaning

A label names an address and an address means one thing. A constant names a
**value**, and a value does not. The reference disassembly settles this by
itself:

```
LEFT_ZAPPER   = $01        WHITE = $01
BOTTOM_ZAPPER = $02        RED   = $02
```

The same number carries two names in the same program, so there is no
value-to-name map to be had and **nothing infers one**. `LDA #$01` stays `#$01`
until someone says which of the two they meant. That is the same stance taken
everywhere else here: an explicit gap beats a confident wrong answer.

So it is two objects, which is what an assembler's equate and its source text
already are:

- **A declaration** — `{id, name, value}` — at **project** level, beside
  `primaryLabels`. It describes no bytes, so there is no layer for it to move
  with when the stack is reordered.
- **A use** — `{id, address, constantId}` — in the **layer** holding that
  instruction, because it is about those bytes.

Keyed by address with no operand slot, because the 6502 has exactly one
immediate addressing mode out of thirteen and no instruction takes two
immediates — so the "which operand" index that would make this a mess does not
exist on this architecture. Keying by address also leaves `.BYTE EXPLOSION1`
reachable later without changing the shape.

**A dangling use renders the literal.** Delete a declaration and every site
bound to it falls back to `#$08` rather than breaking. Same rule as a dangling
`primaryLabels` entry: deletion needs no sweep, and a delete racing a bind heals
itself.

**The equate block is derived, never stored.** `ConstantIndex.used(within?)`
returns the constants actually meant inside a span, so a listing's block stays in
step with the bindings by construction — and exporting one layer can emit just
what that layer means. The consequence, worth saying out loud: a declared but
unbound constant does not appear in a listing. Nothing is lost, because the
`.re64` holds declarations explicitly and is the export that round-trips; the
listing is a listing.

Naming a value is a judgement, so both consumers get the same shape of help
rather than an answer: `find_immediates(value)` returns every site loading it
with whatever is already bound there, which is the query behind a dropdown for a
person and a batch for an agent.

### Naming what has no bytes

`set_label` on zero page used to be refused with "add a layer of type symbols"
— advice the API had no tool to follow. On a 6502 program every variable lives
in zero page, so it made roughly half of what a person contributes to a listing
impossible to say.

The model already had the answer: a `symbols` layer names addresses with no
loaded bytes, and the built-in C64 table is one. So naming or commenting an
address nothing owns **creates one**, in the same action, and says so in the
result. `add_layer` exists for choosing its name or keeping a second set apart.

Creating rather than relaxing ownership. The rule that an annotation belongs to
the layer supplying its bytes is what makes reordering the stack move
annotations with the content they describe; letting anything hold anything
would bring back precisely the bug it prevents.

Two things this needed that were missing and would have been missed:

- **`diffProjects` did not diff layers.** It compared labels, regions and
  comments only, so a label written into a freshly created layer produced an
  operation naming a layer the exported file did not have. Layer additions come
  first and removals last, since a label needs its layer to exist and a layer
  must be empty before it goes.
- **`insertLayer` was not idempotent.** Undo checks whether replaying an
  operation forward changes anything — if it does, someone else has been there
  and the stored inverse no longer means what it said. An insert that appended a
  duplicate rather than doing nothing failed that check, so creating a layer
  could never be undone.

An empty symbols layer is now legal. It used to be refused as "almost always a
mistake", which stopped being true when one could be created deliberately and
exists for an instant between adding the layer and putting the first name in it.

**Fuzzy label matching is off below `$0100`.** Every byte in zero page is its
own variable, so a neighbour's name is not a near miss but a different thing:
`$1A` rendered as `laserAndPodInterval+1` where the reference calls it
`leftLaserYPosition`. The raw address says less and says nothing false. Above
the first page an offset usually does mean "just inside this table", so those
stay.

### Comments are objects, not a field on something else

A comment has an id and an address, like everything else that can be edited.
It was a field on a label, which meant a comment could not exist anywhere a
label did not: commenting an instruction meant inventing a name for it and
putting a name in the listing nobody wanted there. The field was also dead —
stored, carried through the model, rendered nowhere, and used by no project.

**Placement is the only axis**, `before` or `inline`, and length follows from
it. A `before` comment owns its own rows and may run to several lines; an
`inline` one shares a row with an instruction and therefore cannot. Treating
"long" and "short" as a separate field would permit a long inline comment,
which has no rendering.

`before` renders *above* the label, because the comment introduces the routine
and the label is its name — which is how a hand-written disassembly reads.
`after` renders below the row, for an observation about what happens next: the
reference writes `;Returns` under a `JMP`, and inline would attach that to the
jump itself and say something slightly untrue.

**Every comment at an address is shown, and there is no index choosing one.**
`primaryLabels` exists because operand rendering must substitute exactly one
name for an address: a forced single choice, where concurrent promotions would
otherwise both stand with nothing able to repair it. Nothing forces a choice
here, so the same machinery would have no consumer. Two comments are both
rendered, ordered by id — arbitrary, but stable and identical on every peer
without coordination — and a second inline comment is indented under the first,
where the redundancy is visible enough that whoever sees it removes one.

**Adding and revising are different operations, and conflating them cost real
work.** There used to be one `set_comment` that matched by `(address,
placement)` and reused the id it found — an upsert keyed by *slot*, justified as
"one person changing their mind rather than two comments". True of one author.
False the moment there are two, and the justification was never revisited when
collaboration arrived: in experiment 3 an agent's `before` comment silently
replaced another's, and **three of the four readers across two runs** invented
the same bad workaround — using the `inline` slot as a second channel to dodge
the collision, which corrupts what placement *means*. One asked for
`append_comment` by name.

The model always supported this. Several comments at an address are all
rendered; only the write path could not reach it. So the vocabulary is
`add_comment` (mints, never overwrites, returns the id), `list_comments`
(returns ids, or nothing downstream is reachable), `edit_comment` (by id) and
`remove_comment` (by id) — which is this file's own identity rule finally
applied here: *an address cannot identify a comment*, for exactly the reason it
cannot identify a label.

**Order is a field now, because arbitrary-but-stable stopped being enough.**
Ordering was by id: identical on every peer, which is what merge needs, and
meaningless, which is fine while an address carries one comment and useless once
adding freely and arranging later is the *intended* flow. `reorder_comments`
takes the ids in the order wanted rather than nudging one past another, so the
result does not depend on what the caller believed the order was; ids left out
keep their places after the ones named. Last-writer-wins per comment, like every
other field here — two peers arranging one address concurrently converge on
something neither chose, which for prose is untidy rather than wrong.

**A description is not a comment, and the difference is where it lives.** The
built-in C64 table carried a one-line gloss for every symbol — `CHROUT`, "write
byte to output channel" — and `createPlatformLabel` dropped the argument, so all
382 of them reached no consumer at all. The fourth instance of the shape this
file keeps recording: the vocabulary being closed is checked by the compiler, and
whether anything ever *reads* a field is not.

Making them `Comment` objects was the obvious fix and is wrong. A comment is what
somebody wrote about an address **in this project**; this is what a name means on
this **machine**, and it travels with the name. The practical difference decides
it: nothing supplies the bytes at `$FFD2` in an ordinary game, so a comment there
would render nowhere — while `description` on the label is reachable everywhere
the name is, which is what `list_labels` now returns.

It does not reintroduce the field that was removed from labels. That one was the
*only* home for a comment, so commenting an instruction meant inventing a name
for it. Comments are still their own objects and still reach any address; this
carries documentation for names the project did not choose.

In a listing it renders directly above its own label row — below any `before`
comment, since what somebody wrote about this address outranks a built-in gloss.
On Gridrunner that changes nothing, because the game's KERNAL calls point outside
its own map; on a project holding the ROM, every entry point introduces itself.

A **region's** `comment` is deliberately not this. It describes a span and is a
property of the region object alongside its name — but it renders in the listing
too, where the region begins, because a description that appeared only in the
memory map made `set_region comment:` look like it had worked and then show up
nowhere a reader was looking.

Data rows break at a region boundary as well as at a label or a comment. They
chunk in eights, so two adjacent regions shared a row and the distinction
somebody drew between them was invisible.

Comments belong to layers, like labels and regions, so reordering the stack
moves them with the bytes they describe — and so a comment on zero page needs
the same symbols layer a label there does.

One consequence in the row builder: a data run breaks at a commented address as
well as at a labelled one, or a comment written about an address inside a chunk
would be swallowed by the row and appear nowhere.

### Label types are backend concepts; the UI exposes one

The four label types are genuinely distinct concepts, even though the
disassembler currently treats three of them identically (all get queued):

- `entry` — where execution *starts*. Emitted by a layer or region, not by the
  user: a PRG layer sets `defaultRegionKind = "code"` and labels its load
  address. No caller, no return contract.
- `function` — a subroutine, from analysis (a JSR target) or declared by the
  user. Has callers and a return contract.
- `code` — a branch or jump target found by analysis. Intra-function.
- `address` — a named address, not queued. The default.

Do **not** collapse these because they behave alike today. That sameness is an
artifact of the disassembler only ever queueing them; they diverge as soon as
there is call-graph or basic-block analysis, which is where the information
would be needed and no longer recoverable.

The UI exposes only `function` (`f`), because that is the one a user reaches
for while reading code — promoting a `loc_` they have recognised as a
subroutine, or declaring one nothing references so it gets decoded at all.
`entry` and `code` render as read-only tags so the analysis stays visible. The
project file remains the escape hatch for anything else, including
hand-written `code` labels. General capability in the backend, common cases in
the front end.

Auto-generated names encode their type in the prefix:

```
sub_XXXX → function    loc_XXXX → code    dat_XXXX → address
```

So promoting an auto label renames `loc_XXXX` to `sub_XXXX`; leaving the old
prefix would contradict the tag. This cannot collide with auto-labelling,
because an auto name always encodes its own address and any existing label at
that address suppresses generation there (`allLabels.resolve(...)` short-circuits
the loop). Clearing `function` from a label still carrying an auto-shaped name
deletes it outright rather than leaving a redundant untyped entry; a name the
user chose is kept and only its type is cleared.

### Cross-reference arrow rendering

Two distinct styles, to keep the gutter from filling with long parallel lines:

**Nested margin arrows** for local references. 6502 relative branches are
limited to −128..+127 bytes (~40–60 instructions), so a `branch` reference is
*structurally* guaranteed local and always renders nested. Absolute `call`,
`jump`, and `data` references are usually distant.

**Open-ended stubs** for distant references: a short stub with a label, click to
jump. Both directions must be rendered — outbound (`▸ DrawGrid`) at the source,
inbound (`◂ from $8A12`) at the target. The inbound side is what reveals "this
routine has callers" when sitting at a function head.

Rules:
- **Classify by address distance, never by viewport.** Viewport-dependent
  classification makes arrows flip style while scrolling, reflowing the gutter
  and shuffling lane assignments under the cursor. Distance-based
  classification is model-derived, stable, and cacheable; nested arrows simply
  clip at the viewport edge.
- Threshold ~100 rows. Given the ISA, this only arbitrates same-page `JMP`s and
  near data references.
- **Lane allocation** is interval-overlap, ordered **shortest span first**: each
  arrow takes the innermost lane no overlapping arrow already holds. Ordering by
  length is what produces correct nesting — an arrow contained inside another is
  necessarily shorter, so it claims the inner lane and forces its container
  outward. Do *not* sweep by start address: that classic interval-graph greedy
  uses fewer lanes but inverts nesting, because an enclosing arrow that merely
  begins earlier steals the inner lane from the short arrow inside it.
  Endpoints touching counts as overlap, since two corners would land in one
  cell. Cap at 4–6 lanes; anything needing more demotes to a stub, which is what
  permanently bounds gutter width. Long arrows demote first under this ordering,
  which is the intended bias.
- **Aggregate hot targets.** A common subroutine may have dozens of inbound
  references; collapse to a single `◂ 14 refs` stub opening a popover list.
- Stub labels use the target's resolved label name, falling back to the address.
- Clicking a stub pushes onto a **navigation stack** — back-jump is the most-used
  key in any disassembler.
- Data references get no arrow at all. Only control flow (branch/jump/call) is
  drawn; data refs would fill the margin with noise.

Lane allocation and gutter rendering live in `src/core/view/arrows.ts`
(`allocateArrowLanes`, `renderArrowGutter`). They are model-derived and pure, so
the **CLI draws the same gutter as the web UI** — `formatRows()` prefixes it,
and `--no-arrows` turns it off. Box-drawing glyphs need no special handling in
a terminal. The gutter arrives as one pre-rendered
string per row, kept out of the document so copying disassembly does not drag
box-drawing characters along.

One rendering gotcha: box-drawing glyphs fill their em box, not the taller line
box, so unscaled verticals show a gap at every row boundary. The gutter span is
stretched with `scaleY` to make segments meet.

### The Debug tab

Application state in one place, because the interesting parts are split across
two machines and neither can see the other. The undo stack, the analysis
timings and the fetched blobs are the browser's; the CRDT document, the crash
log and the durable undo record are the server's, reached through `/api/debug`.

It is laid out so **disagreement is what shows up**: the document version beside
whether it matches this browser's, the base revision beside the stored one. A
value on its own means little; a pair that has drifted apart is the bug.

Two entries earn their place by naming things that are otherwise invisible:
*unreplayable updates*, which is non-zero only when someone wrote around the
document, and *shared with this browser: no*, which is the honest answer about
the two undo stacks.

The snapshot is a copy. A panel that could reach into the live arrays would be
able to corrupt an undo stack by being looked at, and `session.debug()` is
tested for that.

### Layers list, regions tree

The memory map is a **sidebar beside the disassembly**, not a tab. It is
context for reading code — which layer supplies these bytes, why this span is
text — so it has to be visible *while* reading. As a tab it forced a mode
switch to answer a question about the line under the cursor. It is a resizable
`<sl-split-panel>`; collapsing is a zero-width split, so dragging the divider
to the edge and pressing the toolbar button reach the same state, and the width
you chose is still there when you reopen it. Both are remembered in
`localStorage`, with every access wrapped because storage throws outright in
private windows and when site data is blocked.

It renders two different relationships in two different shapes, because they
are not the same relation:

- **Layers stack by z-order**, which is a *list*. Order is meaningful and
  editable; a tree would imply containment that does not exist.
- **Regions contain one another by address range**, which is a *tree*. Drawing
  it makes the override visible — why $8080 reads as text inside a code layer.

**Layers are numbered from the bottom** — the platform layer is level 0, and
higher numbers sit on top and shadow what is below. Do *not* surface
`MemoryMap`'s array index, which counts from the top because that is the order
bytes are searched: that is an implementation detail, it puts the foundation
layer at the highest number, and it reads in the opposite order to the project
file, where layers are declared bottom-up. The list is laid out with CSS
`column-reverse` so the stack reads the way it stacks.

The tree is derived at render time (`buildRegionTree` in
`src/server/map-view.ts`), never stored. A stored hierarchy would make
concurrent edits reparent nodes, which is exactly what the flat model avoids.
Regions that merely overlap without containment stay siblings rather than being
forced into a parent, since the model permits overlap and hiding it would
mislead.

D64 detail is a *property of a layer*, not a level of nesting: a layer sourced
from `disk.d64:filename` shows the image and file name. Modelling disks as
containers would be a real change to `FileLayer` and the schema, and nothing
needs it yet.

### Rendering under a live collaborator

**Repaints are deferred entirely while an inline label editor is open.** Blunt
and deliberate: a repaint replaces the document and rebuilds decorations, which
would pull the field out from under someone mid-word. The disassembly view is
not a collaborative text buffer and must not start behaving like one.

It also makes a latent bug unreachable — `LabelEditWidget.eq` compares by label
*name*, so a remote rename of the address being edited would rebuild the widget
even if editor state survived. Anyone removing the deferral has to fix that, and
must anchor on the **label id**: several labels can share an address, so an
address cannot identify one. Only the "naming a new address" case may key on an
address, because no label exists there yet.

Repaints otherwise coalesce on `requestAnimationFrame`. A hidden tab gets no
frames, so a remote edit arriving while nobody is looking waits until the tab is
looked at again — wanted, since re-analysing an invisible view is pure cost, but
it makes a background tab inspected programmatically look like a broken sync
when the socket under it is fine. That cost an hour once.

`analyze()` runs per
update with no incremental path — about 10–20ms for Gridrunner. If it ever
exceeds ~30ms the UI will stutter under a collaborator regardless of how the
document is updated, and that is the number to measure before optimising
anything else.

## Agents as a first-class consumer

### The read side was the thing missing, not the write side

The mutation side was already agent-shaped: `src/core/ops/` is a closed
vocabulary of operations targeting objects by id, each with a computable
inverse. The read side was not. `analyze()` computed the instruction map, the
reference map, and the merged label index *including* the auto-generated
`sub_`/`loc_`/`dat_` names — and then discarded all of it, returning rendered
text rows with character offsets. Of seven questions an agent needs answered,
exactly one had a reachable home.

So `src/core/analysis/program.ts` keeps what was being thrown away, and
`analyze()` renders over it. `AnalysisResult` is deliberately **unchanged**:
`src/ui/main.ts` holds it for the life of the view, and folding an
`InstructionIndex` into it would make every browser retain about 8MB it never
reads.

**Basic blocks exist** (`src/core/analysis/blocks.ts`): straight-line runs with
one way in and one way out, each carrying its successors, what it calls, and how
it leaves. 364 of them on Gridrunner, median three instructions. Derived and
never stored, like the region tree.

They are the floor for four things, not the answer to any of them yet. A
function's extent still needs grouping blocks by a call graph and dominators;
what a routine calls outbound needs the same. A wrong extent is not visibly
wrong, so neither is guessed — an extent can be *declared* on `mark_function`,
which is a different act from inferring one.

**Control enters a block only at its start, never in the middle.** That is the
whole point of the definition rather than an incidental property: it is what
lets an analysis treat a block as one transfer function, with inputs fixed at
entry and everything inside ignorable. SSA needs it outright, because phi-nodes
sit at block entries and nowhere else.

Holding it means splitting at more places than a loose definition would:

- every jump and branch **target**, so nothing lands inside a run;
- what follows a **branch**, which is reachable both ways;
- what follows a **call**, because that is where the call returns to. A `JSR`
  therefore ends a block. The looser convention treats a call as an opaque
  instruction and keeps the run going, which puts the return edge in the middle
  of a block. On this machine it earns its keep twice over: arguments travel in
  A, X and Y with no calling convention, so "what does A hold after this call"
  is precisely the question a boundary exists to ask.

A `ret` is an **exit of this graph**, which is intraprocedural — not a claim
that control goes nowhere. The return edge is real and belongs to the call
graph, computed from call sites, because one `RTS` returns to as many places as
the routine has callers and the block knows none of them. A call's successor
*is* recorded, as the address it returns to; that assumes it returns, which is
stated rather than hidden, because a routine that never returns would otherwise
make the rest of its caller look unreachable, and that is the worse lie.

**And on this machine even that edge cannot be assumed**, which is why each
block carries a `stackDelta`: net bytes left on the stack, computable *exactly*
because a block is straight-line — no branch inside one for the count to depend
on, which is a dividend of splitting strictly. Undefined after `TXS`, which sets
the pointer outright and where saying zero would be a guess.

An ordinary routine ending in `ret` is `-2`: the return address it pops.
Anything else has been at the stack deliberately. Gridrunner has two of 62, and
both are real:

- `$83E2` `PLA TAY PLA TAX PLA RTI` — an interrupt handler restoring registers.
- `$87FE` `PLA PLA RTS` — a routine that **discards its own return address** and
  returns to its caller's caller. Any call graph assuming the ordinary return
  edge is wrong about this one, and the human reference does not remark on it.

Two more blocks have an unknowable delta. That is four addresses in the program
where interprocedural reasoning has to be careful, found by counting, and worth
having before a call graph rather than after.

The invariant is asserted against Gridrunner: every control-flow edge lands on a
block start, zero exceptions, data references excluded since reading a byte
inside code is not control arriving there. It caught a real bug when first
written — `JMP` to the immediately following address had its target discarded by
a filter meant to remove fall-through, and a jump has no fall-through to remove.
450 blocks, exits: 154 branch, 95 call, 69 jump, 70 fallthrough, 62 ret.

An extent can be **declared**, though, which is a different thing from inferring
one: somebody reading the code knows where the routine ends. `mark_function`
takes it, and it is what lets `find_references` say which routine a call came
from. Without one that answer falls back to the nearest preceding flow label,
which on a real routine is usually a local branch target — so "who calls this"
came back naming `b81BC` for two call sites both inside `DrawGrid`.

### What a routine touches

The question naming one requires, and the first answer here that crosses a call.
Everything it needed already existed — blocks with the strict definition, a
lifter over the documented instruction set, and `blockEffects` reading a block's
reads and writes off its operations. Four decisions, each settled by measuring
the reference project rather than by argument:

**The extent is derived, and a declared one would be actively wrong.** Not merely
coarse — *wrong*: 20 of 50 routines here are not one contiguous span, and the
worst tail-jumps across a 2602-byte hole. One real answer has **twelve** spans
between `$8015` and `$8DCA`. A declared extent is a single range and cannot say
that, so `mark_function` does not need one — which also frees the label field it
was sharing with array extents, and with it the bug where declaring a routine
turned `BPL loc_8050` into `BPL UpdateExplosion + $0010`.

**It answers the complaint it was built for.** `find_references` had to be told a
routine's extent to say which routine a call site sat in, and without one fell
back to the nearest preceding flow label — a local branch target on any real
routine. Reader-3 in experiment 2 got 20 of 35 callers of one routine attributed
to `loc_XXXX`. Deriving the routine needs nobody to declare anything: all 35 now
name a routine entry, none a branch target.

**Ownership is not a partition and does not need to be.** 87 of 431 blocks are
reachable from more than one entry — the shared-tail idiom, one block reached
from five routines. For a *may* answer that is fine: effects are a union over
what is reachable, and over-approximating is the sound direction. No dominators,
no arbitrating who owns a shared tail.

**A tail jump ends the routine**, and this was wrong first — badly, and in a way
worth keeping written down. The walk originally followed jumps through on the
grounds that control really does go there and never comes back, checked against
"does any routine swallow the program" (no: median 5 blocks, largest 93 of 450).

That was the wrong check. The same structure was then used to answer *which*
routine an address is in, which needs exactly one answer, and there it failed:
seven routines claimed `$8393`, one routine absorbed 26% of the program, and on
a project nobody had annotated yet **every SID write in the game reported as
being in `ColdStart`**. Two readers in the second run of experiment 2 reported it
independently and one diagnosed it exactly — the game's top level is a `JMP`
chain, not JSR/RTS, so a flow-derived extent merges it.

The boundary is the instruction: a `JMP` transfers and never returns, while a
6502 branch reaches ±127 bytes and is structurally local — the same fact the
arrow gutter relies on. Bounding there took the largest routine from 26% of the
program to 5% and left four ambiguous addresses instead of 764. The symmetric
half is that a jump *target* becomes a routine of its own, or a `JMP` chain
would be a program in which no address is in any routine.

Nothing is lost: the target is recorded as `continuesInto` and its effects fold
into `total`, exactly as a callee's do. What changes is that the extent stops.

**Membership is asked of blocks, never of spans.** A span is a merged contiguous
range, and two routines whose blocks interleave have overlapping spans while
sharing no block — which turned an exact question into 272 false ambiguities.
`spans` shows a reader where the code is; `blockStarts` decides what belongs to
whom.

The visible cost, worth stating: attribution now names `loc_XXXX` where it used
to say `MaterializeShip`, because the call site is in a smaller jump-bounded unit
inside it. That is precise rather than recognisable, and it is a *different*
thing from the original complaint — those `loc_` names are jump targets, real
units nobody has named, where the old wrong answer named branch targets, which
are not units at all.

**May, never must.** A union is always answerable; an intersection over paths
often is not, and a "must" that is quietly sometimes a "may" is worse than not
offering one.

Two details worth keeping. The interprocedural pass is a **fixpoint** rather than
one bottom-up sweep, even though this call graph is acyclic — a program that
calls itself is ordinary, and a walk assuming otherwise would not terminate.
And `PC` and `SP` are **left out of the reported sets**: every `JSR` and `RTS`
moves both, so including them would put the same two entries on the answer for
essentially every routine. Neither is a data effect, which is the question being
asked — where control went is the exit and the call list, and what happened to
the stack is `stackDelta`, which says more than "touched" ever could.

**How a routine leaves is derived, not flagged as uncertain**, and the stack
delta already determines it — but only when **accumulated from the entry**.
Three things had to be right, and each was wrong first:

- **The expected depth depends on the return instruction.** `RTS` pops two bytes,
  `RTI` three. Comparing everything against `-2` reports every interrupt handler
  in every program as broken.
- **A block cannot be judged alone.** A handler saves its registers in one block
  and restores them in another, so the returning block is three bytes short and
  looks wrong while the routine is balanced.
- **A call is net zero.** `JSR` pushes a return address that the callee's `RTS`
  pops again. Counting the push makes every routine look two bytes deeper per
  call it makes — which is how this first produced *48 findings across 50
  routines*, one of them "30 bytes deeper" for a routine that simply made
  fifteen calls. The implausible volume was the tell.

With all three right it reports **five** things about Gridrunner, and they are
all real: two routines that reset the stack pointer outright and abandon their
call chain, and three that return to their *caller's caller*. `$87FE` is the
`PLA PLA RTS` this file already knew about; the other two were invisible before,
because the pops and the return sit in **different blocks** — `$8A2F` discards
the address and `$8A41` returns, eight blocks apart.

A caller is told too: a callee that returns past whoever called it means the code
after that `JSR` is not reached through it, which the caller cannot see for
itself and which the block graph assumes otherwise.

What it still cannot see: an instruction with no modelled semantics leaves both
sets short by an unknown amount, and reachability is static, so a computed jump
leads somewhere no walk follows.

### The server analyses now, and that is a reversal

The old rule was that the server does not know what a 6502 is. That was about
*interactive latency* — do not round-trip to rename a label — and the browser
still analyses locally and is untouched. But an agent has no local analysis, so
the server grew one, cached per document version and computed only when a tool
asks. It is lazy because it is synchronous: an uncached analysis on the event
loop stalls every connected browser's socket, which is why the O(n²)
`findOverlap` had to go first rather than after.

### MCP lives inside the web server

Not beside it. An agent's edit goes through the same `runOps` a click does and
broadcasts on the same socket, so it lands in an open browser without a reload —
verified end to end, at the definition and at every call site. A separate MCP
process would have had to become a client of this one to achieve that, which is
the same thing with a hop in it.

The transport is **stateless**: what is turn-based is an agent's attention, not
its socket — the client process is long-lived and could hold a stream, so this
is a choice rather than a constraint, and the earlier wording claiming otherwise
was wrong. It costs a fresh `McpServer` and transport per request, which is the
SDK's own pattern for the mode — reusing one silently answers nothing after the
first, so a test sends two requests to hold that.

**Identity rides on the `x-re64-user` header, never in a tool schema.** A model
can omit a parameter, invent one, or claim to be someone else, and removing the
parameter later breaks every schema carrying it. Real auth replaces
`resolveCaller` and no tool changes. It is the same unverified claim the socket
already accepts.

### The tool vocabulary

Orient, read, decide, act, catch up:

| | |
|---|---|
| `list_projects`, `describe_project` | what is here, and how far along it is |
| `read_disassembly`, `list_labels` | structured rows, never rendered text — an agent cannot use character offsets into a text column |
| `find_references`, `find_unnamed`, `find_instructions`, `call_graph` | who calls this, what touches the SID, and the shape of the whole |
| `effects` | what code at an address touches, over a scope the caller names |
| `run_block` | what a routine *does*, by running it |
| `set_label`, `remove_label`, `mark_function`, `unmark_function` | naming |
| `set_region`, `remove_region` | exposed to agents **before** the web UI; the ops and the CLI already did this, so it was wiring rather than new capability |
| `list_decoders`, `set_decoder`, `remove_decoder` | decoders the project carries |
| `undo` | the same inverse the CLI and the browser use |
| `changes_since` | what happened while the agent was not looking |

Three things the tools say about themselves, because a confident wrong answer is
worse than a gap:

- **Every write returns an instruction delta.** `mark_function` on an address
  nothing reaches reports `delta: 3` — the decision decoded three instructions
  that were invisible before. That is the feedback that tells an agent its
  judgement was worth something, and it is why the tool returns more than `ok`.
- **`find_references` states its own blind spot on every answer.**
  `extractReferences` handles absolute addressing only, so a routine reached
  through zero-page or an indirect jump appears to have no callers. An agent
  that trusted it silently would conclude the opposite of the truth.
- **Auto-generated labels are marked `writable: false` and their ids withheld.**
  Those ids are derived, not stored. Handing one to a model invites a write
  carrying an identity nothing owns.

### Asking what a routine does, two ways

The read tools answered what code *is* — rows, labels, references. None answered
what a routine *does*, which is what naming it requires. Two tools, deliberately
kept apart, because they answer different questions with different standing:

- **`effects` at `follow: "block"`** is static: what the block at an address
  reads and writes, unioned over its lifted operations. True for every input.
  Sound only because a block is straight-line, which is the analysis dividend of
  splitting strictly — at calls and at every jump target — rather than loosely.
- **`run_block`** is concrete: execute it with values the caller chose. It
  reports the address a computed operand *actually reached* — with `X=2` the read
  was `$1502` — which is the question no static reading can answer, and it
  reports which way the branch went, which turns a conditional into a decision
  you can watch being made.

**One block, and not a routine.** A block has no branch inside it, so the
instructions that run are known before it starts and no path is chosen on the
caller's behalf. Running further means following jumps whose targets depend on
state nobody supplied — an emulator, with everything an emulator has to be right
about. The scope is what makes the answer honest, not a limitation to be lifted
later.

**Every value says where it came from, three ways**, because collapsing them
would let the weakest borrow credibility from the strongest:

| | means | worth |
|---|---|---|
| `given` | the caller vouched for it | as good as the caller |
| `image` | the program as loaded | true of a constant table; usually false of anything initialised at runtime |
| `unknown` | nothing knew | read as zero, and zero produces a real-looking result |

The last two each raise their own warning. A result that silently assumed zeros
looks exactly like one that did not, which is the failure mode worth spending
output on.

A label is attached to a read only on an exact match or *inside a declared
extent*. `explosionXPosArray` declares none, so a read of `$1502` is reported
bare rather than as `+2` — the same rule operand rendering follows, and a reason
for an agent to declare extents.

### A schema is not covered by testing what it calls

Both `run_block` bugs got through a green suite, and the reason is structural
rather than an oversight: `Workspace` is tested thoroughly and network-free, and
the schema in front of it was tested by nothing. Everything the tests exercised
worked perfectly; the tool could not be called at all.

- `z.record` over an enum of the register names makes every key **required**, so
  passing one register was rejected for omitting the other ten.
- Byte values had to be numbers while addresses could be `$8100`, so the API was
  inconsistent with itself and every caller found out by being rejected.

Neither is visible from inside. Tool schemas are now exercised over the real
transport in `src/server/mcp/transport.test.ts`, which is the only layer where
this class of bug exists. The rule that follows: **if a tool grows an argument,
it grows a transport test**, because "the logic is tested" is exactly the belief
that let these ship.

### What belongs in the vocabulary, and what does not

A tool earns its place by being **reusable**, not by being cheap. The analysis
behind one may be arbitrarily expensive — `effects` walks a call graph to
a fixpoint — and that is fine. What disqualifies a tool is answering *one
project's question*: `do_the_work_for_me()` wearing a specific name.

One useful signal, not a rule: **would you put this in a human's UI?** It is
quick to answer and it fires reliably in one direction — a capability a person
would reach for is a capability. `find_bytes` is a hex-editor staple and belongs
in a search box as much as in a tool call. `find_table_users` is not something
anyone would put in a menu; it is `find_instructions` with a range, once the
addressing modes are handled, and `find_hardware_access` failed the same way and
was folded in.

**A negative answer proves nothing**, and treating it as a test would delete
several tools that exist for good reasons. Agents genuinely differ from people:

- **They cannot see.** `read_disassembly` returns fields rather than rendered
  text because character offsets into a column are useless to a caller — that is
  the finding the whole MCP surface was built on. `whoami` exists because a
  person sees the identity picker and an agent sees nothing.
- **They are not pushed to.** `changes_since` is a poll standing in for the
  socket a browser has.
- **They work in bulk.** `set_labels` and `bind_constants` are batch because a
  person names one thing at a time and an agent names forty.
- **They need to state assumptions.** `expectVersion` is a conflict dialog that
  cannot be shown.

So the criterion that actually decides is **reusability** — does this answer a
question about programs, or about *this* program. The UI question is a fast way
to notice narrowness, and the rest of the time it is quiet rather than negative.

Corollary worth stating: when an agent invents a narrow tool, the finding is
usually that the *general* one is missing something — not that the narrow one
should exist. `find_hardware_access` was invented because `find_instructions`
could not see indirect writes, which is a gap in the general tool.

### Indirect writes: run them, do not pattern-match them

`STA ($02),Y` names no address, so a range search cannot see it — and that is not
a corner case: Gridrunner writes the VIC-II *only* through a pointer, so
searching `$D000-$D02E` returned one dead instruction and missed every write that
mattered. Both readers in the second run hit it.

**This was constant folding first, and that was the mistake.** A hand-written
backward walk looked for `LDA #imm` immediately before `STA $zp` — a mechanism
built beside one that already existed. The lifter describes all 56 documented
instructions and the interpreter runs them, so the address a block reaches is
something the machine **computes exactly**, not something a pattern
reconstructs. The pattern could not see past its own shape either:

- It required the load to sit *immediately* before the store, so
  `LDA #$D0 / TAX / STX $03` defeated it.
- It never folded the **index**, so all three of Gridrunner's VIC writes reported
  the shared base `$D000` instead of `$D018`, `$D020`, `$D021` — which is the
  difference between "something writes the VIC" and "the character base is set
  to $2000 here".
- It read `($zp,X)` from `$zp` whatever X held, which is silently wrong for any X
  but zero. The interpreter just does the addressing, so that is right for free.

**Running is exact only when nothing was assumed, and that is a certificate
rather than a hope.** The run is seeded with **nothing** — no load image, because
zero page in a `.prg` holds whatever was in the file before the program
initialised it, which is exactly where pointers live. Any cell the path did not
write itself therefore reads as `unknown`, and one such read refuses the answer.

Two exemptions, both load-bearing:

- **A cell the run wrote is `computed`, not unknown.** The pointer this block
  built out of literals is not an assumption, and counting it as one would refuse
  every answer worth having. `TraceSource` carries that third case; the
  block-level summary has no use for it because such a cell is not an *input*.
- **At the access itself only the pointer cells are checked.** The last read *is*
  the target, and its value is precisely what nobody claims to know — requiring
  it to be supplied would refuse every load through a pointer, which is half the
  question.

**It stops rather than guessing**, in the same two places as before and for the
same reasons. At a **join**, because walking back through single predecessors is
path-insensitive *and sound* only while there is one way in. And at a **computed
store** — Gridrunner's screen pointer comes from a table, so it genuinely depends
on runtime state, and that read is `unknown`.

Paths are tried **shortest first**. The refusal is deliberately blunt, so a
longer path can only ever poison an answer a shorter one gave; trying them in
order is what keeps the extra reach from costing precision.

**An unassigned index gives a base and not an address.** With Y never assigned
the machine runs it as zero, so the address it touched *is* the pointer —
reporting that as the address would dress an assumption as a finding. Both are
returned, and the answer says which it has.

On the reference project this resolves 3 of 18 indirect accesses — **the same
three** the folder did. What changed is not coverage but precision, and that
there is no second mechanism to maintain. The other 15 are not a folding failure:
they are loop bodies with several predecessors whose pointer comes from the
screen-line table and genuinely differs per iteration. Running the path through
unique predecessors was measured and gains nothing, because there is no unique
predecessor to run. They are reported as unresolved on the answer itself, so a
caller knows the search had a blind spot rather than reading an empty result as
an absence.

### Finding the character set, and what actually cost the time

Experiment 2's readers all had to work out that `$8E00` was a character set.
Measuring the transcripts settles what was hard, and it was not what it looked
like:

| reader | calls | `find_undecoded` | reached `$8E00` | first decoder |
|---|---|---|---|---|
| agate | 105 | 10 | 26 | 27 |
| amber | 248 | 17 | 24 | 25 |
| basalt | 119 | 14 | 28 | 47 |

**Locating was never the problem.** All three asked what was unexplained within
the first seventeen calls and were looking at the right span by call 28; two ran a
decoder on the very next call. The budget went on deciding *what the bytes were*.

A statistical hint was considered and rejected. It works — bit-pattern symmetry
separates the charset from every code window on this binary, where entropy does
not — but it is the wrong kind of answer: mirror symmetry holds for simple glyphs
and fails for complex ones, for most bitmaps and sprites, and reports flat `$00`
or `$FF` filler as graphics. A confident wrong answer about what a span *is* is
the failure this project refuses everywhere else.

**The evidence is in the code, and following it needs no new mechanism.** The
whole chain for Gridrunner:

```
find_instructions from:$D018 to:$D018
  $810B  STA ($02),Y  →  $D018 = $18      in InitializeGame

$18 puts the VIC character base at $2000

find_instructions from:$2000
  $82F1  STA charSetLocation,X            in LoadCharacterSetData
  $82EE  LDA characterSetData,X    ← $8E00
```

Every link is a fact about the program. That chain is what the interpreter-based
resolution above was built to make followable — with the pointer folded but not
the index, step one returns three indistinguishable sites all claiming `$D000`,
and the trail stops. It is pinned by a test for that reason.

The general lesson, worth more than the instance: **ask what uses a span, not
what it looks like.** Hardware writes say what a region is *for*, and on this
machine they are the strongest available evidence — which is also why they must
be resolved precisely enough to name a register.

### The export had one writer, and it failed in silence

Experiment 4 wrote into the document for a quarter of its run while the `.re64`
never moved, and **every tool answered `ok`**. Three faults stacked, and each is
worth keeping apart because each is a different lesson.

**The serializer assumed its own output.** `insertEntry` finds the line whose
address sorts after the new one and splices there. On a pretty-printed file
every entry spans five lines, so it matched the `"address"` line *inside* an
object and put the new entry between that object's own fields. `upsertLabel`'s
`parseProject` guard then threw — correctly — and `applyOps` abandoned the whole
batch, including the 47 labels that were fine.

A `.re64` is ordinary JSON and anything may write one, so the line editor has to
cope with a shape it did not produce. It now reformats such a file once, through
the escape hatch it already used when a layer had no array to edit at all, and
every edit after that is a one-line diff again. Layout is lost on a file that
never had the layout this preserves; the alternative was corruption.

**The failure reached nobody.** The live writer is a debounced timer, and
`detached` swallows what it throws on the grounds that losing the server is worse
than losing a write — which is right, and is not the same as losing the *record*.
`ProjectStore` now keeps the last failure until one succeeds and
`describe_project` reports `exportStale`, so the one question that mattered —
"is what I am writing reaching the file?" — has an answer.

**There was no tool to reach the export at all, and none to ask about it.** The
agent went looking for `save_project`, found nothing, and located
`POST /api/export` by reading the server's source. `export_project` now returns
the `.re64` text.

**Writing it to disk was tried and taken back out**, which is worth recording
because the reasoning failed twice in opposite directions. First it was waved
through as by design — wrongly, since `re64 export` writes the file and a
capability the CLI has and the tool surface does not is a gap, not a principle.
Then it was built, and that was worse: it overwrote **the file the project was
imported from**, which this file says elsewhere is out of the picture the moment
it is imported — and in the run that prompted it, that file was the experiment's
own fixture.

The deeper objection is that a path on disk is not a thing an MCP server can
assume it shares with its caller. It works for an agent on this machine and means
nothing over a network, so it is the wrong shape for the surface it was added to.

**The question underneath was not about files at all.** *"An agent cannot save
the project and cannot tell that it has not been saved"* is written by somebody
who believes there is a save step. There is not — the document took every edit as
it landed — and nothing said so, so the agent went looking for a save button,
found a stale file instead, and had the wrong model confirmed. The bug made the
misunderstanding look correct.

Two things came out of that, and neither is a file:

- **Server instructions.** The MCP `ServerOptions.instructions` field carries
  what no per-tool description can, because it is a fact about the system rather
  than about any one call: the project is live, every edit is durable when the
  tool returns, there is nothing to save. Worth noting how this was nearly
  missed — `McpServer` is dynamically imported here behind a hand-written type
  that had only the first constructor argument, so passing instructions failed
  to compile against a signature the SDK has always had. **Narrower-than-reality
  is the failure mode of hand-typing a dynamic import**, and it is invisible
  until something reaches for the part that was left out.
- **Tags.** A named point, in the git sense, and cheap enough to be worth having
  for that reason alone: it copies nothing. `cursor` is an `ops.seq`, which
  `changes_since` already takes, so `changes_since(tag: "before-renames")` needed
  no new machinery. `version` is the projection hash, which answers the
  *different* question of whether the project has actually moved — an edit and
  its undo move the count and not the content, and a tag reports both.

  Keyed by **name**, unlike everything in the document. The reason ids exist
  there is that a rename must not change what a thing is; a tag is never edited,
  so that does not arise, and git names tags the same way for the same reason.
  It also stays out of the export, alongside `ops` and `history`, which is the
  parked question about history travelling with a project rather than a new one.

Still open, and not built: getting the bytes out cheaply. Text costs tokens on
every call, and an MCP **`ResourceLink`** — a uri and mimeType in the tool result,
with the client fetching the body through `resources/read` — is the protocol's
own answer, verified present in the shipped SDK alongside base64 `blob`
resources. Nobody has needed it yet.

The general shape, worth more than the instance: **a write path whose only
failure channel is stderr is a write path with no failure channel.** Nothing
downstream of the swallow could distinguish "saved" from "silently not saved",
and no test could either, because every layer in isolation behaved correctly.

### An operation nothing emits is a feature that exists only from the inside

`meta.set` had a type, an `applyOp` case and a computable inverse, and
`diffProjects` never produced one — so `set_project_description` reached the
document, showed up in `describe_project`, and was absent from every export.
`diffProjects` now diffs `name` and `description` like everything else.

The same shape as the `layer.add` gap this file already records: the vocabulary
being closed is checked by the compiler, and *whether anything ever emits a
member of it* is not.

### Smaller things experiment 4 found, and one it got wrong

Fixed, each because the answer's shape was the problem rather than its content:

- **`list_labels` advertised an address range it did not have.** `labels()` took
  one all along; the schema in front of it did not, so "what is named in zero
  page" meant fetching all 336 and filtering locally.
- **`find_immediates` named no routine**, where the neighbouring
  `find_instructions` does — and "does this value mean the same thing over
  there" is unanswerable from bare addresses.
- **An annotation inside an instruction is accepted and renders nowhere.** True
  of labels, and equally of comments; two were lost that way. Both writes now
  warn and name the instruction's start.
- **`bind_constants` was all-or-nothing**, so one bad entry rejected 167 good
  ones — in both runs that used it. It is partial now and reports what it
  declined. A batch tool that fails whole is not a batch tool.
- **A region's `view` could not be cleared.** Omitting the argument reads as
  "leave it alone", so an explicit `""` now means "remove it".
- **`export_listing` took `lines` where `set_region` takes `end`.** It takes
  both.
- **A long `inline` comment cannot wrap** — correctly, it shares a row — and
  nothing said so, so a paragraph ran a listing line to several hundred
  characters. The write hints; it does not refuse, because what fits depends on
  the instruction beside it.

Two claims did **not** reproduce, and are recorded rather than fixed:

- **The text decoders' high half.** `fromScreenCode` masks `& 0x7f` and
  `fromPetscii` maps `$C1-$DA` to `A-Z` already; `C3 C2 CD 38 30` decodes to
  `CBM80` in PETSCII today. Reading it as *screen* codes gives graphics, which
  is correct — the cartridge signature is PETSCII.
- **A duplicated comment block in the listing.** Each renders exactly once from
  the model; the duplication is an artifact of the agent's own paging loop
  concatenating overlapping pages.

### How far to look is the caller's question, not the tool's

`block_effects` and `routine_effects` were two fixed points on one axis, and the
axis was never named. The tell was in `block_effects`'s own description, which
apologised for its scope and pointed at the other tool: *"at a routine head that
begins `JSR` this answers about a single instruction — correct, and almost never
what you wanted."* An agent had to discover that by trying it.

So one tool, `effects`, with `follow`:

| | |
|---|---|
| `block` | the straight-line block here — **exact**, because there is one path |
| `routine` | its own blocks, not entering what it calls |
| `calls` | plus everything its callees reach, transitively — the default |
| `returning` | `calls`, refusing to enter a callee that never comes back |

`returning` is the answer to what this file previously parked as a design
question: `routine_effects` was sound and useless on Gridrunner's main-loop
subsystems, because all of them can reach a routine that resets the stack and
jumps into the death path, so the may-analysis unioned most of the program. Of
the two proposals — report effects up to the first non-returning transfer
separately, or let a caller mark a node as not returning — the first turned out
not to need a second report at all. It is a **scope**, which is the axis that was
already there.

Measured on the reference project, as a share of every slot the program touches:

| routine | `calls` | `returning` |
|---|---|---|
| `sub_8753` | 47% | 13% |
| `sub_8635` | 55% | 26% |
| `sub_88C9` | 53% | 28% |
| `ReenterMainGameLoop` | 86% | 71% |

The last row is not a failure. It is the main loop, and a main loop does touch
most of the program — which is the check that the cut is bounding the right
thing rather than just making numbers smaller.

Three things this needed that were not obvious:

- **A bounded answer has to be built out of bounded answers.** It is a second
  fixpoint, not a flag on the first: folding a callee's unbounded `total` in here
  would leak the whole program back through one hop.
- **`stoppedAt` names every place it stopped**, so this is never a claim that
  control ends there — and asking about one of those addresses directly gives the
  rest. Truncating in silence would be the confident wrong answer this project
  refuses everywhere else.
- **It cuts where the program provably leaves, never where the analysis is
  unsure**, and getting that wrong is the most instructive part. `ReturnBehaviour`
  reported `skipsFrames: 0` both for a routine that resets the stack pointer and
  for one whose depth two paths disagreed about — opposite kinds of statement,
  one a fact about the code and one an admission about the pass. A cut keyed on
  that threw away whole routine bodies: **SCNKEY reported touching nothing at
  all**, because two paths reach one block at different depths. So the behaviour
  now says which of three it is — `abandons`, `skips`, `ambiguous` — and only
  `abandons` cuts.
- **Calls and tail jumps both**, because a program leaves by whichever it likes.
  Gridrunner's top level is a `JMP` chain, so its death path is reached by a tail
  jump and cutting only calls catches none of it. Cutting only tail jumps is
  equally wrong the other way: a KERNAL entry point *is* a bare `JMP` to its
  implementation, so that would report the effects of a three-byte stub.

The scopes differ in **standing**, not only in width, so the answer says which
one it is: `block` is exact, and everything above it is a union over paths — what
the code *can* touch, never what it must.

### The tools agents invented

Experiment 2's transcript records seven tools readers reached for that did not
exist. That list is worth more than any of their prose, because inventing a tool
name is an unguarded statement about what the API should have had — and all
seven are now built or answered.

Two of them turned out to be **one** tool. `find_hardware_access` over
`$D000-$DFFF` and `find_instructions` with an operand pattern are the same
question with the range filled in, so building both would have been the
mechanism-per-oddity mistake. `find_instructions` takes a mnemonic, an operand
range, or both, and its description names the ranges — `$D000` VIC, `$D400` SID,
`$DC00` CIA — so the hardware question stays discoverable without a second tool
to find.

Each site says **which routine it is in**, which is what makes a list of fifty
addresses usable rather than a haystack: "what makes a sound" comes back as 57
stores across 13 named routines rather than 57 addresses.

That attribution needed one correction worth keeping. `routineEntries` took
`function`-typed labels only, so everything reachable *solely from where the
program starts* belonged to no routine — most of the initialisation code, showing
as `in -` on half the answers. An `entry` label is a routine root as much as
anything a `JSR` points at.

### A change cursor, because the agent has no socket

Statelessness removes the channel by which anything learns a project moved. A
browser is pushed to; an agent would otherwise re-read the whole disassembly and
diff it — roughly 25K tokens per poll on a 64K project, plus a full analysis
each time. `changes_since(cursor)` returns what was recorded after that point
with author and time, and the cursor to use next.

This only works because attribution is **unified**: socket edits, HTTP writes,
CLI writes, and agent writes all leave the same record. A feed showing agent and
CLI edits but not the human's would be blind to precisely what an agent most
needs to see. It also means the log must be **append-only** — the old
`DELETE`-and-reinsert renumbered every entry on each undo, so a held cursor
silently came to mean something else.

### Convergence is not atomicity

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

### Sessions are leases, and agents should have them

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

### The experiments this is for

Three, escalating, each adding one variable. The rare thing here is an
**oracle**: `assets/gridrunner/gridrunner.asm` is 65KB of human reverse engineering, so
there is a gold standard to compare against.

1. **Expressiveness audit.** Give an agent the project *and* the human's
   disassembly, and have it reproduce that through MCP. It is not a test of
   whether the agent can reverse engineer — it has the answer — but of whether
   the API can *say* what a person said. Score friction, not similarity. Already
   known to find something: comments attach only to labels and regions, so the
   human's instruction-level commentary has nowhere to live.
2. **Convergence.** Five agents, no labels, only the disk image — on **five
   independent clones**. Shared, they would see each other's names and converge
   partly by contagion, which measures influence and calls it agreement. This is
   the last moment it can be measured uncontaminated.
3. **Collaboration.** Shared document, a chat, a person watching live. Chat
   only — post, read, see who is here. **No claims, no leases, no work
   assignment**, because building coordination machinery in advance decides what
   coordination looks like before anyone has seen any.

   Deliberately **open-ended**: there is no hypothesis being tested here, and an
   earlier draft of this line named one — whether agents invent claim-and-release
   — which was this file's author guessing, written down where it then read as a
   shared premise. Naming an expected finding in advance is how you stop seeing
   the others. Run it, watch, and report what happened.

Two rules that make these produce measurements rather than anecdotes:

- **Take the agents' reports and the request log together.** A report carries
  what a log cannot: intent, what they expected to find, why something was
  awkward. The log carries what a report cannot, because an agent is an
  unreliable narrator of its own difficulty — it invents a tool name and then
  describes the invention as a gap, and works silently around whatever actually
  hurt. Read the reports for what to look for and the log for whether it
  happened. Where they disagree the log wins; but the report is what makes a
  line in the log mean anything.
- **Only fix what blocks the next experiment.** Everything else becomes a list
  and stays a list. Without that rule the first experiment's output consumes
  every week that follows.

### Connecting a client

```
claude mcp add --transport http re64 http://127.0.0.1:5164/mcp \
  --header "X-Re64-User: <user id>"
```

The user id is one from `list_users`; the server does not verify it.

## Where the algebra is incomplete

Written down because it is the kind of thing that is obvious while building and
invisible six weeks later. None of it is urgent; all of it is real.

**One hole in the operation vocabulary.** There is `layer.add` and
`layer.remove`, and no `layer.set` — a layer can be created and destroyed, never
modified. So nothing can rename a layer or **reorder the stack**, and z-order is
invoked throughout this file as the *reason* annotations belong to layers:
"reordering the layer stack moves them with the bytes they describe rather than
leaving them pointing at whatever else lands at that address." That property has
never been exercisable through any surface. A documented behaviour with no
operation behind it is worse than a missing feature, because it reads as
supported. Relatedly, `add_layer` makes only `symbols` layers, so a byte layer
cannot be added at all — which is why the shadowing it is supposed to enable
cannot be tested end to end.

**The debt is really in the surfaces, and it is lopsided:**

| | reaches |
|---|---|
| MCP | ~41 tools — nearly the whole vocabulary |
| CLI | labels, regions, undo/redo, import/export |
| Browser | labels and regions, and nothing else |

The browser cannot write a comment, declare a constant, or set a primary label,
though all three are modelled, rendered and reachable by an agent. For a project
whose premise is *four consumers and none of them primary*, the human's surface
is the least capable by a wide margin.

**That skew is deliberate, and it is not debt in the usual sense.** The agent
surface is being built out first on purpose, for three reasons worth writing
down because the lopsided table above otherwise looks like neglect:

- **The deep work is surface-independent.** Basic blocks, the P-Code lifter,
  decoders, the analysis cache — all of it had to exist whatever consumed it.
  Which surface exposes it first changes nothing about whether it gets built.
- **A tool is cheaper than a panel.** Exposing something through MCP is a schema
  and a `Workspace` method. The same thing in the browser is markup, styles,
  state, event wiring and repaint discipline — and the repaint discipline is the
  part that keeps going wrong.
- **Agents are not gated on the author.** Progress through MCP does not wait for
  anyone to sit down and click.

So "when and whether it appears in the web UI" is a genuinely separable
question for most features, and deferring it is a schedule, not an oversight.

`layer.set` is missing for the same kind of reason, and it is worth stating so it
does not read as forgotten: **every experiment so far has handed agents a project
that already existed.** Analysing one needs no layer editing at all. It becomes
relevant the moment they are given a pile of disks and asked to *build* the
project — which is the intended shape of a later run.

That scenario needs a cluster rather than a single op, and the last item is the
one that decides whether it is possible at all:

- `layer.set`, so a stack can be renamed and **reordered** — the property this
  file cites as the reason annotations belong to layers, and which nothing can
  currently exercise.
- `add_layer` that can make **file** layers. It creates `symbols` layers only,
  so an agent cannot add a PRG, let alone one out of a disk image.
- The D64 reader reachable from a tool. `src/core/c64/d64.ts` exists and only
  the CLI can get at it, so nothing can ask what is on a disk.
- **The overlay question, which is the real wall.** A game like Bard's Tale
  loads a level over memory that held code a moment ago, and both readings are
  correct at different times. Layers do not express that: shadowing is static
  z-order decided at analysis time, so stacking two layers over one range hides
  one rather than representing both. See "One interpretation per address" below
  — building a project from disks runs into it immediately, and it needs a
  decision about what a row means before it can be built rather than after.

Nor is human-side evidence actually missing, which an earlier version of this
note got wrong. It arrives directly from whoever is building this — line
wrapping, the arrow gutter, pictures in a sidebar, the chat panel, and the
observation that *sliding the width until an image appears* is the whole
pleasure of the thing. None of that came out of an agent transcript, and none of
it would have.

## Known Limitations & Future Features

### What "reachable" means, and what the binary might be doing

re64 computes **statically reachable**, which is strictly smaller than
*executed*, and the gap between them is not a defect to be closed. A 6502
program reaches code by means no walk can follow: a computed `JMP ($xx)`, an
address pushed and `RTS`-dispatched, a table index from a variable,
self-modifying code. A game from 1983 also contains dead routines left over
from development, and may simply have bugs.

So a disagreement between this analysis and a human's listing is not evidence
that either is wrong. Three explanations are always live:

- the annotation is wrong,
- the decode leading there is wrong,
- **the program does something the analysis cannot see, or is buggy.**

Everything here that talks about reachability has to leave the third open.
`find_references` already does — it states on every answer that it sees absolute
addressing only. The `flowIntoData` warning and the `orphaned` hint say "this
analysis arrives here", not "execution reaches here", and offer `mark_function`
for the case where something reaches an address in a way no walk can show. An
earlier draft of that warning offered exactly two explanations and was wrong for
the reason this section exists.

`find_undecoded` reports spans **nothing has explained** — not dead code. The
distinction matters most on a fresh project, where almost everything is
unexplained and none of it is dead.

### Instruction semantics: what exists, and why we write our own

Wanted eventually: an IL with real 6502 semantics, SSA over basic blocks, and
symbolic execution — the shape panopticon has. Searched first, because writing a
lifter is not something to start by accident.

**Nothing exists to port.** No RREIL implementation for JavaScript or
TypeScript. No binary-lifting IL for JS at all: the 6502 packages on npm are
emulators and assemblers, which execute rather than describe. P-Code/SLEIGH is
the IL with traction and every binding is native — `pypcode` (Python, drives
angr), `sleighcraft` and `rsleigh` (Rust), `lifting-bits/sleigh` (C++).

**A native binding is ruled out by the architecture, not by taste.** re64's
analysis runs in the browser, deliberately, so that a rename does not round-trip
to the server. Nothing behind node-gyp can go there, and a WASM build of SLEIGH
is a very large dependency for a project with almost none. Writing the IL in
TypeScript is therefore the only shape that fits, and is not reinvention: there
is no wheel of this shape.

**Neither reference is correct about flags, and they are wrong differently.**
Checked before writing anything, on `ADC`, `SBC` and the flag macros:

| | Ghidra `6502.slaspec` | panopticon `semantic.rs` |
|---|---|---|
| `N` | `value s< 0` — right | signed `<=` , so `$00` sets N — wrong |
| `SBC` | `A - op1 - !C` — right | `A - r + C`, no borrow — wrong |
| `ADC` carry | computed before adding carry-in, so `$FF+$00+C` reports none | `AND` where the rule needs `OR`; reduces to `(res==A) && C_in` |
| `ADC` overflow | `V = C` — plainly wrong, V is *signed* overflow | same `AND`-shaped bug |
| decimal mode | no `D` check at all | written, then commented out |

So porting one and checking it against the other would have produced a wrong
lifter whichever won a disagreement. **Use them for structure and coverage, not
for arithmetic**: Ghidra for how instructions decompose and which flags each
touches, panopticon for the illegal opcodes Ghidra omits, and the ISA definition
for what the flags actually are:

```
sum   = A + M + C
result= sum & 0xFF
C     = sum > 0xFF
V     = (~(A ^ M) & (A ^ result) & 0x80) != 0
N     = result & 0x80
Z     = result == 0
```

This is the argument for making Klaus Dormann's 6502 functional test suite the
acceptance bar rather than a nicety. Reading two references agreeing would not
have caught any of the above; running the program does, and names the
instruction.

**Deferred, with a shape in mind: illegal opcodes as a chip variant.** They lift
to `CALLOTHER` meanwhile, so clobber analysis stays conservative rather than
quietly wrong. Worth knowing when that arrives: the C64's processor is a **6510**,
a 6502 with an on-chip I/O port at `$0000`/`$0001` — and that port is the bank
switching register, so a chip option reaches the memory model and not only the
opcode table.

**Two references, with different standing.**

- Ghidra's `Ghidra/Processors/6502/data/languages/6502.slaspec` is complete,
  maintained, and **Apache 2.0** — compatible with this project, so it can be
  read and lifted from freely.
- panopticon's `mos6502/src/semantic.rs` is **GPL-3 and mixed authorship**. The
  target was written by this project's author in December 2015 (decoding,
  illegal opcodes, loader, semantics) and converted to RREIL by Kai Michaelis in
  2016, with three other contributors since. So the design is one thing and the
  current text is another: usable as a reference whose reasoning is already
  understood, not as source to copy into an MIT project.

### The lifter, and what a block can now say about itself

Written, and all 56 documented instructions are in it. Gridrunner lifts
completely: 1449 of 1449 instructions, 446 of 446 blocks fully modelled.

Two conventions carry the design, and both are about refusing to blur a
distinction:

**A statically known address becomes a `ram` varnode, not a `LOAD`.** `LDA $10`
lifts to a read of `$(0x10)` directly, so a block's inputs and outputs name the
zero-page cells it uses — which on this machine is most of the interesting
traffic, since zero page *is* the variable space. `LDA $10,X` cannot name
anything; it lifts to a `LOAD` from a computed varnode, and the static answer is
"reads memory at a computed address". Losing that distinction would mean either
inventing an address or reporting none.

**Hardware quirks are modelled rather than smoothed over.** Zero-page indexing
wraps inside the page, `($ff,X)` takes its high byte from `$00`, and
`JMP ($10ff)` reads its high byte from `$1000`. These are not edge cases in
hand-written C64 code — they are things people relied on.

Decimal mode is still not modelled: `ADC` and `SBC` lift to binary arithmetic
regardless of `D`. What changed is that it now says so at the point of use
rather than being a footnote.

The arithmetic is tested by *running* it, against the four carry/overflow cases
where the two published references disagree and both are wrong — which is the
whole argument for the interpreter existing, and why it was written before the
lifter rather than after.

**The functional test found two defects that every hand-written case had
passed**, which is the argument for it in one line. Both were invisible to
inspection and to the tests written alongside the code:

- `RETURN` discarded its address, so every `RTS` continued at the byte *after
  itself* rather than at its caller. Nothing noticed until something actually
  returned. The address is not decoration even in the ordinary case, and on this
  machine a routine that rewrites its own return address is a standard computed
  jump.
- Signed overflow across a three-way add combined with `BOOL_OR`. Both halves
  **can** overflow, and then they *cancel*: `$FF + $80 + 1` is `-128`, which is
  representable, so V is clear. Carry genuinely cannot happen twice — a carry
  out of `A + M` leaves at most `$FE`, and `$FE + 1` does not carry — so carry
  keeps its `OR`. The asymmetry is the trap, and the code says so where it
  happens.

It now reaches the decimal section (test case 42) having executed all 56
documented instructions, and stops there.

**How much is behind that stop is now known, and it is very little.** The suite
has 45 groups: 0-43, then 240 as a completion marker. We clear 0-41. Group 43 is
the only real test after the stop, and it is *also* decimal — `CLD/PHP/ADC`
against `SED/PHP/ADC`, checking that `D` survives `PHP`, `PLP` and `RTI`, and
verifying it through decimal arithmetic (`$55 + $55` is `$AA` binary and `$10`
decimal). The flag plumbing it exercises already works; only the arithmetic
fails. Group 240 is `LDA #$F0 / STA $0200 / JMP *`, the success marker.

So implementing decimal takes the suite from "stops at 42" to complete, with
nothing else outstanding — which is a more useful thing to know than "stops
partway". Established by scanning the binary for the `LDA #n / STA $0200` that
each group writes, then disassembling `$340C` with re64's own disassembler. That boundary is asserted by
`src/core/il/functional.test.ts` rather than described, so the gap is a passing
test instead of prose, and nothing can regress into looking like a decimal
failure. It is opt-in twice: the binary is fetched rather than committed, and
26 million instructions take about thirteen seconds.

**Decimal is done, and the suite now passes outright.** All 45 groups: 0-43 and
the `$F0` success marker. Three things made it smaller than it looked.

The functional test checks **only the accumulator and the carry** in decimal
mode — `PHP / CMP` for the result, then `PLA / AND #$01 / CMP` for the carry. It
never looks at N, V or Z there. So the notorious part of NMOS decimal, where N
and V come from a partly-corrected intermediate, is not what stands between this
model and a passing suite.

`Z` is the *binary* result's on real hardware, so it is right for free. N and V
stay binary and that is a **stated gap** rather than an oversight, recorded at
the point it happens: no real program branches on N after a decimal add, and
inventing an answer there would be exactly the confident wrong answer this
project refuses everywhere else.

The arithmetic is **two new IL operations**, `INT_BCD_ADD` and `INT_BCD_SUB` —
the one place this IL departs from Ghidra's vocabulary, and it departs because
there is nothing to be faithful to: Ghidra's `6502.slaspec` does not check `D` at
all. Each returns two bytes, result in the low and carry in bit 8, so one
operation answers both and `SUBPIECE` takes them apart. The alternative was
thirty-odd branchless nibble operations per `ADC`, unreadable in a listing and
still not right about the flags.

Decimal `SBC` is **not** decimal `ADC` of the complement — the correction goes
the other way — so it cannot ride on the binary path the way binary `SBC` does.
And only the accumulator differs: every flag after a decimal `SBC` is the one
binary subtraction would have set. Worth knowing, because the first attempt read
`A` and `C` *after* the binary pass had already overwritten them.

**The select costs nothing measurable.** Execution lifts as though `D` were in
doubt, since the machine holds a real flag and resolves it exactly: the
decruncher runs 1,768,854 instructions in 672-748ms with the select, against
831ms before it existed.

**That is not a reason to skip proving `D`, and treating it as one was wrong.**
`lift` took a `DecimalMode` with three values and nothing computed two of them —
the same shape as `meta.set` with no emitter and `layer.add` filtered to symbols,
three times over. The binary default was a *guess*: correct on the programs to
hand, and silently wrong for anything that does use decimal. Effect sets hid it,
because both paths touch identical registers.

So `decimalModes` proves it, and the proof had to be **interprocedural or it says
nothing**. A first version followed block successors only — which deliberately
exclude the call target, since a `JSR`'s successor is where it *returns to* — so
every routine body was a block nothing entered, seeded `unknown`. It came back
`unknown` at **17 of Gridrunner's 19 sites**, because the one `CLD` is in
`ColdStart` and never reached what `ColdStart` calls. Judged on that output the
pass looks useless, which is exactly the trap.

Following calls, both real targets appeared to prove **binary everywhere**: 19 of
19 on Gridrunner, 3 of 3 in the KERNAL, no unknowns.

**That number was never real, and how it was produced is the more useful thing to
record.** `canTouch` walked from a call target and did `if (!block) continue` —
so a callee it could not see was assumed to touch nothing. Gridrunner calls five
KERNAL routines and the project loads no ROM, so all five were skipped and `D`
sailed through them. It was not a proof, it was an omission that looked like one.

The value analysis assumes an unseen callee can write anything, which is sound
and costs the whole proof. The right answer is neither: it is to **ask**, and
`KERNAL_CLOBBERS` exists to be asked — what calling any of the ROM's 202 routines
writes, derived from the ROM so a project without one can still be understood.
Consulted only where the project supplies no bytes itself, since a project that
loads its own ROM has a better answer about *that* ROM. Only routines whose
analysis is complete are listed at all, because an under-approximation here would
be believed; an absent row means "assume anything".

It takes `D` on the reference project from 3 proved clear to 9, and no further,
for a reason worth keeping: **every write to `D` in the entire KERNAL is a
`PLP`** — four of them, no `CLD` and no `SED` anywhere. So "CHROUT writes D" is
true and costs a caller nothing, and Gridrunner's one `JSR $FFD2` still loses the
flag for the rest of the program.

Saying so needs a *preservation* result, and that is where this stops rather than
guessing. Running the routine with distinct seeds and seeing what comes back
matching was built and does find it — 142 of 202 routines look like they preserve
`D` — and was then taken back out of the shipped analysis, because it is a
**check and not a proof**: a routine doing `if C then D := 0` passes complementary
seeds while preserving nothing. A sampled result presented as an analysis result
is exactly the confident wrong answer refused everywhere else here.

**So the proof is an identity rather than a sample, and it is built.** Each value
at an origin carries an identifier that survives only operations which provably
*move* a bit — `COPY`, a push and its matching pull, a shift, `AND` against a
known one, `OR` against a known zero — and is dropped by anything that computes.
A register still holding the identifier it started with was restored, and that is
a proof: no arithmetic can manufacture an identity.

Per bit rather than per value, and `PHP` is why, exactly as it is for the value
domain itself: seven flags are shifted into one byte and `PLP` takes them apart
again, so a whole-value identifier dies at the assembly while a per-bit one rides
through. It settles `TXA / TAX` preserving `X` for free — the idiom the reviewing
agent noticed by hand.

Three things it needed, none of them obvious in advance:

- **A flag register holds nought or one**, and must be seeded saying so. Modelled
  as a whole opaque byte, `PHP`'s `OR` has no known zeros to merge into and every
  identity is lost at the first flag.
- **`bitOf` had to stop comparing.** It lifted `PLP`'s bit extraction as
  `(v & mask) != 0`, and a comparison *computes* a value. Against a single-bit
  mask a shift is identical and only moves one, so that is what it emits now.
  Klaus Dormann's suite passes unchanged, which is the bar for touching a lift.
- **A routine has to be analysed alone.** Read out of a whole-ROM analysis, what
  arrives at a routine's entry is whatever its callers held, so a caller that had
  already lost a flag makes the callee look as though it destroyed one.

It costs nothing measurable — 27ms with and without on the reference project —
because an identity is dropped at the first computation, so the arrays are hardly
ever allocated.

**Result: 142 of the ROM's 202 routines provably give `D` back**, and four of the
five KERNAL routines Gridrunner calls. The fifth is `CHROUT`, and it is a **true
negative rather than a limitation**: its screen path pops a status byte at
`$E7B4` and `$E7C1` that it never pushed — no `PHP` anywhere in that routine — so
what it restores depends on a caller this analysis is not looking at. One
`JSR $FFD2` therefore still costs Gridrunner its decimal proof, honestly.

The general lesson is worth more than the instance, and this file has now been
caught by it twice: **a check that cannot see something must say so, not skip
it.** A silent skip is indistinguishable from a proof at the point of use.

The question a callee raises is *"can this touch `D` at all"* rather than *"what
does it leave"*. The second is more precise and needs a second fixpoint over
routine exits; the first is one walk and answers what actually arises, because
almost nothing touches the flag and the caller simply carries on. A routine that
might makes everything after the call `unknown` — honest, and rare.

**Entry points start `unknown`, not clear.** A 6502 does not clear `D` on reset
or on interrupt, unlike the 65C02, which is precisely why real reset routines and
KERNAL handlers do it themselves. Assuming clear would assume the thing those
`CLD`s exist to establish.

The by-product is worth as much as the correctness: `decimalSites` reports every
`ADC`/`SBC` not proved binary, and BCD on this machine almost always means a
score, a clock, or a number being shown to somebody.

### One analysis under all of it: known bits

`flags.ts` had a walker per flag, and the two it could not do at all were the
argument for replacing it. `N` is bit seven of a *value*, so no amount of
watching `SEC`/`CLC`-shaped instructions will ever prove it; `B` is not stored
anywhere on this machine and exists only as bit four of the byte `PHP` and `BRK`
push. So the flags stopped being a special case: every one of them is a register
the lifter already writes, and `src/core/analysis/values.ts` runs the lifted
operations over an abstract domain until nothing moves. `proveFlag` is a query
over that now, and `flags.ts` went from 328 lines to 212.

**The domain is known *bits*, not known bytes, and `PHP` is why.** It assembles
one byte out of seven independent flags, and a handler asks about exactly one of
them with `AND #$10`. Under a whole-byte lattice that byte is simply unknown and
the question has no answer. Per-bit, `B` survives the round trip through the
stack and the `AND` extracts it.

Three things fell out that were not the reason for doing it:

- **`N` from one bit.** `AND #$7F` proves the flag clear with every other bit of
  the value still a mystery.
- **`Z` in both directions.** Any bit known set proves it clear; all bits known
  clear proves it set.
- **Carry out of an addition**, which is often settled where the sum is not —
  two known zeros in the top bits carry nothing whatever the low bits do.

**Comparisons are done on ranges, not by scanning bits.** Scanning from the top
stops at the first undetermined bit and answers nothing, which is exactly what
`AND #$7F` leaves; the range says 0 to 127, and nothing in it is negative. That
one change is the difference between `N` being provable and not.

**Not symbolic execution, and the boundary is what keeps it cheap.** A symbolic
domain tracks *expressions*, so it can say "A is whatever X was" and relate two
values it never learned. This tracks per-bit facts only: it cannot say two
unknowns are equal and never builds a term. In exchange every value is a fixed
width, the lattice has finite height, and a loop reaches a fixpoint with no
widening rule. If relational reasoning is ever wanted the escalation is an SMT
solver rather than a bigger lattice — **Triton** (`triton-library.github.io`) is
the reference implementation of that shape, with the same caveat as SLEIGH: it
is C++/Python, so it cannot go where this analysis goes.

**The stack is modelled as a stack.** Its absolute address is not knowable —
nothing says where `SP` started — but *what was pushed* is, so a value keeps its
identity across `PHP … PLP` even though the cell it sat in is anonymous.
Addresses derived from `SP` are found by taint, the same property `blockEffects`
uses to keep the stack out of "an address I could not name", and the whole stack
is abandoned when `SP` is assigned from anywhere else — which is `TXS`, and means
the depth has stopped being relative to anything.

**An interrupt handler can be seeded with what it was entered with.** `stackAt`
on the analysis and `stack` on `runBlock`: a status byte with `B` decided and
everything else unknown. That is what lets the same handler be analysed twice
and give two answers, which is honest, because it does two things. Both were
reachable before by setting `SP` and the `$01xx` cells by hand, and nobody would.

**Lazy, and it has to be.** The fixpoint costs about as much again as the
disassembly — 13ms to analyse Gridrunner, 22ms more for this — and `analyze()`
runs on every document update against a budget of roughly 30ms before the
browser stutters under a collaborator. `ProgramAnalysis.values` is a memoised
getter and nothing on the read path touches it until something asks about a flag.

**The lattice is checked exhaustively rather than by example.** Every pair of
one-byte patterns against every concrete pair they stand for, for and, or, xor,
add, subtract, both comparisons and equality: a bit the domain claims to know
must be that bit in every concretisation. It is cheap at this width and it is
the property everything above rests on.

### An interrupt is not entered from nowhere

Seeding every origin with "nothing is known" is right for something reached from
outside and wrong for the two ways this machine re-enters its own code. An
interrupt arrives from *somewhere in this program*, and the processor changes
almost nothing on the way in: it pushes the return address and the status byte,
sets `I`, and jumps. `A`, `X`, `Y`, memory and every other flag are exactly what
the interrupted code had.

So an origin has a **kind**, and the two re-entrant ones are derived rather than
declared:

| | entered from | `B` |
|---|---|---|
| `external` | outside; nothing can be assumed | — |
| `interrupt` | between any two instructions | clear |
| `brk` | the `BRK` instructions, and only those | set |
| `interruptOrBrk` | both, so it cannot be told | unknown |

The last row is the ordinary case on a bare 6502, where `BRK` and `IRQ` share
`$FFFE` — and it is exactly why a real handler tests bit four rather than knowing.
The C64 splits them, because the KERNAL's own handler reads `B` and dispatches to
`$0316` or `$0314`.

`src/core/c64/entry-vectors.ts` reads the kinds **out of the project's bytes**,
the same stance taken with the KERNAL's default vectors: the hardware vectors if
a ROM is loaded, the RAM vectors if RAM is, and a cartridge's warm start if the
`CBM80` signature is there. Which is how Gridrunner turned out to be a cartridge
dump: `$8000 → $83C1` cold, `$8002 → $83E2` warm, `CBM80` at `$8004`. Both of the
project's `entry` labels are that header, and `$83E2` is the **warm start**
reached through NMI rather than an IRQ handler the game installed.

Two details in the derivation. The entry state's **status byte is assembled from
the joined flags**, so `PLP` restores what the interrupted code had and
`PLA / AND #$10` answers about `B`. Each flag is masked to its own bit *before*
being shifted into place, because OR-ing in one unknown flag otherwise destroys a
known **zero** elsewhere in the byte — it preserves a known one, so this failed
for hardware interrupts while working for `BRK`, which is a confusing way to
find out. And the **stack is seeded as exactly the three entries the processor
pushed**, not as the joined one: depths differ all over a program, so a joined
stack is abandoned immediately, and abandoning it is the one thing that makes `B`
unreachable. Claiming a depth of three is not a claim that nothing is underneath
— a fourth pull comes back unknown, which is the truth.

It converges because the handler's own instructions become states to join over,
and joining only ever loses precision.

### `BRK` is a jump through a vector, and now says so

`BRK`'s flow type is `halt`, so the walk stopped dead at one — no target, and,
unlike an indirect `JMP`, **no warning either**. That was an inconsistency rather
than a decision: the two are the same shape of problem, a transfer through a cell
a program may rehook, and one of them named what it would have reached while the
other said nothing at all.

It gets the same treatment and for the same reasons. Not followed — a program
installs its own handler, and on this machine the KERNAL's own reads `B` and
dispatches again through `$0316` — but the warning names `$FFFE`, what the map
holds there, and `mark_function` as the remedy. It also says the handler runs
with `B` set, since that is how a handler tells a `BRK` from an interrupt and it
is the one thing about the entry that is knowable without looking at anything.

The second half was that **a handler is usually a decode root rather than an
origin**. Marking it a routine is how anybody gets it decoded, and that makes it
a `function` label — so keying the re-entrant treatment on `origins` alone left
every such handler seeded with nothing known, which is exactly the case the
machinery was built for. The kinds are read from the *bytes*, so an address
`$FFFE` or `$0316` points at is one the machine enters whoever declared it, and
that is now what decides it.

### An origin is not a decode root

The pass needed seeding, and seeding it with `entryPoints` was wrong in a way
this file predicted years earlier. `entryPointsFor` returns every `entry`,
`function` and `code` label plus every code region start, because all of them are
places the *disassembler* must look. An origin is something else: an address
reached from outside, where nothing can be assumed.

The guidance on label types said exactly this would happen:

> Do not collapse these because they behave alike today. That sameness is an
> artifact of the disassembler only ever queueing them; they diverge as soon as
> there is call-graph or basic-block analysis, which is where the information
> would be needed and no longer recoverable.

Treating a `function` label as an origin is not merely imprecise, it is
**contaminating**: an origin asserts "the flags are unknown here", and joining
that into code the real start had proved something about destroys the proof.
`ProgramAnalysis.origins` is therefore a separate, strict subset — declared entry
points, load addresses, and `entry`-typed labels.

Coverage and precision then pull in opposite directions, and the order reconciles
them: run from the origins first, and only afterwards seed any decode root they
never reached. Proofs made on the way in survive; code no origin reaches still
gets an answer. That the second pass can then lose a proof in code both reach is
not a shortcoming — if a routine really is entered from somewhere this analysis
cannot see, the flags really are unknown there.

### The same proof, for carry and for interrupts

`flags.ts` generalises it. Three flags are worth proving and the reason differs
for each, which is the interesting part:

- **`D`** changes what an instruction *means*, so proving it is a correctness
  requirement. It is the only flag that does.
- **`C`** is a finding. `CLC` before `SBC` subtracts one more than the operand
  reads — an idiom found **by hand three times across two binaries** before
  anything computed it. `carrySites` now reports Gridrunner's at `$8279`,
  `$828D`, `$82CA`, `$82E5`; the readers reported `$8278`, `$828C`, `$82C9`,
  `$82E4`, which are the `CLC`s one byte earlier. Same finding, mechanised.
- **`I`** is a finding too, and the KERNAL supplied its shape: `RDTIM` falls
  through into `SETTIM`, which does `CLI`, so reading the clock inside what a
  caller believes is a critical section turns interrupts back on underneath it.
  `interruptsDisabledAt` reports four such blocks in Gridrunner.

**Reported as facts, not defects.** `CLC/SBC` is sometimes deliberate, and all
of Gridrunner's sit inside visual effects where one out is invisible — which is
presumably why it shipped.

**Who clobbers a flag comes from the lifter, not from a table.** `flagsWritten`
reads the operations, so `PLP`, `RTI`, and every arithmetic and shift
instruction that touches carry are covered without anyone maintaining a list
that drifts away from the semantics.

`Z`, `N` and `V` are deliberately absent, and parked rather than forgotten. They
fall out of *data* rather than being set and cleared, so a flag lattice would
answer `unknown` nearly everywhere — a check that fires on healthy code, which
is the disqualifier hygiene already settled on. They yield to **value** tracking
instead: `LDA #$00` fixes `Z` and `N` exactly, and the interpreter is already the
right evaluation structure for it, with values that are expressions rather than
numbers. Whether anything interesting depends on knowing them statically is the
open question, and nothing has asked yet.

Decimal used to be the one thing left, and it did not touch the subject at hand —
Gridrunner has a single `CLD` at `$83C2` and no `SED` anywhere. When it is
wanted, the shape is a **branchless select** rather than intra-instruction
control flow: `mask = INT_SUB(#0, D)` is `$00` or `$FF`, and
`result = binary ^ ((binary ^ decimal) & mask)` picks between them without a
`CBRANCH` — which matters because the effect sets must stay identical either
way, and because `execute` has no way to skip operations.

`stackDelta` **is derived now**, and the hand table of nine opcodes is gone.
`JSR` counts two because it emits two pushes, not because somebody wrote `2`
beside its name, so the count cannot drift away from the semantics. `TXS` still
yields undefined — it *sets* the pointer rather than stepping it, and reporting
zero would be a guess dressed as an answer.

It reproduces what the table found and then some: `$87FE`, which discards its
own return address, and `$83E2` alongside it.

### Overlap: every reading is kept, and shown

The decoder now follows a contested address as its **own stream**, with its own
occupancy so the two readings do not fight over the same bytes, stopping where
it rejoins the main decode — which is the natural end, since a byte read two
ways converges again as soon as both agree where an instruction starts. Bounded
at 64 instructions and 32 streams so a pathological binary cannot fork forever.
Shadow references are deliberately not collected: a speculative reading's idea
of what refers to what would be mixed into the graph with no way to tell it
apart.

`DisassemblyResult.shadows` carries them, `buildBlocks(..., {alternate: true})`
marks the blocks, and the listing emits an alternate immediately after the
instruction whose bytes it shares, out of address order and marked.

**Provenance, never geometry.** Two blocks of the *same* decode intersect
routinely — a block beginning inside a longer one's span is ordinary — so
"does this overlap something" is the wrong question and reported main-decode
instructions as second readings. Only a block from a shadow stream is an
alternate.

**Which reading is "primary" turned out not to be a question.** It looked like a
policy decision — fall-through wins, or the declared entry point wins, or the
longer decode wins — and every candidate was arbitrary. It dissolves instead:
emit **every** block in order of where it starts, and mark any whose start the
walk has already passed. "Primary" then means nothing more than "reached first
in address order", and nothing has to be chosen.

The listing shows all of it. Declaring a label one byte inside `STA $35`:

```
8D57  A5 35      LDA selectedLevel
8D59  85 35      STA selectedLevel
8D5A  ; also decodes from here, sharing bytes above
8D5A  35 4C      AND $4C,X            <- the label's reading
8D5C  8E 8D CE   STX dat_CE8D
...
8D5B  ; also decodes from here, sharing bytes above
8D5B  4C 8E 8D   JMP DisplayTitleScreen   <- the reading that used to be destroyed
8D5C  8E 8D CE   STX dat_CE8D
```

Two details found while building it. A jump target that lands *inside* an
instruction never becomes a block leader, because `leaders()` gates on
`instructions.has(target)` and that map is keyed by instruction start — which is
exactly why such a target falls through to the contested path instead. And the
main decode can overlap *itself*: `Occupancy.covering` reports an address inside
an instruction but not one that starts a new instruction over claimed bytes, so
two main blocks can share a byte. Emitting by position rather than by provenance
covers that case too, without knowing it was there.

### Flow into a non-code region stops, and says so

A region says how to *read* bytes. Whether execution passes through it is a
different question, and the walk cannot answer it — so it does not try.

Resuming after the region was implemented and reverted. It assumes execution
runs through the bytes, which is true of `NOP` filler and false of the lookup
table the same rule would apply to. On the reference project it decoded
`PlayNewLevelSounds` — a routine nothing in the analysis reaches — purely
because a routine is what usually follows a table. A correct-looking answer from
a false premise is the worst kind to produce silently, and "usually right" is
exactly how it would have stayed invisible.

So the walk stops, and warns, naming the address. That disagreement is the
useful output: either the span is not really data, or the decode that led there
is wrong, and only a person or an agent can say which. On Gridrunner it reports
`$8D16` — execution arriving two bytes before the end of `laserFrameRateForLevel`
— which has always been true of this project and was never surfaced, because the
walk dropped the address in silence.

**NOP filler between routines is code**, and should be declared `code`. A
listing showing `.BYTE $EA` is making a rendering choice, not claiming that
execution stops; declaring it data claims exactly that, and is wrong. Rendering
it as `NOP NOP NOP` also says more.

What is genuinely missing, and neither position supplies: a way to say **"this
is code, render it as bytes"**. That is a display preference, and a region kind
is the wrong place for it.

### An indirect jump is not followed, and now says what it would have reached

`JMP ($0326)` names no destination, so the walk queues nothing. That is right and
it was silent, and silence is what made the KERNAL undecodable: 15 of its 42
documented entry points are a three-byte jump through a RAM vector, so decoding
from the jump table gives **669 instructions** where declaring the 16 targets
gives **2583**. Experiment 6's agent worked every one of those targets out by
hand and recorded that it had — `$F1CA` for `CHROUT`, `$F13E` for `GETIN` — which
is a lot of effort to recover something the memory map can be asked for.

**Following it is still refused, and hooking `$0314` is exactly why.** A vector
holds whatever the program last wrote there; the bytes in the map are what it
held when the project was put together. Reading them and queueing the target
would be the `flowIntoData` mistake again — a correct-looking answer from a
premise nothing checked — and it would be wrong precisely where vectors are most
used, since installing your own raster interrupt is the standard idiom on this
machine.

**But knowing nothing and saying nothing are different.** The warning names the
cell, what the map currently holds there, and `mark_function` as the remedy:

```
$FFC0: jumps through $031A, which this walk does not follow — a vector holds
       whatever the program last wrote there. It currently reads $F34A;
       mark_function there if that is the routine you mean.
```

It asserts nothing about whether control goes there. That judgement needs
somebody who knows whether this vector is hooked, which is the same division of
labour every other warning here follows.

Two details. Where no layer supplies the pointer the warning says so rather than
omitting itself, because "nothing to read" is a different problem from "read
something" and leads somewhere else. And the high byte comes from the **same
page** — `JMP ($10FF)` takes it from `$1000` — modelled here for the reason the
lifter models it: people relied on it.

**An edit that stops code decoding says so separately from `delta`.** A
catastrophic loss used to arrive in the same field, shape and tone as a useful
gain, and every tool description here teaches a reader that a positive delta is
the reward for a good decision. `orphaned` names the first casualty *outside*
the span written — bytes inside it are the point of the edit — and suggests the
`code` region that restores it. It makes no claim about *how* the address was
reached: fall-through is the usual cause, but the same report follows from
removing a jump's only decoding, and asserting a mechanism it cannot check would
be a guess in the one message meant to be trusted.

### One interpretation per address, and where that runs out

The row model is address-ordered with one row per address, so a byte gets one
reading. Three things want more than that, and they are the same limitation
wearing different clothes:

- **Overlapping instructions**, where a byte is an operand on one path and an
  opcode on another. Described below; the only case that currently produces a
  *wrong* listing rather than an incomplete one.
- **Overlays.** A C64 game loads a level over memory that held code a moment
  ago. Both readings are correct, at different times.
- **Bank switching.** `$D000` is VIC registers or character ROM depending on
  `$01`. Same address, same instant, different contents.

**Layers are not banks.** Shadowing is static z-order decided at analysis time —
the top layer supplying a byte wins, always. Banking is runtime alternation,
selected by state the disassembler does not model. Stacking two layers over
`$D000` does not represent a bank; it hides one of them. Anyone reaching for
layers to solve banking should stop here.

What *is* solved is **naming**: a label use binds a site to one of several
labels at an address, so `$08` can read `randomValue` in one routine and
`gridXPos` in another, and `$D000` can be named for whichever bank the code
around it assumes. That is the affordance overlays and banking most need, and it
is worth having on its own — the reference disassembly uses a second name for one
zero-page byte with no banking involved at all.

Do not mistake it for a solution to the bytes. Whenever the byte problem is
taken on, it is one piece of work covering all three, and it starts with what a
row means.

### A label inside an instruction: fixed, and the label is still invisible

**This section described a defect that the overlap work removed, and said so for
too long.** An agent in experiment 2 checked it and reported the correction,
which is the most useful thing a stale note can produce.

What actually happens now, and it turns on the label's *type* — because only
`entry`, `function` and `code` are queued for decoding, and `address` is not:

```
set_label $8D5A type=address    delta 0, decode untouched
set_label $8D5A type=function

    8D59  85 35      STA selectedLevel
    8D5A  ; also decodes from here, sharing bytes above
    8D5A  35 4C      AND $4C,X
```

The second reading is *shown*, marked, and shares its bytes with the first,
because the disassembler follows a contested address as its own stream and
`rows.ts` emits every block in order of where it starts. The `JMP` that used to
become an orphan byte, and the garbage that resynchronised one byte late, are
gone. Branching into the middle of an instruction stays legitimate 6502 — the
reference disassembly of Gridrunner does it twice — and the model represents it
rather than refusing it.

**What is still true:** the label itself renders nowhere. `set_label` on a
mid-instruction address reports success, the name resolves correctly in operands
(`LDA CopyrightLine,X` at `$807F` has always worked), and the listing shows no
row for it. That is a real gap and a small one, and it is the whole of what is
left here.

### Decoders somebody else wrote

The escape hatch that stops this growing a mechanism per oddity. A character set
is a permutation and a sprite is a bitmap — both built in — but a title screen
packed with run-length encoding and partial frame updates is *assembler logic*,
and the only honest way to express that is code. A decoder is a way for a reverse
engineer to say it in a modern language.

**A decoder is a pure function from bytes to data**, never to a picture and never
to markup. That is what lets one serve the browser, the CLI and an agent at once,
and it is also the whole of the safety story: a function that can only return
numbers cannot inject anything, whatever it does inside. A bitmap comes back to
an agent drawn as text, because the caller may be something that cannot look at
pixels.

**Two mechanisms, because neither is sufficient alone.** SES removes the
*authority* to have side effects — a `Compartment` has no ambient globals, and
`lockdown()` freezes the intrinsics so one decoder cannot poison another. A
worker thread supplies the one thing SES cannot: an infinite loop is not a
permissions problem and no compartment can interrupt one. The thread also keeps
`lockdown()` off the main realm, which matters because hardening intrinsics is
process-wide and the server shares its realm with everything else. That
isolation is not an optimisation.

Determinism comes free and is worth having: `Date.now()` and `Math.random()`
throw inside a compartment, so the same bytes give the same answer and a listing
cannot flicker.

**It runs on both sides, and the browser's is the one that matters.** A decoder
is *analysis*, and analysis belongs where the person is — the same rule that put
disassembly in the browser so a rename does not round-trip. Sliding a width in
the explorer and watching the picture change has exactly that feel, and a network
hop inside a loop somebody is doing by hand would ruin it. The server keeps its
own runner for agents, who have no browser to run one in. That is the same split
as `analyzeProgram`: both sides do it, each for its own consumer.

The two workers must stay mirrors. The same source has to mean the same thing
whoever runs it, or a decoder that works for a person fails for an agent looking
at the same project. They are separate files only because one is a Node worker
thread and the other a bundled browser worker; `validateDecoded` in core is
literally the same function on both paths, so a result rejected in one place is
rejected in the other for the same reason.

The browser worker is **its own esbuild entry**, so the 84KB of SES is fetched
the first time somebody runs a decoder rather than by everyone at first paint.
The main bundle does not move. That measurement is why running decoders on the
server was the wrong call: the cost I assumed it avoided was not there.

**The Node worker's source is inline, not a file beside the runner.** A path
resolves differently from source and from `dist`, and the failure mode of
getting that wrong is running a *stale* sandbox — not a class of bug to accept in
the one file whose job is to contain somebody else's code.

**A text region can be rendered by a decoder**, and getting there meant giving
something up deliberately. A program with its own character set is the ordinary
case on this machine, and none of the three built-in encodings can read one — so
declaring such a span `text` produced confident nonsense, exactly the failure
ruled out everywhere else here.

A listing is built in **one synchronous pass** and a row cannot await, so this
decoder runs in the calling realm rather than in a worker: `src/sandbox/sync.ts`.
The trade, stated rather than buried:

- **Given up: termination.** A decoder that loops forever hangs whatever called
  it — a tab, a `re64 disasm`, or the server's event loop and with it every
  connected client. Synchronous JavaScript cannot be interrupted from inside its
  own realm.
- **Kept: authority.** SES still denies the network, the filesystem, the clock
  and randomness. A decoder can waste time; it cannot reach anything. That is the
  half that matters for code arriving inside a project file, and it is not
  weakened.

`lockdown()` hardening this realm's intrinsics was the other reason to prefer a
worker, and it was **measured before being relied on**: the analysis, the Yjs
document and the SQLite store all work unchanged under it.

If the loop risk ever bites, the fix is not to re-isolate this one call — it is
to move the *whole* analysis into a worker and make it asynchronous, which
removes the constraint that created the file. That is a real option, not a
consolation: the browser already analyses locally, and a worker is still local.

A decoder is reached by `view: "snippet:<id>"`, the same slot a bitmap region
uses, so one mechanism covers "draw these bytes" and "read these bytes". A
decoder that fails, throws, or returns the wrong shape falls back to the declared
encoding: a broken one makes a listing plainer, never absent.

**All four consumers render it the same way.** `src/sandbox/sync.ts` has no
`node:` imports, so the browser uses the identical module the CLI and the server
do — a listing looks the same whoever is reading it, which is the property the
row model exists to have. It costs SES in the page: the bundle goes from 1.1MB
to 1.3MB unminified, which is 84KB minified and well inside the 2MB tripwire.
Note the bundle is not minified at all, so that number overstates what a built
page would carry.

Deliberately *not* deferred behind a dynamic import. esbuild inlines those
without `--splitting`, so it would have cost the same bytes while looking like it
did not — the sort of thing that reads as an optimisation and is a comment.

**Running it here is a convenience, not the only way, and the tools say so.**
An agent may prefer its own tooling, and nothing should push it towards a
sandbox it did not ask for — so `read_bytes` hands over the same bytes and
imposes nothing on what happens next. What `run_decoder` buys is that the
isolation is already there and the result comes back drawn.

`read_bytes` also closes the loudest finding of experiment 2. There was no way
to get bytes at all, so every reader scraped the hex column out of
`export_listing`'s rendered text with a regular expression — a lot of work to
undo formatting that existed only for a human. It returns hex *and* base64
because those answer different questions: one is readable in a transcript, the
other is what you paste into your own script.

It reads through the **memory map**, and that is the part reading the `.prg`
cannot reproduce: a project is a stack of layers and the topmost one supplying
an address wins. Addresses nothing supplies are reported as unmapped rather than
zero-filled, because a gap is a fact about the project and silent zeroes would
let a decoder draw something that looks like data.

**A decoder lives at project level**, and the shape was already decided by
precedent rather than invented: it is exactly the split a constant has.

| | declaration | use |
|---|---|---|
| constant | `{id, name, value}` at project level | `{id, address, constantId}` in the layer holding that instruction |
| decoder | `{id, name, source}` at project level | `view: "snippet:<id>"` on the region holding those bytes |

Same justification, word for word: a way of *reading* bytes describes none of its
own, so there is no layer for it to move with when the stack is reordered. It
travels with the file, so whoever opens the project next has it.

Two things this does **not** do. It does not let a decoder draw a listing row —
`analyze()` is synchronous and running one is not, which is a separate and larger
decision. And it does not change the safety story, though it does change when the
question becomes real: inline source is code you pasted, stored source is code
that arrived with a project somebody handed you. Nothing runs until it is asked
to, and the sandbox is the same either way.

Adding the op surfaced three exhaustiveness holes at compile time — `applyOp`,
`inverseOp` and `describeOp` — which is the vocabulary being closed doing its
job. `decoders` is also added to the undo manager's tracked roots; `constants`
is still missing from that list, which is a separate and pre-existing gap.

### Running the program's own code, and what experiment 5 settled

Two agents were given a disk image and nothing else. Both identified the packer
as Exomizer 2, **both wrote their own 6502 interpreter outside re64**, both
snapshotted the decrunched image as a layer, and they finished four instructions
apart — 3452 and 3456 — having never seen each other's work. Static analysis of
that disk tops out at **141 instructions**; everything past it happened
elsewhere. As one of them put it: *"Every commercial C64 disk is crunched;
without this, building from a disk image builds a project of the decruncher."*

**Built: `run_program`.** Runs from an address, follows branches and calls, and
stops when control leaves the program; `capture` keeps a range of the resulting
memory as an ordinary `.prg` in the file store, so the rest of the flow —
`add_byte_layer`, `mark_function` — is unchanged. Running and capturing happen
in one call because a run is under a second and holding one between requests
would be state the transport does not have.

**The stop rule had to be corrected by running the real thing**, and the
correction is the interesting part. "Stop where no layer supplies a byte" sounds
right and is wrong: a loader *relocates itself* and jumps to the copy, so the
rule fires on the program's own code. Revenge of the Mutant Camels moves its
decruncher onto the stack page, and the first version stopped at `$0100` after
1,258 of the 1,768,853 instructions that matter. Code the program wrote is still
the program; code nobody wrote is the KERNAL, or nowhere. That is a rule a
walkthrough found and no amount of reading would have.

**re64 can already run it.** Checked rather than assumed: loading the crunched
file and stepping from `$080D` with the existing `Machine` runs **1,768,853
instructions in 831ms** — no unmodelled instruction, no illegal opcode, no
undecodable byte, 140 distinct addresses executed, one I/O address touched. The
result disassembles to 2481 instructions from `$C065` and 3241 with the raster
IRQ, against the agents' 2495 and 2593. So the CPU is not the missing piece; a
driver is.

**Flat memory is correct here, for a specific reason.** On this machine writes to
`$A000-$BFFF` and `$E000-$FFFF` always land in RAM whatever is banked in — which
is why `POKE I, PEEK(I)` copies ROM into the RAM beneath it — and the only
exception is `$D000-$DFFF` while I/O is banked in. A decruncher writes under ROM,
so a flat 64K model gives the right answer *for the right reason*. What it would
get wrong is reading ROM, or touching I/O with I/O banked in. This binary does
neither, and the next one might.

**The stop condition is semantic, not a budget.** The run ends when the PC enters
ROM — here `$FFBA`, a KERNAL call to load the next file — which is necessarily
after decrunching is done. Nothing has to guess a limit.

### Running the ROM to learn the machine's own defaults

`CHROUT`, `GETIN` and `LOAD` are a `JMP` through a vector in RAM. That is how
they are hooked, so it is correct rather than a failure — and it means their
effects cannot be derived from the ROM alone, because the vector is empty until
something installs it.

`RESTOR` installs it, and `RESTOR` is in the ROM. So the defaults are not
something re64 has to be told: **it runs the routine that sets them.** 232
instructions, writing exactly the 32-byte vector table at `$0314`, and every
value matches published documentation — `$0314` → `$EA31`, `$0326` → `$F1CA`,
`$0330` → `$F4A5`. Which is the trick that gets a project past a decruncher,
turned on the machine itself.

Worth recording because **the chain was not designed**. The lifter and
interpreter exist because two published 6502 references *both* get `ADC` wrong,
so the flag arithmetic had to be tested by executing it rather than by reading
either one. That produced a CPU; Klaus Dormann's suite made it trustworthy; a
trustworthy CPU could run a decruncher; and the driver written for decrunchers
turns out to execute the KERNAL. Every step was justified on its own, and the
capability at the end was nobody's plan.

It is opt-in twice, like the functional test: the ROM is not in this repository
and never will be, so `kernal-vectors.test.ts` skips when it is absent.

### Calling a ROM routine, rather than launching it

`runProgram` starts a program. Calling a *subroutine* is a different thing, and
the difference was hidden until it produced two opposite verdicts on the same
shape of code. `RESTOR` — 232 instructions, an ordinary `RTS` — reported *"left
the program"*, which read as a clean finish. `IOINIT` — 38 instructions, no
illegal opcode, an ordinary `RTS` — reported *"unmodelled instruction"*.

Neither was about the routine. Nothing had pushed a return address, so both
`RTS`s popped an untouched stack and carried on into whatever that pointed at;
one address happened to land outside the map and the other inside the ROM. The
verdict was decided by where the wreckage came to rest.

So `returnTo` pushes a return address and stops when it is reached, giving a
`returned` reason that means what it says. All three of `RESTOR`, `IOINIT` and
`RAMTAS` now return cleanly — `RAMTAS` after 895,862 instructions, because
sizing the RAM means writing all of it.

Worth keeping because the technique it protects is load-bearing: running the
KERNAL's own initialisation is how this project learns the machine's defaults
without being told them, and it was working by luck.

### Shipping what the KERNAL does, to people with no ROM

`npm run gen:kernal` derives `src/core/c64/kernal-effects.ts` — what each of the
39 documented entry points reads and writes — and that file is committed while
the ROM never is. re64 has always shipped *names* for those addresses; this is
what they **do**, computed by its own lifter and call graph rather than
transcribed from a book.

Three steps, and the first is what makes the rest possible:

1. **Run `RESTOR` out of the ROM** for the default vectors. Ten of the 39 are a
   `JMP` through RAM, so their behaviour is not in the ROM alone — and rather
   than assume the published values, the generator executes the routine that
   installs them.
2. **Declare what the indirect jumps resolve to.** The walk still refuses to
   follow one; the generator supplies them, which is sound here precisely
   because step 1 just watched the machine install them.
3. **Analyse**, recording both the wide and the narrow scope.

**Both scopes ship, and that is an admission rather than a convenience.**
`CHROUT` dispatches on the current output device, so following its callees
unions the screen editor, the serial bus, the tape system and the RS-232 code
into **90 cells** — sound, and no use to somebody asking what printing a
character does. `follow: "returning"` does not help: the ROM contains no routine
that abandons its call chain, so there is nothing to cut. The narrow pair is the
dispatch itself, `$009A` and four registers, and is too little. Publishing one
and hiding the other would dress a limitation as an answer, so both are there
with the reason written down. **A dispatching routine wants per-path effects,
which is a real piece of work and is not this.**

One thing the derivation found that a transcription never would: `CHROUT`
appears to read `$03A9` and `$10A9`. Both are the `BIT` skip idiom — `2C A9 10`
is `BIT $10A9`, which exists to swallow the `LDA #$10` in its own operand — so
the read is genuine on real hardware and meaningless as an effect. Left in and
recorded rather than filtered, because recognising `BIT`-as-skip is a decode
question and inventing an exception here would hide it.

### Targets: a named view over the layer stack

The problem both builders hit second: the decrunched image must shadow the
crunched file, so a project can show the bytes **as they load** or the program
**as it runs**, never both, and annotations on the shadowed layer vanish. That is
"one interpretation per address" arriving on call five rather than with Bard's
Tale.

A **target** is a named set of active layers, and it is a view rather than a
change to what a layer is. Two of them here: the loader, and the runtime image.
Annotations keep belonging to layers, so they follow activation — which turns a
mysterious disappearance into a consequence a reader can name.

**Built.** `projectForTarget` narrows the project *before* the memory map is
built, so ownership, annotations and analysis all work on a stack that simply
has fewer layers — rather than each of them learning about targets separately.
Filtering there also keeps `layers[i]` corresponding to `project.layers[i]`,
which several things rely on.

The selection lives in the document, not in a caller, so it is shared and
visible. That is deliberate: a view is a fact about the project, and two agents
disagreeing about which one to read is a conversation rather than a setting. It
moves `version()` and re-analyses, which is correct — the answer really is
different. If the shared selection turns out to be contended, the evidence will
say so and a per-call override is a small addition; guessing now would be
building the override before anyone has wanted it.

`list_targets` reports **every** layer, including those the current selection
hides, because that is how a caller finds the view that shows them — the read
that verifies the write, again.

Removing the selected target clears the selection. A selection pointing at
nothing reads as a filter that silently does nothing, which is worse than no
selection at all.

Entry points split rather than move wholesale. A PRG layer's load address is
*inherent to that file* and stays on the layer; `function` and `code` labels are
already layer-owned and follow for free; only the project-level `entryPoints`
list belongs to a target. That is one field moving, and it dissolves the
`describe_project` complaint that entry points read 2 while `decodeStartsFrom`
read 19 — those were two different questions with no way to say which was being
asked. A default target takes every layer and every entry point, so a one-layer
project declares nothing.

Held loosely on purpose: whether *comments* should belong to a layer or a target
is exactly the kind of thing to settle with evidence rather than by argument,
having already been burned once by `set_comment`'s slot-keyed upsert being
justified for a single author and never revisited.

### Building a project, rather than annotating one

Every experiment before this handed agents a project that already existed, so
the path from *a binary* to *something disassemblable* had never been exercised
by anything but the CLI. `add_layer` made `symbols` layers only, nothing could
read a disk image, and there was no way to get bytes in at all — which is why
`layer.set` was recorded as missing and this was not: the gap was larger and
nobody had noticed, because no run had ever needed it.

**Bytes go over HTTP, never through a tool argument.** A D64 is 175KB, which is
~233KB of base64 and something like 58k tokens through a model's context for a
file it never reads. `prepare_upload` returns a URL; the caller PUTs the bytes.

**The token carries the project, the name and the caller**, issued before the
bytes arrive — so the upload *completes* the link and a blob with no owner
cannot be created. A project-less upload would have allowed exactly that, in a
system whose whole identity story is that every edit is attributable; if the
upload never happens the token expires and nothing was made. It is **not
authentication**, and the comment on it says so: this server has none, and what
a single-use expiring token buys is that a blind POST cannot fill the disk.

**Files are in the document, like constants and decoders.** That was the cheap
answer to "how does an agent verify the upload" — it needs no `list_files`,
because a file appears wherever the project is described, and the upload is an
op, so it is attributed, undoable, and in the export. It also closes something
older: a `.re64` said `"path": "gridrunner.prg"` and could not tell you *which*
bytes the annotations were made against. Now the hash travels with the name,
which is what the `blobs` table comment always claimed it was for.

**`diffProjects` emitted `layer.add` for symbols layers only**, from when that
was the only kind an operation could make — and the filter outlived the limit.
A byte layer reached the document, was reported by `describe_project`, and never
reached the file; the next write naming that layer then failed against a text
project that had never heard of it. Third instance of the same shape, after
`meta.set` and `layer.add` itself: **the vocabulary being closed is checked by
the compiler, and whether anything emits a member of it is not.**

Verified end to end on Revenge of the Mutant Camels: create a project, upload
the disk, read its directory, lay a `prg` layer over `revenge.d64:revenge
fixed`, and the decode is five instructions — a BASIC stub — until `SYS 2061` is
marked a routine, at which point it is forty-four. That jump is the acceptance
test, because it is the moment a project stops being a file and starts being a
program.

Worth knowing about that disk: it holds a **crunched** build, `SYS 2061` into a
decruncher, and the standalone `.prg` beside it is a different, unpacked binary
at `SYS 34800`. The oracle disassembles the second. So a run given only the disk
reaches a packed program that re64 cannot unpack, which bounds what that
experiment can ask for — and is itself the kind of thing worth finding out.

### A name that reaches two addresses, and project hygiene

Two labels can share a name, and in a CRDT that cannot be prevented: peers name
things without seeing each other and a merge brings both in. So the question is
not how to refuse a collision but how to render one without lying — and the
listing did lie. With `scoreDigits` at `$0410` and at `$0413`, both rendered as
bare `scoreDigits`, and `scoreDigits+4` meant `$0414` against one and `$0417`
against the other. Both neutral readers in experiment 3's control run hit it, and
one described the result exactly: *a wrong answer that looks right*.

**`primaryLabels` does not help, and it is worth saying why.** It picks one name
among the labels at *one address*. This is the transpose — one name across
*several addresses* — and nothing arbitrated it.

**Every colliding label is qualified, not one of them.** `name@<id>`, on all
holders. Symmetry is what makes it simple: there is no winner to elect, so no
tie-break rule, and rendering becomes a pure function of the name, the id, and
whether the name is shared. The invariant bought is the one that matters —
**every name that appears identifies exactly one label** — and a bare name is
therefore trustworthy without cross-checking. The cost is that a collision
changes how *both* labels render, including one somebody had been reading for an
hour; that is the honest signal, and it is what makes the collision impossible to
miss.

**Ambiguity is one name reaching two *addresses*, not two labels.** That
distinction is the whole check. Two labels at one address holding one name is
duplication — `COLOR_RAM` still identifies `$D800`, the row renders once, nothing
is unclear — and the reference project has ten such pairs. A first version
counted labels rather than addresses and reported all ten on a project with
nothing wrong with it.

Which is the general rule, and it is worth more than the instance:

### Hygiene is not analysis, and a check that fires on a healthy project is not a check

`ProgramAnalysis.hygiene` is deliberately a separate collection from `warnings`,
because the two have different subjects. A warning is a fact about *the program*
— "flow reaches `$8D16`, which is declared data" — and you investigate it. A
hygiene finding is a fact about *your own annotations* — "two labels are called
scoreDigits" — and you tidy it. One list holding both makes a reader triage prose
to discover which kind they are looking at.

Two rules decide what belongs, and the second is what keeps the list readable:

- **It renders wrong, renders nowhere, or renders ambiguously.** Tied to a
  consequence in the listing rather than to taste — which is what excludes two
  constants sharing a value under different names, since that is
  `LEFT_ZAPPER`/`WHITE` and the model working as designed.
- **Zero is the resting state.** `find_undecoded` counts *incompleteness*: it
  starts at the whole binary and shrinks as work proceeds, so it is a work queue
  and belongs nowhere near here. A list that always has entries gets ignored, and
  the one entry that mattered gets ignored with it.

The starting set is shared label names, constants declared with one name and two
values, annotations sitting inside an instruction, regions naming a decoder that
is gone, and several inline comments on one row. It should grow from evidence — a
run tripping on something — rather than from a tidiness instinct, which is how
the ten false findings above were nearly shipped.

**Cost is a boundary, not a hope.** Every check is O(n) over structures the
analysis already built, measured at 0.15ms against 10–20ms for the disassembly
itself; the label-name map is needed for rendering anyway, so the collision list
falls out of work already done. Anything requiring its own traversal — "is this
named routine reachable" — goes in a separate on-demand function from the start
rather than being added here and discovered to be slow later.

### A catalogue of the machine's trickery, in the fewest bytes that show it

`src/core/arch/mos6502/idioms.test.ts`. Every entry was met in a real binary —
Gridrunner, the KERNAL, or Revenge of the Mutant Camels — and each is a place
where the obvious reading of the bytes is wrong.

It exists because **the evidence now spans three programs and is growing**, and a
corner case pinned only against a 65KB binary is one nobody can see: that
assertion says "Gridrunner still works", not "this is what `PLA PLA RTS` means".
So each is reduced to the fewest bytes that still show it and records **where it
was seen**, so the provenance outlives the binary. Duplicating a component's own
test is deliberate and cheap — a component test says the component works, this
says what the machine does.

The rule for adding one: a *naive* reading gives a confidently wrong answer. Not
merely unusual — wrong.

Two of the first fifteen were written with the wrong expectation, which is the
argument for the file in one line. `PLA TAY PLA TAX PLA RTI` is *not* balanced —
the interrupt pushed what it is popping — and asserting otherwise would have
pinned a bug. And a `JMP` whose target is inside its own operand bytes was
written twice, in two different sessions.

### Name the observation; let the caller bring the knowledge

This machine is full of things that look like defects and are idioms. `BIT $10A9`
is a two-byte skip that swallows its own `LDA #$10`, and it really does read
`$10A9`. `RDTIM` falls through into `SETTIM`, so reading the clock writes it back
and re-enables interrupts. `PLA PLA RTS` returns to its caller's caller. `JMP
($10FF)` takes its high byte from `$1000`. A `CLC` before `SBC` subtracts one
more than the operand reads, and is sometimes deliberate.

Trying to *resolve* these in the analysis is the losing move: each one wants its
own special case, and every special case is a place where a confident wrong
answer can hide. What the analysis can do well is **notice precisely and name
what it noticed**, and then let whoever is reading — a person, or an agent with
knowledge of the machine that no pass here encodes — settle it.

So an observation is a **kind**, not a sentence:

| | |
|---|---|
| `DisassemblyWarning` | `undefined`, `truncated`, `overlap`, `oddJumptable`, `flowIntoData`, `indirectJump` |
| `HygieneFinding` | `label.nameShared`, `constant.nameShared`, `region.missingDecoder`, … |
| `ReturnBehaviour` | `abandons`, `skips`, `ambiguous` |
| `EffectGap` | `unmodelledInstruction`, `calleeSkipsFrames`, `calleeNotDecoded` |

`EffectGap` was the last holdout and the most costly one, because it sits on the
field that answers *"can I trust this list"*. It was `string[]`: an agent that
knows perfectly well what `$F1CA` does could not say "ignore that gap" without
parsing English. Each type keeps a `describe*` beside it, so the prose is still
there for a reader and the kind is there for a caller. **Naming costs nothing and
un-naming is expensive**, which is the argument for doing it at the point the
observation is made rather than when somebody finally needs it.

The two failures this prevents are opposite, and this file has now made both:

- **Conflating two observations under one name.** `skipsFrames: 0` meant both
  "resets the stack" and "the analysis cannot tell", so a cut keyed on it threw
  away whole routine bodies. A fact about the program and an admission about the
  pass must never share a name.
- **Giving an observation no name at all**, which forces every consumer to
  either ignore it or parse it.

**One batch contract, across every batch tool:** apply what you can, report what
you declined in `rejected`, and fail only when nothing was applicable. Undo stays
coherent because the changeset covers exactly what was applied. `bind_constants`
was made partial and `add_comments` was not, so two batch tools disagreed about
their own contract and a caller could not tell which it would get.

### A tool built on a rhetorical flourish, and taken back out

`changes_at` answered "who has already touched this address" — `git log` with an
address range as the path. It lasted an hour. Worth recording, because the way it
got built is more instructive than the tool was.

Both readers in experiment 3 collided three times, and one of them wrote: *"the
write side is complete and the who-else-touched-this side is not."* That sentence
is a generalisation of the collision it had just hit, and it was taken as the
finding. **The log says otherwise**, and this file already carries the rule that
was not applied: where a report and the request log disagree, the log wins.

```
23:36:59  gfx   set_decoder      <- writes it
23:37:07  gfx   list_decoders    <- checks, 8s AFTER
23:38:34  lead  set_decoder      <- writes it
23:38:39  lead  list_decoders    <- checks, 5s AFTER
```

Neither checked before writing. Both called `list_decoders` immediately after, to
obtain the id `set_decoder` did not return — so that collision was not a missing
query and not a check-then-act race, and the fix was to return the id. Likewise
`changes_since(0)` "returning empty when it mattered" was empty because nothing
had happened yet, fifteen minutes before the collision it was blamed for.

The three collisions, honestly attributed:

| collision | cause | fix |
|---|---|---|
| one constant bound in two places | a real lookup gap | `boundAt` on `list_constants` |
| the duplicate decoder | `set_decoder` returned no id | it returns one |
| identical header edits, 4s apart | genuine simultaneity | none; no query prevents it |

None of them wanted a history-by-address query. **A capability that answers no
question anybody asked is the thing the vocabulary rule exists to refuse**, and
"a person would want it in a UI" is the *quiet* signal in that rule rather than a
licence.

**Parked, from the same conversation:** rather than a filter per question,
snippets already are the mechanism for expressing logic this project cannot
anticipate — so a query over the ops log could be a snippet, reusing the SES
sandbox verbatim. The cost is not safety, which is unchanged, but the contract: a
decoder is `bytes -> data` and `validateDecoded` checks the shape it returns. A
log query is `records -> records`, which widens a snippet from "numbers out" to
"JSON out" and leaves nothing to validate. Nothing needs it at this size —
scanning the whole log is cheap — so it stays written down rather than built.

### Bytes as pictures

A C64 program's data is mostly images, and a hex column is the worst possible
way to look at one. Every reader in experiment 2 ended up scraping hex out of a
listing and writing their own bitmap printer, which is the clearest available
statement that this belongs in the tool.

**A decoder returns pixels, not pictures.** `src/core/view/bitmap-view.ts` is
DOM-free like `map-view.ts`: it hands back palette indices, and each consumer
draws them its own way. That is what lets one decoder serve the browser, the CLI
and an agent — and it is the contract a user-supplied decoder will have to
satisfy, so it was worth settling while the only implementations are ours.

**A bitmap region renders as text art, in the row model.** Not an inline canvas:
the same rows go to the browser, to `re64 disasm` and to `export_listing`, so
nothing is built twice and the listing somebody exports looks like the listing
they were reading. Colour and zoom belong in an explorer panel, where you are
choosing a format rather than reading code. Every art line repeats the address,
exactly as a multi-line comment does — a wrapped line and a hand-broken one are
the same thing here too.

**`view` is one string, not three fields.** `char:8`, `bits:3`, `sprite`. A
format, a stride and a column count would each have to be threaded through the
schema, the line serializer, the CRDT assignment, the op type, the diff, the
inverse and four call signatures — that is twelve sites per field. One string
diffs readably and leaves room for `snippet:<id>` without doing it again.

`bits` with a stride is the format that matters: sliding the byte width until an
image snaps into focus is how anyone has ever found graphics in a dump. The
others are the hardware's own layouts, worth having because guessing a sprite's
stride is tedious when only one is legal.

Default colours are black and white rather than the machine's own light-blue on
blue. Authenticity would be unreadable both as terminal shading and as a
thumbnail, and the real colours live in colour RAM somewhere else entirely, so
any choice here is a viewing default rather than a claim about the program.

**The explorer is a place to look, not a view of the model.** It writes nothing
to the project until you press the button, which matches how anyone actually
finds graphics in a dump — point at an address, slide the width, stop when a
picture appears — and means being wrong costs nothing. Once you have found
something, declaring it records what you found. It repaints itself on a slider
drag without going through `render()`, which would re-analyse the program for a
change that is purely about looking.

It brought the **first `EditorView.updateListener` in the codebase**, so the
panel can follow the cursor; `currentAddress()` had only ever been polled on
demand. Coalesced on a frame like every other repaint.

**Adding a `RegionKind` has exactly one compile-time guard and nine silent
sites.** `rowStrategy`'s `never` default is the guard. The rest — the runtime
`REGION_KINDS` whitelist, the MCP `z.enum` *and* its hand-duplicated arg union,
the CLI kind string, the explained-kinds list in `undecoded`, `shouldDisassemble`,
`generateLabels`, the analysis filter, and a colour in `index.html` — must be
found by hand. The runtime whitelist is the nastiest: miss it and every write
throws `Unknown region kind`, so a missing case looks like a broken tool.

### Declaring a region inside another nests; it does not replace it

`regionSetOp` used to match an existing region by **start address** alone and
reuse its id, so declaring 32 bytes of a 512-byte `characterSetData` region a
bitmap *shrank* it to 32 bytes and left the other 480 explained by nothing,
silently.

Nesting is the right answer, and splitting the outer region is not: splitting
mutates a region the author never asked to change and invents a second one to
hold the remainder, where nesting leaves *"$8E00–$9000 is the character set
data"* true and adds a more specific statement inside it. Both are true at once,
which is what overlap is for. The model already supported it — regions may
overlap and `getRegionAt` resolves innermost-first — so the inner one renders
inside its span, the outer one either side, and nothing becomes unexplained.

**A region has an id, and that is the way to name one.** `describe_project`
reports them and `set_region`/`remove_region` accept them, which removes the
inference entirely: an id says *this* region, however far its span has moved.
That is the same rule everything else here follows — "an address cannot identify
a label", and a region's start is no better, which the identity section said long
before regions could nest.

The inference below is what happens when no id is given, because usually none
is: a person reading a listing sees an address, not an id.

Three cases, strongest signal first:

| declaration | meaning |
|---|---|
| the same span exactly | one statement corrected — reuse the id |
| the only region starting here, and not strictly inside it | an extend or a move |
| strictly inside, or ambiguous because several regions start here | a new region, nested |

**Checking the exact span first is not a detail.** Without it, re-declaring the
same span inside a larger region nests again on every call, and two identical
spans then race to be the innermost — which showed up as a test that passed
eight times in a row and then failed twice.

**Nesting also cost the start address its uniqueness**, which `remove_region`
had been relying on: two regions can now begin in the same place, and picking
whichever the array listed first would delete the wrong one silently. An
ambiguous start is refused and names the candidates, which is also how a caller
learns the ids it should have passed.

To shrink a region without naming it, remove it first. The edit result says so:
`nestedInside` names the enclosing region and how to replace it instead, because
"I declared 32 bytes and a 512-byte region is still there" should not have to be
discovered by reading the map afterwards.

### Text Region Rendering

A text region declares its **encoding**: `petscii`, `screen`, or `ascii`. Neither
C64 encoding is ASCII — `$01` is `A` on the screen and a control code in
PETSCII — so reading one as the other produces confident nonsense, which is what
this did for every game that puts its strings in screen codes.

Most of both encodings maps to plain ASCII. The graphics characters map to
Unicode that already existed for other reasons — box drawing, block elements,
card suits — plus the *Symbols for Legacy Computing* block added in Unicode 13
for exactly this. **Graphics coverage is deliberately partial**: every code that
carries text is exact, the common glyphs are there, and the rest renders `·`
rather than guessing. A wrong glyph is worse than a visible gap, and text is
what a reader is after.

A text row now shows its decoded content rather than a bare `.TEXT` directive.
That was not a missing feature so much as a defect: declaring a span text made
the listing *less* readable than leaving it as data, which at least printed an
ASCII column.

**Still not solved: custom character sets.** Many C64 games ship their own glyph
data — Gridrunner's copyright line reads `(c) 1982 HES` through the charset at
`$2000` and `<= 1982` through any built-in encoding. Getting that right means
either a byte-to-glyph mapping in the project file, or reading the game's own
charset and matching glyph bitmaps against known shapes. The first is a schema
addition and a decoder; the second is real work and would be the interesting
version.

What changed for the better meanwhile: the wrong answer is now *visible*.
`<= 1982` is obviously not English, where a bare `.TEXT` said nothing at all.
