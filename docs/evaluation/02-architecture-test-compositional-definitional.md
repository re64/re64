# Codex conversation

## User

Read 01-purpose.md and 02-architecture.md. You may use 01-purpose.md to understand re64’s goals and intended use, but treat 02-architecture.md as the architecture under test. Do not read any other documentation, source code, tests, experiment reports, issues, or repository history. If 02-architecture.md depends on information that exists elsewhere, report that dependency rather than looking it up.

Pressure-test 02-architecture.md by checking whether its core concepts form a coherent, compositional model.

Do not redesign the architecture.

Starting from the most primitive concepts, take each major architectural concept in turn and explain it only in terms of concepts that have already been established before it. For each concept, state:

1. What is it?
2. Why does re64 need it?
3. What does it depend on?
4. What new capability does it add that the preceding concepts could not already express?
5. What is it explicitly not responsible for?

Try to build a chain roughly like:

Project → Asset → Machine state → Configuration → Analysis/Execution → Claim/Knowledge → Type/Record/Binding → Evidence → Finding → View

but change the ordering if the architecture itself requires a different dependency order.

A definition fails the test if:

* it requires a concept that has not yet been established;
* it is circular (“X is understood through Y” while Y requires X);
* it merely renames or groups concepts already available without adding distinct semantics;
* its purpose can only be explained by an implementation/storage detail;
* it quietly acquires responsibilities belonging to configuration, epistemic knowledge, or derived analysis;
* two concepts cannot be distinguished without appealing to examples rather than their semantics.

After constructing the chain, run the reverse test: for each concept, remove it mentally and state exactly what becomes impossible or materially awkward to express.

Pay particular attention to whether the architecture can explain:

Machine state + applicable Knowledge → View

without relying on an unnamed intermediate concept for shared/general knowledge.

Do not invent Program, Target, Domain, Layer, or another grouping abstraction to repair a gap. If such a gap exists, describe the missing semantic capability without naming a solution.

Finish with only:

* concepts that have a crisp independent reason to exist;
* concepts whose boundaries overlap;
* circular or hidden dependencies;
* semantic capabilities promised by the architecture but not yet grounded in a concept;
* the smallest wording clarifications needed in 02-architecture.md.

Do not propose implementation, storage, API schemas, or a replacement architecture.

## Assistant

I’ll read only the two named files, build the dependency chain from the architecture’s definitions, and then test what is lost when each concept is removed.

## Activity

    $ /bin/zsh -lc 'cat 01-purpose.md'
    status: Completed · exit 0
      # The purpose of re64

      re64 helps people and AI agents investigate Commodore 64 programs together,
      preserve what they learn, and tell stories about the software and the people
      who made it.

      A surviving program is both an executable system and a historical artifact.
      Its instructions, graphics, sound, data and unused fragments can reveal how it
      works, how it was built, and what changed along the way. Understanding it takes
      close reading, experiments, competing explanations and editorial judgment.

      ## From evidence to understanding

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

      ## People and agents working together

      re64 supports a person investigating alone, a generative AI agent working autonomously, and
      multiple participants collaborating on the same project. Participants should
      be able to inspect one another's contributions, distinguish an interpretation
      from its supporting evidence, and continue an investigation, enriching it over time.

      Agents need useful tools and explicit concepts. People need ways to explore,
      question, edit and communicate the results. Both contribute to the same body of
      knowledge. Neither an agent's fluency nor a person's confidence substitutes for
      evidence.

      ## Embracing uncertainty

      An account should say what was observed, what was inferred, and what remains
      unknown. A machine run establishes what happened under its stated conditions;
      static analysis draws conclusions about possible behavior under stated
      assumptions. Historical interpretations may require sources beyond the program
      itself.

      Readers should be able to trace a significant assertion to the material and
      reasoning behind it. Screenshots, animations, audio, and other retained assets
      should be accompanied by context explaining how they were produced and what
      they demonstrate. Reproducible demonstrations are especially valuable, and are
      supported by the initial machine state and input sequences.

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

