# Experiment 4: beat the human

One agent, fully informed — the human's `reference.asm` and a project already
seeded with its 102 labels and 16 regions — asked not to reproduce that reading
but to better it.

237 MCP calls, ~55 minutes. It **under-spent** the budget: the brief asked for
400–500 calls and said not to stop early, and it stopped at roughly half.

## Verified independently

Three of its claims were checked against the bytes rather than taken on trust.

**The oracle is a different dump, and mislabelled.** `$8004-$8009` hold
`C3 C2 CD 38 30 00` — `CBM80`, the cartridge autostart signature — where
`reference.asm` lists six zero bytes. Everything from `$800A` matches
byte-for-byte, so it is the same program from a cartridge-to-PRG conversion, and
the code oracle stays valid. But `reference.asm`'s own header says *"the game
'Matrix' … in 1983"*, from `github.com/mwenge/matrix`, while this binary's
banner and copyright line say Gridrunner and `(c) 1982 HES`. The agent's
"different binary" is right; "a different game" would not be.

**A real 1982 bug.** `IncrementPlayerScore` propagates carry with `DEX / BNE`.
`DEX` from 1 sets Z, so the loop exits before touching `$040F`: seven score
digits are displayed, zeroed and compared, and only six can ever be non-zero.
The reference does not remark on it.

**The export was silently frozen.** Confirmed from the server log and the file
times — the `.re64` stopped at 03:22 while the WAL grew until 04:17 — and
reproduced minimally. See CLAUDE.md, *"The export had one writer, and it failed
in silence"*.

Not verified: the other ~12 corrections. They carry evidence in §1 of
`run/report.md`.

## The trigger was in the harness, not the tool

`setup.sh` re-serialized the seed with `JSON.stringify(p, null, 2)`.
`assets/gridrunner/gridrunner.re64` is written one entry per line, and the line editor
could not handle the pretty-printed shape. So the defect is real and was
reachable only because the experiment created a file re64 had never had to read.

The lesson is about experiment design as much as code: **a harness that
reformats its inputs is testing something other than the thing.** It found a
genuine bug, which is luck rather than method.

## Fixed as a result

Everything in the agent's §4 that reproduced, plus the two faults stacked behind
the first. Recorded in CLAUDE.md under *"The export had one writer"*, *"An
operation nothing emits"*, and *"Smaller things experiment 4 found"*.

Two claims did not reproduce — the text decoders' high half, and a duplicated
comment block — and are documented rather than changed.

## Still open

`routine_effects` is sound and useless on four of six main-loop subsystems: all
four reach a routine that resets the stack and jumps into the death path, so the
may-analysis unions the whole program. A design decision, deliberately not
guessed at.

## What to do differently next time

- **Seed from the asset verbatim.** No reformatting in the harness.
- **The budget instruction did not bind.** "Aim for 400–500 calls, do not stop
  early" produced 237. Whatever makes an agent keep going, saying so is not it.
- **Give it a way to read the server's stderr**, or the next silent failure
  costs another quarter of a run. It found this one by reading `dist/`.
