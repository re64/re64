# Editorial review: version A

## Scope and outcome

Reviewed all 375 lines of `inputs/version-a.md`, sentence by sentence and then as a complete document, treating it as `docs/02-architecture.md`. The only other material read was `inputs/editorial-prompt.md` and `inputs/purpose.md`. All line references below refer to the original snapshot.

The architecture establishes most of its central distinctions clearly: assets versus placement, unknown state versus defaults, configuration versus assertions, results versus evidence, and shared records versus shared conclusions. The most consequential omission is the rule that participants can collaboratively edit and retire claims while preserving their history. Several smaller passages obscure actors or scope, and the interface diagram omits direct asset viewing that its surrounding prose expressly permits.

`version-a-proposed.patch` proposes repairs for A01–A16. A17–A23 identify semantic questions left unchanged. The patch targets `a/docs/02-architecture.md` and `b/docs/02-architecture.md`; it has not been applied to the working architecture or either input. No storage, synchronization, or interface representation is selected.

## Proposed changes

### A01 — Name the purpose document consistently

**Lines 7–10.** The link calls the supplied purpose document a “manifest,” although its title and role are about purpose. Use “purpose document.” The link destination and the distinction between architectural concepts and decisions tracked in the design register remain unchanged.

### A02 — Make independent investigation a general capability

**Lines 22–28.** “In their own right” leaves the independence to be inferred from the next sentence's examples. “As legitimate a subject” states a value without clearly describing the supported behavior. Say explicitly that assets can be investigated without constructing a running machine, and that investigation requires neither a name nor an active directory entry. Keep reading, range comparison, picture decoding, allocation-map inspection, and unnamed/deleted material as concrete examples. Asset identification and reuse across states and analyses remain intact.

### A03 — Clarify configuration's scope and the tools' responsibility

**Lines 65–70; grounding at 79–80 and 111–120.** The definition says configuration is chosen “for an analysis” even though it includes an experiment's conditions and selects the platform used in execution. State “analysis or execution.” The following sentence makes an “examination” apply changes; identify tools as the actor responsible for making the resulting state explicit and interpreting it consistently.

Retain configurations that describe unreachable states, optional retention, temporary alternatives without named states, identification of assumptions in results, and preservation of the retained starting state. Reflow the unusually long definition without adding a configuration schema or prescribing how tools represent state.

### A04 — Explain the example's C64 vocabulary in place

**Lines 72–75.** “Decruncher” is not established for a reader without the example's history. Call it a “decompression routine (the decruncher).” The paragraph itself already establishes that the disk version is compressed. Preserve the example's sequence: execute the routine, capture the expanded game's state, and use that state for further investigation.

### A05 — Give the effects summary a concrete object

**Lines 104–109.** “Including the behavior it reaches” does not say how that behavior belongs in a read/write summary. Say that the summary includes reads and writes in code the block or function can reach. This retains the existing reachability scope and the distinction between possible effects and observed execution; it does not restrict effects to direct accesses or calls. Unsupported instructions and unresolved accesses still limit the result.

### A06 — Resolve the run definition's nearby referent

**Lines 111–115.** In the original sequence, “those conditions” follows the scenario's “inputs, checks, and actions,” although the chosen conditions were introduced with the experiment. Define a run immediately after the experiment and explicitly refer to “the experiment's chosen conditions.” Then define scenarios and their triggers and actions. This clarifies the relation without asserting that every run requires a named or separately retained scenario.

### A07 — Remove a local recap that adds no requirement

**Lines 122–126.** “A trace explains activity; a checkpoint preserves state” repeats the definitions in the same paragraph. Delete that sentence. The checkpoint still captures a reusable machine state; the capture still retains an observation; the trace still records instructions, access kinds, and reached storage or devices. The trace's unresolved coverage issue is A20, not silently repaired here.

### A08 — Explain the runtime observation limit without an undefined target

**Lines 128–130.** “An executed target” introduces “target” without saying what was targeted, and “an unobserved target is not thereby impossible” elides the behavior at issue. Use the concrete action of execution reaching a location. An observed arrival establishes that it occurred under the recorded conditions; a missing observation does not establish impossibility. Preserve both the conditions attached to observations and their use in later analysis.

### A09 — Establish collaborative claim editing and retirement

