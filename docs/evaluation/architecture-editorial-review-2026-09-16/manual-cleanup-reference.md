# Manual cleanup reference

Recorded by the coordinating agent from the actual local diff and conversation
before reading either editorial review. These are comparison topics, not a list
of findings supplied to the reviewers. A different rewrite can satisfy the same
requirement; matching the user's wording is not the test.

| Topic | Problem in the earlier text | Manual change |
|---|---|---|
| Access trace | “read, wrote, or fetched bytes” leaves instruction fetch implicit and attributes fetching awkwardly to instructions. | Name instruction fetches, data reads and writes; identify the storage or device each access reached. |
| Runtime observations | Undefined “target”; a general statement about observation adds little architectural direction. | Link observations to their run and conditions. |
| Claims and knowledge | Adjacent sentences repeat tentative/disputed status. | Consolidate the knowledge relationship and statuses. |
| Claim retirement | “Withdrawn” can imply author ownership and leaves its relationship to current knowledge unclear. | Any participant can retire a claim; keep its history. This relies on a constraint supplied in the prompt. |
| Bindings | A particular arrangement of arrays and picture/file identifiers carries general requirements. | State relationships across arrays and tables and references resolved through program-specific rules. |
| Retained results | Paragraph separation weakens the connection between produced results and retention. | Merge the paragraphs. |
| Historical context | “A later edit” and “an earlier check” have unclear referents; historical immutability alone is a truism. | Preserve the recorded material, definitions and assumptions despite later changes. |
| Changes and dependencies | “Corrections improve the working interpretation” assumes improvement and a singular interpretation; generic dependency disclaimer adds little. | Introduce changes and their effects, expose known dependents, omit the disclaimer. |
| Coverage | Examples of annotation without understanding leave the reporting requirement implicit. | Explicitly distinguish decoding/annotation from understanding and expose the gaps. |
| Collaboration | Announcement sentence does not identify whose examined state is affected. | Specify the project state other participants are examining. |
| Result terminology | Bold “Derived results” in a late section resembles a new concept. | Use ordinary result terminology and include analysis and execution in the recap. |
| Document organization | Conceptual synthesis sits inside Views; the view example is a peer of major sections. | Add a Summary section and nest the example under Views. |
| Regenerated views | “Competing sources” has no clear meaning or requirement. | Remove it; preserve the existing interface consistency requirement. |
| Results as evidence | Passive relevance condition weakly explains the diagram's Results → Evidence relationship. | Name participants and their explanation of how results support or challenge a claim. |

Line wrapping and the document title also changed; those are not substantive
semantic review targets.
