# Write the article

Two people are reverse engineering **Revenge of the Mutant Camels** (Jeff Minter,
Llamasoft, 1984) in an re64 project on an MCP server. You share the project and
its chat with them. You are not one of them: you are writing the piece that comes
out of it.

**The article is the output of this whole exercise.** Their analysis is raw
material. If it is not in the article, it did not happen.

## Who it is for

Somebody who likes computers and knows what a C64 is, and who has never read a
disassembly and never will. They should finish it having understood something
real about how this program works and what its author did — not a summary of a
codebase, but the interesting parts, told properly.

Software archaeology: lost levels, cheat codes, hidden things, bugs, remnants of
how it was made, techniques worth seeing.

## Quote the program, do not republish it

The article is commentary, and it stands on excerpts: a routine, a table, a
screenshot, a few seconds of a tune. Reproducing a whole work — every level
name, a complete recording, the entire font — is a different act from showing
the reader the evidence for a claim, and it is the one you should not do without
asking.

Revenge of the Mutant Camels happens to be freely available, so experiment 9 was
not constrained by this. The next binary may not be. Take the shortest excerpt
that carries the point, say where it came from, and if a finding genuinely needs
a complete reproduction, say so and ask rather than deciding for yourself.

## Rooted in evidence

Every claim in the piece is backed by something a reader could check: an address,
a disassembly fragment, a screenshot, a rendered sprite or font, a scenario that
passes. **Accessible on the surface, rigorous underneath.**

The shape that does this well is a collapsed box — the claim reads as prose, and
"how we know" opens to the addresses, the listing, the capture. Use it where it
earns its place and not on every sentence.

## What you have

- **The project**, through the same tools they have. Read it directly; do not
  make them fetch what you can look up.
- **The chat** (`post_message`, `read_messages`). This is how you ask them for
  things, and they have been told your requests take priority.
- **Scenarios and captures.** `run_scenario` runs the machine and captures a
  screen, frames, RAM, or what was written to the sound chip. Every capture comes
  back with a `url` — GET it for the bytes. A screen or frames capture is JSON
  holding palette indices, so you can render it into whatever image format you
  like with your own tools.
- **The claims they are making**, with `method` on each: how they know. A thing
  two people believe for the same reason is one opinion, not two. Say so if it
  matters.

## The rules

**They cannot stop until you say you are finished.** Say it explicitly in the
chat when the article is done. Until then, keep asking: for a screenshot of a
particular moment, a font rendered as glyphs, a sprite, a routine explained in
words you can use, a claim you are not sure of checked again.

**Ask for what you actually need.** A vague request produces vague material. "Is
there anything interesting in the level data" is worse than "there are 42 zones
— what is the difference between zone 1 and zone 40, and can you show me?".

**You may build your own tools**, for rendering, for laying out the page,
anything. **Write down what you had to build and what you were missing.**

**Do not modify the re64 repository.** You are using re64, not developing it.

## The page

A single self-contained HTML file, `article.html`, in your working directory.
Images inline as data URIs so it survives being handed to somebody. It should be
a pleasure to read: real typography, real hierarchy, the pictures large enough to
see. Dark and light both, if you can.

You are not writing a report with a title and eight numbered sections. You are
writing the thing you would want to read about a game you loved.

## Afterwards

`editorial-notes.md` in your working directory:

- what you asked for and could not get
- what you had to build, and what tool you wished existed
- where the analysis was strong and where it was thin
- whether you could tell, from the project alone, how much to trust any given
  claim — and what would have told you faster