**Lines 139–142; related preservation commitments at 228–232 and 274–295.** The definition frames a claim around what one participant wants considered true, uses “withdrawn,” and never establishes who may edit or retire it. General statements about contributing concurrently do not establish that another participant may retire a claim.

Define a claim as an assertion about a subject for participants to examine. Replace “withdrawn” with “retired” and explicitly state that participants can edit and retire one another's claims and that retirement preserves the claim and its investigation history. Keep non-address subjects and tentative, supported, and disputed claims.

**Basis:** the review prompt explicitly requires these behaviors. This is a restoration of supplied requirements, including an explicit addition to the snapshot, rather than a conclusion that author ownership was already unambiguously ruled out. The patch introduces no approval process, lifecycle implementation, or rule that retirement settles truth or permanently prevents reuse.

### A10 — State claim scope before its example

**Lines 144–148.** “Its code” has competing nearby referents: claim, subject, or asset. The sentence also makes code execution carry the explanation of a general relationship. State that association with an asset does not restrict a claim's subject to locations within that asset, then identify code **in the asset** as the example. Claims still apply across assets, machine states, and broader contexts without repeated entry, and subjects need not be locations.

### A11 — Consolidate selection and reuse without losing the uncertainty rule

**Lines 150–157.** The final clause repeats the preceding statement about selection, with the same implication for truth. Say “Selecting or reusing a claim for analysis does not verify or endorse it.” Separate the retained-assumption requirement into its own sentence. Applicability can still be established, assumed, disputed, or unresolved, and analysis can still proceed under an explicit assumption when applicability or truth is uncertain.

### A12 — State the general non-address relationship before the examples

**Lines 185–190.** Non-address interpretation is expressed primarily as a property of a particular file identifier, despite the paragraph also describing relationships by shared index. Lead with the capability to express relationships that do not use memory addresses. Preserve separate-table/shared-index and picture/file-selection examples, reference following and annotation, preservation of encoded values, and the distinction between identifying an asset and specifying its loading place or time. This does not claim that all bindings use non-address encodings.

### A13 — Avoid treating competing interpretations as errors

**Lines 239–246; purpose document's treatment of disagreement.** Calling every listed item a “problem” puts competing interpretations in the same category as broken references. Use “matters for review.” The hygiene report still surfaces every listed category, including genuine contradictions under the same conditions, and participants can still record disagreements that checks miss. Sharing unfinished knowledge remains allowed. The change does not require disagreements to be resolved or mechanically detected.

### A14 — Remove an unexplained consensus implication

**Lines 286–290.** “Agreed semantics” does not identify who must agree and occurs immediately after the discussion of social coordination. Use “specified behavior of individual operations.” Concurrent editing must still preserve that behavior and expose unresolved disagreements. The change supplies no operation contracts and leaves their design to the existing design process; it avoids suggesting that a participant agreement is itself a prerequisite for correct operation behavior.

### A15 — Make the conceptual recap and its diagram agree with established concepts

**Lines 299–323; grounding at 161–165.** The prose suddenly bolds “Derived results,” although “results” is already used throughout and is the diagram's node name. It also describes analysis alone while the diagram includes execution. Use “Results” consistently and name both analysis and execution. Replace the actorless “Configuration chooses” with participants choosing a setup through configuration.

The diagram makes definitions appear parallel to configuration, although the type section says they are configuration; label that node “Configuration (including definitions).” It routes every view through analysis results, although lines 301–302 explicitly allow direct asset presentation; add a direct edge labeled “inspect an asset directly.” The edge's label limits that route to assets even though its origin node groups assets and machine states.

Scope the diagram's introduction to analysis/execution, direct asset viewing, and retained results used as evidence. It is not a complete taxonomy of evidence: the earlier section still permits source locations and recorded reasoning. Preserve selected claims as analysis inputs, the need to retain and interpret a result with context, and evidence informing investigation. Neither an arrow nor the revised prose establishes automatic endorsement or claim selection.

### A16 — Make the heading hierarchy reflect the document's organization

**Lines 304–338.** The conceptual recap has no label, while its worked interface example is an unnumbered second-level heading alongside the eight architectural sections. Add `### Recap: inputs, results, and evidence` and `### MCP and the web UI`, and make `One field, two presentations` a third-level heading within section 8. The recap, interface commitments, disassembly explanation, and illustrative example remain in their existing order. No content is moved into a separate architectural topic.

## Unresolved semantic questions — no speculative patch

### A17 — What must remain traceable after writes?

