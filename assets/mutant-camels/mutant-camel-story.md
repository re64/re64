# Revenge of the Mutant Camels: the story the code tells

A working memo, not a listing. The project holds what every byte *is*; this holds
what is worth **saying about it**.

Same purpose as `gridrunner-story.md` and a different subject. Gridrunner is a
4KB cartridge — a whole program you can hold in your head, whose story is what
one author got wrong in a small space. This is 47KB off a disk, ten times the
size, and its story is different in kind: **the shipped file is a memory dump of
the machine it was written on**, and it still has the author's own source code
lying about inside it.

Sources: `experiments/07-scale/run/` — three readers on one shared document,
648 tool calls, unexplained bytes from 40,359 to 13. Claims marked **verified**
were checked independently by the reader who made them, usually by a second
route; claims marked **unsettled** are recorded as questions on purpose.

## The direction

The thesis writes itself, and it is not "here is how a 1984 game works":

> **This is not a build. It is a photograph of somebody's desk.**

Everything else hangs off that. A clean link would not contain fragments of the
assembler's own source buffer, would not contain a data table that has already
been processed by the routine meant to process it at run time, and would not
carry four separate mechanisms that are wired up and can never fire. The
question the piece answers is what a program looks like when it is shipped by
saving the memory of the machine it was written on — which is how a great deal of
1984 software was in fact shipped.

Two things to carry over from the Gridrunner memo, both still true:

- **Curation is the missing skill.** Three readers drove to 13 unexplained bytes
  because the brief rewarded that. A piece needs the opposite: keep the 5% that
  carries a thesis. The missing persona is an **editor**, scored on what it
  leaves out.
- **Narrative is not an annotation.** A comment is about an address; a paragraph
  is about the program. Still a new object rather than a flag on comments.

And one that is new here, because three readers rather than one produced it:

- **A disagreement is content.** Two readers named `$3D` `shotInFlight` and
  `laserSoundActive`. That is not a merge conflict to be resolved away; it is the
  most interesting sentence anybody wrote about that byte, and the tooling threw
  it on the floor. See the last section.

## The findings, as story beats

### The author's own source code is still in the file

Three blocks — `$5870`, `$5F28`, `$5FA8` — hold 6502 assembler source, stored the
way a Commodore in-BASIC assembler stores it: `[link lo][link hi][line# lo][line#
hi] text $00`, links resolving, line numbers ascending in tens. That structure is
what makes it certain rather than a lucky run of printable bytes. **Verified** by
scanning all 47K for the pattern; those three blocks are all of it.

```
15240  MLOOP JSR STARF
15250        JSR BULITZ
15260        JSR CCAMEL
```

That is the main loop, in the author's own names, and they land on real code:
`STARF` is `$8FB0`, the starfield; `BULITZ` is `$95B9`, the bullet; `CCAMEL` is
`$9444`, the player.

Two of the fragments are not thematic but **exact**:

- Lines 15150-15190 are `CLC / ADC #$C8 / STA NEXINI / LDA NEXINI+1 / ADC #$00`,
  which is byte-for-byte the loop at `$93E4` that steps the zone pointer. So
  `NEXINI` is `$3E`.
- Lines 13880-13990 match `$92F2` onwards instruction for instruction, *including
  the tail of the routine before it*. So `$92F6` **is** `SSET` and `$92FF` **is**
  `TANGE`.

Because the match is exact, the residue is from **this** build. Eight lines out of
thousands: evidence about intent, not an index — the reader who found it said so
in chat and warned the others not to rename on its authority elsewhere, which is
the right instinct and worth keeping in the piece.

The second proof of the same thesis is quieter and better. The 208 bytes at
`$5E00` are the default high-score table with every byte ANDed with `$3F` — 119
identical, 89 differing by exactly that mask, none differing any other way. That
is what `InitDefaultHighScores` does at run time. **The routine had already run
when the image was saved.**

### The random number generator is BASIC ROM

`$8D1D` is `INC $24 / LDX $24 / LDA $A000,X / RTS`, with eleven callers. In the
image, `$A000-$BFFF` is 8192 bytes of zero.

