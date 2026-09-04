# reader-1 (amber) — Revenge of the Mutant Camels

~135 tool calls. 336 recorded changes: 220 label writes, 114 comments, plus regions.
Tag `amber-main-pass` marks where the main pass finished.

Territory, agreed in chat: `$C000-$C11F`, the `$8800-$9FEE` code block, and whatever
data those reach — which turned out to be the tune data, the zone table, and the
leftover assembler source at `$5870`.

---

## What I worked out

### The main loop is named in the binary itself

The most useful thing I found was **leftover assembler source in the shipped image**,
at `$5870`, `$5F28` and `$5FA8`. It is stored the way a Commodore in-BASIC assembler
stores it — `[link lo][link hi][line# lo][line# hi] text $00` — and following the links
gives ascending line numbers in steps of ten. That structure is what makes it certain
rather than a lucky run of printable bytes; I scanned the whole 47K image for the
pattern and these three blocks are all of it in the runtime target.

```
15240  MLOOP JSR STARF
15250        JSR BULITZ
15260        JSR CCAMEL
```

Those are the author's own names, and all of them map onto real routines:

| source | address | what it is |
|---|---|---|
| `STARF`  | `$8FB0` | the starfield |
| `BULITZ` | `$95B9` | the bullet |
| `CCAMEL` | `$9444` | the player |
| `SSET` / `TANGE` | `$92F6` / `$92FF` | the sprite allocator |
| `NEXINI` | `$3E/$3F` | the zone data pointer |

Two of those are **exact**, not thematic:

- Lines 15150-15190 are `CLC / ADC #$C8 / STA NEXINI / LDA NEXINI+1 / ADC #$00`, which
  is byte-for-byte the loop at `$93E4` stepping `$3E/$3F`. So `NEXINI` is `$3E`.
- Lines 13880-13990 are `STA $07F7,X / RTS / SSET TYA / PHA / AND #$07 / SEC / TAY /
  INY / LDA #$00 / TANGE ROL A / DEY / BNE TANGE` — and `$92F2` onwards is that,
  instruction for instruction, *including the tail of the routine before it*. So
  `$92F6` **is** SSET and `$92FF` **is** TANGE, and `$92CF` is the routine those first
  two lines end.

Because the match is exact, the residue is from *this* build. That is the only place
in the project where I took a name from the source, and I said so in chat and in the
comment, warning the others not to rename on its authority elsewhere: eight lines out
of thousands is evidence about intent, not an index.

The residue also proves the shipped file is a memory dump of a development machine
rather than a clean link. A second, independent proof: the 208 bytes at `$5E00` are
`defaultHighScoreTable` with every byte ANDed with `$3F` — 119 identical (spaces and
digits), 89 differing by exactly that mask, none differing any other way. That is what
`InitDefaultHighScores` does, so the routine had already *run* when the image was saved.

### The zone table — 42 records of 200 bytes at `$6700-$87CF`

Found from the arithmetic at `$93D8` (`$3F = $67`, then `+$C8` per zone) and bounded by
`$9DA0` (`CMP #$2A`, so zones 0-41). 42 × 200 = 8400 = `$20D0`; `$6700 + $20D0 = $87D0`,
and code starts 46 bytes later. The table ends exactly where the data does.

Fully mapped, and written into the project:

- `+$00..$97` — nineteen 8-byte tables, one row per attribute, one column per creature
  type. The offset here *is* the offset from `$1DA0`, so every `tmpl*` array beryl named
  is a slice of one 152-byte copy: spawn interval, move type, animation first and last,
  animation mode, type-when-shot, type-when-exploded, next type, speed X, speed Y, step,
  spawn limit, spawn X, spawn Y, spawn mode, colour, lifetime, score value, explosion
  length.
- `+$98..$9F` — eight scalars read one at a time by `$9CB5`: multicolour mask, Y-expand
  mask, X-expand mask, object slot limit, sprite bank index, `$D025`, `$D026`, and one
  read and thrown away.
- `+$A0..$C7` — **the 40-character zone name**, in screen codes.

