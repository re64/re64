Read docs/01-purpose.md and docs/02-architecture.md. You may use docs/01-purpose.md to understand re64’s goals and intended use, but treat docs/02-architecture.md as the architecture under test. Do not read any other documentation, source code, tests, experiment reports, issues, or repository history. If docs/02-architecture.md depends on information that exists elsewhere, report that dependency rather than looking it up.

Pressure-test docs/02-architecture.md by checking whether its core concepts form a coherent, compositional model.

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
* the smallest wording clarifications needed in docs/02-architecture.md.

Do not propose implementation, storage, API schemas, or a replacement architecture.
