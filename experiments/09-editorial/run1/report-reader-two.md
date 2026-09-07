# findings.md — reader two (codename: beryl)

Draft, updated as the session continues. Final pass happens after the editor
releases the readers.

## What I found, and how I know

### The IRQ handler was invisible, and most of the game's "second half" lived inside it

`describe_project` on a blank read showed 2481 instructions decoded from
entry points `$C065`/`$8A3C`. Reading `sub_886F` (called from the init chain
at `$8A62`) showed `STA CINV` ($0314/$0315 = `$88D5`) and `STA NMINV`
($0318/$0319 = `$88D4`), followed by `CLI`. Nothing in the project pointed a
root at those addresses, so the whole span was rendered as "data" even though
it plainly held real, valid 6502 code (VIC raster-split control, the SID
music player, the keyboard-cheat check).

Declared `$88D5` and `$88D4` as entry roots (`add_claim ... root:"entry"`,
method `read`). Delta: +760 instructions in one write, +1 for the NMI stub
(which is just `RTI`). This is the single highest-leverage claim I made all
session — everything downstream (the cheat check, the raster split, one whole
music voice) was unreachable before it.

### The cheat code is not "GOATS" — it's "OATS"

`$96D2` (named `CheckCheatKey`) walks a table at `$96F7` (`1A 26 0A 16 0D` =
matrix codes for G,O,A,T,S) with an index in `$5F`. Read it, then verified by
stepping it instruction-by-instruction with `run_block` and literal key codes:
the very first comparison (at counter=0) checks the CURRENT key against
`table[0]` = G as a "same key still held" debounce, and only a match against
`table[1]` = O advances the counter. So G is never actually required — typing
GOATS works because G is harmlessly swallowed by the debounce path, but typing
OATS alone (no G) triggers the same result. Verified with five separate
`run_block` calls, one per keystroke, checking the exit branch and the
resulting `$5F`/`$5E` state each time. Method: `read` for the routine, `ran`
for the specific behavioural claim.

