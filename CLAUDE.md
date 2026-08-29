# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/claude-code) when working with code in this repository.

## Project Overview

re64 is a C64 disassembler. The long-term goal is a collaborative web-based tool with CRDT support for real-time collaboration. Currently it's a local CLI tool in active development.

## Architecture

### Directory Structure

- `src/core/` - Platform-agnostic code shared between CLI and future web UI
- `src/cli/` - Command-line interface using Commander
- `assets/` - Example files and project configurations
- Future: `src/server/` and `src/ui/` directories

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

- Minimal dependencies - only add packages when clearly beneficial
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

**Operations are the interface.** `src/core/ops/` holds a closed vocabulary, each
op with a computable inverse, applied to project *text* through the line-editing
serializer. They are the agent API, the history record, and the undo
description. The CRDT beneath only decides how concurrent edits merge; nothing
reads a binary update to learn what happened. The property the tests hold to is
that an op followed by its inverse restores the exact original bytes.

**Yjs sits behind one door.** `src/core/crdt/` is the only place that may import
it, asserted by a test. Readable JSON stays canonical; a document is built from
it at the start of a session and flattened back at the end. That works only
because construction is deterministic — fixed `clientID`, sorted insertion — so
two clients loading the same file produce byte-identical documents and their
edits have a common ancestor.

**Flatten must go through operations**, never `formatProject`. A document knows
the content everyone agreed on, not how the file was laid out: which labels a
blank line grouped, what order regions were declared in. Regenerating the text
turns a one-line edit into a whole-file diff. So a session is diffed against the
file and the resulting ops applied line by line.

**A session ends on a timeout**, not a goodbye. Tabs close without warning and
agents simply stop; waiting for a clean exit would mean rarely flattening. It
also lets a reload rejoin rather than splitting one piece of work in two.

**How edits reach the filesystem.** Three moments, deliberately distinct:

- **A debounced write, ~1.5s after edits stop.** The project file tracks a live
  session closely, so `git diff` shows the work as it happens, the CLI reads
  current content, and an editor open on the same file stays in step. Without
  this the file would sit stale for as long as anyone stayed connected.
- **A flatten, ~30s after the last participant leaves** (or on SIGINT/SIGTERM).
  Writes anything outstanding and records one history entry.
- **An HTTP PUT**, which writes immediately.

All three write from the *whole document*, never one caller's own changes.

History is accumulated as the session writes, not derived at the end — the file
is already current by then, so an end-of-session diff would be empty and the
entry would be lost.

Files beside the project:

| Path | Holds | Committed? |
|---|---|---|
| `<name>.re64` | the project | yes — this is the artefact |
| `<name>.re64.history` | one JSON line per flattened session | your call; it is the record git cannot give, since it names who did what within a session |
| `<name>.re64.session` | Yjs updates awaiting a flatten | no — gitignored, transient, deleted once written |
| `<name>.re64.log` | the CLI's undo log | no — matched by `*.log` |

Persistence serves three separate purposes, and they want different answers:

| Purpose | Format | Shape | Lifetime |
|---|---|---|---|
| Crash safety | Yjs updates, length-framed | append-only log | dropped after flatten |
| The project | JSON | last state | canonical |
| History | JSON, one entry per session | linear | durable |

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
  (`# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/claude-code) when working with code in this repository.

## Project Overview

re64 is a C64 disassembler. The long-term goal is a collaborative web-based tool with CRDT support for real-time collaboration. Currently it's a local CLI tool in active development.

## Architecture

### Directory Structure

- `src/core/` - Platform-agnostic code shared between CLI and future web UI
- `src/cli/` - Command-line interface using Commander
- `assets/` - Example files and project configurations
- Future: `src/server/` and `src/ui/` directories

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

- Minimal dependencies - only add packages when clearly beneficial
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

 dropped from a template literal, blank lines stripped by a serializer).
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

*Not blocked by any of this:* annotation edits still have **no undo**.
`history()` is wired only to the project JSON editor. Every edit has a natural
inverse, so a small client-side command history closes the gap today without
prejudging the above.

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

### The file is shared, not owned

The server is not the only writer. `re64 label set` writes the project file
directly, with no server involvement, and a user may have it open in an editor.
Left alone this loses data *silently*: the server's write applies
`diff(document, file)`, so an edit the document never learned about is diffed in
the wrong direction and reverted.

So the file is treated as another participant. The store watches it, and an
external change becomes ordinary operations applied to the shared document —
which merges them and broadcasts them to connected sessions like any other
edit. External ops are recorded in the session history under the author `file`,
since the store cannot know who wrote it but must not claim a session ended in
a state it did not.

Two things this depends on:

- **Writers rename a temporary file over the target** (`src/fsutil.ts`), so no
  reader ever sees a half-written project. Both the CLI and the server do this.
- **The watch is on the directory, not the file.** A watch on a path follows the
  inode behind it, and the rename above replaces that inode — so a file watch
  goes deaf after the first write, *including the server's own*. This was found
  the hard way; the symptom is a watcher that appears to work until the first
  save.

The store tells its own writes from everyone else's by comparing content against
the text it last wrote, rather than trusting watch events, which coalesce, fire
spuriously, and differ between platforms. A file caught mid-save or hand-edited
into invalid JSON is skipped rather than treated as a deletion of everything;
the next event brings the valid content.

Persistence driven by timers is wrapped so a failure reports rather than
throwing: the file is outside the server's control and can vanish under a live
session, and an unhandled throw in a timer takes the whole process down. Losing
one write is recoverable — the session is still in the document and the sidecar
log — while losing the server is not.

Long term this belongs in SQLite rather than the filesystem, with an import
path for existing project files; deliberately deferred to keep the current
barrier to entry low.

## Known Limitations & Future Features

### Text Region Rendering
Text regions currently display raw bytes with `.TEXT` directive. Many C64 games use custom character sets with proprietary encodings (not standard PETSCII or screen codes). To properly decode text, one would need to analyze the game's character set glyph data.

**Future feature idea:** Allow custom renderers as JavaScript snippets in the project file. Users could define decoding functions that map bytes to display characters based on the game's specific charset. This would enable proper text display for games with custom fonts.