## Activity

    $ /bin/zsh -lc 'cat 02-architecture.md'
    status: Completed · exit 0
      # Architecture

      An investigation moves between reading software, running it, and making sense of
      what happened. re64 keeps the material and the growing account together, so a
      finding can lead to another experiment or become part of an article.

      The [manifest](01-purpose.md) explains why. This document introduces the main
      concepts, their relationships, and the behavior they must support. The
      [design register](03-design-register.md) leads to separate documents and issues
      for choosing representations, storage, synchronization, and tool interfaces.
      The immediate subject is the C64; other machines can test a design choice without
      becoming a support commitment.

      We use "The Revenge of the Mutant Camels" by Jeff Minter (1984) as a running
      example throughout this document.

      ## 1. Projects and their material

      A **project** is the home of an investigation. It brings together assets,
      knowledge, articles, and a conversation between people and agents.

      **Assets** supply the material: binaries, ROMs, cartridges, disks, and data
      extracted or produced along the way. Each asset is identifiable within the project
      and can be used in multiple machine states and analyses. Assets can also be investigated
      in their own right.
      Reading a file, comparing ranges, decoding a picture, or inspecting a disk's
      allocation map does not require constructing a running machine. Unnamed or
      deleted material is as legitimate a subject as a directory file.

      An asset's contents and its placement in memory are distinct. A file can suggest
      a load address without determining where a program actually loads it. Locations
      within an asset remain identifiable when it is placed elsewhere. Extraction,
      copying, and transformation preserve enough context to trace the resulting
      material back to its sources.

      > **Mutant Camels — two builds.** The investigation includes a 1984 binary and
      > a disk containing Jeff Minter's 2021 collision fix. The fix changes existing
      > instructions and adds code at `$C000`. Studying both builds requires keeping
      > their material distinguishable while comparing what changed.
      > [Build comparison][builds]

      ## 2. Machine states and configuration

      Analysis of program behavior concerns **machine state**, which may only be
      partially known. A machine state can be constructed from assets or reached
      through execution. Each analysis uses the information it needs and makes its
      assumptions explicit.

      A machine state can carry everything needed to continue execution: memory,
      registers, device state, banking controls, attached hardware, and inserted media,
      including the state of connected devices. Some state may be unknown or supplied by
      defaults. A default provides a concrete value; an unknown leaves a question for
      the analysis. Tools explain when missing state prevents them from continuing.

      Memory includes the underlying storage hidden by the current bank selection.
      The machine's **mapping** determines which memory or device an access reaches.
      The address, access kind, accessing processor or device, and current state all
      matter. Reads and writes at the same address can reach different storage.

      Loading and execution can overwrite bytes. These changes affect the selected
      storage but preserve the source assets. The resulting bytes remain traceable to
      their origins, including later writes. Overlapping material and hidden memory
      must remain distinguishable.

      A **configuration** specifies the state and assumptions chosen for an analysis: which material to place, the interpretations to use, and the conditions of an experiment. These choices need not describe a state the original program ever reached or could reach. A useful configuration can be retained; a temporary query need not create a named machine state merely to examine an alternative.

      > **Mutant Camels — getting past the loader.** The disk version is compressed.
      > Running its decruncher prepares the expanded game for investigation. Capturing
      > the machine state at that point preserves it as an input to further analysis.
      > [Decrunching recipe][recipe]

      ### C64 support and platform knowledge

      A **platform** supplies the machine behavior and associated resources used by an
      analysis or execution. Selecting it is part of configuration. Its hardware and
      ROM knowledge uses the same descriptive facilities as knowledge developed within
      a project.

      Platform knowledge can provide ROM labels and routine descriptions even when the ROM bytes are unavailable. Inspecting or executing the ROM itself requires its contents.

      > **Mutant Camels — PRNG from BASIC ROM.** The game's random-byte routine
      > increments a counter and reads from `$A000 + counter`, using BASIC ROM as a
      > lookup table. An experiment supplied substitute bytes and observed the game.
      > Those contents are part of the experiment's conditions and limit what its
      > gameplay images establish. [ROM experiment][relations]

      ## 3. Analysis and execution

      **Analysis** examines material and behavior to discover structure, relationships,
      and possible explanations. It can inspect an asset, reason about a machine state, or
      compare results across several assets and states.

      Static analysis follows control flow from **entry points** and code selected for
      inspection. A **function** is designated at an entry location; its discovered
      body can occupy several disjoint ranges. Its incoming state depends on how
      execution reaches it. Instructions, basic blocks, and functions can cross asset
      boundaries, and overlapping instruction readings remain inspectable.

      **Abstract interpretation** reasons about possible behavior with partly known
      values, following registers, memory, flags, the stack, and control-flow paths.
      **Effects** summarize what a block or function may read or write, including the
      behavior it reaches. Reference queries and stack analysis help explain how data
      and control move through the program. Unsupported instructions and unresolved
      accesses remain visible as limits of the result.

      An **experiment** supplies the conditions for examining behavior. A **scenario**
      describes inputs, checks, and actions as execution proceeds; a **run** records
      one execution under those conditions. Scenarios can react to time, an instruction
      being reached, an access, or a condition on machine state. Actions can provide
      input, change media, modify state, and retain observations.

      Deliberate interventions include substituting a routine, forcing a predicate,
      or controlling random values. They are useful ways to isolate behavior even
      when faithful platform emulation is available. Their presence and effect belong
      in the run's record, alongside its initial state and inputs.

      A **checkpoint** is a machine state captured during execution, usable for another run
      or analysis. A **capture** retains an observation, such as a memory dump,
      screenshot, or recording of device activity. An **access trace** records which
      instructions read, wrote, or fetched bytes and which storage or device they
      reached. A trace explains activity; a checkpoint preserves state.

      Runtime observations can inform subsequent analysis. They retain the conditions
      under which they were observed: an executed target is evidence of that execution,
      and an unobserved target is not thereby impossible.

      > **KERNAL ROM — overlapping instructions.** In its error handling, the bytes
      > `2C A9 02` read as `BIT $02A9`. Enter one byte later and `A9 02` reads as
      > `LDA #$02`. Both readings belong in the analysis.
      > [Instruction example][overlap]

      ## 4. Knowledge and interpretations

      A **claim** records something a participant wants the investigation to consider
      true. It has a **subject** and an **assertion** about that subject. Subjects can
      include locations, functions, assets, and relationships; an address is not
      required. Claims can be tentative, supported, disputed, or withdrawn.

      Knowledge can describe one subject or apply across several assets, machine states, and
      broader contexts without repeated entry. Association with an asset does not
      confine a claim's subject to that asset's bytes: its code may act elsewhere in
      the machine. Coordinates, association, and conditions of applicability are
      distinct. Reusing knowledge does not independently verify it at each use.

      ### Constants, types, records, and bindings

      **Constants** name values. **Types** define ways to interpret data. A **record type**
      describes fields, their positions, and their types, including numbers,
      pointers, text, bit fields, arrays, and nested records. Unknown portions can
      remain holes A claim can apply a type to particular material; a **record** is an
      instance of that layout. Reusable decoders express custom formats and identify
      any additional inputs their interpretation needs. Constant and type
        > definitions are configuration; claims applying them express knowledge.

      A change to a constant or a type can affect every record described by it. re64 helps participants
      find those records, review the impact, and apply corrections across them together.
      Updating an interpretation does not mean it has been verified. Evidence identifies
      the data and type definition examined, so a later edit does not make an earlier
      result appear to verify the revised interpretation.

      A type definition specifies a reading. Claiming that it describes particular material
      is different from trying it in an exploratory query. Editing a shared definition
      can change many interpretations. Participants need
      to discover affected uses, apply corrections collectively, and check their
      consequences. Adopting a correction and verifying it are different actions.
      Checks state which uses they examined and what they established.

      A **binding** associates a use with what it refers to: a location, label,
      constant, type, record, or field. It can be inferred from addresses, context,
      and typed regions, or supplied by a participant. The same numeric value can have
      different meanings at different uses.

      Bindings can also connect data across separate tables. Several arrays may
      describe different properties of the same object using a shared index,
      while a value in a table may identify a corresponding picture or file.
      These connections let tools follow references across the material.

      > **Mutant Camels — a table becomes a structure.** An 8,400-byte region contains
      > 42 records of 200 bytes, each with a 40-character name at offset `$A0`.
      > A `ZoneRecord` type makes that structure reusable and leaves unexplained
      > portions visible. It also gives references a readable path such as
      > `zoneTable[0].name`. [Record analysis][zones]

      ### Interpreting surviving material

      Claims can describe unused fragments, spillover, duplicates, and possible older
      revisions. Comparisons and investigator-developed tools can provide evidence
      for those readings. Classifying a region can explain its origin without proving
      that it has no effect on execution.

      An interpretation does not remove loaded bytes or prevent behavioral analysis
      from following accesses into them. A listing or search can filter material
      explicitly, with the filtering visible and the material still available.
      Choosing one label for display likewise does not settle competing assertions.

      ## 5. Evidence, correction, and investigative progress

      **Provenance** records who added a claim or other contribution and where
      it came from, such as an asset or analysis result. **Evidence** explains
      why an assertion should be believed or questioned. A claim can be recorded
      before evidence is attached.

      Evidence can refer to source locations, execution captures, recorded reasoning,
      and retained analytical results. Comparisons, searches, table queries,
      consistency scripts, and visualizations all produce useful results. They may
      come from re64 or from tools developed by an investigator.

      Retaining a result preserves what was examined, the producing operation and
      parameters, relevant definitions and assumptions, and the output. Missing
      context or limits on reproduction remain explicit. A later edit does not change
      what an earlier check actually examined. Re-running an analysis produces a new
      result to compare with the retained one.

      Corrections improve the working interpretation while keeping earlier reasoning
      understandable. Known dependent claims, findings, and outputs must be
      discoverable so participants can assess consequences. Some outputs can be
      recomputed; other conclusions need renewed judgment. No automatic check can
      promise to discover every semantic dependency.

      A **coverage report** shows decoded material, interpretations, and remaining
      gaps across the selected assets, machine states, or regions. A broad data annotation
      does not explain every byte, and decoding a function does not establish its
      purpose. Holes in a partially understood type remain visible.

      A **hygiene report** identifies problems such as contradictions under the same
      conditions, competing interpretations, broken references, and questionable
      applicability. Participants can record disagreements that mechanical checks
      cannot discover. Open questions remain discoverable with the material they
      concern, providing leads for further work.

      These reports direct investigation. They do not certify truth or require
      unfinished knowledge to be resolved before it can be shared.

      > **Mutant Camels — GOATS or OATS?** The key table spells GOATS, but tracing
      > the check reveals that the first letter is treated as an already-held key.
      > OATS alone activates the cheat too. Reading the table suggested an account;
      > execution established a more precise one.
      > [Investigation report][cheat], [execution check][keyboard]

      ## 6. Findings and articles

      Significant **findings** are collected in a **finds log**, inspired by the
      archaeologist's small finds register. A finding explains why something matters
      and references claims, material, results, definitions, discussion, or other
      findings. Each reference can carry a note explaining its role. A finding can
      start as a lead and gather evidence and interpretations over time.

      **Articles** turn selected findings into an account for readers. They may be
      internal documentation or software-archaeology essays, combining prose,
      disassembly, images, sound, diagrams, and demonstrations. External tools and
      agents can contribute to authoring. Retaining finished work and its supporting
      material alongside the investigation does not require a built-in editor or
      publishing system.

      > **Mutant Camels — a story inside the bytes.** Fragments of assembler source
      > remain in the game, including names matching its main loop. The article uses
      > them alongside sprite plates, screenshots, and diagrams to explore what the
      > surviving software reveals about its construction. [Article][article]

      ## 7. Collaboration and the shared record

      **People** and **agents** contribute to the same investigation. They need to
      inspect contributions, identify their origins, work concurrently, and continue from
      retained material and results.

      The project **chat** supports investigation and coordination: dividing work,
      announcing intent, requesting checks, discussing disagreements, and handling
      work with no dedicated representation yet. Messages can reference project
      material. Agreement in chat is a social convention and does not impose technical
      restrictions on other participants' work.

      A participant must know which project state they are examining and when other
      contributions become part of it. Announcing an update does not itself change
      the state being analyzed. Participants can incorporate updates explicitly or
      through a chosen policy. Concurrent editing must preserve the agreed semantics
      of individual operations and make unresolved disagreements inspectable.

      The shared record retains project state, changes, attribution, discussion,
      source material, and evidence. Retained results remain available without
      rerunning an experiment. Agreement on the recorded data does not require
      agreement about what that data means.

      ## 8. Views and interfaces

      A **view** presents selected material with the interpretations and context used
      to examine it. For machine analysis, a **resolved view** combines a machine state with
      the knowledge applicable to that analysis. Asset inspection can instead use the
      asset and its relevant definitions and knowledge directly.

      Configuration chooses the analytical setup. Claims express assertions; evidence
      supports or challenges them. **Derived results** follow from applying an
      analysis to its inputs. These roles connect, but one does not silently become
      another:

      ```mermaid
      flowchart LR
          M[Assets and machine states] --> A[Analysis or execution]
          C[Configuration and definitions] --> A
          K[Relevant knowledge] --> A
          A --> R[Results and views]
          R -->|retain and interpret with context| E[Evidence for or against claims]
          E -->|informs investigation| K
      ```

      A result is not evidence for a particular claim until its relevance is
      established. A retained result records an earlier examination; a current view
      reflects its current inputs. Regenerated views must not become competing sources
      for the same project state.

      Agents use **MCP**, the Model Context Protocol, to inspect and edit projects,
      query analysis, run scenarios, and record findings. People use the **web UI** to
      explore, edit, execute, and discuss. Both provide access to the same concepts and
      operations, giving consistent substantive answers for the same inputs and
      assumptions. Results identify their context and limits.

      Disassembly presents reachable code, referenced data, and material selected for
      inspection in familiar assembler notation. It can show alternate readings and
      partial interpretations; it need not assemble back into the original binary.
      The same field association, value, or reference is also available to tools and
      visual views. Formats differ to serve their readers, while the interpretation
      remains consistent.

      ## One field, two presentations

      The first Mutant Camels zone name occupies 40 bytes at `$67A0`. With the zone
      table interpreted as an array of `ZoneRecord`, a view identifies it as
      `zoneTable[0].name` and decodes it using the game's character set.
      [Record analysis][zones]

      The formats below are illustrative, not a proposed tool schema. The surrounding
      query identifies the machine state and interpretation used. A disassembly can show:

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

      The address, field association, and decoded value come from the same view.
      Actual response contracts must retain the necessary context when results are
      saved or referenced independently of the query.

      [builds]: https://github.com/re64/re64/blob/7cba76315230f8516eda0233026ffdc19e550814/assets/mutant-camels/reference/PROVENANCE.md
      [relations]: https://github.com/re64/re64/blob/7cba76315230f8516eda0233026ffdc19e550814/experiments/10-relations/run1/article.html
      [recipe]: https://github.com/re64/re64/blob/7cba76315230f8516eda0233026ffdc19e550814/assets/mutant-camels/build.mjs#L154-L169
      [overlap]: https://github.com/re64/re64/blob/7cba76315230f8516eda0233026ffdc19e550814/src/core/arch/mos6502/idioms.test.ts#L42-L79
      [zones]: https://github.com/re64/re64/blob/7cba76315230f8516eda0233026ffdc19e550814/experiments/09-editorial/run1/report-reader-one.md#L43-L58
      [cheat]: https://github.com/re64/re64/blob/7cba76315230f8516eda0233026ffdc19e550814/experiments/09-editorial/run1/report-reader-two.md#L24-L36
      [keyboard]: https://github.com/re64/re64/blob/7cba76315230f8516eda0233026ffdc19e550814/src/core/machine/camels-keyboard.test.ts#L99-L116
      [article]: https://github.com/re64/re64/blob/7cba76315230f8516eda0233026ffdc19e550814/experiments/09-editorial/run1/article.html

