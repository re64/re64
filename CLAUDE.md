# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/claude-code) when working with code in this repository.

## Project Overview

re64 is a C64 disassembler. The long-term goal is a collaborative web-based tool with CRDT support for real-time collaboration. Currently it's a local CLI tool in early development.

## Architecture

- `src/core/` - Platform-agnostic code shared between CLI and future web UI
- `src/cli/` - Command-line interface using Commander
- Future: `src/server/` and `src/ui/` directories

Keep core/ free of Node.js-specific APIs where possible to maintain web compatibility.

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
