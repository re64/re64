# Decisions

Why re64 is shaped the way it is. Seven files, split by subject, holding the
argument and the history that used to live in `CLAUDE.md`.

| | |
|---|---|
| [`document.md`](document.md) | the CRDT, storage, sessions, undo, chat, collaboration |
| [`claims.md`](claims.md) | the model — one noun, and every case that shaped it |
| [`agents.md`](agents.md) | the MCP surface, and what each experiment moved |
| [`analysis.md`](analysis.md) | the disassembler, the lifter, the abstract domain |
| [`machine.md`](machine.md) | running code, ROMs, decoders, targets |
| [`ui.md`](ui.md) | the browser |
| [`platform.md`](platform.md) | what is C64-specific, what transfers, and what a second machine would cost |
| [`redesign-claims.md`](redesign-claims.md) | the design document the claims model was built from — a plan that was executed, kept because every number in it is something the code measured |

## How to read these

**Every entry carries the bug that produced it.** That is the point of keeping
them apart from the reference: a decision with its bug is hard to argue *with*
and easy to argue *about*, which is the opposite of prose that only states the
conclusion.

**They are history, and they go stale on purpose.** An entry is accurate as of
when it was written. For what is true now:

| | |
|---|---|
| `docs/purpose.md` | what this is for |
| `docs/developer-guide.md` | the model and the API, for a developer |
| `docs/model.md` | the model as reference |
| `docs/algebra.md` | the operation rules |
| `docs/api.md` | the tools, generated from the live schema |
| `docs/invariants.md` | what must not break, and what pins it |
| `docs/experiments.md` | the runs, and which line of code each moved |

## How to add one

**Append-only.** Superseding a decision does not edit it — it adds an entry that
names the old one and says what changed. The value of a corrected decision is
the correction, and rewriting in place destroys exactly what this archive is
for. `docs/algebra.md` is a worked example: it keeps a table of what each
operation *was* beside what it is.

An entry earns its place the same way an invariant does: something cost real
work. Say what it was, or leave it out.

## What is stale right now

The **write vocabulary was made uniform on 2026-09-07** (`docs/algebra.md`), so
entries written before then name tools and operations that have been renamed or
split — `set_region`, `set_label`, `set_claim`, `set_decoder`, `set_target`,
`set_primary_name`, `label.bind`, `constant.bind`, `primary.set`, and the
`*.delete` spellings. The reasoning in those entries stands; only the spellings
moved, and `docs/algebra.md` has the table.

The **CLI was removed on 2026-09-07**, so `re64 migrate`, `re64 export`,
`re64 disasm` and `re64 undo` no longer exist. Agents use MCP and people use the
web UI; `docs/purpose.md`, written before the removal, already listed neither.
