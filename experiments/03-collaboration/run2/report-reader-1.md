# reader-1 (agate) — Gridrunner, control run

Session `ses_mtjcshqd1`, codename **agate**, no assigned lens. Working alongside
reader-2 (**amber**) in one live document.

Everything below is in the project as labels, comments, regions and constants.
The report is a summary of it, not a substitute for it.

---

## 1. What the program is

A 4K C64 autostart cartridge at `$8000-$8FFF`. `$8000-$8008` is the header
(cold start `$83C1`, NMI `$83E2`, `C3 C2 CD 38 30` = "CBM80"); `$8E00-$8FFF` is
a 64-glyph character set copied to `$2000` at boot; the rest is code plus about
200 bytes of tables.

The NMI vector points at six bytes that pop the three registers the KERNAL
pushed and `RTI` — the RESTORE key is disabled and nothing else.

### The five structural facts

These are what I would want to be told before reading a single line, and they
are in `set_project_description`.

**1. The screen is the model.** There is no object list, no bitmap, no sprite.
Every object is one screen character in `$0400-$07E7`. Collision is done by
reading the character already in a cell (`ReadScreenChar`, `$818B`). The
explosion engine (`AdvanceExplosions`, `$86D7`) scans all 936 cells of the play
area and rewrites any it recognises. The score and high score exist *only* as
digit characters at `$040F` and `$041B`; `AddScore` propagates carry by walking
leftwards along the status row.

**2. There is no interrupt.** One `SEI` in the binary, in `ColdStart`, matched
by a `CLI` eight instructions later. Nothing is ever written to `$D019`/`$D01A`
or `$0314-$0319`. The stock KERNAL timer IRQ is left running — which is the only
reason `$C5` works for the pause key — and nothing is raster-synced. All timing
is `masterTick` (`$0D`), a busy-loop counter with a period of 129 passes:
`MovePlayer` runs at 0, `MoveZappers` at 1, `UpdateZapSound` when it is odd.

I renamed `$0D` from `zappersEnabled` to `masterTick` on the evidence of
`find_instructions $0D-$0D` — five sites, one `DEC`, one reload, three
comparisons, and that is the whole story.

**3. Two plot primitives.** `ScreenAddrForRow` (`$8163`) turns `plotRow` into a
pointer via 24-entry tables at `$0340`/`$0360`; `PlotCharAndColour` (`$8172`)
writes the character then adds `$D4` to the pointer high byte to reach colour
RAM. Verified by `run_block`: row 5, column 12, char `$07`, colour `$0D` writes
`$07` to `$04D4` and `$0D` to `$D8D4`.

**4. The sound is three high bytes.** All 66 SID writes go to frequency-*high*,
control, envelope and volume. `$D400`/`$D407`/`$D40E`, the pulse width and the
entire filter section are never touched. Every pitch is 8 bits and every effect
is a sweep of one byte.

**5. The main loop is a JMP chain.** `$8393` -> `$83A3` (nine per-frame calls) ->
`$83E8` (a `DEX` delay) -> `$83A0` -> `$8393`. Nothing in the game proper returns
to a caller above that. The death path throws the stack away with
`LDX #$F6 / TXS`.

### The game, mechanically

- **Player** — char `$07`, clamped to rows 15-21, columns 1-38.
- **Laser** — chars `$08`/`$09`, two sub-cell frames per row travelled, one shot
  at a time (`laserRow = $FF` means idle).
- **Snake** — three parallel one-indexed arrays at `$1100`/`$1200`/`$1300`
  (column, row, flags). Flag bit 6 = head, bit 7 = on screen, bits 0/1 = a
  direction written as two complementary bits. The head zigzags: it drops a row
  only when it bounces, never on an open step.
- **Zappers** — one walking column 0 (fires horizontally), one walking row 22
  (fires vertically). They meet, and the meeting point becomes explosion frame
  `$0F`.
- **Explosions** — a 7-entry chain at `$871F`, advanced by a whole-screen scan.
- **Pods** — the end of an explosion. `ExplosionBecomesPod` writes `$0A` and
  registers the *screen address* in a 24-slot table at `$1000`/`$1020`;
  `MovePods` adds 40 to each every `$40` passes. Verified by `run_block`: a slot
  at `$0550` writes `$00` to `$0550`, `$08` to `$D950`, and advances to `$0578`.
- **Levels** — 31 of them, three per-level tables at `$8CB4`/`$8CD4`/`$8CF4`
  (waves, segments per wave, zap interval), a life awarded per level completed,
  and a joystick-selected starting level on the title screen.

