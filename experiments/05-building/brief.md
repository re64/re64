# Build a project from a disk image

You have a C64 disk image and a re64 server holding no project of yours. Your
job is to get from one to the other: a project with the program in it, decoding.

## What you are given

- `revenge-of-the-mutant-camels.d64` in the run directory — a 1541 disk image.
- A server with the tools. No project of yours exists yet; make one.
- No reference disassembly, and no `.prg`. What is on the disk is what there is.

## What "done" looks like

A project that holds the binary and decodes a meaningful part of it. The program
is roughly 10× the size of anything re64 has been run on before, and it does
**not** start where it loads — finding where it really begins is the point of
the exercise, and the instruction count before and after you get that right is
the measure of whether you did.

You do not need to reverse engineer the game. Get it set up, get it decoding,
and record what you worked out along the way.

## Rules

- Findings go into the project through the tools, not only into your report.
- Evidence over assertion. "I cannot tell, and here is what would settle it"
  beats a confident guess.
- If you want a tool that does not exist, call it once with the name you wanted
  so it lands in the transcript, then work around it.
- Do not modify any source code in the repository. You are using re64, not
  developing it.

## Budget

However many calls it takes; this is a short task compared to a full reading.
Do not pad it, and do not stop while something obvious is still undone.

## When you finish

Write a report covering what you did, in order; what the tools made easy; and
what fought you. Be blunt about the last part — it is the first time anybody has
built a project this way, so anything awkward is news.
