# re64

An **agentic-first, collaborative C64 reverse engineering framework**. Reverse
engineering a game is a long grind of recognising a routine, naming it and moving
on, and that is work an agent can do alongside a person rather than instead of
one.

Three consumers over one document: an **MCP surface** for agents, a **web UI** for
people, and the **HTTP API** both sit on. They share a document rather than a file
format, so an agent naming a subroutine and a person reading the same code see
each other's work as it happens.

## Status

In active development.

**Reading a binary.** PRG files and D64 disk images; stacked memory layers; a
work-queue 6502 disassembler with control-flow analysis; text, bitmap and record
rendering; a cross-reference arrow gutter drawn from the model, so every surface
draws the same one.

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

**Agents.** 75 MCP tools inside the same server, so an agent's edit lands in an
open browser without a reload.

## Documentation

| | |
|---|---|
| `docs/purpose.md` | what this is for |
| `docs/developer-guide.md` | **start here** — the model and the API, end to end |
| `docs/model.md` | the model as reference |
| `docs/algebra.md` | the operation rules |
| `docs/api.md` | the MCP surface, generated from the live schema |
| `docs/invariants.md` | what must not break, and what pins it |
| `docs/experiments.md` | nine agent runs, and what each one changed |
| `docs/decisions/` | why any of it is shaped the way it is |

## Development

```bash
npm install
npm run build
npm test
```

`npm run typecheck` covers both tsconfigs; `npm run build:ui` bundles the
browser.

## Running it

```bash
npm run build && npm run build:ui
npm run serve                      # http://127.0.0.1:5164
```

Open the browser at that address for the web UI, and point an agent at the same
server:

```bash
claude mcp add --transport http re64 http://127.0.0.1:5164/mcp \
  --header "X-Re64-User: <user id>"
```

The user id is one from `list_projects`; the server does not verify it.

### Starting from a binary

There is no separate import step and no save step — a project is built through
the API and every edit is durable when the call returns:

1. `create_project`
2. `prepare_upload`, then PUT the bytes to the URL it returns — a disk image is
   ~175KB, and base64 of it through a tool argument would be tens of thousands of
   tokens for a file nothing reads
3. `list_disk_files` if it is a `.d64`
4. `add_byte_layer` over the file, or `add_rom_layer` for a KERNAL or BASIC ROM
5. `mark_function` at the entry point

On Revenge of the Mutant Camels that sequence takes the decode from five
instructions — a BASIC stub — to forty-four, which is the moment a project stops
being a file and starts being a program.

A `.re64` file is an **import source or an export target**, never the truth.
`export_project` returns one.

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
├── tools/            # generators: KERNAL and BASIC effects, the API docs
├── sandbox/          # SES compartments for decoders somebody else wrote
├── ui/               # browser; renders rows as CodeMirror decorations
├── store/            # SQLite persistence, the update log, the ops history
└── server/           # HTTP, WebSocket sync, and server/mcp/ for agents
```

**Analysis runs client-side, and also on the server.** The core library is free
of Node APIs, so the same disassembly runs in the browser and on the server. The
browser holds its own `Y.Doc` and analyses locally, which is why a rename shows
instantly and only the sync crosses the wire. The server analyses too — an agent
has no local analysis — cached per document version and computed only when a tool
asks.

**Every surface shares one render walk.** Wrapping, the arrow gutter, field rows
and bitmap art are in the row model rather than in the view, so the browser turns
the interaction spans into clickable decorations while `export_listing` prints
the same rows as text.

## License

MIT
