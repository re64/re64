# Editorial review: version B

## Scope and conclusion

Reviewed the entire supplied architecture, sentence by sentence, followed by its
organization, examples, diagram, and reference definitions. The only source
material read was `inputs/editorial-prompt.md`, `inputs/purpose.md`, and
`inputs/version-b.md`. Line references below refer to the original version B
snapshot, treated as `docs/02-architecture.md`.

The document establishes most of its distinctions clearly. The proposed patch
contains ten groups of repairs, including one required constraint that was not
explicit in the snapshot: participants can edit one another's claims. Six
semantic questions remain open. The patch does not choose their answers.

Deliverable: `version-b-proposed.patch`, with paths
`a/docs/02-architecture.md` and `b/docs/02-architecture.md`. Neither the architecture
nor any input snapshot was edited.

## Proposed repairs

### B01 — Name the context document consistently

**Original lines 7–10; editorial repair.** The linked document calls itself the
purpose of re64, while the architecture calls it the “manifest.” Use “purpose
document,” keeping the link, division of responsibility, and design-register
deferral intact. This avoids suggesting that a different introductory document
is required.

### B02 — State the general asset-inspection requirement before its examples

**Original lines 22–28; editorial repair grounded in lines 24–28 and 305–308.**
The paragraph first says assets can be investigated in their own right, then
gives four operations that do not need a running machine. A reader should not
have to infer whether this is a general capability or an exception for those
four operations. State directly that examining an asset does not require
constructing a running machine, and retain all four examples. Asset identity,
reuse across analyses and machine states, and the legitimacy of unnamed or
deleted material remain explicit. This does not promise that every question
about an asset's behavior can be answered without execution.

### B03 — Match the platform heading to its content and orient the forward reference

**Original lines 81–86; editorial repair.** “C64 support” promises a description
of supported C64 behavior, but the subsection introduces the general platform
concept and platform knowledge. Rename it “Platforms and platform knowledge.”
Make clear that the platform supplies the hardware and ROM knowledge, and point
the reference to shared descriptive facilities toward sections 4 and 5, where
claims, definitions, provenance, and evidence are introduced. This does not
choose a representation for platform knowledge. The C64 priority and lack of
support commitments for other machines remain at lines 11–12; ROM availability
requirements and the substitute-ROM example are unchanged.

### B04 — Make the effects sentence concrete and remove an overclaim about traces

**Original lines 112–115 and 128–132; editorial repair.** “The behavior it
reaches” leaves the object of an effects summary unclear. Say that the summary
includes reads and writes performed by code the block or function reaches. This
preserves the scope beyond the initial block or function and the qualification
“may”; unsupported instructions and unresolved accesses remain visible limits.

“A trace explains activity” overstates what the preceding definition promises:
the trace records accesses and the storage or device reached. Delete that short
recap. The immediately preceding definitions still establish that a checkpoint
preserves execution state, a capture retains an observation, and a trace records
accesses. No automatic explanation facility was otherwise established, and the
following paragraph still permits observations to inform analysis.

### B05 — State that claim editing is collaborative

**Original lines 144–149; required-constraint restoration.** The snapshot grants
every participant permission to retire a claim but never explicitly says that
participants can edit one another's claims. General project editing at lines
310–314 does not settle whether claims have an author-only editing rule. Add the
explicit sentence “Participants can edit one another's claims.” This addition
comes from the review instructions, rather than an invented behavior decision.

Keep “retire,” the permission for any participant to retire a claim, removal from
current knowledge, and preservation in investigation history. The shared record's
changes and attribution remain required by lines 298–301. The patch introduces
no author ownership, approval requirement, or synchronization mechanism.

### B06 — Separate a claim's subject from the contexts in which it applies

**Original lines 151–154, read with 144–163; editorial repair.** “Describe one
subject or apply across several assets” places subject and applicability in an
either/or relationship, although the following paragraph permits a claim about
a subject to apply under several conditions. Say that a claim about a subject
can apply across assets, machine states, and other stated contexts without
repeated entry. This retains reuse and does not prescribe a subject-count schema.

