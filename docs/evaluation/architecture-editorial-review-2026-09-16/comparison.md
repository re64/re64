# Editorial review: before and after the local cleanup

## Conclusion

The editorial prompt recovered some problems that the earlier architecture
pressure tests missed, but it did **not** reproduce the manual cleanup reliably.
The reviewer of the earlier document noticed undefined “target,” collaborative
retirement, the recap's terminology and headings, and the undefined “competing
sources” restriction. It missed several of the sentence-level problems that
prompted the cleanup. Most importantly, it replaced “target” with an assumed
meaning despite the prompt's explicit instruction against doing that.

The reviewer of the revised document accepted the improved evidence/retention
passage, coverage explanation, views section, and heading structure. Both
reviewers also identified issues outside the local cleanup, including a diagram
that omits direct asset views and wording that calls competing interpretations
“problems.” These are useful additional review candidates, not instructions to
apply either proposed patch wholesale.

Neither proposed patch was applied. The working architecture remained identical
to the frozen after snapshot throughout this evaluation.

## Method and evidence

- **Before / version A:** architecture at commit
  `d537cc51526595e643b10315f3745f195dc0888e`.
- **After / version B:** the local architecture frozen at the beginning of the run.
- Both agents received the same frozen editorial prompt and purpose document.
  Each started without the conversation and was instructed to read only its
  assigned inputs. Neither was told which version was earlier.
- The coordinator recorded a [manual cleanup reference](manual-cleanup-reference.md)
  before reading either review, then compared findings with the actual text and
  proposed patches. Matching the user's exact replacement wording was not required.
- See [run details](README.md), [input hashes](inputs.json), the
  [before report](version-a-review.md), and the [after report](version-b-review.md).

| Report output | Before | After |
|---|---:|---:|
| Proposed repair groups | 16 (A01–A16) | 10 (B01–B10) |
| Unresolved semantic questions | 7 (A17–A23) | 6 (B11–B16) |

These are the reviewers' own groupings, not comparable severity scores. A finding
disappearing from one report does not establish that the corresponding problem
was fixed. For example, A03 notices that the configuration definition mentions
analysis while other passages also use it for execution. That wording is still
present after the cleanup, but B proposes no change to it.

## Did the prompt recover the manual corrections?

Finding IDs below refer to the two reports. “Missed” means the report does not
identify the particular problem and its proposed patch leaves it in place; it
does not mean that the reviewer ignored the entire surrounding section.