## Assistant

The main gap is applicability: the document separates a claim’s subject, association, and applicability conditions, but does not explain what makes shared knowledge applicable to a particular machine state. I’m also checking whether experiment, record, binding, and view have distinct semantics or inherit responsibilities from configuration, claims, or derived results.

## Assistant

The architecture supports a mostly coherent dependency chain, but does not yet complete it. Its strongest distinction is between **chosen conditions, assertions, derived results, and evidential support**. Its weakest point is how knowledge becomes applicable to a particular machine state.

I read only [01-purpose.md](../01-purpose.md) and [02-architecture.md](../02-architecture.md). The assessment below treats the latter as the architecture under test.

The chain uses ordinary primitives—participants, bytes, values, assertions, and conditions—without treating them as additional architectural abstractions. A concept’s possible producer does not have to precede its definition: a machine state can be defined before execution, even though execution can later produce one.

1. **Project**
   **What:** The scope of one investigation and its contributions. **Why needed / capability added:** Establishes what belongs to the investigation and the scope within which assets are identifiable. **Depends on:** Participants and investigation intent. **Not responsible for:** Determining whether contributions are true or mutually consistent.
   This is coherent if “home” means an investigation scope; a container alone would supply little independent semantics.

2. **Asset**
   **What:** Identifiable material that can be examined independently of its placement in a machine. **Why needed / capability added:** Gives an investigation stable subjects and locations within source material, independent of subsequent loading or execution. **Depends on:** Project and material contents. **Not responsible for:** Determining machine placement, runtime state, or interpretation.
   This boundary is crisp. The preservation of transformation context is a requirement on relationships between assets, not a reason to merge assets with machine states.

