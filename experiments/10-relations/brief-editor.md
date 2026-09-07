# Write the article, from a project somebody else annotated

Two readers have spent a session on Revenge of the Mutant Camels and stopped.
What they found is in the document. Your job is to turn it into something a
person would read.

Pass `target: "runtime"` for everything unless you mean the packed loader.

## The article

A blog-length piece for somebody who likes games and computers and has never
written a line of 6502. Interesting first, complete second. Screenshots, sprites,
fonts, sounds — the things that make a program a *game* rather than a listing.
Collapsible boxes for the evidence, so a curious reader can open one and a
skimming reader is not stopped by it.

`article.html`, self-contained, in your working directory. It is the output of
this run; everything else is working material.

## Rooted in evidence

Every claim in the piece is either something you can point at in the project, or
something you **ran**. `run_scenario` drives a real C64: captures come back as
`screen`, `frames`, `ram`, `sid`. `render` draws any span as a PNG. `play_sid`
turns a captured sound-chip log into a recording. Use them — a photograph beats
a description, and this tool can take photographs.

Where something is inferred rather than shown, say so in the piece. A "how firm
this is" box is more interesting than false confidence, and this project would
rather print a gap than a confident wrong answer.

## The thing to notice, and to report on

**You are reading somebody else's annotations, not making your own.** So you are
the first person in a position to answer a question the readers cannot:

> Could you tell, from the project alone, what they had found — including the
> parts that are about how one thing *relates* to another rather than about a
> single address?

Where the project told you plainly, say which mechanism carried it. Where you had
to go back to the bytes and work it out again, say that too, and say what you
were looking at when you gave up on the document. **That second list is the
finding.** It is not a criticism of the readers; it is a measurement of what a
document can hold.

You may ask the readers for nothing — they have stopped. If something is
missing, that is data.

## Quote the program, do not republish it

The article stands on excerpts: a routine, a table, a screenshot, a few seconds
of a tune. Reproducing a whole work — every level name, a complete recording, the
entire font — is a different act, and one to ask about rather than assume. Take
the shortest excerpt that carries the point and say where it came from.

## Rules

- **Do not read anything else in this repository.** Not `docs/`, not
  `experiments/`, not `assets/mutant-camels/*.md`, not the source. Earlier runs
  left notes; work from the project and the machine.
- **Do not modify any source code.** You are using re64, not developing it.
- You may build your own tools in your working directory. Report what you built
  and what you were missing.

## The tools

87 of them; list them first. Call them from the repository root:

    RE64_PORT=5193 RE64_USER=ed RE64_SESSION=ed \
      experiments/mcp-call.sh <tool> '<json>'

## Also write `editorial-notes.md`

- what the project told you, and through which mechanism
- what you had to re-derive, and where you were when you gave up on the document
- what you asked for and could not get
- what you built, and what tool you wished existed
- whether the annotations were enough to write from, and what would have made
  them enough
