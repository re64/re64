# Machine and analysis design

These working notes hold mechanisms beneath the [architecture](02-architecture.md).
The machine-state concept is the chosen direction. Its storage format and construction
API are not yet specified. The relevant work is D1, D2, D3, D5, D9, D10, D11,
and D13 in the [register](03-design-register.md).

## Machine state composition and memory

A machine state's asset placements form an ID-keyed collection. Each placement is an
identifiable occurrence with its own destination and optional explicit priority.
The same asset can be placed more than once or used with different priorities
in different machine states. Priority belongs to the placement, not the source asset.

Non-overlapping placements need no relative order. Where placements overlap in
the same backing storage, a higher priority takes precedence. If the
configuration does not establish a unique highest-priority placement, for example
because competing priorities are unspecified or tied, the affected memory is
ambiguous. Analysis requiring a resolved choice reports the competing placements
and stops until the participant resolves it through configuration. Unaffected
analysis and direct asset inspection can continue.

The document still merges normally. Insufficient information for an analysis is
not a synchronization conflict or a reason to reject the placements. Entity IDs,
map iteration order, timestamps, and display order must not silently select
which material supplies the machine's bytes. Resolving byte precedence also
does not establish which claims apply to the resulting material.

This composition rule describes the selected initial contents, not a history
of loading operations. Actual loading and its side effects belong to execution.
Asset type determines how material is interpreted for placement; an explicit
destination must not accidentally turn a PRG header into payload. Source
container, extracted content, and placement remain distinguishable.

The mapping model must represent the backing memory and devices separately from
the address space visible to a particular access. On the C64, the PLA
(programmable logic array) helps select which component responds. Its fixed
behavior belongs in C64 support; the state controlling selection belongs in
the machine state. CPU and VIC accesses, reads and writes, and cartridge state can
require different mappings.

A copy-on-write overlay is the proposed execution mechanism. Writes belong to
the backing storage selected by mapping and take precedence over that storage's
initial contents. A write to RAM underneath ROM does not itself make the RAM
visible. Source assets remain unchanged.

Temporary machine state construction could use inline placements, a base machine state plus
changes, or temporary handles. The representation remains open. A query that
becomes evidence must retain its actual input context, rather than only a name
whose meaning can subsequently change. Asset-only reads and batch comparisons
must not depend on fabricating a machine state.

The machine design must specify state sufficient for checkpoint restoration,
including connected devices. An attached cartridge has mutable banks and
registers; the current scenario design keeps it attached throughout a run.
Inserted media and drive state belong to the captured state, while disk changes
during a run are input events.

## Execution controls and retained results

A scenario describes triggers and actions rather than requiring one global
linear sequence of steps. Triggers can depend on time or cycle counts,
breakpoints, watchpoints, predicates over machine state, observations, or earlier
actions. Conditions and dependencies can enforce a sequence where needed.
Actions inspect or change registers and memory, provide input, signal interrupts,
capture results, substitute routine behavior, or define and enable further
triggers. A small action body may itself be sequential.

The execution design must specify trigger eligibility, one-shot versus repeated
firing, simultaneous triggers, and the control-transfer and stopping behavior of
actions. Collection order must not supply those semantics accidentally. It must
also distinguish the shared scenario definition from triggers created or enabled
within an individual run; runtime activity does not by itself edit that definition.

Editing boundaries are a separate choice: identifiable trigger/action definitions
can live in maps, while a small action body can be replaced as one atomic value.
Handler snippets remain a candidate implementation. Exact structures and the
boundary of independent edits are still to be designed; neither a shared array
nor a new general workflow language is required by this direction.

Routine substitution must be explicit, including its effect on return behavior
and machine state. A forced predicate or controlled random sequence is a useful
experiment independently of platform completeness. Where faithful platform
behavior is implementable, substitutions remain a deliberate alternative for
the investigator, not its implicit replacement.

Checkpoints, access traces, and captures have different retention purposes.
Access traces can be retained separately from final state. All execution paths
that produce retained material need a consistent producing-context contract.
Cached execution must agree with execution from the same inputs without the
cache, including reported checks and interventions.

> **Mutant Camels — repeatable inputs.** A scenario waits at the title screen,
> presses and releases fire on joystick port 2, waits through the announcement,
> then holds right and fire while capturing frames. Its setup also identifies
> substitute ROM contents. [Scenario][playing], [demonstration][relations]

## Analysis and format tools

The current implementation direction shares an intermediate representation of
instruction behavior between concrete execution and abstract interpretation.
This supports consistent treatment of known bits, registers, flags, memory,
stack behavior, and control flow. Function bodies are derived from entry
locations and discovered blocks, with calls and continuations distinguished.

The runtime-observation interface must preserve which values and targets were
observed under which conditions. It must not silently convert a trace into an
unconditional static assumption. Conversely, an incomplete static result must
not hide an observed target merely because it failed to discover that target.

Custom formats need integration with inspection, search, typed fields, and
rendering. Sandboxed pure decoders with declared inputs are a candidate
mechanism. Declared additional inputs can include palettes or tables elsewhere
in an asset or machine state. Whether their outputs can carry references or propose
claims is part of the knowledge and API design; read-only exploration must not
silently become a project edit.

Acceptance cases include hidden picture RAM, relocated PRG payloads, multistage
unpacking, a deliberately substituted routine, searching high-bit text, and a
picture whose palette is supplied separately. The issues record their expected
behavior; this document does not yet define the complete machine format or tool
schema.

[playing]: https://github.com/re64/re64/blob/7cba76315230f8516eda0233026ffdc19e550814/assets/mutant-camels/sources/run10.re64#L460-L482
[relations]: https://github.com/re64/re64/blob/7cba76315230f8516eda0233026ffdc19e550814/experiments/10-relations/run1/article.html
