# Architecture

An investigation moves between reading software, running it, and making sense of
what happened. re64 keeps the material and the growing account together, so each
finding can lead to another experiment or become part of an article.

The [manifest](01-purpose.md) explains the purpose of this work. This overview
introduces the concepts that support it. Detailed models, contracts, and tool
interfaces belong in their own documents. The design focuses on the C64. Other
Commodore machines, such as the C16 and VIC-20, and more distant systems such as
the NES can help test design choices without becoming support commitments.

*Revenge of the Mutant Camels* provides a running example. Findings from its
investigation illustrate how these concepts fit together.

## 1. Projects and their material

A **project** is the home of an investigation. It brings together programs,
articles, supporting material, and a shared conversation between people and
agents.

A **program** organizes the software being investigated and what is known about
it. Its **assets** supply the material: binaries, ROMs, cartridges, disks, and
data extracted along the way. An **image** holds the machine state in which we
study or run that software. It is configured with an ordered list of assets
from the participating programs, using each asset according to its type.

### Including another program

A program can include another program's assets and knowledge as a read-only
dependency. Each **inclusion** selects a revision and contributes its own
material, without recursively importing further dependencies. For analysis,
these contributions form one resolved view of the program, while their origins
remain identifiable.

Updating an inclusion selects a new revision. To change the included material
itself, an investigator can **internalize** it: copy it into the local program
and edit it there. Those copies are then independent of dependency updates.

> **Mutant Camels — two builds.** The investigation includes a 1984 binary and
> a disk containing Jeff Minter's 2021 collision fix. The fix changes existing
> instructions and adds code at `$C000`. We can represent the original as one
> program and a patched version as another that includes it and supplies the
> changes. Each image selects the assets needed for its version, preserving
> their origins. [Build comparison][builds]

The main application for inclusion is the **C64 platform**, a program supplied
by re64 with standard assets, symbols, and knowledge about ROM routines. It uses
the same representations as any investigated program. re64 ships platform
revisions identified by hash and retains older revisions, so a project's
platform updates only when its participants choose to. Analyzer and emulator
versions remain separate from the platform data revision.

Platform knowledge can describe a ROM even when its bytes are unavailable.
Labels and routine effects can still inform an investigation. Executing,
disassembling, or internalizing that ROM requires its contents.

> **Mutant Camels — PRNG from BASIC ROM.** The game's random-byte routine
> increments a counter and reads a byte from `$A000 + counter`, using BASIC ROM
> as a lookup table. An experiment changed those 256 bytes and observed different
> behavior. The ROM's contents and visibility matter even when the game uses it
> as data. The article records that its demonstration used substitute bytes,
> which limits what its gameplay images establish. [ROM experiment][relations]

## 2. Images: the machine at a moment

**Program analysis concerns machine state, which may be partially known.** An
image represents that state, whether constructed from assets or reached through
execution. Each analysis uses the information it needs and makes its assumptions
explicit.

An image can carry everything needed to continue execution: memory, registers,
device state, banking controls, attached hardware such as cartridges, and
inserted media. This includes the state of connected devices. Some state may be
unknown or supplied by defaults. A default provides a concrete value; an unknown
leaves a question for the analysis. Tools explain when missing state prevents
them from continuing.

Memory includes all the underlying banks, including those currently hidden.
When assets load into the same storage, later loads overwrite earlier bytes.
re64 keeps track of where the resulting bytes came from at byte granularity.

The machine's **mapping** rules determine which memory or device each access
reaches. These rules are part of C64 support. The **PLA**, or programmable logic
array, is the C64 chip whose logic helps select which memory or device responds.
The image holds the state controlling that selection. The address, the kind of
access, and the processor or device making it all matter. Reads and writes at
the same address can reach different storage.

Execution changes memory through a **copy-on-write overlay**, leaving source
assets intact. Changes belong to the backing memory they modify. Once mapping
has selected that storage, the changed bytes take precedence over its original
contents. Hidden memory stays hidden until the mapping exposes it.

> **Mutant Camels — getting past the loader.** The disk version is compressed.
> The investigation runs its decruncher before studying the expanded game. This
> is why execution can prepare an analysis starting point: the interesting code
> appears in memory as the loader runs. Capturing an image preserves that memory
> together with the machine state at that point. [Decrunching recipe][recipe]

## 3. Execution and analysis

