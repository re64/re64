# re64

A collaborative C64 disassembler.

## Status

Early development. Currently supports loading PRG files and D64 disk images with hex dump output.

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
```

### Loading files

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

# Without -r, dumps the range covering all layers
npx re64 dump -l game.prg
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

## Project Structure

```
src/
├── core/
│   ├── memory/   # MemoryMap, BytesLayer, FileLayer
│   └── c64/      # D64 disk image parser
└── cli/          # Command-line interface
```

## License

MIT