The pronoun in “its code may act elsewhere” also requires the reader to choose
between the claim, its subject, and the asset. Keep the general rule that an
asset association does not confine the subject to that asset's bytes, then give
an explicit example: a claim associated with code in one asset can describe its
effects elsewhere in the machine. No claim is required to be address-based.

### B07 — Consolidate the caution about claim selection and reuse

**Original lines 160–163; editorial repair.** The final sentence repeats the
same non-verification rule for selection and reuse. State once that using a
claim, including reusing it in another examination, does not verify or endorse
it. Split the preceding sentence after uncertainty to keep the requirement that
results retain assumptions prominent. Applicability established by evidence,
assumed applicability, dispute, unresolved applicability, and uncertain truth
all remain distinct and unchanged.

### B08 — Avoid classifying every competing interpretation as a defect

**Original lines 244–251; editorial repair grounded in the purpose document and
the paragraph's own qualifications.** “Problems such as … competing
interpretations” labels disagreement as a problem before the text explains that
unfinished knowledge may be shared. Describe the hygiene report as bringing
these matters to participants' attention. Preserve the full illustrative list,
the same-conditions restriction on contradictions, participant-recorded
disagreements, discoverable open questions, and the explicit statement that the
reports neither certify truth nor require resolution before sharing. The patch
does not change what the report must expose or turn it into a verdict.

### B09 — Remove the unexplained suggestion of agreement on operation semantics

**Original lines 291–296; editorial repair.** “Agreed semantics” does not identify
who agrees, or distinguish that agreement from chat agreement discussed
immediately above. Use “specified behavior of individual operations.” This
preserves the requirement that concurrent editing respect each operation's
meaning and expose unresolved disagreements, without suggesting a participant
consensus step. Concrete operation definitions remain a dependency on the
separately deferred design work, not a claim that this overview already specifies
them all. The separate question of who chooses an update policy remains B16.

### B10 — Make the summary's actor and view relationships explicit

**Original lines 355–368, grounded in 65–74 and 305–314; editorial repair.**
“Configuration chooses” makes a setup sound like a decision-making actor. Say
participants choose the setup through configuration, preserving the distinction
between configuration, claims, results, and evidence.

The diagram gives views only a results input, although section 8 explicitly
permits direct asset presentation and says views depend on configuration,
definitions, and selected claims. Add those inputs to the view node. Label the
material-to-view edge “direct asset inspection” so it does not imply that every
machine state is itself an asset. Add “participants” to the results-to-evidence
edge: retention and interpretation are deliberate acts, as the recap says.
The existing analysis inputs, result output, and evidence feedback remain.
The diagram is still a summary of these relationships, not an exhaustive model
of all evidence sources, articles, findings, or collaboration.

## Unresolved semantic questions — no answers inserted into the patch

### B11 — What observable provenance must survive later writes?

**Original lines 60–63.** “The resulting bytes remain traceable to their origins,
including later writes” does not say what a participant can trace: source assets,
the producing run, the particular write, or a chain through earlier writes. The
unconditional wording may promise substantially more than retaining a run and
its conditions. Clarify the required participant-visible traceability and any
limits; this need not select a storage or execution-tracing implementation.
The patch preserves the existing promise in full pending that clarification.

### B12 — Who designates a function, and what kind of contribution is that designation?

**Original lines 104–108, related to 184–189.** “A function is designated at an
entry location” leaves open whether this is an investigator's analytical choice,
a claim, a result of discovery, or several supported routes. The later binding
paragraph carefully distinguishes choice, assertion, and inference, but does not
establish that distinction for function designation. State the actor and status
or point to the deferred decision. Do not silently turn a discovered function
into accepted knowledge. The patch preserves disjoint bodies, incoming-state
dependence, asset-boundary crossing, and overlapping readings.

### B13 — Which intervention effects must a run record?

