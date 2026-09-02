# reader-2 (amber) — Gridrunner, experiment 3, control run

Session `ses_mtjcss0j2`, codename **amber**, identity `claimed` (reader-2 is not a
user on the server; the claim was believed and recorded, which is the right
behaviour and `whoami` said so unprompted).

Shared document with **reader-1 (agate)** throughout. Final state of the project
when I stopped: 1539 instructions decoded from 5, **211 hand-named addresses**,
97 comments, 29 regions, 47 constants with 118 bound sites, **5 unexplained bytes
in the whole 4K** (all single `$EA` or fragment bytes), 7 warnings — 2 of which
are the cartridge vectors and 5 are KERNAL addresses outside the layer.

---

## 1. What the program is

A 4KB C64 autostart cartridge, `$8000-$8FFF`. Standard header at `$8000`:
`C1 83 / E2 83 / C3 C2 CD 38 30` — cold start `$83C1`, NMI `$83E2`, PETSCII
"CBM80". The NMI handler pops the three registers the KERNAL pushed and RTIs, so
RESTORE does nothing.

**Everything is character cells.** The VIC is written exactly four times in the
whole cartridge, all during init — `$D016=$05` (38-column), `$D018=$18` (screen
`$0400`, charset `$2000`), `$D020=$D021=$00`. Nothing writes `$0314/$0315`,
nothing reads `$D012`. One `SEI`, one `CLI`, one `RTI` in the binary. No sprites,
no raster, no interrupt of its own; the stock KERNAL timer IRQ is left running,
which is the only reason `$C5` works for the pause key. Timing is busy-wait
delay loops in a JMP-chain main loop.

Input is one address: `$DC11` (the CIA1 mirror of `$DC01`, joystick 1), read at
exactly two sites. Sound is 66 SID writes across nine registers — the three
frequency-HIGH bytes, three control registers, envelopes, master volume. No
frequency-low, no pulse width, no filter: every pitch is one byte and every
effect is that byte swept.

### The screen is the model

This is the decision the whole program rests on, and it explains almost every
oddity. There is no object table for explosions, no coordinate list for
collisions, and no score variable.

- Collision is `ReadScreenChar` — look at what is in the cell.
- The explosion engine at `$86D7` scans all of `$0450-$07FF` every zapper cycle
  and rewrites any cell whose character is in `explosionFrameChain` to the next
  frame along.
- The score is six digits of *character data* living in screen RAM at
  `$0410-$0415`, incremented in place with a carry that walks left.
- Walls are not checked: `DrawGridWipe` paints `$00` over columns 1–38, rows
  2–21, and everything outside that is still the `$20` that init wrote. Every
  boundary test in the game is "is this cell `$00`", so a space acts as a wall.

The only real tables are the snake arrays (`$1100/$1200/$1300`) and the pod
screen-pointer table (`$1000/$1020`) — and even that stores screen addresses,
not coordinates.

---

## 2. What I established (with the evidence)

### The custom character set — `$8E00`, and it unlocked the text

The single highest-leverage thing in the run. 64 glyphs, code C at `$8E00 + 8*C`,
copied verbatim to `$2000-$21FF`; `$D018=$18` points the VIC there. Screen codes
are the game's own: `$20` space, `$21-$2F` = **G R U I D N E A B F H J M P S**,
`$30` = letter O doubling as digit 0, `$31-$39` = digits 1–9, `$3A` T, `$3B` V,
`$3E` L. Neither PETSCII nor screen codes decode it — the copyright line reads
`<= 1982 +'/...` through both built-in encodings.

I found the base by working backwards from the strings, then confirmed it
independently: `CopyCharacterSet` copies `$8E00→$2000` and `$8F00→$2100`, so code
C really is at offset `8*C` from `$8E00`.

The digits are deliberately at `$30-$39` **in ASCII order** even though the
letters are ad-hoc — because `AddScore` does carry arithmetic directly on the
character codes.

I wrote a decoder (`gridrunnerText`, `dec_i24r3l`), stored it in the project, and
declared four text regions with `view: "snippet:dec_i24r3l"` so the listing shows
the real text. Every string in the cartridge, decoded:

| addr | text |
|---|---|
| `$8080` | `(c) 1982 HES  PRESS FIRE TO BEGIN` |
| `$8C51` | ` BATTLE  STATIONS ` |
| `$8C63` | `ENTER GRID AREA 00` |
| `$8DE1` | `BY JEFF MINTER ` |
| `$8DF1` | `ENTER LEVEL 00 ` |

That is everything the game says.