All 42 names are now comments on their records: *ASSORTED EASY AVIAN ALIENS*,
*RAINDROPS KEEP FALLING ON MY BEAST*, *MANIC MINTER*, *INKY, PINKY, BLINKY AND THUD.*,
*CAREFUL WITH THAT AXE, EUGENE*, *REVENGE OF THE MUTANT MUTANT CAMELIDS*. They come with
the custom-charset punctuation for free, because the names have to read as English:
`$51=!  $52=,  $53='  $54=.  $55=?  $56=:`.

Structural consequence worth more than the names: type-when-shot, type-when-exploded
and next-type all name *another type in the same zone*, so a wave is a directed graph of
creatures turning into each other. In zone 0, type 7 is worth 500 points and becomes
type 0, which is worth nothing.

I also settled a question both other readers had flagged: the sprite-bank index at
`+$9C` takes exactly four values across all 42 zones — `$00` for zones 0-25, `$02` for
26-29, `$04` for 30-35, `$06` for 36-41. So the last two entries of the six-entry table
at `$502F` are dead, and the lo/hi split basalt doubted was right all along.

### The game, mechanically

- **42 zones, 6 difficulty loops, 5 beasts, 18 neutronium, distance 7** — each of those
  numbers is at a single site and I recorded which.
- **Both resources live in screen memory and nowhere else.** The score is seven ASCII
  digits at `$040E-$0414` with carry propagated by hand at `$9BCD`; the neutronium bar
  is eighteen cells at `$043D-$044E`. There is no binary copy of either.
  `tmplScoreValue` packs the digit column in the low nibble and the count in the high
  nibble, so `$15` is 100 points and `$56` is 50. The end-of-zone bonus is 30 points per
  step of fuel left (`$9E22` passes X=6, Y=3 to `$9EFD`).
- **Explosions cost fuel** — `tmplExplodeLength` is a count of `DrainNeutronium` calls.
- **The camel state machine**, complete: 0 ground, 1 airborne (a signed counter `$0F`
  down to `$F0` added to Y, sixteen frames up and sixteen down), 5 landing squash (four
  shapes at `$9565`), 2/3/4 duck-hold-rise. You cannot steer mid-air, and you cannot
  fire while crouched.
- **One bullet, eight-way only.** `CMP #$0F` rejects fire with the stick centred, so
  this game has no straight-ahead shot.
- **The music player** at `$88F7`/`$91BA`: three voices, `(ticks, note)` pairs, `$F0`
  rest, `$FF` end, 65-note frequency tables at `$898C`/`$89CD`. Pointers are seeded two
  bytes low because the player adds 2 before reading, which is why `StartMusic` loads
  `$5FFE`, `$631E`, `$659E` for tunes at `$6000`, `$6320`, `$65A0`. Measured: 636 / 636 /
  604 ticks — voices 1 and 2 come to exactly the same total, which is what a real
  three-part arrangement looks like — about 90 seconds at 7 frames a tick. The note
  table is true equal temperament (octave ratio exactly 2.0000) but tuned to 31.5 Hz at
  index 0, between B0 and C1, so it is not at concert pitch.
- **The whole screen layout**, assembled from five places that each knew one row: panel
  rows 0-1, sky and stars 2-11, message line 9-10, six scrolling terrain rows 14-19 with
  their colour rows, ground 20-24. Fine scroll is `$1F` counting 7 down to 0 and the
  coarse column shift happens when it wraps.

### Four things that are built and never run

The finding I would keep if I could keep one, because each is independently checkable
and together they say what kind of binary this is.

1. **`SetIndexedReadMode` at `$C046` is unreachable.** No inbound reference, and the two
   bytes `$46 $C0` occur *nowhere* in the 47K image, so no pointer table and no pushed
   address can reach it either. The loaded image already holds the WRITE opcodes at all
   seven patched sites, so `sub_C023` merely re-asserts the state the program ships in.
2. **The start-at-zone-41 branch at `$C00E` is unreachable**, because `$C000` does
   `CMP #$50 / BEQ / CMP #$50 / BEQ` with A unchanged between them. Two different key
   codes once; an edit broke it and disabled the cheat.
