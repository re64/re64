# reader-2 — Gridrunner, one independent reading

Project `reader-2`, port 5167. Session codename `amber`.

Final state: 1480 instructions decoded, **179 addresses named by hand** (153 user
labels plus platform/auto), 26 regions, 132 comments, 48 constants across 67 bound
sites, 2 stored decoders. Of 924 unexplained bytes at the start, **16 remain**. Six
warnings remain and five of them are KERNAL entry points outside the layer.

The project began with one auto-generated label, no regions, no comments and five
decoded instructions.

---

## 0. Contamination — read this first

**My context named parts of this binary before I started, and some of it was
load-bearing.** The brief asks for this up front, so here it is in full.

### 0a. The project's own `CLAUDE.md` was loaded automatically

`/Users/marcus/Desktop/Privat/Projects/re64/CLAUDE.md` is in my system context. It is
a design document for re64, but it uses this exact binary as its worked example
throughout. It gave me, before I read a byte:

| From CLAUDE.md | What I then concluded |
|---|---|
| "`$807F` `CopyrightLine = *-$01`", "reads `(c) 1982 HES` through the charset at `$2000`", "`<= 1982` through any built-in encoding" | The copyright string at `$8080`, that it is 1-indexed, that the charset is at `$2000` |
| "`$83E2` `PLA TAY PLA TAX PLA RTI` — an interrupt handler restoring registers" | My reading of the NMI vector |
| "`$87FE` `PLA PLA RTS` — a routine that discards its own return address" | My note at `$87FE` |
| "`LDA SCREEN_RAM + $000F,X`", "`dat_040F`", "forty-one sites … every screen coordinate" | That `$040F` is a meaningful screen field |
| "`laserFrameRateForLevel`", "execution arriving two bytes before the end of" it, near `$8D16` | That there is a per-level table ending just before `$8D16` |
| "`PlayNewLevelSounds` — a routine nothing in the analysis reaches", following a table | That the code after that table makes a noise |
| "`DisplayTitleScreen`" at `$8D8E` | My `TitleScreen` |
| "`selectedLevel`" at `$35` | My `LevelNumber` |
| "`$1A` … `leftLaserYPosition`", "`laserAndPodInterval`" | `$1A` is a Y coordinate of a beam; that "pods" exist and have an interval |
| "`droidXPositionArray-1,X`" | That there are 1-indexed position arrays |
| "`b81BC` … two call sites both inside `DrawGrid`" | That `$81A2`–`$81BC` draws the grid |
| "`LEFT_ZAPPER = $01`, `BOTTOM_ZAPPER = $02`" | Char `$01`/`$02` are the two edge markers |

### 0b. **The MCP tool descriptions themselves leak the answer key**

This one is not my environment's fault and it will contaminate every reader on this
server. Tool descriptions quote the reference disassembly by name:

- `add_label`: *"the reference calls `$08` **randomValue** throughout and **gridXPos**
  inside one routine, which is a finding about the program."*
- `set_constant`: *"a value has no single meaning, and the reference disassembly names
  `$01` both **LEFT_ZAPPER** and **WHITE**."*
- `set_label` / `set_region` similarly use `SCREEN_RAM + $000F` and `GRID = $00` /
  `ORANGE = $08` as examples.

I read the whole tool list before starting, as instructed. So I began knowing that `$08`
is a grid X position, that `$01` is both a left-hand zapper and the colour white, that
`$00` is called GRID and `$08` ORANGE. Those are four real findings about this binary,
handed to every agent by the schema. **Sanitising the filesystem does not close this
channel.** For a convergence experiment this is serious: it is a shared prior injected
identically into all five readers, which is precisely the contagion the experiment is
designed to exclude.

### 0c. What is clean

Everything below is derived from the bytes and I would stand behind it with the above
removed, **except** the rows in 0a. Specifically clean, because nothing in my context
pointed at them:

the cartridge header and both vectors; `PlotCharColour` and the `+$D4` colour-RAM trick;
the screen row-address table; the whole main-loop structure and its nine subsystems;
**the complete 64-glyph font map and four of the five strings** ("BY JEFF MINTER",
"ENTER LEVEL nn", "BATTLE STATIONS", "ENTER GRID AREA nn", and the "PRESS FIRE TO BEGIN"
half of the copyright line); score/high-score/lives living in screen RAM as characters;
the snake follow-the-leader and split-on-hit mechanics and their scoring; the pod growth
ladder and its reverse-on-hit; the dropper slot table and the `$20` boundary sentinel;
the eight-direction death animation and its overlapped delta table; the three difficulty
tables; the P-key pause; the title-screen level select; the `$00`-vs-`$20` distinction;
and the dead-code inventory.

---

## 1. What I concluded

### It is a cartridge, not a program

`$8004` holds `C3 C2 CD 38 30` — the CBM80 autostart signature. So this 4K image is
mapped at `$8000`–`$8FFF` and the first four bytes are vectors, not code: `$8000` →
`$83C1` (RESET), `$8002` → `$83E2` (NMI). Nothing decoded from the project's original
`$8000` entry point; marking `$83C1` a function took the program from 5 instructions to
1474.

`ColdStart` does the four standard KERNAL calls (IOINIT, RAMTAS, RESTOR, CINT),
re-enables interrupts and **leaves them enabled for the whole game** — the ROM IRQ keeps
running, which is how `$C5` stays current for the pause key. It then sends PETSCII `$08`
through CHROUT to lock out the shift+Commodore charset toggle. The `STA $D016` two
instructions earlier is dead: CINT reloads the entire VIC block over it.

The NMI vector is odd. `PLA TAY PLA TAX PLA RTI` consumes the interrupt frame with the
three pulls and then `RTI` takes its status and return address from whatever is below.
It is the *exit* half of an interrupt handler with nothing in front of it. My reading:
the handler was never written and the vector was pointed at the only `RTI` in the ROM,
so RESTORE crashes rather than being ignored.

### The display

`$D018 = $18` — screen RAM at `$0400`, character generator at `$2000` — written through
a `($02),Y` pointer at `$8108`, which is why no reference search over `$D000`–`$D02E`
finds it. `$D020`/`$D021` both zero: black on black. VIC bank 0 throughout; nothing
touches `$DD00`.

`CopyCharSetToRam` copies 512 bytes from `$8E00` to `$2000` — **a hand-made 64-glyph
font**, and decoding it is the single most productive thing I did. The full map is in the
project (`CharSetSpan` at `$8E00`, which renders as a picture in the listing) and in a
stored decoder. Summary:

```
$00 grid intersection      $07 player ship          $13-$15 snake segment, 3 frames
$01 left edge marker       $08/$09 shot, 2 frames   $16-$18 player debris, 3 frames
$02 bottom edge marker     $0A falling dropper      $1B/$1C letter Y (twice)
$05/$06 zapper beam        $0D-$12 + $18 pod        $1D/$1E "HI"
$20 true blank             $21-$3F alphabet, digits, (c) across $3C-$3D, bar at $3F
```

The alphabet is **not** in any C64 encoding and not alphabetical: `G=$21 R=$22 U=$23
I=$24 D=$25 N=$26 E=$27 A=$28 B=$29 F=$2A H=$2B J=$2C M=$2D P=$2E S=$2F O=$30 T=$3A
V=$3B L=$3E`, `Y=$1B`, digits 1–9 at `$31`–`$39`, and **`$30` does duty as both the
letter O and the digit 0**. There is no C, K, Q, W, X or Z — the font holds exactly the
letters the game prints and nothing else, which is how I knew the map was right rather
than plausible.

Five strings cross-check it, and all five come out clean:

```
$8820  GRIDRUNNER  ..  0000000  HI 0000000  <ship>  4     (status line, row 0)
$8080  (c) 1982 HES  PRESS FIRE TO BEGIN                  (title, row 10 col 2)
$8DE1  BY JEFF MINTER                                     (title, row 6 col 11)
$8DF1  ENTER LEVEL 00                                     (title, row 8 col 11)
$8C51   BATTLE  STATIONS                                  (wave start, row 6 col 14)
$8C63  ENTER GRID AREA 00                                 (wave start, row 8 col 14)
```

