# Experiment 4 — beating the human reading of Gridrunner

Agent: `improver` / codename `agate`. ~235 MCP calls, all logged in
`gridrunner-improved.mcp.jsonl`.

## Where the work is

Everything below is **in the project**, not only here.

| | seeded | now |
|---|---|---|
| instructions decoded | 1449 | **1541** |
| labels named by a person | 118 | **385** |
| labels the disassembler had to invent | 217 | **0** |
| comments | 0 | **190** |
| regions | 16 | **42** |
| constants declared / bound to a site | 0 / 0 | **62 / 168** |
| per-site label bindings | 0 | **33** |
| decoders | 0 | **2** |
| bytes nothing explains | 156 | **0** |

Artefacts written to the run directory:

- `gridrunner-improved.exported.re64` — the project as JSON (see *what fought
  me*: the server never rewrites `gridrunner-improved.re64` on disk, so this is
  dumped from the `projects.doc` column of the database).
- `gridrunner-improved.listing.txt` — 2477 lines, the whole program as
  `export_listing` renders it, including the character set drawn as a picture.

---

## 1. What I corrected

### 1.1 The game is Gridrunner, and this binary is the cartridge

`reference.asm`'s header says *"the game 'Matrix' written by Jeff Minter in
1983"*. Two independent pieces of evidence say otherwise, both now in the
project:

- **The banner.** `DisplayGameBanner` at `$8806` copies 40 bytes from `$881F,X`
  into screen row 0. Through the game's own character set those bytes read
  `GRIDRUNNER  PL 0000000  HI 0000000  <ship>  4`. The copyright line at `$8080`
  reads `(c) 1982 HES  PRESS FIRE TO BEGIN`. Gridrunner is 1982 and HES was its
  US publisher; Matrix is 1983.
- **The cartridge header.** `$8004`–`$8008` hold `C3 C2 CD 38 30` = `CBM80` in
  PETSCII (`$C1`–`$DA` duplicate `A`–`Z`), the autostart signature a C64 looks
  for. `$8000` is the cold-start vector and `$8002` the NMI vector.

The reference lists `$8004`–`$8008` as `.BYTE $00,$00,$00,$00,$00`. **Its binary
is not this binary**: it was made from a cartridge-to-PRG conversion, which
zeroes the signature so the machine will not autostart it, and which is also
where the `* = $0800` / `SYS 2061` stub at the top of `reference.asm` comes from.
Every other byte I checked matches. That single five-byte difference explains
the whole `$0800` section the reference carries and this image does not.

Region `cartridgeSignature` now renders `CBM80`; the `unusedAfterCartridgeHeader`
region covers the leftover `$8009`–`$8010`.

### 1.2 `WaitForScreen` / `CheckScreen` is the high-score check

`$8060` in the reference is `WaitForScreen`, with `CheckScreen` at `$8062`.
Nothing there waits for anything. It walks seven pairs of screen characters:

```
8062  LDA scoreDigits,X        ; $040F..$0415
8065  CMP highScoreDigits,X    ; $041B..$0421
8068  BNE ScoreLowerThanHighScore
806A  JMP HighScoreNextDigit
8070  BMI NoNewHighScore       ; player digit lower -> title screen
8072  LDA scoreDigits,X / STA highScoreDigits,X ... CPX #$07
```

Evidence: `$040F` and `$041B` are the `PL` and `HI` fields of the banner decoded
in 1.1; its only caller is `ClearScreenAndRestartLevel`, at the point where the
lives digit has just been decremented to `'0'`. Renamed `UpdateHighScore`, with
the branch targets named and commented.

### 1.3 Sixteen zero-page names were on the wrong addresses

The seeded project's zero page was shuffled relative to the reference's own
equate list; every one was checked against its uses with `find_instructions`
before being moved.

