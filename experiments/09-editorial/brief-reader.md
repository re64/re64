# Read Revenge of the Mutant Camels

You have an re64 project on an MCP server. It holds **Revenge of the Mutant
Camels** (Jeff Minter, Llamasoft, 1984) for the Commodore 64, prepared to the
point where there is something to read:

- target **`loader`** — the file as the disk loads it, still packed
- target **`runtime`** — the image the loader expands into, which is the program
  that actually runs. Start here.

Somebody else has the same project open, at the same time, with the same brief.
You share the document and you share its chat. There is no other contact.

A third person — **the editor** — is writing an article about this program for
people who will never read a disassembly. They are reading your work as you do
it, and they will ask you for things.

## What to look for

Whatever is *interesting about this program*, in the sense a reader would use
that word:

- easter eggs, and anything hidden
- bugs, and things that only work by accident
- programming techniques worth seeing — the tricks, the shortcuts, the places
  somebody was clever or desperate
- remnants of how it was made: dead code, debug leftovers, abandoned features,
  names, dates, the author's own fingerprints
- what the graphics and the sound actually are

Ordinary structure matters too — you cannot find the interesting parts of a
program you have not read — but structure is not the deliverable.

## How to record it

**In the project, not in a file.** A claim is how you say what an address is;
`add_claim` takes `method`, which says *how you know*: `guessed`, `transcribed`,
`read`, `derived`, `ran`. Fill it in honestly. Two people agreeing is only worth
something if they got there different ways.

`add_evidence` says something about a claim rather than about an address —
`supports`, `refutes`, `supersedes`. A claim backed by a scenario re-verifies:
somebody can run it and see it pass rather than take your word.

## The rules

**You may not stop before the editor says they are finished.** If you think you
are done, say so in the chat and ask what they still need. Keep working until
they release you.

**Answer the editor.** They will ask for evidence, for clarification, for
material — a screenshot of a particular moment, a font rendered, a sprite, a
routine explained in plain words. Those requests take priority over whatever you
were doing.

**You may build your own tools.** Scripts, decoders, anything. But **write down
what you had to build and what you were missing** — that list is worth more to
the people who maintain re64 than the analysis is, and it only exists if you keep
it as you go.

**Do not modify the re64 repository.** You are using re64, not developing it.

## When it is over

The editor will say so. Then write `findings.md` in your working directory:

- what you found, and how you know
- **what you had to build for yourself, and what tool you wished existed** —
  name it, even if you only wanted it for a minute
- what was awkward, mechanically rather than socially
- where you and the other reader disagreed, if you did, and what happened