Four glyphs — `$03`, `$04`, `$0B`, `$0C` — are drawn in the font and never used by
anything: no instruction writes them, they are in no text table, they are not pod stages.
`$1C` is a second unused copy of Y.

### The primitive everything is built on

`PlotCharColour` at `$8172`, 35 callers, more than any other routine. It writes
`PlotChar` to screen RAM at `(PlotColumn, PlotRow)` and `PlotColour` to the matching
colour cell, using one pointer for both: screen row high bytes are `$04`–`$07`, and
adding `$D4` turns them into `$D8`–`$DB`, which is colour RAM. I demonstrated it rather
than asserting it — `run_block` at `$8175` with `$06/$07` = `$0528` writes `$052B` and
`$D92B`.

Arguments arrive in four zero-page bytes rather than registers, which is why nearly every
routine in the game ends by writing `$02` and `$03`. `ScreenRowAddress` at `$8163` turns
`PlotRow` into a pointer via a 24-entry table at `$0340`/`$0360` built once at startup.
**24 rows, not 25** — the bottom screen row has no table entry and is never cleared.

The one subtlety that unlocks the collision system: **`$00` and `$20` are both blank on
screen but mean different things.** `$20` is the true blank glyph and fills everything
outside the play area; `$00` is the grid intersection and fills rows 2–21, columns 1–38.
Droppers stop when they reach a `$20`; the player may only stand on a `$00`. The boundary
is encoded in the character set.

### The main loop

There is no interrupt handler and **no raster sync**. Everything is a free-running loop:

```
MainLoop  PauseOnPKey
          UpdatePlayer          read stick, move and redraw the ship
          UpdateBullet          fire, advance, resolve what the shot hits
          UpdateZapperMarkers   crawl the two edge markers; arm a beam when due
          UpdateZapperBeam      sweep a live beam across the grid
          GrowPods              age every pod on screen one stage
          UpdateDroppers        move every hatched dropper down a row
          UpdateKillSound       run the descending SID sweep after a kill
          UpdateSnakes          move every snake segment
          ReloadPlayerTimer
          CheckWaveComplete
          21 iterations of DEX, then round again
```

Each subsystem has its own countdown in zero page and acts when it hits a **particular
value**, not zero — `PlayerTimer == 0`, markers at `PlayerTimer == 1`, the beam at
`BulletTimer == 5`, pods at `PodSpawnTimer == 5`. Testing for a value rather than for
zero is what spreads the heavy passes onto different iterations instead of landing them
all on the same one. It also means frame time depends on how much work there is, which is
why the game speeds up as the screen empties.

### The three enemies

**Zappers.** Two markers crawl the edges — an arrow down column 0, another along row 22.
When `PodSpawnTimer` expires they fire: a vertical beam down the bottom marker's column
and a horizontal beam sweeping along the left marker's row. The beam kills the player on
contact (`BeamCellHitsPlayer` at `$8020` reads the next cell and jumps straight to
`PlayerKilled`). When the sweep finishes it leaves a pod at the intersection. That is the
only source of pods.

**Pods.** Seven growth stages held in `PodStageTable` at `$871F`: `$18 $0D $0E $0F $10
$11 $12`. `GrowPods` does not track them — it **scans the whole screen**, `$0450` to
`$07FF`, and replaces any byte matching a table entry with the next one. So every pod
ages one stage per call and nothing has to remember where they are. A shot walks the same
table *backwards*: a hit knocks a pod back one stage, and it only dies from the smallest.
The number of shots a pod costs is therefore the number of stages it has grown. A pod
that reaches the last stage hatches into a dropper.

Pods are **obstacles, not hazards** — `PlayerBlockedByPod` cancels the move rather than
killing.

**Droppers.** Character `$0A`, falling one row per 64 passes. Their positions are kept as
raw screen pointers in `DropperScreenLo`/`Hi` (24 slots, `$FF` = free), so a step is an
add of 40 and no coordinate arithmetic is needed. A dropper destroys whatever is in its
path, kills the player on contact, and frees its slot when it hits a `$20`. If all 24
slots are busy a fully grown pod just stays put and is offered again next scan — a
graceful cap that costs one comparison.