| addr | seeded | correct | evidence |
|---|---|---|---|
| `$0F` | gridYPos | `bulletAndLaserFrameRate` | `DEC $0F/BEQ` at `$84F8`, reload `#$18`, `CMP #$05` in `DrawLaser` |
| `$10`/`$11` | swapped | X then Y | `$8510` stores shipX into `$10`, shipY into `$11`; `$11` carries the `$FF` sentinel |
| `$17` | laserShootInterval | `laserAndPodInterval` | reloaded from `laserFrameRate` at `$8605` |
| `$18` | bottomLaserYPosition | `laserShootInterval` | `#$FF` at `$8616`, tested at `$863E` |
| `$19` | laserAndPodInterval | `laserCurrentCharacter` | `#$05` at `$861A`, `INC` at `$86D2` |
| `$21` | cyclesToWasteCounter | `podUpdateRate` | `DEC/BEQ`, reload `#$40` at `$8758` |
| `$22`/`$23` | soundEffectControl / backgroundSoundParm1 | hit-sound sweep / repeats | `$88A0`–`$88C2` |
| `$25` | droidsLeftToKill | `droidFrameRate` | reload `#$80` at `$88CE` |
| `$26` | sizeOfDroidSquadForLevel | `currentDroidCharacter` | `#DROID1` at `$8346`, wraps at `$16` |
| `$28`/`$29` | collisionSoundControl / currentShipExplosionCharacter | squad delay / segments left | `$89C1`–`$8A0B` |
| `$2B` | clearScreenLineLoPtr | `sizeOfDroidSquadForLevel` | loaded from the level table at `$8C93` |
| `$36` | backgroundSoundParm2 | `soundEffectControl` | only user is `$8D18`, which the seed had not decoded |
| `$1A`–`$1D`, `$2A`, `$2D`, `$30`, `$33` | missing | laser positions, droidsLeftToKill, explosion char, waste counter, collision ramp | added |
| `$2C` | clearScreenLineHiPtr | **unused** | no instruction touches `$2C` |

### 1.4 `randomValue` is the grid column

The reference (and the seed) name `$08` `randomValue`, on the strength of
`PlayAnotherSound` doing `LDA $08 / STA $D401`. `find_instructions` over `$0008`
returns thirteen sites in three routines and none of them ever puts a random
number there. `PlayAnotherSound` is called from exactly two places, both inside
`DrawGrid`'s sweeps, where `$08` holds **the column currently being drawn** —
which is why the tone rises as the grid sweeps across the screen. Renamed
`gridXPos`, with `clearScreenHiPtr` as a second name bound over `ClearPlayArea`.

### 1.5 `DrawHorizontalLineLoop` draws vertical lines

`$81AE`. `currentXPosition` is held at `gridXPos` for the whole inner loop and
`currentYPosition` runs 2..21, so the loop writes down a **column**. The
character it writes is `$3F`, which — rendered from the charset — is a solid
full-height vertical bar. Renamed `DrawVerticalLinesLoop`; the second pass
(`$81ED`) overwrites the bars row by row with `$00`, the grid-intersection
glyph, which is the animation you actually see.

### 1.6 The two explosion control tables are named the wrong way round

The reference has `explosionYPosArrayControl` at `$8BC0` and
`explosionXPosArrayControl` at `$8BC8`. Three instructions after loading
`$8BC0,X`, the code does `INC explosionXPosArray,X`; three after loading
`$8BC8,X` it does `INC explosionYPosArray,X`. They are swapped. Renamed
`explosionDeltaXTable` / `explosionDeltaYTable`.

More usefully, **what they mean was never stated**. The value decides how many
`INC`s happen before a matching `DEC`, so `$80`→−1, `$00`→0, `$01`→+1, and the
eight pairs are

```
(0,-1) (+1,-1) (+1,0) (+1,+1) (0,+1) (-1,+1) (-1,0) (-1,-1)
```

— the eight compass directions in order. The explosion throws one fragment each
way. That is now the region's comment.

### 1.7 Region boundaries: three tables and four strings were mis-cut

All three per-level tables are read as `base-1,X` because levels number from 1.
Reading the operands off the instructions gives the exact spans:

| table | operand | data | seeded region |
|---|---|---|---|
| `noOfDroidSquadsForLevel` | `LDA $8CB4,X` | `$8CB5`–`$8CD4` | correct |
| `sizeOfDroidSquadsForLevels` | `LDA $8CD4,X` | `$8CD5`–`$8CF4` | ran one byte long |
| `laserFrameRateForLevel` | `LDA $8CF4,X` | `$8CF5`–`$8D14` | `$8CF6`–`$8D18` |

The last one is the expensive error: it swallowed the `LDA #$30` at `$8D16`,
which is the first instruction of `PlayNewLevelSounds`. Fixing the region
recovered **32 instructions** in one call and gave `DrawNewLevelScreen` its only
caller. It is also the `$8D16` entry that `list_warnings` had been reporting
since the project was seeded.

