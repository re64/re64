# Reader one (codename: basalt) — findings, draft in progress

Not final. Being written while the session is still live and the editor has not
yet released me, per the brief. Will be revised/finished at release.

## What I found, and how I know

All of this is also in the project as claims (method tagged) with the exact
address and the call that settles it — this file is the narrative version, the
project is the record.

### The high-score file is named after the prequel

`$C065` (`LoadHighScoreFile`) and `$C082` (`SaveHighScoreFile`) do an ordinary
KERNAL LOAD/SAVE against device 8, filename `"ATTACK MUTANT.HI"` stored at
`$C100`. Read directly with `read_bytes`. The save is reached only from the
game-over path (`$9FE6`, via `find_references`). Method: read.

### Self-modifying code, shipped already toggled

`$C023` (`PokeZoneTransitionCode`) pokes 7 opcode bytes at 7 addresses in
`$9C00-$9FFF` (LDA→DEC/STA/INC), called every zone transition. `$C046`
(`RestoreZoneTransitionCode_unreachable`) is the mirror image, poking the
originals back — and is provably unreachable: no inbound reference
(`find_references`), and its own address (`46 C0`) occurs nowhere in the 47K
image (`find_bytes`). I read all 7 poked bytes directly: every one in the
shipped file already holds the *poked* form, not the original. So the toggle
only ever runs forward, and the file was saved mid-session, after this had
already fired once — a second, independent line of evidence for the "photograph
of a running machine" thesis (alongside the editor's high-score-table
`$5474`/`$5E00` AND-mask pair). Method: read.

### The dead "skip to the last zone" cheat at $C000

`$C000` (`CheckZone41Cheat`) reads `CIA1PRB` raw and does `CMP #$50` twice in a
row with nothing between that could change A — the second comparison can never
fire; it's testing the same condition the first one just failed. Had it fired
(`$C00E`, `SetZone41_dead`), it would set the zone-index variable `$58` to 41
(0-indexed, the last of 42 zones — `REVENGE OF THE MUTANT MUTANT CAMELIDS`,
confirmed by reading its name directly). Whoever wrote the second key check
never filled in a different value. Method: read.

### The zone table: structure, and one full record traced end to end

`$6700`, 42 records of exactly 200 bytes (`zoneTable` claim, `add_type
ZoneRecord`). Confirmed from the pointer-stepping loop at `$93E4`
(`LDA/CLC/ADC #$C8/STA`, 200 = `$C8`) rather than assumed. The 152-byte
creature-type block is **column-major**: 19 fields, each 8 bytes (one per
creature type 0-7), not 8 structs back to back — found by tracing
`SpawnCreature` (`$9772`) and a new routine, `AgeCreature` (`$9A39`, the
per-frame lifetime countdown that reads `nextType` and tail-jumps back into
`SpawnCreature` — the exact mechanism behind "an explosion is a creature").

