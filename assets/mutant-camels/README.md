# Revenge of the Mutant Camels — the silver image

`camels.re64` is everything three runs of agents established about this program,
imported faithfully and **reviewed by nobody**. That is what makes it silver
rather than gold: it is a baseline, not an answer.

| | |
|---|---|
| claims | 630, each with one supporting record naming who vouched |
| record types | 6 — `ZoneRecord` with 33 fields, and five smaller |
| comments | 363 |
| constants | 18, with 21 sites bound |
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
- **42 zone names are claimed as `text` inside the `data` span of the zone
  table**, which is 42 of hygiene's 44 findings and exactly the case
  `claim.interpretationsDiffer` was written for. `ZoneRecord` is now declared,
  so the fix exists and has not been applied.
- **Run 9's scenarios did not survive.** Its document is gone and its transcript
  records a create followed by 33 edits by id, against ids nothing can resolve.
  Run 10's fourteen came across; run 9's twenty-nine did not.
- **Known errors from the runs are uncorrected**, including run 10's sprite
  sheet starting at `$0801` rather than on a 64-byte boundary.

## What happens next

Two or three agents enrich *and correct* it, and a person reviews. That run is
the first that can be measured as a **delta** rather than as a fresh start,
because for the first time there is something to be a delta from — and it is the
first where agents meet a body of work they are invited to contradict, with
`refutes` to say so and `primaryLabels` to say which reading should render.

`sources/` holds what was imported and where the authorship came from.
