# reader-1 — Gridrunner, cold read

Project: `reader-1`, port 5167. All work recorded in the project: **116 hand-written
labels, 38 comments, 21 regions, 15 constants with 38 bindings.** Unexplained bytes
went from 924 to 0 (the last 31 are declared `$EA` padding regions).

---

## 0. Contamination declaration — read this first

**My context was contaminated before I started, and the brief asks me to say so.**

The repository's `CLAUDE.md` is loaded automatically into my context and it uses this
exact binary as its running example. It named, before I made a single tool call:

- `$83E2` as "an interrupt handler restoring registers (`PLA TAY PLA TAX PLA RTI`)"
- `$87FE` as "a routine that discards its own return address"
- `$8D16`, and `laserFrameRateForLevel` as the thing ending near it
- `$8D5A`/`$8737` as mid-instruction label sites, `$807F` as `CopyrightLine = *-$01`
- the copyright line reading **"(c) 1982 HES"** through **a charset at `$2000`**
- `SCREEN_RAM` at `$0400`, `dat_040F`, `$0400 + $000F`
- `DrawGrid`, `PlayNewLevelSounds`, `DisplayTitleScreen`, `droidXPositionArray`
- zero page `$1A` = `leftLaserYPosition`, `$08` = `randomValue`/`gridXPos`
- constants `LEFT_ZAPPER = $01`, `BOTTOM_ZAPPER = $02`
- block/instruction counts for this program (364 blocks, 62 `ret` exits, etc.)

**The MCP tool descriptions are contaminated too**, independently of `CLAUDE.md`:
`add_label` and `find_immediates` both cite "the reference calls `$08` `randomValue`
throughout and `gridXPos` inside one routine", and `set_constant` cites
`LEFT_ZAPPER`/`WHITE`. So even a clean-context reader gets told facts about this
binary by the tool list.

**Conclusions that overlap with contamination, and how I actually got them:**

| Overlap | My derivation | Independent? |
|---|---|---|
| charset at `$2000` | `$D018 = $18` written indirectly at `$810B`, then `CopyCharSet` at `$82EC` copying `$8E00→$2000` | Yes — I found the mechanism, not just the address |
| "(C) 1982 HES" | rendered all 64 glyphs with `run_decoder`, read the letters off the bitmaps | Yes, and I got the **full** string, which `CLAUDE.md` does not contain |
| screen `$0400` | `PlotChar` adding `#$D4` to the pointer high byte to reach colour RAM | Yes |
| `$83E2` is an interrupt handler | it is the NMI vector in the cartridge header at `$8002` | Yes, and I got *which* interrupt, which `CLAUDE.md` does not say |
| `$87FE` discards its return address | read it in `ShotHitObject`; it is `PLA/PLA` before a `JMP` | Contaminated — I was primed to look. The reading is still checkable |
| "zapper" as a name | I used it for the edge objects at `$859B` | **Contaminated.** `LEFT_ZAPPER`/`BOTTOM_ZAPPER` were in the `set_constant` description. I would probably have said "edge sentry". The *behaviour* I describe is from the bytes; the *word* is borrowed |

Everything not in that table came from the bytes. I did not read `assets/`, `src/`,
other experiments, other projects, or the web.

---

## 1. What I concluded

### It is a cartridge, and it does not start where the project says

`$8000` is not code. `$8004-$8008` is `C3 C2 CD 38 30` = **`CBM80`**, the C64
autostart signature, so `$8000-$8001` and `$8002-$8003` are the cold-start and NMI
vectors: **`$83C1`** and **`$83E2`**. The project's auto entry point at `$8000`
decoded five garbage instructions and stopped. Declaring `$83C1` an entry produced
**1474 instructions from one label** — 77% of the binary in a single call.

`$83E2` pops the three registers the KERNAL's NMI path pushed and `RTI`s without
touching `$DD0D`. It is a deliberate no-op that swallows RESTORE, so RUN/STOP+RESTORE
cannot break into the game.

### The single most important fact: the character set is custom, so nothing reads as text

`InitVideo` at `$8100` points `$02/$03` at `$D000` and writes the VIC registers
**indirectly**:

```
LDY #$18 / TYA / STA ($02),Y        ->  $D018 = $18
LDY #$20 / LDA #$00 / STA ($02),Y / INY / STA ($02),Y   ->  $D020 = $D021 = 0
```

