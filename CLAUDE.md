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

- Minimal dependencies - only add packages when clearly beneficial.
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
at what is not part of the project.

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

**Comments are wrapped in the row model, at a fixed column**, and that is what
keeps the arrow gutter correct. A wrapped line becomes *another comment row at
the same address*, identical in every way to one the author broke with a
newline — so there is no continuation row to style, no special case in the
gutter, and no way for the two to drift apart. The gutter is rendered per row,
so a comment occupying three rows gets three cells and its verticals connect.

Soft wrapping cannot do this: a soft-wrapped line is still one document line and
gets one gutter cell, so the connector breaks across it. That is the whole
reason the wrap lives in the model rather than in the view.

**Fixed at 100 columns, not derived from the viewport, and that is the point.**
Wrapping to the window would make the row model depend on the window: every
resize would rebuild the document, on top of whatever selection or inline editor
was open. A column is a property of a listing, the way it is in a hand-written
disassembly, so nothing recomputes when a pane moves — and the CLI gets the same
listing for free. `AnalyzeOptions.commentWidth` is the seam for making it
configurable; nothing sets it yet.

Two things it deliberately does not touch. An **inline** comment shares its row
with an instruction and cannot be broken, so those rows may still exceed the
column — the only ones that do. And a **word longer than the width** is left
long rather than split, since it is usually an identifier or an address and
breaking it makes it unselectable to save a column.

The soft toggle stays, for the residual case of a window narrower than the
column.

Two gotchas worth remembering:

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

Writing the same slot twice **revises** rather than stacking, since that is one
person changing their mind rather than two comments.

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
| `find_references`, `find_unnamed` | who calls this, and what is worth naming next |
| `block_effects`, `run_block` | what a routine *does*, statically and by running it |
| `set_label`, `remove_label`, `mark_function`, `unmark_function` | naming |
| `set_region`, `remove_region` | exposed to agents **before** the web UI; the ops and the CLI already did this, so it was wiring rather than new capability |
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

- **`block_effects`** is static: what the block at an address reads and writes,
  unioned over its lifted operations. True for every input. Sound only because a
  block is straight-line, which is the analysis dividend of splitting strictly —
  at calls and at every jump target — rather than loosely.
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
**oracle**: `assets/gridrunner.asm` is 65KB of human reverse engineering, so
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
   assignment**, because whether agents invent claim-and-release is the finding;
   pre-building it replaces the finding with an assumption.

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
documented instructions, and stops there. That boundary is asserted by
`src/core/il/functional.test.ts` rather than described, so the gap is a passing
test instead of prose, and nothing can regress into looking like a decimal
failure. It is opt-in twice: the binary is fetched rather than committed, and
26 million instructions take about thirteen seconds.

Decimal is the one thing left, and it does not touch the subject at hand —
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
