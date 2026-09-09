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

---

| | |
|---|---|
| `run09-writes.json` | experiment 9's surviving writes, replayed from its transcript — its document is gone |
| `run10.re64` | experiment 10's document |
| `run10-authors.json` | its objects against the two readers and the editor who made them |
| `run11-review.json` | what experiment 11's review pass **added**, and nothing it moved |

**Run 11 is the odd one and is extracted differently.** The other three are
documents, imported whole. Run 11 started from the silver image rather than from
an empty project, so most of its writes are revisions of what is already here —
including the one that matters, the $0801 displacement across all 79 of run 10's
layer-framed claims. That repair is *not* in this file: `build.mjs` fixes it at
the source, in the import of run 10, and the two documents then agree address for
address across 530 named claims. Importing it twice would credit the corrected
addresses to a reader who only found the error.

So this file is the diff of experiment 11's document against the *corrected*
image: 25 record fields, one constant with its binding, one naming, one rename,
two refutations and one retirement. Two of its comments are listed under
`skippedComments` with the reason rather than dropped silently — both are review
notes about the displacement, and both would describe a document this build does
not produce. The full account is `experiments/11-review/run1/findings.md`.
