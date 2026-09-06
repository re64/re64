# re64

An agentic-first C64 disassembler. Reverse engineering a game is a long grind of
recognising a routine, naming it and moving on, and that is work an agent can do
alongside a person rather than instead of one.

Four consumers sit over one document, and none of them is the primary: a CLI, an
HTTP API, a web UI, and an MCP surface for agents. They share a document rather
than a file format, so an agent naming a subroutine and a person reading the same
code see each other's work as it happens.

## Status

In active development.

**Reading a binary.** PRG files and D64 disk images; stacked memory layers;
a work-queue 6502 disassembler with control-flow analysis; text, bitmap and
record rendering; a cross-reference arrow gutter drawn identically in the CLI and
the browser.

**Saying things about it.** One noun — a *claim* — carries a name, what the bytes
are, how far it reaches, and whether to decode from there. Adding always adds and
correcting is by id, so two people who disagree both stand and the contradiction
is reported rather than resolved by whoever wrote last.

**Understanding it.** A P-Code lifter over all 56 documented instructions, an
interpreter that passes Klaus Dormann's functional test suite including decimal
mode, basic blocks, a call graph, per-routine effects, and known-bits value
analysis for proving flags. `run_program` executes the program's own decruncher.

**Working together.** Real-time collaboration over a WebSocket, a shared chat, a
participant list, per-session undo, and an append-only operation log every
surface writes through.

**Agents.** 72 MCP tools inside the same server, so an agent's edit lands in an
open browser without a reload.

## Documentation

| | |
|---|---|
| `docs/model.md` | the document model as it stands — read this first |
| `docs/api.md` | the MCP surface, from the live schema |
| `docs/experiments.md` | eight agent runs, and what each one changed |
| `CLAUDE.md` | why any of it is shaped the way it is |

## Development

```bash
npm install
npm run build
npm test
```

## Usage

### Basic commands

```bash
npx re64 version              # Show version
npx re64 dump --help          # Show dump command help
npx re64 disasm --help        # Show disassemble command help
```

### Project files

The recommended way to work with re64 is through project files (`.re64` JSON files):

```json
{
  "name": "My Game",
  "layers": [
    { "id": "lay_game", "type": "prg", "path": "game.prg" }
  ],
  "claims": [
    { "id": "clm_1", "at": "$02", "name": "playerX" },
    { "id": "clm_2", "at": "$0810", "name": "MainLoop", "root": "routine" },
    { "id": "clm_3", "at": "$2000", "extent": 4096,
      "name": "spriteData", "is": "data", "layer": "lay_game" }
  ],
  "entryPoints": ["$0810"]
}
```

A **claim** is anything anybody says about an address: a name, what the bytes
are (`is`), how far it reaches (`extent`), whether to decode from there
(`root`), or any combination. What used to be a "label" is a claim with a name;
what used to be a "region" is one with an extent and an `is`.

A claim belongs to the layer supplying its bytes — stored as an offset, so
relinking that layer moves the claim with it — or to the target, for addresses
no file supplies. That is derived from the address; you never say it, and the
tools speak absolute addresses throughout.

Standard C64 hardware registers and KERNAL entry points (`$D020 EXTCOL`,
`$FFD2 CHROUT`, …) are built in, so projects only declare names they want to
override. Older files carrying `labels` and `regions` inside layers still load;
`re64 migrate` converts one.

```bash
# Disassemble using project file
npx re64 disasm -p game.re64

# Disassemble specific range
npx re64 disasm -p game.re64 -r '$0800:$0900'

# Without the cross-reference arrow gutter
npx re64 disasm -p game.re64 --no-arrows
```

### Editing

Edits go through an operation layer shared with the web UI, and are recorded
beside the project so undo survives the process exiting.

```bash
npx re64 label set game.re64 '$81A2' DrawGrid --type function
npx re64 label rm  game.re64 '$81A2'
npx re64 region set game.re64 '$8080:$80A0' text --name copyright
npx re64 apply game.re64 ops.json --author agent-1   # a batch
npx re64 undo game.re64
npx re64 redo game.re64

npx re64 migrate game.re64    # write stable ids into an older project
```

`apply` takes a JSON array of operations, which is how an agent edits a project
without a browser:

```json
[
  { "op": "claim.add",
    "claim": { "id": "clm_a1b2c3", "at": 33186, "name": "DrawGrid",
               "root": "routine",
               "by": { "author": "agent-1", "source": "user" } } }
]
```

