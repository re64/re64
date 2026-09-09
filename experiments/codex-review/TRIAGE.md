# The Codex review, re-run and triaged — 2026-09-09

`REVIEW.md` is another model's review of the document model, with fifteen
findings and a probe for each. This file is what happened when the probes were
re-run against **this** tree, which has moved since, and what I think should be
done about each.

The house rule for a report from an agent applies here as much as to an
experiment: **take the report and the log together, and where they disagree the
log wins.** So nothing below is accepted on the strength of the prose. Every
finding was re-run.

## The result

**Fifteen of fifteen reproduce.** Not one is a misreading. Two changed shape
because of work landed today, and both are noted in the probe with a
`RE-RUN NOTE`.

```
node experiments/codex-review/reproduce.mjs   # 14 model/storage probes
node experiments/codex-review/transport.mjs   # 3 over the real HTTP/MCP transport
```

| | finding | re-run |
|---|---|---|
| R1 | overlapping MCP requests take another caller's identity | reproduces — a claim asked for by `alice` is recorded as `bob`, in bob's session |
| R2 | `claim.set` rewrites every key, so a concurrent rename is lost | reproduces |
| R3 | fields are stored by offset; a move duplicates the id | reproduces — **two fields with id `fld_a`**, and `field.remove` clears one |
| R4 | rebinding adds a competitor; unbinding leaves one live | reproduces |
| R5 | a target-framed claim is visible in another target | reproduces |
| R6 | renaming the default target silently changes the map | **changed** — see below |
| R7 | the scenario cache passes a probe that should fail | reproduces — `inA: true, cachedB: true, freshB: false` |
| R8 | the document's file hash does not decide the bytes served | reproduces |
| R9 | a failed transaction leaves the changed document live | reproduces — live says `Uncommitted`, a restart says `Original` |
| R10 | socket history pairs operations with the wrong inverses | reproduces |
| R11 | `changes_since` misses HTTP writes and undo | reproduces — a 200 that adds zero rows |
| R12 | redo is stuck after two undos | reproduces |
| R13 | evidence `by: null` clears on one adapter and not the other | reproduces |
| R14 | equal CRDT state projects in different orders | reproduces |
| R15 | `$8000+1` is accepted and written at `$8000` | reproduces |

**R6 is half fixed and half stands.** `defaultTarget` was removed today, so
there is no default view to rename out from under a reader and
`projectForTarget` refuses rather than falling through to every layer — the
probe cannot even run in its original form. What remains is the half the fix did
not touch: **a target is still referenced by name**, in claim frames and in the
`target` argument. Rename a target and a reader that named it gets *"No target
called A"*, and every target-framed claim is orphaned in silence. Duplicate
target names are still admitted.

## Where the review is right about something bigger

> The declared algebra and physical storage disagree.

This is the sharpest sentence in the document and it is correct. Claims expose
partial updates and rewrite whole records; fields expose ids and are stored by
offset; bindings are described in `docs/algebra.md` as a position-keyed shape
and are stored under randomly minted use ids. **Yjs converges on all of these.**
Convergence was never the property in question, and this project has been
treating it as though it were.

R3 lands directly on yesterday's work and the hit is fair. `field.add`,
`field.set` and `field.remove` were added so that a field is addressed by its
id "like every other entity", and `docs/model.md` was updated to say a move
"rewrites the offset key and keeps the id, so the description survives". Under
one writer that is true. Under two it is not: the storage is still a map keyed
by offset, and giving the object an `id` field did not make the *identity*
storage-level. The verbs were built on top of a shape that cannot honour them.

## Where I would push back, or add something the review does not say

- **R14's fix changes every version hash.** Version strings are
  `JSON.stringify(projectFromDoc(...))`, and they are also what `expectVersion`
  compares. Canonicalising map order is right and it means in-flight
  `expectVersion` values stop matching. Cheap here — nothing holds one across a
  restart — but it should be said before, not discovered.
- **R3's migration is cheaper than the review assumes.** It calls for a
  persisted-schema migration; `.re64db` files are gitignored working databases
  and `.re64` files are re-exported from the document, so the cost is the
  loader, not anybody's data.
- **R7 is the one that undermines a claim the project makes about itself.**
  The others lose or corrupt work. This one makes a *check* report `passed` when
  the thing it checks is false, and "point at a scenario and the evidence
  re-verifies" is the strongest thing the evidence model offers. It should be
  fixed before another experiment is told to lean on scenarios.
- **R5 is the cheapest P1 by a distance.** The loader already resolves layer
  frames against the selected view and simply does not ask the same question of
  target frames. One condition, one test.
- **The stale-docs note was right and is now fixed.** `docs/developer-guide.md`
  still described `by` on a claim and `supersedes` as an evidence kind, both
  removed; `docs/model.md` said "`layer.set` does not exist" while the operation
  is declared, applied and inverted — the real gap is that **no tool emits one**,
  which is F1 again and was hidden by stating it the wrong way round.

## What I would do, and in what order

Not the review's order. Its sequence is sound but it front-loads R1, which is
serious and narrow; this one front-loads the things that make the *document*
mean what the API says it means, because everything else is built on that.

1. **R5**, then **R2**. Both are small, both are about a write meaning what it
   says, and R2 is the shape the whole review is about. Do them first because
   they are cheap and because they make the next ones easier to reason about.
2. **R1**. Localised, and it corrupts authorship — which is the thing the
   provenance work of the last two days exists to get right.
3. **R7**, before any experiment is briefed to use scenarios as evidence.
4. **R3** and **R4** together: both are "the storage does not implement the
   identity contract", and fixing one without the other leaves the thesis half
   answered. This is the largest item.
5. **R9**, then **R8**: the durable commit boundary, then content-addressed
   reads. Both are storage-truth questions and R9 is the one that can lose work.
6. **R10**, **R11**, **R12**: the history feed — inverse pairing, append-only
   events, redo order. One subject, three findings.
7. **R13**, **R14**, **R15**: clear semantics, canonical order, strict parsing.

Each wants its own decision entry, because each is a change to what a stored
shape means rather than a repair to code that already agreed with the document.
