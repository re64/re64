# Where the gold standard comes from

Extracted once, committed, and read by `../build.mjs`. Kept here rather than
reached for in `experiments/` because those directories are gitignored working
space — the run 7 database this came out of is not in the repository, and the
next `setup.sh` in that directory would overwrite it.

| | |
|---|---|
| `run07.re64` | experiment 7's document, in the pre-claims format: 400 labels, 114 regions, 210 comments, 18 constants |
| `run07-authors.json` | the id of every object it made, against the reader who made it |

**The authors are the point.** Run 7's document carries no provenance at all —
the loader synthesises `author: "project"` for a file of that vintage — but its
*operations log* has one row per write with the reader on it, and all 770 ids
resolve. So the import sends each write with that reader's own user header and
`add_claim` mints the supporting record naming them: reader-1, reader-2 and
reader-3, in the proportions their log records.

Nothing is attributed to a curator, and nothing is invented. That matters for
what happens next: when a later run adds its own account of one of these claims,
the claim carries both, and the difference between two accounts is the thing
`method` exists to make visible.