Confirmed fields, checked across 5+ zones: sprite frame range (record+`$10`/
`+$18`), `nextType` (record+`$38`, `$FF` = gone for good), `lifetime`
(record+`$80`). The shared 3-frame `$EC-$EE` explosion (12 ticks) is in 40 of
42 zones; `WACKY WHACKERS` and `HAVE A GO AT THESE` use their own explosion
data instead (WACKY's is a single-frame `$A8` at 16 ticks).

**Zone 10 (0-indexed 9), "TELECOM'S COMEUPPANCE"**, eight creature types, for
the editor's diagram — full detail posted to chat, and in the project as
`TelecomsComeuppanceZone`. Four-step chain, four distinct sprites: static dot
(`$E5`, 32 ticks) → 2-frame flap (`$E6-$E7`, 32 ticks) → static (`$E8`, 1 tick)
→ same static picture, but lifetime 0 so it never times out — sits until shot.
Three of the eight type slots (4, 6, 7) are never targeted by any `nextType` in
this zone; present in the data, outside the visible chain.

### Zone scalars: one true constant, one traced to the dead multiplexer, one to per-zone sprite colours

Read all 42 records' 8 scalar bytes in one call. Record+`$9F` is `$00` in
every zone, no exceptions. Record+`$9B` is `$08` in 41 zones, `$06` in one
(zone 6) — traced to code: `LoadZoneScalars` (`$9CB5`) loads it into ZP `$42`,
which is exactly `FindFreeObjectSlot`'s (`$9735`) search bound. Confirms the
memo's dead-sprite-multiplexer finding with the data source identified.
Record+`$9D`/`$9E` load straight into `SPMC0`/`SPMC1` — each zone bakes in its
own two-colour sprite palette. Record+`$9C` ramps 0/2/4/6 across the 42 zones
in four plateaus (0-25, 26-29, 30-35, 36-41) and loads into ZP `$02` — flagged
as unconfirmed, since `$02` is reused as scratch elsewhere in the program and I
could not confirm the value survives to matter.

### The sprite multiplexer, and what I could and couldn't confirm about it

`MultiplexSpritesThisFrame` (`$925F`): the parity flag `$30` toggles each
frame, and one of two near-identical routines (`sub_929D`/`sub_92CF`) draws
each of the 8 hardware sprites from one of two adjacent field-array halves —
not "add $20/$40 to a sprite pointer" as first guessed, but two groups of live
slots sharing the same 8 hardware sprites, time-multiplexed one half per
frame. **Ran a real watchpoint test** (`run_scenario`, real gameplay, 900
frames) on writes to the second half of those arrays: it fired once, on the
single boundary byte at the seam between the two halves (an indexing
fencepost, not a real second population), and nothing else in that range was
ever written in the session. So: still leaning "the second copy of the sprite
sheet at `$1001` (byte-identical to `$0801`, verified) is unused," with a
genuine caveat about the boundary. The editor said not to spend more time here
once I'd reported this; noted.

### A real zone-skip hidden in cheat mode — traced but not yet run live

Beryl found the GOATS→OATS cheat and that `$5E` (cheat flag) stashes something
into `$46` at `$9751` under an unclear condition. I traced the read side:
`$9468`, inside `sub_9444` (`CCAMEL`, the player routine, called every frame),
checks `$46` and jumps to `loc_9D59` — the real zone-**advance** routine
(increments the zone index, `$58`) — when it's non-zero. `$46` is reset to 0 as
part of the new zone's own setup (`loc_9699`), so this is self-clearing: one
skip per trigger. So cheat mode + holding any key at the moment a creature
spawns (continuous during play) skips to the next zone. I tried to get this
live with `run_scenario` (force `$5E`, repeatedly poke the last-key register)
and could not — the emulated session never actually reached active gameplay
that I could confirm (PC kept returning to the same address across separate
run steps, looking like a wait-loop). Recorded as method **read**, not **ran**,
and said so explicitly in chat.

### Sprites, not a bitmap, in the BASIC program area

The single largest undecoded span, 18KB from `$0801`. First guessed (wrongly,
in chat) it was a loading-screen hires bitmap from a naive by-hand render;
`is:"bitmap" view:"char:8"` gave a garbled shape, `view:"sprite"` rendered
cleanly — ordinary 24×21 hardware sprites, at least 32 of them, sitting in
what's normally the BASIC program area (the game never returns to BASIC after
its `SYS` stub). The editor later found this range is a **duplicate**:
`$0801-$1000` byte-identical to `$1001-$1800` (confirmed myself independently
with two `read_bytes` calls) — see the multiplexer section above for what I
could establish about whether the second copy is used.

## What I had to build for myself

