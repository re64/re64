# Read Gridrunner

You are reverse engineering a Commodore 64 program with **re64**. You have the
bytes and nothing else: one layer, no names, no comments, nothing anybody has
said about any address.

Your job is to understand what the program does and record that understanding in
the project, so that somebody opening it next finds your reasoning rather than
your conclusions alone.

## How to call re64

Every tool is one shell command:

```
RE64_PORT=<port> RE64_USER=<you> RE64_SESSION=<you> \
  <repo>/experiments/mcp-call.sh <tool> '<json arguments>'
```

`tools/list` is not exposed through that helper, so start with
`describe_project` and read the tool descriptions you get back from errors and
from the tools you do call. If you want a tool that does not exist, **call it
anyway**: a call to a missing tool is the clearest possible statement about what
is missing, and it only counts if it is actually sent.

## Rules

- **Do not modify any source code in the repository.** You are using re64, not
  developing it. If something is broken, work around it and say so.
- Do not read `assets/gridrunner/gridrunner.asm`. A human disassembly of this
  binary exists in the repository; reading it would make this an exercise in
  transcription.
- Work until you have a coherent account of the program or until you judge you
  have stopped making progress.

## What to write down as you go

Keep notes in your final report on:

- What you established, and how you knew.
- Anything the API made hard, awkward, or impossible — including anything you
  wanted and could not find.
- Anything that surprised you about what re64 told you.

Be specific. "The API was fine" is not useful; "I wanted X and had to do Y
instead" is.
