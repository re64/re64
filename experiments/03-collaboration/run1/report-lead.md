# Experiment 3 — report from the software lead (`lead`, codename `agate`)

Gridrunner (Jeff Minter, HES, 1982), 4K C64 cartridge at `$8000-$8FFF`.
Shared document with `gfx` (`beryl`), who took graphics and sound.

Everything below is in the project as labels, regions, comments and constants.
This report is the argument and the friction log, not the findings themselves.

At the end: **0 unexplained bytes of 4096**, 263 hand-named addresses, 105
comments, 37 regions, 1 remaining warning (and that one cannot be removed
through the API — see friction §1).

---

## 1. What the program is

### Entry

The project shipped with `entryPoints: ["$8000"]`, which decoded five
instructions of garbage and stopped. `$8000-$8008` is a **CBM80 autostart
header**: `C1 83` = cold start `$83C1`, `E2 83` = NMI `$83E2`, then the five
bytes `C3 C2 CD 38 30` ("CBM80", top bit set on the first three) that the KERNAL
reset routine tests for. Declaring it data and marking `$83C1` a function took
the decode from 0 to 1474 instructions in one call.

### Boot chain

```
ColdStart $83C1
  SEI, CLD, SCROLX=$05, IOINIT, RAMTAS, RESTOR, CINT, CLI, CHROUT #$08 (lock charset)
  -> CopyCharsetToRam $82EC     ; $8E00-$8FFF -> $2000-$21FF, 64 glyphs
  -> InitVicSidAndScreen $8100  ; $D018/$D020/$D021, SID envelopes, row-address table
  -> BootDrawStatusLine $8818 -> DrawStatusLine $8806
  -> TitleScreen $8D8E
```

### The loop

```
MainLoopTop $83A0 -> MainLoop $8393
    JSR UpdatePlayer $8470
    JSR PauseOnKeyP  $821B
  -> MainLoopUpdates $83A3
    JSR UpdateLaser $84F8, UpdateZappers $859B, FireZapperBeam $8635,
        AnimateDroidsOnScreen $86D7, UpdateBombs $8753, ExplosionSfxStep $889A,
        UpdateDroids $88C9, ReloadTickIfWrapped $89A0, WaveClearedCheck $8AC8
  -> MainLoopDelay $83E8 (21x DEX) -> back to $83A0
```

**There is no interrupt of the game's own.** `$0314` is never written, `$D01A`
is never written, `$D015` is never written — checked as byte patterns as well as
as decoded instructions. But it does **not** run with interrupts off, which is a
correction I made to myself mid-run and posted to chat: `ColdStart` calls
`RESTOR` and then `CLI`, so the ordinary 60 Hz KERNAL IRQ runs underneath the
whole game. That is the only reason `$C5` is current, which is the only reason
the P-key pause works — nothing here scans the keyboard.

So the game is **unsynchronised, not uninterrupted**. Pacing is two counters
read at *different values* by different subsystems:

| counter | period | who acts |
|---|---|---|
| `tick $0D` | 128 (`ReloadTickIfWrapped` resets `$FF`->`$80`) | `==0` player, `==1` zappers, odd -> explosion sfx |
| `phase $0F` | 24 (`UpdateLaser` reloads `$18`) | `==0` laser, `==5` zapper beam |

`NextBeamChar $86D0` decrements `phase` a *second* time while a beam runs, which
is how the beam holds its slot. `CMP #$05 / BEQ` at the head of a routine is a
time slot, not a magic number.

### No randomness

Exactly **two** instructions read anything in the I/O page, and they are the same
instruction twice: `LDA $DC11` at `$8373` and `$8DB0` (CIA1 port B mirrored — the
joystick). No raster line, no SID oscillator 3, no CIA timer, no jiffy clock.
Spawn position is the constant `($0A,$02)`; wave sizes come from a table; the
zappers are periodic. **Given a starting level and a sequence of joystick inputs,
Gridrunner is fully deterministic.**

### The screen is the model

`PlotCharAndColour $8172` has 35 callers and is the only way anything is drawn.
`ReadCharAtPlotPos $818B` has 9, and every one of them is a collision test —
the game asks the screen what is in the cell it is about to move into. There are
no sprites and no coordinate comparisons anywhere.

Consequences, all verified:

- **Score, high score and lives are screen characters.** `$040F-$0415`,
  `$041B-$0421`, `$0427`. `AddToScore $8870` increments digits in place and
  carries by wrapping `$3A`->`$30`. There is no binary score.
- The high score survives a game because `DrawStatusLine` has exactly one caller
  (`$8818`, at boot) and `ClearPlayfield` starts at `$0450`, below row 0.
- The initial four lives is the byte `$8847` — the **first byte of the colour
  table** — read one past the end of the character table by a loop that runs
  `X = $28..1` over `table-1`. `ResetScoreAndLives` writes the same `$34`
  explicitly, so I cannot tell whether the overrun is deliberate.
- `PlotCharAndColour` reaches colour RAM by adding `$D4` to the pointer's high
  byte. Proved by execution (`run_block $8175`, `screenPtr=$0400`, `Y=$0A`):
  writes `$040A` and `$D80A`, and leaves `screenPtr` pointing at `$D800`, so
  every caller must rebuild it.

### The two enemies — and the mechanic that connects them

This is the thing the game turns on, and I got it wrong twice before reading it
properly.

**Chain droids** — glyphs `$13` (segment), `$14`/`$15` (head animating).
Three parallel one-based arrays `droidCol $1100`, `droidRow $1200`,
`droidFlags $1300`, all addressed `table-1,X`. Flags: **bit6 = head**,
**bit7 = tail**, bits 0/1 = direction (`EOR #$03` to reverse). A follower at
index X copies the position of index X-1. That is a snake in four instructions:
erase the tail, shift everything along, move the head. Verified by execution —
`run_block $8906` with `X=3` and element 2 at `($11,$09)` writes exactly that
into element 3 and sets `plotChar` to `$13`.

Shooting the **middle** of a chain does not shorten it: `PromoteNewSquadLeader
$8AA4` finds the chain's head, ORs its flags (including direction) into `X+1` so
that becomes a new head, and ORs `$80` into `X-1` so that becomes a new tail.
**One chain in, two chains out.**

**Pods** — glyphs `$18, $0D, $0E, $0F, $10, $11, $12`, which is
`droidAnimFrameTable $871F` read from index 1 to 7. A pod is held **nowhere but
on the screen**: no array, no coordinates, no id. `AnimateDroidsOnScreen $86D7`
scans `$0450-$07FF` byte by byte and advances any matching glyph one frame. A
laser hit steps it *backwards* (`LaserHitsChar $87CB` walks the same table in
reverse), so a pod takes several hits; killed at `$18` it scores 10; aged to
`$12` it becomes a falling bomb.

**The connection.** Glyph `$0F` — four frames from death — is written by exactly
two instructions in the whole cartridge:

- `$86C5`, in `EraseZapperBeam`: at the point where the two zapper beams cross.
- `$8A71`, in `CompactDroidArrays`: at the cell of a chain droid you just shot.

So killing a droid leaves a pod, and the zappers manufacture pods every time they
fire. The difficulty curve's fastest-moving parameter is how often the zappers
fire. That is the whole design in one sentence, and it is only visible once you
notice that `$8A6D-$8A77` draws something after removing the droid.

### Player death

`PlayerDies $8ADE` is `LDX #$F6 / TXS` — it throws the entire call stack away
rather than unwinding, which is the only way out of `MoveOneBomb` three frames
deep. Five live inbound jumps (seven counting two in unreachable fragments).
`routine_effects` reports the stack correctly at every one of the odd exits:
`$87FE` (PLA PLA RTS), `$8A41`, and `NmiHandler`'s three-byte RTI.

Then eight fragments burst outward on the eight compass directions
(`fragDeltaTables $8BC0`, encoded `$01`/`$00`/`$80` and decoded by *skipping*
INCs), 15 frames, and `LoseALife $8C17`.

### Levels

Three 32-byte tables at `$8CB4`/`$8CD4`/`$8CF4`, indexed **one-based** so the
base byte is the last byte of the preceding instruction — `$8CB4` is the high
byte of the `JMP $8D70` at `$8CB2`. Three bytes saved.

**There are 31 levels, not 32.** `NewLevel` does `INC level / CMP #$20 / BNE /
DEC level`, so `level` can never exceed `$1F`, and the entry-`$20` bytes can
never be indexed. `$8D14 = $05` is one byte of genuinely dead data: the zapper
interval for a level 32 the cap makes unreachable.