`$D018 = $18` puts the video matrix at `$0400` and the **character base at `$2000`**.
`CopyCharSet` at `$82EC` has just filled `$2000-$21FF` from **`$8E00-$8FFF`**: 512
bytes, 64 glyphs, exactly the screen codes `$00-$3F` this program ever uses.

So every text byte in the binary is in the author's own glyph order. `ascii`,
`petscii` and `screen` all produce plausible garbage on it. I rendered all 64 glyphs
through `run_decoder` and read the alphabet off the bitmaps:

```
$20 space
$21 G  $22 R  $23 U  $24 I  $25 D  $26 N  $27 E
$28 A  $29 B  $2A F  $2B H  $2C J  $2D M  $2E P  $2F S
$30 O and digit 0   $31-$39 digits 1-9
$3A T  $3B V  $3C+$3D two-cell (C)  $3E L  $3F vertical grid bar
$1B Y   $1D+$1E two-cell "HI"
```

The allocation is the giveaway: `$21`–`$27` spell **G R U I D N E** — very nearly the
distinct letters of GRIDRUNNER in order, with the rest of the alphabet following as
other words needed it. **There is no C, K, Q, W, X or Z in the font at all**, which is
a checkable prediction: no string in the game contains one, and none does.

That unlocked six strings that were previously undecodable spans:

```
$8080  "(C) 1982 HES  PRESS FIRE TO BEGIN"
$8820  "GRIDRUNNER"          (in the status row)
$8C51  " BATTLE  STATIONS " / "ENTER GRID AREA 00"
$8DE1  "BY JEFF MINTER"
$8DF1  "ENTER LEVEL 00"
```

Cross-check that convinced me the alphabet is right rather than lucky: the status-bar
**colour** table colours columns 0–3 cyan and columns 4–9 purple. That is 4 + 6 =
`GRID` + `RUNNER`. The game colours the two halves of its own name differently, and
the split lands exactly where my decoding says the word breaks.

### The drawing system is one routine

`PlotChar` at `$8172` — 35 callers, more than anything else — is the entire graphics
engine:

```
PlotChar(plotColumn=$02, plotRow=$03, plotChar=$04, plotColour=$05)
  JSR SetScreenRowPtr      ; screenPtr = screenRowLo/Hi[plotRow], Y = plotColumn
  LDA $04 / STA ($06),Y    ; screen code
  LDA $07 / CLC / ADC #$D4 / STA $07
  LDA $05 / STA ($06),Y    ; colour
```

Adding `#$D4` to the pointer's high byte turns `$04xx` into `$D8xx`. **That single
instruction proves screen RAM is at `$0400` and colour RAM at `$D800`** — I did not
have to assume the defaults. `$0340`/`$0360` are a 24-entry split lo/hi row-address
table built at run time by the loop at `$8138`, which clears the screen in the same
pass.

`PeekChar` at `$818B` reads a cell back. With no sprites, **reading characters off the
screen is the entire collision system** — nine callers do it.

### Hardware: almost none of it is used

- **VIC-II: exactly one absolute store in the whole program** (`SCROLX` at ColdStart,
  `#$05` = 38-column mode, x-scroll 5), plus the three indirect writes in `InitVideo`.
  **No sprite is ever touched.** This is a pure character-mode game.
- **No raster interrupt, no `$D012` poll anywhere.** The main loop's entire frame timer
  is `LDX #$15 / DEX / BNE` at `$83E8` — about 100 cycles. The game free-runs.
- **SID: 66 stores** into `$D400-$D418`. Sound is where the effort went.
- **Input: `LDA $DC11`.** That looks like CIA-1 control register B, but CIA-1's 16
  registers are mirrored sixteen times through `$DC00-$DCFF`, so `$DC11` **is `$DC01`**
  — Port B, **joystick port 1** (not the usual port 2). `EOR #$FF` inverts the
  active-low bits; afterwards bit 0 up, 1 down, 2 left, 3 right, 4 fire. That is the
  only input path in the program.

### Game structure

`ColdStart $83C1` → `CopyCharSet` → `InitVideo` → title screen `$8D8E` →
level select `$8DB0` → `$80E5` (reset score/lives) → `StartLevel $8C2D` →
`LevelStartFanfare $8D16` → `StartLevel(level) $8300` → **MainLoop `$8393`**.