An **experiment** starts with an image and supplies the conditions for examining
its behavior. A **scenario** is the execution script: it describes inputs,
checks, and actions to take as execution proceeds. A **run** records one
execution under those conditions. A **checkpoint** is an image captured along
the way, usable as a starting point for another run or analysis.

Scenarios can react to **triggers**: a time or cycle count, execution reaching
an instruction address (a breakpoint), or a memory access (a watchpoint).
**Snippets**, small handler scripts, respond to those events. They can inspect
or modify memory and registers, change device state, supply input, signal an
interrupt, and retain results. A **capture** is a retained observation, such as
a memory dump, screenshot, or recording of device activity.

The image records the attached cartridge and its mutable state. The cartridge
stays attached throughout a run, while its banks and registers can change.
Inserted disks and drive state are also part of the image; inserting, swapping,
or ejecting a disk during execution is an input event.

A run can retain an **access trace** showing which instructions read, wrote, or
fetched bytes, and which memory or device they reached. The trace explains
activity; a checkpoint preserves the resulting state. They can be retained
independently. State overrides and scripted interventions belong in the run's
record so its results can be interpreted and repeated.

> **Mutant Camels — getting into the game.** A recorded scenario waits at the
> title screen, presses and releases fire on joystick port 2, lets the opening
> announcement pass, then holds right and fire while capturing frames. This
> turns an interactive session into repeatable input. The recorded setup also
> identifies its ROM substitutions, so those conditions accompany the pictures.
> [Scenario][playing], [Demonstration][relations]

### Following the code

Static **analysis** follows control flow from **entry points** and code selected
for inspection, reasoning about possible execution with partly known state.
It discovers instructions, basic blocks, functions, and references between code
and data.

A **function** is designated at an entry location; analysis discovers its body,
which can occupy several disjoint ranges. Calls and continuations into other
functions are recorded separately. Asset boundaries do not constrain any of
these structures, and overlapping instruction readings remain inspectable.

Selecting a function for inspection does not give it a fresh execution state.
Its incoming state depends on its callers and how control reaches it. Reference
queries help trace those relationships in either direction, including computed
addresses when they can be established.

Concrete execution and abstract interpretation share an intermediate
representation of instruction behavior. **Abstract interpretation** reasons with
partly known values, carrying information through registers, memory, the stack,
and control-flow paths. It can establish facts about flags and preserved values
without requiring every input to be known.

**Effects** summarize what a block or function may read or write, either on its
own or including the functions it reaches. Stack analysis helps establish how
control returns. Concrete execution provides the complementary account of what
actually happened for particular inputs. Both expose their assumptions and gaps,
including unresolved accesses and unsupported instructions.

### Reading the result

A disassembly shows reachable code, referenced data, and material explicitly
selected for display. Conflicting interpretations remain inspectable, and
unexplained regions provide leads for further investigation. Analysis results
are also available directly to tools, independently of the listing.

> **KERNAL ROM — overlapping instructions.** The C64's operating-system ROM
> provides a compact example. In its error handling, the bytes `2C A9 02` read
> as `BIT $02A9`. Enter one byte later and `A9 02` reads as `LDA #$02` instead.
> The same bytes serve as an operand on one path and an instruction on another.
> Both readings belong in the analysis. [Instruction example][overlap]

## 4. Knowledge and evidence

A **claim** records something a participant wants the investigation to consider
true. It has a **subject** and an **assertion** about that subject. The subject
can be a location, function, asset, program, or relationship; an address is not
required. Labels and descriptions of code or data express such interpretations.
A claim may be tentative, supported, disputed, or withdrawn.

**Provenance** means where a claim came from: its contributor, import, or
producing analysis. re64 records that origin automatically where possible.
**Evidence** explains why an assertion should be believed or questioned. A claim
can be recorded before evidence is attached, and support can accumulate as the
investigation develops.

Claims associated with an asset can describe both its contents and what its code
does elsewhere in the machine. Association and coordinates are different things:
an asset-relative location follows placement, while an absolute address stays
fixed. Applicability also depends on the image and the conditions being studied.

When material overlaps, a display can give one label precedence and leave
another inspectable as shadowed. That presentation choice does not decide
whether the underlying assertion is correct. Changes to the subject may make
earlier knowledge inapplicable. Platform knowledge follows the same principle;
inclusion alone does not determine what appears in a disassembly.

### Constants, types, records, and bindings

**Constants** give names and meaning to values.