**Lines 60–63.** “The resulting bytes remain traceable to their origins, including later writes” can mean identifying the latest producing write, preserving successive overwrites, or explaining the source values/computation behind each resulting byte. Those are materially different participant-visible capabilities. Specify the required traceability and what is shown when an origin is unknown. Preserve source assets and distinguish overlapping/hidden storage under any answer. Choosing a provenance representation is separately deferred.

### A18 — What kind of contribution designates a function?

**Lines 98–102.** “A function is designated at an entry location” does not identify whether designation is a participant choice, a claim, an analysis result, or a capability covering several of these. The distinction matters because the later binding section explicitly separates choices, assertions, and inferred results. Establish the intended roles, ideally with one short example; do not infer an author-only or tool-only designation rule. Disjoint bodies, incoming state, cross-asset boundaries, and overlapping readings are already clear and should remain.

### A19 — Which effects of an intervention must a run record?

**Lines 117–120.** “Their presence and effect belong in the run's record” can require the applied state/code change, the intended behavioral consequence, or a demonstrated causal effect on later behavior. The latter cannot be assumed merely because an intervention was made. Clarify which information is mandatory and distinguish an intended consequence from an observed one where relevant. The patch leaves the original commitment intact rather than silently weakening it to a record of intent.

### A20 — Does an access trace cover accesses without an executing instruction?

**Lines 55–58 and 124–126.** Mapping accounts for an accessing processor **or device**, but the trace definition attributes recorded accesses to instructions. Clarify whether this trace is specifically an instruction trace, whether other device activity uses a separate trace, or whether the definition should identify non-instruction initiators too. This is a coverage decision, not grounds to silently add comprehensive device tracing. Preserve the reached storage/device distinction whichever model is selected.

### A21 — What identifies the “use” in a binding?

**Lines 178–183.** The targets of a binding are concrete, but its source is only called “a use.” It is unclear whether that means an occurrence in asset bytes, an operand or decoded field under a particular interpretation, an expression referring to a definition, or more than one of these. Because the same encoded value can have different meanings, this missing context affects what participants are selecting or asserting. Give one representative source occurrence and its context before deferring identifiers and storage representation. Do not choose that domain from the examples alone.

### A22 — What surviving material is “spillover”?

**Lines 200–203.** “Spillover” is the only listed category whose meaning is not established for a software engineer without project history. It might concern residue copied beyond useful data, overflow, or another origin; these are not equivalent interpretations. Supply a short description of the intended phenomenon or a self-contained example. Deleting the term would remove a named investigation subject, so it is retained pending clarification. The important rule that origin classification does not prove behavioral irrelevance is already explicit.

### A23 — What observable conflict must regenerated views avoid?

**Lines 320–323.** “Regenerated views must not become competing sources for the same project state” never establishes what a “source” is. It could mean avoiding divergent substantive answers for identical inputs, avoiding independent editable project knowledge, or avoiding duplicate retained artifacts. Those answers impose different requirements and should not be substituted for one another editorially. State the unwanted participant-visible behavior, for example what happens after regenerating a view and comparing or editing it. Keep storage and synchronization choices deferred. Interface consistency at lines 327–329 already covers one possible interpretation, but does not settle the others.

## Review coverage, including text left unchanged

