# Findings — reader one (basalt), experiment 10, stage one

Project `camels`, target `runtime`, $0801-$C11E (47,390 bytes). Two entry points,
$C065 and $8A3C. I worked the low half of the address space: the $0801-$4FFF
sprite sheet and the $5000-$5DFF options/title-menu screen, plus a few claims at
$5E00 that reader two (beryl) and I agreed belonged with a type I already owned.
Beryl covered $88D4 onward, $9FEF-$BFFF (which turned out to be empty), and
$C0xx, and then picked up $5848-$87FD in parallel with me once her area was
clear. Everything below is what the *project* now holds, not just what I
noticed — claim ids and addresses are in the project if anyone wants to check.

I already knew, before opening this file, that this game is Jeff Minter's
*Revenge of the Mutant Camels*. I did not use that to skip reading anything —
the credits scroll at $5A00 and the "ATTACK MUTANT.HI" highscore filename
(found independently by beryl at $C102) confirm title and author from the bytes
themselves — but I am saying so rather than presenting either as a cold
discovery.

## What the program is made of

**$0801-$4FFF (18,431 bytes): one sprite sheet.** ~288 standard 64-byte hi-res
C64 sprites back to back, no code reaches it anywhere in the paths decoded so
far. Rendered in 16-wide grid chunks: camels in several walk/leg positions,
small flying enemies, falling parachute figures, devil/pitchfork and skeleton
figures, a robot, digits and letters, and a band of sprites that render as
visual noise in a plain hi-res view (possibly busy particle/debris sprites,
possibly a different frame convention — not resolved). I could not find the
code that points the VIC at any of these by index (see workarounds), so this is
recorded as one bitmap claim with a descriptive comment, not a per-sprite index.

**$5000-$5847: the title/options screen.** A coherent little subsystem:
- An "OPTIONS" section with three toggles read from key scancodes off `LSTX`:
  player count (0/1, a zero-page byte I named `cur_player`), a "WAVE SEQUENCY
  NORMAL"/"RANDOM" mode, and a "DISTANCE BETWEEN ZONES" difficulty counter
  (zero page $57, rendered as two BCD-ish digits by `sub_5300`).
- A default high-score table (`HighScoreEntry` records, $5474, 4×52 bytes) with
  Minter's own placeholder scores/messages ("I LIKE CAMELS REALLY", "I GOT
  NOTHING AGAINST SHEEP EITHER", "LLAMAS ARE LLOVELY", "2D SPACE INVADERS RULE
  THE ZONE OK").
- A previously-unreferenced routine, `seed_highscore_buffer` ($545C, no root
  reached it until I added one), that fills $5E00-$5EFF with spaces and then
  copies that 208-byte table into it, **masking each byte with `AND #$3F`**.
  That mask is the actual relation: it converts PETSCII/ASCII letter codes
  (0x41-0x5A) to screen codes (0x01-0x1A) in one instruction. $5E00 is exactly
  the buffer beryl found the C0xx routines LOAD/SAVE as `ATTACK MUTANT.HI`, so
  this one instruction ties together three things three different reads had
  turned up separately: the default table, the live save buffer, and the save
  file. I typed both encodings as separate types, `HighScoreEntry` (PETSCII)
  and `HighScoreEntryLive` (screen-code), rather than force one type to cover
  both.
- A keyboard input relation for the name-entry screen: `kbd_scan_table` ($56CD,
  31 raw CIA scan codes from `LSTX`) and `kbd_char_table` ($56AE, 31 screen
  codes, same index space, `$FF`-terminated). `sub_5695` searches the first
  table for the current scancode and uses the matching position to index the
  second — a scancode is not a character, it is a name for a position in a
  second table.
- A per-player split-screen mechanism: zero page `cur_player` ($0056) selects
  between two 128-byte blocks, `player1_state`/`player2_state` at $5F00/$5F80
  (typed `PlayerSlot`), swapped with the live screen row and three zero-page
  pointers by `sub_5359`/`sub_539B`. The same byte also selects which of two
  suffixes ("ONE"/"TWO") three separate HUD strings end in, done three
  different ways in three call sites (an offset trick, and two copies of a
  4-byte patch table) — the same relation, implemented three times, one worth
  reading if anyone asks "why does this code exist in triplicate."
