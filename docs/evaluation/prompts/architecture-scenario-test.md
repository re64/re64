Read docs/01-purpose.md and docs/02-architecture.md. You may use docs/01-purpose.md to understand re64’s goals and intended use, but treat docs/02-architecture.md as the architecture under test. Do not read any other documentation, source code, tests, experiment reports, issues, or repository history. If docs/02-architecture.md depends on information that exists elsewhere, report that dependency rather than looking it up.

Pressure-test docs/02-architecture.md as written. Do not redesign it and do not resolve decisions deliberately deferred to the design register.

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
7. Would an implementation have to make a consequential semantic decision that docs/02-architecture.md appears to have decided accidentally?

Classify each case as clean, awkward but sufficient, underspecified, or contradictory.

Be especially adversarial about knowledge applicability across multiple Machine states or Assets, Asset association, Machine state versus configuration, platform behavior and platform knowledge, Claims versus configuration, relationships/bindings, Evidence, and View resolution.

In particular, do not invent Program, Target, Domain, Layer, or another grouping concept to solve shared knowledge. If the architecture cannot express the requirement without one, state precisely what semantic capability is missing. Likewise, do not assume that such a concept is needed merely because it would make a case convenient.

Do not treat missing storage, synchronization, or API details as architectural defects when the document deliberately delegates them to the design register. Report a problem only where the missing detail changes or leaves ambiguous the semantics.

Finish with:

* the smallest set of clarifications docs/02-architecture.md needs before design work proceeds;
* concepts and boundaries that survived the pressure tests cleanly;
* unresolved questions that should remain in the design register.

Do not propose a replacement architecture or implementation plan.