3. **Platform and mapping**
   **What:** A platform supplies machine behavior and resources; mapping determines where a machine access goes under particular state and access conditions. **Why needed / capability added:** Supplies the behavioral meaning of state and accesses, which asset contents alone cannot express. **Depends on:** Machine-state vocabulary and, for supplied material, assets. **Not responsible for:** Choosing experimental conditions or establishing the truth of ROM descriptions.
   The behavioral definition can precede machine states. The platform’s associated knowledge must be described later using the ordinary knowledge concepts. Mapping has a distinct role within machine behavior; it need not be another investigative grouping.

4. **Machine state**
   **What:** A representation of a particular, potentially partial machine state, including underlying storage and device state. **Why needed / capability added:** Represents coexistence, placement, hidden storage, and current values beyond the identity of original material. **Depends on:** Machine-state semantics and mapping; assets where material has a source. **Not responsible for:** Choosing assumptions, asserting interpretations, or explaining possible behavior.
   The machine state/configuration boundary works provided supplied defaults become concrete state, while unknown state remains unknown.

5. **Constants, types, record types, and decoders**
   **What:** Definitions of named values and possible readings of material; record types specify field layouts, and decoders express readings requiring custom logic or additional inputs. **Why needed / capability added:** Makes a reading reusable without asserting that it correctly describes any particular material. **Depends on:** Values, material, and other established definitions. **Not responsible for:** Claiming applicability or verifying a reading.
   These definitions can precede configuration: configuration later chooses their use. Record types specialize types rather than establishing an independent foundational concept.

