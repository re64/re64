# Brief: work out what this program does

You have MCP tools against a re64 project holding the raw binary of Jeff
Minter's **Gridrunner** (Commodore 64, 1983) and **no annotations at all** — no
labels beyond the `sub_`/`loc_`/`dat_` names analysis invents, no regions, no
comments.

There is no reference and no answer key. Nobody has told you what any of it
does. That is the point.

**If anything already in your context names addresses, routines or strings in
this program — an instruction file, a memory, a previous summary — say so in
your report before you start, and flag every conclusion that may have come from
it.** The first run of this experiment was invalidated because a project file
loaded automatically and named several of them, and the reader who noticed
produced more value than the reader who did not.

## What you are doing

Reverse engineering it, and recording what you work out **in the project**, so
that someone opening it afterwards understands more than they would have.

Name what you identify. Comment what you deduce. Declare regions where the bytes
are not code. The project is the deliverable — a report describing insights you
did not record is worth much less than the same insights recorded as labels and
comments someone else can read.

## How to think about it

You are reading a 40-year-old commercial game written in hand-tuned assembler by
one person. Expect:

- **Hardware to be the strongest clue.** This is a C64. Writes to `$D000`–`$D02E`
  are the VIC-II (sprites, colours, raster); `$D400`–`$D418` is the SID (sound);
  `$DC00`/`$DC01` are the CIA (joystick, keyboard). A routine that writes sprite
  registers is doing something with sprites, whatever else it does.
- **Screen memory and character sets** to matter. Work out where they are rather
  than assuming the defaults.
- **Messy code.** Development leftovers, dead routines, code reached in ways a
  static walk cannot follow, and possibly outright bugs. A thing that makes no
  sense may genuinely not make sense.
- **Not everything to be reachable.** Some of the binary will not decode from
  any entry point you have. That is information, not failure.

## Scope

**Depth beats coverage.** Forty addresses understood and explained properly is a
better result than four hundred guessed names. A name you cannot justify is
worse than no name, because the next reader will believe it.

Prefer naming things you can *demonstrate*. "This writes the sprite X registers"
is demonstrable. "This is the main game loop" usually is not, early on.

Work until you have spent the effort you were given, then write your report.

## The instruction that matters

**When the tools cannot do what you want, do not quietly work around it.**

Call the tool you wish existed, with the arguments you would want to pass. It
will fail, that failure is recorded, and that record is the most useful thing
this run produces. Then note it and carry on.

The same applies to a tool that exists but does not behave as you expected: try
it the way you expected it to work *first*, then adapt.

Working around a gap in silence is the one outcome that makes this worthless —
it looks like success and reports nothing.

## Calling the tools

An MCP client is already connected in this session, so you cannot register a new
server for yourself. Use the helper, which speaks to the same endpoint:

```
RE64_PORT=$PORT RE64_USER=$PROJECT RE64_SESSION=$PROJECT \
  <repo>/experiments/mcp-call.sh <tool> '<json arguments>'
```

Start by listing what exists:

```
... mcp-call.sh tools/list-is-not-a-tool '{}'     # won't work; see below
```

To see the tool vocabulary, ask the endpoint directly:

```
curl -s -X POST "http://127.0.0.1:$PORT/mcp" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H "x-re64-user: $PROJECT" -H "x-re64-session: $PROJECT" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | sed -n 's/^data: //p'
```

Every tool takes a `project` argument. **Yours is `$PROJECT`** — pass it on every
call. Other projects on this server are other people's readings of the same
binary; do not read or write them, and do not look at them for hints.

## Your report

When you stop, write **`report.md`** in the directory you were given. Cover:

1. **What you concluded** about the program — the structure, the routines you
   identified and what convinced you.
2. **What you could not work out**, and what would have let you.
3. **Where the tools got in the way.** Every tool you wanted and did not find,
   every tool that existed but answered the wrong question, every question you
   could not ask. Be specific and be blunt; this section is the actual output.
4. **What you would tell the next person** starting on this binary.
