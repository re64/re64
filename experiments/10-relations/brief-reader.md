# Read Revenge of the Mutant Camels, and write down what it is made of

You are one of two readers sharing one live document. A person is watching.

The program is already past its decruncher. The project has two targets: `loader`
is the file as the disk loads it, and **`runtime` is the program that runs** —
pass `target: "runtime"` for everything unless you mean the packed file. Nothing
in it has been named. 47,390 bytes, `$0801`–`$C11E`.

## What this stage is for

**Coverage and structure. Not prose.** Somebody else writes the article, later,
out of what you leave behind — so the measure of this stage is what the *project*
holds when you stop, not what your report says. A finding that lives only in your
own notes did not happen.

Two things, in this order:

1. **Explain the bytes.** `find_undecoded` is the queue: spans nothing has said
   anything about. Name routines, declare what data is, decode text, mark roots
   so code decodes at all.
2. **Say what things are made of.** A 200-byte record explained as "data" is
   covered and not understood. If a span has a shape — records, a table, fields
   at fixed offsets, a header — declare the shape.

## The part this run is really watching

Programs are full of **one thing referring to another**. A field whose value
selects a creature. A byte whose bits pick out members of a set. A table indexed
by a variable somewhere else. A number that is not a number but a name for
something in another table.

When you establish one of those, **try to record it in the project so the next
person can follow it without re-deriving it.**

If you can, say how you did it. If you cannot — and you may well not be able to —
then say what you did **instead**: a comment, a name that hints at it, a script
you re-ran each time you needed the answer, a paragraph in your findings. Those
workarounds are the most valuable thing this run can produce, and they are worth
more than an opinion about what is missing. So record them as they happen, not
from memory afterwards.

A specific instruction, because it is easy to skip: **any time you compute
something by hand more than twice, write down what it was.** Three conversions of
the same kind is a finding.

## The tools

There are 87. List them; several are new and none of them are what you remember.
Worth understanding early: `describe_project`, `find_undecoded`, `find_unnamed`,
`read_disassembly`, `read_bytes`, `add_claim`, `claims_at`, `add_type`,
`add_constant`, `bind_constants`, `render`, `where`, `add_scenario`,
`run_scenario`, `play_sid`, `add_evidence`.

`render` draws a span without touching the document — point it at an address and
a layout and look. Addresses also accept places: `screen(10,2)`, `sprite($9D)`.

Call them like this, from the repository root:

    RE64_PORT=5193 RE64_USER=<one|two> RE64_SESSION=<one|two> \
      experiments/mcp-call.sh <tool> '<json>'

The wrapper is deliberately dumb: it does not check that a tool exists or correct
an argument. Calling one that is not there is useful signal — send it.

## Rules

- **Do not read anything else in this repository.** Not `docs/`, not
  `experiments/`, not `assets/mutant-camels/*.md`, not the source. Earlier runs
  on this program left notes, and a previous experiment found them in ninety
  seconds and spent the rest of its time confirming somebody else's conclusions.
  Work from the bytes. If you already know something about this game, say so in
  your findings rather than pretending otherwise.
- **Do not modify any source code.** You are using re64, not developing it.
- You may write your own scripts in your working directory. Say what you built
  and why.

## Working together

The only channel is the project's chat — `read_messages` and `post_message`.
Read it often. Say what you are taking so you do not both do it. There is no
lease and no assignment; sort it out between you.

## When you stop

Write `findings.md` in your working directory:

- what the program is made of, in your own words
- **what you could not record in the project, and what you did instead** — the
  workaround list, with the number of times you did each thing by hand
- what you built for yourself
- what you would want that does not exist, and what you tried before wanting it
