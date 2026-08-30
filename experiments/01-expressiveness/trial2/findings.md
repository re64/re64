# Trial 2 — findings

Same brief, same budget, same pass-through as trial 1; the API underneath had
changed by ten of trial 1's twelve findings. Not a controlled comparison — too
much moved at once to attribute anything to a single fix — but a fair read of
what an agent hits *now*.

## Against trial 1

| | trial 1 | trial 2 |
|---|---|---|
| addresses named by hand | 41 | 85 |
| instructions decoded | 1475 | 1478 |
| opened the program | only by copying `mark_function $83C1` from the answer | `set_region kind:"code"` on `$8011`, one call |
| calls wasted on one bug | — | 37 of 86 |

The tools it reached for and did not find are an entirely different and more
advanced set. Nothing from trial 1's list recurred.

## The one that matters

**A single accepted write made the project unwritable through every interface.**
Confirmed, reproduced from scratch, fixed in `1a461ee`.

`set_region` over `$0400` on a project with a symbols layer attached the region
to that layer, because ownership resolution falls back to a symbols layer for an
address nothing supplies. Right for a label — that is what symbols layers are
for — and wrong for a region, which says how to interpret bytes that are not
there. The serializer then wrote a document the loader refuses.

**I made it reachable.** Before symbols layers were created on demand, `$0400`
had no owner and the write was refused for a different reason. Adding the
convenience turned a refusal into corruption.

Two fixes, because either alone is insufficient: `regionSetOp` requires a layer
that supplies bytes, and `parseProject` drops a region on a symbols layer instead
of throwing. The throw is what made the damage permanent — a project that cannot
load cannot be repaired.

## Two claims that did not reproduce

Kept, as in trial 1, because this is the argument for reading the log beside the
report.

**"The refusals are lies — every refused write actually landed."** They don't.
The document version is unchanged after a refused write and the label is absent.
`applyOp` re-parses while inverses are computed, so the throw happens before
anything reaches the document. The agent inferred this from the one write that
genuinely did succeed, then adopted a working practice — issue, ignore the error,
read back — on a false premise.

**"`describe_project` didn't show the poisoned region."** It does.

Both were wrong about *mechanism* while being right that something was badly
broken. That is the same shape as trial 1's jumptable misdiagnosis, and it is
what the transcript is for.

## Status

Everything below is done except two, both deferred deliberately: bringing bytes
into a project via `add_layer`, and decoding a custom character set. The `pointer`
region kind was not added — a two-byte `jumptable` already renders `.WORD` and
queues its target, so it is a naming preference rather than a gap.

Two bugs were found while fixing the rest, neither visible from this run:
`primaryLabels` had never reached the listing at all, because `analyzeProgram`
builds its index from labels alone; and `set_label` silently ignored a parameter
that had only been added to `add_label`, which the strict schemas caught.

## Actionable, ranked

### Expressiveness gaps, largest first

1. **Symbol-plus-offset operands.** `LDA SCREEN_RAM + $000F,X` where re64 renders
   `LDA dat_040F,X`. Hundreds of sites in this one game; every screen and colour
   access loses the fact that it indexes one named array. The largest remaining
   gap by a wide margin, and unlike the others it degrades output that already
   exists rather than omitting something.
2. **A second name for an address, chosen per site.** The reference calls `$08`
   `randomValue` globally and `gridXPos` inside `DrawGrid` — a real finding about
   the binary, that the current listing actively misrepresents. The model already
   holds several labels per address with a `primaryLabels` index; **only the MCP
   surface is missing**, which makes this cheap.
3. **A `pointer` / `word` region kind.** `$8000` holds a little-endian pointer to
   the entry point, reached by `JMP ($8000)`. There is no kind for it, so
   `find_references` on the target returns empty — the one thing in the binary
   pointing at the entry point is invisible. Would also let the walk queue the
   target.
4. **Bringing bytes into a project.** `add_layer` makes symbols layers only, so
   the BASIC stub at `$0800` is unreachable and a whole section of the reference
   cannot be expressed at all.
5. **Custom charset decoding.** Known limitation, but with a sharper edge than
   recorded: choosing `kind:"text"` makes the listing *strictly worse* than
   leaving it as data, which no description warns about.

### Correctness and honesty

6. **Inline comments on data rows are silently dropped.** Written, stored,
   rendered nowhere, and no `list_comments` to confirm they exist. A comment
   nobody will ever see is worse than a refused one.
7. **`find_references`' caveat is incomplete.** It names zero-page and indirect
   targets; the case actually hit was a pointer in a data word, which it does not
   mention.
8. **`set_label type:"function"` adds an entry point** and only `mark_function`
   says so. Right behaviour, documented on the wrong tool.
9. **`set_region`'s description implies it validates the span.** It validated
   extent and not layer, which is exactly the difference that broke the run.

### Ergonomics

10. **`set_comments` and `set_constants` batching.** `set_labels` exists and its
    own description argues for this; the reference has more comments than labels.
11. **`export_listing` snaps `start` forward** past the row asked for.
12. **`find_undecoded` could flag an all-`$EA` span** as padding rather than
    leaving it to be recognised.

### Not a finding, but worth recording

The CLI could not undo an MCP-authored op — `re64 undo` defaults to author `cli`
and the ops were authored by the caller's user id. `--any` reaches them. Working
as designed, discoverable only by reading the source.