3. **The sprite multiplexer at `$925F` never fires.** The mechanism is real — two shadow
   banks, parity in `$30` — but nothing ever allocates above slot 7:
   `FindFreeObjectSlot` searches 2 to `$42-1`, and I read `$42` out of all 42 zone
   records (8 in 41 of them, 6 in zone 6). Bank 1 is written by nothing and read by
   nothing, so there is no flicker. *I got this wrong first* and said objects 8-15
   flicker at 25 Hz; I edited my own comment rather than leaving it standing, and said
   so in chat.
4. **The bullet's hardware-collision gate is stubbed out.** `$9AB3` is `LDA #$FF / AND
   #$02` and `$9ABC` is `LDA #$FF / AND printChar`, both of which always pass. Put
   `A5 44` where `A9 FF` is and they become exactly the camel test at `$9B1B` — two
   bytes, twice. The reason is visible elsewhere: a multiplexed sprite registers no
   hardware collision on the frame it is not drawn, so the bullet was moved to a pure
   coordinate test and the dead gate left in.

Plus two orphaned fragments: `$8834` (`JSR ScreenAddrFromRow / LDA ($48),Y`, a
read-character-at routine whose entry was deleted) and `$88FE` (`LDA #$60 / STA $D012`,
superseded when the raster reload moved to `$8BC9`).

### Smaller things worth having

- `$C065`/`$C082` load and save `ATTACK MUTANT.HI` — **ATTACK**, not REVENGE. Either
  this build reuses the earlier game's score file or the disk is mislabelled. Recorded
  as unresolved rather than guessed.
- `$87FE` builds the screen row tables at `$0340`/`$0360` with **27** entries, two past
  the end of the screen; `PrintCharAt` guards the column and not the row, so a bad row
  would corrupt the sprite pointers rather than fail visibly.
- A real bug: the colour loop at `$90A5` is `LDX #$28 / LDA $9148,X / STA $D827,X`, so it
  reads `$9149..$9170` — and `$9170` is `StartMusic`. The colour of the last cell of panel
  row 1 comes from an opcode byte.
- The star seed tables, the landing-squash shapes and the note tables are all indexed
  **1-based off a base one byte below the data**, which makes the listing resolve `$8A0D`
  as `noteFreqHi + $0040`. That is correct, not a mis-resolution, and it took a minute to
  convince myself of.

---

## What fought me

### 1. `set_label` silently destroys other people's names — this is the big one

`set_label`/`set_labels` **renames** whatever label is at an address. On a shared
document with three writers that is a destructive write with no warning, no rejection,
and a success message indistinguishable from a creation:

```
"did": ["set $6700 to zone00 (address)"],  "delta": 0,  "ok": true
```

I did it twice without noticing. First I overwrote basalt's `player1StatusSave`,
`player2StatusSave`, `highScoreTable` and `txtStatusLineTemplate` in my opening batch.
Then I labelled all 42 zone records `zoneNN` and destroyed basalt's 42
`waveNN_<Name>` labels — 42 destructive writes reported as 42 successes. Neither of us
learned it from the tool. basalt found it by going back to tidy up, then misattributed
it to beryl, who apologised in chat for something I had done; I had to correct the
record.

`add_comment`'s description goes out of its way to say it "never overwrites anybody,
including you". `set_label` is the same shape of call with the opposite behaviour and
says nothing. That asymmetry is the single most expensive thing in this run.

The cheap fix is in the reply, not the semantics: `did[]` already carries the address
and the new name, and the server knows the old name and who set it. `"renamed $6700 to
zone00 (was waveNN_AssortedEasyAvianAliens, set by basalt)"` would have made all three
collisions visible the instant they happened. `expectVersion` does not help — the
version moves constantly on a live document and I had no reason to think mine was
stale. An `add: true` flag on `set_labels`, or a batch form of `add_label`, would cover
the "I am filling in a fresh range" case, which is what all three of my collisions were.

### 2. `remove_region` requires `start` even when you pass `id`