6. **Entry points and functions**
   **What:** An entry point selects a location from which inspection begins; a function is designated at an entry location. **Why needed / capability added:** Provides a subject for investigating behavior beyond an individual location. **Depends on:** Locations and machine instruction semantics. **Not responsible for:** Fixing its discovered body or assuming a single incoming state.
   The document does not fully establish what makes a function designation more than an entry point with an associated analysis result. Its discovered body can be deferred until analysis, but its independent semantic identity remains thin.

7. **Claim**
   **What:** A participant’s assertion about a subject, offered for consideration as true. **Why needed / capability added:** Records epistemic commitment separately from material, selected readings, and machine state. **Depends on:** Participants and identifiable subjects; particular claims may reference earlier definitions. **Not responsible for:** Proving itself, selecting an analytical setup, or automatically controlling execution.
   This is crisp. Evidence is not a prerequisite for recording a claim.

8. **Knowledge and applicability**
   **What:** The document uses knowledge for the account that can describe subjects and apply across assets, machine states, and broader contexts. **Why needed / capability added:** The promised addition is reuse of assertions beyond one local attachment. **Depends on:** Claims, identifiable subjects, and conditions of applicability. **Not responsible for:** Re-verifying assertions at each use or making asset association determine their subjects.
   **This step is incomplete.** “Knowledge” has no separate definition from claims, and applicability is distinguished from coordinates and association without being explained positively. As a collective term, knowledge needs no independent semantics. The applicability capability does.

