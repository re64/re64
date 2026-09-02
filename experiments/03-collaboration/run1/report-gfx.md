# Gridrunner: graphics and sound

**gfx / beryl, experiment 3.** Shared document with `lead` / agate. ~140 tool
calls. Everything below is also in the project as labels, regions, comments,
constants and two decoders; this report is the argument and the friction, not
the findings' only home.

---

## 1. What the machine is doing

### There is not one sprite in this game

No write to `$D000`-`$D010`, `$D015`, `$D017`, `$D01D` or `$07F8`-`$07FF`
exists anywhere in the 4K. `find_instructions` over each range returns nothing.
Every object in Gridrunner - the player, the laser, the bombs, the two zappers,
their beams, the snake segments, the droids, the explosions - **is a character
in a 64-glyph font the cartridge ships with itself**.

That single fact explains the whole architecture:

- `PlotCharAndColour $8172` is the *only* drawing primitive, with **35 callers**.
  Character in `$04`, colour in `$05`, column in `$02`, row in `$03`. It writes
  the character to `$0400 + row*40 + col`, then adds `$D4` to the pointer's high
  byte (`$04` -> `$D8`) and writes the colour to the matching colour-RAM cell.
  Verified by `run_block` at `$8175` with `screenPtr=$0640, Y=$14,
  plotChar=$07, plotColour=$0D`: it wrote `$07` to `$0654` and `$0D` to `$DA54`.
- `ReadCharAtPlotPos $818B` is its inverse, with **9 callers, every one a
  collision test**. There is no object list to compare coordinates against.
  The picture *is* the game state. Bombs are stored as raw screen pointers, not
  as coordinates, so falling one row is adding 40. A droid's damage state is the
  character code sitting in screen memory. The score is the digit characters at
  `$040F`; there is no binary score anywhere in the cartridge.
- Which is why a naive `$D800`-`$DBE7` search finds seven sites and a `$D000`
  search finds four. Everything goes through one indirect store.

### Video setup: three registers, written once, never again

```
$D018 = $18   screen at $0400, character generator at $2000
$D020 = $00   border black
$D021 = $00   background black
$D016 = $05   38-column mode, horizontal scroll 5
```

The first three are written at `$810B`-`$8114` through `STA ($02),Y` with
`$02/$03 = $D000` and the register offset in `Y` - the value stored happens to
equal the offset, which is a nice trick and the reason a plain search for VIC
stores comes up almost empty. re64's constant folding resolved all three and
said so.

`$D016 = $05` at `$83C5` is the interesting one and I could not fully settle it.
Bit 3 clear is 38-column mode; bits 0-2 are a 5-pixel horizontal scroll. It is
never written again, so this is the display for the whole game - not scrolling,
a permanently narrower window. **Both extreme columns are in use**: column 0 is
the left zapper's track and column 39 holds the lives digit at `$0427`. How much
of either survives the border is a pixel question the bytes cannot answer. It is
worth answering, because if column 39 is covered the lives count is invisible.
*What would settle it: one screenshot of the running cartridge.*

`$D011` and `$D012` are never read or written, `$0314` is never touched, and the
only interrupt entry is an NMI stub at `$83E2` that pops three registers and
`RTI`s. **Nothing is synchronised to the raster.** Every character is poked into
`$0400` whenever the loop gets to it, so the picture tears by design.

### The font

`$8E00`-`$8FFF`, 64 glyphs, copied to `$2000`-`$21FF` by `CopyCharsetToRam
$82EC` before anything else runs. It is a **custom font in a hand-packed order**,
which is why PETSCII and C64 screen codes both render the game's text as
nonsense:

```
$20 space
$21 G  $22 R  $23 U  $24 I  $25 D  $26 N  $27 E  $28 A  $29 B
$2A F  $2B H  $2C J  $2D M  $2E P  $2F S
$30 O and 0 (one glyph serves both)   $31-$39 digits 1-9
$3A T  $3B V  $3C $3D two halves of a (c)  $3E L  $3F |
$1B $1C Y   $1D $1E a small "HI:"   $19 $1A a small label I could not read
```