**Types** describe how to interpret data. A **record type** describes named
fields, their positions, and their types. Fields can include numbers, pointers,
text, bit fields, arrays, and nested records. Unknown portions can remain holes.
A claim applies a type to particular material; a **record** is one instance of
that layout. This lets a table be explored as records and fields while preserving
access to its bytes. Custom decoders can express formats beyond built-in types.

A **binding** associates a use with what it refers to: a location, label,
constant, type, record, or field. Bindings can be inferred from addresses and
the image's context, including the structure of typed data regions, or supplied
explicitly by a participant. Their meaning is specific to the use and its
context; the same numeric value elsewhere can mean something different. Rules
for ambiguity and precedence belong in the detailed knowledge model.

### Coverage and hygiene

A **coverage report** helps locate unexplored material within a program, image,
or region. It distinguishes decoded code, material given an interpretation, and
remaining gaps. Decoding a function does not establish its purpose, and a broad
"data" annotation can cover bytes without explaining them. Coverage needs to
make that distinction visible, including holes inside partially understood types.

A **hygiene report** examines recorded knowledge for problems that need attention:
contradictions under the same conditions, competing names or interpretations,
broken references, and questionable applicability. It explains the detected
issue and points to the relevant material. Participants can also record
disagreements that mechanical checks cannot discover.

Both reports help direct work. They do not certify truth, and unfinished or
conflicting knowledge can remain in the project while it is investigated.

> **Mutant Camels — a table becomes a structure.** An 8,400-byte region was
> described broadly as data, with 42 text annotations for zone names. Analysis
> established 42 records of 200 bytes each, including a 40-character name at
> offset `$A0`. A `ZoneRecord` type makes those fields explicit and leaves the
> unexplained portions visible. The collected investigation still retains
> competing broad annotations: defining a better type does not silently resolve
> them. [Record analysis][zones], [Collected findings][collection]

### Disagreement is constructive

Runs, analysis, captures, and recorded reasoning give participants evidence to
inspect. A useful account preserves what was observed, what was inferred, and
the conditions under which the conclusion holds. Corrections can change the
working interpretation while retaining the earlier reasoning and its origin.
The detailed knowledge model will define applicability, precedence, and how
references follow changes to their subjects.

> **Mutant Camels — GOATS or OATS?** The key table spells GOATS, but stepping
> through the check reveals that the first letter is treated as an already-held
> key. OATS alone activates the cheat too. Reading the table suggested one
> account; tracing the code and typing the keys established a more precise one.
> [Investigation report][cheat], [execution check][keyboard]

## 5. Findings and articles

Significant **findings** are collected in a **finds log**, inspired by the
archaeologist's small finds register. Each finding has a description explaining
why it matters and references to claims, captures, constants, types, discussion,
or other project material. Each reference can carry a note explaining its role.
A finding can start small and gather evidence and interpretations over time.

**Articles** turn selected findings into an account for readers. They may be
internal documentation or software-archaeology essays. Authoring can happen
through external tools and agents, with prose, diagrams, composed assets, and
interactive demonstrations. Retaining finished work alongside the investigation
may be enough initially. An editor and publishing system are possible later
commitments.

> **Mutant Camels — a story inside the bytes.** The investigation found
> fragments of assembler source still present in the game, including names
> matching its main loop. The article used those fragments alongside sprite
> plates, screenshots, and diagrams to explore what the surviving software
> reveals about its construction. [Article][article]

## 6. Collaboration and persistence

People and agents contribute to the same project. They need to see contributions,
refer to shared material, record findings, and continue work as the investigation
changes.

The project **chat** supports both investigation and coordination. Participants
use it to divide work, announce intent, request checks, discuss disagreements,
and agree on next steps. It also accommodates work with no dedicated tool or
representation yet. Messages can reference project material to retain their
context. Agreement in chat constitutes a social convention and does not impose
technical restrictions on other participants' work.

Each session works with a **replica**, its own editable copy of project state.
Participants see their own changes immediately. Updates from other sessions can
be announced before being incorporated; merging them is an explicit action,
requested by the participant or their chosen policy. An update notification
does not by itself change the state being analyzed.

Shared editing uses a **CRDT**, a conflict-free replicated data type. It allows
replicas to accept concurrent edits and converge when they receive the same
updates, without requiring participants to agree on each edit first. This
settles how document updates combine. Contradictory interpretations can still
coexist in the resulting project and be examined through hygiene and discussion.

