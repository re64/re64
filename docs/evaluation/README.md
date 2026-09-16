# Architecture and design evaluations

Reusable review instructions live in [prompts/](prompts/). Evaluation reports
record the inputs, findings, and conclusions of particular runs. Existing
conversation reports retain their original prompts as historical context;
maintained prompts are separate files.

## Reusable prompts

- [Editorial review](prompts/architecture-editorial-review.md): terminology,
  sentence meaning, architectural contribution, examples, and document structure.
- [Compositional test](prompts/architecture-compositional-test.md): concept
  dependencies, boundaries, and distinct capabilities.
- [Scenario test](prompts/architecture-scenario-test.md): difficult investigation
  cases and missing semantic rules.

The compositional and scenario prompts were extracted from the existing
conversation reports, with input paths adjusted for use from the repository
root. Those reports have not been rewritten.

Project decisions belong in the architecture and design documents. A prompt may
call attention to a constraint, but must not become its only authoritative record.

## Editorial review comparison

The [2026-09-16 comparison](architecture-editorial-review-2026-09-16/comparison.md)
records independent runs against the committed architecture and the local
editorial revision, using the same prompt and purpose document. The run directory
contains frozen inputs, the prompt used, reports, and proposed patches.