**Full glyph inventory, each tied to a use site rather than to what it looks
like** (comment at `$8E00`). The one that took work: `$05`/`$06` are the vertical
zapper bar and `$03`/`$04` the horizontal head — and `$03`/`$04` are reachable
**only** because `$869B` is `CLC` then `SBC #$01`, which subtracts *two*. agate
hit the same instruction about a minute later, independently.

Also from the inventory: **`$0B`, `$0C` and `$1F` are drawn in the font and no
instruction anywhere loads them** (`find_immediates` returns nothing for any of
the three, and no data table contains them), and **`$1C` is a byte-identical
duplicate of the Y at `$1B`**.

### The score has a dead digit — proved by execution

The field drawn on screen is seven digits, `$040F-$0415`. Only six can ever
change. Every `AddScore` caller enters with X of 4 or 6, and the carry loop ends
`DEX / BNE`, so when `$0410` wraps X becomes 0 and the loop exits without ever
touching `$040F`.

Confirmed with `run_block` rather than argued: `$8872` with X=1 and `$0410 = $39`
writes `$3A`; `$887C` with X=1 writes `$30`, leaves X=0, branch not taken. So the
score saturates at 999999 and wraps silently, and the leading zero is decoration.
The high-score compare and copy at `$8060` *do* read all seven, so the dead digit
is only dead on the way in.

### The laser's detune depends on the keyboard

The nicest thing I found. `$857C` is `ADC #$00` with no `CLC`, so SID voice 1 gets
`laserSoundCounter + carry` while voice 2 gets the counter exactly — the two noise
voices are detuned by one step, or not, depending on an inherited flag.

Nothing between there and `CheckPauseKey` touches carry (`LDA/STA/DEC/BNE/JSR/
JMP/RTS` all leave it), and `MainLoop` runs `CheckPauseKey` immediately before
`MainLoopBody`, whose first call is `UpdatePlayerLaser`, whose first call is
`LaserSound`. `CheckPauseKey` ends on `CMP #$29` against `$C5`, the KERNAL
last-key byte.

- No key held: `$C5 = $40`, `$40 >= $29`, carry set, voices one step apart.
- A key with matrix code below `$29` held: carry clear, both voices identical.

Run, not reasoned: `run_block $821B` with `$C5=$40` exits C=1 and with `$C5=$10`
exits C=0; `run_block $8578` with the counter at `$20` writes `$D401=$20 /
$D408=$1F` at C=1 and `$1F / $1F` at C=0.

**What I cannot tell you** is whether it is audible. Establishing that needs the
machine, not the listing, and I said so in the comment rather than claiming it.

### Scoring, and a real game rule falling out of it

`AddScore` has four inbound references, one of which is its own loop. So there
are exactly three ways to score, and X selects the digit (6 = units, 4 =
hundreds):

| site | X, Y | value | for |
|---|---|---|---|
| `$888E` | 6, `$0A` | 10 | shooting an explosion out completely |
| `$8AA1` | 4, 1 | 100 | any snake segment destroyed |
| `$8A25` | 4, 3 | +300 | *only* if the character hit was `$14` or `$15` |

The follower branch at `$891D` draws every **body** segment as flat `$13`; only
the **head**, committed at `$896A`, uses `snakeHeadChar`, which cycles
`$13 → $14 → $15`. `LaserHitSegment` scores on the character it hit. So a body
segment is always 100, and the head is 100 or **400** depending on which
animation frame it is on when your bolt lands — 400 two ticks in three. That is a
rule a player could feel, derived from the code.

And `RemoveSnakeSegment` has four inbound references, all inside
`LaserHitSegment`. **Nothing else in the program can delete a segment.** The
zapper beam draws over cells without testing what was there and its only
collision check is `CheckPlayerAtCell` looking for `$07`, so the beam is lethal
to the player, makes pods, and is completely harmless to the snake.

### Every way to die

From the seven inbound references to `PlayerHit` — four live, three in orphan
fragments (comment at `$8AE0`): the zapper **head** walking onto the ship
(`$8028`); a pod already on or landing on the ship (`$877E`, `$87B8`); the snake
head stepping into it (`$8AEB`); moving onto a cell that is not `$00/$08/$09`
(`$8BF8`). Two consequences: the **vertical** beam bar is not fatal, and an
explosion cell is not either — `IsExplosionChar` cancels the move instead.

### Per-level difficulty, decoded in full

Three 1-indexed tables at `$8CB4` (waves), `$8CD4` (segments per wave), `$8CF4`
(zapper interval), read with X = levelNumber, capped at `$1F`. Full 31-row table
is in the comment so nobody has to redo the arithmetic.

Zapper interval falls monotonically `$10 → $06`; segments per wave climbs 6 → 24.
Two levels break the pattern, and **differently**:

- **Level 13**: 16 waves of 3 = 48 total — exactly what levels 9 and 10 give.
  Not a spike; the same amount of snake delivered as sixteen short waves.
- **Level 29**: 7 waves of 3 = **21** segments, sitting between 161 and 168. An
  outright breather, twenty-eight levels in.

Both are single-byte deviations in `$8CD4`, 16 levels apart.

My first pass on this was half wrong (I called level 13 an anomaly against its
neighbours without computing the product), and I corrected it in the project and
in chat. I also caught agate's version of the same trap: they read the interval
range as `$19 → $05`, which is the offset-0 byte and one past the cap; the range
actually fetched is `$10 → $06`, a factor of 2.67 rather than 5. All three tables
have an unread byte at the label itself, so a 0-indexed eye gets every level's
value one row early.

### Patch archaeology

The cartridge was assembled with slack and edited in place, and the evidence is
consistent (comment at `$834E`):

- **100 `$EA` bytes** below `$8E00`, in twelve runs of three or more — including
  fifteen inside `InitLevelVariables` and twenty before the strings at `$8DE1`.
- **Four self-assignments**: `LDA $2B / STA $2B / STA $2B`, `LDA $2A / STA $2A`,
  `LDA $35 / STA $35`, `LDA $07 / LDA $07 / STA $07`. Each loads a byte and
  writes it back unchanged.
- **Five orphan code fragments** nothing reaches: `$800B` (a verbatim duplicate
  of the tail of `CopyCharacterSet` — confirmed by `find_bytes`), `$8984`,
  `$8AD4`, `$8AF1`, `$8B5D`. I declared all of them `code` regions so they decode
  and are visible.
- A `JMP MainLoop` at `$83FA` sitting in NOPs with no way in.
- The **pod table is cleared as 32 slots and scanned as 24** — `ClearPodTable`
  does `LDX #$20`, both users do `LDX #$18`. Slots 25–32 are initialised and
  never looked at.
- The **snake direction bit `$01` is write-only**: I enumerated all fourteen reads
  of `$1300` in the binary (comment there) — it is set at `$894B`, flipped by
  `EOR #$03` at `$8962`, and never once tested. It is always the complement of
  bit 1: one direction bit stored twice with one copy consulted.
- **`explosionFrameChain` has a ninth byte nothing can reach.** All three readers
  start `LDX #$07` and end `DEX/BNE`, so entries 1–7 are used. `$8727 = $13` —
  the snake body character — sits one past every index anything uses. A chain
  entry of exactly the right kind, unreachable. Read with the rest, it looks like
  a chain that was one longer and used to end in a snake segment rather than a
  pod. *That last part is inference about intent; that `$8727` is never read is
  not.*

### What I could not settle

- **`$19`/`$1A`, the glyph pair at `$040C`.** agate reads it "PL", and I agree as
  far as it goes: columns 0–4 are unmistakably a five-wide P and columns 6–9 an
  L, and PL/HI as player-score and high-score labels is coherent. But neither of
  us accounts for a bare two-pixel upright at columns 14–15 through all five rows
  and two extra pixels at 11–12 on row 5. `$1D`/`$1E` is cleaner: H, then a
  serifed I with two marks at columns 5–6 on rows 2 and 4, which is a colon —
  "HI:". The two pairs are not built the same way. Bit-exact decomposition is in
  the comment at `$8ECC` so a third reader can judge. **What would settle it:
  run the cartridge and photograph row 0.**
- Why glyphs `$0B`, `$0C`, `$1F` and the duplicate Y exist.
- Whether the laser detune is audible.

---

## 3. What fought me

### The collaboration, which is the point of this experiment

**We collided on the first move.** agate declared the cartridge header region and
marked `$83C1`/`$83E2` four seconds before I did, and I had no way to know. My
`set_region` reused their id because the span matched exactly, which was lucky;
a one-byte difference would have nested a duplicate silently. The first thing
`changes_since` told me was that my opening ten minutes of orientation had
already been done.

**Splitting the map did not work, and could not have.** I proposed `$8000-$8800`
for agate and `$8800-$9000` for me, three minutes in. agate had already read
straight through to `$8C30` by the time the message landed. Neither of us was at
fault: a 4K binary is small enough that a fast reader covers it before a
coordination round trip completes. The chat is not slow — *we* were fast.

**`set_comment` revises, and revision between two authors is data loss.** My
`before` comment on `$8AF8` was replaced by agate's. Theirs was good, so nothing
important was lost this time, but the mechanism has no merge, no warning, and no
way to see what was there first. That is the single sharpest friction point of
the run. **There is no `get_comment`** — I called it once, deliberately, so it is
in the transcript. Without it, the only way to check whether an address already
carries a comment is `list_comments` for the whole project and grep, and the
result is truncated text you cannot compare against what you are about to write.