**C, K, Q, W, X and Z do not exist in this font.** I read the mapping off the
glyph bitmaps and then confirmed it by decoding all the strings in the
cartridge - which is the evidence, since a font map that produces English from
five separate byte runs is not a coincidence:

| address | decodes as |
|---|---|
| `$8080` | `(c) 1982 HES  PRESS FIRE TO BEGIN` |
| `$8DE1` | `BY JEFF MINTER` |
| `$8DF1` | `ENTER LEVEL 00` |
| `$8C51` | `" BATTLE  STATIONS "` |
| `$8C62` | `ENTER GRID AREA 00` |

I wrote a decoder for it, stored it in the project (`dec_3g1jgm`), and pointed
the text regions at it with `view: "snippet:dec_3g1jgm"`, so all the strings now
read as English **in the listing itself**, for all four consumers. That is the
single most satisfying thing in the run: the "custom character sets are still not
solved" note in CLAUDE.md is solvable from the agent surface today, with the
tools as shipped.

Here is the wordmark, drawn from the cartridge's own glyph data:

```
.#####..######..######..######..######..##...##.##...##.##...##.#######.######..
#######.#######.######..#######.#######.##...##.##...##.##...##.#######.#######.
................................................................................
##......##...##...##....##...##.##...##.##...##.###..##.###..##.####....##...##.
##.####.######....##....##...##.######..##...##.####.##.####.##.####....######..
##...##.##.#......##....##...##.##.#....##...##.##.####.##.####.##......##.#....
##...##.##..#...######..#######.##..#...#######.##..###.##..###.#######.##..#...
.#####..##...##.######..######..##...##..#####..##...##.##...##.#######.##...##.
................................................................................
```

### Four of the 64 glyphs are dead art

Established with `find_immediates` on each value plus a scan of all five
character tables (`$8080`, `$8820`, `$8C51`, `$8DE1`, `$871F`):

- **`$0B` and `$0C`** are an exact horizontal mirror pair - `00 C0 72 1F 1F 72
  C0 00` against `00 03 4E F8 F8 4E 03 00`, every byte bit-reversed. Nothing
  loads either, no table contains either. A discarded pair of horizontal
  enemies is my guess and it is only a guess.
- **`$1C`** is byte-identical to `$1B` (the letter Y, `C6 C6 00 7C 38 38 38 38`).
  Only `$1B` is used, by `BY JEFF MINTER`. It is the only letter that appears
  twice in the font, which is what you would expect of an alphabet packed by
  hand in the order it was needed.
- **`$1F`**, an up arrow, drawn by nothing.

Every other glyph is reachable. That is 6% of the font left over.

### The one thing I could not read

`$19 $1A`, the two-cell label in front of the SCORE field on the status line.
The matching pair before the hi-score field, `$1D $1E`, parses cleanly as
H (6px) + I (4px) + colon (3px) - "HI:". On the same grammar, this one reads
P + L + a stroke, which spells nothing:

```
$19 $1A                    $1D $1E  ("HI:")
................           ................
####..##......##           ##..##..####....
##.##.##......##           ##..##...##..##.
####..##......##           ######...##.....
##....##......##           ##..##...##..##.
##....####.##.##           ##..##..####....
```

I know *what* it labels: `scoreDigits` is `$040F`-`$0415` and `hiScoreDigits`
is `$041B`-`$0421`, confirmed from `AddToScore $8870` and `CheckHighScore
$8060`. Note that the font contains no letter C, so "SC" could not have been set
in the alphabet even if that is the meaning - which is a reason to suspect these
two cells are a hand-drawn pictogram rather than letters. *What would settle it:
a screenshot. Nothing in the bytes will.* Recorded, with the pixels, at `$882C`.

### Screen geometry, derived from the drawing loops

```
row  0                  status line (survives ClearPlayfield, which starts at $0450)
row  1                  written once by the initial clear and never again
rows 2-21, cols 1-38    THE GRID, glyph $00 in ORANGE
rows 15-21, cols 1-38   the player's box (UpdatePlayer clamps to $0F..$15, $01..$26)
col  0, rows 3-21       left zapper track, glyph $01
row  22, cols 1-38      bottom zapper track, glyph $02
row  23                 never written
```

