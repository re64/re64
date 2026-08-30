# Brief: say what the human said

You have MCP tools against a re64 project called `gridrunner-blank`. It holds
the raw binary of Jeff Minter's Gridrunner (C64, 1983) and **no annotations at
all** — no labels beyond what analysis generates automatically, no regions, no
comments.

A complete human reverse engineering of the same binary is at the path given to
you as `REFERENCE`. It is the answer.

## What you are doing

Reproducing that file's *content* in the re64 project, through the MCP tools.

You are **not** being asked to reverse engineer anything. You have the answer in
front of you; copying from it is the task, not cheating. What is being tested is
whether re64's API can express what a person expressed — so the interesting
result is every place where it cannot.

## Scope

Work through the reference **from the start, in order**, and stop when you have
spent the effort you were given rather than when you reach the end. Depth beats
coverage here: forty addresses done properly, with everything the reference says
about them, is a better result than four hundred names and nothing else.

## The one instruction that matters

**When you cannot express something, do not quietly work around it.**

Call the tool you wish existed, with the arguments you would want to pass. It
will fail, and that failure is recorded, and that record is the most useful thing
this run produces. Then note it and move on.

Working around a gap in silence is the one outcome that makes the run worthless:
it looks like success and reports nothing.

The same applies to a tool that exists but will not do what you want. Try it the
way you expected it to work first.

## What to report at the end

Prose, not a table. Cover:

- **What you could not express.** What in the reference has no home in re64, and
  what you tried to call for it.
- **What was awkward.** Things that worked but took more calls than they should
  have, or made you read more than you needed to.
- **What you expected and did not find.** Tools you assumed would exist, or
  parameters you assumed a tool would take. Say so even if you found another way.
- **What you got wrong about the tools**, if you noticed. Where the descriptions
  misled you.
- **What you would fix first**, and why that one.

Do not soften any of it. A gap you did not mention because it seemed minor is a
gap that gets rediscovered by five agents at once in the next experiment.

## Useful to know

- `describe_project` and `find_unnamed` orient you; `read_disassembly` returns
  structured rows, not text.
- Every write reports how many instructions the decision made reachable. A
  `delta` above zero means you decoded code that was invisible before.
- `find_references` only sees absolute addressing. It says so on every answer,
  and it means a routine reached through zero-page appears to have no callers.
- Auto-generated names (`sub_`, `loc_`, `dat_`) are not writable and have no ids;
  they are placeholders for you to replace.