### Findings that took real work

**The lethality rule** (comment at `$8BEC`). Nothing that moves tests for the
player before drawing itself. `MovePlayer` re-reads its own cell each pass, and
if the ship character has gone, `CheckLethalChar` decides: `$00`, `$08` and
`$09` are survivable, everything else is death. So the zapper's vertical beam
and the snake's body kill *one frame late* and need no collision code of their
own. Only three routines test for the ship directly, and those are the three
where the object stops in that cell.

**Two countdowns are shared between subsystems, and the second consumer steals
a decrement.** This is the thing I would keep if I could keep one.

- `laserTickCounter` (`$0F`): `UpdatePlayerLaser` reloads it with `$18`;
  `UpdateZapperBeam` runs when it equals 5 and decrements it *again* via
  `AdvanceBeamPhase`. The beam extends one column per laser cycle with no
  counter of its own — and costs the player laser one tick in 24 while a beam is
  in flight.
- `zapCountdown` (`$17`): `MoveZappers` reloads it from `zapIntervalForLevel`;
  `AdvanceExplosions` runs when it equals 5 and decrements it again. So an
  explosion advances one frame per zapper *firing* cycle, and the four-frame
  chain from `$0F` to a pod takes four firings. It is also why a 936-cell scan
  is affordable at all: it does not run per frame.

I attached a wrong number to the second one — I said the interval runs `$19`
down to `$05`, a 5x spread. amber caught it: the fetch is `$8CF4,X` with X =
levelNumber in 1..31, so the bytes read are `$8CF5-$8D13` = `$10` down to `$06`,
a 2.67x spread with two long plateaus. I re-read it with `read_bytes` and
corrected the comment in place, including the fact that it was wrong first.

**The boundary system is one character.** `DrawGridWipe` leaves `$00` inside a
rows-2-21 x columns-1-38 box and `$20` everywhere else. Every collision test in
the game is `BEQ` after `ReadScreenChar` — "is this cell `$00`" — so a space
reads as occupied and acts as a wall. There is no boundary check anywhere.

**Shooting an explosion rewinds it.** `LaserHitExplosion` rewrites a cell as the
*previous* chain entry, not the next. Every explosion in play starts at `$0F`
(only `RemoveSnakeSegment` and `UpdateZapperBeam` start one, and both write
`$0F`), so four shots walk a cell back `$0F`, `$0E`, `$0D`, `$18`, and the fourth
clears it for 10 points. That is why chain entry 1 exists: I enumerated every
write of a character into the play area, and `$18` reaches the screen in exactly
two places — this rewind, and `debrisChar` during the death animation, which
runs in its own loop and is wiped afterwards. Recorded at `$87D9` as the
enumeration, not as an assertion.

**Killing a mid-body segment splits the snake.** `PromoteNearestHead` walks back
to the nearest head, takes its flag word, and ORs it into the segment on the far
side of the gap, which after array compaction inherits the hit index. The tail
half acquires its own head.

**Pods are unshootable, and there is a hole where the code for that was.**
`LaserHitExplosion` does not match `$0A`; it falls to `LaserHitSegment`, which
tests `$13`/`$14`/`$15` and then hits three `NOP`s at `$8A1D` and returns. The
laser draws straight over the pod and `MoveOnePodDown` rewrites the character on
its next move. Three dead bytes in the middle of a dispatch are not an accident.

**Dead code and unused art.** `$800A` is the surviving tail of an earlier copy of
`CopyCharacterSet` that lived at `$8000` before the header was laid over its
first nine bytes. It reconstructs exactly — `LDX #$00` / `LDA $8E00,X` /
`STA $2000,X` / `LDA $8F00,X` / `STA $2100,X` / `DEX` / `BNE $8002` /
`JMP $8100` — and the surviving `BNE` lands precisely on where the `LDA` would
have been, which is what makes it a reconstruction rather than a guess. It is
also the entire explanation for the two `$8000`/`$8002` entries in
`list_warnings`. Four more unreachable fragments at `$8984`, `$8989`, `$8AD4`,
`$8AF1`, `$8B5D` and `$83FA`; two of them walk the segment array *upward* where
the live loop walks it downward. Glyphs `$0B`, `$0C`, `$1C` and `$1F` are in the
character set and are loaded by nothing and produced by no `INC`/`DEC` chain.

**Six instructions in `InitLevelVariables` that do nothing** (`$834E`):
`LDA $2B / STA $2B / STA $2B` and `LDA $2A / STA $2A`.

### What I could not settle