Full curve is in the comment at `$8CB5`. Two outliers I **cannot** settle from
the code: level 13 is `16 waves x 3` where its neighbours are `5-6 x 10-15`
(both numbers jump at once, which is what a transposed pair looks like — but 48
short chains is a fine boss level), and level 29 is `7 x 3` between neighbours of
23 and 24. What would settle it: play them in an emulator, or diff these 96
bytes against a second dump.

### Scoring

- pod finished off at `$18`: **+10** (`ScoreDroidKill`, X=6 Y=$0A)
- chain segment `$13`: **+100**
- chain head `$14`/`$15`: **+400** (`$8A21` adds 300 then falls through for 100)

### The author's habit

Six real `CLC / SBC` sites (`$8278 $828C $82C9 $82E4 $8411 $869A`) and **zero**
`SEC / SBC` anywhere in the 4K. On a 6502 that means every subtraction in this
program is one less than it reads. Proved rather than argued: `run_block $8264`
with `fxCounter=$0F` leaves `plotCol = $04`, where `$14 - $0F` is `$05`. All six
are inside visual or volume effects where one out is invisible, which is
presumably why it survived.

### Archaeology

~110 bytes are unreachable. Most is NOP padding and four little routines with no
callers (`$8984` two droid helpers, `$8AD4` a plot-unless-player, `$8AF1` a bomb
fall-off test) — all things the live code now does inline.

The interesting one is `$8009-$8014`. It is not filler: it is the **tail of the
charset-copy loop**, and the byte offsets prove it. Lay the surviving loop from
`$82EE` out starting at `$8000` and it lands as `$8000 A2 00 / $8002 BD 00 8E /
$8005 9D 00 20 / $8008 BD 00 8F / $800B 9D 00 21 / $800E CA / $800F D0 F1 /
$8011 4C 00 81`. Everything from `$8009` on is exactly that, byte for byte,
**including the branch displacement `$F1`, which resolves to `$8002`** — the loop
head that would have been there. The nine-byte cartridge header covers
`$8000-$8008` and clipped the `LDA` opcode at `$8008`; nothing else was touched.
The copy originally lived at the very start of the cartridge and was moved to
`$82EC` when the CBM80 vectors needed the first nine bytes.

Similarly `$8DCB/$8DCC` are `B0 8D` — the operand of a `JMP $8DB0` whose opcode
is gone, followed by 19 NOPs.

---

## 2. What fought me

Blunt, as asked. Ordered by how much it cost.

### 1. There is no way to remove a declared entry point

The project shipped with `$8000` as an entry point. It is a vector table. Having
correctly declared it data, the analysis now warns *forever*:

> `$8000: this analysis arrives here and it is declared data, so decoding stops.`

That warning is the single remaining one in the project and it is permanently
unfixable through the API. I called `remove_entry_point` to put it in the
transcript; it does not exist. `describe_project` now lists **155** entry points
because every `type:"function"` label becomes one, so the field is no longer
readable as "where does this program start" — the one question a reader coming
to the project cold would ask it.

Two things wanted: a way to retract an entry point, and a way to distinguish
*declared* entry points from *derived* ones in `describe_project`.

### 2. Batch writes silently drop the items they refuse

`bind_constants` with 43 bindings returned 42 `did` lines and said nothing about
the 43rd. The same call to the singular `bind_constant` gives:

> `REFUSED: $849F loads $0E, but ROW_PLAYER_TOP is $0F.`

— which is exactly the message I needed and did not get. It happened twice
(43->42, 20->19) and both times I only found out because I went looking.
`set_labels` and `set_comments` list every item they did, so a short `did` list is
the only signal, and on a 43-item call nobody counts.

This is the same class of bug as the `run_block` schema note in CLAUDE.md: the
batch wrapper is not tested for what the singular tool refuses. **A batch tool
should report its refusals, not just its successes.**

### 3. `set_region kind:"code"` decodes from the first address only, and stops

I declared `$8984-$8990` (12 bytes, two dead routines) as `code`. It decoded 5
bytes — up to the first `RTS` — and left 7 still in `find_undecoded`. Same at
`$83FD` and `$898F`. Getting to zero unexplained bytes took four extra one-byte
`code` regions, placed by reading the byte dump myself to find where each orphan
run restarted.

