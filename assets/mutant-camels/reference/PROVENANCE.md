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

## The listing and the binary beside it are two different builds

Established from bytes, and it changes what the oracle is good for.

`revengecamels.asm` documents **Jeff Minter's May 2021 collision fix** — it
carries the `$C000` block, attributes it to him by name and date, and quotes his
own account of it off a Discord channel. Its text at `$9AB3` is `LDA #$FF`.

`revenge-of-the-mutant-camels.prg` — the binary in the same repository, md5
`59838f824c48114e9862947b0fc53b32` — has `LDA $44` there, has no `$C000` block at
all, and stops at `$A002`. It is the **1984** build.

So the listing does not assemble to the binary shipped with it. It is a hybrid:
the 1984 build's `SYS 34800` stub and launch code, with the 2021 patch merged
into the body.

Both builds are here, which is the useful part:

| | `revenge-of-the-mutant-camels.prg` | `revenge-of-the-mutant-camels.d64` |
|---|---|---|
| build | 1984 | May 2021 |
| reaches | `$A002` | `$C11E` |
| `$9AB3` | `LDA $44` | `LDA #$FF` |
| on disk as | a plain `.prg` | `revenge fixed`, crunched |

They differ by **36 bytes** above `$87D0`, in eleven runs, plus 287 bytes of new
code at `$C000`. `src/server/camels-patch.test.ts` names every one of them and
asserts that the overlay reproduces the disk build exactly — so this is checked
rather than recorded.

The zone table, `$6700-$87CF`, is **byte-identical between the two builds**,
which is what makes the listing's names transferable across both.
