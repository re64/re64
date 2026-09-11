# Decisions

Why re64 is shaped the way it is. Files split by subject, holding the
argument and the history that used to live in `CLAUDE.md`.

| | |
|---|---|
| [`document.md`](document.md) | the CRDT, storage, sessions, undo, chat, collaboration |
| [`claims.md`](claims.md) | the model — one noun, and every case that shaped it |
| [`agents.md`](agents.md) | the MCP surface, and what each experiment moved |
| [`analysis.md`](analysis.md) | the disassembler, the lifter, the abstract domain |
| [`machine.md`](machine.md) | running code, ROMs, decoders, targets |
| [`ui.md`](ui.md) | the browser |
| [`types.md`](types.md) | record layouts — arrays, counts, index origin, bits, and what stays parked |
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
| [01 · Manifest](../01-purpose.md) | purpose and both outputs |
| [02 · Architecture](../02-architecture.md) | vocabulary, component boundaries and design status |
| [03 · Contracts](../03-contracts.md) | sync rules and other obligations |
| [04 · Developer guide](../04-developer-guide.md) | practical workflows |
| [05 · Model reference](../05-model.md) | data shapes and tensions |
| [06 · Operation algebra](../06-algebra.md) | edit semantics |
| [07 · MCP API](../07-api.md) | generated tool reference |
| [08 · Experiments](../08-experiments.md) | observations from runs |

## How to add one

**Append-only.** Superseding a decision does not edit it — it adds an entry that
names the old one and says what changed. The value of a corrected decision is
the correction, and rewriting in place destroys exactly what this archive is
for. `docs/06-algebra.md` is a worked example: it keeps a table of what each
operation *was* beside what it is.

An entry earns its place the same way an invariant does: something cost real
work. Say what it was, or leave it out.

## What is stale right now

The **write vocabulary was made uniform on 2026-09-07** (`docs/06-algebra.md`), so
entries written before then name tools and operations that have been renamed or
split — `set_region`, `set_label`, `set_claim`, `set_decoder`, `set_target`,
`set_primary_name`, `label.bind`, `constant.bind`, `primary.set`, and the
`*.delete` spellings. The reasoning in those entries stands; only the spellings
moved, and `docs/06-algebra.md` has the table.

The **CLI was removed on 2026-09-07**, so `re64 migrate`, `re64 export`,
`re64 disasm` and `re64 undo` no longer exist. Agents use MCP and people use the
web UI; `docs/01-purpose.md`, written before the removal, already listed neither.

## Documentation structure — 2026-09-11

The top-level documents are numbered in reading order: manifest, architecture,
contracts, developer guide, model, algebra, generated API and experiments. The
manifest makes structured knowledge and edited software-archaeology articles
the two outputs of re64. Article representation and publication mechanics remain
open architecture decisions. The numbered references supersede earlier pointers
that treated the developer guide as the first specification to read.

This archive retains its subject filenames and historical arguments. Links were
updated for the new paths; those navigation edits do not revise earlier decisions.

## Reference boundaries — 2026-09-11

The first numbering pass still left two introductions to the model: the guide
listed roots, schemas and laws, while the reference mixed those with workflows
and repair narratives. That made the reader reconcile repeated statements about
frames, session visibility and target selection before using the system.

The developer guide now owns worked tasks. The model reference owns current
data shapes, representation mappings and readers. Architecture owns vocabulary,
replica ownership and the documentation ownership table. Contracts retain their
stable identifiers and short bug origins; the algebra owns edit semantics.
The older long-form [guide](https://github.com/re64/re64/blob/8754cbe/docs/04-developer-guide.md)
and [model reference](https://github.com/re64/re64/blob/8754cbe/docs/05-model.md)
remain available at that revision as historical accounts, not current specifications.
Related reasoning lives in [document](document.md), [claims](claims.md),
[types](types.md) and [machine](machine.md) decisions; the repair round and probes
remain in the [review record](../../experiments/codex-review/REVIEW.md).

The boundary proposal separates domain concepts, replica ownership and storage
representation, and gives each documented fact one primary home. It does not
establish a second sync rulebook. Local duplicate names remain legal under A2; only ambiguous
selector resolution is refused. Retained blobs and operation history have
separate authority, and a local transaction does not establish distributed
atomicity. `Target` and `projection` remain the current terms, with their
meanings clarified rather than renamed. Human concepts need not become CRDT
entities. Mechanical enforcement and broader mutation-path audits remain work
to scope separately; this pass changes documentation, not the implementation.