- **Introduction, lines 1–15:** reviewed in full. Only the purpose-document link label changes. The running example, C64 focus, non-C64 non-commitment, and design-register boundary are useful and remain.
- **Section 1, lines 17–40:** reviewed in full. Asset independence is clarified. The contents/placement distinction, identifiable locations after relocation, source context through transformations, and two-build example need no changes.
- **Section 2, lines 42–90:** reviewed in full. Configuration and the decruncher explanation change. The unknown/default distinction, complete continuation state including connected devices, access mapping, and hidden-memory requirements remain. Write provenance is A17. **The platform-knowledge subsection, lines 77–90, has no proposed changes:** it distinguishes descriptive knowledge from available ROM contents and states the substitute-ROM experiment's evidential limit.
- **Section 3, lines 92–135:** reviewed in full. General analysis capabilities, abstract interpretation's tracked state, unsupported-operation limits, intervention examples, and the overlapping-instruction example remain. A18–A20 identify limits that require author decisions rather than inferred repairs.
- **Section 4, lines 137–208:** reviewed in full. Claim collaboration, subject scope, reuse, and the non-address relationship introduction change. **Constants/types/records and correction behavior, lines 161–176, have no proposed changes:** exploration can use an interpretation without claiming truth, decoders identify extra inputs, and earlier evidence remains tied to the examined definition. The binding definition remains pending A21. **The record example, lines 192–196, and surviving-material subsection, lines 198–208, have no proposed changes:** the latter has A22, but filtering, byte preservation, continued behavioral analysis, and competing labels are clear.
- **Section 5, lines 210–252:** reviewed in full. Only the hygiene-report framing changes. Provenance versus evidence, claims without attached evidence, external investigative tools, retained operation/context/output, new results on rerun, dependency discovery limits, coverage gaps, and sharing incomplete knowledge remain. The GOATS/OATS example is retained as a concrete correction sequence.
- **Section 6, lines 254–272:** **reviewed in full with no proposed changes.** Findings can begin as leads and gather linked reasoning; their notes and relationships are concrete. Articles select and explain material, and retaining finished work imposes no built-in editor or publishing-system requirement. The assembler-source example contributes historical/editorial context.
- **Section 7, lines 274–295:** reviewed in full. Only “agreed semantics” changes. Shared participation, chat coordination without technical reservation, visible incorporation of updates, explicit or policy-driven incorporation, concurrent disagreements, retained results, and disagreement about meaning remain.
- **Section 8 and worked example, lines 297–366:** reviewed in full. Recap terminology, diagram relationships, and headings change. The unresolved regenerated-view sentence remains under A23. **Interface behavior, disassembly, and worked-example prose/data, lines 325–366, have no substantive text changes:** parity, alternate readings, no round-trip assembly obligation, illustrative schema status, and context on independent results remain. Both displayed strings contain 40 characters; the arithmetic `42 × 200 = 8,400` and field offset plus field length fitting a 200-byte record are internally consistent.
- **Reference definitions, lines 368–375:** reviewed as document structure; unchanged. Their targets and all linked factual material were not opened.

## Dependencies not consulted

The design register is an explicit dependency for representation, storage, synchronization, and tool-interface decisions. The linked build comparison, ROM experiment, recipe, instruction example, record analysis, cheat investigation/check, and article are dependencies for independently validating the historical and technical examples. This review checks their exposition and internal consistency, not the underlying external facts. No answer to A17–A23 was imported from those sources, earlier architectures, or prior evaluations.

## Final preservation audit and validation

Reread the full proposed document, then checked every replacement/deletion against the original snapshot.

- The only standalone sentence removed is the trace/checkpoint recap (A07); both definitions preserve its meaningful distinctions. Other deletions are replaced with explicit equivalents identified in A01–A16.
- Claim retirement replaces “withdrawn” and adds the collaboration/history requirements mandated by the review prompt. No author ownership, consensus requirement, destructive history change, or automatic evidence-to-truth transition is introduced.
- Choices/configuration, claims, results, and evidence remain distinct. A result still needs established relevance to support a particular claim, and retained evidence still identifies the earlier material, definitions, assumptions, operation, and output.
- Asset identity versus placement; unknown state versus defaults; source preservation; unreachable experimental configurations; temporary unnamed alternatives; platform resources versus ROM bytes; cross-asset and overlapping analysis; execution limits; unused-material inspection; visible filtering; shared corrections; partial understanding; external authoring; and UI/MCP consistency remain present.
- The recap and diagram now agree on execution, definitions within configuration, and direct asset viewing. The diagram is explicitly scoped so its results-to-evidence path does not exclude the other evidence sources already described.
- No storage mechanism, synchronization algorithm, naming convention, serialization schema, guaranteed complete dependency discovery, built-in editor, or publication system is added. The undefined regenerated-view restriction is preserved and reported, rather than converted into a storage requirement.
- The final pass found no additional inconsistency or new substantive repetition in the proposed repairs. Existing repeated safeguards have different local purposes: type-edit impact versus the general retained-result contract; inspection holes versus coverage reporting; interface context versus independently saved response context. They are retained. A17–A23 remain visible limitations of the proposed document; this is not an assertion that those ambiguities are resolved.
- Validation: generated a unified patch from the supplied snapshot, applied it only to a temporary copy under `/tmp`, and compared the result byte-for-byte with the reread proposal. Checked that link-reference definitions and the assembler/JSON examples were unchanged. The working architecture and input files were not modified. No implementation tests were needed for this document-only proposal.
