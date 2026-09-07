# Re64 - an agentic-first, collaborative C64 reverse engineering framework

## Manifest

The C64 era has produced many binary artifacts of handwritten assembler,
using sophisticated programming techniques, such as self-modifying code
and overlapping instructions. Human experts have become very capable of
analysing such binaries, using automated tools as well as domain knowledge.

AI agents are now equally capable of reverse engineering C64 artifacts.
Within minutes, tool-assisted generative LLMs can produce C64 disassemblers
and emulators, performing static and dynamic analysis, and producing high
quality assembler source code with annotations for semantic interpretation.

This project provides a collaborative framework for agents and humans, that
includes:

* a structured model describing a C64 reverse engineering projecct,
* a database to store such documents long-term,
* an API to crate, initialize, update and query such documents,
* a rich, structured language to formulate claims on the interpretation of
  the artifacts,
* static and dynamic analysis tools that can provide evidence
  for such claims,
* the ability to query the coverage of claims and lack of coverage,
* ability to store conflicting claims and report on such conflicts,
* and other tools for collaboration, such as a project-level chat,
* an MCP server to facilitate agent access to the above features,
* a web UI to facilitate human access to the above features.

The goal is to facilitate the collaborative analysis of C64 artifacts.

One application is a blog that publishes insights into software archaeology:
lost levels, cheat codes, relicts from the development process, hidden bugs,
and other interesting observations. This blog is edited from the insights
collected in the reverse engineering project, and enriched by disassembly
output snippets, captured screenshots, fonts rendered from glyphs in the
artifact, etc.

## Project Model, Storage, and API

A project is a Y.js CRDT document and associated metadata (sessions, operation
change log, etc.) backed by a SQLite database:

* Every meaningful entity gets a stable, unique ID when it is created.
* In particular, machine addresses are properties, not identities.
* With the ID, entities can be updated or deleted.

A project includes the ability to define different configurations of the
machine, which mainly consists of an address space configuration. The data
in memory can come from different places, including inline blobs,
imported files, or roms.

A project also includes the necessary metadata for access control, active
sessions, and a live chat.

### Claims and Interpretation

Agents and humans analyze the artifact and discover facts and hypotheses
about it. They can record these insights and share them with others through
claims of different nature. For example, a claim can suggest that a certain
address is the start of a function, or, or that a range of bytes contains
a bitmap image or text glyph.

Each claim is accompanied by what facts are claimed, a possible
interpretation of it, what the evidence for the claim is, who claims it, etc.

The claims serve several purposes:

* They provide coverage of the artifact and resolve open work packages.
* They guide static and dynamic analysis.
* They enrich and structure rendered outputs, for example in the form of
  annotations in a disassembly output, or previewing bitmaps in the web ui.

Possible claims are functions, labels, locations of typed data, comments
(inline, pre- or post), etc.

### Static and Dynamic Analysis

Although agents and humans are capable and permitted to use their own tools
for analysis, re64 provides powerful tools as built-in. This has several
advantages:

* The tools provide support for the structured project data, including claims.
  For example, a dynamic analysis can set a breakpoint at a claimed function,
  or a watchpoint at a claimed variable (i.e,, label pointing at typed data).
* The tools enable agents that can have access to MCP servers but not a shell.
* The tools are also integrated with claim generation. For example, a machine
  trace can be used as evidence.
* The tools can also support rendered output, for example by providing
  captured screenshots (title screen, before/after snapshots, etc).

Static analysis allows to calculate the effects of functions and basic blocks,
derive a call graph, query code for references to addresses, etc.
Abstract interpretation already can identify some invariants, such as registers
preserved across function calls.

Dynamic analysis allows the initialize a virtual machine and execute code up
to a number of cycles, a breakpoint, or watchpoint, etc. Dynamic analysis can
inject keyboard/joystick input or generate interrupts. On the output side,
dynamic analysis can be used to capture screenshots, generate machine traces,
find out about read/written memory ranges, identify memory bank switching, etc.

### Coverage and Collaboration

The framework allows agents and humans to query which address ranges are covered
by claims, and which are uncovered. Uncovered ranges can be used to produce work
units.

The collaboration is facilitated by conflict-free storing of contradicting claims,
together with an analysis of overlapping/conflicting claims. Such warnings can
also be used to produce work units.

A live chat further supports collaboration.

### MCP server

The MCP server provides a higher level interface to the framework. The API
is designed to encourage good practices, such as adding claims rather than
overwriting the claim of others. The APi is also consistent and complete.

The MCP api also features a batch API for grouping edits.

### Web UI

The web UI provides a way for humans to see the data stored in the project
and interact with it. The capabilities of the web UI are on par with the MCP.
The main interaction is a disassembly output, assisted by other view panes
such as a call graph explorer, an emulator, etc.

## Extensibility

Some limited ability to extent the functionality of the framework is already
provided in the form of snippets. Snippets are sandboxed JS code pieces that
allow the interpretation of data regions, and in the future might find other
uses (for example in dynamic analysis to stub out ROM functions or customize
traces).