**Nothing in the program writes `$00` or `$01`** — zero instructions touch the
6510's port. **Verified** by search. So the processor keeps its power-on `$37`,
BASIC ROM is banked in, and the game's entropy is a byte of Microsoft BASIC.

Two consequences. It is perfectly deterministic: same counter, same byte, every
machine, every run — the landscape is `NextRandom AND #$07 ORA #$01` choosing the
next hill, so a given zone generates the same terrain for ever. And re64 **cannot
see it**: memory is flat, no ROM is loaded, and every tool will answer with zeros
there until banking is modelled. The finding exists only in prose.

### There is no explosion subsystem

The best structural finding in the program, and it needs a diagram rather than a
paragraph.

A zone is eight creature types and six live slots. Nineteen template fields per
type, all named, all proved by the copy in `sub_9772` rather than guessed. Four
separate routes take one creature into another — shot, exploded, aged out,
bounced out — and **all four land in the same spawn call**.

So: blocks `$EC-$EE` appear as one of the eight creature types in every one of the
42 zones, with a twelve-tick lifetime and `nextType = $FF`. An explosion is a
creature. Blowing something up is the same call as a bird laying an egg.

A zone record is the adjacency list of a directed graph over eight creature types,
and the game is that graph, forty-two times.

### Four things that are built and never run

Each independently checkable, and together they say what kind of binary this is.

1. **`$C046` is unreachable.** No inbound reference, and the two bytes `$46 $C0`
   occur **nowhere in the 47K image**, so no pointer table and no pushed address
   can reach it either. It is half of a self-modifying pair: `$C023` pokes `DEC`,
   `STA` and `INC` opcodes into seven sites, `$C046` pokes `LDA` back. The shipped
   image already holds the write-mode opcodes, so the surviving half merely
   re-asserts the state the file ships in.
2. **The start-at-zone-41 cheat is dead.** `$C000` does `CMP #$50 / BEQ / CMP #$50
   / BEQ` with A unchanged between them. Two different key codes once; an edit
   broke it.
3. **The sprite multiplexer never fires.** The mechanism is real — two shadow
   banks, parity in `$30` — but `FindFreeObjectSlot` searches up to `$42`, and
   `$42` is 8 in 41 zones and 6 in one. Nothing ever allocates above slot 7. Bank
   1 is written by nothing and read by nothing.
4. **The bullet's hardware-collision gate is stubbed.** `$9AB3` is `LDA #$FF / AND
   #$02` and `$9ABC` is `LDA #$FF / AND printChar` — both always pass. Put `A5 44`
   where `A9 FF` is and they become exactly the camel test at `$9B1B`. Two bytes,
   twice. The reason is visible elsewhere in the program: a multiplexed sprite
   registers no hardware collision on a frame it is not drawn, so the bullet was
   moved to a coordinate test and the dead gate left behind.

### The cheat code is GOATS

`$96D2` walks a five-byte table at `$96F7` — `$1A $26 $0A $16 $0D`, keyboard
matrix codes for **G O A T S**. It reads the table twice at a one-byte offset:
`$96F7,X` is the key already accepted and still held, `$96F8,X` is the next one
wanted. At five, the accumulator still holds the count, so `STA $5E` switches
cheat mode on and `ClearMessageLine` tail-jumps into `ShowCheatModeBanner` — which
means clearing the message line puts "CHEAT MODE OPERATIVE" straight back.

### Forty-two zones, and the game says so itself

`$6700-$87CF`: 42 records of exactly 200 bytes, 152 bytes of template plus 8
scalars plus a 40-character name. **Verified** three ways — the banner lands on
`+$A0` in all 42, the code does `ADC #$C8`, and the credits say "THE GAME CONSISTS
OF FORTY TWO DIFFERENT ATTACK WAVES."

The names are half the personality of the game and belong in the piece as a list:
*CAREFUL WITH THAT AXE, EUGENE*. *RAINDROPS KEEP FALLING ON MY BEAST*. *HAVEN'T WE
MET SOMEWHERE BEFORE?*

Nothing addresses this table absolutely. Every read goes through `($3E),Y`, so
8400 bytes — 21% of the program — were invisible to every reference tool, and the
reader who found it did so by pulling 12K out and scanning it in a script.

