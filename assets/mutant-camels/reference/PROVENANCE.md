# Ground truth for Revenge of the Mutant Camels

From <https://github.com/mwenge/revengeofthemutantcamels>, fetched 2026-09-03.

`revengecamels.asm` is the code — 4,820 lines. **The binary in that repository is
byte-identical to `../revenge-of-the-mutant-camels.prg`** (md5
`59838f824c48114e9862947b0fc53b32`), which is worth stating because the Gridrunner
oracle is *not*: `assets/gridrunner/gridrunner.asm` is a different dump with the
cartridge signature zeroed, and its header names a different game.

Not vendored, because they are ~450KB of generated data dumps and the upstream
repository has them: `charset.asm`, `sprites1.asm`, `sprites2.asm`, `padding.asm`.

Load address is `$0801` — a BASIC stub, not a cartridge, so this exercises a
different loading shape from Gridrunner as well as being roughly ten times the
size.