Row bases come from a 24-entry split table at `$0340`/`$0360` built at start-up,
not from a multiply.

One real off-by-one, visible if you look for it: `DrawGridWipe` pass 1 (the
vertical-bar wipe you watch travel right) covers columns **2**-38, while pass 2
(the grid crosses) covers columns **1**-38. Column 1 gets a cross but never a bar.

**Erasing inside the grid means drawing `$00`, the cross** - not a blank. `$20`,
the genuinely empty cell, is only ever used outside the grid, on the zapper
tracks. This is the nicest small thing in the drawing code and it is why I argued
the lead's `CHAR_EMPTY` should become `GLYPH_GRID`.

### What it looks like

```
TITLE SCREEN (as the code writes it, level 01 selected)
   +----------------------------------------+
 0 |GRIDRUNNER  ?? 0000000  HI 0000000  A  4|
 1 |                                        |
 2 |                                        |
 3 |                                        |
 4 |                                        |
 5 |                                        |
 6 |           BY JEFF MINTER               |
 7 |                                        |
 8 |           ENTER LEVEL 01               |
 9 |                                        |
10 |   () 1982 HES  PRESS FIRE T0 BEGIN     |
11 |                                        |
12 |                                        |
13 |                                        |
14 |                                        |
15 |                                        |
16 |                                        |
17 |                                        |
18 |                                        |
19 |                                        |
20 |                                        |
21 |                                        |
22 |                                        |
23 |                                        |
   +----------------------------------------+

IN PLAY (objects placed by hand at legal positions; grid, tracks and status are exact)
   +----------------------------------------+
 0 |GRIDRUNNER  ?? 0000000  HI 0000000  A  4|
 1 |                                        |
 2 | ++++++++++++++++++++++++++++++++++++++ |
 3 | ++++++++++++++++++++++++++++++++++++++ |
 4 | ++++++++++++++++++++++++++++++++++++++ |
 5 | +++++++xxxxxxx++++++++++++++++++++++++ |
 6 | ++++++++++++++++++++++++++++++++++++++ |
 7 | +++++++++++++++++++++*++++++++++++++++ |
 8 | ++++++++++++++++++++++++++++++++++++++ |
 9 |<++++++++++++++++++++++++++++++++++++++ |
10 | ++++++++++++++++++++++++++++++++++++++ |
11 | ++++++++++++++++++++++++++++++++++++++ |
12 | +++++++++++++++++++++++++++++*++++++++ |
13 | ++++++++++++++++++++++++++++++++++++++ |
14 | +++++++++++o++++++++++++++++++++++++++ |
15 | ++++++++++++++++++++++++++++++++++++++ |
16 | ++++++++++++++++++++++++++++++++++++++ |
17 | ++++++++++++++++++++++++++++++++++++++ |
18 | ++++++++++++++++++++++++++++++++++++++ |
19 | +++++++++++++++++++|++++++++++++++++++ |
20 | ++++++++++++++++++++++++++++++++++++++ |
21 | +++++++++++++++++++A++++++++++++++++++ |
22 |                 ^                      |
23 |                                        |
   +----------------------------------------+

key: + grid cross $00   < left zapper $01   ^ bottom zapper $02   A ship $07
     | laser $08   o bomb $0A   * droid $0F   x snake segment $13   ? = $19/$1A, unread
```

### The palette: seven colours and black

| | |
|---|---|
| `$00` black | border and background, set once |
| `$01` white | zappers, beam, laser, bombs, death fragments, two text lines |
| `$03` cyan | score digits, snake segments, `BY JEFF MINTER`, the letters GRID |
| `$04` purple | the letters RUNNER, the lives digit |
| `$07` yellow | the two status labels, and a **damaged** droid |
| `$08` orange | the grid, and therefore every erase |
| `$0D` light green | the player ship, and only the player ship |
| `$0E` light blue | hi-score digits, `BATTLE STATIONS` |

Yellow carries meaning: `$87E1` redraws a droid yellow when the laser knocks it
back a frame, and `$86C5`/`$8A71` draw a new one yellow. Yellow means "this has
been hit and is still there".