`txtBattleStations` was 16 bytes where the copy loop reads 18 (`$8C51`–`$8C62`),
and `txtEnterGridArea` started two bytes early. `txtByJeffMinter` and
`txtEnterLevel` each ran past the 14 bytes their loops read.

`$8847` is a genuinely shared byte: entry `$28` of the banner text (the initial
lives digit `'4'` at screen column 39) *and* the base-1 of the colour table read
as `$8847,X`. The reference lists it as the first byte of `screenHeaderColors`,
where it is not a colour — `StartLevel` writes `#$34` to `$0427` and
`ClearScreenAndRestartLevel` decrements it, so it is the lives counter.

### 1.8 `DisplayGameBanner` is at `$8806`, not `$8801`

`$8801` is `PLA / PLA / JMP WriteCurrentCharacterToCurrentXYPos` — it discards
its caller's return address. The seeded label made `JMP DisplayGameBanner` at
`$87E9` read as a call to the banner routine, which it is not. (`$87FE` is the
same trick ending in `RTS`.)

### 1.9 A lead droid is worth 400, not 300

`BulletCollidedWithLeadDroid` (`$8A21`) adds 3 to the hundreds digit and then
**falls through** into `BulletColidedWithDroneDroid` (`$8A28`), which adds 1
more. The reference comments the two entry points `; Increment score by 300
points` and `; Increment Score by 100 points` and does not note that the first
runs into the second.

### 1.10 The reference's `b8737 = *+$01` is noise; `$8D5A` is real

The reference emits two labels that sit inside instructions. I checked both with
`find_references`:

- `$8D5A` — genuinely branched to, by the `BCS` at `$8DCB`. Real second reading.
- `$8737` — **nothing references it.** It is the operand byte of `BNE $872E` and
  no inbound reference exists. An artefact of the reference's own disassembler.

Recorded at `$8736`.

### 1.11 `$DC11` is joystick port 1

The reference comments the title-screen read as `; Joystick Port 2 input`.
`$DC11` is CIA 1 port **B** seen through the chip's 16-byte register mirror
(`$DC01 + $10`); port 2 is port **A** at `$DC00`. Both reads in the program
(`$8373`, `$8DB0`) are the same address, and `GetJoystickInput` inverts it with
`EOR #$FF` while the title loop compares the raw value against `$EF` and `$FE` —
so the title screen only responds to fire alone or up alone, never to two
switches at once.

### 1.12 Dead code the reference presents without comment

`find_references` says nothing inbound, and no instruction falls into any of
these. Each is now its own region, decoded and commented:

| span | what it is |
|---|---|
| `$8011` | `JMP InitializeGame`; both live entries go through the vectors |
| `$83F0`–`$83FF` | ten NOPs, a spare `JMP EnterMainGameLoop`, three more NOPs |
| `$8984`–`$898F` | two abandoned routine tails (the reference lists them silently) |
| `$8AD4`–`$8ADD` | the reference's `; Is this reached?` — **it is not** |
| `$8AF1`–`$8AF7` | tail of a longer collision check that now returns above it |
| `$8B5D`–`$8B5F` | `DEX / BNE` skipped by the `JMP` above; `$8B58` loads its count every explosion frame and never uses it |
| `$8DCB`–`$8DCF` | the `BCS $8D5A` that creates the second reading, plus NOPs |
| `$8162`, `$87D8`, `$8AE7` | stray `RTS` after unconditional jumps |

Plus the five self-stores at `$834E` (`LDA $2B / STA $2B / STA $2B / LDA $2A /
STA $2A`), fifteen NOPs at `$8361`, three instructions in
`WriteCurrentCharacterToCurrentXYPos` at `$8180` that load and store the same
byte, and the branch at `$81D8` that goes to the next instruction.

### 1.13 A real bug: the score's leading digit is dead

`IncrementPlayerScore` propagates a carry with `DEX / BNE`. When X reaches 0 the
branch fails and the loop exits **without incrementing `$040F`**. The score
field is seven characters wide, is zeroed as seven by `StartLevel` and compared
as seven by `UpdateHighScore`, but only six of them can ever be non-zero: the
score rolls over at 999999 and the carry is lost. I cannot tell from the code
whether the leading zero is decorative on purpose; what is certain is that the
carry is dropped, and that is now written at `$8881`.

### 1.14 `CLC` before `SBC`, seven times

