# The re64 manifest

re64 helps people and AI agents investigate Commodore 64 programs together,
preserve what they learn, and tell stories about the software and the people
who made it.

A surviving program is both an executable system and a historical artifact.
Its instructions, graphics, sound, data and unused fragments can reveal how it
works, how it was built, and what changed along the way. Understanding it takes
close reading, experiments, competing explanations and editorial judgment.

## Two outputs

**Structured knowledge about C64 programs.** An investigation accumulates names,
interpretations, relationships, observations and evidence. That knowledge should
remain inspectable and reusable: another reader can continue the work, challenge
a conclusion, try a different interpretation or repeat an experiment. Gaps and
disagreements are part of the record.

**Edited articles about software archaeology.** An investigation also produces
stories for readers who need an explanation, with selected evidence they can
inspect. Articles bring together prose, disassembly excerpts, diagrams, images,
sound and demonstrations. Selection, argument, captions and presentation are
part of the work, alongside discovering facts.

These outputs inform each other. Structured knowledge supplies material for an
article; an editor asking for a convincing demonstration can expose a gap and
send the investigation in a new direction. An article does not need to exhaust
the program, and the knowledge collected need not all appear in an article.

The [Mutant Camels article](../experiments/09-editorial/run1/article.html) is an
example of the second output. Its [editorial notes](../experiments/09-editorial/run1/editorial-notes.md)
record how requests for evidence led to new discoveries and corrections.

## People and agents working together

re64 supports a person investigating alone, an agent doing bounded work, and
multiple participants collaborating on the same project. Participants should
be able to inspect one another's contributions, distinguish an interpretation
from its supporting evidence, and continue an investigation without having to
reconstruct it from a conversation.

Agents need useful tools and explicit concepts. People need ways to explore,
question, edit and communicate the results. Both contribute to the same body of
knowledge. Neither an agent's fluency nor a person's confidence substitutes for
evidence.

## Evidence and uncertainty

An account should say what was observed, what was inferred, and what remains
unknown. A machine run establishes what happened under its stated conditions;
a static analysis establishes only what its method can support. Historical
interpretations may require sources beyond the binary itself.

Readers should be able to trace a significant assertion to the material and
reasoning behind it. A screenshot, a reconstruction and an illustration each
have a place, provided their captions make their origin and limits clear.
Reproducible demonstrations are especially valuable, and their inputs and
conditions belong with them.

Disagreement is useful information. Two people agreeing can share the same
blind spot. A correction should improve the account while preserving enough of
the earlier reasoning to explain what changed.

## Scope and priorities

The immediate subject is Commodore 64 software, including its machine behavior,
data formats, development traces and cultural context. Analysis, emulation,
visualization and collaboration serve the two outputs above. Their value is
measured by the investigations and articles they make possible.

re64 should support partial understanding and honest publication. Complete
disassembly, perfect emulation and automated authorship are not prerequisites
for useful work. A tool must make its limits visible so an investigator or
editor can decide what can responsibly be concluded.

Implementation choices belong in the [architecture and vocabulary](02-architecture.md).
The [contracts](03-contracts.md) state the obligations that follow from that
architecture. This manifest establishes purpose; it does not claim that every
part of the intended workflow is already implemented.