No multicolour, no raster splits, no colour cycling - except one:
`LevelStartFanfare $8D16` writes its counter straight into colour RAM at
`$D95E`/`$D95F`, so the two grid-area digits change colour in step with the
sound. Picture and sound driven by one variable.

---

## 2. Sound

**66 stores into `$D400`-`$D418`, and the registers the game never writes are
the story.** No FREQLO on any voice. No pulse width. No filter at all -
`$D415`-`$D417` untouched and the filter bits of `$D418` always zero. Pitch is
the **high byte only**: 256 coarse steps of about 15 Hz. There is no music, no
interrupt and no player routine; every register write happens inline in the game
loop, between two characters being plotted.

| voice | waveform | used for |
|---|---|---|
| 1 | noise `$81`, only ever | grid-wipe ticks, the laser, the death blast |
| 2 | noise `$81`; **triangle `$11`** in `SweepDownSfx $8450` | the laser, the materialise chirps |
| 3 | sawtooth `$21`; **ring-modulated sawtooth `$25`** in the fanfare | zapper beam, explosion sweep, level fanfare |

`V1AD`, `V1SR`, `V2AD` and `V2SR` are written **once** at start-up (`$0A`/`$00`
- attack 0, decay 10, no sustain) and never again, so voices 1 and 2 keep one
percussive click envelope for the entire game and everything they do afterwards
is gate-off/gate-on. `V3AD` is the only envelope ever changed later, twice, in
`StartLevel`. Evidence: `routine_effects` on `MainLoopTop $83A0` lists exactly
nine I/O registers among its 71 writes - the four fixed envelope registers are
not among them, and neither is any VIC register.

`$D418` is a **fader, not a switch**: `$8414` writes `$0F - fxCounter` so the
opening burst gets *louder* as it grows; `$8B30` writes `blastFrames` so the
death explosion fades with its animation; `$842D/$8437/$843F` step `$0F, $08,
$02` through three receding chirps.

Frequencies, derived from the code constants and the PAL SID clock (one FREQHI
step is about 15.0 Hz). For the two noise voices this is timbre - how bright the
hiss is - not pitch:

| effect | |
|---|---|
| grid wipe `$8240` | `V1FREQHI = gridCol`, 2 to `$26`: ~30 Hz rising to ~570 Hz across the screen, one click per character plotted |
| laser `$8573` | both voices sweep down from `$40` (~960 Hz) to 0 |
| materialise `$8450` | triangle, `$18` to 1: ~360 Hz falling to ~15 Hz, three times, quieter each time |
| zapper beam `$862F` | sawtooth at `$03` = **45 Hz** - below the bottom note of a piano, a buzz you feel |
| explosion `$889A` | sawtooth `$F0` to `$40`: ~3.6 kHz down to ~960 Hz, repeated |
| idle | `V3FREQHI = $04`, ~60 Hz, left running between effects |
| fanfare `$8D16` | all three voices at `$40 - X`: ~240 Hz rising to ~950 Hz, ring-modulated saw |

**The grid wipe is the best thing in here.** `WipeSfxDelayAndPitch $8230` is a
delay loop whose entire purpose is a side effect: `fxCounter` is set to 4 and
incremented until it wraps back to 4 - 251 iterations - and *every* iteration
writes `V1FREQHI = gridCol` and `V2FREQHI = gridCol + 1`. The delay and the pitch
sweep are the same loop. So the sound of the grid being drawn rises with the
column, and the picture and the noise sweep across together. One counter.

**The fanfare is the most elaborate.** `$25` = `%00100101` = sawtooth + **ring
modulation** + gate, on all three voices at the same coarse pitch, with the
sweep getting shorter each pass so it accelerates - while the same counter cycles
the colour of two digits on screen.

**No randomness, confirmed from the sound side.** `$D41B` (OSC3/RANDOM, the
standard C64 random source) is never read; neither are the CIA timers at
`$DC04`-`$DC07`. This corroborates the lead's finding independently, and it is a
near-free source the game already had running: voice 3 is on noise for most of
the game.

---

## 3. What fought me

Blunt, as asked. In rough order of how much it cost.

