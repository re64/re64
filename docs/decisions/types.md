# What a type can say, and what it deliberately cannot

`add_type` arrived because experiment 7 finished its analysis of Camels' zone
table — 8,400 bytes, 42 records of 200, nineteen named fields per creature type,
proved three ways from a copy routine — and had nowhere to put it. That is
recorded in `claims.md`. This is what happened next, and most of it is an
argument about how *little* to add.

## Arrays, and why they came first

A field can be `u8[8]`, `Creature[42]`, `char(40)[3]`, `u8[1..32]`, or
`u8[4][8]` nesting the way C reads it — four of eight, outer dimension first.

**Decided on two programs, not one.** `claims.md` sets that bar and it matters
here, because designing an array against Camels' zone record alone would
describe Camels' zone record. Four shapes appear in both binaries; the array is
the one with the most instances by a distance. Camels' zone record is roughly
nineteen fields each eight wide, one slot per creature type. Gridrunner's three
level tables are `LevelParams[32]` each.

**A modifier, not a kind**, so it needed no change to the schema, the CRDT, the
operations, the diff or the file format. A field type is one string, and that
old decision is what made this cheap.

## The relations question, and how it got smaller

The parked entry in `claims.md` wanted three things: an **index into** another
table, a **bitmask over** an index space, and an **enum**. Working through them
collapsed all three and killed one.

**index-into and enum are the same statement** — "this value names one member of
X" — differing only in whether X is an array or a set of names. And an
index-into is storage-identical to `u8`: it changes nothing about layout, size
or the walk. Only what renders.

**But an index is too ephemeral to carry a type.** The objection that settled it
is a copy loop: one X register walks a source and a destination, so an edge
pointing at "the" table has to pick one arbitrarily. Camels makes the same point
from the other side — `nextType` doesn't index *an array*, it indexes the
creature-type dimension, which nineteen parallel fields share. No language types
an index this hard; C enums convert freely to integers, and for good reason.

The way out was to invert it: **not an edge to a target, but a dimension both
ends name**. Which then turned out not to need a new noun at all.

## A count may name a constant, and that is the whole of it

```
LevelCount = 32

noOfDroidSquadsForLevel:    u8[1..LevelCount]
sizeOfDroidSquadsForLevels: u8[1..LevelCount]
laserFrameRateForLevel:     u8[1..LevelCount]
```

Two arrays written `[CreatureCount]` say their counts are the **same count**,
which was the entire content of the dimension idea, using the noun that already
exists. `constant.ts` argues constants are project-level because "a name for a
value describes no bytes", and an array count is a value.

Gridrunner is the case: the same 32 appears four times within a dozen
instructions — a `CMP #$20` at `$8C8C` and three 32-byte tables, all read with
the same X. Binding that constant to the immediate the code compares against ties
the layout to the program with `bind_constant`, which has existed since
experiment 3.

Resolved on load, never stored. The document holds `u8[LevelCount]`; the number
lives only in the loaded model, so changing the constant changes the layout and
there is no second fact to disagree. A constant that has gone falls back to the
number it had.

**What stays parked:** `one of D` and `set of D` — a field saying what its value
refers to. Neither is buildable until there is a referent to name, and the
counted evidence is for the sharing, not for the typing.

## Index origin, and why a symbol must name its object

Nine of Gridrunner's tables are declared `=*-$01`, so element 1 sits at the
first byte. Without an origin you must break one of two things:

- label at `D−1` — **the symbol does not name the object it names**
- label at `D`, array 0-based — `array[X]` disagrees with what `LDA label,X`
  computes

With it, both hold: label at `D`, array at `D`, indices 1..32, and
`array[X]` = `D + (X−1)` = `D−1+X`, exactly the machine's address. The `−1`
moves into the indexing convention, which is where it belongs.

**It is a claim, not a fact.** `base = *-$01` with `LDA base,X` and `base = *`
with `LDA base-1,X` assemble identically, so the bytes cannot distinguish them —
and the listings we have are Regenerator output that somebody renamed, not
anybody's source. What *does* support it comes from a different direction: at
the `LDX selectedLevel`, the variable has just been `INC`'d, so it is never 0
there. The addressing cannot tell you the origin; the index's value range can.

So it carries `method: derived` at best, and `bind_name`'s `at` argument exists
so the reading is stated rather than guessed. It used to come from
`labelTolerance` defaulting to 1.

**Known syntax trap, with no instance:** `[first..last]` means the bounds are
inclusive, so `[1..LevelCount]` is 32 elements only because the origin is 1.
`[2..LevelCount]` would silently be 31. Neither program has such a table, and a
redesign for a case nobody has would be the worse mistake.

## A bitmask is a record at bit granularity

`unit: "bits"` makes a type's offsets count bits; fields in one take `bits(n)`.
`$D011` is seven fields in one byte, and structurally that is a record: named
things at offsets, holes legal, two people editing different offsets both
surviving.

**`size` stays in bytes, and so does `fieldSize`.** A unit that silently changed
what an existing number meant is the F1 shape, so nothing that already places
things in memory learns anything; only code walking inside one asks `fieldBits`.
Nesting is then free — a bit record sits inside a byte record like any other
type, which is why `zones[2].flags.doubleWidth` needed no new path machinery.

Bit *n* is the one worth 2^*n*, as every datasheet numbers them. The listing
prints high to low because that is how a byte is written: a display choice, not
what an offset means.

The workaround it replaces is in this repository — `symbols.ts` writing bit
meanings as English inside comment strings, and `vic.ts` hand-writing the mask
and shift ten times. `registers.ts` now declares them, platform-owned, and
`where` answers with them.

## A bit *is* a constant, which is why there is nothing open here

The next thing this looked like it wanted was for `LDA $D011 / AND #$80` to say
that A holds `SCROLY.rasterBit8` — and the first plan for it was to widen
`Bits.origin` so per-bit provenance could name a memory address, since the tags
are one byte naming a register at routine entry.

**That was over-engineering, and the C idiom says why.**

```c
#define RASTER_BIT8 0x80
flags = FLAG1 | FLAG2;
```

The bit's identity in code *is* its mask. `AND #$80` does not need an analysis
that traces where the value came from; it needs its operand named, and naming a
value at a site is `add_constant` plus `bind_constant`, which have existed since
experiment 3. Then the listing reads `AND #RASTER_BIT8` and the question is
answered by the thing that was already there.

So `where` reports each field's mask — the number you would `#define` — and the
loop closes with no new mechanism. This is the third time the answer turned out
to be the constants noun: counts, masks, and the enum half of the parked
relations question. **That noun is systematically underused** — by agents as
well as by this design work. One run declared eighteen constants; the two after
it declared *zero* while calling `find_immediates` six times. Reading that
silence as "not needed" would have been reading a limitation of the method as a
finding, and the four shapes are now written into `add_constant`'s own
description, which is where the earlier gap-of-signposting fixes went.

What the bit record is actually for is narrower than it first looked, and still
worth having: decoding a *stored* byte into named fields, and declaring a
register's seven constants in one place rather than seven.

**The residual cases, which are not worth machinery.** A shifted mask — `LSR`
three times then `AND #$07`, where the literal no longer sits where the field
does — and a mask computed from a table. Both are rare, and in both a reader
names the constant `Y_SCROLL_MASK` and is finished. Widening the tag would buy
those two cases and cost a per-bit provenance system.

---

Related: `claims.md` for why a relation *noun* stays parked, and `platform.md`
for why the register layouts are platform-owned.
