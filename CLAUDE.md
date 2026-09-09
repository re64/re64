# CLAUDE.md

Guidance for Claude Code working in this repository.

**This file is the brief. It holds no mechanism.** Every shape here has a reason
and a bug behind it, and those live in `docs/` — kept apart on purpose, because
prose describing how something works goes stale the moment the code moves, and a
brief that has gone stale is worse than no brief. If you find yourself about to
write *how* something works here, it belongs in `docs/`.

---

## What this is

re64 is an **agentic-first, collaborative C64 reverse engineering framework**.
Reverse engineering a game is a long grind of recognising a routine, naming it,
and moving on — work an agent can do alongside a person rather than instead of
one. `docs/purpose.md` is the statement of intent; read it first.

Three consumers over one document, and the document is the point:

| | |
|---|---|
| **MCP** | agents, doing the work |
| **Web UI** | people, doing the same work |
| **HTTP API** | the low-level surface both sit on |

They share a document, not a file format, so an agent naming a subroutine and a
person reading the same code see each other's work as it happens.

---

## Read these before changing anything

| | |
|---|---|
| `docs/purpose.md` | what this is for, and what it refuses to be |
| `docs/developer-guide.md` | **start here** — the model and the API, end to end |
| `docs/invariants.md` | what must not break, the bug behind each, and what pins it |
| `docs/algebra.md` | the operation rules: two shapes, thirty operations, no third |
| `docs/model.md` | the model as reference, with its open tensions |
| `docs/api.md` | the tools — **generated**, do not hand-edit |
| `docs/experiments.md` | eleven runs, and which line of code each moved |
| `docs/decisions/` | the argument and the history, by subject |

`docs/decisions/` is where the reasoning went. It is **append-only history**: an
entry keeps its text and gains a note when superseded, because the value of a
corrected decision is the correction.

---

## Architecture

```
src/core/      analysis, model, operations — platform-agnostic, browser-safe
  claims/      the model: one noun for everything anybody says about an address
  memory/      layers, the map, comments, constants, types
  ops/         the closed operation vocabulary and its inverses
  crdt/        Yjs — the only place the library is named
  arch/        6502 opcodes, decoder, disassembler
  il/          P-Code lifter, interpreter, abstract domain
  analysis/    blocks, effects, values, flags, hygiene
  view/        rows, arrows, bitmaps — DOM-free, so every consumer renders alike
  project/     the .re64 schema, loading, serialisation
src/store/     persistence
src/client/    joining a session; DOM-free, so browser and agent share it
src/server/    HTTP, websocket, and mcp/ for agents
src/ui/        the browser front end
src/sandbox/   SES, for decoders somebody else wrote
src/tools/     generators — kernal effects, basic effects, api docs
assets/        example files and project configurations
```

**Keep `src/core/` free of Node APIs.** The browser analyses locally, which is
why a rename does not round-trip to the server.

---

## Commands

| | |
|---|---|
| `npm test` | run once |
| `npm run test:watch` | watch |
| `npm run typecheck` | **both** tsconfigs |
| `npm run build` / `dev` | compile / watch |
| `npm run build:ui` / `dev:ui` | bundle the browser |
| `npm run serve` | run the server |
| `npm run gen:api` | regenerate `docs/api.md` from the live schema |
| `npm run gen:kernal` / `gen:basic` | regenerate the ROM effect tables |

Before saying anything is done: `npm test`, `npm run typecheck`,
`npm run build:ui`. The golden test pins the rendered listing byte for byte — if
it moves, say so and say why.

---

## The rules that matter most

Stated flat here; the reasoning is in `docs/invariants.md`, which names the bug
each one cost.

**What works offline must also work online, and the reverse.** There is no
second mode. An operation whose correctness depends on having seen what everyone
else did fails the first direction; one that assumes it is alone fails the
second. This has caught more than any amount of reasoning about layers.

**An address, a name, a span or a slot never identifies anything.** Only an id
does. Adding always adds; correcting is by id. This project has been caught four
times by keying a write on something that is not an identity, and every time an
experiment had to find it.

**A confident wrong answer is worse than a gap.** No statistical guessing about
what bytes are, no glyph invented to fill a hole, no proof that is really a
sample. Where something cannot be known, say so at the point of use — a check
that cannot see something must say so, never skip it.

**Nothing resolves at rest.** Which name renders, which reading a row uses, what
nests inside what — derived when asked. `disagreements()` reports contradiction
and never picks a winner.

**Where complexity belongs: not in the write.** Basic operations should have
little reason to fail. A write that refuses has taken a decision it was not
entitled to, unless the reason is a fact about the *request* rather than a
judgement about the *result*. Two writers producing an untidy document is the
expected outcome; hygiene reports it and somebody tidies it.

**The vocabulary being closed is checked by the compiler. Whether anything emits
or reads a member of it is not.** Six instances so far, most recently a field the
model carried through five layers that no surface exposed. When you add to a
root, make the round trip provable.

---

## Testing

Tests live beside their source with a `.test.ts` suffix. Vitest.

**Four suites are load-bearing and worth knowing by name:**

| | |
|---|---|
| `src/core/crdt/roundtrip.test.ts` | every operation through all seven paths, **and** the algebra itself — keyed by `Op["op"]`, so it will not compile until a new operation has a case |
| `src/server/mcp/transport.test.ts` | tool schemas over the real transport — the only layer where a schema defect exists |
| `src/golden.test.ts` | the rendered listing, byte for byte |
| `src/core/claims/offline.test.ts` | the offline/online rule above |

**A generated file that is committed gets a test that regenerates and compares.**
`kernal-effects`, `basic-effects` and `docs/api.md` all have one, because a
committed generated file goes stale in silence.

---

## Writing code here

- **Minimal dependencies.** Two knowing exceptions, both argued in
  `docs/decisions/`: `@modelcontextprotocol/sdk` and `ses`.
- **TSDoc on public interfaces.** Document *why*, never *what* — let the types
  speak. A comment earns its place by carrying a decision or a piece of C64
  knowledge that is not obvious from the code.
- **Keep abstractions simple until complexity is needed.** TypeScript strict
  mode is on.
- **When a decision costs real work, write it down** — in `docs/decisions/`, with
  the bug. That is what makes this codebase possible to rejoin after a month
  away, and it is the single most valuable habit here.

---

## Working with experiments

Most of this design came out of eleven runs with agents on real binaries.
`docs/experiments.md` says what each asked and what it moved. Two rules make them
produce measurements rather than anecdotes:

**Take the reports and the request log together, and where they disagree the log
wins.** An agent is an unreliable narrator of its own difficulty: it invents a
tool name and then describes the invention as a gap, and works silently around
whatever actually hurt. A tool was once built on a sentence in a report and
removed an hour later when the log showed nobody had done what the report
implied.

**Only fix what blocks the next experiment — but a reproduced bug is not a
wish.** The rule protects against chasing every wish. A bug that has been located
is not one, and reading it the other way once cost a whole round.

---

## Connecting an agent

```
claude mcp add --transport http re64 http://127.0.0.1:5164/mcp \
  --header "X-Re64-User: <user id>"
```

The user id is one from `list_projects`; the server does not verify it.