### 3.1 A bitmap region is a black box you cannot annotate

This is the worst one and it is squarely in my lane. `set_region kind:"bitmap"
view:"char:8"` over `$8E00` draws the font beautifully. But:

- **Comments at addresses inside it render nowhere.** I wrote per-glyph comments
  at `$8E58`, `$8ED8`, `$8EF8`. `set_comment` returned `ok`. `list_comments`
  shows them. `export_listing` shows none of them. Every art row in a band
  carries the *band's* address (`8E40`, `8E40`, `8E40`...), so there is no row
  for `$8E58` to attach to.
- **Labels inside it render nowhere either.** Same test, same result.
- **And the region's own comment renders TWICE** - once before the labels and
  once after. My `$8E00` comment is 30 lines; the listing prints 62 lines of
  comment for 8 lines of picture.

A text or data region behaves correctly: my 26-line comment at `$882C`, inside
`statusLineCharTable`, renders exactly once, in the right place. So this is
specific to the region kind whose entire purpose is "look at this data" - the one
place per-item annotation matters most. Naming which glyph is the player ship is
the *whole job* on a character set, and it is the one thing that cannot be shown.

I worked around it by moving the content into the region-start comment and adding
a note telling a reader that the per-glyph annotations exist but are invisible.
That note should not have to exist.

### 3.2 There is no "who else touched this" anywhere

Three collisions with the lead in one hour, none of which any tool warned about:

1. **The cartridge header.** We both wrote `CartridgeHeader` and `ColdStart`,
   with the same names, 4 seconds apart. `changes_since(0)`, which I called
   *before* writing, returned an empty list.
2. **The charset decoder.** We independently decoded the font and each stored a
   decoder for it - `dec_3g1jgm` and `dec_wd8txj` - with the same mapping, within
   a minute. Neither of us thought to call `list_decoders` first, because on a
   project we both knew was blank there was no reason to.
3. **Constants.** Five values ended up with two names each (`CHAR_EMPTY` /
   `GLYPH_GRID`, `CHAR_SHIP` / `GLYPH_SHIP`, and three more). Two names for one
   value is *legal by design* - a value has no single meaning - so re64 cannot
   flag it, and it should not. But a listing that prints both in its equate block
   is worse than either.

The pattern: **the write side of this API is complete and the
who-else-is-touching-this side is not.** `changes_since` tells you what happened
after the fact and you have to poll it. `list_participants` tells you who is
connected. Nothing tells you that someone is working in `$8E00` right now, and
nothing warns that the name you are about to declare already exists for that
value.

Untangling collision 3 exposed the sharpest missing tool:

### 3.3 You cannot ask where a constant is bound

I needed to know which sites the lead had bound to `CHAR_EMPTY` so I could rebind
them before deleting it. There is no tool. `list_constants` reports a `uses`
field that was **`1` for a name bound at thirteen sites and `1` for a name bound
at one**, so it cannot answer it either. I ended up running `find_immediates` on
each value and regex-ing the *rendered operand text* out of the results - which
works only because the listing happens to print the bound name.

I called `find_constant_uses` once so it is in the transcript. Not found.

Related: **`bind_constant` will accept any site that loads the right value.** I
bound `$20` to a delay count by accident; the lead bound `$8D52` (a
`FanfareDelay` count) to `CHAR_SPACE`. Both look completely fine in the listing.
On this program `$20` is a space, a level cap and a delay in three different
places. The tool cannot know - but nothing helps you notice, either.

### 3.4 There is no way to find text through a decoder

I found the game's strings by luck and grind: `find_bytes "31 39 38 32"`
on the hunch that "1982" would be in a copyright line, then eyeballing the
`find_undecoded` spans for byte runs in `$20`-`$3F`.

On a project with a custom font, "show me every run of 4 or more bytes that
decodes to letters under decoder X" is the single most valuable orientation query
there is, and it is exactly the query the decoder mechanism makes possible. I
called `find_text` once. Not found.

`find_bytes` with `??` wildcards is genuinely good and did a lot of work here
(`BD ?? 88` found the status-line drawer immediately). It just cannot ask this.

### 3.5 Smaller things, in one list

