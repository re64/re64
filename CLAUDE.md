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
one. Its two outputs are structured knowledge about C64 programs and edited
software-archaeology articles with supporting evidence.
[The manifest](docs/01-purpose.md) is the statement of intent; read it first.

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
| [01 · Manifest](docs/01-purpose.md) | goals and both outputs |
| [02 · Architecture and vocabulary](docs/02-architecture.md) | concepts, components and design status |
| [03 · Contracts](docs/03-contracts.md) | sync rules and other obligations, with verification points |
| [04 · Developer guide](docs/04-developer-guide.md) | investigation, editorial and implementation workflows |
| [05 · Model reference](docs/05-model.md) | current data shapes, representation mappings and readers |
| [06 · Operation algebra](docs/06-algebra.md) | edit semantics |
| [07 · MCP API](docs/07-api.md) | generated reference; edit its generator, then regenerate |
| [08 · Experiments](docs/08-experiments.md) | observations from investigations and editorial work |
| [Decision archive](docs/decisions/README.md) | historical reasoning, by subject |

Read 01–03 in order before changing a design contract. Use the later references
for the subsystem being changed. A planned capability or historical decision
is not a statement that the implementation already supports it.

Follow the documentation ownership table in 02: examples belong in 04, current
shapes in 05, obligations in 03 and edit semantics in 06. Link across those
boundaries instead of writing a second specification of the same fact.

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
| `npm run gen:api` | regenerate `docs/07-api.md` from the live schema |
| `npm run gen:kernal` / `gen:basic` | regenerate the ROM effect tables |

Before saying anything is done: `npm test`, `npm run typecheck`,
`npm run build:ui`. The golden test pins the rendered listing byte for byte — if
it moves, say so and say why.

---

## The rules that matter most

Stated flat here; the reasoning is in `docs/03-contracts.md`, which names the bug
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
`kernal-effects`, `basic-effects` and `docs/07-api.md` all have one, because a
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
`docs/08-experiments.md` says what each asked and what it moved. Two rules make them
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

---

## Working on GitHub

**Issues and pull requests go through `../re64-vault/re64-claude-gh`.** It is
`gh` with the identity swapped: it mints a fresh installation token for the
**re64-claude** App on every call, uses it, and keeps none. Everything it does
shows as `re64-claude[bot]`.

```
../re64-vault/re64-claude-gh issue list
../re64-vault/re64-claude-gh pr create --fill
```

`re64-codex-gh` is the same thing for the **re64-codex** App, which is the one
that reviews. Both are thin wrappers over `re64-gh-as`; each finds its own key by
the app's name, so two apps can live in the vault without either guessing which
key is theirs. A private key never leaves that directory.

Plain `gh` still works and is **you**. It is for what the App is not permitted to
do — the App's permissions are deliberately narrow and are widened by request and
review rather than kept wide in advance. Prefer the wrapper: which identity is
acting should be visible in the command rather than in an environment variable.

**Commits stay yours.** The App neither authors nor pushes them; `git push` goes
over SSH, and a commit credits its assistant in a `Co-Authored-By` trailer. Code
is authored by a person, issue and review activity is the bot. That is an honest
split rather than a cosmetic one.

## Tickets, branches, and review

**This is an experiment, and none of it is a hard rule.** It exists to give a
model review somewhere to land — not to put a person in the path of every change.
Work that does not want it can still go straight to `main`, as most of this
repository did.

Every finding is an issue, and the issue number is the unit of work.

- **A branch per issue**, named for it: `r14-projection-ordering`. Short-lived.
- **Rebase onto `main`; never merge into.** If `main` moves while the branch is
  open, rebase again. History here is linear and stays that way.
- **One commit where the change is one thought** — which is the existing habit,
  and the commit message is a large part of the artifact. Where a change is
  genuinely several thoughts, keep them as several commits rather than one
  muddled one.
- **Land with rebase-and-merge**, never squash. Squashing destroys the individual
  messages, and in this repository those carry the reasoning that makes a change
  reviewable a month later.
- **`Closes #n` in the pull request body**, so landing closes the issue and the
  link survives.
- **The pull request exists so something that is not the author reads the diff.**
  Usually that is another model. Merge when the review is clean; the owner is not
  a gate and should not have to be. Leave it open when the change turns on a
  judgement rather than a defect — those are worth a person, and they are rare.

**What this is not.** Phabricator's unit is the revision and stacks are
first-class; GitHub's unit is the branch and stacked pull requests are painful —
the base-branch dance, and review churn every time the parent rebases. So work
that must land together goes on **one branch as several commits**, not a stack.

### What the review is for

Not style, and not a second opinion on the design — that argument belongs in the
issue, before the branch exists. It is for **the class of mistake this codebase
actually makes**, which is a wide mechanical edit over a surface the compiler
cannot check:

- A tool schema renamed while its handler still reads the old key. `tool()`
  types its handler as `never`, so this compiles.
- A sweep that hits the cases it was not meant to. One `sed` removed `target`
  from thirty-one tools that need it; the schema test caught it, and nothing else
  would have.
- A value carried through five layers that no surface exposes — the F1 shape,
  now at eleven instances.
- An assertion that passes the defect. `concurrency.test.ts` checked that two
  replicas *agreed* and called it a concurrency test; agreement was true of the
  bug.

A reviewer that did not write the change is much better at all four than the
author re-reading their own diff, which is the whole argument for this.