9. **Record**
   **What:** An instance of a record layout applied to particular material. **Why needed / capability added:** Connects reusable field structure to a particular occurrence, allowing its fields to be referred to. **Depends on:** Material and a record type; an asserted application additionally depends on a claim. **Not responsible for:** Verifying the layout’s applicability or making decoded values timeless facts.
   Its boundary is incomplete: the text does not say whether an exploratory application also yields a record, or whether “record” requires an asserted type application.

10. **Binding**
    **What:** An association between a particular use and its referent. **Why needed / capability added:** Expresses reference meaning at the use, which numeric equality and the existence of the referent do not establish. **Depends on:** Identifiable uses and referents, including locations, definitions, records, and fields. **Not responsible for:** Making inferred references verified or changing machine behavior.
    The relation is semantically distinct. Its status is unclear: a participant-supplied binding might be an assertion or a chosen reading; an inferred binding is initially a derived result.

11. **Configuration**
    **What:** The state, interpretations, assumptions, and conditions selected for an examination. **Why needed / capability added:** Distinguishes what is deliberately used from what is available or claimed to be true. **Depends on:** Material, machine-state descriptions, platform behavior, definitions, and any selected knowledge. **Not responsible for:** Asserting historical reachability, proving selected interpretations, or becoming the result of analysis.
    This is coherent once “interpretations” refers to established definitions and assertions rather than introducing another unnamed concept.

12. **Analysis**
    **What:** An operation examining material or behavior under stated inputs and assumptions. **Why needed / capability added:** Derives consequences that the selected inputs do not themselves enumerate. **Depends on:** Assets or machine states, configuration, and any relevant knowledge. **Not responsible for:** Turning consequences into participant assertions or evidential support automatically.
    Abstract interpretation is a specialized analysis. Discovered function bodies and effects are analytical outputs, distinct from the designations that initiated examination.

13. **Scenario**
    **What:** Inputs, checks, and conditional actions governing execution as it proceeds. **Why needed / capability added:** Expresses temporal and reactive behavior that an initial state cannot express. **Depends on:** Machine-state and event semantics, input values, and action conditions. **Not responsible for:** Recording what actually happened.
    This has a crisp role even if selecting a scenario is part of configuration.

14. **Experiment**
    **What:** Something that supplies conditions for examining behavior. **Why needed / capability added:** No distinct addition is established beyond configuration and a scenario. **Depends on:** The chosen state, assumptions, and execution conditions. **Not responsible for:** Standing in for an actual execution record.
    As written, this fails the independence test: configuration already specifies “the conditions of an experiment,” while experiment supplies those conditions.

15. **Execution and run**
    **What:** Execution advances machine state under machine behavior and chosen interventions; a run records one such occurrence. **Why needed / capability added:** Distinguishes an actual examined execution from possible behavior and reusable conditions. **Depends on:** Sufficiently concrete initial state, platform behavior, configuration, and any scenario. **Not responsible for:** Establishing what happens under other conditions or ruling out unobserved behavior.
    The distinction is crisp.

16. **Checkpoint, capture, and access trace**
    **What:** Respectively, resumable captured state, a retained observation, and a record of accesses and their destinations. **Why needed / capability added:** Preserve different aspects of execution: continuation state, observed output, and activity. **Depends on:** Machine states, runs, and identifiable machine accesses. **Not responsible for:** Establishing relevance to a claim.
    Checkpoint is explicitly a machine state in a particular role. Captures and traces specialize observations; neither requires independent foundational status.