**Original lines 123–126.** “Their presence and effect belong in the run's record”
could mean the direct substitution or state change, the observed downstream
behavior, or a causal conclusion about what the intervention changed. These
require different evidence, and the last may not be knowable from one run.
Clarify which effects are required and how unknown effects remain visible. The
patch does not weaken the existing recording requirement or assume that causal
effects are automatically established.

### B14 — What is a binding's “use”?

**Original lines 184–194.** The targets are enumerated, but the source side is
only “a use.” The numeric-value sentence suggests an occurrence in program data
or an operand; the broader target list could also mean a symbolic reference in
a definition, a record field, or a use in a particular examination. Which
occurrence and context identify what is bound? A small example naming both ends
would settle the essential meaning without prescribing an identifier or schema.
The patch does not choose a source domain. Chosen bindings, asserted bindings,
inferred bindings, cross-table links, program-specific references, and retention
of encoded values remain intact.

### B15 — What material is called “spillover”?

**Original lines 205–208.** “Spillover” is the one item in this historical-material
list whose meaning is not supplied by ordinary software-engineering usage or
the purpose document. It could describe remnants outside an intended output,
adjacent material carried into a file, or something else. Supply a short gloss
or example from the intended investigation. Replacing it with “unused fragments”
would silently collapse a potentially distinct category, so the patch leaves it
unchanged and records the unresolved terminology.

### B16 — Who chooses the policy for incorporating updates?

**Original lines 291–296.** Participants can incorporate updates explicitly or
“through a chosen policy,” but the chooser and scope are absent. Is that policy
selected by the examining participant, established for a project, or imposed by
an interface? The answer affects when another participant's contributions enter
the state a person is examining. Clarify the actor and scope while continuing
to defer the storage and synchronization implementation. The patch preserves
explicit and policy-driven incorporation and the distinction between announcing
an update and incorporating it.

## Whole-document coverage and unchanged material

| Original section and lines | Review disposition |
| --- | --- |
| Introduction, 1–15 | B01 only. Purpose, design deferrals, C64 scope, and the running-example introduction otherwise contribute distinct context. |
| 1. Projects and their material, 17–40 | B02 only. Asset identity versus memory placement, tracing extracted material, and the two-build example need no additional edit. |
| 2. Machine states and configuration, 42–79 | No patch. Partial state, defaults versus unknowns, hidden storage, access-dependent mapping, nonhistorical configurations, temporary examinations, explicit resulting states, and preserved starting states remain clear. B11 records a provenance question instead of silently resolving it. |
| Platforms subsection, 81–96 | B03. ROM descriptions without bytes, the requirement for contents to inspect or execute ROM, and the substitute-ROM limitation are retained without changes. |
| 3. Analysis and execution, 98–140 | B04. The entry/function paragraph and intervention paragraph remain unchanged with B12–B13 open. Analysis scope, abstract interpretation, scenarios, runs, checkpoints, captures, trace contents, runtime reuse, and the overlapping-instruction example were reviewed. |
| 4. Claims and applicability, 142–163 | B05–B07. Subject, assertion, provisional knowledge, conditional applicability, and retained assumptions remain distinct. |
| Constants, types, records, and bindings, 165–201 | No patch. Definitions versus claims, unasserted record exploration, decoder inputs, collective corrections, evidence tied to examined definitions, binding distinctions, encoded values, and the record example are preserved. B14 flags the unresolved source of a binding. |
| Interpreting surviving material, 203–213 | No patch. B15 flags one term. Classification versus execution behavior, explicit visible filtering, continued availability, and display choice versus assertion are clear. |
| 5. Evidence, correction, and progress, 215–257 | B08 only. Provenance versus evidence, claims before evidence, retained-result context, limits on reproduction, new results on rerun, discoverable dependencies, renewed judgment, and coverage versus understanding require no further change. The cheat example is retained. |
| 6. Findings and articles, 259–277 | No patch to the entire section. A significant lead can enter the finds log before it is a settled conclusion; references can explain their roles. Article forms, external authoring, retained supporting material, and no required built-in editor or publisher are coherent. |
| 7. Collaboration and shared record, 279–301 | B09. Shared participation, chat roles, lack of chat-imposed restrictions, update visibility, retained history and attribution, result availability, and disagreement about meaning remain. B16 identifies the policy question. |
| 8. Views and interfaces, 303–351 | No patch to the entire section. Inputs to views, direct asset presentation, MCP/web UI parity, limits, non-round-tripping disassembly, consistent interpretations, and contextualized illustrative formats are explicit. The example supplies context in its surrounding query and requires it when results stand alone. |
| 9. Summary and diagram, 353–369 | B10. The numbered Summary heading already identifies the recap correctly. Its distinction between an earlier retained result and a view's selected inputs remains. |
| Reference definitions, 372–379 | All eight reference labels and their uses reviewed; destinations retained unchanged and not opened. |