- **`$19`/`$1A` and `$1D`/`$1E`**, the two small-font glyph pairs flanking the
  score fields. I read them "PL" and "HI" by stroke pattern against the big
  font. `$1D` is unmistakably H and `$1A` unmistakably L; the rest is inference.
  Unlike `$1B` (Y, from "BY JEFF MINTER") and `$3B` (V, from "ENTER LEVEL"),
  no string uses them, so nothing decides it. Recorded as a reading, not a fact.
- **Whether the 400-point head bonus is intended.** `LaserHitSegment` pays 400
  for `$14`/`$15` and 100 for `$13`. The head cycles through all three, so it is
  worth 400 on two passes in three and 100 on the third. That could be the
  design or could be an accident of reusing `snakeHeadChar` as the test. The
  code cannot say.
- **Whether the explosion/level coupling is deliberate.** What would settle it
  is timing a shot segment to pod on level 1 against level 31 in an emulator.

### Where I was wrong

Worth recording, since the run is about method:

- `$3B` is V, not Y. I read the bitmap; amber read the string. The string wins,
  and the two glyphs differ only in whether the strokes meet in a point or carry
  on down a stem.
- `zapIntervalForLevel` spread, above — I read a 1-indexed table 0-indexed.
- I first wrote that `CheckPauseKey` abandons its return address. It does not;
  `JMP $80F7` is a tail call and `$80F7` ends in `RTS` back to `MainLoop`.
  Corrected in place.
- I initially wrote `$0D` up as `zappersEnabled` from its first two readers
  before seeing the `DEC`.

---

## 2. What fought me

### The things that cost real time

**`find_references` on a zero-page address returns nothing, silently-ish.** It
does say so, and it names `find_instructions` as the fix, which is exactly right
and saved me. But this is the single most common question on a 6502 program —
"who touches this variable" — and the tool named for it cannot answer it. The
note is good; the routing is backwards. `find_references` should either do the
`find_instructions` search itself for a zero-page target or the two should be
one tool.

**`routine_effects` cannot say where anything draws.** Every screen write in
this program goes through `PlotCharAndColour`'s `STA ($06),Y`, so every routine's
effect set ends in "memory at a computed address" and nothing more. That is
honest and it is also the whole answer for a game whose entire state is the
screen. The pointer is built two instructions earlier from a table lookup, which
is precisely the "computed store" case the constant folder stops at — correctly,
since the table is built at runtime. I do not think this is fixable by folding
harder; what would have helped is a way to say "the pointer at `$06` is a screen
address, so treat these as screen writes", i.e. an annotation the reader
supplies once and the analysis then trusts.

**`routine_effects` on `MovePlayer` returned essentially the whole program**
under `including_what_it_calls`, because `CheckLethalChar` -> `PlayerHit` -> the
death animation -> level restart -> `InitLevelVariables` -> the main loop. It is
a correct "may" answer and the `itself` / `including_what_it_calls` split is what
made it usable at all — but on a program where the death path is reachable from
almost everything, the callee set is not informative. A depth limit, or "stop at
a routine that resets the stack pointer", would have made it useful.

**Batch tools are all-or-nothing and do not say which entry failed.**
`set_comments` refused a batch of seven because one entry was `inline` and
contained a newline. The message named the address, which is good; but I had to
resubmit the whole batch. `bind_constants` behaved better — it bound 44 and
listed one `rejected` — so the two batch tools disagree about partial success.

**Argument-name guessing costs a round trip each.** `read_disassembly` and
`read_bytes` take `start`, not `address`; `find_references` takes `address`;
`run_decoder` has no `name`. The helper is deliberately dumb, which is fine, but
the first four calls of the session were all rejections. Dumping every tool's
property list once (`tools/list` piped through `node`) was the fix and should
probably be the documented first move.

**`post_message` caps at 2000 characters** with no indication in the tool
description, and refuses rather than truncating. I hit it twice and had to split
a message that was carrying a correction the other reader needed.

**A `bitmap` decoder must return `#rrggbb` palette entries** — I passed `[0,1]`
and got a clear error, which was fine, but the tool description says
`{kind:"bitmap", width, height, pixels, palette}` and does not say the palette
is hex strings.

### The things that surprised me in a good way

- **`run_block` is the best tool here.** Every claim I made about arithmetic I
  was able to check by running it, and the `given`/`image`/`unknown` provenance
  is what makes the answer trustworthy: when I ran `ScreenAddrForRow` without
  supplying the row tables it told me it had read `$0345` and `$0365` as zero
  because nothing supplied them, which is exactly the trap I would otherwise
  have fallen into (those tables are built at runtime and are zero in the image).
  It also labelled the reads `screenRowLoTable+5`, so my extent annotation paid
  for itself immediately.
