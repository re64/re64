# Editorial review comparison — 2026-09-16

See [comparison.md](comparison.md) for findings and interpretation.

## Inputs and execution

Two independent agents reviewed separate architecture snapshots using the same
[editorial prompt](inputs/editorial-prompt.md) and [purpose document](inputs/purpose.md).
Each started without the parent conversation and was instructed not to read the
other snapshot, local diff, prior evaluations, run metadata, or other agent's
report. The neutral version labels did not disclose chronological order to the
reviewers. This was instruction-based isolation in a shared workspace.

- [Version A](inputs/version-a.md): `docs/02-architecture.md` at commit
  `d537cc51526595e643b10315f3745f195dc0888e`, before the local cleanup.
- [Version B](inputs/version-b.md): the working document frozen at the beginning
  of this evaluation, after the local cleanup.
- [Input metadata](inputs.json): baseline commit and SHA-256 hashes of all inputs.

The purpose document and prompt were identical for both runs. Proposed patches
are review artifacts; neither was applied to the working architecture.

## Outputs

- [Version A review](version-a-review.md) and [proposed patch](version-a-proposed.patch).
- [Version B review](version-b-review.md) and [proposed patch](version-b-proposed.patch).
- [Manual cleanup reference](manual-cleanup-reference.md), recorded before reading
  either review, describes the changes the comparison is intended to assess.

## Limits

This is a retrospective comparison: the editorial prompt was developed from the
cleanup conversation. Its explicit retirement constraint supplies information
that a reader of the earlier architecture alone did not have. Each snapshot was
reviewed once, so differences between reports may reflect reviewer variability
as well as the document changes. Findings need to be checked against the text;
their raw count is not a quality score.

For another run, copy the maintained prompt and relevant documents into a new
run directory, record their provenance, and assign each snapshot to an independent
reviewer with the same instructions. Keep the proposed patch separate from the
source document until an edit is authorized.