- **Zone-record decoding** was entirely ad hoc Python over `read_bytes` output
  (screen-code text decode assuming `A`=1..`Z`=26, space=`$20`; column-major
  field extraction once I'd found the stride from the code). Nothing in the
  tool surface renders a `record`-typed claim's contents back to me structured
  — `add_type`/`add_claim is:record` stores the layout for others to read
  later, but I never got a "show me this record decoded" answer back from a
  tool; I always went back to raw bytes and did it by hand.
- **A quick zone-name scanner**: read `record+$A0`, length 40, for each of 42
  zones in a loop, decode. Would have been one call with something like
  `list_claims`/a records view if the type had already existed at project
  start.
- **A byte-identity diff**: fetched two ranges with `read_bytes` and compared
  in Python (`b1 == b2`) to confirm the editor's duplicate-sprite-sheet claim
  and my own author-source-fragment match. Wanted `find_bytes` to take two
  *ranges* to compare, not just a fixed pattern.
- **Chunking `read_bytes`**: the 8400-byte zone table needed two calls (cap is
  8192). Fine once known, but cost a failed call to discover.

## Tools I wished existed

- **A "show me this record" reader.** Once a `ZoneRecord` type is declared and
  a `record` claim covers `$6700`, I still had to hand-decode every field
  myself from raw hex, every time, for every zone I looked at. A tool that
  takes a claim id (or an address + type) and an index and returns
  `{fieldName: value, ...}` for one record — the read-side complement of
  `add_type` — would have saved the bulk of the Python glue in this session.
- **Range-compare in `find_bytes`** ("does *this* span equal *that* span"),
  rather than only a fixed byte pattern. I did the editor's duplicate-sprite
  check and my own duplicate-source-code check both by fetching two ranges and
  diffing in a shell script.
- **A way to ask "who transitively reaches this address via an indirect
  write"** — not to resolve it (that's rightly refused, per the model's own
  stance on indirect writes), but to at least *enumerate the sites* whose
  indirect writes are unresolved and near a given address, so I don't have to
  remember "17 unresolved indirect accesses" applies uniformly and re-derive
  which ones might matter for a specific question (e.g. whether the
  multiplexer's second bank is ever populated indirectly).
- **`claims_at` returning a rendered preview** for a `bitmap`/`record` claim —
  I had to add a real claim, then call `read_disassembly` over its range, to
  see what it rendered as; a lighter-weight preview (given `is`/`view`/extent
  without committing a claim) would have let me try `char:8` vs `sprite`
  without touching the document, then clean up the wrong guess afterward
  (which I did have to do: `remove_claim` + `remove_comment` x2, because
  `edit_claim` cannot revise the descriptive text and comments are separate
  objects).

## Mechanically awkward, not socially

- **`edit_claim` has no `comment`/`method` field.** `add_claim`'s `comment`
  argument creates an actual `Comment` object as a side effect, but there is no
  way to revise or replace it afterward except adding a new comment and
  removing the old ones by id (`list_comments`, then `remove_comment` per id).
  I hit this once, on a probe claim that turned out to be based on a wrong
  guess about which `view` to use — cheap to fix, but three extra calls
  (`list_comments`, two `remove_comment`, one `add_comment`) for something that
  reads like it should be one `edit_claim` call.
- **`read_bytes` caps at 8192 bytes**, undocumented until it refuses — the
  42x200-byte zone table needed two calls instead of one. Not a real problem,
  just a thing I had to discover by being told no.
- **Argument-name drift from the brief's own examples.** The brief's example
  calls use `from`/`address` for `read_disassembly`/`claims_at`; the live
  schema wants `start`/`at`. Every one of my first calls to a new tool this
  session got refused once on a parameter name before I read the actual
  schema. Not a complaint about the tools — the wrapper is deliberately dumb
  and this is exactly the signal it exists to produce — but worth recording
  that the brief's own inline examples are stale against the live server.
- **Static analysis genuinely cannot answer some of these questions.** Whether
  the sprite multiplexer's second bank is ever populated, and whether the
  cheat-mode zone-skip actually fires, both need a real run to settle, and
  building a working "get past the title screen into real gameplay" recipe by
  poking joystick input and the last-key register took real trial and error —
  I got the watchpoint test working (multiplexer) but not the zone-skip one
  (game state didn't visibly advance past what looked like a wait-loop).
  Whoever has a working boot-to-gameplay `run_scenario` recipe should share it
  in chat; it would have saved me the failed attempt.

## Where I and reader two disagreed

No real disagreement — we converged independently on the same name
(`FindFreeObjectSlot`, `$9735`) at almost the same time from two different
angles (I traced it from the data side, record+`$9B`; beryl from the code
side). The project handled it exactly as the model describes: both claims
survive (`clm_3ar7fu`, `clm_4b91wr`), and `describe_project`'s `hygiene` list
now reports it as `label.duplicated` — "one account written down twice rather
than two that agree," correctly distinguishing it from a real disagreement
(there is a separate, genuine entry in `disagreements()` for that: the
editor's own correction of beryl's first read of the orphan music, which is
music not mine to narrate). The case the identity model is actually built
for — two people naming the *same* address *differently* — never came up in
this run; we split the program cleanly enough (zones/scalars/scaffolding to
me, cheat/music/font to beryl) that we rarely touched the same address at
all.

One thing worth recording as a near-miss rather than a disagreement: I
initially told the chat the `$0801` block was probably a loading-screen
*bitmap*, based on a hand-rolled render, then corrected myself two messages
later once I tried the real `view:"sprite"` renderer and saw it was sprite
data. Nobody was misled for long, but it's a reminder that a hand-rolled
render from `read_bytes` is a worse tool than the one already built in, and I
should have reached for `add_claim is:bitmap` first rather than last.

---

*(To be finished: final summary once the editor releases me — this is the
working draft.)*