17. **Derived and retained results**
    **What:** Outputs of an examination; retention preserves what was examined, how, under which definitions and assumptions, and with what output. **Why needed / capability added:** Separates consequences from inputs and preserves an earlier examination despite later changes. **Depends on:** Analysis or execution and its actual inputs and conditions. **Not responsible for:** Expressing belief or supporting a particular claim without an established connection.
    These roles are crisp. Effects, inferred bindings, and decoded values belong here when produced analytically.

18. **Provenance**
    **What:** Attribution and origin of contributions or material. **Why needed / capability added:** Answers who contributed something and where it came from, independently of its correctness. **Depends on:** Identifiable contributions, participants, and source relationships. **Not responsible for:** Explaining why an assertion is justified.
    It is relational context, not a competing kind of knowledge.

19. **Evidence**
    **What:** Material, results, or reasoning whose relevance supports or challenges an assertion. **Why needed / capability added:** Connects an assertion to grounds for accepting or questioning it. **Depends on:** Claims and relevant supporting or challenging material, results, or reasoning. **Not responsible for:** Guaranteeing truth or extending an earlier check to revised definitions.
    This is one of the document’s strongest boundaries.

20. **Coverage and hygiene reports**
    **What:** Derived accounts of investigative gaps and detectable problems. **Why needed / capability added:** Direct attention across selected material and interpretations. **Depends on:** Material, definitions, claims, applicability, and analytical results. **Not responsible for:** Certifying truth or requiring agreement.
    They are useful specialized results, rather than independent foundations. Hygiene inherits the unresolved applicability semantics.

21. **Finding and finds log**
    **What:** A finding explains investigative significance and connects relevant contributions; the log collects findings. **Why needed / capability added:** Preserves why something merits attention, including leads that do not yet form a settled assertion. **Depends on:** Earlier material and contributions, with optional references to other findings. **Not responsible for:** Replacing claims or conferring evidential support merely by collecting references.
    Finding has a plausible independent editorial role. The log adds organization, not another semantic primitive.

22. **Article**
    **What:** An authored account presenting selected findings and supporting material to readers. **Why needed / capability added:** Adds narrative argument, selection, and presentation beyond individual findings. **Depends on:** Findings and the contributions they draw upon. **Not responsible for:** Exhausting the investigation or establishing truth through publication.
    Its editorial role is distinct from a generated presentation.

23. **Chat and shared record**
    **What:** Chat carries coordination and discussion; the shared record retains contributions, changes, attribution, and examined project state. **Why needed / capability added:** Enables participants to continue and coordinate an investigation while distinguishing recorded state from agreement about meaning. **Depends on:** Participants, project, and the preceding contributions. **Not responsible for:** Making announcements change analyzed state or turning consensus into truth.
    Chat has a distinct social purpose. The shared record principally states preservation and collaboration requirements across existing concepts.

24. **View**
    **What:** A presentation of selected material with the interpretations and context used to examine it; a resolved machine view combines a machine state with applicable knowledge. **Why needed / capability added:** Makes an examination inspectable through consistent presentations. **Depends on:** Material, selected definitions and knowledge, configuration, and any analysis required to produce the presented information. **Not responsible for:** Becoming an independent assertion or evidential result merely because it is displayed.
    The presentation role is clear. Whether “resolved view” denotes that presentation or the inputs prepared for analysis is less clear.

Removing each concept gives the reverse test below. Specialized roles can be useful without requiring independent foundational concepts.

