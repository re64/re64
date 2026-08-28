# re64

A collaborative C64 disassembler.

## Status

In active development. Currently supports:
- Loading PRG files and D64 disk images
- Memory layering system (multiple files can overlay each other)
- Work-queue 6502 disassembler with control flow analysis
- Project files (.re64 JSON) for configuration
- Labels with resolution in instruction operands
- Regions to define memory semantics (code, data, text, jumptable)
- Combined output showing both instructions and hex dumps for data
- Cross-reference arrow gutter, in the CLI and the web UI alike
- Web UI with a memory map sidebar, inline label editing, and local analysis

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
    {
      "type": "symbols",
      "name": "game-symbols",
      "labels": [
        { "address": "$02", "name": "playerX" }
      ]
    },
    {
      "type": "prg",
      "path": "game.prg",
      "regions": [
        { "start": "$2000", "end": "$3000", "kind": "data", "name": "spriteData" }
      ],
      "labels": [
        { "address": "$0810", "name": "MainLoop", "type": "function" }
      ]
    }
  ],
  "entryPoints": ["$0810"]
}
```

Labels and regions belong to the layer that owns them, so reordering the layer
stack moves annotations with the bytes they describe. Use a `symbols` layer for
addresses with no loaded bytes — zero page variables and the like. Standard C64
hardware registers and KERNAL entry points (`$D020 EXTCOL`, `$FFD2 CHROUT`, …)
are built in, so projects only declare the names they want to override.

```bash
# Disassemble using project file
npx re64 disasm -p game.re64

# Disassemble specific range
npx re64 disasm -p game.re64 -r '$0800:$0900'

# Without the cross-reference arrow gutter
npx re64 disasm -p game.re64 --no-arrows
```

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

```
┌─────────────────────────────────────────────────────────────┐
│                      Memory Map                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Layers (actual bytes)                                   ││
│  │  - FileLayer: PRG/raw files                             ││
│  │  - BytesLayer: inline hex patterns                      ││
│  │  - Layers stack and shadow (top wins)                   ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       Regions                                │
│  Define what memory ranges mean (code/data/text/jumptable)  │
│  - Auto-generated from layers (PRG→code, raw→data)          │
│  - User-defined regions override auto-generated             │
│  - Guide disassembler behavior                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        Labels                                │
│  Mark individual addresses with names                       │
│  - Layer-generated (PRG entry points)                       │
│  - Region-generated (region start addresses)                │
│  - User-defined (any address)                               │
│  - Resolved in instruction operands (JSR ROM_CHROUT)        │
└─────────────────────────────────────────────────────────────┘
```

### Project Structure

```
src/
├── core/             # pure; runs under Node and in the browser
│   ├── memory/       # MemoryMap, layers, labels, regions
│   ├── arch/
│   │   └── mos6502/  # opcodes, decoder, work-queue disassembler
│   ├── c64/          # D64 parser, built-in hardware/KERNAL symbols
│   ├── project/      # schema, loader, line-preserving serializer
│   ├── analysis/     # program analysis: xrefs (blocks, call graph next)
│   └── view/         # view model: rows, tokens, arrow lanes, gutter
├── cli/              # Node I/O; renders rows as text
├── ui/               # browser; renders rows as CodeMirror decorations
└── server/           # serves the project file and layer bytes
```

**Analysis runs client-side.** The core library is free of Node APIs so the same
disassembly runs in the CLI and in the browser; the web UI fetches the project
and its bytes, then builds the memory map and analyses locally. The server only
stores files.

**The CLI and the web UI share one render walk.** Both consume the same rows —
the CLI prints them and ignores the interaction spans, while the UI turns those
spans into clickable decorations. The cross-reference arrow gutter is drawn in
both.

## License

MIT
