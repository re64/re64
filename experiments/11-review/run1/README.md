# Run 1 — experiment 11

One reviewer, `rev`, over the Camels silver image. 204 calls in about 29
minutes; 106 reads, 13 additions, 85 revisions.

| | |
|---|---|
| `findings.md` | the reviewer's own account, including three things the tools would not let it record |
| `before.re64` / `after.re64` | the whole document each side of the run |
| `before.json` / `after.json` | the counted state, for the delta |
| `transcript.jsonl` | 204 requests — **the half that decides when a report and a log disagree** |

`../scoring-key.md` is what it had to find, computed before it started and never
shown to it.

## The headline, and why the counts alone would mislead

87% of its writes were revisions, which is the exact signature the brief was
written to guard against. It is not churn. Every one of the 78 `edit_claim`
calls moved a claim by the same `$1002`, because all of run 10's layer-framed
claims had been imported one load address low — a bug in the artefact its own
author had not found, proved three ways before anything was touched.

Read the log, not the ratio. That is the rule this file exists for.