**Snakes** — the centipede, and the best-engineered part of the program. Segments walk
into the grid at column 10, row 2. Only the head steers; every other segment copies the
position of the one in front, which is why the array is walked tail-first. Per-segment
flags at `$1300` carry bit7 visible, bit6 head, bit1 moving-left. The head steps sideways
until it is blocked, then drops a row and reverses; past row 21 it re-enters at row 14,
column 2.

Shooting a body segment removes it by shifting the array down over it **and patches the
following segment's flags to make it a head** — which is what splits a snake in two, and
is the whole reason a head is a flag bit rather than "index 1".

Score for a snake hit depends on **which animation frame was on screen**: character `$13`
scores 100, `$14` and `$15` score 400.

### Score, lives, waves

The score is not a number anywhere. It is seven characters in screen RAM at `$040F`
(row 0, columns 15–21), and the high score is seven more at `$041B`. `AddScore`
increments a digit cell, wraps `'9'+1` back to `'0'` and carries left. `CheckHighScore`
compares them character by character. Lives are the single character at `$0427`, set to
`'4'` at the start of a game; the game ends when it would reach `'0'`.

Difficulty is three tables indexed by wave number, `$8CB4` (snakes), `$8CD4` (segments
each), `$8CF4` (frames between pods, falling from `$10` to `$05`). Level 13 looks wrong —
16 snakes where its neighbours have 5 and 6 — until you read the length table alongside
it and see that level 13's snakes are 3 segments long. It is a designed swarm wave, and
level 29 is the same idea. **Reading one table alone would have produced a confident
false bug report.**

The title screen offers a **level select**: joystick up steps the starting wave 1..31,
fire begins. It compares the whole port byte (`$EF` = fire alone, `$FE` = up alone), so a
diagonal or fire-with-direction is ignored.

### Craft notes

Three routines end with `PLA PLA` before returning — `$87FE`, `$8801`, `$8A33` — so they
return to their **caller's caller**, abandoning the rest of `UpdateBullet` for that pass.
That works only because `PlayerKilled` re-bases the stack (`LDX #$F6 / TXS`) on every
death, so the imbalance never accumulates. It is also fragile: inserting one call level
between `UpdateBullet` and `BulletHitsPodOrSnake` would break it silently.

`DebrisDeltaTable` at `$8BC0` is ten bytes read at two offsets eight apart, so one table
gives both the column and the row delta and the eight pairs come out as the eight compass
directions. The step is done by incrementing twice, once, or not at all and then always
decrementing, turning `$01`/`$00`/`$80` into `+1`/`0`/`-1` with no signed add.

The ROM is full of leftovers, all now declared and commented: `$8180`–`$8185` loads and
stores `$07` unchanged; `$834E`–`$8357` reads and writes back `$2A` and `$2B`; `$8D57`
does `LDA $35 / STA $35`; and eight spans of unreachable code — `$801D`, `$802B`,
`$83F0` (with a dead `JMP` in it), `$8984`, `$8AD4`, `$8AF1`, `$8B5D`, `$8DCB`. `$8DCB`
holds `B0 8D`, the address of `TitleInputLoop` as a word nothing reads.

Every `CLC` is followed by `SBC` in six places (`$8276`, `$828A`, `$829B`, `$82C7`,
`$82E2`, `$8698`), which subtracts one more than it looks like it does. Consistent enough
to be a habit rather than a slip, and I did not "fix" it into a claim.

---

## 2. What I could not work out

- **The two glyphs at status-line columns 12–13** (`$19`, `$1A`). By position and by
  symmetry with `$1D $1E` = "HI" they should read "SC", but the bitmaps do not resolve
  into those letters at any segmentation I tried, and `$1D` is unmistakably an H so I know
  what the small font looks like. Recorded as unread rather than guessed.
- **Whether the NMI handler is a bug or a deliberate crash.** The bytes are unambiguous;
  the intent is not. Running it would settle it.
- **What the sound actually sounds like.** I can say exactly which SID registers each
  routine writes and in what order, but "descending noise sweep" is a description of
  registers, not of a noise.
