# Revenge of the Mutant Camels — the silver image

`camels.re64` is everything four runs of agents established about this program,
imported faithfully and **reviewed once**. That is what still makes it silver
rather than gold: one reviewer is not review, and no person has been over it.

| | |
|---|---|
| claims | 631, each with one supporting record naming who vouched — 1 retired |
| evidence | 634: 631 supports, 2 refutes, 1 retires |
| hygiene | 185 findings and 12 disagreements — 2 of them now *declared* |
| instructions decoded | 3,388 |
| record types | 6 — `ZoneRecord` with 56 fields, and five smaller |
| comments | 367 |
| constants | 19, with 22 sites bound |
| targets | `loader`, `runtime`, `machine`, `standalone`, `patched` |

Built by `build.mjs`, which does every write over MCP. Run it against an empty
project and it reproduces this file; the script is as much the artefact as the
output, because the question it answers is *how a project of this depth is made*.

## What is in it, and whose it is

| run | contributed | vouched by |
|---|---|---|
| 7 | 400 labels, 114 regions, 210 comments, 18 constants | `exp7-reader-1`, `-2`, `-3` |
| 9 | 36 claims and 2 record layouts, replayed from its transcript | `exp9-one`, `-two`, `-ed` |
| 10 | 80 claims, 4 record layouts, 93 comments | `exp10-one`, `-two`, `-ed` |
| 11 | 25 record fields, a constant, a naming, a rename, 2 refutations, 1 retirement | `exp11-rev` |

**Run 11 is the review pass, and it is a different kind of source.** The other
three read the bytes; it read them. So its judgements are marked as judgements —
`method: "read"` on every one, nothing in that pass was watched running — and its
two contested readings are a `refutes` and a `retires` rather than a quiet
correction. Its own repair of the $0801 displacement is **not** imported from it:
that is fixed at the source in run 10's import, and the two documents then agree
address for address across 530 named claims.

**Authors are namespaced by run and are the original agents', not a curator's.**
All three runs called their readers `one`, `two` and `ed` or `reader-1..3`, and
two different agents sharing a name would read as one agent corroborating
itself — the correlated-account error `method` exists to catch. Run 7's document
carries no provenance at all, but its operations log does, and every one of its
770 ids resolves to the reader who made it.

## What is deliberately still wrong

A baseline that hid its problems would measure nothing. These are left standing:

- **73 addresses carry more than one name**, 72 of them the same finding worded
  differently — `TickObjectLifetime` and `AgeCreature` at `$9A39`. Two names at
  one address is a state this model tolerates; choosing between them is a
  judgement nobody has made.
- **The zone table is claimed twice** — 8,400 bytes of `data` by run 7 and an
  array of `ZoneRecord` by run 9 — and forty-two zone names sit inside both as
  `text`. That is most of hygiene's 136 `claim.interpretationsDiffer` findings
  and exactly the case it was written for.
- **Eleven claims cover 52,576 bytes of a 47K program**, because they overlap and
  because several are true without explaining anything: 8,209 bytes as `data`.
  Size is a fair proxy for vagueness. The twelfth, 18,431 bytes as one `bitmap`,
  is the one claim run 11 retired.
- **Run 9's scenarios did not survive.** Its document is gone and its transcript
  records a create followed by 33 edits by id, against ids nothing can resolve.
  Run 10's fourteen came across; run 9's twenty-nine did not.
- **Known errors from the runs are uncorrected**, including run 10's sprite
  sheet starting at `$0801` rather than on a 64-byte boundary.

## What experiment 11 found in it

The first reviewer over this image found that **all 79 of run 10's layer-framed
claims were one load address low**. A layer-framed claim stores an offset; the
import passed those offsets to `add_claim`, which takes an address. Fixed at
source, and the numbers above are after that fix — the image now decodes 3,388
instructions where it decoded 2,451.

Two things it could not do are recorded in `experiments/11-review/run1/`, and
both are now built. It wrote, under what it wanted and did not have: *"A way to
retire a claim without erasing it. Not remove_claim, not refutes."* — which is
`retire_claim`, and the one claim it had to delete is retired here instead, with
its reason and run 10's account of it both still in the document. And record
fields merged per offset across authors with no way to address one, so it could
not replace another author's per-index columns with an array and had to revert 28
fields; `add_field` / `edit_field` / `remove_field` are that.

## What happens next

Two or three agents enrich *and correct* it, and a person reviews. That run is
the first that can be measured as a **delta** rather than as a fresh start,
because for the first time there is something to be a delta from — and it is the
first where agents meet a body of work they are invited to contradict, with
`refutes` to say so and `primaryLabels` to say which reading should render.

`sources/` holds what was imported and where the authorship came from.