`CLC / SBC` subtracts one more than intended, because SBC also subtracts the
complement of carry. `run_block` at `$8264` with `materializeShipOffset = $0F`
writes **`$04`** into `currentXPosition` where `$14 - $0F` is `$05`. The matching
`CLC / ADC` arm gives `$14 + $0F = $23` exactly, so the ship's materialise
animation is 16 cells wide on the left and 15 on the right. Sites: `$8278`,
`$828C`, `$82C9`, `$82E4`, `$8411`, `$869A`; `$829D` and `$8D6A` do the same
subtraction with no `CLC` at all, so their result depends on carry left by an
unrelated instruction. Also `ADC` with no `CLC` at `$8247` and `$857C`.

### 1.15 Names the reference does not have

`a28` and `a29` are `delayUntilNextSquad` and `droidSegmentsLeftToSpawn`: `$29`
counts the segments still to emit for the squad being built, the **last** one
gets the visible bit and decrements `droidsLeftToKill`, and when `$29` runs out
`$28` counts down `$20` frames of quiet before the next squad. Likewise
`previousXPosition`/`previousYPosition` are not previous anything — they are
where the ship *is* between frames, so `shipXPosition`/`shipYPosition`; and
`shipAnimationFrameRate` is the program's only clock, so `masterFrameCounter`.

---

## 2. What I added that a flat listing cannot hold

**The character set as a picture.** `$8E00`–`$8FFF` is a `bitmap` region with
`view: char:8`, so all 64 glyphs are drawn in the listing itself — in the
browser, in the CLI and in `export_listing` alike. Reading them is what made
everything else in this report possible: no built-in encoding applies to this
font, so *every string in the program* was unreadable until the glyphs were
rendered. A full glyph inventory is a comment at `$8E00`. The set contains no C,
K, Q, W, X or Z — only the twenty letters the game's own text needs — and `$30`
is one glyph doing duty as both the letter O and the digit 0, which is why
`PRESS FIRE TO BEGIN` and a seven-digit score are made of the same byte value.

**Two decoders, stored in the project.**

- `gridrunnerCharset` maps the game's 64 glyphs to text and is attached as the
  `view` of six text regions. `copyrightLine` now reads
  `(c) 1982 HES  PRESS FIRE TO BEGIN` in the listing instead of `<= 1982 +'/`.
- `petsciiWithDuplicateLetterRange` exists because re64's built-in `petscii`
  encoding maps `$C1`–`$DA` through a graphics table instead of treating them as
  the duplicate `A`–`Z`, so the cartridge signature came out as punctuation. It
  now reads `CBM80`.

**Both readings of `$8D5A`.** Declaring `$8DCB` code makes the disassembler
follow `BCS $8D5A` into the middle of `STA selectedLevel` as its own stream, and
the listing shows both:

```
8D59  85 35      STA selectedLevel
8D5A  ; also decodes from here, sharing bytes above
8D5A  35 4C      AND $4C,X
8D5B  4C 8E 8D   JMP DisplayTitleScreen
```

The reference can only gesture at this with `b8D5A = *+$01`, which no assembler
will place. An `after` comment on `$8D57` says the branch is in dead code, so
this is what *would* happen, not what does.

**One address, several names, per site.** 33 `label.bind` entries: `$02`/`$03`
read as `vicRegisterPtrLo/Hi` inside `InitializeGame` and as `podPtrLo/Hi`
inside `MovePodDownOneRow`; `$07`/`$08` as `clearScreenLoPtr` /
`clearScreenHiPtr` only inside `ClearPlayArea`; `$09` as
`currentExplosionCharacter` at the two sites that mean that; `$0A` as
`soundStepCounter` in the two sound loops.

**One value, several names, per site.** 62 constants and 168 bindings. `$01` is
`WHITE` at nine sites, `LEFT_ZAPPER` at one and `JOY_UP` at another; `$07` is
`SHIP` at ten and `YELLOW` at four; `$00` is `GRID`, `BLACK`, `GATE_OFF` and
`DELTA_ZERO` in four different senses; `$08` is `ORANGE`, `BULLET_UP1`,
`JOY_RIGHT` and `DISABLE_CASE_SWITCH`.

**Extents.** `SCREEN_RAM` and `COLOR_RAM` cover 1000 bytes, so an operand inside
them renders as `COLOR_RAM + $015F` instead of `dat_D95F`; the droid, pod and
explosion arrays and the charset destination likewise.

