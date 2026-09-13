# Machine and analysis design

These working notes hold mechanisms beneath the [architecture](02-architecture.md).
The Image concept is the chosen direction. Its storage format and construction
API are not yet specified. The relevant work is D1, D2, D3, D5, D9, D10, D11,
and D13 in the [register](03-design-register.md).

## Image composition and memory

The current composition proposal uses an ordered list of asset placements.
Loading into the same backing storage lets later placements overwrite earlier
bytes. Asset type determines how material is interpreted for loading; an
explicit destination must not accidentally turn a PRG header into payload.
Source container, extracted content, and placement remain distinguishable.

The mapping model must represent the backing memory and devices separately from
the address space visible to a particular access. On the C64, the PLA
(programmable logic array) helps select which component responds. Its fixed
behavior belongs in C64 support; the state controlling selection belongs in
the image. CPU and VIC accesses, reads and writes, and cartridge state can
require different mappings.

A copy-on-write overlay is the proposed execution mechanism. Writes belong to
the backing storage selected by mapping and take precedence over that storage's
initial contents. A write to RAM underneath ROM does not itself make the RAM
visible. Source assets remain unchanged.

Temporary image construction could use inline placements, a base image plus
changes, or temporary handles. The representation remains open. A query that
becomes evidence must retain its actual input context, rather than only a name
whose meaning can subsequently change. Asset-only reads and batch comparisons
must not depend on fabricating an image.

The machine design must specify state sufficient for checkpoint restoration,
including connected devices. An attached cartridge has mutable banks and
registers; the current scenario design keeps it attached throughout a run.
Inserted media and drive state belong to the captured state, while disk changes
during a run are input events.

## Execution controls and retained results

The working execution design uses scenarios with triggers and handler snippets.
Triggers include time or cycle counts, breakpoints, watchpoints, and predicates
over machine state. Handlers inspect or change registers and memory, provide
input, signal interrupts, capture results, or substitute routine behavior.
Their exact control-transfer and stopping semantics need specification.

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
in an asset or image. Whether their outputs can carry references or propose
claims is part of the knowledge and API design; read-only exploration must not
silently become a project edit.

Acceptance cases include hidden picture RAM, relocated PRG payloads, multistage
unpacking, a deliberately substituted routine, searching high-bit text, and a
picture whose palette is supplied separately. The issues record their expected
behavior; this document does not yet define the complete machine format or tool
schema.

[playing]: https://github.com/re64/re64/blob/7cba76315230f8516eda0233026ffdc19e550814/assets/mutant-camels/sources/run10.re64#L460-L482
[relations]: https://github.com/re64/re64/blob/7cba76315230f8516eda0233026ffdc19e550814/experiments/10-relations/run1/article.html