- HUD status strings: "BEASTS REMAINING", "STAND BY YOUR BEAST", "YOUR BEASTS
  ARE EXTINCT", "ENTER YOUR NAME", "HERE WE GO", "WELL DONE YOU HAVE SAVED
  CAMELKIND", "CHEAT MODE OPERATIVE", "PAUSE MODE ON ... ANY KEY RESTARTS".
  Several contain a recurring family of non-letter glyph bytes (0x51, 0x52,
  0x54, 0x56) that are not A-Z or digits — almost certainly punctuation/icons
  in this game's own redefined character set. I did not try to identify which
  glyph is which.
- A 1024-byte credits/intro scroll at $5A00, ending exactly at $5E00. Opens
  "WELCOME TO REVENGE OF THE MUTANT CAMELS / THIS PROGRAM WAS WRITTEN OVER A
  TWO MONTH PERIOD BY JEFF MINTER / THE INTRODUCTORY MUSIC WAS ARRANGED FOR
  TH[E...]". I read the opening lines and stopped there — it's 1024 bytes of
  prose and the point of the claim is coverage, not a transcript.
- A 144-byte span at $5870 I could not explain: read as plain ASCII it contains
  fragments that look like 6502 mnemonics with operands (`STA $07F7,X`, `RTS`,
  `TYA`, `AND #$07`, ...) in a repeating ~8-9 byte shape (a $00, two mystery
  bytes, literal `X`, two more mystery bytes, literal `6`, a space, then the
  mnemonic text) — recorded as plain data with the pattern described, not
  guessed at further.
- Two small paired-byte tables at $5900 that look like a short tune (beryl
  later typed the shape properly as `MusicStep`: duration + note-index, `$F0`
  end marker, read by the sequencer at $88F7 against the SID note tables she
  found at $898C/$89CD).

**Beryl's area** (from her reports, which I read but did not verify myself):
raster IRQ at $88D4 driving a 703-instruction per-frame routine; a 65-note SID
frequency table split lo/hi; an animated wave/pulse sprite strip, probably a
status meter; a slot→type→template object system (`obj_type,X` at $1D10,
`spawn_object_from_template` at $9772 copying per-type template arrays into
per-instance arrays — a relation she could not express as one `add_type`
record since the fields are separate parallel arrays); an object-behavior
jumptable at $9933; and a self-modifying patch pair toggling 5-7 addresses
between mutating and read-only forms, likely attract-mode vs. real play.
$9FEF-$BFFF is genuinely empty (all zero) rather than a decode gap.

## What I could not record in the project, and what I did instead

Counted as they happened, not reconstructed afterward:

1. **Address arithmetic for sprite rows, done by hand/inline-script: 8 times.**
   `render` and `read_bytes` take a byte address, not a sprite index, so every
   time I wanted "row N of the sprite sheet" I computed
   `$0801 + row*16*stride` myself. I got the stride wrong the first time (used
   63, the sprite's own data size, instead of 64, the stored stride — the
   grid's own cell count only makes sense with 64) and produced a garbled
   render before noticing. I did not write a reusable script for this until
   writing this report — I should have, after the second time, per the
   brief's instruction, and did not.

2. **Screen-code / PETSCII text decoded by hand with a small Python script,
   6 separate invocations, ~20 strings total**, before committing them as text
   claims. There is no tool call to preview how a span of bytes would decode
   under an encoding without first adding a claim, so I built a tiny
   `sc()`/`ascii_()` mapper locally and ran raw hex I'd copied out of
   `read_disassembly` output through it. This is also how I caught my own
   mistake below.

3. **Wrong encoding on `HighScoreEntry.message`, found and corrected once.**
   I first typed the message field as `char(38,screen)`, by analogy with the
   HUD strings nearby. `read_disassembly` then rendered it as line/card-suit
   glyphs instead of the readable "I LIKE CAMELS REALLY" I'd decoded by hand
   from the raw bytes. Comparing the two told me this table is stored as plain
   PETSCII/ASCII (letters 0x41-0x5A), not screen-code (0x01-0x1A) — digits and
   spaces are identical in both schemes, which is why only the message field
   looked wrong and not rank/score. I fixed it with `edit_type`. Recording this
   because it is exactly the kind of thing that would otherwise get
   re-discovered by whoever reads this table next.

4. **`find_undecoded` does not appear to clear a span for `is:"record"` claims.**
   I added 4 `HighScoreEntry` records at $5474 (208 bytes, fully fielded per
   `claims_at` and `read_disassembly`) and `find_undecoded` still reported the
   whole 208 bytes as an undecoded span, both immediately and after further
   unrelated claims. The same was true later for the 4 `HighScoreEntryLive`
   records and the two `PlayerSlot` records — none of the 6 record claims
   (568 bytes total) moved `unexplainedBytes`, while every `is:"data"`,
   `"text"`, and `"bitmap"` claim I added did. I did not try to fix this (not
   my tool to fix); I cross-checked each record claim by hand with
   `claims_at`/`read_disassembly` instead of trusting the gap count, and told
   beryl so she would not spend time on the same confusion.

5. **The `bank_copy_ptr_tbl` indexing scheme.** `sub_5007` builds a source
   pointer from two tables indexed by an X the *caller* sets before the call;
   nothing in the code reached so far sets that X, so I could not confirm
   whether the two tables are lo/hi byte arrays indexed 1:1 or a table of
   packed 16-bit addresses indexed by 2. I recorded both readings in the
   comment and left it there rather than picking one.

6. **The $5870 mystery block.** Described its repeating byte shape and the
   mnemonic-shaped text fragments inside it, and said plainly that I do not
   know what it is, rather than filing it under a guessed type.

7. **Sprite→object identity.** I could not find code that writes the VIC
   sprite-pointer registers ($07F8-$07FF) or otherwise selects a sprite by
   number — `find_instructions` against that range came back empty, and a
   broader `find_instructions` call reported (unprompted) that it is holding
   back results from "6 indirect accesses" it cannot resolve, without saying
   where they are. That code is most likely in beryl's $88D4-$9Cxx or the
   still-partly-open $5848-$87FD. So the sprite sheet is recorded as one
   visually-grouped bitmap, not as named, individually-addressable sprites.

## What I built for myself

- `call.sh` — a one-line wrapper around `experiments/mcp-call.sh` pinned to
  `RE64_PORT=5193 RE64_USER=one RE64_SESSION=one`, so every call in this
  session was just `./call.sh <tool> '<json>'`.
- Local `.bin` dumps of $0801-$4FFF and $5848-$5DF7 (via chunked `read_bytes` +
  a small Python script pasting the base64 chunks together), so I could run
  pattern scans — a printable-run finder and a long-same-byte-run finder —
  offline instead of re-querying the server for every hypothesis about where
  text or padding might be.
- The small screen-code/PETSCII decoder mentioned above (inline, not saved to
  its own file — in hindsight it should have been, see above).
- Used local PIL to slice the rendered sprite-sheet PNGs into individual
  21-pixel-tall row strips at 3x zoom, since `render` itself said a sheet that
  size is "meant to be looked at rather than read" as ascii art.

## What I would want that does not exist

- **A way to preview a text/record decode before committing a claim** — even
  something as small as `read_bytes` taking an `encoding` parameter that
  applies the same screen/petscii/ascii mapping `add_type`'s `char(n,...)`
  does, returning decoded text alongside the hex. I wanted this after the
  first string, kept wanting it, and only stopped needing it once I'd
  effectively rebuilt it myself in Python.
- **`render`/`read_bytes` accepting a sprite index directly** (`sprite(pointer)`
  already exists for the *place* form, but only once something has told the
  tool where the pointer table is — for a sheet nothing references yet, I
  still had to do `base + index*stride` by hand every time).
- **`find_undecoded` (or some other visible signal) telling me `is:"record"`
  claims do not close a gap**, or fixing that they don't — I only found this
  by noticing the byte count stop moving and checking by hand.
- **`find_instructions`' "incomplete" note naming the unresolved addresses**,
  not just a count — I wanted exactly those 6 indirect-access sites to find
  the sprite-pointer code, and had no way to ask for them.

I tried the direct route each time first (a plain tool call with the obvious
arguments) before reaching for any of the above.
