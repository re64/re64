# Architecture editorial review

Review `docs/02-architecture.md` for semantic clarity and editorial coherence.
Read `docs/01-purpose.md` for context. When a run supplies snapshots, use those
instead of the working files. Assume the reader knows software engineering but
has no knowledge of previous re64 architectures or experiments. Read only the
architecture, purpose document, and these instructions; report dependencies on
other material rather than looking them up.

Inspect the entire document sentence by sentence, then review its organization.
Do not stop after identifying a few representative problems. Do not silently
repair ambiguous text in your head and then approve that repaired interpretation.

## Review criteria

### 1. Meaning and terminology

Can the reader identify the actor, action, object, and relevant context? Are
technical terms established and used consistently? Flag undefined terms,
ambiguous referents, and unexplained changes of vocabulary. Do not silently
supply a plausible meaning from domain knowledge or history. Do not require
formal definitions for ordinary words unless their meaning affects the
architecture.

### 2. Architectural contribution

What concept, relationship, observable behavior, or necessary explanation does
each sentence add? Identify repetition, generic cautions, and statements that
are true but impose no meaningful requirement. Delete or consolidate them where
appropriate. Preserve qualifications that materially constrain behavior.

### 3. Abstraction and examples

Where a specific example carries a general requirement, state the requirement
explicitly. Keep useful concrete vocabulary and examples; do not replace them
with vague abstractions or introduce implementation details.

### 4. Implications

Check whether wording accidentally implies ownership, consensus, certainty,
automatic behavior, or restrictions that the document does not establish.
Distinguish editorial repairs from decisions about system behavior.

### 5. Structure

Check introduction order, paragraph transitions, heading levels, bold terms,
summaries, and diagrams. A recap should look like a recap. Ensure diagrams and
prose express compatible relationships.

### 6. Readability

Prefer explicit actors and concrete verbs where they clarify responsibility.
Split overloaded sentences and connect related ones. Do not optimize for brevity
at the expense of meaning or create new ambiguities while simplifying.

## re64 constraints to preserve

These constraints guide the review; the architecture should establish them for
its readers rather than relying on this prompt as their only source.

- Participants collaboratively edit claims; retiring a claim is not reserved
  for its original author. Use “retired,” and preserve the investigation history.
- Describe participant-visible behavior without assuming a storage or
  synchronization implementation.
- Preserve the distinction between choices, claims, results, and evidence.
- Preserve existing architectural commitments and deliberately deferred decisions.

## Deliverables

Produce a proposed unified patch covering the whole document, without modifying
the architecture. For each substantive change, briefly explain the original
problem and how the replacement preserves the intended requirement. Include
source line references. List unresolved semantic questions separately rather
than inventing answers. Identify sections reviewed without proposed changes so
the scope of the review is visible.

Finally, reread the proposed document as a whole. Check that every removed
requirement is either preserved elsewhere or explicitly identified as a proposed
semantic change. Report any new repetition, inconsistency, or ambiguity. If the
run specifies report and patch paths, write these deliverables there; this does
not authorize editing the architecture itself.
