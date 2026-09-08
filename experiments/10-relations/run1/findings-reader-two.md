# Findings — reader two (beryl), experiment 10 stage 1

Scope actually worked: the runtime image from `$88D4` through the end of the
image (`$C11E`), the reserved tail at `$9FEF`-`$BFFF`, and — jointly with
reader one once my area was clear — a pass through `$5848`-`$87FD`. Reader one
(basalt) had `$0801`-`$5DFF` and the live highscore table at `$5E00`; see their
findings for that half. What follows is what I did and saw, from the bytes,
using the shared project as the record — this file is the summary, not the
source of truth.

I already knew, before opening anything, that this is *Revenge of the Mutant
Camels* (Llamasoft / Jeff Minter). I did not use that to decide what any byte
means; every claim below cites the code or data that justifies it. Reader one
flagged the same prior knowledge independently.

## What the program is made of

- **A tiny loader tail at `$C065`-`$C11E`.** Two KERNAL routines: one loads a
  file over LOAD, one SAVEs. Both point `SETNAM` at the same 16-byte name at
  `$C102`, `"ATTACK MUTANT.HI"` — a highscore file, not the game's own title.
  `$C082` (the SAVE path) is reached only from deep in the game
  (`loc_9F90`'s game-over handling jumps here), not from cold start, so it
  reads as "write the default/current scores back out before finishing," not
  "boot the machine." `$C0B9` sets the IRQ vector back to the stock KERNAL
  entry ($EA31) — i.e. restores normal operation rather than installing
  anything. `$C019`-`$C061` hold two more things worth knowing by name:
  `patch_arm_countdowns` / `patch_freeze_countdowns`, a matched pair of
  self-modifying-code patchers (below), and a one-instruction trampoline
  (`tramp_9DBB`) — the `$C0xx` page seems to be used as a fixed anchor for
  small, callable pieces regardless of what they do.

- **A raster-driven main loop.** `raster_irq_handler_body` ($88D5) is a
  three-way raster split (`raster_split_dispatch`, $8BC9) driven by a phase
  counter at `$1E`: two passes just move the raster-compare point and rescroll,
  the third does the real per-frame work — reads sprite/sprite collision,
  gates on a "was a special key pressed" check (`sub_96D2`, itself reading a
  small two-table range check at `tbl_96F7_range_lo`), and round-robins seven
  housekeeping jobs off a second counter at `$1F` (HUD countdowns, a scroll
  wrap, the wave animation, a table walk I did not chase further).

- **A slot -> type -> template object system.** Every active game object lives
  in one of at least 16 numbered slots. `obj_type` ($1D10) tags a slot with a
  small type number; `obj_behavior_and_flag` ($1FB0) packs a live/dead flag in
  bit 7 and, in the low 7 bits, an index into `obj_behavior_jumptable` ($9933)
  — a real jump table (3 confirmed entries: `$9939`, `$994F`, `$99C0`), so an
  object's type number literally *is* the address of the routine that updates
  it, one indirection removed. `spawn_object_from_template` ($9772) creates an
  object: given a slot X and a type Y, it copies one byte from each of ten
  separate per-type template arrays (`$1DA8`, `$1DB0`, `$1DB8`, `$1DC0`,
  `$1DE0`, `$1DE8`, `$1DF0`, `$1DF8`, `$1E18`, `$1E20` — all indexed by Y) into
  the matching ten per-instance arrays (indexed by X), then stamps `obj_type,X
  = Y`. This is the central "one thing refers to another" relation in the game
  and it is now named end to end in the project, even though it could not be
  a single `add_type` record (see below).

- **Sound.** A one-voice music sequencer (`loc_88F7`) walks a stream of
  `(duration, note)` byte pairs (declared as type `MusicStep`) terminated by
  `note = $F0`, looks the note up in a split low/high SID-frequency table
  (`sid_note_freq_lo`/`hi`, $898C/$89CD, 65 entries), and pokes `$D400-$D404`.
  `sub_9170` points the sequencer at `$5FFE` for one track; a second pointer
  is set to `$631E` for what is very likely a second track I did not fully
  verify. `music_track_1` (280 steps, $5FFE-$622D) is claimed as a record
  array of `MusicStep`.

- **A wave/pulse animation.** `wave_anim_frames` ($8DF4, confirmed with
  `render` — it draws as a peak sliding across 8 columns through 16 frames)
  sits right after `hud_status_text`, which reads `"...OF THE MUTANT CAMELS
  PLAYER ONE  0000000  NEXT ZONE 00 KM    NEUTRONIUM STATUS
  HHHHHHHHHHHHHHHHHH  "` — so the animation is almost certainly the
  NEUTRONIUM STATUS meter.

- **A self-modifying-code pair.** `patch_arm_countdowns` ($C023) and
  `patch_freeze_countdowns` ($C046) overwrite the *opcode* byte (never the
  operand) at up to 7 shared addresses elsewhere in the program, swapping
  `DEC`/`INC`/`STA` for the corresponding `LDA`, so the same handful of
  instructions can be toggled, in place, between actually mutating state and
  just reading it. Only `patch_arm_countdowns` has a found caller
  (`loc_9D59`); I could not trace who calls the freeze side.

- **Genuinely empty space.** `$9FEF`-`$BFFF` (8209 bytes) is all zero past 18
  stray bytes right at the start — code ends cleanly at `$9FEC` just before
  it, so this is not a decode gap, it is memory nothing in the image uses (a
  runtime scratch area, most likely — declared as such, not invented content
  for it).

- **The bulk of the low image (`$0801`-`$5DFF`) and the title/options/credit
  screens are reader one's territory** — see their findings for
  `sprite_sheet_main`, the options text, `PlayerSlot`/`cur_player`,
  `HighScoreEntry`, and the keyboard-scan tables.

## What I could not close

- **`$6230`-`$87FD` (roughly 8.6 KB).** Past the end of `music_track_1` this
  span has no absolute-address reference anywhere `find_references` or
  `find_immediates` can find (checked several page-aligned high bytes by
  hand: `$60,$68,$70,$78,$80,$88` — none point in). Small groups of values
  there (e.g. `83 81 01 87 82 83` at `$6800`) look like the same
  flag+7-bit-value convention the object tables use, which is consistent with
  per-level/wave parameter data, but I do not have a caller to confirm it, so
  I left it unclaimed rather than guess a shape I could not check.
- **The 208-byte `highscore_entry_1..4` gap** (reader one's records at
  `$5474`) and my own **`music_track_1`** both still show up in
  `find_undecoded` even though they are fully typed and fielded — confirmed
  independently by both of us. `is:"data"` / `"text"` / `"bitmap"` /
  `"jumptable"` claims clear the gap; `is:"record"` claims do not. This looks
  like a real gap between `find_undecoded`'s notion of "explained" and what
  `add_type` + a record claim actually records.

## Workarounds, with counts

- **Probing an undecoded span by force-adding `root:"routine"`, then reading
  the result to see if it's plausible 6502, and reverting if not.** This is
  the only way I found to test "is this code" before committing. I did this
  roughly 20 times across my area. **6 of those had to be reverted**
  (`remove_claim` + re-claim as data) because the forced decode produced
  garbage or an overlap warning: `$90E4` (illegal SRE/NOP opcodes — turned out
  to be `hud_status_text`), `$9D21` and `$9C4A` (a spurious `BRK` from a
  stray `$00` byte before a small table), `$8CA3` and `$9565` (overlap
  warnings — both turned out to be dead bytes skipped by a nearby `JMP`), and
  `$9933` (decoded as `AND`/`STA`/`RTS` before I found the real reader,
  `sub_993A`, and realised it is `obj_behavior_jumptable`, a jump table, not
  code at all).
- **`edit_claim` cannot revise a claim's `comment` or `method`** — only
  `name`/`is`/`extent`/`root`. I hit this once (correcting the `irq_dummy_rti`
  claim at `$88D4`) and worked around it with a follow-up `add_comment`
  standing beside the original rather than replacing it.
- **Computing a hi/lo byte pair into a 16-bit address by hand.** I did this
  more than twice: `$9933`'s jump-table entries (`$9939`, `$994F`, `$99C0`),
  the music sequencer's two pointer pairs (`$5FFE`, `$631E`), and the screen
  row/colour-RAM pointer conversion in `plot_char_and_color`
  (`$04xx + $D4 -> $D8xx`). Each time I did the arithmetic in a short inline
  Python one-liner rather than by hand in my head, but it was still the same
  manual step every time — there is no tool here that resolves "the word at
  this address, read as an address" for me.
- **Deciding whether a byte span is text by eye/by hand.** I decoded hex to
  ASCII/PETSCII/screen-code by hand (via short inline Python) more than a
  dozen times before committing a `text` claim — for `hud_status_text`, the
  filename, the "TWO" fragment, and two hidden screen-code strings ("I LIKE
  CAMELS REALLY" in the live highscore default name, "WACKY"/"WHACKERS" near
  `$6A00`, the latter not claimed — outside my area and un-confirmed). There
  is no "try decoding this span as text and show me" tool; `render` draws
  bitmaps and chars from a *claimed* span, but nothing previews an unclaimed
  one as text.
- **Scanning a large span for "is this all zero" or "where does a repeating
  pattern stop being plausible."** I wrote two small one-off Python scripts
  (run inline via heredoc, not saved as files) for this: one that pulled
  `$A001`-`$BFFF` in two 8192-byte `read_bytes` calls and checked every byte
  was zero (confirming `reserved_9FEF_BFFF` before claiming it), and one that
  scanned the music data byte-pair-by-byte-pair against a plausibility rule
  (`duration <= $20`, `note` in range or `$F0`) to find where `music_track_1`
  stops being trustworthy. Neither script is saved anywhere; they were
  throwaway checks, described here rather than left as files per the brief.
- **`add_claims` (the batch form) has no `method` or `typeId` field**, unlike
  single `add_claim`. Since I wanted `method` recorded on every claim (the
  axis the project asks for — guessed vs read vs derived), I never actually
  used the batch tool and made every claim, however small, as an individual
  `add_claim` call. This cost turns but kept provenance honest.
- **`find_references`/`find_instructions` cannot see through indirect jumps,
  zero-page pointers, or self-modifying targets** — stated up front by the
  tool itself on every call, but it is worth naming as a workaround-driver: it
  is why the sprite routine at `$8B5F`, the `patch_freeze_countdowns` caller,
  and the `$6230`-`$87FD` span all had to be reasoned about from adjacency and
  opcode shape rather than a caller list.

## What I built for myself

Nothing persistent — every script above was a short inline Python heredoc run
once for a specific question (byte-plausibility scan, hex-to-ASCII decode,
zero-fill check) and discarded. I did not write any other file in this
working directory besides this one; the working set was small enough that a
throwaway one-liner each time was faster than maintaining a script.

## What I would want that does not exist

- **A "preview as text" call that takes raw, unclaimed bytes and shows the
  PETSCII/ASCII/screen-code decode without committing a claim** — the
  opposite direction of what `render` does for bitmaps. I decoded text by
  hand every time because there was nothing else to reach for.
- **A "does this look like code" check** distinct from actually forcing a
  root and inspecting the result. Six wrong force-decodes were the cost of
  not having this; a lightweight "does the byte at this address, and a few
  bytes after it, look like a valid 6502 instruction stream" would have saved
  every one of them.
- **`is:"record"` claims clearing `find_undecoded` the way `data`/`text`/
  `bitmap`/`jumptable` do.** This is a reproduced, confirmed inconsistency
  (independently hit by both readers), not a wish — flagging it because the
  brief asks for exactly this distinction.
- **A way to express a "struct of arrays" relation** — the ten parallel
  per-type template tables feeding `spawn_object_from_template`, and the two
  parallel `sid_note_freq_lo`/`hi` tables, are each one logical record whose
  fields live at the *same offset across several separate base addresses*
  rather than at different offsets from *one* base. `add_type` only expresses
  the latter (an array-of-structs at one address). I worked around this by
  naming every array and cross-referencing them in comments, but there is no
  claim in the project that says "these N addresses, read at the same index,
  are one record" the way `add_type` says "these N offsets, in this one span,
  are one record."
