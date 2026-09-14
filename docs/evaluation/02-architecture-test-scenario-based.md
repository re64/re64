# Codex conversation

## User

Read 01-purpose.md and 02-architecture.md. You may use 01-purpose.md to understand re64’s goals and intended use, but treat 02-architecture.md as the architecture under test. Do not read any other documentation, source code, tests, experiment reports, issues, or repository history. If 02-architecture.md depends on information that exists elsewhere, report that dependency rather than looking it up.

Pressure-test 02-architecture.md as written. Do not redesign it and do not resolve decisions deliberately deferred to the design register.

Construct a set of difficult but realistic software-archaeology situations and attempt to describe each using only the concepts and semantic distinctions established by the architecture. Use the Bard’s Tale and Mutant Camels investigations as sources for concrete cases, and add a few plausible C64 cases where useful.

Include at least these cases:

* one Asset placed differently in several Machine states, with Asset-associated Claims both inside and outside its stored byte extent;
* a project containing a main game, a separate intro, and many game Machine states, where some address-space knowledge applies to all game Machine states but not the intro;
* knowledge that genuinely applies across several Machine states or Assets without repeated entry;
* a general Claim entered directly rather than first discovered in one Machine state;
* generally applicable knowledge with a Machine-state-specific counterexample;
* editing a shared Type after many Records have been interpreted with it, while old Evidence must continue to describe what was originally examined;
* a packed program whose execution produces several materially different states before reaching the useful resident state;
* a game with many overlays/levels requiring dozens of useful memory configurations;
* the same address containing different overlay code, data, RAM-under-I/O, or device registers depending on configuration;
* a file whose declared load address is wrong and whose actual placement is established through loader analysis;
* a deleted/orphaned disk object with no normal directory identity;
* slack/stale bytes that resemble executable code and produce false xrefs;
* parallel arrays sharing an index space, including a column whose values identify other Assets;
* two byte-identical resources whose knowledge must nevertheless be allowed to diverge independently;
* a visualization generated from decoded data, inspected by an agent, and subsequently used as evidence for a Claim;
* an experiment deliberately configured into a state known never to occur naturally;
* an experiment that substitutes a KERNAL routine while platform knowledge and optionally ROM bytes remain available;
* analysis of a ROM as investigation material versus use of the same ROM as platform infrastructure;
* two participants concurrently correcting related but distinct interpretations without either correction being lost or silently combined into a stronger assertion.

For each case answer:

1. How does the architecture describe it?
2. What is configuration, what is knowledge, and what is derived analysis?
3. What has stable identity?
4. What is authoritative and what can be regenerated?
5. Does expressing the case require a concept or semantic rule that the architecture has not actually defined?
6. Does any existing concept acquire two incompatible meanings?
7. Would an implementation have to make a consequential semantic decision that 02-architecture.md appears to have decided accidentally?

Classify each case as clean, awkward but sufficient, underspecified, or contradictory.

Be especially adversarial about knowledge applicability across multiple Machine states or Assets, Asset association, Machine state versus configuration, platform behavior and platform knowledge, Claims versus configuration, relationships/bindings, Evidence, and View resolution.

In particular, do not invent Program, Target, Domain, Layer, or another grouping concept to solve shared knowledge. If the architecture cannot express the requirement without one, state precisely what semantic capability is missing. Likewise, do not assume that such a concept is needed merely because it would make a case convenient.

Do not treat missing storage, synchronization, or API details as architectural defects when the document deliberately delegates them to the design register. Report a problem only where the missing detail changes or leaves ambiguous the semantics.

Finish with:

* the smallest set of clarifications 02-architecture.md needs before design work proceeds;
* concepts and boundaries that survived the pressure tests cleanly;
* unresolved questions that should remain in the design register.

Do not propose a replacement architecture or implementation plan.

## Assistant

I’ll read only the two named documents and test the architecture’s stated semantics against the requested cases. Where the investigation details or a required rule live elsewhere, I’ll report the dependency without looking it up.

