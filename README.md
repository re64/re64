# re64

A collaborative C64 disassembler.

## Status

Early development. Currently a minimal CLI that outputs a version number.

## Development

```bash
npm install
npm run build
npm test
```

## Usage

```bash
npx re64 -v
```

## Project Structure

```
src/
├── core/    # Shared code (CLI + future web)
└── cli/     # Command-line interface
```

## License

MIT