The main loop is ten calls and a delay: `MovePlayer`, a keyboard check,
`UpdatePlayerShot`, `MoveZappers`, `UpdateZapperBeams`, `$86D7`,
`UpdateFallingObjects`, `$889A`, `UpdateSnake`, `$89A0`, `CheckLevelComplete`.

**Player** (`$8470`): occupies rows 15–21, columns 1–38, drawn as glyph `$07` in light
green. Movement is joystick bits 0–3 with hard clamps. Before moving it peeks the cell
it was in; if that no longer holds `$07` something has overwritten it and it dies.

**Player shot** (`$84F8`): one at a time, `shotRow = $FF` means none in flight, rate-
limited by a countdown from `$18`.

**Edge sentries / "zappers"** (`$859B`): one walks down column 0, one walks right along
row 22 — both outside the grid the player can reach. When `zapperFireTimer` expires
they fire beams whose endpoints are latched from wherever they currently are, which is
what makes the beams line up with them. The beam glyph cycles `$05`/`$06` and is
**explicitly reset when it would reach `$07`** — because `$07` is the ship glyph and
drawing it would break the collision test that looks for `$07`. That is a nice piece of
evidence that "read the screen back" really is the collision system.

**The main enemy is a snake**, and the code says so without ambiguity. Three parallel
arrays (`$10FF` column, `$11FF` row, `$12FF` flags). For every segment that is not the
head:

```
snakeColumn[X] = snakeColumn[X-1] ;  snakeRow[X] = snakeRow[X-1]
```

Each segment steps into the cell the one ahead just left — follow-the-leader. Only the
head decides anything: it descends one row per step and `EOR`s its flags with `#$03`
each step, flipping the direction bit, so it zig-zags.

**Explosion** (`$8AF8`): eight particles seeded at the player position and displaced
each frame by `explodeDeltaX/Y` at `$8BC0`. Those tables contain only `$80`, `$00`,
`$01`, consumed by a three-way fallthrough (INC/INC, INC, neither) followed by a DEC —
so the net step is -1, 0 or +1. Read off in pairs the eight entries are exactly
**N, NE, E, SE, S, SW, W, NW**. The glyph cycles `$16`/`$17`/`$18`, which render as
three progressively sparser scatters of dots, and the countdown `$33` goes straight to
`$D418` so the bang fades as the debris spreads.

**Damage chain** (`$871F`): a hit rewrites an object's cell with the *previous* entry
in the table, so objects walk down `$12 → $11 → $10 → $0F → $0E → $0D → $18 →
destroyed`. Rendered, those glyphs are a large mass shrinking through a diamond to a
dot to debris. The chain is visibly damage.

**Score and lives are stored nowhere but the screen.** `AddToScore` at `$8870`
increments the glyph in a screen cell and carries on passing `$3A`. The score is the
seven cells `$040F-$0415`; the high score is `$041B-$0421`; lives is the single cell
`$0427` (top-right), initialised to glyph `$34` = the character **4**. The high-score
compare at `$8060` is a digit-by-digit screen-to-screen comparison that uses `BMI`
after `CMP` — a *signed* branch for an unsigned compare, correct here only because
both operands are always `$30-$39` so the difference fits in -9..+9.

**Per-level difficulty**: three 32-entry tables at `$8CB4`, read together at `$8C8E`
and indexed by `levelNumber`. `levelZapperInterval` falls monotonically from `$10` at
level 1 to `$05` at level 32 (the sentries fire more often); snake length rises from 6
to 24. **Level 13 is anomalous in both of the other two tables** — 16 waves where its
neighbours have 5 and 6, and snake length 3 where its neighbours have 10 and 15.
Level 29 also dips to 3. Everything else in both tables changes smoothly. That is
either a joke about level 13 or two corrupted bytes, and the bytes cannot say which,
so I recorded it as an anomaly rather than resolving it.

**Development leftovers**, which the brief predicted and which are real. The best one:
the twelve bytes at `$8009`, immediately after the cartridge header, disassemble to
`STA $2100,X / DEX / BNE / JMP $8100` — the tail of `CopyCharSet` almost byte for byte.
It is an **earlier copy of the character-set loader**, left in the gap after the header
when the routine moved to `$82EC`; its branch offset no longer lands anywhere. There
are four more orphaned fragments (`$8AD4`, `$8AF1`, `$8984`, `$8B5D`), three dead
instructions inside `PlotChar` itself (`LDA $07 / LDA $07 / STA $07`), a
store-to-self pair in `StartLevel`, and around forty `$EA` bytes at patch sites.