| Manual cleanup topic | Before review | After review and comparison |
|---|---|---|
| Instruction fetches versus data reads | **Not recovered specifically.** A20 flags a related scope question: instruction-attributed tracing versus device accesses. It does not clarify fetch versus read, and the patch retains “instructions read, wrote, or fetched bytes.” | B04 accepts the explicit access kinds, while removing the separate “trace explains activity” recap. The manual change directly addresses the wording that A left in place. |
| Undefined “target” and generic observation warning | **Detected, but repaired through an assumption.** A08 substitutes execution reaching a location and keeps the warning about unobserved reachability. | B accepts the new run-and-conditions wording. A's repair does not recover the intended historical meaning or justify retaining the general warning; see below. |
| Repeated tentative/disputed claim status | **Missed.** A09 changes retirement and the claim definition, but repeats tentative/disputed in the following knowledge sentence. | B leaves the consolidated status/knowledge explanation intact. |
| Collaborative retirement and retained history | **Recovered, with supplied context.** A09 introduces “retired,” collaborative editing/retirement, and preserved history. It does not establish the manual change's current-knowledge/history distinction. | B05 accepts retirement and history, but asks to make collaborative editing explicit too. The prompt supplied the collaboration constraint, so this is not independent discovery of an undocumented decision. |
| Example-specific binding explanation | **Partly recovered.** A12 states the general non-address relationship first but keeps the detailed arrays/pictures/file-selection example. | B keeps the more general revised paragraph. It separately asks what identifies a binding's source “use” (B14). A's alternative helps expose the requirement without matching the user's preferred level of detail. |
| Connecting produced results with retention | **Missed.** A leaves the paragraph split unchanged and proposes no transition repair. | B accepts the merged paragraph. Paragraph merging is an editorial choice, but A did not identify the connection the user found weak. |
| Vague “later edit” and “earlier check” | **Missed.** A leaves the sentence unchanged and reports retention/context as clear. | B explicitly accepts retained-result context and rerunning behavior in its section 5 audit. The before review did not ask what was edited or checked. |
| Abrupt “corrections,” assumed improvement, and dependency disclaimer | **Missed.** A retains “Corrections improve the working interpretation” and the automatic-check disclaimer. | B accepts the revised explanation of changes and dependencies. A did not expose the assumptions of improvement or a single working interpretation. |
| Coverage versus understanding as an explicit reporting requirement | **Missed.** A treats the original coverage gaps as sufficiently clear and proposes no change. | B explicitly accepts “coverage versus understanding” in its section 5 audit. Since A also accepted the earlier wording, this pair of judgments does not demonstrate that the prompt can distinguish implicit examples from explicit requirements here. |
| Whose examined state an announcement affects | **Missed.** A14 changes “agreed semantics,” but not the announcement sentence. | B accepts the revised announcement sentence; B16 separately asks who selects the incorporation policy. That is an adjacent question, not a recurrence of the original ambiguity. |
| Late bold “Derived results” and analysis/execution consistency | **Recovered.** A15 notices both the apparent new concept and the mismatch between analysis-only prose and the diagram. | B accepts the unified result terminology, while proposing an explicit participant actor for configuration (B10). |
| Recap placement and example nesting | **Recovered through an alternative structure.** A16 labels the recap and nests the view example within section 8, rather than creating section 9. | B accepts the explicit Summary section and leaves section 8's hierarchy intact. Both approaches address the unmarked recap and misplaced example. |
| “Competing sources” for regenerated views | **Recovered as unresolved.** A23 distinguishes several possible meanings and declines to invent one. | B has no corresponding question because the sentence is gone. A's caution was appropriate: the ambiguity should be discussed or removed, not silently converted into a new requirement. |
| Active explanation of Results → Evidence | **Missed in the prose.** A15 clarifies the recap, but retains the passive “until its relevance is established” sentence. | B retains the new participant action and adds “participants” to the graph edge. This extends the same principle to the diagram. |

## The clearest failure: recognizing ambiguity but guessing the repair

A08 correctly calls “target” undefined, then proposes:

> Observing execution reach a location establishes that it was reached under
> those conditions. Failing to observe execution reach a location does not
> establish that reaching it is impossible.

Nothing in the reviewed document establishes that “target” means a location.
The conversation supplied different historical context: before the redesign,
target was similar to what is now a machine state. The reviewer was deliberately
not given that conversation and could not be expected to know the old meaning.
It **could** be expected to flag the uncertainty instead of presenting a guessed
replacement as a meaning-preserving correction.

This directly violates the frozen prompt's instruction not to silently supply a
plausible meaning from domain knowledge or history. The preservation audit then
claims the observation limit has been preserved without recording this assumption.
Finding a bad term and safely repairing it are separate review capabilities.

## Useful findings beyond the manual cleanup

These survived across independent reviews and are worth considering separately:

| Topic | Evidence | Coordinator's assessment |
|---|---|---|
| Direct asset views are absent from the diagram | A15, B10; section 8 expressly allows direct asset presentation. | A well-grounded diagram/prose mismatch. It can be repaired with an appropriately scoped edge or explained as a deliberately narrower diagram. B also adds configuration/claim inputs to views; that is a more expansive presentation choice. |
| Competing interpretations are called “problems” | A13, B08; the purpose and architecture permit uncertainty and disagreement. | Neutral wording such as “matters for review” would fit the intended investigative role more clearly. Competing interpretations can need attention without being errors. |
| “Behavior it reaches” in effects summaries | A05, B04. | Both propose explicit reads/writes performed by reachable code. This is a small, grounded clarification. |
| “Its code” has an ambiguous referent | A10, B06. | Naming code in the associated asset improves the subject/applicability paragraph. B additionally notes that one subject and applicability across several contexts are not alternatives. |
| “Agreed semantics” has an unexplained actor | A14, B09. | Worth discussing, but the proposed “specified behavior” is still dependent on definitions elsewhere. The report should not imply that a participant consensus requirement was definitely intended. |

Both also leave open the required scope of byte provenance after writes
(A17/B11), the status of function designation (A18/B12), which intervention
effects a run records (A19/B13), a binding's source “use” (A21/B14), and the
meaning of “spillover” (A22/B15). Agreement between reviewers makes these useful
questions to inspect; it does not prove that every one requires a new architectural
definition. Some may be settled through ordinary domain wording or a brief example.

Other edits are primarily preferences: changing “manifest” to “purpose document,”
renaming the C64 subsection, or removing every compact recap. These should not be
given the same weight as missing meanings or conflicting requirements.

## What this says about the prompt

The prompt improves the review's focus, but “review every sentence” plus a
whole-section coverage statement did not ensure that every sentence was challenged.
The before report marks section 5 as reviewed and largely clear while missing
several independent problems there. A long report and a preservation audit are
not sufficient evidence of complete editorial scrutiny.

For a future revision, the strongest additions would be:

1. **Make meaning preservation inspectable.** For every replacement of an
   ambiguous term, state what supports the chosen meaning. If two materially
   different readings remain possible, classify the change as a semantic question
   rather than a safe editorial repair. Do not infer meaning solely from familiar
   domain usage.
2. **Require a compact paragraph-level ledger before writing the patch.** Record
   the paragraph's contribution, actors/referents, dependencies on earlier terms,
   and any sentence that merely repeats or illustrates a requirement. This gives
   the reviewer a concrete task beyond declaring an entire section reviewed.
3. **Explicitly test abstract references.** For phrases such as “the state,” “a
   change,” “a check,” or “a result,” identify the concrete referent in context.
   Flag cases where several referents would produce different obligations.
4. **Test examples against observable requirements.** State what a tool or
   participant must do because of the example. If the paragraph leaves that
   action implicit, propose a general requirement or flag the missing decision.
5. **Audit adjacent sentences for repeated assertions.** The review must compare
   their content, not only their individual grammatical clarity. This is how the
   repeated claim statuses and several generic cautions should be caught.

These recommendations are recorded here rather than silently changing the prompt
used for the experiment. A revised prompt would need a new run to establish whether
it actually improves detection or merely produces longer reviews. The suggested
ledger should remain compact and focused on meaning, not become a demand to rewrite
every sentence or define every ordinary word.

## Limits and validation

This was one review per version, using a prompt developed after the manual
cleanup. The explicit retirement rule comes from that conversation. The experiment
therefore tests retrospective recovery under supplied constraints, not whether an
uninformed agent would independently discover every decision. Independent review
variation is visible, and the agents shared a workspace with instruction-based
read restrictions rather than separate filesystem sandboxes.

Validation completed:

- Both proposed patches apply cleanly to their corresponding frozen snapshots
  in temporary directories.
- Input hashes match the recorded metadata; the maintained editorial prompt
  matches the frozen prompt used for both reviews.
- The working architecture still matches the after snapshot.
- The compositional and scenario prompts match the user prompts extracted from
  their existing conversation reports, with repository-relative input paths.
- New evaluation navigation links resolve, and
  `git diff --check` passes.

The comparison evaluates editorial findings and proposed text. It does not
independently verify the linked historical investigations or render the proposed
Mermaid diagrams.