What the cheat actually *does*: only 3 of the 5 total reads of `$5E`
(the flag it sets) have a confirmed effect — it makes the message line show
"CHEAT MODE OPERATIVE" ($57EF) and it stops the attract-mode caption cycler
(`sub_5817`) from overwriting that banner. A fourth site (`$9751`, inside the
creature-spawn path) conditionally stashes the held key's matrix code into a
heavily-reused scratch byte (`$46`, written by 8+ unrelated routines); I could
not confirm anything reads that particular write back before it's clobbered.
basalt traced this further after I stopped and found a real consumer
(`sub_9444` → `loc_9699`, feeding the normal zone-advance path) they call
`CheatZoneSkipTrigger`, method `read` but not yet `ran` (their live-boot
attempt didn't trigger it either). **This is an open disagreement between us**
— my claim says the cheat's only confirmed effect is the banner; basalt's says
there may be a real zone-skip wired to it. Neither of us got a live run to
settle it before time ran out. Both claims stand in the project as written.

### The orphan tune at $64BA is a duplicate, not new music (corrected mid-session)

Decoded the (tick,note) byte format myself from the real per-frame player
(`loc_88F7`/`loc_91BA`), confirmed the note-frequency table is true 12-TET
tuned to 31.48 Hz at index 0 (computed from the raw SID frequency words,
method `derived`), and confirmed with three independent checks that nothing
in the 47K image points at `$64BA` (no literal pointer bytes anywhere, only
two routines ever seed a voice pointer and neither uses it, no inbound
references). Then **ran it**: booted the real machine (ROM banked in), forced
the voice-2 pointer to point at the orphan block, let the actual IRQ-driven
player play it, and captured every SID register write — the captured note
sequence matches the bytes exactly. Scenario `scn_9pffxy`
("orphan-tune-playback"), SID capture `cap_rb3sxy`.

**Then the editor corrected me.** ed decoded all four data-format streams
independently and found that `$64BA-$6591` is a byte-for-byte duplicate of
`$63DA-$64B1` — the tail of the real, reachable harmony voice
(`$6320-$64B1`). I verified this myself with two `read_bytes` calls and a
diff: 216/216 bytes identical, position for position. Renamed the claim from
`OrphanTune` to `DuplicatedTailOfHarmonyVoice`, added a correction comment,
and filed `refutes` evidence against my own earlier claim. The corrected
finding is better than my original one: it isn't a cut arrangement nobody can
hear, it's a leftover copy of music everybody has already heard, sitting
twice in the file — a cleaner piece of evidence for "this is a photograph of
a desk" than what I'd found on my own.

I also found the third voice of the title-screen arrangement (`$65A0`,
`IntroVoice3Bass`, played by `loc_91BA`, a third player chained right after
the other two each IRQ) and traced all three seeds to one routine
(`sub_9170`), itself called from the title-screen wait loop (`loc_8F7C`,
which polls the joystick-2 fire button and falls through into the real game
start once pressed) — settling which of the memo's "three intro voices" and
"two short-tune voices" is which (they're not the pair I originally thought).

### Random mode can only pick the first 32 of 42 zones

Traced at the editor's request: `$59` (`RandomZoneModeFlag`) is toggled by F1
on a 4-key options screen I found while looking (`$51EB`, F1/F3/F5/F7, only
F1 and F7's effects confirmed). When set, `loc_937B` does
`JSR RandomByteFromBASICROM; AND #$1F; STA $58` — `$58` being the zone-index
variable basalt had already identified. `AND #$1F` masks to 0-31, so the ten
highest-named zones (33-42) are structurally unreachable in random mode.
Checked that nothing re-rolls or clamps `$58` between that write and its use
in the zone-pointer computation (read every instruction in between: an
unrelated digit-display loop and three unrelated subroutine calls, no writer
of `$58` among them).

### A second, unmasked character bank exists, and one concrete user of it

The editor asked what uses the game's font without the usual `AND #$3F`
masking (having found duplicate W/X/Y/Z and bold digits at code+$40). Found
one clean, fully-verified instance: `loc_9091` draws the status-panel's
"NEUTRONIUM STATUS  HHHHHHH..." row, masking every character except a
literal ASCII 'H' (`CMP #$48`/`BEQ` skips the mask for that one byte).
Checked both glyphs directly with `read_bytes` on the character set at
`$2000`: masked H (code `$08`) is a normal H-shape; unmasked H (code `$48`)
is a solid horizontal bar. The neutronium gauge is literally the string "H"
repeated, rendered as a bar only because this one routine lets that byte
through unmasked. I did not find the specific consumer of the W/X/Y/Z or
bold-digit duplicates in the time available — the mechanism is proven, the
specific instance ed spotted is not (yet) traced to its user.

### Confirmed independently (convergent with reader one)

- `FindFreeObjectSlot` ($9735): named it independently with the same name
  reader one chose. Traced the code side of their data-side finding: the
  per-zone slot-search limit (`$42`, 8 in 41 zones / 6 in zone 6) is loaded
  straight from the zone record via `loc_9CB5`/`sub_9CFB`.
- The RNG-is-BASIC-ROM finding (already claimed by reader one) — I hit the
  same `$A000,X` read independently while tracing `sub_508B`'s title-screen
  flash effect, before checking who else had it.

## What I had to build for myself

- **`decode_orphan.cjs`, `scanvoice.cjs`, `notetable.cjs`, `verify_sid.cjs`**
  — small Node scripts in this directory to decode the (tick,note) byte
  stream format, compute SID frequency-register-to-Hz conversions, and diff
  two `read_bytes` results / reconstruct a note sequence from a captured SID
  write log. None of this needed to exist as project machinery — `read_bytes`
  and `run_scenario`'s capture already hand back exactly the right raw
  material, this was just arithmetic and diffing on top. I would not call
  any of these "tools I wished existed"; they're one-off glue.
- A `msg.py`/JSON-via-python helper for `post_message`, because message text
  containing apostrophes broke naive shell quoting inside the mcp-call.sh
  wrapper (see below).

## What tool I wished existed, or was missing

- **A way to inject a scenario mid-run without a keyboard-input step.** The
  machine model's `input` step is joystick-only (port 1/2, up/down/left/
  right/fire). There is no way to simulate a keystroke, so demonstrating the
  keyboard cheat live required directly poking the cheat *flag* rather than
  the keys that set it — which proves the display mechanism but not the
  input path end to end. Both readers hit this independently (basalt's
  attempt to trigger `CheatZoneSkipTrigger` live also stalled, possibly for
  the same reason — no reliable way to simulate "holding down a key" the
  way the CIA keyboard scan expects).
- **`add_evidence`'s `claim` lookup is target-scoped in a way that surprised
  me once.** My first `add_evidence` call (with no `target`) was refused with
  "No claim clm_...", even though `claims_at` on `runtime` showed the claim
  right there. Passing `target:"runtime"` explicitly fixed it. Worth a note
  in the tool description, since every other read/write tool I used made a
  point of reporting which target it answered for, and this one silently
  used a target where the claim wasn't visible.
- **`edit_claim`'s `is` enum is missing `"record"`.** `add_claim` accepts
  `is: "record"` (with `typeId`), but `edit_claim`'s schema only offers
  `data | text | bitmap | jumptable`. I never needed to change a claim's
  `is` after creating it as a record, so this never blocked me, but it means
  a record claim, once made, cannot have its interpretation corrected by id
  without going through `remove_claim` + `add_claim` again (losing the
  original id).
- **`add_scenario` always mints a new scenario, with no "revise in place"
  shortcut for iterating.** I called `add_scenario` a second time meaning to
  extend an existing one (add a RAM capture step) and got a second scenario
  id instead — correct per the tool's own contract ("Always adds"), and
  `edit_scenario` exists and is the right tool, but I reached for
  `add_scenario` again out of habit because that's the verb I'd just used.
  Not a gap, just a place the additive-everywhere convention cost me a wasted
  call.
- **No obvious way to ask "what game event calls this routine" short of
  brute-force running the machine and watching for a breakpoint to fire.**
  I wanted to know when `sub_9406` (`ClearMessageLine`) is naturally called
  during play, to get the editor a live cheat-banner screenshot without
  guessing. I ran 9,183 frames / 50M instructions of idle attract-mode with a
  breakpoint on it and it never fired once — a real, useful negative result,
  but expensive to obtain and something like "which scenario/frame range last
  called address X" (derived from a trace capture, perhaps) would have been
  cheaper than running the whole thing blind.
- **`post_message` and shell quoting.** Not a tool gap exactly, but worth
  recording: message text with apostrophes broke naive bash single-quoting
  through the `mcp-call.sh` wrapper more than once. Building the JSON payload
  with `python3 -c 'import json; ...'` and passing the result to the wrapper
  worked reliably; a version of the wrapper that read JSON from stdin instead
  of an argv string would have avoided this entirely.

## What was awkward, mechanically

- **`run_block` requires re-supplying every register the next block needs,
  including the ones a *previous* `run_block` call already showed you.**
  Stepping `CheckCheatKey` through five keystrokes meant reading each
  result's `registers` block and manually copying `X` (and `A`) into the next
  call's `registers` argument. Correct behaviour (each call is genuinely
  independent) but it means multi-block tracing is manual bookkeeping, one
  call at a time, no way to say "keep going from where that left off."
- **Decoding a raw byte stream (the music format) meant round-tripping
  through `read_bytes`' JSON to a local script rather than being able to ask
  the project "interpret these bytes as N records of my `MusicEvent` type and
  give me a table."** `add_type` + `is:"record"` gets the *listing* to show
  the fields, but there's no tool that hands back the decoded record array
  directly for a caller to compute over (sum durations, diff two streams,
  etc.) — I had to fetch raw bytes and do that myself every time, even after
  declaring the type.
- **Finding "what calls this address" for something reached only through a
  runtime-installed vector (the IRQ handler) took reading the *installer*
  routine by hand** (`sub_886F`'s `STA CINV`) rather than any tool surfacing
  it. `find_references` correctly says up front that it only covers absolute
  addressing, so this isn't a broken promise — but it's exactly the kind of
  "where does control actually get here" question this session kept running
  into (the IRQ vector, the `$0002` indirect jump table, the KERNAL vectors),
  and it was solved the same manual way every time: read the code that writes
  the vector, by hand.

## Where I disagreed with the other reader

See "The cheat code is not GOATS" above — the live disagreement is whether
`$5E`/cheat mode has any effect beyond the cosmetic banner. I looked at the
same evidence (the reused scratch byte `$46`) and stopped short of a claim I
could back with a live run; basalt kept pulling the thread and reached a
named, plausible mechanism (`CheatZoneSkipTrigger`) that I had not ruled out,
only failed to confirm. Both of us tried and failed to get a live-boot
confirmation in the time available (mine: could not get `sub_9406` to fire
naturally within 9,183 frames of idling; basalt's: a fire-press did not
appear to actually start a game from their scripted entry point). The
project holds both claims as written, which is the point — an editor or a
later reader can settle it with a working boot recipe, and the disagreement
itself is visible rather than one of us silently overwriting the other.

We also independently converged on the exact same name (`FindFreeObjectSlot`)
for `$9735` from two different directions (basalt from the zone-record data,
me from the code) — not a disagreement, but worth recording as the opposite
case: two people reaching the same conclusion by genuinely different routes.