---

## 2. What I could not work out

- **The two-cell label at `$19`/`$1A`**, over the score in the status row. `$1D`/`$1E`
  clearly reads "HI"; `$19`/`$1A` does not resolve for me. My best guess from the
  pixels is a 4-pixel-wide "P1" or "SC", but I would not put a guess in the project. It
  is described in the comment as "a two-cell label over the score" and left there.
- **What `$8A11`'s score split means.** Hitting a snake segment pays 100 for glyph `$13`
  and 400 for `$14`/`$15`, but `$13`/`$14`/`$15` are the *animation frames* of the same
  object. Followers are always drawn `$13`; the head cycles all three. So the head is
  worth more — but only two frames in three, which reads like a quirk rather than a
  design. I could not decide, so I recorded the mechanism and not an interpretation.
- **`$8AA4`/`$8AC1` and the `$1200`/`$1300` arrays.** There is a fourth object system
  here I only partly traced. Running out of budget, not out of evidence.
- **Whether column 0 is actually visible.** `$D016 = $05` is 38-column mode with x-scroll
  5, and the left sentry patrols column 0. Working out what is on screen needs VIC
  timing knowledge I did not want to assert.
- **What would have helped most**: a way to *render a screen*. Almost every question I
  could not close was "what does this look like", and I had to hand-write a bitmap
  decoder to answer even the easy version of it.

---

## 3. Where the tools got in the way

This is the section that matters, so it is blunt.

### 3.1 The single biggest gap: no text region can use the program's own character set

The project **knows** where the charset is. I declared it as `kind:"bitmap"
view:"char:8"` and the tool rendered it happily. And yet:

```
set_region kind:"text" encoding:"charset:$8E00"
→ Invalid option: expected one of "ascii"|"petscii"|"screen"
```

Every string in this binary is in a custom glyph order. `ascii`, `petscii` and `screen`
are all wrong for it, and there is no fourth option. So the one encoding this program
actually uses is the one that cannot be declared.

**Worse than missing — actively harmful.** I tried the closest option:

```
set_region $8080 kind:text encoding:screen
→ 8080  3C 3D 20 31 39 38 32 20  .TEXT "<= 1982 "
```

`.TEXT "<= 1982 "` is a *confident, plausible, wrong* answer to the question "what does
this say", printed in the listing as though it were a fact. The true string is
`"(C) 1982 HES  PRESS FIRE TO BEGIN"`. A reader who saw `.TEXT "<= 1982 "` would
reasonably conclude the span was junk data with a date in it and move on. I reverted
the region to `data` and put the real text in a comment, because a hex dump plus a
comment is honest and `.TEXT "<= 1982 "` is not.

`CLAUDE.md` argues at length elsewhere that "a wrong glyph is worse than a visible gap"
and that graphics coverage is deliberately partial for exactly this reason. The same
principle should stop `encoding:screen` from being offered as the nearest available
option when the nearest available option is a lie. **Either add a charset-relative
encoding, or make text regions refuse when the project has a charset region installed
somewhere the VIC points at.**

### 3.2 `find_references` returns *empty* for the addresses a 6502 program actually uses

```
find_references $000E  →  { "inbound": [], "incomplete": "...zero-page targets...not recorded" }
find_instructions from:$000E to:$000E  →  6 sites, complete, with routine names
```

Same question. One tool returns nothing; the other returns the whole answer. On a 6502
every variable lives in zero page, so `find_references` — the tool whose description is
literally "What refers to an address" — is blind to most of the program's own state.

The disclaimer makes it worse rather than better. It reads as "this question cannot be
answered here", so a reader believes there are no references and stops. It should say
**"use `find_instructions` for zero-page and immediate operands"**. I only found the
workaround by accident, several hours in, after grepping my own local copy of the
listing instead. I would have got here far faster if the empty answer had pointed at
the tool that works.

### 3.3 `call_graph` and `inRoutine` are confidently wrong on a JMP-connected program

```
call_graph address:$8393    →  { "routine": "$8020 (DieIfPlayerHere)", ... }
```