### A font whose punctuation can be proved from the keyboard

The game ships its own character set at `$2000`. `ReadKeyMapped` searches a
31-byte matrix table and returns the byte at the same index of a result table;
lining the two up against the standard C64 keyboard matrix accounts for every
entry with no slack — 26 letters, space, return, delete — and the two left over
are the full-stop and comma keys, producing `$51` and `$52`.

Four more follow from message text, and they are contiguous:

```
$51 .    $52 ,    $53 '    $54 !    $55 ?    $56 :
```

A designed layout rather than six coincidences. The same table then paid for the
cheat code.

### The credits are scrolled through the landscape

There is no routine that draws the credits, and the reader who went looking for
one found that out the hard way. `EmitAttractColumn` plants one character of the
scroll text and one of the high-score table into **each new terrain column** as it
arrives at the right edge. The credits are made of ground.

### A colour that comes from an opcode

`$90A5` is `LDX #$28 / LDA $9148,X / STA $D827,X`, so it reads `$9149..$9170` —
and `$9170` is `StartMusic`. The colour of the last cell of panel row 1 is an
instruction byte. A real bug, off the end of a table by one.

### Music: five streams, and one nobody can play

`(ticks, note)` pairs, `$F0` rest, `$FF` end. Three intro voices, two short-tune
voices — and 216 bytes at `$64BA` in the same format that **nothing can reach**.
**Verified** rather than assumed: only two routines ever seed a voice pointer,
every one of the 22 sites that touch the pointer pairs is inside those two or the
players, and voice 2 is stopped by an `$FF` seven bytes before the orphan begins.
A cut arrangement, or something no static walk can see. Both stated; neither
picked.

Two details worth the paragraph they cost. Voices 1 and 2 run to **exactly** 636
ticks — what a real three-part arrangement looks like rather than a loop that
happens to fit. And the note table is true equal temperament, octave ratio
2.0000, tuned to **31.5 Hz** at index 0: internally perfect, and not at concert
pitch.

### Smaller things that carry weight

- **The high-score file is called `ATTACK MUTANT.HI`** — *ATTACK*, not *REVENGE*.
  Either the build reuses the earlier game's score file or the disk is mislabelled.
  **Unsettled**, deliberately.
- **The score exists only on screen.** Seven ASCII digits at `$040E`, carry
  propagated by hand; the neutronium bar is eighteen cells at `$043D`. No binary
  copy of either. The same beat as Gridrunner, in a game ten times the size.
- **The row table has 27 entries for a 25-row screen.** `PrintCharAt` guards the
  column and not the row, so a bad row corrupts the sprite pointers rather than
  failing visibly.
- **`$985E` does `PLA PLA RTS`** to cancel a spawn, unwinding two levels. Any call
  graph through `PlaceNewObject` is wrong about it.
- **One bullet, eight-way only.** `CMP #$0F` rejects fire with the stick centred:
  this game has no straight-ahead shot.
- **The two movement handlers read the same fields differently** — one treats
  `objSpeedX` as a countdown, the other as a step. Anyone naming those fields with
  one meaning is wrong half the time.

## What this needs before it can be published from re64

The Gridrunner list still stands: a way to mark a finding as **notable**, a
**narrative object** that belongs to no address, a real renderer for the pictures,
and an **editor** persona. Three readers rather than one added two more.

- **Somewhere to keep a disagreement.** The run destroyed 123 names across 74
  addresses because `set_label` is an upsert keyed by address, and the losses were
  not duplicates but *judgements*: `jumpTimer` against `jumpVelocity`,
  `shotInFlight` against `laserSoundActive`. Writes now say when they replace a
  chosen name, which stops the loss — but the interesting object still does not
  exist. Two readers disagreeing about one byte is the sharpest thing either of
  them said about it.
- **Banking, or the RNG stays unreadable.** This is the first finding here that
  re64 structurally cannot hold. `$A000` is BASIC ROM to the program and zeros to
  every tool, and a piece that says "the randomness is Microsoft BASIC" is making
  a claim the software cannot check.