## Dependencies and checks

The design register and linked example sources were not read, as required by
the review boundary. Their existence or technical claims were not independently
verified. In particular, the build dates, loader behavior, ROM experiment,
instruction example's occurrence in KERNAL, table address and contents, cheat
behavior, and source-fragment interpretation depend on those cited materials.
This is an editorial assessment of their presentation, not external factual
verification. The supplied purpose document supports the document's treatment
of collaborative investigation, evidence, uncertainty, and articles.

The illustrative numbers are internally consistent: 42 records of 200 bytes
occupy 8,400 bytes, and the displayed zone-name strings contain 40 characters.
The disassembly and JSON strings agree. The formats remain explicitly
illustrative rather than schema commitments.

## Final preservation audit

Reread the complete proposed document, including all unchanged paragraphs,
examples, and the modified diagram. Checked each removal against the following
preservation map:

- B01 changes a link label only; B03 changes a heading and adds internal
  orientation. Neither removes a scope or support commitment.
- B02 consolidates “in their own right” into the explicit asset-inspection
  capability and preserves every concrete example and asset guarantee.
- B04 preserves the transitive read/write scope and all stated analysis limits.
  The deleted trace recap adds no distinct behavior beyond the adjacent trace
  and checkpoint definitions. Its suggestion that a trace itself supplies an
  explanation is intentionally removed as an unsupported editorial implication.
- B05 adds the review's explicitly required collaborative-editing behavior.
  Retirement remains available to every participant and preserves history.
- B06 retains reusable applicability, non-address subjects, and subjects beyond
  an associated asset. B07 retains non-verification on both first use and reuse,
  non-endorsement, and recorded assumptions.
- B08 retains every report category and all permissions to preserve disagreement
  and share unfinished knowledge. It removes the implication that competition
  between interpretations is itself a defect.
- B09 retains operation behavior and inspectable disagreements. It removes the
  unexplained implication of a consensus prerequisite, without defining merge
  rules or who selects an update policy.
- B10 preserves every original graph relationship and adds view relationships
  already required by prose. It keeps participants responsible for interpreting
  results as evidence; claims, choices, results, and evidence are not collapsed.

No existing requirement was intentionally dropped or replaced by a new behavior
decision. The sole added substantive commitment is B05, supplied by the review
instructions. No storage layout, synchronization algorithm, automatic
verification, exclusive author ownership, publication gate, or interface schema
was introduced. Deliberately deferred implementation choices remain deferred.

No new prose repetition or inconsistent terminology was found on the final
read. The diagram's extra view edges repeat prose appropriately within an
explicit recap. Its material node groups assets with machine states; the new
edge is specifically labeled for direct asset inspection to make its scope
clear. The diagram does not claim to enumerate every possible evidence source.
The six pre-existing ambiguities B11–B16 remain visible in this report and
unchanged in the proposal; the review does not certify the document as free of
semantic questions.

The unified patch was applied to a temporary copy of the supplied snapshot and
the resulting document was compared byte-for-byte with the reread proposal.
No application or rendering tests are warranted for this editorial patch; the
Mermaid relationships and syntax were inspected as text, not rendered.