I asked about the main loop and got told it was `DieIfPlayerHere`, a routine 900 bytes
away that has nothing to do with it. The "extent worked out from control flow" walk
has swallowed the entire program — everything is connected by `JMP`s — and named the
result after its lowest-addressed label.

The same defect poisons `find_instructions`, which is otherwise the best tool here:

```
$8302  STA SIGVOL       inRoutine: sub_8AC8      ← $8302 is 2000 bytes below $8AC8
$8062  LDA dat_040F,X   inRoutine: sub_8AE9
```

`inRoutine` is presented as a plain fact on every row and is wrong on a large fraction
of them. It cost me real time early on: I believed the attributions and built a wrong
mental map of where the sound code lived. **An extent that spans most of the binary
should be reported as "no bounded routine", not as a name.** The documentation says
extent is "worked out from control flow, not declared, because a routine that
tail-jumps away is in two places" — but the failure mode when that reasoning breaks is
silent, and it breaks on the very first program I pointed it at.

### 3.4 `block_effects` and `run_block` are no-ops on a routine that starts with `JSR`

`PlotChar` is the most important routine in the program. Its first instruction is
`JSR SetScreenRowPtr`, and a `JSR` ends a block. So:

```
block_effects $8172 → block $8172-$8175, 1 instruction, writes: ["SP", "memory at a computed address"]
run_block     $8172 → executes the JSR, writes two stack bytes, done
```

`block_effects` is described as "the first question about a routine nobody has named".
On the routine I most wanted to ask about, it answers "it pushes a return address". The
one-block restriction is defended in the docs on the grounds that no path is chosen on
your behalf — fine — but a *straight-line* routine with no branches in it (which
`PlotChar` is, after the JSR) is exactly the case where running the whole thing is
safe. I wanted `run_routine` with a step budget and could not have it. `routine_effects`
partly covers this, but it gives you a set of slots, not a demonstration.

### 3.5 No byte search

```
find_bytes pattern:"8D 18 D0"  →  Tool find_bytes not found
```

I wanted to answer "does anything anywhere write `$D018`" without trusting the decode,
because at that point I suspected the decode was incomplete — which it was. There is no
way to search the bytes. I pulled all 4096 with `read_bytes` and grepped locally.

That is a fine workaround and `read_bytes` explicitly exists for it, but the whole point
of the moment was that I did not yet know what was code. A byte-pattern search is the
tool you reach for precisely when the instruction index cannot be trusted, and it is
the one that is not there.

### 3.6 `find_instructions` cannot filter by addressing mode

```
find_instructions mnemonic:"STA" addressing:"indirect"  →  Unrecognized key: "addressing"
```

The most important write in this program is `STA ($02),Y` targeting `$D018`. Searching
`$D000-$D3FF` returns **one** site and it is not that one. The tool's own description
says "on this machine the range is the meaning: `$D000-$D02E` is the VIC-II... So 'what
draws' is stores into `$D000`". Following that advice on this binary gives you the
answer "this program does not use the VIC-II", which is false and would have been very
hard to recover from. I only found the indirect write because I read `$8100` linearly.

The range filter cannot see through indirection — nothing static entirely can — but the
tool should be able to *say* so, the way `find_references` says so, and it should let me
enumerate indirect stores so I can check them by hand. Right now a range query silently
under-reports and the description encourages you to trust it.

### 3.7 Smaller things

- **`set_label` with `type:"entry"` creates an entry point**, and produced 1474
  instructions. The description only documents that for `type:"function"`. Since
  `entry` is the semantically right type for a reset vector, and the doc does not say
  it works, a reader may well use `mark_function` and mislabel the thing.

- **`bind_constants` is all-or-nothing with no partial report.** One bad address
  (`$8021`, no immediate operand) refused a batch of 38. The error names the offender,
  which is good, but says nothing about the other 37 — I had no way to know whether the
  rest were valid without resubmitting. For a batching tool whose stated purpose is to
  avoid round trips, one typo costs the whole round trip anyway.

- **`export_listing` caps at 2000 lines and returns no continuation cursor.**
  `read_disassembly` has `nextStart`; `export_listing` does not, even though it is
  described as "the cheapest way to read a lot at once". I wrote a script that scrapes
  the last address out of the rendered text and re-requests from there. That is exactly
  the "parse the rendered text" the tool descriptions elsewhere are proud of avoiding.

