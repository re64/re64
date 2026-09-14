# Design register

The [architecture](02-architecture.md) states the main concepts and required
behavior. This register tracks the choices and implementation work needed to
make them concrete. The [GitHub register](https://github.com/re64/re64/issues/71)
tracks current dispositions; the table below preserves the D1–D14 mapping from the
Bard's Tale investigation and comparative audit.

The experiment supplied examples of overlays, banked memory, asset analysis,
formats, relationships, interventions, and evidence retention. It did not test
collaborative editing or article authoring. Absence of a mechanism from that
investigation is not evidence that the mechanism has no value elsewhere.

## Detailed design notes

- [Machine and analysis design](04-machine-design.md): machine state composition,
  memory mapping, execution, and analysis mechanisms.
- [Knowledge design](05-knowledge-design.md): applicability, reuse, platform
  packaging, relationships, and changes to shared definitions.
- [Collaboration and interface design](06-collaboration-and-interfaces.md):
  replicas, persistence, shared operations, views, and output examples.
- [Synchronization design](07-synchronization.md): shared entity and field
  rules using maps, deletion/restoration, derived ordering, and action/undo
  contracts.

These notes distinguish established directions from proposals and open choices.
They are not complete specifications. Moving a proposal here does not approve it
or require a change to an existing implementation.

## Decision and implementation work

| Item | Required capability or decision | Issues |
|---|---|---|
| D1 | Banked, partly known machine state; direction retained | [#60](https://github.com/re64/re64/issues/60) |
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

## How to use this register

This is an implementation and risk register, not a prerequisite sequence. The
architecture is the settled conceptual baseline. D-numbers preserve the audit's
references; they do not prescribe development order. Choose a useful next piece
of work and resolve the decisions that piece actually needs.

The post-architecture review distinguishes these dispositions:

- **Resolved by architecture:** the semantic requirement is settled; its
  representation and implementation can still be pending. This applies to
  configuration and derived analysis (#57), the correction rationale (#53),
  asset-associated knowledge (#50), reusable knowledge (#51), machine state
  (#60), and temporary configurations with explicit resulting state (#61).
- **Blocks a specific next step:** a consequential choice remains for a named
  operation. Coordinate and selection rules (#31) precede the corresponding
  annotation edits; evidence-link meaning after edits (#33) precedes that
  evidence workflow; shared-definition update semantics (#69) precede applying
  such updates across existing uses. These are local dependencies, not barriers
  to unrelated work.
- **Tooling/backlog:** implement capabilities as needed, including container
  inspection (#49), relationships (#52/#54), custom tools (#55), open questions
  (#56), execution and observations (#62/#66), findings (#63), residue analysis
  (#64), formats (#65), and analytical evidence retention (#68). Their required
  behavior is largely established; their interfaces still need design.
- **Defect:** verify and repair reported failures when their subsystem is
  ported. Receiver robustness (#32), import errors (#58/#59), and audit
  reconciliation (#67) belong here. This classification is not a fresh
  reproduction against current code.
- **Deferred:** candidate mechanisms are not requirements. Program inclusion,
  domains, and namespaces (#51), or a particular snippet extension (#54/#55),
  need evaluation only when the selected work calls for them. Deferring a
  mechanism does not withdraw the capability it might provide.

An issue can contain both a settled requirement and an open mechanism or
backlog item. The issue comments separate these parts. “Resolved by architecture”
does not mean implemented, and an open issue does not by itself block progress.

Model, API, and synchronization contracts (#70) are developed with the operations
they govern. A blocking decision should name the operation, why the choice
matters, and what can proceed independently. Record its rationale and a concrete
check in the relevant detailed design; do not reopen the architecture merely
because an implementation choice remains.

## Evaluation records

The [compositional review](evaluation/02-architecture-test-compositional-definitional.md)
and [scenario review](evaluation/02-architecture-test-scenario-based.md) preserve
their prompts, the document versions examined, and the resulting assessments.
They record evaluations of those versions, rather than additional specifications.