- **Real-world timing.** With no raster sync, "the player moves every 129 passes of the
  main loop" cannot be turned into a frame rate without executing the loop with a cycle
  count.
- **Why four glyphs are unused.** They look like an abandoned animation, but that is a
  guess about a person, not a reading of bytes.

What would have let me: an emulator, or a `run_routine` that follows `JSR`s. Everything I
could not settle is a question about *behaviour over time*, and every tool here except
`run_block` answers questions about structure.

---

## 3. Where the tools got in the way

Blunt, in rough order of how much time each cost.

### 3.1 `routine_effects` and every `inRoutine` field are confidently wrong on this program

This is the worst one and it is not a small error.

```
routine_effects("$8C17")  ->  routine: "$8020 (BeamCellHitsPlayer)"
                              blocks: 115
                              spans: 17 disjoint ranges from $8015 to $8DCA
routine_effects("$80E5")  ->  identical answer
```

`$8C17` is `LoseLife`, ten instructions. `$80E5` is `ResetScoreAndLives`, nine. They are
in completely different parts of the game. The tool says both of them **are** a ten-byte
routine at `$8020`, and hands back a 115-block extent covering most of the cartridge.

The cause is structural: this game's top level is a chain of `JMP`s, not `JSR`/`RTS`.
`StartWave` jumps to `WaveStartFanfare` jumps to `BeginPlay` jumps to `MainLoop`; death
jumps out of arbitrary depth and re-bases the stack. A flow-derived extent therefore
swallows the entire non-subroutine half of the program into one blob and names it after
whichever labelled address the walk started from.

The tool description anticipates the mechanism — *"a routine that tail-jumps away is in
two places and no single span describes it"* — and then returns a single confident name
anyway. It should refuse. "This address is in a flow region with 115 blocks and no single
entry; I cannot name one routine" would have been useful. `$8020 (BeamCellHitsPlayer)` is
a lie I would have believed if I had asked it before reading the code instead of after.

Everything downstream inherits it. `find_references($040F)` reports the high-score
comparison at `$8062` as being *in* `SnakeHeadBlocked`. `find_instructions` for the SID
range reports all 66 sites as *in* `ColdStart`. Those fields are the fastest way to orient
in an unfamiliar binary and on this one they are noise dressed as signal.

**This is the finding I would fix first.** A 1983 hand-written game whose control flow is
a JMP web is not an exotic case; it is the normal case for the era this tool targets.

### 3.2 `find_instructions` over a hardware range finds almost nothing, and does not say why

The description sells this hard: *"$D000-$D02E is the VIC-II … So 'what makes a sound' is
stores into $D400, and 'what draws' is stores into $D000."*

```
find_instructions(from:$D000, to:$D02E)  ->  total: 1
```

One site. It is `STA $D016` in `ColdStart` — the one VIC write in the entire program that
**has no effect**, because CINT overwrites it three instructions later. Every write that
matters (`$D018` deciding where screen RAM and the character set live, `$D020`, `$D021`)
goes through `STA ($02),Y` and is invisible.

So the tool's headline use case, on this binary, returns exactly one dead instruction and
nothing else. `find_references` states its absolute-addressing blind spot on every answer;
`find_instructions` does not, even though it is the tool whose description most encourages
you to trust a negative result. A reader who asked "does this program touch the VIC?" and
got `total: 1` would conclude something false.

### 3.3 There is no way to declare a game's own character encoding, and choosing the wrong one is worse than choosing none

Every string in this cartridge is in a font the game ships. `set_region encoding` accepts
`ascii | petscii | screen` and nothing else. I tried what I wanted first, twice:

```
set_region(..., encoding: "custom")        -> refused
set_region(..., encoding: "charset:$8E00") -> refused
```

So the honest options are (a) declare it `data` and lose the fact that it is text, or (b)
declare it `text` with an encoding that is wrong. I took (b) and the listing now reads:

```
8DF1  EnterLevelSpan:
8DF1  27 26 3A 27 22 20 3E 27  .TEXT "'&:'" >'"
```