The description says an ambiguous start "refuses and names them so you can say which by
id". So I called `remove_region {id: "rgn_lw5muw"}` and got

```
Invalid input: expected string, received undefined at start
```

`start` is required by the schema, so you must pass both — the disambiguating id *plus*
the ambiguous thing it disambiguates. The refusal message also renders the address
twice: `text "txtStatusLineTemplate" to $$9120`.

### 3. No way to look at the other target without changing it for everybody

`select_target` is deliberately shared, and I agree with that as a design choice. But it
means "have a quick look at the packed loader" is an action that re-analyses the program
under two colleagues who are mid-read. I did not do it, so the loader target went
unexamined by anyone for the whole run — including for more leftover source, which is
exactly where I would have looked next. A read-only per-call override would have cost
nothing; I tried for one (`read_bytes {..., "target": "loader"}` → `Unrecognized key`).

### 4. Extents are the overlay problem in miniature

beryl gave `$1800 spriteSet1` a 2K extent, true of the image as loaded. But `$1D00`
upward is object RAM at runtime, so the score table at `$1E28` rendered as
`spriteSet1 + $0628` and the sprite shadow at `$1F3F` as `spriteSet1 + $073F`. Both
readings are correct at different times and the listing can only show one. basalt hit
the same thing from the other side: a 32-byte extent on a 31-byte table made a `JMP`
render as `JMP keyMatrixCodeTable + $001F` — a jump into a data table, which is exactly
the confident-wrong-answer this project refuses everywhere else. An extent is currently
an assertion with no way to say *when* it holds.

### 5. Tools I reached for that do not exist

Called once each so they land in the log:

- `find_text` — search the image for a string in PETSCII or screen codes. I found the
  zone names, the status line, the high score names and the leftover assembler source by
  pulling all 47K out with twelve `read_bytes` calls and grepping locally. That worked
  and is what I would do again, but it is a hex-editor staple and the first thing anyone
  does on a fresh binary.
- `label_history` — who named this address, and what was it called before. Wanted
  specifically *because* of problem 1. `changes_since` has the information, but only as
  a flat log you must scan.
- `hygiene` — a duplicate-name check. I wrote one in five lines of node against
  `list_labels` output; it found one duplicate-at-address and no name ambiguity, so the
  project is clean. But `list_labels` caps `limit` at 500 and there are more than that,
  so I had to page it by address range to get a complete picture.

### 6. Small friction

- `post_message` caps at 2000 characters and says so only on rejection. Three of my
  messages had to be split, and the split ones read worse.
- `find_unnamed`'s `kind` takes `calls|jumps|data|any`; I guessed `function` from the
  label vocabulary and was rejected. Minor, but the two vocabularies sit next to each
  other.
- `read_bytes` accepts `length: 4096` happily and nothing says so. Twelve calls got me
  the whole image, which changed how I worked — I told the others in chat, and it is
  worth putting in the tool description.
- Shell quoting: `post_message` text containing `KERNAL's` breaks a single-quoted shell
  argument. Entirely my problem and not re64's, but it is why every comment I wrote
  avoids apostrophes.

### 7. What worked, and is worth saying

- `add_comment` never overwriting anybody is right, and `edit_comment` by id let me
  correct my own two mistakes — the star "colour" array, and the multiplexer — without
  touching anyone else's text. Both corrections are in the project rather than only in
  this report, which is the point.
- Chat carried real technical content rather than coordination noise. beryl answered my
  extent complaint by shrinking the extent; basalt's `$9CB5` comment told me what the
  zone header fields were before I had read the code; my zone-record layout answered a
  question basalt had written into a comment as unresolved. Three of the largest
  findings in the project are joins between two readers' halves.
- `find_bytes` settled `$C046` being genuinely unreachable. "These two bytes occur
  nowhere in the image" is a much stronger statement than "no inbound references", and
  no other tool makes it.
- `run_block` confirmed the neutronium cell arithmetic and, more usefully, printed
  `neutroniumBar+5` for the address it touched, verifying my extent and the 1-based
  indexing in one line.