| Remove | What becomes impossible or materially awkward |
|---|---|
| Project | Expressing investigation membership and project-relative identity. |
| Asset | Referring to source material independently of machine placement and later writes. |
| Platform / mapping | Giving state and accesses their machine-specific behavioral meaning. |
| Machine state | Expressing a particular partial machine state beyond source contents. |
| Constants / types / decoders | Reusing named values and readings independently of assertions about particular material. Record types specifically add structured field layouts. |
| Entry point / function | Entry points provide analysis roots. The additional loss from removing *function* is less exact: the document promises a designated behavioral subject but underdefines its distinction from a root and discovered body. |
| Claim | Recording an assertion separately from observations, definitions, and chosen conditions. |
| Knowledge | Removing the collective word loses little. Removing the promised applicability capability prevents justified selection and reuse of claims across contexts. |
| Record | Referring to one occurrence’s fields becomes awkward; the document does not settle whether this occurrence is asserted or exploratory. |
| Binding | Expressing what a particular use refers to becomes awkward. A generic claim could carry an asserted relation, but would not by itself distinguish its use as an analytical input or output. |
| Configuration | Separating chosen assumptions and interventions from represented state and asserted knowledge. |
| Analysis | Deriving structure and possible behavior from the selected inputs. |
| Scenario | Expressing conditional inputs and interventions over time. |
| Experiment | No unique loss is established beyond configuration and scenario. |
| Execution / run | Observing machine behavior and identifying one occurrence under recorded conditions. |
| Checkpoint / capture / trace | Their contents remain expressible as machine states and observations, but continuation state, observed output, and access history lose explicit roles. |
| Derived / retained result | Distinguishing outputs from inputs and preserving exactly what an earlier examination established. |
| Provenance | Tracing contribution authorship and origin independently of justification. |
| Evidence | Expressing why particular grounds bear on an assertion. |
| Coverage / hygiene report | Investigation-wide summaries become awkward; underlying gaps and contradictions remain expressible. |
| Finding / finds log | Removing findings loses explicit investigative significance and developing leads. Removing the log loses collection convenience. |
| Article | Expressing an authored, reader-directed account as distinct from investigative contributions. |
| Chat / shared record | Removing chat loses coordination discourse. Removing shared-record guarantees loses continuity and an identifiable state for collaborative examination. |
| View | Consistent, contextual presentation becomes awkward; the underlying material, claims, and results should remain expressible. |

The final assessment is:

- **Concepts with a crisp independent reason to exist:** Project as investigation scope; asset as identifiable material; platform behavior and mapping; machine state as represented state; reusable definitions; claim as assertion; configuration as chosen setup; analysis as derivation; scenario as reactive execution specification; run as recorded occurrence; retained result as a fixed earlier examination; provenance as origin; evidence as justification; finding as investigative significance; article as authored account; chat as coordination; view as contextual presentation. Several other named concepts are coherent specializations of these, rather than additional foundations.

- **Concepts whose boundaries overlap:** Experiment duplicates configuration’s stated responsibility for conditions. Record sits between type application, asserted interpretation, and derived decoding. Binding has distinct relational meaning but an unspecified status among configuration, claim, and result. Function designation is insufficiently distinguished from an entry point and its discovered body. Knowledge largely collects claims while also carrying the unexplained promise of applicability. Platform bundles behavior with resources and descriptive knowledge. Resolved view risks combining prepared analytical inputs with presented outputs.

- **Circular or hidden dependencies:** There is no unavoidable cycle between machine states and execution: a producer is not part of a machine state’s essential definition. Nor does evidence arriving after claims create a cycle. The genuine hidden dependency is selecting applicable knowledge before analysis without defining what establishes that applicability. Configuration also selects “interpretations” before the document clarifies their constituent roles. Inferred bindings and discovered function bodies must remain outputs of an examination until explicitly used as inputs to another; otherwise their use can conceal a dependency on the result being computed. The prose describes resolved views as machine-state-plus-knowledge, while the diagram places views after analysis; the direction needs clarification. The design register is an explicit external dependency for representation and operational decisions. The linked examples provide external substantiation, but cannot supply missing semantic definitions within this test.

- **Semantic capabilities promised but not yet grounded:** **`Machine state + applicable Knowledge → View` works only if “applicable” has already been established and the analytical setup is understood.** Claims can already express general assertions; the missing capability is not a container for shared knowledge. It is establishing when an assertion’s subject and conditions correspond to a selected examination, across differences in material identity, placement, state, and available contents. The architecture distinguishes coordinates, association, and applicability but does not supply that correspondence. It also leaves unclear how unknown applicability differs from selected applicability, and how selecting disputed knowledge affects an examination without implying acceptance. Platform knowledge without ROM contents sharpens this gap: the description promises meaningful subjects despite absent material, but does not explain their identification and applicability. Finally, machine state plus knowledge does not alone determine readings or derived values unless configuration, definitions, platform behavior, and relevant analytical choices are implicit.

- **Smallest wording clarifications needed in 02-architecture.md:** State whether *knowledge* is the collective term for claims or includes other contributions. Define applicability positively, including its relationship to a claim’s subject, association, stated conditions, and the selected examination; explicitly preserve unresolved applicability. Clarify that selecting an assertion for analysis does not verify or endorse it. State whether a record exists during exploratory type application and distinguish its identity from decoded output. State how supplied and inferred bindings occupy the already-established roles of choice, assertion, and result. Clarify what a function designation asserts or selects before its body is discovered. Either identify experiment’s distinct meaning or describe it explicitly as a use of configuration and scenarios. State whether a resolved view is a presentation or an analytical input, and make the surrounding prose and diagram agree. Qualify the machine-state-plus-knowledge formulation with its assumed configuration and definitions. These clarifications require no additional grouping abstraction.