**Zero unexplained bytes.** `find_undecoded` reported 156 bytes in 22 spans at
the start and reports 0 now. Every NOP run between routines is declared `code`
(it is code — declaring it data would claim execution stops there), every stray
`RTS` is named and its unreachability stated.

---

## 3. What the tools told me that reading alone would not

- `find_instructions` over `$D000`–`$D3FF` returns **four** VIC accesses in the
  whole program, three of which are `STA ($02),Y` and are only visible because
  re64 folds the constants that built the pointer. No sprite register is written
  anywhere. Over `$DC00`–`$DDFF` it returns two, both `LDA $DC11`.
- 66 SID stores, and the registers they touch: the three **frequency high**
  bytes, three control registers, the AD/SR pairs and the volume. `$D400`,
  `$D407` and `$D40E` are never written, so every pitch in the game is a
  multiple of 256 in SID units — which is why nothing here plays a tune, only
  sweeps and clicks.
- `run_block` at `$8264` produced the `$04`-instead-of-`$05` in 1.14.
- `routine_effects` produced the finding in section 4.

---

## 4. What fought me

**The exported `.re64` was silently frozen for the first quarter of the run, and
every tool said `ok`.** My first `set_labels` applied to the document and
`describe_project` showed the new names, but nothing reached the file. The only
symptom was a stack trace on the server's stderr, which an agent has no tool to
read. I found the cause by reading `dist/`:

`serialize.js:insertEntry` walks the array line by line looking for the first
line whose address sorts after the new one, and splices a one-line entry there.
The seeded `.re64` is pretty-printed with each label spanning five lines, so it
finds the `"address": "$1F"` line **inside** an existing object and splices
between that object's `"id"` and `"address"` lines. `upsertLabel`'s own
`parseProject(updated)` guard then throws, `applyOps` aborts, and *the whole
write is abandoned* — including the 47 other labels in the batch. Minimal repro:

```js
S.upsertLabel(rawSeededFile, "lbl_x", 0x1A, "leftLaserYPosition", "address", 0)
// throws: Expected double-quoted property name in JSON at position 3128
S.upsertLabel(S.formatProject(P.parseProject(raw)), ...)  // fine
```

Inserting a label that sorts *after* every existing one works, because that path
appends. Inserting one *before* any existing one corrupts. It only bit at all
because the seed file was pretty-printed; `formatProject` writes one entry per
line.

My workaround was `add_layer`, purely because `insertLayer` calls `formatProject`
and reformats the file. That is a strange thing to have to discover, and it left
an extra empty symbols layer in the project that now owns 29 of my labels.

**There is no MCP tool that writes the export, and none that reports it is
stale.** `POST /api/export` exists over HTTP and I had to reach past the tool
surface to call it. Even then it writes into the `projects.doc` column of the
SQLite database, not to `gridrunner-improved.re64` on disk, which is still the
seed byte for byte. I dumped the column by hand into
`gridrunner-improved.exported.re64`. If the tools are the whole API, an agent
cannot save the project and cannot tell that it has not been saved.

**`set_project_description` never reaches the file.** `applyOp` has a `meta.set`
case; `diffProjects` never emits one. So the description shows in
`describe_project` and is absent from the export. I patched it into my exported
copy by hand and said so in the file.

**`list_labels` advertises a filter it does not have.** Its description says
labels can be narrowed "by … an address range"; the schema has `source`, `type`,
`namePattern`, `limit` and nothing else. `{"to": "$0100"}` is rejected. There is
no way to ask "what is named in zero page" — I had to pull all 336 and filter
locally.

**`find_immediates` returns `inRoutine: "?"` for every site.**
`find_instructions` fills the same field in. Since the whole point of
`find_immediates` is "where else is this value loaded, and does it mean the same
thing there", losing the routine name makes the answer much less useful than the
neighbouring tool's.

**`routine_effects` is swamped by one non-returning jump.** `DrawLaser`,
`DrawDroids`, `UpdateShipPosition` and `StartShipExplosion` each come back
claiming ~60 writes including `selectedLevelDigits` and `$D95E`. The reason is
real and worth knowing — all four can reach `ResetStackAndKillShip`, which does
`LDX #$F6 / TXS` and jumps into the death path, which restarts the level, plays
the fanfare and re-enters the main loop, so the reachable set is the whole
program. It is sound, and it is useless. `UpdatePods`, which cannot reach it,
reports three writes and is exactly right. What would help: report effects up to
the first non-returning transfer separately from effects beyond it, or let a
caller mark a node as "does not return" and exclude what follows.