- **`whoami` refuses `project`.** The brief says every tool takes it. First call
  of the run, rejected. Trivial, but it is the orientation call.
- **`changes_since` documents something its schema forbids.** The description
  says the cursor may be "the name of a tag"; the schema is `expected number`, so
  passing the tag name is rejected. I had to `list_tags` and copy the number out.
- **`remove_region` requires `start` even when you pass `id`.** The description
  makes a point of ids removing the inference - "an id says *this* region" - and
  the schema still marks `start` required, so passing only an id fails with
  `expected string, received undefined at start`.
- **`set_decoder` does not return the decoder's id.** You must call
  `list_decoders` before you can reference what you just created.
- **`list_constants` returns no ids** either, though `remove_constant` and
  `bind_constant` both take names, so it happens not to matter.
- **Argument-name misses cost three calls in the first ten**: `read_disassembly`
  takes `lines` not `limit`; `find_instructions` takes `from`/`to`, not the
  `operandStart`/`operandEnd` its description's language suggests;
  `export_listing` caps `lines` at 2000, so a 4K binary needs a paging loop. The
  error messages are excellent (`Unrecognized key: "limit"`), which is why this
  cost minutes rather than more.
- **One agent, two sessions.** I sent two concurrent requests with the same
  `X-Re64-Session: gfx` header and `list_participants` shows **`gfx/beryl` and
  `gfx/basalt`**. The lead has the same pair (`agate`, `amber`). So issuing
  parallel calls under one session handle mints separate leases with separate
  codenames, and one agent's work gets attributed to two names in the chat and
  the change log. Since parallel calls are the obvious way to be fast, this will
  happen to everyone.
- **`read_messages` returns `from`, not `author`.** Guessing wrong prints
  `[undefined]` for every message rather than erroring, which is the kind of
  quiet wrong answer this project is otherwise careful about.

### 3.6 What worked, and worked well

Worth saying, because the list above is long:

- **`run_decoder` is the tool of the run.** Writing a 12-line character-cell
  renderer and getting the font back as a picture, in one call, is what made the
  whole font readable. `set_decoder` plus `view: "snippet:<id>"` then made the
  game's own English appear in the listing for every consumer. That mechanism is
  right.
- **`find_instructions` with a range answers "what makes a sound" and "what
  draws" directly**, and it states its blind spot on every answer - the 15
  unresolved indirect accesses were reported every time, which is exactly what
  stopped me concluding "Gridrunner never writes the VIC" from a search that
  found four sites.
- **Constant folding earned its keep.** `STA ($02),Y` resolving to `$D018`,
  `$D020`, `$D021` with `pointerSetAt` naming the two instructions that built
  the pointer is the difference between finding the video setup in one call and
  reading 200 lines.
- **`run_block` settled the screen-to-colour-RAM trick in one call**, with
  `source` on every value so I could see what the answer rested on.
- **`routine_effects` on the main loop** listed the nine I/O registers touched
  per frame and let me state "no VIC register is written after start-up" as a
  fact rather than an impression.
- **`find_immediates`** is what turned "these glyphs look unused" into "`$0B`
  and `$0C` are loaded nowhere in the cartridge".
- **Chat carried real weight.** Posting the font map early meant the lead read
  `BATTLE STATIONS` without doing the work twice, and their reply told me they
  had taken the text side so I could go to sound. The three collisions all
  happened in the first ten minutes, before either of us had said anything.

---

## Artefacts in the run directory

| file | |
|---|---|
| `glyph-sheet.txt` | all 64 glyphs at pixel resolution with indices and names |
| `wordmark.txt` | GRIDRUNNER drawn from the cartridge's own font |
| `screen-mockup.txt` | title screen and in-play screen, reconstructed |
| `listing-gfx.txt` | full listing as of the end of the run |

In the project: 2 decoders (`dec_3g1jgm` text, `dec_faoggb` character cells),
a `bitmap` region over the font, text regions pointed at the decoder, 28
constants, about 60 constant bindings and about 35 comments, under the tag
`gfx-graphics-and-sound-done`.

## Appendix: the glyph sheet

