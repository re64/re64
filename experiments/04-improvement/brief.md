# Beat the human

You are reverse engineering **Gridrunner** (Jeff Minter, HES, 1982), a C64
cartridge, using re64 through its MCP tools.

You are not starting cold and you are not being asked to reproduce anything.

- `PROJECT` — `gridrunner-improved`, already seeded with a human reverse
  engineer's work: 102 labels and 16 regions.
- `REFERENCE` — `reference.asm`, that same person's full 65KB commented
  disassembly, with roughly 334 labels. Read it.

**The task is to produce a better disassembly than the reference.** The
reference is the subject, not the answer key. Where you disagree with it, you
are probably right — but you have to show it.

## What "better" means

In rough order of value:

1. **Correct what the human got wrong.** Misread instructions, mislabelled
   data, a routine whose name describes the wrong thing, an address named for
   one purpose and used for another, dead code presented as live. A 1982 game
   also contains real bugs and leftover development code; saying so is a
   finding, not a complaint.
2. **Represent what the human's format could not.** A flat listing has one
   reading per byte. Where bytes decode two ways, both readings are real and
   re64 can hold both — find those and record them correctly.
3. **Explain the data.** Graphics, character data, tables. The listing shows
   bytes; say what they *are*, and where a format is involved, render it. re64
   can run a decoder you write and draw the result, and can declare a region so
   the listing shows it. If you can put a recognisable picture in front of the
   reader, do it.
4. **Name values, not just addresses.** The same number means different things
   in different places; the reference itself gives one value two names.
5. **Comment.** The seeded project has *zero* comments and the reference has
   hundreds. Everything you conclude should end up attached to an address in
   the project, not only in your report. A conclusion that lives only in your
   final message is lost.
6. **Say what a routine does**, including how it leaves and what it touches —
   its own code and its callees'.

## Rules

- **Evidence, not assertion.** Every disagreement with the reference needs a
  reason someone can check: an instruction, a cross-reference, a hardware write,
  a value the machine computes. "This looks like X" is not a finding.
- **An explicit gap beats a confident wrong answer.** If you cannot tell, say
  you cannot tell, and say what would settle it. You will be judged more harshly
  for one confident error than for ten honest unknowns.
- **The project is the deliverable.** Labels, comments, regions, constants and
  decoders go *into* the project through the tools.
- **Do not edit `reference.asm`.** It is evidence.

## Budget

Large — about three times a normal run. Aim for **400–500 tool calls** and do not
stop early because you have "enough". Previous runs stopped while there was still
program left. Work through the binary systematically; when you think you are
done, ask what is still unexplained and go there.

## Calling the tools

```
RE64_PORT=5166 RE64_USER=improver RE64_SESSION=improver \
  <REPO>/experiments/mcp-call.sh <tool> '<json arguments>'
```

Start with `tools/list` if you want the vocabulary; otherwise
`describe_project '{"project":"gridrunner-improved"}'` orients you. Every tool
takes `project`. The helper is deliberately dumb: it does not correct an
argument name or retry, and a call to a tool that does not exist is a useful
signal — make it rather than working around it.

## When you finish

Write `report.md` in the run directory covering:

- **What you corrected**, with the evidence, as a list. This is the main output.
- **What you added** that the reference has no way to express.
- **What fought you** — tools that were missing, answers that were wrong or
  unhelpfully shaped, anything you had to work around, and any tool you wished
  existed and had to invent a name for. Be specific and blunt; this is the part
  that changes the software.
- **What you could not settle**, and what would settle it.