**A comment on an address inside an instruction is accepted, stored, and renders
nowhere.** I lost two comments this way before I thought to cross-check comment
addresses against the rows in the exported listing. The known gap (CLAUDE.md) is
that a *label* there renders nowhere; a comment does the same, and neither
`set_comment` nor `list_comments` says so. A one-line warning in the result —
*"$8730 is inside the instruction at $872E; this will not render"* — would have
cost me nothing to act on.

**No way to clear a region's `view`.** Having set `view: "snippet:..."` on a
region I wanted to switch to a built-in encoding, and `view: ""` is refused with
a helpful message about what a view can be. Omitting the field keeps the stored
one. I had to fix the decoder instead.

**`bind_constants` is all-or-nothing.** One bad entry (`$8B82` is an indexed
load, not an immediate — my mistake) rejected all 168 bindings. The message
names the offender, which is good; but for a batch tool that exists because "an
agent names forty", a partial-success report would beat making me resubmit the
other 167.

**A long `inline` comment is unreadable and nothing says so.** Inline comments
cannot wrap — correctly, they share a row — but there is no length hint, so a
paragraph attached inline runs a listing line to 600 characters. I moved one to
`before` after seeing it.

**`export_listing` takes `lines`, not `end`.** My first instinct was `end`,
which is what `set_region` takes. Not wrong, just an inconsistency that costs a
round trip. Neither `export_listing` nor `read_disassembly` will give the whole
program, so I ended up scripting the `nextStart` loop.

**The screen-code and PETSCII decoders do not handle the high half.**
`$80`–`$FF` are the reversed forms of `$00`–`$7F` in screen codes, and
`$C1`–`$DA` duplicate `A`–`Z` in PETSCII. Both built-in encodings map them
through a graphics table, which is why the single most standard five bytes on
this machine render as punctuation.

**A comment's double spaces are collapsed when it is wrapped.** `HES  PRESS`
became `HES PRESS` inside a comment block, which matters when the comment is
quoting bytes.

**A tool I wanted and called anyway:** none, in the end. Every question I had
turned out to have a home. The closest to a gap is the export one above — I went
looking for `save_project` / `export_project`, did not find it, and instead found
the HTTP route by reading the server, which is not something the API should
require.

---

## 5. What I could not settle

**Levels 13 and 29.** `noOfDroidSquadsForLevel[13]` is `$10` (16) between
neighbours of 5 and 6, and `sizeOfDroidSquadsForLevels[13]` and `[29]` are both
`$03` between neighbours of 10/15 and 23/24. So level 13 is 16 squads of 3 (48
droids, against 50 for level 12) and level 29 is 7 squads of 3 (21 droids,
against 161 for level 28). Level 29 in particular is an order of magnitude
easier than either neighbour. I cannot tell from the code whether these are
designed breather waves or transcription slips in the table. Playing levels 13
and 29, or comparing the tables against another release of the binary, would
settle it. Recorded at `$8CC1`, `$8CE1` and `$8CF1`.

**`$D016 = $05` at `$83C5`.** Bit 3 clear selects 38-column mode and the low
three bits set a horizontal scroll of 5. But columns 0 and 39 both carry game
content — the left zapper and the lives digit — and 38-column mode trims exactly
those edges. Either the display is shifted so they survive, or the player never
quite sees them. Running the machine would settle it in one screenshot; I have
stated the register bits and stopped there.

**The leading score digit.** Section 1.13 establishes that the carry is dropped.
Whether Minter intended a decorative leading zero or fumbled the loop is not in
the code.

**`$8009`–`$8010`.** Eight bytes nothing reads. The last three, `CA D0 F1`,
would decode as `DEX / BNE -15`, which is the shape of a delay loop — so this
looks like the tail of something the cartridge header was written over. That is
an observation about a byte pattern, not a conclusion, and it is written that
way.

**Whether the reference's binary differs anywhere else.** I compared the five
signature bytes because re64 showed them and the reference did not. A full
byte-level comparison was not possible: `reference.asm` has **no address
column**, so aligning its 2272 lines against this image would mean assembling it.
Everything I spot-checked matched.