```
$00 grid        $01 zapL        $02 zapB        $03 spark       
...##...        ####....        ...##...        ........        
...##...        ..#.....        ...##...        ..#.....        
...##...        ...#....        ...##...        .##.....        
...##...        ...#####        ...##...        #.#...##        
########        ...#####        #.####.#        ..#.##..        
...##...        ...#....        ##....##        ..##....        
...##...        ..#.....        #......#        ........        
...##...        ####....        #......#        ........        

$04 spark       $05 beam        $06 beam        $07 SHIP        
........        ....#...        ....#...        ...##...        
......#.        .....#..        ....#...        ..####..        
.....#.#        ..#####.        ...#....        .##..##.        
##..#...        ..#.....        ...#....        ...##...        
..##....        ...#....        ....#...        .######.        
........        ...#....        .....#..        ########        
........        ....#...        ......#.        ###..###        
........        ....#...        .....#..        ##....##        

$08 laser       $09 laser       $0a bomb        $0b ?           
...##...        ..####..        .#....#.        ........        
...##...        .######.        .##..##.        ##......        
...##...        .######.        ..#..#..        .###..#.        
..####..        .######.        ..####..        ...#####        
.######.        ..####..        ...##...        ...#####        
.######.        ...##...        ...##...        .###..#.        
.######.        ...##...        ..####..        ##......        
..####..        ...##...        ...##...        ........        

$0c ?           $0d droid7      $0e droid6      $0f droid5      
........        ........        ........        ...##...        
......##        ........        ........        ..#..#..        
.#..###.        ........        ...##...        .#.##.#.        
#####...        ...##...        ..####..        #.####.#        
#####...        ...##...        ..####..        #.####.#        
.#..###.        ........        ...##...        .#.##.#.        
......##        ........        ........        ..#..#..        
........        ........        ........        ...##...        

$10 droid4      $11 droid3      $12 droid2      $13 ?           
#..##..#        .##..##.        ..#..#..        ..##....        
.######.        #..##..#        .#....#.        .#...##.        
.#.##.#.        #.####.#        #.#..#.#        .#..#...        
########        .#.##.#.        ........        ########        
########        .#.##.#.        ........        ########        
.#.##.#.        #.####.#        #.#..#.#        ...#..#.        
.######.        #..##..#        .#....#.        .##...#.        
#..##..#        .##..##.        ..#..#..        ....##..        

$14 ?           $15 ?           $16 blast       $17 blast       
##......        ....#.##        ........        .#......        
######..        ..#.####        .#...##.        ..#....#        
.###..#.        .#..###.        ..#.#...        .....##.        
#####...        .#.####.        #.......        ........        
...#####        .####.#.        ...#.##.        ........        
.#..###.        .###..#.        ....#...        .##.....        
..######        ####.#..        ..#.....        #.....#.        
......##        ##.#....        .#....#.        .......#        

$18 droid1      $19 lbl         $1a lbl         $1b Y           
......#.        ........        ........        ##...##.        
#.......        ####..##        ......##        ##...##.        
........        ##.##.##        ......##        ........        
........        ####..##        ......##        .#####..        
........        ##....##        ......##        ..###...        
........        ##....##        ##.##.##        ..###...        
.......#        ........        ........        ..###...        
.#......        ........        ........        ..###...        

$1c Y           $1d H           $1e I:          $1f arrow       
##...##.        ........        ........        ........        
##...##.        ##..##..        ####....        ...#....        
........        ##..##..        .##..##.        ....#...        
.#####..        ######..        .##.....        .#####..        
..###...        ##..##..        .##..##.        ....#...        
..###...        ##..##..        ####....        ...#....        
..###...        ........        ........        ........        
..###...        ........        ........        ........        

$13 ?           $14 ?           $15 ?           $3f             
..##....        ##......        ....#.##        ...##...        
.#...##.        ######..        ..#.####        ...##...        
.#..#...        .###..#.        .#..###.        ...##...        
########        #####...        .#.####.        ...##...        
########        ...#####        .####.#.        ...##...        
...#..#.        .#..###.        .###..#.        ...##...        
.##...#.        ..######        ####.#..        ...##...        
....##..        ......##        ##.#....        ...##...        
```