- **The block boundary being a hard limit is right and was still frustrating.**
  I wanted to run `AddScore`'s carry loop end to end and could not. I called
  `run_routine` once so it is in the transcript. I do not think it should exist
  in the form I asked for — the honesty argument in the tool description is
  correct — but "run this block, and follow the exit as long as it is a
  fallthrough or an unconditional jump, up to N instructions" would have covered
  every case I actually wanted.
- **`find_instructions` reporting the enclosing routine on every hit** is what
  made the SID and joystick surveys readable rather than a list of addresses.
- **The `orphaned` field on a write** told me immediately when declaring the
  cartridge header as data cost me a decode, before I had a chance to be
  confused by it.
- **Extent labels render beautifully.** `podScreenPtrHi-1,X`,
  `charsetRam + $0100,X`, `scoreField,X` — the listing reads like a hand-written
  disassembly.

### Collaboration friction, which is the point of this run

**Comments clobber.** `set_comment` revises the slot, so amber's `before`
comment on `$8AF8` was silently replaced by mine. Neither of us saw it happen;
amber found it by reading. The `before`/`inline` split gives you exactly two
slots per address and no way to add a third, so "two people have something to
say about this routine" has no representation. An `append` placement, or
comments keyed by author, would fix it. `changes_since` does record the
overwrite, but only as another "comment $8AF8 before" line — it does not say
that something was replaced.

**Duplicate label names are not refused and fail silently.** We both declared a
label called `scoreDigits` with an extent, mine at `$040F` and amber's at
`$0410`. Nothing complained. The symptom was `run_block` reporting `$0413` as
`scoreDigits+3` — correct against one label, off by one against the other, with
nothing in the output to say which. This is the nastiest thing I hit all
session, because the wrong answer *looks* like a right answer. Two overlapping
extents with innermost-wins is the correct rule; two extents with the same name
is what makes it unreadable. A warning on `set_label` when the name already
exists at a different address would have caught it instantly.

**`set_region` with a name and `mark_function` both emit a label**, so we ended
up with `DeadCode_SnakeWalkUp` (function, mine) and `OrphanSnakeFragment`
(entry, from amber's region) at the same address, and `list_labels source:"user"`
showed only mine — the region-derived one is `source: "region"` and invisible
under that filter. I only found the duplicates by reading the listing. Filtering
by source is a reasonable feature; defaulting a "what is named here" query to
one source is not.

**`set_region kind:"code"` with `length:1` is not the way to decode an orphan**;
`mark_function` is. I worked that out by watching `delta` — the region gave
`delta: 0` and `mark_function` did not. Both tool descriptions are accurate;
neither says which to reach for. The four junk two-byte regions I left behind
nested inside amber's named ones, which is correct nesting behaviour and made
the map read as duplicates until I removed them by id.

**A pad declared `code` in front of a data table raises a false warning.** I
declared the `$EA` fillers as code (the project's own doctrine: `$EA` is a NOP
and declaring it data claims execution stops). The one at `$881E`, immediately
before `statusLineChars`, made the walk fall through into the table and produced
a "this analysis arrives here and it is declared data" warning. I left that one
undeclared and said so in the comment. Small, but it is a case where following
the stated rule produces a worse map.

**What worked well:** `changes_since` and `list_participants` did their job —
I found out amber existed by seeing labels I had not written (`TxtByJeffMinter`)
appear mid-listing, which is a *better* signal than a notification would have
been. `post_message` carried two corrections in each direction that neither of
us would have found alone: amber caught my table off-by-one and my `$3B`/`$1B`
mix-up, I caught their `$07`-vs-`$0A` player/pod swap. On a shared document with
no assigned lens, the correction traffic was worth more than the division of
labour.

### Tools I wanted and called by name so they land in the transcript

- `run_routine` — execute past a block boundary with an instruction budget.
- `append_comment` — add rather than revise; the fix for the clobbering above.
- `screen_footprint` — which screen cells a routine writes, given that
  everything goes through one indirect store.

---

## 3. Final state of the project

```
instructions   1539     (from 5 at the start)
namedByHand     211
regions          29
comments         90+    (86 at the point I counted; both readers)
constants        47
warnings          7     (5 KERNAL stubs, 2 explained by the $800A orphan)
unexplained       4 bytes
```

`find_undecoded` went from 923 unexplained bytes across 23 spans to 4 bytes
across 4, each of which is a single operand byte of an instruction that no
longer exists.
