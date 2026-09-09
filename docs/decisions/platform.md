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
routes the address schema's `screen(...)`/`sprite(...)` forms (see the note at
the foot of this file: they are spelled with brackets now) so that the shared
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

---

## Note, appended: the places are spelled with brackets

The entry above writes them `screen(row,column)` and `sprite(pointer)`, which is
what the parser accepted when it was written. They are now `screen[row,column]`
and `sprite[pointer]`, and the base — the thing that is not an index — moved out
of the argument list onto the array: `screen($8400)[10,2]`.

The reason is an observation rather than taste. **A place is an array reference
into an array whose base is implicit**: the character cells from the screen base,
the 64-byte blocks from the VIC bank. Parentheses said *call*, and on a machine
whose own indirection syntax is `($FB),Y` they said something actively
misleading. Brackets say what these are, and they make a place the same shape as
a program's own tables — which matters because that notation is what the field
types are being built around, and one notation covering both the machine's arrays
and the program's is worth more than either alone.

The old spelling is still read. A place resolves to an address and is **never
stored**, so there was nothing to migrate — and three runs' worth of notes, every
previous tool description and the article all use parentheses. Nothing is gained
by refusing what everybody already typed.

`where` now answers with the place written out, so the two directions round-trip:
what it says goes straight back into any address argument.

---

## Note, appended: the machine declares its own bit layouts

`src/core/c64/registers.ts` is a second platform table beside `symbols.ts`: what
the *bits* of a hardware register mean, as records whose offsets count bits.

It was added because the workaround was already in this repository, twice.
`symbols.ts` carries bit meanings as English inside comment strings — "Bit 7
control messages, bit 6 errors" — and `devices/vic.ts` hand-writes the mask and
the shift ten times over: `$D011 & $80` is the ninth raster bit, `$D018 >> 4 &
$0F` the screen base, `$D018 >> 1 & $07` the character base. Every reader of a
C64 program does that arithmetic too, and it has one right answer.

It is the same noun as everything else — a record, with named things at offsets
and holes legal — which is what kept it from being a special case. The only
thing that makes it platform rather than project is who declares it, and that is
why `where` reports it under `register` rather than under `field`: one is a fact
about the hardware and the other is something somebody in this project said,
and running them together would make it impossible to tell which.

The table row above should now read: **a register's bit layout** — its own,
behind the seam, and reached only through `registerAt`/`fieldsInMask`.

Thirty registers now, the SID included — its three voices are the same seven
registers three times over, so they are generated from the voice number and the
names carry it, because `SIDCTRL2.gate` must not be ambiguous about whose gate
it is. `sid-audio.ts` is the oracle for those the way `vic.ts` is for the VIC: it
decodes them to render a tune, so a layout disagreeing with it would be wrong
about a chip this repository can already play.

**They are also the type system's worked examples**, which was not the reason for
building them and turned out to matter more. `unit: "bits"` and the array
notation are the two newest things a field type can say, and a project using
neither teaches neither: the Camels silver image declares six types and every
field in all of them is a scalar. `list_types` reports the machine's layouts
beside the project's — apart, because these belong to the hardware and no
operation can revise them — so a reader meets `bits(3)` in use rather than in a
paragraph of schema prose.

Still partial. These are the registers a program touches every frame; adding the
rest is data entry, and an empty entry is better than a guessed one.