The workaround we converged on mid-run and agreed in chat: *if you are going to
replace somebody else's `before` comment, put yours at a nearby instruction or in
the `inline` slot, which is a different object.* It worked. It should not have
had to be invented.

**Duplicate names are accepted silently and produce wrong tool answers.** agate
caught this one: we both had a label called `scoreDigits`, theirs at `$040F` and
mine at `$0410`, both with an extent. Nothing refused the duplicate name, and
`run_block` then reported `$0413` as `scoreDigits+3` — correct against one label,
off by one against the other, with no way for a reader to tell which. Two extents
overlapping is fine and innermost-wins is the right rule; two extents with the
**same name** is what makes it unreadable. I called `find_name_conflicts` once so
the want is on the record.

**Duplicate constants, same story.** We independently declared the same value
under different names five times (`$05`, `$06`, `$13`, `$16`, `$25`). Nothing
warned. I removed mine and kept agate's.

**`list_constants` showed `uses: 0` on all 52.** Both of us had declared
constants freely and bound none of them, so nothing in the listing had changed.
Declaring is cheap and visible in `describe_project`; binding is the part that
alters what a reader sees, and it is the part that gets skipped. `$16` is the
case that justifies the whole mechanism — `CHR_DEBRIS_1` at `$8260` and
`GRID_BOTTOM_ROW` at `$88DE`, same byte, different meaning — and it took a
deliberate pass to notice. **Suggestion: have `set_constant` report how many
unbound declarations the project holds, or have `describe_project` surface it the
way it surfaces `namedByHand`.**

### The tools

**Argument-type inconsistency cost several round trips.** `read_bytes` takes
`start`, not `address` (which `find_references` uses). `find_bytes` takes
`pattern`, not `bytes`. `find_immediates` requires `value` as a **string**
(`"$13"`), while `run_block`'s `registers` take **numbers** and its `memory`
takes strings. `remove_region` needs `start` even when you pass an `id`. Each is
a one-call fix and the helper is honestly dumb by design, but the pattern is that
the same concept has a different parameter name and a different type per tool.

**`run_decoder`'s palette contract is only discoverable by failing.** The
description says "return `{kind:"bitmap", width, height, pixels, palette}`" and
does not say palette entries must be `#rrggbb`. One wasted call.

**`find_immediates` returned `"value": undefined` in its own answer**, so a
caller batching over several values cannot label the results without threading
the input through itself.

**`post_message` has a 2000-character cap that is not in the description.** I hit
it once and had to split a message in two. Worth documenting, since agents write
long.

**What genuinely helped, and I want to say so as clearly as I said the above:**

- `run_block` is the best tool in the set. Three of my findings are stated as
  "run, not argued" because of it, and the one that mattered most — the carry
  chain into the laser pitch — could not have been claimed honestly any other
  way. Its provenance reporting (`given` / `image` / `unknown`) is exactly right.
- `find_instructions` resolving indirect writes through constant folding gave me
  `$D018`, `$D020`, `$D021` from three `STA ($02),Y`, which is what let me say
  "the VIC is written four times in the whole cartridge" as a fact.
- `find_bytes` with `??` wildcards; `A9 ?? 85 04` gave me every literal ever
  stored to `plotChar` in one call.
- Storing the decoder in the project. Writing a charset decoder once and having
  four text regions render through it — for agate as well as me — is the feature
  working exactly as designed.
- `find_undecoded` as a work queue. 923 unexplained bytes down to 5 is a number
  you can steer by.

### One workflow thing worth recording

I pulled the whole 4K with a single `read_bytes` early and did the bitmap
rendering, glyph identification, NOP-run counting and table extraction locally in
node. That is not a complaint — `read_bytes` exists precisely so a caller can do
its own arithmetic, and it is the reason the charset got decoded at all. But it
means several of my strongest findings were produced *outside* the tool surface
and only written back. A `render_glyphs`-style tool (I called `render_text` once
for the record) would have kept that work inside the project where agate could
see it happening.

---

## 4. Things I would want checked by a third reader

- The `$19`/`$1A` reading. "PL" is plausible and incomplete.
- My claim that `$0B`, `$0C` and `$1F` are unreachable rests on `find_immediates`
  plus my own scan for character tables. If a character can arrive on screen from
  a source neither of us enumerated, that claim is wrong.
- agate's shared-countdown finding (`laserTickCounter` and `zapCountdown` each
  decremented by two subsystems) is the best structural result of the run and I
  only verified the arithmetic on the level table, not the timing consequence.
  It predicts explosions turning into pods about 2.7x faster on level 31 than on
  level 1; **that needs the machine to confirm.**