The CLI's `label` and `region` subcommands are the old vocabulary over the new
model — they write claims. Agents use the MCP surface, where the vocabulary is
`add_claim`, `set_claim` and `remove_claim`; see `docs/api.md`.

### Loading files directly

```bash
# Load a PRG file (address from 2-byte header)
npx re64 dump -l game.prg

# Load a PRG from a D64 disk image
npx re64 dump -l 'disk.d64:filename'

# Load a raw file at a specific address
npx re64 dump -l '$e000,kernal.rom'
```

### Memory layers

Layers are stacked - later layers shadow earlier ones:

```bash
# Zero-fill $1000-$2000, then overlay with PRG
npx re64 dump -l '$1000+$1000,#00' -l game.prg

# Fill with a repeating pattern
npx re64 dump -l '$d000+$100,#deadbeef'
```

### Specifying ranges

Addresses use `$` (or `0x`) prefix for hex. Ranges can be:
- `start+length` - e.g., `$1000+$100` (256 bytes from $1000)
- `start:end` - e.g., `$1000:$1100` (same range, end exclusive)

```bash
# Dump specific range
npx re64 dump -l game.prg -r '$0800+$100'

# Disassemble specific range
npx re64 disasm -l game.prg -r '$0800:$0900'
```

### Layer syntax summary

```
<file.prg>                - PRG file (address from header)
<image.d64:name>          - PRG from D64 disk image
<addr>,<file>             - raw file at address
<range>,<file>            - raw file repeated to fill range
<addr>,#<hex>             - inline bytes
<range>,#<hex>            - inline bytes repeated to fill range
```

## Architecture

### Conceptual Model

Two layers, where there used to be three.

```
┌──────────────────────────────────────────────────────────────┐
│  Layers — bytes, and nothing else                            │
│    a PRG, a raw file, inline hex, a symbols table, a ROM     │
│    dumb resources: they hold bytes and know nothing about    │
│    where they sit                                            │
└──────────────────────────────────────────────────────────────┘
        │  arranged by
        ▼
┌──────────────────────────────────────────────────────────────┐
│  Targets — which layers, in what order, at what address      │
│    the order is the z-order; a layer can be linked into two  │
│    targets at two addresses, which is what a program that    │
│    relocates its own code needs                              │
└──────────────────────────────────────────────────────────────┘
        │  described by
        ▼
┌──────────────────────────────────────────────────────────────┐
│  Claims — everything anybody says about an address           │
│    name · is · extent · root, any of them, at least one      │
│    several cover any interesting address, and that is the    │
│    design: adding always adds, correcting is by id           │
└──────────────────────────────────────────────────────────────┘
```

**Nothing resolves at rest.** Which name an operand shows, whether a byte is
code, how a span renders, what nests inside what — all of it is derived when
something asks. `disagreements()` reports where a project contradicts itself
rather than picking a winner.

`docs/model.md` is the full reference.

### Project Structure

```
src/
├── core/             # pure; runs under Node and in the browser
│   ├── memory/       # MemoryMap, layers, comments, constants, types
│   ├── claims/       # the model: Claim, NameIndex, decode graph, listing
│   ├── arch/
│   │   └── mos6502/  # opcodes, decoder, work-queue disassembler
│   ├── il/           # P-Code lifter, interpreter, value analysis
│   ├── c64/          # D64 parser, built-in symbols, derived ROM effects
│   ├── project/      # schema, loader, serializer, migration
│   ├── ops/          # the closed edit vocabulary, each with an inverse
│   ├── crdt/         # the Yjs document; the only place yjs is imported
│   ├── analysis/     # blocks, call graph, routines, effects, hygiene
│   └── view/         # view model: rows, tokens, arrow lanes, gutter
├── sandbox/          # SES compartments for decoders somebody else wrote
├── cli/              # Node I/O; renders rows as text
├── ui/               # browser; renders rows as CodeMirror decorations
├── store/            # SQLite persistence, the update log, the ops history
└── server/           # HTTP, WebSocket sync, and server/mcp/ for agents
```

**Analysis runs client-side, and also on the server.** The core library is free
of Node APIs, so the same disassembly runs in the CLI, in the browser and on the
server. The browser holds its own `Y.Doc` and analyses locally, which is why a
rename shows instantly and only the sync crosses the wire. The server analyses
too — an agent has no local analysis — cached per document version and computed
only when a tool asks.

**The CLI and the web UI share one render walk.** Both consume the same rows —
the CLI prints them and ignores the interaction spans, while the UI turns those
spans into clickable decorations. The cross-reference arrow gutter is drawn in
both.

## License

MIT
