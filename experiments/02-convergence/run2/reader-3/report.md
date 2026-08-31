# reader-3 — Gridrunner, one independent reading

Project: `reader-3` · port 5167 · session codename `basalt`
Final state: 1522 instructions decoded, 175 addresses named by hand, 26 regions,
26 constants, 46 constant bindings, 1 stored decoder, 118 unexplained bytes left
out of 4096 (all of it commented dead space).

---

## 0. Contamination declaration — read this first

**My context was contaminated before I started, from two sources, and one of them
is the tool descriptions themselves.**

### Source 1: `CLAUDE.md`, loaded automatically as project instructions

The repo's own `CLAUDE.md` uses this exact binary as its worked example
throughout. Before I ran a single tool I had been told, in prose:

- `$83E2` is `PLA TAY PLA TAX PLA RTI`, "an interrupt handler restoring registers"
- `$87FE` is `PLA PLA RTS`, "a routine that discards its own return address"
- `$8D16` is `laserFrameRateForLevel`, and flow arrives two bytes before its end
- the names `DrawGrid`, `DisplayTitleScreen`, `PlayNewLevelSounds`,
  `selectedLevel`, `droidXPositionArray`, `randomValue`, `gridXPos`,
  `leftLaserYPosition`, `laserAndPodInterval`, `CopyrightLine`, `SCREEN_RAM`
- `LEFT_ZAPPER = $01`, `BOTTOM_ZAPPER = $02`, `WHITE = $01`, `RED = $02`
- that `$8D5A` and `$8737` are mid-instruction labels used by the reference
- that the copyright line reads `(c) 1982 HES` through a charset at `$2000`
  and `<= 1982` through any built-in encoding
- that zero page holds most of the variables, and `$1A` is a laser Y position
- that the game is Gridrunner, by name

That is a large fraction of the answer key, in prose, in the system prompt.

### Source 2: the MCP tool descriptions

`add_label`'s description says *"the reference calls $08 randomValue throughout
and gridXPos inside one routine"*. `set_constant`'s says *"GRID = $00, ORANGE =
$08"* and *"the reference disassembly names $01 both LEFT_ZAPPER and WHITE"*.
These are shipped with the server. **Any reader of this binary, in any future
run, sees them.** They are not removable by isolating the project.

### What I did about it, and which conclusions are affected

I derived everything below from the bytes and flagged the overlaps. Concretely:

| Fact | Status |
|---|---|
| Game is Gridrunner, by Jeff Minter, HES, 1982 | **Independently derived** — decoded from the ROM's own strings after solving the font. But I was told the title in advance, so I cannot claim I would have looked as hard. |
| `$83E2` is an NMI stub | **Independently derived** — it is the target of the cartridge header word at `$8002`, which is the KERNAL's NMI vector. I knew the opcodes in advance. |
| Charset lives at `$2000` | **Independently derived** — from `$D018 = $18` at `$8100` and the copy loop at `$82EC`. I had been told the number. |
| `$87FE` discards its return address | **Contaminated** — I knew this before reading it. I did work out *why* (it is `ShotHitGrowth` unwinding out of `MovePlayerShot`'s move step), which the source did not say. |
| The custom alphabet ($21=G, $22=R, …) | **Clean.** Nothing in my context contained it. Solved from word shapes and cross-validated. |
| Colour and glyph constants | **Partly contaminated** in naming (`ORANGE`/`$08`, `WHITE`/`$01` were handed to me), clean in placement. |
| Pod growth chain, wave/level tables, droid snake, scoring, frame counter, dead code | **Clean.** |
| `$8D16` | I named it `LevelFanfare` from what it does. The prose called it `laserFrameRateForLevel`, which does not match what I read; my `LevelZapperRate` table at `$8CF5` is the nearest thing to that description. |

I did **not** open `assets/`, `src/`, or any other experiment directory.

---

## 1. What I concluded

### It is a cartridge, and that is where you have to start

The project's declared entry point is `$8000`, and disassembling from there
produces five instructions of garbage. `$8000` is not code. It is the standard
C64 autostart cartridge header:

```
8000  C1 83        cold-start vector -> $83C1
8002  E2 83        NMI vector        -> $83E2
8004  C3 C2 CD 38 30   "CBM80", PETSCII with bit 7 set
```

The KERNAL reset routine tests for that signature and jumps through `($8000)`.
Marking `$83C1` a function took the decode from 0 instructions to 1474. **The
single highest-value action in the whole session was recognising nine bytes as a
header.**

`$83E2` — `PLA TAY / PLA TAX / PLA / RTI` — is the NMI vector's target: it pops
the registers the KERNAL's NMI handler pushed and returns. RESTORE does nothing.

### There are no sprites, and the VIC is never written absolutely

`find_instructions` over `$D000-$D3FF` returns **one** instruction in the entire
ROM, `STA $D016` at `$83C5`, and that one is dead (it runs before `IOINIT` and
`E518`, both of which overwrite the register).

The real VIC access is at `$8100`:

```
8100  LDA #$D0 / STA $03 / LDA #$00 / STA $02   ; ptr = $D000
8108  LDY #$18 / TYA / STA ($02),Y              ; $D018 = $18
810D  LDY #$20 / LDA #$00 / STA ($02),Y / INY / STA ($02),Y   ; $D020 = $D021 = 0
```

`$D018 = $18` → screen at `$0400`, character generator at `$2000`. Border and
background black. Nothing else in the program touches the VIC. Everything you
see is a character in a 40x25 text screen.

### The screen is the data structure

This is the organising idea of the whole program:

- **Collision detection is `Peek`** (`$818B`, 9 call sites). Before moving, the
  player reads the destination cell; if the glyph is not `$00` (the grid) it
  asks `IsHarmless`. There are no bounding boxes and no object-to-object
  comparisons anywhere in the binary.
- **The score is its own display.** `scoreDigits` at `$040F` is seven screen-code
  characters on row 0. `AddScore` (`$8870`) increments them in place with decimal
  carry (`CMP #$3A` -> reset to `$30`, `DEX`). There is no binary score.
- **Lives are one character** at `$0427`, screen row 0 column 39.
- **The growing pods have no object list at all.** `GrowPods` (`$86D7`) scans all
  944 bytes of `$0450-$07FF` and advances any cell whose glyph appears in
  `PodGrowthChain` to the next glyph. A growth "exists" because a particular
  character is sitting in a particular cell. Only when one finishes hatching does
  it acquire a table slot.

### The custom character set, and the strings

`InstallCharSet` (`$82EC`) copies 512 bytes from `$8E00` to `$2000`: **64 glyphs**,
which is why every screen code this program writes is `$00-$3F`.

The alphabet is neither screen code nor PETSCII, so every string in the ROM reads
as punctuation to every built-in decoder. `$8080` renders as `<= 1982 +'/  ."'…`.

I solved it from word shapes rather than from the bitmaps. `2E 22 27 2F 2F` and
`2A 24 22 27` are 5 and 4 letters with a shared `27` and a doubled `2F`:
`PRESS FIRE`. `3E 27 3B 27 3E` is a palindrome: `LEVEL`. That gives
E, L, V, P, R, S, F, I, and the rest falls out:

```
$21 G  $22 R  $23 U  $24 I  $25 D  $26 N  $27 E  $28 A
$29 B  $2A F  $2B H  $2C J  $2D M  $2E P  $2F S  $30 O/0
$31-$39 = 1-9  $3A T  $3B V  $3C+$3D = the two halves of (c)
$3E L  $3F vertical bar     $1B and $1C are both Y
```

**The check that makes this certain:** the font contains exactly the twenty
letters this game needs — G R I D U N E A B F H J M P S O T V L Y — and no
C, K, Q, W, X or Z. A wrong mapping would not produce a gap shaped like that.
I then rendered all 64 glyph bitmaps and every letter matched.

The strings, decoded:

| Address | Text | Drawn at |
|---|---|---|
| `$8080` | `(c) 1982 HES  PRESS FIRE TO BEGIN` | `$0592` (row 10, col 2), yellow |
| `$8820` | `GRIDRUNNER  ?? 0000000  HI: 0000000  ^  4` | screen row 0 |
| `$8C51` | ` BATTLE  STATIONS ` | `$04FE` (row 6, col 14), light blue |
| `$8C63` | `ENTER GRID AREA 00` | `$054E` (row 8, col 14), white |
| `$8DE1` | `BY JEFF MINTER` | `$04FB` (row 6, col 11), cyan |
| `$8DF1` | `ENTER LEVEL 00` | `$054B` (row 8, col 11), white |

I wrote and stored a decoder in the project (`Gridrunner font text`,
`dec_zjckpq`) that renders any span through this alphabet, so the next reader
does not have to solve it again.

### Structure

```
ColdStart $83C1   SEI, CLD, IOINIT, RAMTAS, RESTOR, $E518, CLI, CHROUT #$08
     -> InstallCharSet $82EC   copy 64 glyphs $8E00 -> $2000
     -> InitScreen $8100       VIC via zero-page pointer; SID envelopes;
                               build screenRowLo/Hi; blank the screen
     -> DrawStatusLine $8806   40 chars + 40 colours over row 0
     -> DrawTitleScreen $8D8E  BY JEFF MINTER / ENTER LEVEL 00 / (c) line
     -> TitleInputLoop $8DB0   up = raise start level, fire = go
     -> StartNewGame $80E5     score = 0000000, lives = 4
     -> NextLevel $8C2D        BATTLE STATIONS, read the three level tables
     -> LevelFanfare $8D16 -> StartLevel $8300 -> MainLoop $8393
```

`MainLoop` is nine calls in fixed order:

```
MovePlayer, CheckPause, MovePlayerShot, MoveZappers, ZapperBeam,
GrowPods, MovePods, PlayExplosionSound, MoveDroids, KeepFrameCounter,
CheckLevelComplete
```

**There is no raster interrupt and no vertical-blank wait anywhere in this
program.** The loop free-runs with a 21-iteration `DEX` delay. Everything paces
itself off `frameCounter` (`$0D`), a counter that runs 128->0 and is reloaded by
`KeepFrameCounter`. `MovePlayer` acts when it hits 0, `MoveZappers` when it is 1,
the explosion sound on odd values. Game speed therefore depends on how much work
the loop happens to be doing.

### The game

- **Player** — glyph `$07`, light green, confined to columns 1-38 and rows 15-21,
  i.e. the bottom seven rows. One bullet at a time: fire is only read when
  `shotRow` is `$FF`.
- **Two edge zappers.** Glyph `$01` walks down column 0 (rows 3-21); glyph `$02`
  walks along row 22 (columns 1-38). They are outside the play area. Periodically
  `ZapperBeam` fires a cross: a full vertical line up the bottom zapper's column
  drawn and erased in one pass, plus a horizontal beam that advances rightward
  along the left zapper's row calling `KillPlayerIfHere` on every step. Reload
  interval comes from the per-level table.
- **Droids.** A wave is a snake. One member carries flag bit 6 and steers for
  itself — one column in the current direction, one row down, direction flipped
  by `EOR #$03`, teleported back to (2,14) at row 22. Every other member copies
  the position of the one before it in the table. The leader animates through
  glyphs `$13`->`$15`; followers are always `$13`.
- **Pods.** The growth chain `$18 -> $0D -> $0E -> $0F -> $10 -> $11 -> $12 -> $0A`,
  stepped forward by the whole-screen scan. The player's shot steps a cell one
  place *backward* down the chain, so a big growth takes several hits; reaching
  the first stage clears it and scores 10. A hatched pod gets a slot in a
  24-entry table and descends by adding 40 to its stored screen address.
- **Death.** Eight fragments from the player's cell fly out along the eight
  compass points, encoded in `DebrisDeltaX`/`DebrisDeltaY` as `$80`/`$00`/`$01`
  for -1/0/+1 (the mover always does one `DEC` and the caller does 0, 1 or 2
  `INC`s). Fifteen frames, falling volume. A fragment leaving the screen respawns
  at the player position, so the burst keeps refilling itself.
- **Pause is P** — `$C5` (KERNAL last-key matrix code) compared against `$29`.
- **Joystick is port 1**, read as `LDA $DC11 / EOR #$FF`. `$DC11` is not a typo:
  CIA 1 is mirrored every 16 bytes, so `$DC11` is `$DC01`. Notable because the
  game reads the port that shares lines with the keyboard matrix the KERNAL IRQ
  is still scanning, rather than the usual `$DC00`.

### Level data

Three 31-byte tables indexed by `levelNumber`:

| Table | At | Contents |
|---|---|---|
| `LevelWaveCount` -> `$2A` | `$8CB5` | `01 02 02 03 03 03 04 04 04 04 05 05 `**`10`**` 06 06 06 06 06 06 06 06 06 06 06 06 07 07 07 07 07 07` |
| `LevelWaveSize` -> `$2B` | `$8CD5` | `06 06 06 07 07 08 08 09 0C 0C 0A 0A `**`03`**` 0F 10 10 11 12 13 14 14 14 15 15 16 16 16 17 `**`03`**` 18 18` |
| `LevelZapperRate` -> `$34` | `$8CF5` | `10 10 10 0F 0E 0D 0C 0B 0A 09 09 09 09 09 09 09 08 08 08 08 07 07 07 07 07 07 07 07 07 06 06 05` |

Three outliers, and they are not equivalent:

- **Level 13** is anomalous in *both* of the first two tables (16 waves of 3,
  against 5x10 before it and 6x15 after). Total enemies stays smooth, so this
  may be deliberate — "level 13 is many tiny waves".
- **Level 29** has `$03` enemies per wave where its neighbours have `$17` and
  `$18`, with **no** compensating outlier. 7 waves x 3 = 21 enemies between
  neighbours of 161 and 168. That one looks like a genuine data bug.

I recorded both readings and said the data cannot distinguish them.

### Two behaviours I'd call findings rather than descriptions

**You gain a life every level.** `NextLevel` does `INC livesDigit` capped at `'9'`.
A death goes `LoseLife` (`DEC`) -> `ReplayLevel` (`DEC` again, plus `DEC
levelNumber`) -> `NextLevel` (`INC` both). The increments cancel to a net loss of
one life and the same level. The two counters are kept in step by cancelling
increments rather than by branching, which is why it is not obvious.

**The same droid is worth 100 or 400 points depending on its animation frame.**
`ShotHitDroid` (`$8A11`): glyph `$13` -> 100; glyphs `$14` and `$15` -> 300 at the
hundreds digit *and then* another 100, so 400. But `$13`, `$14` and `$15` are
three animation frames of one enemy, cycled by `MoveDroids`. Nothing else in the
program distinguishes them. Either a deliberate timing reward or an oversight;
the code cannot say, and the player has no way to see the difference.

### Development leftovers

The ROM is full of them and I marked each one:

- `$8180-$8184` inside `Plot`: `LDA $07 / LDA $07 / STA $07`. Loads a value twice
  and stores it back unchanged.
- `$834E-$8357` in `StartLevel`: five loads and stores of `$2A`/`$2B` to themselves.
- `$8D57-$8D5A`: `LDA $35 / STA $35`.
- `$81D7`: `DEY / BNE` to the very next instruction.
- `$8B58`: `LDA #$14` immediately overwritten; `$8B5D` an orphaned `DEX / BNE`.
- Unreachable fragments: `$8984` (an alternative droid iteration that counts *up*
  where `MoveDroids` counts down), `$8AD4` (a discarded player-collision test),
  `$8AF1` (a loop tail whose head is gone).
- `$8DCB` holds `B0 8D` — the address of `TitleInputLoop` — followed by 21 NOPs.
  A vector nothing reads, sitting in the string area.
- NOP fields at `$83F0` (sixteen, with a live-looking `JMP MainLoopEntry` buried
  inside), `$8361` (fifteen), `$837B`, `$839C`, `$802B`, `$801D`, `$80FE`,
  `$8C1A`, `$8A1D`. Patch space.
- `$8957`: `STA $0003` / `STA $0002` — absolute addressing of zero page, in a
  program that uses zero-page mode everywhere else.

---

## 2. What I could not work out

**Glyphs `$19` and `$1A`.** They are a second, much smaller font — four or five
pixels tall — used only as the label on the left seven-digit field, the one
`AddScore` writes to. Their neighbours `$1D`/`$1E` read clearly as a bold `H`, a
serifed `I` and a colon, giving `HI:` before the *right* field, which agrees with
that field being the hi score. `$19`/`$1A` I could not read. The first looks like
a `P` and the rest is a vertical stroke and a broken baseline; `P1` would fit the
position. **I did not name them**, because a wrong name here is worse than a gap.
What would have settled it: seeing the game run, or a glyph-shape matcher.

**Whether the level 13 and level 29 table outliers are bugs.** Nothing in the ROM
can answer this. Playing the game would.

**Why `$8009-$8014` exists.** Twelve bytes between the header and `CheckHiScore`
that are reached from nowhere and decode as nothing coherent. Marked as padding.

**`$8020`'s exact role in the beam.** I named it `KillPlayerIfHere` from what it
does, but I did not trace every path that reaches it via the shared `$8030`
wrap logic.

**The `$D016 = $05` write.** I can show it has no effect (two later KERNAL calls
overwrite it), but not why anyone wrote it.

---

## 3. Where the tools got in the way

This is the section that matters, so it is blunt.

### 3.1 `find_instructions` cannot see the only VIC access this program makes — and its own description tells you to trust it

The description says, in effect: *"the range is the meaning: $D000-$D02E is
the VIC-II … So 'what makes a sound' is stores into $D400, and 'what draws' is
stores into $D000."*

I did exactly that and got **one hit** across the whole ROM, and it was a dead
instruction. If I had believed the tool I would have concluded this game does not
touch the VIC at all. The truth is that every VIC write goes through
`STA ($02),Y` with `$02` holding `$D000`, and `find_instructions` only matches
literal operands.

I only caught it because "a C64 game that never writes the VIC" is absurd on its
face and I went and scanned the raw bytes myself. **A less suspicious reader gets
a confidently wrong answer here, and nothing warns them.**

Compare this to `find_references`, which *does* state its blind spot on every
answer, and `call_graph`, which says "sees absolute JSRs only" every time.
`find_instructions` has the same class of blind spot and says nothing.

**I called the tool I wanted:**

```
find_memory_access {"from":"$D000","to":"$D02E"}
  -> Tool find_memory_access not found
```

What I wanted was a search that follows a constant written into a zero-page
pointer. Failing that, `find_instructions` should at minimum append: *"indexed
and indirect accesses whose base is not a literal operand are not matched."*

### 3.2 There is no way to express a custom character encoding, and this binary is 100% custom characters

`set_region` offers `encoding: ascii | petscii | screen`. This game's font is
none of those, so **every string in the ROM is unreadable in the listing and
there is no way to fix that.** Six strings, including the title, the author and
the copyright.

```
set_region {"start":"$8080","length":32,"kind":"text","encoding":"custom",
            "charmap":{"$21":"G","$22":"R",...}}
  -> Invalid option: expected one of "ascii"|"petscii"|"screen" at encoding
     Unrecognized key: "charmap"
```

I had to declare the strings `data` instead — i.e. record "this is not text"
about six spans that are nothing but text — and put the decoded content in prose
in each region's comment, where nothing can act on it.

`run_decoder` is a genuinely good tool and it *almost* covers this: I wrote a
27-line decoder, stored it in the project, and it renders every string correctly.
But a decoder is something you run on demand and read the output of. It does not
change the listing. So the artifact a future reader opens still shows
`<= 1982 +'/  ."'`, and only finds the truth if they think to look at
`list_decoders`.

The gap is small and specific: **`kind:"text"` should accept a table, or a
decoder id.** The decoder machinery already exists; the region just cannot reach it.

Custom character sets are not exotic on this platform — the CLAUDE.md in this
repo already names them as unsolved. This binary is a clean demonstration that
"the wrong answer is now visible" is not enough, because the *right* answer has
nowhere to live.

### 3.3 Routine attribution silently names a routine that starts *after* the address

This one produces wrong answers that look right, and I pinned it down exactly.

```
call_graph {"address":"$8393"}          # MainLoop
  -> {"routine": "$801D (PatchSpace5)", ...}
```

`$801D` is a three-byte NOP field 5,494 bytes away. `call_graph` answered a
question about a completely different piece of code without any indication that
it had done so.

Reproduced and narrowed:

```
call_graph {"address":"$8470"}          # MovePlayer
  -> calledBy: [{from: "$8393", inRoutine: "$839C (PatchSpace3)"}]
```

`$8393` is nine bytes *before* `$839C`. So the call site was attributed to a
routine that begins after it.

I removed the `$839C` region and re-ran:

```
  -> calledBy: [{from: "$8393", inRoutine: "$83F0 (PatchSpace1)"}]
```

It jumped to the *next* region forward — even further away. Then:

```
mark_function {"address":"$8393","name":"MainLoop"}   # delta: 0
call_graph {"address":"$8470"}
  -> calledBy: [{from: "$8393", inRoutine: "$8393 (MainLoop)"}]
```

**The rule is: only `type:"function"` labels are routine heads. A `type:"code"`
label is invisible to attribution, and when nothing suitable precedes an address
the tool names something that follows it instead of saying it does not know.**

CLAUDE.md documents the fallback as "the nearest preceding flow label". It is not
preceding, and it is not any flow label — it is the nearest *function*, in either
direction. `find_references` inherits this: 3 of my 46 `Plot` call sites came
back attributed to dead-code regions.

`routine_effects` documents that "its extent is worked out from control flow, not
declared". It should say the same thing `find_references` says about absolute
addressing: **"attribution is by nearest function label; addresses inside code
with no function head above them will be named wrongly."** A wrong routine name
is not a degraded answer, it is a false one.

### 3.4 `set_region kind:"code"` creates a permanent entry point, and there is no way to remove one

The `set_region` description recommends `kind:"code"` for exactly what I used it
for. But every such declaration becomes a project entry point. After marking ten
dead NOP fields and unreachable fragments — which is *correct* annotation, they
are code — `describe_project`'s `entryPoints` array had 90 members, most of them
called `PatchSpace4`. That field is the first thing the orientation tool shows
and it became noise.

Worse, it fed 3.3: those regions became routine heads and corrupted attribution.
So the annotation that best describes the bytes is the annotation that degrades
the analysis.

The original `$8000` entry point has the same problem in reverse. It is the
cartridge *vector table*, not code, and declaring it data leaves a permanent
warning:

```
$8000: this analysis arrives here and it is declared data, so decoding stops.
```

Nothing "arrives" there — it is the seed. There is no way to say so:

```
remove_entry_point {"address":"$8000"}
  -> Tool remove_entry_point not found
```

Six warnings in a finished project, one of which is structurally unfixable and
five of which are just KERNAL ROM addresses being outside the layer. Warnings
that cannot be cleared stop being read.

### 3.5 `routine_effects` prints raw hex where every other tool prints labels

```
"reads":  ["$(0xD)", "$(0x14)", "$(0x15)", "$(0x16)", "$(0x17)", "$(0x34)", ...]
"writes": ["$(0xD412)", "$(0x18)", "$(0x19)", "$(0x1A)", ...]
```

By this point `$0D` was `frameCounter`, `$15` was `zapperRow`, `$34` was
`zapperRate`. The tool knows — the listing renders them. Instead it emits a
C-ish `$(0x..)` notation used nowhere else in the API, in an order that is
neither sorted nor grouped. The tool's own description sells it as *"`writes
$(0xD418)` says it makes a noise whatever it is called"* — which works for I/O
registers and falls apart for the 40 zero-page variables that are the actual
answer. I stopped using it after two calls; reading the listing was faster.

### 3.6 Batch tools are all-or-nothing, and report one error at a time

`bind_constants` with 46 bindings failed three times in a row, each time on a
different single entry, each time discarding all 46:

```
-> No constant called $27. Declare it first.
-> $8221 takes no immediate operand, so there is no value to name.
-> $8778 takes no immediate operand, so there is no value to name.
```

Four round trips for one action. The failures were all the same class (I had the
address of the `LDA` rather than the `CMP`), and all of them were knowable from
data the server already had. Either report every bad entry in one reply, or
apply the good ones and list the rejects. The tool's own pitch is that batching
exists because "one round trip each is almost all protocol" — which is
undermined by making a 46-item batch cost four round trips.

I ended up pre-validating the list against my own copy of the listing with grep
before the fourth attempt. That is the tool making me do its checking.

### 3.7 `export_listing` emits JSON containing raw control characters

```
json.decoder.JSONDecodeError: Invalid control character at: line 3 column 109
```

The data-row ASCII column passes bytes < `$20` through unescaped, producing
invalid JSON. Every strict parser rejects it. I worked around it with
`strict=False`, but a client that cannot relax its parser simply cannot read a
listing containing a data region — which is most listings.

### 3.8 The +/-1 label tolerance overrode an exact auto label, on a *branch target*

After I named `$8BFC` `ClearPlayfield`, three branches to `$8BFB` — which had a
perfectly good exact `loc_8BFB` — started rendering as:

```
8BEE  F0 0B      BEQ ClearPlayfield-1
```

`$8BFB` is an `RTS`. It has nothing to do with `ClearPlayfield`; it is the byte
before it. CLAUDE.md's stated rule is that fuzzy matching means "just before this
label", which encodes the 1-indexed-table idiom — a *data* idiom. Applying it to
a **control-flow target** invents a relationship that cannot exist: you do not
branch to one byte before a routine on purpose.

The rule should be: tolerance applies to data operands, never to branch or jump
targets, and never over an exact match that already exists at the address. I
worked around it by naming `$8BFB` explicitly, which is fine for me and useless
for the reader who does not notice.

### 3.9 Smaller things

- **`find_undecoded` was the best orientation tool here** and I would put it
  ahead of `find_unnamed` in the vocabulary listing. On a fresh project
  `find_unnamed` returns almost nothing (the whole binary was 5 instructions);
  `find_undecoded` immediately pointed at the 565-byte block that turned out to
  be the character set.
- **`run_block` is excellent.** Verifying `AddScore`'s decimal carry by running
  it with `$0415 = $39` and watching `$3A` come out took one call and settled a
  reading I would otherwise have argued from the opcodes. The `memoryRead`
  section reporting `"source": "given"` and resolving the label to
  `scoreDigits+6` is exactly right.
- **`extent` works well**, including the `droidCol-1,X` case, which is the one I
  expected to break.
- **No tool answers "what indexes this table".** `find_references` on `$8CB4`
  gives the `LDA $8CB4,X` sites but nothing tells me the index register's range,
  which is what makes a table 31 entries long rather than 256. I called
  `find_table_users` and it does not exist. I worked it out from `levelNumber`'s
  clamp, by hand, three times.
- **Region `comment` is the only place to put a paragraph about a data span**,
  and it works, but there is no way to comment an *element* of a table. The
  level-13 and level-29 outliers had to go in the region comment rather than on
  `$8CC1` and `$8CF1` where a reader would meet them.

---

## 4. What I would tell the next person

1. **`$8000` is not code.** It is a nine-byte cartridge header. Mark `$83C1` a
   function and 1474 instructions appear. Do this first; nothing else works until
   you do.

2. **The strings are in a private alphabet and you will waste an hour if nobody
   tells you.** It is solved and written into the `CharSet` region comment at
   `$8E00`, and there is a stored decoder (`Gridrunner font text`) you can run on
   any span. `$21=G $22=R $23=U $24=I $25=D $26=N $27=E $28=A $29=B $2A=F $2B=H
   $2C=J $2D=M $2E=P $2F=S $30=O $3A=T $3B=V $3E=L $1B=Y`. The proof that it is
   right: the font holds exactly the twenty letters the game needs and no
   C, K, Q, W, X or Z.

3. **Do not trust `find_instructions` on a hardware range here.** Every VIC write
   is `STA ($02),Y`. Scan the raw bytes yourself with `read_bytes` if you want to
   know what a program touches; it is four lines of Python and it is the only
   honest answer.

4. **Give every routine head `type: "function"`, not `type: "code"`,** or
   `call_graph` and `find_references` will attribute call sites to whatever
   function label happens to be nearest — including ones that start *after* the
   address. I lost real time to `MainLoop` being reported as `PatchSpace5`.

5. **Read `$8172` (`Plot`) and `$818B` (`Peek`) before anything else.** 44 call
   sites between them, and once you know `$02`=col `$03`=row `$04`=char
   `$05`=colour, half the program reads itself.

6. **Expect the screen to be the model.** If you go looking for a score variable,
   an enemy struct or a collision routine you will not find them. The score is
   seven characters on row 0; collision is a `Peek`; the pod population is
   whatever glyphs happen to be sitting in screen RAM.

7. **The three level tables at `$8CB5`, `$8CD5`, `$8CF5` are 31 entries each,
   1-indexed by `levelNumber`.** Level 13 and level 29 are anomalous. Someone who
   can actually run the game should settle whether they are bugs.

8. **The remaining open question is two glyphs**, `$19` and `$1A`. If you can see
   the game running, that is ten seconds of work and it closes the last gap in
   the status line.