- **`placement:"after"` on a routine's first address puts the comment after the first
  *instruction*, i.e. inside the routine.** I put a note on `PlotChar` with
  `placement:"after"` expecting it below the routine and it landed between the `JSR` and
  the `LDA`, splitting the routine in half. Defensible from the docs ("own rows below
  it"), surprising in practice. I moved it.

- **Comment re-wrapping breaks my line structure.** I wrote comments with deliberate
  line breaks; the listing re-wraps to a fixed width and produces orphan fragments
  ("...through / ; screenPtr / ; it adds #$D4..."). Minor, but it makes carefully
  formatted comments read worse than plain prose, which is a disincentive to write good
  ones.

- **The auto entry point at `$8000` cannot be withdrawn.** Once I correctly declared the
  cartridge header as data, every analysis carried the warning *"$8000: this analysis
  arrives here and it is declared data, so decoding stops."* Nothing arrives there — the
  layer's own auto entry does. It is permanent noise in `list_warnings` produced by
  getting the answer right.

- **Four `undefined bytes` warnings for `$FDA3`, `$FD50`, `$FD15`, `$FFD2`.** These are
  KERNAL ROM calls. Three of them the platform layer already *names* (`ROM_IOINIT`,
  `ROM_RAMTAS`, `CHROUT`) and then warns about. Warning about a call to an address you
  have a built-in name for is noise, and it means 5 of my 6 warnings are permanent.
  Separately, `$E518` (KERNAL `CINT`, screen init) is **not** in the platform table and
  came out as `sub_E518`, which is a straightforward gap.

- **No tool renders a screen.** Given a charset region and a span of screen codes, the
  project has everything needed to show what the display looks like. I wrote it myself
  in `run_decoder` — which is excellent, and is the tool that unlocked this entire
  project — but I had to write a bitmap font renderer from scratch to read a copyright
  line. `render_screen` (or `set_region kind:"screen" charset:...`) would have saved the
  single most productive hour and would be reusable on every C64 project.

**Credit where due**, because it would be dishonest to list only complaints:
`run_decoder` is the best tool in this set and is the reason this reading got anywhere —
it turned an unreadable binary into a readable one in two calls. `find_undecoded` is the
right orientation tool and its count going 924 → 0 was a genuinely useful progress
signal. `find_instructions`' range hints are the correct idea even where the
implementation under-reports. And the write tools returning an **instruction delta** is
exactly right: `+1474` from a single label told me instantly that I had found the real
entry point, and no amount of prose would have.

---

## 4. What I would tell the next person

1. **`$8000` is not code.** It is a `CBM80` cartridge header. Start at `$83C1`. One
   `set_label type:"entry"` there decodes 77% of the binary.

2. **Read the comment on `$8E00` before you read anything else.** The character set is
   custom. Until you have the glyph map, every string in this program is invisible, and
   worse, `encoding:screen` will show you a wrong one that looks like an answer.
   `run_decoder` over `$8E00` with a bitmap renderer is a two-minute job and it is the
   highest-leverage thing you can do here.

3. **Do not trust `inRoutine` or `call_graph` on this binary.** The whole program is one
   `JMP`-connected blob and the extent walk swallows it. Use `find_references
   direction:"in"` for callers.

4. **Use `find_instructions` for zero page, not `find_references`.** `find_references`
   returns empty for every variable in the program and the disclaimer will make you
   think the question is unanswerable. It isn't.

5. **Range queries under-report.** `$D018`, the most consequential write in the program,
   is `STA ($02),Y`. If a hardware search comes back suspiciously empty, read the
   initialisation code linearly before you believe it.

6. **The screen is the data structure.** Score, high score and lives live only in screen
   RAM as glyph codes; collision is `PeekChar`. If you are looking for a score variable
   in zero page, you will not find one. This also means anything that clears the screen
   destroys the score, which may explain behaviour you find odd later.

7. **Left to do, roughly in order of value:** the `$1200`/`$1300` object system around
   `$8AA4`; the sound routines `$824F`, `$8573`, `$8450` (66 SID writes, none of which I
   characterised beyond "makes a noise"); and whether the level-13 anomaly in
   `levelWaveCount`/`levelSegmentsPerWave` is a joke or two corrupt bytes. That last one
   would be settled in seconds by anyone who can run the game to level 13, and not at
   all by anyone who cannot.
