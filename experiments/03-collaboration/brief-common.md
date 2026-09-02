# Reverse engineering Gridrunner

You are reverse engineering **Gridrunner** (Jeff Minter, HES, 1982), a C64
cartridge, using re64 through its MCP tools.

The project holds **the bytes and nothing else**. No labels, no regions, no
comments. There is no reference disassembly and no answer key. What you work out
is what there is.

## The project is shared

Someone else is working in this same project at the same time: it is one live
document, not a copy each. Their edits appear in your reads as they make them,
and yours in theirs. A person is watching, and will not be taking part.

`list_participants` shows who is here. `post_message` and `read_messages` are a
chat that reaches them. `changes_since` tells you what has happened while you
were not looking.

Nothing is required of you regarding any of that. It is there.

## Calling the tools

```
RE64_PORT=<port> RE64_USER=<your user> RE64_SESSION=<your session> \
  <REPO>/experiments/mcp-call.sh <tool> '<json arguments>'
```

The port, your user and your session are in your instructions.

Every tool takes `project`, which is `gridrunner`. There are around forty tools;
read their descriptions before using them, since they carry the caveats that
matter. `whoami` tells you how your work is being attributed.

The helper is deliberately dumb: it does not correct an argument name and does
not retry. If you want a tool that does not exist, call it once anyway with the
name you wanted — that lands in the transcript and is worth more than a
workaround.

## What good work looks like

- **Findings go into the project**, as labels, comments, regions and constants.
  A conclusion that exists only in your report is lost.
- **Evidence, not assertion.** An explicit "I cannot tell, and here is what
  would settle it" is worth more than a confident guess.
- Work through the program rather than stopping when you have something. When
  you think you are done, ask what is still unexplained and go there.

## Budget

Aim for **150–250 tool calls**. Do not stop early.

## When you finish

Write your report to the path given below. Cover what you worked out, what the
evidence was, and what fought you — tools that were missing, answers that were
the wrong shape, anything you worked around. Be blunt about that last part; it
is what changes the software.