The true text is `ENTER LEVEL 00`. I had to put a six-line comment above every text region
saying *do not read the decoded column below*, which is an absurd thing to have to write.
A text region that renders confident nonsense is a trap for the next reader, and the
`encoding` field being an enum of three C64-native options is what forces it.

The project *already has* the missing mechanism twice over: `set_region kind:bitmap
view:char:8` draws the font correctly in the listing (this works well, see 3.9), and
`set_decoder` stores a byte-to-glyph function. What is missing is one link —
`encoding: "charset:<address>"`, or a decoder id on a text region. `CLAUDE.md` already
flags custom character sets as unsolved; this run is the concrete cost.

### 3.4 `routine_effects` answers "memory at a computed address" for the routine that matters most

The description's pitch is *"`writes $(0xD418)` says it makes a noise whatever it is
called."* Asked about `PlotCharColour` — 35 callers, the routine the whole game is drawn
with — it says:

```
writes: [ A, Z, N, C, V, $(0x7), "memory at a computed address" ]
```

Which is true and worth nothing. The interesting fact about that routine is *where* the
computed address goes: two writes `$D400` apart, one to screen RAM and one to colour RAM.

`run_block` answered it in one call, exactly and with provenance for every value read. So
the concrete tool is excellent and the abstract one is not. If `routine_effects` could say
"a store through `($06),Y` where `$07` is `$04`–`$07` here and `$D8`–`$DB` after `$817C`"
it would be the best tool in the set; as it stands its answer for indirect addressing is a
shrug, and indirect addressing is how a 6502 program writes to the screen.

### 3.5 `run_block` is the best tool here and it is scoped one notch too small

"One block only, deliberately" is defensible, but the block at `$8172` is **one
instruction** — the `JSR` ends it. To execute the routine I had to notice that and restart
at `$8175`, having first read the code closely enough to know the call was harmless. On a
program where the interesting unit is a twelve-instruction subroutine spanning two blocks
that is a manual step every time.

I called the tools I wanted:

```
run_routine($8172)        ->  Tool run_routine not found
trace($83C1, steps:200)   ->  Tool trace not found
```

A `run_routine` that steps over `JSR`s (or takes `stopAt`), or a bounded `trace`, would
have answered most of section 2. Note the asymmetry: the *analysis* tools all model static
structure, and the one execution tool is capped below the granularity of the things being
analysed.

### 3.6 No byte-pattern search

```
find_bytes("C3 C2 CD 38 30")  ->  Tool find_bytes not found
```

The very first thing I needed to know about this image was whether it was a PRG or a
cartridge, and that is a five-byte signature test. I did it by pulling all 4096 bytes with
`read_bytes` and eyeballing hex. That worked, but "is there a known magic number in here"
is the opening question on every binary and there is no tool for it. `run_decoder` can be
abused into one; it should not have to be.

### 3.7 No way to declare a 1-indexed table, and this ROM has a dozen of them

Twelve tables here are indexed from 1 with a filler byte at index 0 (`$871F`, `$881F`,
`$8847`, `$807F`, `$8BC0`, `$8C50`, `$8C62`, `$8DE0`, `$8DF0`, `$8CB4`, `$8CD4`, `$8CF4`).
The code says `LDA $871F,X` with X from 1.

`extent` names a forward span, so I must either label `$871F` — making the filler byte part
of the array, which is what I did — or label `$8720` and read `PodStageTable-1,X` forever.
Neither says what the code means. I asked for what I wanted:

```
set_label($8CB4, "SnakesPerLevel", indexBase: 1)  ->  Unrecognized key: "indexBase"
```

`CLAUDE.md` discusses this idiom explicitly (`table-1,X`, "the 1-indexed table idiom") and
concludes that the ±1 tolerance covers it. It covers the *rendering*; it does not let you
state the fact. One extra field would.

### 3.8 `find_references` cannot distinguish a read from a write

```
find_stores($0427)  ->  Tool find_stores not found
```

`find_references($0427)` returns four sites all typed `"data"` — an `STA`, a `DEC`, an
`LDA` and an `INC`. "Who *writes* the lives counter" is the question you actually ask
about a variable, and answering it meant reading the `text` field of every hit by eye. The
`type` field already distinguishes `call`/`jump`/`branch`/`data`; splitting `data` into
`read`/`write`/`modify` is free information the disassembler already has.

