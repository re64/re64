# Knowledge design

The [architecture](02-architecture.md) requires reusable interpretations,
assertions with identifiable applicability, and evidence whose meaning survives
later work. The mechanisms in these notes are candidates unless stated
otherwise. This document does not choose a Domain entity, require program
inclusion, or settle type immutability.

## Applicability and reusable knowledge

The knowledge model must distinguish an assertion's subject, its association
with material, its coordinates, and the conditions under which it applies.
An asset-relative coordinate follows placement; an absolute coordinate stays
fixed in its stated address space. Association with an asset does not require
the subject to fall within that asset's bytes.

Reusable knowledge takes several forms:

- An interpretation of particular material follows that material into another
  placement.
- A type or format supplies one definition used by many instances.
- Knowledge of conventions or behavior can apply across a broader context,
  rather than only to one object or variable.
- Separate assertions can happen to agree without sharing identity, meaning,
  or future edits.

These capabilities do not require one universal reuse mechanism. Candidate
carriers include asset-associated knowledge, a non-material asset describing
an address space, applicability conditions, or a named knowledge scope. Program
organization may help people navigate the investigation without determining all
knowledge applicability. Evaluate those responsibilities separately in
[#51](https://github.com/re64/re64/issues/51).

Availability is not verification. A one-bit patch can change behavior involving
unchanged code, so checking only the bytes immediately described by a claim
cannot establish its continued validity. Some dependencies can be checked;
others require explicit assumptions or renewed investigation.

## Program inclusion and platform packaging: proposal

One proposal lets a program include another program's assets and knowledge as
a read-only dependency. An inclusion selects a revision and contributes its own
material, without recursively importing further dependencies. Contributions
form a resolved view with their origins retained. Updating selects another
revision; internalizing copies included material into local editable material,
independent of subsequent dependency updates.

The proposed main application is a supplied C64 platform program containing
standard assets, symbols, and ROM effects. Hash-identified revisions retained
by re64 would let projects opt into platform-data updates. Analyzer and emulator
versions would remain separate from the data revision. A changed program could
also include material from another version, but ordinary assets and images may
already serve that case adequately.

This proposal needs comparison with a dedicated platform facility and narrower
knowledge reuse. The requirement to express platform knowledge using the same
facilities as investigated software does not by itself require general program
inclusion. Conversely, choosing a special facility does not resolve the question
of what a platform-data update means for an existing investigation.

Knowledge may describe unavailable ROM bytes. Copying or inspecting those bytes
requires obtaining them; this does not mean editing knowledge about a ROM must
require its contents. Inclusion, copying, update policy, and presentation rules
need separate contracts if this proposal is selected.

## Shared definitions and changes

Types are declarations of an interpretation; claims apply them to material.
Changing a field's meaning can change every application, even if the applications
themselves are untouched. Earlier checks must remain understandable as checks
of the definitions and inputs actually examined.

Two candidate designs are evolving definitions with retained historical context,
and immutable revisions with explicit adoption. A use might follow the current
definition or designate a particular revision. No choice has been made between
these approaches; see [#69](https://github.com/re64/re64/issues/69) and
[#33](https://github.com/re64/re64/issues/33).

Regardless of representation, the tools should enumerate affected uses and
support collective application and verification. An agent can inspect many
sites or run a script; a person can review their extent and update them together.
A bounds check establishes different things from evidence for a field's meaning.
One general justification can support many uses, without pretending each was
independently verified.

## Relationships, bindings, and generated knowledge

Shared indices and mappings must be followable: several arrays can describe one
monster, whose picture index selects another asset. Candidate representations
include reference-bearing types, index declarations, derived mappings, and
relationship claims. Decide how corrections propagate and how ambiguous uses
are reported before choosing the representation. See
[#52](https://github.com/re64/re64/issues/52) and
[#54](https://github.com/re64/re64/issues/54).

Bindings connect particular uses to locations, labels, constants, types,
records, or fields. Inference from addresses and typed regions can supply them;
participants can also specify them. The coordinate inventory
[#31](https://github.com/re64/re64/issues/31) must cover relocation, overlapping
material, explicit choices, and competing inferred interpretations consistently.

A display preference can shadow a label without invalidating its assertion.
Likewise, a spillover claim can guide a listing without removing bytes from
machine analysis. The classification can be supported by an ordinary retained
query; no special detector or immutable classification is required.

Custom tools may compute references or propose claims. The design must
distinguish such outputs from accepted project edits, preserve their sources,
and avoid storing independent copies of facts already derived from bytes.
Results retained as evidence identify their producing tool, inputs, parameters,
and relevant definitions; see [#68](https://github.com/re64/re64/issues/68).

Findings and evidence need concrete anchors and discoverable dependencies.
Stored edges and derived dependency information are candidates, not a commitment
to a general graph or automatic semantic invalidation. Open questions must be
queryable with their subjects; their representation can build on findings or
other records if that suffices. See [#63](https://github.com/re64/re64/issues/63)
and [#56](https://github.com/re64/re64/issues/56).