A `code` region is a claim about a *span*. Decoding only its first address makes
it a claim about a point, and the difference is invisible until you re-run
`find_undecoded`.

### 4. A one-byte `code` region creates a fall-through warning

Declaring the single `$EA` at `$881E` as `code` made the walk decode it and fall
into `statusLineCharTable`, producing "arrives here and it is declared data".
Declaring the identical byte as `data` is silent. So the *correct* description of
a padding NOP (it is an instruction) is the one that generates a spurious
warning, and the way to a clean warning list is to describe it wrongly. I took the
clean list and said so in the region comment, but I should not have had to choose.

### 5. `routine_effects` saturates on a JMP-chain program

`routine_effects $8470` (UpdatePlayer, a 23-block routine that reads the joystick
and moves one character) returns an `including_what_it_calls` set of ~60 reads
and ~70 writes — essentially every variable and SID register in the program.

The path is real: `DieUnlessHarmlessChar` -> `JMP PlayerDies` -> stack reset ->
death animation -> `LoseALife` -> `NewLevel` -> `StartLevel` -> the main loop. So
the closure is correct and it is also useless. The answer to "what does
UpdatePlayer touch" is "everything", for every routine that can reach the death
path — which here is most of them.

CLAUDE.md already reasons carefully about where a routine *ends* (a `JMP` ends
it, and `continuesInto` folds the target's effects into `total`). The `JMP` that
ends the routine is exactly the one whose effects should probably **not** be
folded in when the target resets the stack. `PlayerDies` doing `TXS` is a
detectable signal that control is not coming back and that this is a program
transition rather than a continuation.

Minimum useful fix: report `itself` and `continuesInto` separately from `calls`,
so a reader can see which half of the union came from a tail jump.

### 6. The main loop is three routines and cannot be asked about as one

`call_graph $8393` shows two calls, because `MainLoop` ends at its `JMP $83A3`.
The nine update routines — the actual content of the loop — are under `$83A3`,
and the delay is under `$83E8`. Getting the shape of the frame took three calls
and me knowing to make them.

That is the documented rule working as designed, and I am not arguing against the
rule (it is what stopped `ColdStart` swallowing the program). But a JMP-chain top
level is not an exotic case on this machine, and the tool has the information to
say "this routine continues into `$83A3`, which continues into `$83E8`, which
jumps back here — this is a cycle of three". It says nothing.

### 7. No way to ask "what writes this variable"

I wanted `find_writes($0D)` and called it; it does not exist. The workaround is
three or four `find_instructions` calls (`STA`, `INC`, `DEC`, and `STX`/`STY` if
you are being careful) and mentally unioning them. For a program whose entire
state is 40 zero-page bytes, "who touches `tick`" is *the* question, and it costs
four round trips and a risk of forgetting a mnemonic.

`find_instructions` with a `from`/`to` covering one address is nearly there — it
just filters by mnemonic when it should be able to filter by *effect*.

### 8. Custom character sets: the decoder works, and only for regions

CLAUDE.md lists this as unsolved and it is half-solved now. A stored decoder plus
`view: "snippet:<id>"` makes `$8080` render as
`(c) 1982 HES  PRESS FIRE TO BEGIN` right in the listing, which is excellent and
was the single biggest readability win of the run.

What it does not reach is **immediate operands**. `LDA #$13` is a droid glyph and
`LDA #$3A` is the character after '9'; a constant covers each site individually,
but there is no way to say "in this program, byte `$13` is a character and here is
the alphabet". CLAUDE.md's own argument — "a value has no single meaning" — is
exactly right and exactly why this is awkward: `$07` is the ship glyph, the colour
yellow, and the loop bound for seven digits, all in the same 4K.

### 9. Two of us wrote the same decoder within a minute

`beryl` and I independently wrote character-set decoders with the same mapping,
60 seconds apart, on a project we both knew was empty. Neither of us called
`list_decoders` first, because why would you list the decoders of a blank project.

I do not think this is a missing tool. It is a missing *moment*: `set_decoder`
knows the project already has a decoder over roughly the same idea and could say
so, the way `set_region` says `nestedInside`. Cheap, and it turns a duplicate into
a conversation.

### 10. Two authors, two names, one value — and nothing sees it

We converged on the same **facts** with different **names**: `CHAR_SHIP`/
`GLYPH_SHIP` at `$07`, `CHAR_EMPTY`/`GLYPH_GRID` at `$00`, `CHAR_BOMB`/
`GLYPH_BOMB` at `$0A`, `CHAR_SPACE`/`GLYPH_BLANK` at `$20`, `CHAR_LASER`/
`GLYPH_LASER_A` at `$08`. The listing's equate block prints both. Two constants
with one value is legal and deliberate (`LEFT_ZAPPER`/`WHITE`), so re64 correctly
does not object — but `beryl` also rebound a number of my sites to their names,
and I could not see that had happened without diffing `changes_since`.

The rebinding is *fine*, and their convention is better than mine. The problem is
that a silent rebinding war is possible and invisible. `changes_since` is the only
instrument, and it reports 91 lines of `read $85CD as a constant` with no
indication that the site already had a different constant bound. **A rebind is a
different event from a bind and should read as one.**

### 11. Smaller things

- **`find_bytes` does not say a hit is mid-instruction.** Searching `18 E5`
  (CLC/SBC) returned `$83D2 [ColdStart]`, which is inside the operand of
  `JSR $E518`. It reports the containing routine, so it knows; it just does not
  say. On a partial-pattern search — which the tool's own description recommends —
  this is the normal case, not an edge case.
- **Extents on screen addresses collide, because the screen is an overlay.**
  `screenByJeffMinter` (`$04FB`, extent 14) and `screenBattleStations` (`$04FE`,
  extent 18) both cover `$04FD`, so `STA $04FD,X` renders as
  `screenByJeffMinter + $0002,X` in a routine that has nothing to do with the
  title screen. Both labels are true; they describe the same cells at different
  *times*. That is CLAUDE.md's overlay problem showing up in the label layer, one
  level below where the note expects it.
- **`table-2` is not renderable.** The droid arrays are one-based, so
  `droidCol-1,X` renders (the documented +/-1 idiom) but reading the entry *ahead*
  needs `droidCol-2,X`, which falls out of tolerance. I named `$10FE`/`$11FE`/
  `$12FE` explicitly and explained why in a comment, which is honest but is three
  labels for what is one fact about one array.
- **`remove_region` by start address is right and I still got bitten by nesting.**
  Declaring `$8DE1` text nested it inside `beryl`'s `titleStrings ($8DE1-$8DFF)`
  and said so. Declaring `$8DF1` — same outer region, same end address — reported
  no nesting at all. Both are nested; only one said so.
- **`find_immediates` uses `boundTo`, not `constant`.** My mistake, not the
  tool's, but I wasted a call proving a non-existent bug because the field name I
  guessed was the obvious one.
- **`whoami` refuses `{"project": ...}`.** Every other tool takes it. Trivial, but
  it is the *first* call the brief tells you to make.

---

## 3. Collaboration

Worked, and better than I expected. `beryl` posted a lens statement within 12
seconds of mine and we had a clean split (they took VIC/SID/colour/art, I took
control flow) inside 90 seconds, before either of us had done any real work.

What the chat was actually used for, in order of value:

1. **Handing over the character-set mapping.** They found it independently, but
   the one message saved whoever read it second an hour.
2. **Correcting each other.** I corrected their `$30` (it is both `0` and `O`),
   their `$8C61`/`$8C62` base and their "40-byte colour table"; they had already
   found `PlotCharAndColour`'s `+$D4` trick before I posted it.
3. **Correcting myself in public.** Twice: "the KERNAL IRQ is running after all"
   and "the `CMP #$07` at `$8646` is the beam glyph wrap, not the ship — I had
   bound a constant to it". Both changed conclusions the other agent had a reason
   to rely on. The chat is the only place a *retraction* has anywhere to live: a
   comment gets overwritten and leaves no trace that it was ever wrong.
4. **Declining to tidy.** I told them I would not rebind their sites rather than
   just doing it. That is the one thing I would not have bothered to say to myself.

Three sessions were reported at the start (`agate`, `amber`, both claiming
`lead`) before `beryl` appeared. My own session was stable across every call.

## Artifacts left in the run directory

- `report-lead.md` — this file
- `listing.txt` — the full annotated disassembly, as `export_listing` renders it
- `gridrunner.re64.json` — `export_project` output at the end of the run

Tags `lead-structure` and `lead-final` mark the two points worth diffing from.