### 3.9 Things that worked well, so they are not lost

- **`run_block` is outstanding.** Every result reports which memory it read and where each
  value came from (`"source": "given"` vs `"unknown"`), and it warned me that the `RTS` was
  returning to an empty stack rather than pretending it knew. Exactly the right register.
- **`run_decoder` turned the project around.** Rendering the font as ASCII art is what made
  every string in the ROM readable, and it is the single highest-value thing I did.
  `set_decoder` then let me leave that capability in the project for the next reader, which
  is a genuinely good design.
- **`kind: bitmap, view: char:8` draws the font in the exported listing.** I expected to
  have to look at it out of band; instead `export_listing` at `$8E00` shows the glyphs.
- **The refusals are well written.** `"$8495 takes no immediate operand, so there is no
  value to name"` and `"$8023 loads $07, but KEY_P is $29"` told me precisely what I had
  got wrong (I was targeting `LDA` addresses instead of `AND` addresses). Twelve refusals,
  zero confusion.
- **`set_labels` / `set_comments` batching.** 179 labels in five calls. The per-call round
  trip would have dominated the session.
- **Every write returning an instruction delta.** `mark_function($83C1)` → `delta: 1474`
  is the moment the project became legible, and the number said so.

### 3.10 Smaller friction

- **`whoami` rejects `project`** while every other tool requires it. One wasted call.
- **Four different container keys** for list results: `sites` (`find_instructions`),
  `spans` (`find_undecoded`), `inbound` (`find_references`), `lines` (`read_disassembly`).
  I printed an empty list from `find_instructions` and briefly believed the tool was
  broken, when I had guessed `instructions`.
- **`export_listing` caps `lines` at 2000** but the cap is only discoverable by exceeding
  it. Minor, and the error is clear.
- **No way to read back everything I have written as one document** to proofread it.
  `list_comments` gives comments and `list_labels` gives labels; there is no "show me my
  annotations" view, and `export_listing` interleaves them with 1800 lines of code.
- **No first-class home for a derived mapping.** The font map — byte to letter — is the
  most valuable single thing I worked out, and the only places to put it are prose inside
  comments and a JavaScript body inside a decoder. It is a *fact about the project* that
  five different regions depend on, and it lives as duplicated prose in six comments.

---

## 4. What I would tell the next person

1. **`$8004` first.** It is a cartridge. Mark `$83C1` a function and 1474 instructions
   appear out of nothing. Do not spend time on the `$8000` entry point.
2. **Decode the font before you read any code.** `run_decoder` over `$8E00`, 512 bytes,
   eight bytes per glyph. Every string in the ROM becomes readable at once, the glyph codes
   stop being magic numbers, and half the collision logic explains itself — `$07` is a
   ship, `$0A` is a bomb, `$18`→`$12` is a thing growing. Two decoders are already stored
   in the project; run them.
3. **`$00` and `$20` are both blank and mean opposite things.** Inside the grid versus
   outside it. Every boundary test in the game is that comparison. If you miss it, the
   dropper and beam code look arbitrary.
4. **`PlotCharColour` at `$8172` is the spine.** Read it, then read `$8163`, then note that
   the calling convention is four zero-page bytes. After that every routine in the game
   reads the same way: set `$02`–`$05`, call, repeat.
5. **The score is characters in screen RAM.** There is no binary score. If you go looking
   for one you will waste an hour.
6. **Do not trust `inRoutine` or `routine_effects` on this binary** (see 3.1). The top
   level is a `JMP` chain and the extent analysis collapses it into one 115-block blob.
   Read the flow yourself; it is only 1480 instructions.
7. **Read the three difficulty tables together, not one at a time.** `$8CB4` alone makes
   level 13 look like a typo. `$8CD4` alongside it makes it a swarm wave.
8. **Expect leftovers and do not rationalise them.** Eight unreachable fragments, a dead
   VIC write, three no-op read/write pairs, four unused glyphs, and an NMI vector that
   cannot work. All declared in the project. A thing that makes no sense here genuinely may
   not make sense.
