# Design register

The [architecture](02-architecture.md) states the main concepts and required
behavior. This register tracks the choices and implementation work needed to
make them concrete. The [GitHub register](https://github.com/re64/re64/issues/71)
is the live checklist; the table below preserves the D1–D14 mapping from the
Bard's Tale investigation and comparative audit.

The experiment supplied examples of overlays, banked memory, asset analysis,
formats, relationships, interventions, and evidence retention. It did not test
collaborative editing or article authoring. Absence of a mechanism from that
investigation is not evidence that the mechanism has no value elsewhere.

## Detailed design notes

- [Machine and analysis design](04-machine-design.md): image composition,
  memory mapping, execution, and analysis mechanisms.
- [Knowledge design](05-knowledge-design.md): applicability, reuse, platform
  packaging, relationships, and changes to shared definitions.
- [Collaboration and interface design](06-collaboration-and-interfaces.md):
  replicas, persistence, shared operations, views, and output examples.

These notes distinguish established directions from proposals and open choices.
They are not complete specifications. Moving a proposal here does not approve it
or require a change to an existing implementation.

## Decision and implementation work

| Item | Required capability or decision | Issues |
|---|---|---|
| D1 | Banked, partly known machine state; Image direction retained | [#60](https://github.com/re64/re64/issues/60) |
| D2 | Temporary configurations with retainable analytical context | [#61](https://github.com/re64/re64/issues/61) |
| D3 | Asset payload versus placement; correct PRG and disk extraction | [#58](https://github.com/re64/re64/issues/58), [#59](https://github.com/re64/re64/issues/59) |
| D4 | Knowledge applicable across subjects and broader contexts | [#51](https://github.com/re64/re64/issues/51), [#50](https://github.com/re64/re64/issues/50) |
| D5 | Recorded interventions, execution conditions, and captures | [#62](https://github.com/re64/re64/issues/62) |
| D6 | Shared indices and followable relationships between material | [#52](https://github.com/re64/re64/issues/52), [#54](https://github.com/re64/re64/issues/54) |
| D7 | Findings, concrete evidence anchors, and affected conclusions | [#63](https://github.com/re64/re64/issues/63), [#33](https://github.com/re64/re64/issues/33) |
| D8 | Evidence-backed residue/duplicate claims without removing loaded bytes | [#64](https://github.com/re64/re64/issues/64) |
| D9 | Custom encodings and formats across search, inspection, and rendering | [#65](https://github.com/re64/re64/issues/65) |
| D10 | Asset operations and queries across alternative configurations | [#50](https://github.com/re64/re64/issues/50), [#61](https://github.com/re64/re64/issues/61) |
| D11 | Container allocation, deleted material, and sector-chain inspection | [#49](https://github.com/re64/re64/issues/49), [#59](https://github.com/re64/re64/issues/59) |
| D12 | Discoverable open questions attached to relevant material | [#56](https://github.com/re64/re64/issues/56) |
| D13 | Runtime observations usable by analysis with their conditions intact | [#66](https://github.com/re64/re64/issues/66) |
| D14 | Verified defect fixes and agreement between code, tests, and contracts | [#67](https://github.com/re64/re64/issues/67) |

Additional work identified while examining these decisions:

- [#57](https://github.com/re64/re64/issues/57): configuration, knowledge, and
  derived analysis have distinct responsibilities.
- [#68](https://github.com/re64/re64/issues/68): retain analytical queries and
  custom-tool results as evidence, including externally produced results.
- [#69](https://github.com/re64/re64/issues/69): expose the impact of shared
  definition edits and support collective updates and verification.
- [#70](https://github.com/re64/re64/issues/70): translate requirements into
  explicit model, API, and synchronization contracts with meaningful checks.

The existing coordinate inventory [#31](https://github.com/re64/re64/issues/31),
receiver validation [#32](https://github.com/re64/re64/issues/32), correction
rationale [#53](https://github.com/re64/re64/issues/53), and custom-tool proposal
[#55](https://github.com/re64/re64/issues/55) remain relevant to that work.

## Order of work

First clarify configuration versus assertions, minimum query context, and
knowledge applicability. Verify the import defects independently; those fixes
do not need to wait for a new ontology.

Next work through relationships, retained evidence, and shared-definition edits
using concrete cases. Choose mechanisms only after their required behavior and
costs can be compared. Machine and API work can proceed where its contracts are
clear without waiting for unrelated decisions.

A decision should identify its rationale, the responsible component, and a
concrete check. A speculative mechanism is not a requirement, and a documented
requirement is not an implemented capability.

## Evaluation records

The [compositional review](evaluation/02-architecture-test-compositional-definitional.md)
and [scenario review](evaluation/02-architecture-test-scenario-based.md) preserve
their prompts, the document versions examined, and the resulting assessments.
They record evaluations of those versions, rather than additional specifications.