The server persists shared project state and edit history, together with assets,
captures, and other retained material. Attribution and discussion remain part of
the record. Stored project data supports reconstruction of session replicas;
retained execution results remain available without rerunning the experiment.
A participant's local view and the server's durable record have distinct roles,
which the synchronization and storage contracts must preserve.

> **Mutant Camels — a useful disagreement.** Two readers reported different
> conclusions about a possible zone-skip cheat. Their messages prompted the
> editor to investigate further: a run confirmed that a key value was written,
> but did not establish that the zone skip worked. The discussion preserved both
> the lead and the limit of what had been demonstrated. [Editorial notes][notes]

## 7. Interfaces and resolved views

A **resolved view** combines a particular image with the program knowledge
applicable to it. It interprets asset placement, captured memory changes, and
mapping state alongside local and included knowledge, retaining their origins.
It is derived from the participant's project replica and referenced material.
Reconstructing the view or caching it must give the same interpretation.

Agents use **MCP**, the Model Context Protocol, to inspect and edit projects,
query analysis, run scenarios, and record findings. The server holds the replica
for each agent session. People use a **web UI** whose browser tab holds its session
replica, supporting exploration, editing, execution controls, and discussion.
Both surfaces use the same domain operations and view construction, so the same
image and knowledge produce consistent answers.

The shared core owns the program model, edits, and view construction. Analysis
and execution consume images and produce results. Presentation turns those
results into listings and other views. The server supplies persistence and
session coordination; UI and MCP adapters translate participant actions into
these shared operations. Detailed APIs and synchronization mechanics belong in
their respective specifications.

Disassembly uses familiar assembler syntax to make code readable. It can also
show alternate readings, partial interpretations, and material selected for an
investigation. It is an annotated account of the image, with no promise that the
listing itself assembles into the original binary.

### Mutant Camels — one field, two presentations

The first zone's name occupies 40 bytes at `$67A0`. With the zone table described
as an array of `ZoneRecord`, a resolved view can identify it as
`zoneTable[0].name` and decode it using the game's character set.
[Record analysis][zones]

The output formats below are illustrative. A disassembly can show:

```asm
$67A0  zoneTable[0].name:
       .text "       ASSORTED EASY AVIAN ALIENS!!     "
```

An MCP result can expose the same information as JSON:

```json
{
  "address": "$67A0",
  "path": "zoneTable[0].name",
  "type": "char(40)",
  "text": "       ASSORTED EASY AVIAN ALIENS!!     "
}
```

The address, field association, and decoded value come from the same resolved
view. Each interface presents them in a form useful to its reader.

[builds]: https://github.com/re64/re64/blob/7cba76315230f8516eda0233026ffdc19e550814/assets/mutant-camels/reference/PROVENANCE.md
[relations]: https://github.com/re64/re64/blob/7cba76315230f8516eda0233026ffdc19e550814/experiments/10-relations/run1/article.html
[recipe]: https://github.com/re64/re64/blob/7cba76315230f8516eda0233026ffdc19e550814/assets/mutant-camels/build.mjs#L154-L169
[playing]: https://github.com/re64/re64/blob/7cba76315230f8516eda0233026ffdc19e550814/assets/mutant-camels/sources/run10.re64#L460-L482
[overlap]: https://github.com/re64/re64/blob/7cba76315230f8516eda0233026ffdc19e550814/src/core/arch/mos6502/idioms.test.ts#L42-L79
[zones]: https://github.com/re64/re64/blob/7cba76315230f8516eda0233026ffdc19e550814/experiments/09-editorial/run1/report-reader-one.md#L43-L58
[collection]: https://github.com/re64/re64/blob/7cba76315230f8516eda0233026ffdc19e550814/assets/mutant-camels/README.md
[cheat]: https://github.com/re64/re64/blob/7cba76315230f8516eda0233026ffdc19e550814/experiments/09-editorial/run1/report-reader-two.md#L24-L36
[keyboard]: https://github.com/re64/re64/blob/7cba76315230f8516eda0233026ffdc19e550814/src/core/machine/camels-keyboard.test.ts#L99-L116
[article]: https://github.com/re64/re64/blob/7cba76315230f8516eda0233026ffdc19e550814/experiments/09-editorial/run1/article.html
[notes]: https://github.com/re64/re64/blob/7cba76315230f8516eda0233026ffdc19e550814/experiments/09-editorial/run1/editorial-notes.md