## Activity

    $ /bin/zsh -lc 'cat 01-purpose.md 02-architecture.md'
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
      inspection. A function is designated at an entry location; its discovered
      body can occupy several disjoint ranges. Its incoming state depends on how
      execution reaches it. Instructions, basic blocks, and functions can cross asset
      boundaries, and overlapping instruction readings remain inspectable.

      **Abstract interpretation** reasons about possible behavior with partly known
      values, following registers, memory, flags, the stack, and control-flow paths.
      **Effects** summarize what a block or function may read or write, including the
      behavior it reaches. Reference queries and stack analysis help explain how data
      and control move through the program. Unsupported instructions and unresolved
      accesses remain visible as limits of the result.

      An experiment examines a question about behavior under chosen conditions.
      A **scenario** describes inputs, checks, and actions as execution proceeds;
      a **run** records one execution under those conditions. Scenarios can react to time, an instruction
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

      Claims express the project's knowledge, including tentative and disputed
      interpretations. They can describe one subject or apply across several assets,
      machine states, and broader contexts without repeated entry. Association with an asset
      does not confine a claim's subject to that asset's bytes: its code may act
      elsewhere in the machine.

      **Applicability** concerns whether a claim's subject and stated conditions match
      the material and circumstances of a particular examination. That match may be
      established, assumed, disputed, or unresolved. An analysis can use a claim under
      an explicit assumption even when its applicability or truth remains uncertain;
      the results retain that assumption. Selecting a claim for analysis does not
      verify or endorse it, and reuse does not independently verify it at each use.

      ### Constants, types, records, and bindings

      **Constants** name values. **Types** define ways to interpret data. A **record type**
      describes fields, their positions, and their types, including numbers,
      pointers, text, bit fields, arrays, and nested records. Unknown portions can
      remain holes. Constant and type definitions are configuration; claims applying
      them express knowledge.

      A **record** is particular material interpreted as an instance of a record type.
      Its fields can be inspected and referenced during exploration, without first
      recording a claim that the interpretation is correct. Reusable decoders express
      custom formats and identify any additional inputs their interpretation needs.

      A change to a constant or type can affect many uses. re64 helps participants find
      those uses, review the impact, and apply corrections collectively. Updating an
      interpretation does not mean it has been verified. Evidence identifies the
      material and definition examined, so a later edit does not make an earlier
      result appear to verify the revised interpretation.

      A **binding** associates a use with what it refers to: a location, label,
      constant, type, record, or field. The same numeric value can have different
      meanings at different uses. A participant can choose a binding for an analysis
      or assert it in a claim; analysis can also infer one from addresses, context,
      and typed regions. Tools distinguish these choices, assertions, and inferred
      results.

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

      A **view** presents material and analysis results in context. What it shows
      depends on the selected assets or machine state, configuration, definitions, and claims
      used for the examination. A view can present an asset directly or show the
      results of machine analysis.

      Configuration chooses the analytical setup. Claims express assertions; evidence
      supports or challenges them. **Derived results** follow from applying an
      analysis to its inputs. These roles connect, but one does not silently become
      another:

      ```mermaid
      flowchart LR
          M[Assets and machine states] --> A[Analysis or execution]
          C[Configuration and definitions] --> A
          K[Selected claims] --> A
          A --> R[Results]
          R --> V[Views]
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

The architecture explicitly covers several hard cases, including counterfactual experiments, claims without initial evidence, retained evidence after Type edits, and unnamed disk material. The main ambiguity I’m testing is how a shared Claim identifies its subjects across relocated Assets and selected Machine states. The two documents contain no Bard’s Tale investigation details, so those cases will be labeled hypothetical; I won’t follow the external investigation links.

## Assistant

An explicitly stated set of Machine states or Assets appears sufficient for shared knowledge; the cases do not by themselves require a new grouping concept. The document also lets general and specific Claims coexist without treating specificity as an override. I’ll distinguish those supported formulations from behavior it does not define, such as automatic scope expansion, subject matching across copies, or precedence when configuration choices conflict with a selected Machine state.

## Assistant

The requested cases mostly fit the architecture, provided shared knowledge is expressed through explicit subjects and conditions, and analytical choices remain explicit. They do **not** establish a need for an additional grouping concept. The strongest remaining ambiguity is how a configuration and an already selected Machine state jointly determine the state being examined.

I read only [01-purpose.md](../01-purpose.md) and [02-architecture.md](../02-architecture.md). The latter contains Mutant Camels examples but no Bard’s Tale investigation details. Its linked reports, recipes, and source files are external dependencies that I did not inspect. Consequently, the overlay-RPG cases below are hypothetical tests relevant to the requested Bard’s Tale workload, not reported findings from that investigation.

“Authoritative” below means authoritative about the recorded material, assertion, or experimental conditions—not necessarily true about the original program. Stable references to retained contributions are required by the document’s behavior; their identifier and version representations remain design questions.

**1. One Asset, several placements, Claims inside and outside its bytes — awkward but sufficient**

Suppose Asset A is placed at `$4000` in one Machine state and `$6000` in another. A Claim identifies a table at Asset offset `$80`. Another Asset-associated Claim says its code uses workspace at `$C800`, outside A’s stored extent.

1. **Description:** Asset-relative locations preserve the table’s identity across placements. The workspace Claim has a machine-location subject and conditions identifying the relevant examination. Association with A does not make `$C800` part of A.
2. **Roles:** Placement and selected interpretations are configuration. The table interpretation and workspace assertion are knowledge. Projected addresses, decoded fields, and discovered accesses are derived analysis.
3. **Stable identity:** A and its internal locations; the Claims; the separately identified workspace subject in its machine context. The table’s numerical address is not its invariant identity.
4. **Authority:** Source bytes, placement choices, and recorded Claims are authoritative inputs. Address presentations and access analysis can be regenerated; retained Evidence preserves its original inputs.
5. **Missing semantics:** Nothing essential for this explicit formulation. The document does not define automatic projection of every Asset-associated Claim, particularly one whose subject is external.
6. **Incompatible meanings:** None if Asset association remains distinct from subject location and applicability.
7. **Accidental decision risk:** Treating association as implicit relocation, ownership, or an applicability gate would add semantics the document does not establish.

The difficult distinction survives: “associated with A” does not answer “which location?” or “under what conditions?”

**2. Main game, separate intro, many game Machine states — awkward but sufficient**

A hypothetical project contains an intro and twenty game Machine states. A workspace address has the same meaning in all twenty game Machine states but a different meaning in the intro.

1. **Description:** One Claim can state its address-space subject and explicitly restrict applicability to those twenty Machine states. The intro is outside its stated conditions.
2. **Roles:** Selecting Machine states and Claims is configuration. The shared workspace interpretation is knowledge. Listings, reference queries, and decoded presentations are derived.
3. **Stable identity:** The individual Machine states and the one shared Claim. No additional identity for “the game” is necessary for this bounded case.
4. **Authority:** The Claim’s recorded subject and conditions determine its asserted reach. Views do not independently enlarge that reach.
5. **Missing semantics:** No essential capability is missing for an explicit collection. Automatic inclusion of future “game Machine states” is not defined.
6. **Incompatible meanings:** None. A project remains the investigation’s home without becoming a single address space.
7. **Accidental decision risk:** Project membership, a filename, or common ancestry must not silently make the Claim applicable to the intro.

A requirement for automatic future inclusion would need a defined criterion for membership and a rule for evaluating it. That is a missing capability only if that additional behavior is required; it does not prove a new grouping entity is necessary.

**3. Knowledge genuinely shared across Machine states or Assets — awkward but sufficient**

Suppose several Assets contain records using the same format, and several Machine states contain placements of those Assets. One assertion about a field’s meaning should be entered once.

1. **Description:** Define the reusable Type once and record a Claim applying the interpretation to the explicitly identified material under stated conditions. Section 4 expressly allows applicability across Assets and Machine states without repeated entry.
2. **Roles:** The Type and its selection are configuration. “These materials use this format” and “this field means duration” are knowledge. Record decoding and field references are derived.
3. **Stable identity:** The shared definition, Claim, and individual material locations. Sharing an interpretation does not identify the underlying materials with each other.
4. **Authority:** The definition specifies decoding; the Claim asserts applicability or meaning. Regenerated Records are not independent confirmations of either assertion.
5. **Missing semantics:** Explicit shared applicability is supported. Automatic correspondence between superficially similar locations in different Assets is not established.
6. **Incompatible meanings:** None if reusing a Type is distinguished from asserting that every use is correct.
7. **Accidental decision risk:** Neither byte similarity nor use of the same Type may silently transfer all knowledge between Assets.

The boundary is important: reusable interpretation is defined; unrestricted knowledge inheritance is not.

**4. A general Claim entered directly — clean**

An investigator begins with the assertion that a particular record format uses a shared character encoding, before examining any particular Machine state.

1. **Description:** Enter a Claim with the format or relevant relationship as its subject and state its conditions. Claims need neither an address nor prior Evidence.
2. **Roles:** The assertion is knowledge. A decoder definition is configuration. Applying that decoder produces derived results.
3. **Stable identity:** The Claim exists independently of the first Machine state in which someone later uses it.
4. **Authority:** The recorded assertion and attribution are authoritative about the contribution. Later checks supply Evidence, not its original identity.
5. **Missing semantics:** None required.
6. **Incompatible meanings:** None; provenance need not become scope.
7. **Accidental decision risk:** Requiring an originating Machine state, or manufacturing one as a universal subject, would contradict the supported address-free Claim model.

**5. General knowledge with a Machine-state-specific counterexample — awkward but sufficient**

Most examined game Machine states interpret a byte as a level number; a modified Machine state uses it as a flag.

1. **Description:** Preserve the general Claim and record the counterclaim or counterexample under the modified Machine state’s conditions. Applicability and truth can be disputed separately.
2. **Roles:** Both assertions are knowledge. Selecting either interpretation under an explicit assumption is configuration. Decoding and contradiction detection are derived.
3. **Stable identity:** Both Claims and the counterexample’s material and Evidence.
4. **Authority:** The recorded assertions and retained observation remain available. A current presentation cannot rewrite the original general assertion.
5. **Missing semantics:** None for coexistence and explicit selection. Automatic exception precedence is not defined.
6. **Incompatible meanings:** None if “applicable” is not confused with “true.” If the general Claim actually includes the exceptional Machine state, the counterexample challenges it; it does not automatically narrow its scope.
7. **Accidental decision risk:** A View must not silently adopt “most specific Claim wins,” or silently rewrite a universal assertion as “usually.”

The architecture supports disagreement here, not an implicit override system.

**6. Editing a shared Type while preserving old Evidence — clean**

Using the documented Mutant Camels example, many Records have been interpreted with `ZoneRecord`. An investigator changes a field definition after earlier checks and visualizations were retained.

1. **Description:** Update the definition and inspect affected uses. Earlier Evidence continues to identify the material and definition actually examined.
2. **Roles:** The Type is configuration. Claims applying it are knowledge. Decoded Records and validation results are derived.
3. **Stable identity:** The material and retained examination remain identifiable. The document requires the old definition to remain distinguishable from the revised one; it does not prescribe whether current Records retain particular identifiers.
4. **Authority:** Earlier retained inputs and outputs govern what the earlier check established. New decoding uses the revised definition and produces new results.
5. **Missing semantics:** None essential. The historical distinction is explicitly required.
6. **Incompatible meanings:** None. “Current Type” and “definition examined by this Evidence” cannot be treated as interchangeable references.
7. **Accidental decision risk:** A live reference that makes old Evidence display the new definition as its examined input would violate the architecture.

Version storage and dependency-index mechanisms belong in the design register.

**7. Packed program with several materially different execution states — clean**

Extend the documented Mutant Camels decrunching example hypothetically: the loader installs a decoder, expands part of the game, changes mappings, and finally reaches the useful resident state.

1. **Description:** A Run traverses these states. Checkpoints preserve selected Machine states; traces and captures retain observations between them.
2. **Roles:** Initial conditions and checkpoint selection are configuration. Assertions about each stage’s role are knowledge. Execution and trace analysis produce derived results.
3. **Stable identity:** Original Assets, the Run, and retained checkpoints and captures. “The program” need not be represented by one privileged Machine state.
4. **Authority:** Source Assets remain preserved. A checkpoint records its captured state; reconstructing it by rerunning is a separate result.
5. **Missing semantics:** None required.
6. **Incompatible meanings:** None. A Machine state is a state, not necessarily a release, file, or completed unpacking.
7. **Accidental decision risk:** Treating earlier useful states as disposable merely because a later “resident Machine state” exists would lose legitimate investigation material.

**8. Dozens of overlay or level configurations — awkward but sufficient**

In a hypothetical overlay RPG, useful investigations require forty combinations of resident code, overlays, level data, and machine state.

1. **Description:** Retain useful configurations and, where state itself is needed, Machine states or checkpoints. Temporary examinations need not create named Machine states.
2. **Roles:** Overlay selection and state choices are configuration. Assertions about overlay behavior and shared interfaces are knowledge. Reachability and effects are derived.
3. **Stable identity:** Overlay Assets and retained states or configurations. Shared Claims retain their own identity across uses.
4. **Authority:** Retained material and explicit setup govern each examination. Listings and ordinary analytical summaries can be regenerated.
5. **Missing semantics:** None essential for a finite set. Configuration inheritance, compact parameterization, and a configuration-management UI are not promised.
6. **Incompatible meanings:** None if “level” is not automatically equated with “Machine state”: one level may have several useful states.
7. **Accidental decision risk:** Implementations must not assume one Machine state per Asset, one per level, or one per project.

The workload may be cumbersome without reuse conveniences. That is not itself an architectural defect.

**9. One address, different overlays, RAM, or devices — clean**

A hypothetical address denotes overlay code in one state, data in another, and either underlying RAM or a device register depending on mapping and access.

1. **Description:** Mapping resolves an access using address, access kind, accessing processor or device, and current state. Underlying storage remains distinguishable.
2. **Roles:** Banking and machine state are configuration. A label or behavioral interpretation is knowledge. Resolved accesses and xrefs are derived.
3. **Stable identity:** The distinguishable storage or device location and the relevant material; the bare numerical address is insufficient.
4. **Authority:** Machine state, mapping behavior, and source material govern resolution. An access trace retains what a particular execution actually reached.
5. **Missing semantics:** None at this architectural level.
6. **Incompatible meanings:** None: numerical address and resolved destination are explicitly distinguished.
7. **Accidental decision risk:** Indexing all knowledge or xrefs solely by the 16-bit address would erase required distinctions.

**10. Declared load address is wrong — clean**

A file header suggests `$0801`, but loader analysis establishes placement elsewhere.

1. **Description:** Preserve the file as an Asset. Record a Claim about actual loading, supported by loader analysis or execution. Configure the examination’s placement separately.
2. **Roles:** The chosen placement is configuration. The historical or behavioral assertion about loading is knowledge. Loader analysis and observed writes are derived.
3. **Stable identity:** The Asset and its internal locations survive the changed placement.
4. **Authority:** Header bytes remain source material; they are not authoritative placement instructions. The configuration governs the current examination.
5. **Missing semantics:** None required.
6. **Incompatible meanings:** None. File contents and placement are explicitly separate.
7. **Accidental decision risk:** Correcting the interpretation must not silently rewrite the original header or make a header-derived default look like established knowledge.

**11. Deleted or orphaned disk object — clean**

A hypothetical RPG disk contains a recoverable chain of sectors with no normal directory entry.

1. **Description:** Investigate disk locations directly or extract an Asset while preserving its source context. Section 1 explicitly legitimizes unnamed and deleted material.
2. **Roles:** Extraction parameters and decoding choices are configuration. Claims about identity, former use, or deletion are knowledge. Recovery and comparison outputs are derived.
3. **Stable identity:** The source disk locations and any separately retained extracted Asset. A directory filename is unnecessary.
4. **Authority:** Original disk bytes and retained extraction context are authoritative material. Candidate reconstructions can be regenerated when their inputs and operation are retained.
5. **Missing semantics:** None essential.
6. **Incompatible meanings:** None; an Asset does not mean “directory file.”
7. **Accidental decision risk:** Requiring a normal file identity, or inventing one that looks historically authentic, would violate the intended scope.

**12. Slack or stale bytes create false code xrefs — clean**

Building on the documented Mutant Camels surviving-fragment example, suppose unused bytes also decode plausibly as instructions and create misleading references during broad inspection.

1. **Description:** Record the stale-material interpretation as a Claim. Keep bytes available. Distinguish selected-for-inspection decoding from reachable behavior and expose filtering.
2. **Roles:** Inspection entry points and filters are configuration. “These are stale bytes” is knowledge. Instruction readings and xrefs are derived.
3. **Stable identity:** The material region, competing Claims, and retained analysis results.
4. **Authority:** Bytes remain authoritative material. The stale interpretation does not prove that execution cannot access them.
5. **Missing semantics:** None required.
6. **Incompatible meanings:** None if a decoded reference is not automatically presented as an executed or reachable reference.
7. **Accidental decision risk:** Treating a data/stale Claim as permission to suppress behavioral accesses would directly conflict with §4.

The architecture does not promise perfect code discovery; it does require the basis and limits of the result to remain visible.

**13. Parallel arrays, including Asset identifiers — awkward but sufficient**

A hypothetical level system stores names, difficulty values, and picture identifiers in separate arrays sharing an index.

1. **Description:** Types interpret the arrays; bindings connect their indexed uses and associate picture identifiers with corresponding material. Section 4 explicitly describes both patterns.
2. **Roles:** Chosen bindings and decoders are configuration. Assertions that the arrays share an index or that an identifier denotes a particular picture are knowledge. Joined presentations and followed references are derived.
3. **Stable identity:** Source arrays, fields or elements, referenced Assets, and recorded binding assertions. A numeric value alone does not identify its referent.
4. **Authority:** Bytes and the selected or asserted correspondence govern interpretation. Joined tables are regenerated presentations.
5. **Missing semantics:** The essential relationship is defined. The binding target list does not explicitly name Assets, although the subsequent picture/file example supplies that capability in substance.
6. **Incompatible meanings:** None if configured, asserted, and inferred bindings retain their distinct roles.
7. **Accidental decision risk:** Treating all equal numbers as the same reference, or inventing an automatic join rule, would add unsupported semantics.

An explicit statement that bindings can refer to Assets would remove a small textual ambiguity without introducing a new concept.

**14. Byte-identical resources with independently diverging knowledge — clean**

Two independently recovered resources have identical bytes. Their historical roles or interpretations may differ.

1. **Description:** Represent them as distinguishable Assets with their respective source contexts and Claims. Shared contents do not require shared interpretation.
2. **Roles:** Selecting an Asset and interpretation is configuration. Separate role or origin assertions are knowledge. Equality comparisons and decoding are derived.
3. **Stable identity:** Each resource’s Asset identity and provenance, independently of byte equality.
4. **Authority:** Each retained source context and contribution remains authoritative about that resource. Physical byte storage could be deduplicated without merging investigative identity.
5. **Missing semantics:** None needed to allow this case. The architecture does not impose content-derived Asset identity.
6. **Incompatible meanings:** None unless an implementation conflates identical content with identical investigation subject.
7. **Accidental decision risk:** Content deduplication must not force Claim sharing or make independent corrections impossible.

**15. Agent-inspected visualization becomes Evidence — clean**

Using the documented Mutant Camels record structure, an agent generates a visualization from decoded records, inspects it, and asserts a pattern.

1. **Description:** Retain the visualization as an analytical result, with decoded inputs, operation, parameters, definitions, and assumptions. Record the agent’s interpretation explaining its relevance to the Claim.
2. **Roles:** Decoder and visualization settings are configuration. The pattern assertion is knowledge. The decoded data and visualization are derived analysis.
3. **Stable identity:** The retained output, examined inputs and definitions, Claim, and attributed reasoning.
4. **Authority:** The retained visualization records what the agent inspected. A later rendering is a new result, even if generated from an updated version of the same data.
5. **Missing semantics:** None required.
6. **Incompatible meanings:** None: a generated artifact can supply material for further analysis and participate in Evidence.
7. **Accidental decision risk:** Generating or inspecting an image must not automatically make it Evidence for an unspecified proposition. Its relevance has to be established.

The agent’s inspection is also not equivalent to a mechanical proof of the asserted pattern.

**16. Experiment in a state known never to occur naturally — clean**

A hypothetical experiment forces a predicate and installs a combination of values that the original game cannot naturally reach.

1. **Description:** Use an explicit configuration and scenario intervention. Record the Run and its conditions.
2. **Roles:** Forced values and actions are configuration. Conclusions about behavior under those conditions are knowledge. Execution observations are derived.
3. **Stable identity:** The Run, retained initial state, interventions, and observations.
4. **Authority:** The recorded conditions govern what the experiment establishes. Natural attainability is a separate assertion.
5. **Missing semantics:** None; §2 expressly permits impossible original-program states.
6. **Incompatible meanings:** None. “Machine state” does not mean “historically or naturally attained state.”
7. **Accidental decision risk:** Removing interventions from a demonstration’s context would make the result support a stronger assertion than the experiment warrants.

**17. Substitute a KERNAL routine while retaining platform knowledge and ROM bytes — clean**

An experiment substitutes one KERNAL routine while the normal platform descriptions and, optionally, ROM contents remain available.

1. **Description:** Select the platform and record the routine substitution as an intervention. Available ROM material and knowledge remain separately usable.
2. **Roles:** Platform selection and substitution are configuration. Routine descriptions are knowledge. The modified execution and analysis of original ROM bytes produce results under their respective conditions.
3. **Stable identity:** The Run and intervention, retained ROM material if present, and the relevant knowledge contributions.
4. **Authority:** The substitution governs the affected execution. Original ROM bytes govern an examination of those bytes; their presence does not negate the intervention.
5. **Missing semantics:** None essential for an explicitly recorded substitution.
6. **Incompatible meanings:** None if platform behavior, descriptive knowledge, and resource contents remain distinct.
7. **Accidental decision risk:** A static effect inferred from the original routine must not silently be presented as the substituted routine’s observed behavior.

The architecture already recognizes deliberate intervention even when faithful emulation is available.

**18. ROM as investigation material versus platform infrastructure — awkward but sufficient**

The same ROM is examined for overlapping instructions and also supplies behavior in another experiment.

1. **Description:** As investigation material, its contents are an Asset examined directly or through a Machine state. As infrastructure, the platform supplies machine behavior and associated resources. These are uses, not necessarily mutually exclusive resource categories.
2. **Roles:** Platform/resource selection is configuration. ROM labels and routine interpretations are knowledge. Disassembly and execution are derived.
3. **Stable identity:** Retained ROM material and particular examined locations; retained examinations identify the resource and definitions used.
4. **Authority:** Actual contents govern byte inspection. Platform configuration governs execution. Descriptive knowledge can remain available when bytes are absent.
5. **Missing semantics:** No essential capability is missing. Automatic matching between platform descriptions and a particular ROM revision is not defined.
6. **Incompatible meanings:** None: the same resource can be material in one examination and infrastructure in another.
7. **Accidental decision risk:** Selecting a platform must not automatically verify that every available ROM description applies to the selected bytes.

The KERNAL overlapping-instruction example also confirms that infrastructure does not have to be treated as opaque.

**19. Concurrent corrections must survive without becoming a stronger assertion — awkward but sufficient**

Two participants work from the same project state. One corrects a field interpretation; the other corrects a related reference binding using the earlier interpretation.

1. **Description:** Preserve both contributions, their examined states, and their assumptions. On incorporation, expose incompatibility or questionable applicability. Neither contribution automatically verifies their combination.
2. **Roles:** Revised definitions and chosen bindings are configuration; assertions applying or explaining them are knowledge. Recomputed decoding and dependency checks are derived.
3. **Stable identity:** Each contribution, its attribution, and the retained examinations supporting it.
4. **Authority:** The shared record preserves what each participant changed and examined. A newly combined analysis is a new result; it is not the Evidence either participant originally supplied.
5. **Missing semantics:** No additional concept is essential. The precise semantic unit of an edit still needs definition during design, under §7’s requirement to preserve operation semantics.
6. **Incompatible meanings:** None if agreement on recorded changes remains distinct from agreement on their interpretation.
7. **Accidental decision risk:** A merge must not silently reinterpret an old binding against a changed Type and present that stronger combined interpretation as either participant’s assertion.

This does not require choosing a synchronization algorithm now. It requires whatever algorithm is chosen to preserve the stated semantic contract.

**20. Additional boundary test: a selected Machine state conflicts with its configuration — underspecified**

Select a checkpoint with particular memory and banking state, then choose a configuration that places an overlapping Asset and specifies different banking. An examination needs one effective state.

1. **Description:** Both Machine state state and configuration state are defined, and temporary alternatives are allowed. The document does not explain their composition when their values conflict.
2. **Roles:** The checkpoint is retained machine state. Placement and overrides are configuration. Conclusions about the resulting machine are derived; Claims about it remain knowledge.
3. **Stable identity:** The retained checkpoint must remain distinguishable from the altered examination. Whether the latter receives a named identity is expressly optional.
4. **Authority:** Both inputs can be retained, but the text does not establish which governs a conflicting location or state component.
5. **Missing semantics:** A rule requiring the effective state to be unambiguously resolved—including the meaning of conflicting contributions—is missing. The architecture need not choose a particular precedence scheme.
6. **Incompatible meanings:** Not an existing contradiction. However, “selected Machine state” could accidentally mean either the captured state or the post-configuration state.
7. **Accidental decision risk:** Different tools could apply different precedence or mutation rules while claiming to examine the same Machine state and configuration. That would undermine consistent View answers and experimental context.

This is a semantic issue, not a request for storage or API design.

**The smallest clarifications needed before design proceeds**

1. **Clarify effective state.** State how an examination relates its selected Machine state to configuration-supplied state, material placement, and interventions. Require conflicts to have an explicit resolution and distinguish the retained input state from the state actually examined. The precise mechanism can remain deferred.

2. **Consolidate the shared-Claim contract.** Make explicit that Asset association alone neither relocates the subject nor establishes applicability. A shared Claim needs sufficiently identified subjects and conditions; automatic membership expansion or correspondence between materials is not implied. The document already largely supports this reading, but its reuse promise should not acquire stronger semantics through implementation defaults.

3. **Clarify View resolution when interpretations compete.** Confirm that any consequential choice of interpretation belongs to the examination’s inputs or is exposed as a derived choice with assumptions. More-specific Claims, platform-supplied descriptions, and display labels have no stated automatic truth precedence. “Same project state” in the regenerated-View requirement should be read together with the complete analytical inputs.

A minor wording correction can also make Asset targets explicit in the binding description. It does not require architectural expansion.

**Concepts and boundaries that survived cleanly**

- Asset contents versus placement; unnamed material versus directory identity.
- Machine addresses versus resolved storage and devices, including hidden memory.
- Machine states as partial or complete states, including intermediate and counterfactual states.
- Claims versus configuration, and applicability versus truth.
- Directly entered knowledge versus the provenance of its discovery.
- Reusable definitions versus Claims that their interpretations are correct.
- Retained Evidence versus current decoding and regenerated Views.
- Captures and traces versus checkpoints.
- Platform behavior, platform knowledge, ROM contents, and experimental interventions.
- Material interpretation versus permission to erase or suppress behavioral access.
- Agreement on recorded contributions versus agreement about their meaning.

No requested case forces a contradiction between these boundaries. Several only work if implementations preserve distinctions the document already states.

**Questions that should remain in the design register**

- Representations for subjects, conditions, multi-material applicability, and explicit correspondence; query and selection conveniences for large Machine state collections.
- Asset and location identifier formats, historical definition references, provenance representations, and byte-storage deduplication.
- Configuration retention, parameterization, composition mechanisms, and conflict-reporting interfaces, after the effective-state contract is clarified.
- Binding representations, decoder interfaces, index correspondence, and reference-query contracts.
- Dependency tracking, applicability checking, hygiene heuristics, and their admitted limits.
- Evidence packaging, retained-result formats, reproducibility support, and external-tool integration.
- Semantic edit operations, synchronization and merge mechanisms, and how unresolved disagreements are presented.
- View caching, invalidation, presentation defaults, and MCP/web response formats.

Those are legitimate design choices. The architecture should constrain their observable meaning without deciding their implementation.
