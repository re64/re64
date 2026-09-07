# Where the platform ends

Written the day it became a real question rather than a hypothetical: the
observation that most of re64 has nothing to do with the Commodore 64, and that
an NES would reuse the expensive parts.

## What is actually machine-specific, measured

The honest measure is not which files *mention* the C64 — most of them do, in
prose, and that is where the knowledge belongs. It is which platform-agnostic
files **import** from `src/core/c64/`:

| importer | reaches for | why |
|---|---|---|
| `claims/model.ts` | `c64/text.js` | `Interpretation` carries `encoding?: TextEncoding`, and the encodings are PETSCII and screen codes |
| `ops/types.ts`, `ops/edits.ts`, `memory/type.ts`, `project/project.ts`, `view/rows.ts` | `c64/text.js` | the same type, threaded to every layer that carries or renders an interpretation |
| `project/loader.ts` | `c64/symbols.js` | the built-in platform layer at the bottom of every stack |
| `analysis/program.ts` | `c64/entry-vectors.js` | origin kinds — which addresses the machine re-enters itself at |
| `machine/scenario.ts` | `c64/screen.js`, `c64/devices` | a `capture: screen` step composes a C64 frame |
| `server/mcp/tools.ts`, `server/workspace.ts` | `c64/geometry.js`, `c64/sid-audio.js`, `c64/d64.js` | places, audio rendering, disk images |

**Seven of those are one leak wearing seven hats.** `TextEncoding` is a C64 type
in the document model, so everything that carries an interpretation carries it
too. That is the single deepest coupling and the one to fix first if a second
machine ever arrives — as an open set of encoding names the platform supplies,
rather than a union the model spells out.

## Correction: a codec is not a platform coupling

*Added the same day, and the entry above keeps its text because the value of a
corrected decision is the correction.*

The table above calls `c64/text.js` the deepest coupling on the grounds that
seven platform-agnostic files import it. That miscounts what kind of thing it
is, and the distinction is worth having in general:

| | is | depends on | a second machine needs |
|---|---|---|---|
| **a codec or a layout** — `petscii`, `screen`, `ascii`; `char`, `sprite`, `sprite-multi`, `bits` | a fixed table from bytes to meaning | nothing | another entry in an open set |
| **a place** — `screen(row,column)`, `sprite(pointer)` | arithmetic over machine state | `$D018`, `$DD00`, and the hardware having such a thing at all | its own, behind the seam |
| **a machine fact** — symbol tables, entry vectors, devices, frame composition | what the hardware *is* | the machine | its own module |

PETSCII is always PETSCII. A claim saying `encoding: "petscii"` is carrying a
data format name, exactly as it would carry `utf-8`; it is true of those bytes
wherever they sit and whatever is running. `screen(10,2)` is not true of
anything until you say which machine, in which state.

**The type says so itself:** `TextEncoding` is `"ascii" | "petscii" | "screen"`,
and `ascii` was in it from the start. That set was never machine-scoped — it
happens to contain two Commodore tables.

So those seven imports are one **vocabulary** decision, not a boundary: whether
the union should be open. That is cheap, local, and does not need doing until a
machine wants a fourth codec.

The same reclassification applies to `BitmapFormat` in `view/`. `sprite` there
is "24 by 21 one-bit pixels, three bytes a row" — a byte layout, not a place.
NES 2bpp planar tiles would be another entry in the same set rather than
evidence the set is in the wrong directory. What genuinely sat in the wrong
place was the palette, and that is fixed.

**What that leaves as actually platform-shaped**, and it is a shorter list than
the table above suggests: the built-in symbol table the loader reaches for, the
entry vectors the analysis reads to know where a machine re-enters its own code,
the devices and frame composition the scenario runner uses, and the places —
which are already behind `core/platform.ts`.

### A layout is independent; its *name* is not

The correction above says a byte layout is a table rather than a place, and that
stands. But `sprite` is an under-specified name for one: a C64 sprite is always
a VIC-II sprite — 24 by 21, one bit a pixel, three bytes a row — and an NES
sprite is 8 by 8 or 8 by 16, two bits a pixel, planar. Both communities call
theirs "sprite" and neither is wrong.

So the shape, when it is ever needed, is **specific names with a per-platform
generic alias**: `vic2-sprite` and `nes-8x8` are unambiguous everywhere, and
`sprite` is what a caller on that project may type. Which is the rule already
settled for places one level down — accept the alias on the way in, store the
resolved form — so that a stored project means the same thing to whoever opens
it, and the convenience stays at the surface where it belongs.

**Checked, because it decides whether waiting is free:** it is. A specific name
would be *added* beside the generic one rather than replacing it, so nothing
stored has to migrate. And a project is single-platform, so `view: "sprite"` in
a C64 project is unambiguous today and stays unambiguous after a second machine
arrives — the alias resolves against the project's own platform, not against
whatever is reading.

That is the useful conclusion rather than the naming itself: there is no cost to
being carried by not deciding this now, which is what makes deferring it a
decision rather than a debt.

## What transfers unchanged, which is most of it

The claims model, the operation algebra and its inverses, the CRDT and the
round-trip harness, the row model, comments, constants, types, targets, layers,
evidence, scenarios, the block and effect analyses, the known-bits domain, the
flag proofs, the identity-preservation proof, PNG and WAV encoding — none of
these know what machine they are looking at. Neither does the **P-Code lifter**,
which is 6502 semantics, and an NES runs a 6502 core.

So the ordering is the interesting part: the parts that took longest to get right
are the parts a second machine would not have to pay for again.

## What an NES would actually need

Not what you would guess. The CPU is the easy half — a 2A03 is a 6502 with
decimal mode disabled, which this lifter already models as a *proved* flag rather
than an assumption, so the proof simply comes out constant.

The real work is three things:

- **A different video model.** Pattern tables, nametables, attribute tables and
  OAM are not a 40×25 character screen with colour RAM beside it. `bitmap-view`'s
  formats (`char`, `sprite`, `sprite-multi`) are C64 layouts sitting in
  `src/core/view/`, which is meant to be neutral, and `screen(...)`/`sprite(...)`
  are C64 places.
- **Mappers**, which is the banking problem this project has recorded as unsolved
  since the beginning — except that on the NES it is not an edge case, it is how
  every cartridge past the first year works. The overlay half is answered by
  targets; the runtime-alternation half is not.
- **iNES headers and CHR/PRG split**, which is the `d64.js` equivalent and the
  smallest of the three.

## The seam, and what it is not

`src/core/platform.ts` exists as of this entry, and it currently does one thing:
routes the address schema's `screen(...)`/`sprite(...)` forms so that the shared
parser never imports a platform directly. It was added because that coupling was
*new* — introduced the same day — and the cheapest moment to give something a
home is before it sets.

**It is not an abstraction and does not claim to be.** One implementation, one
function, and a file that says so. The rest of the table above stays as it is
until a second machine makes the shape obvious, because a `Platform` interface
designed against one platform describes that platform rather than the category —
which is the mistake this project has already recorded under a different name:
building coordination machinery in advance decides what coordination looks like
before anyone has seen any.
