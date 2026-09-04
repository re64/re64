# reader-2 (basalt) — Revenge of the Mutant Camels

391 recorded changes: 241 labels, 89 regions, 34 comments, 14 constants, 9 constant bindings, 1 project description, 2 deletions. Roughly 200 tool calls. The project went from 40,359 unexplained bytes to 43 across the three of us.

## What I worked out

### 1. The game uses a custom character set, and I can prove the punctuation

`ReadKeyMapped` ($5695) waits for a key, searches `keyMatrixCodeTable` ($56CD) for the raw LSTX value and returns the byte at the same index of `keyResultTable` ($56AE). Lining the two 31-byte tables up against the standard C64 keyboard matrix gives 26 letters in order, A=$0A through Z=$0C, SPACE=$3C, RETURN=$01, INS/DEL=$00 — every entry accounted for, no slack. The two remaining entries are matrix $2C and $2F, the full-stop and comma keys, and they produce **$51 and $52**.

Two more follow from message text and two from the zone banners:

```
$51 .    $52 ,    $53 '    $54 !    $55 ?    $56 :
```

A contiguous run — a designed layout rather than six coincidences, which is why I trust the four read off context. Evidence: `$5199` "STAND BY YOUR BEAST, PLAYER ONE"; `$52C9` "WAVE SEQUENCY: NORMAL"; `$57A7` "WELL DONE! YOU HAVE SAVED CAMELKIND!"; zone 6 "HAVEN'T WE MET SOMEWHERE BEFORE?". Recorded as two comments at `$56AE`.

### 2. The zone table: 42 records of 200 bytes at $6700

Nothing refers to this absolutely, so `find_references` and `find_instructions` were blind to all 8400 bytes — every read goes through `($3E),Y`. Found the base by asking who writes `$3E`:

```
93D8  LDA #$67 / STA $3F
93DC  LDA #$00 / STA $3E
93E0  LDX $58 ; loop: $3E/$3F += $C8, DEX
```

Record n is at `$6700 + n*200`, banner at `+$A0` — which lands exactly on all 42 banners, which is what makes the layout provable rather than fitted. Last record ends `$87CF`, 46 bytes before code resumes. 42 is confirmed independently by the game's own credits: "THE GAME CONSISTS OF FORTY TWO DIFFERENT ATTACK WAVES." Labelled and regioned all 42 records and banners; full wave-name list in a comment at `$6700`.

### 3. Leftover assembler source in the shipped binary

`$5870-$58FF`, `$5F28-$5FFF` and `$66F8-$66FF` are 6502 source lines in BASIC line format — 2-byte link, 2-byte line number, text, `$00` — links pointing at `$5878`, `$5888`, `$5891`, line numbers 13880, 13890, 13900 in steps of ten. The fragment under the player-2 status slot carries the author's own routine names:

```
MLOOP JSR STARF / JSR BULITZ / JSR CCAMEL
NI1 ; READ DATA TABLE
; CLC / ; ADC #$C8 / ; STA NEXINI / ; LDA NEXINI+1 / ; ADC #$00
```

I flagged `ADC #$C8` as a second, independent confirmation of the zone stride. amber then matched those source lines byte-for-byte to `$93E4` and MLOOP's three calls to `$8FB0`, `$95B9`, `$9444` — so the residue is from *this* build and hands us three authentic names for the main loop. The most productive thing I posted to chat.

### 4. Music: five streams, and one nobody plays

Format is (ticks, note) pairs; note `$F0` rest, note `$FF` end.

| stream | span | seeded by |
|---|---|---|
| shortTuneVoice1 | $5900-$594B | StartTune $5768 |
| shortTuneVoice2 | $5980-$59A7 | StartTune $5768 |
| introTuneVoice1 | $6000-$622F | StartMusic $9170 |
| introTuneVoice2 | $6320-$64B1 | StartMusic $9170 |
| introTuneVoice3 | $65A0-$66F3 | StartMusic $9170 |
| **orphanTuneStream** | **$64BA-$6591** | **nothing** |

The orphan is 216 bytes of the same format that nothing can reach, checkable rather than a hunch: only two routines ever seed a voice pointer; `find_instructions` over `$13-$16` and `$2B-$2C` returns 22 sites and every one is inside those two routines or the players; voice 2 is stopped by the `$FF` at `$64B2`, seven bytes before the orphan starts. Either a cut arrangement or something no static walk sees — I said both rather than picking one. The three intro voices begin with identical bytes, i.e. a canon; the credits attribute the arrangement to James Lisney.

### 5. The cheat code is GOATS

`$96D2` reads LSTX and walks `$96F7 = $1A $26 $0A $16 $0D` — matrix 26, 38, 10, 22, 13 = **G O A T S**. It reads one table twice at a one-byte offset: `$96F7,X` is the key already accepted (still held, ignore), `$96F8,X` is the next key wanted. `$5F` counts 0→4 and at 4 the accumulator still holds 4, so `STA $5E` turns cheat mode on — the flag `ShowCheatModeBanner` and `CheckPauseKey` read at my end. The same matrix table that decoded the charset paid for this too.

### 6. $5007 copies sprites, not a character set — and I got it wrong first

I named it `CopyCharSetToRAM` on the shape of the code (2K to `$0800`). Wrong; corrected in place. Evidence for sprites:

- 2048 bytes at `$0800` is 32 sprites of 64, i.e. VIC pointer values `$20-$3F`.
- I rendered `$1000` and `$1800` through `run_decoder` as 24x21 monochrome sprites and got recognisable creatures. Not glyphs.
- The only write to VMCSB is `$8AE7 STA #$18` — screen `$0400`, char base `$2000` — and `AnimateCharacters` ($9206) writes character data to `$2110`/`$2148`, confirming `$2000`. So `$0800` is not the charset.
- Its caller `$9CB5` sets SPMC0, SPMC1, XXPAND, YXPAND in the same breath.
- Nothing reads or writes `$0800-$0FFF` absolutely — what you expect of data only the VIC looks at.

beryl reached the same conclusion independently within minutes. Still open and stated in the comment: the source table's last two entries are `$5000` and `$5800`, which is program code.

### 7. The front end, and the message-line system

`$5000-$5847` in full; 22 routines named. Highlights:

- **The options screen** runs on the function keys — LSTX `$04`/`$05`/`$06`/`$03` are F1/F3/F5/F7, `$26` is 'O' — exactly what the credits say ("PRESS 'O' AND USE THE FKEYS"). Declared and bound as constants, so the listing reads `CMP #KEY_F1`.
- **`playerState` ($56) is three-valued**, not a flag: 0 = one player, 1 = two-player p1 up, 2 = p2 up. Options only toggles 0/1; the value 2 comes solely from `SwapPlayers` ($539B).
- **High score table** is 4 x $34 at `$5E00`, rank digit + 7 score digits + name. Confirmed three ways: the stride, `InitDefaultHighScores` copying `$D0` = 4x$34, and the renumbering loop writing '1'..'4' at `$5E00`/`$5E34`/`$5E68`/`$5E9C`.
- **`$545C` was 27 bytes of data the walk never reached.** `mark_function` recovered 12 instructions: it rebuilds the table from ASCII defaults at `$5474` masked `AND #$3F` — the fallback when the .HI file will not load.
- **`$883A` is PrintCharAt** — column `$02`, row `$03`, char `$04`, colour `$05`, address via `$8825` into `$48/$49`, then `ADC #$D4` for colour RAM. Two facts fall out: screen at `$0400`, colour = screen + `$D400`. I deliberately did not name it (other people's block) and posted it to chat instead.
- **Every banner in the game goes through one routine.** `TickMessageLine` ($9CFF) runs per frame, divides by `$60`, colour-cycles the 40-char line at `$0590` through `messageColourCycle` ($9D21), then calls `ClearMessageLine` ($9406), which tail-jumps into `ShowCheatModeBanner` — so clearing the line puts "CHEAT MODE OPERATIVE" straight back if cheat is on.
- **The credits are scrolled into the terrain, not onto a text line.** `EmitAttractColumn` ($56EC) plants one character of `attractScrollText` ($5A00) and one of the high score table into each new landscape column. `attractScrollState` ($5A) is 0 = off, $01-$0F = attract scroll, $10-$1F = "HERE WE GO" counting itself down. That is why nothing draws the credits with PrintCharAt — I went looking for that call and there isn't one.

## What fought me

### `set_label` silently overwrites another person's label

The worst thing that happened, and a design fault rather than an accident. I labelled all 42 zone record starts `waveNN_<Name>`. beryl later labelled the same 42 addresses `zoneNN`. `set_labels` **renames the label already at an address** rather than adding a second one, so 41 of my 42 names were destroyed. beryl was told `ok: true, delta: 0`. I was told nothing. I found out forty minutes later because I happened to go back and tidy.

`add_comment`'s description makes a point of "This never overwrites anybody, including you", and `edit_comment` exists precisely so revising by address cannot destroy another writer's work. `set_label` has the same hazard and none of the same care: `add_label` exists for a genuine second name, but nothing makes the destructive path the deliberate one. Minimum fix: `set_label` should report when it renamed a label somebody else owns — the machinery is there, `bind_constants` already returns a `rejected` list.

### `find_instructions` cannot see a table nothing addresses absolutely

The zone table is 8400 bytes — 21% of the program — and every read goes through `($3E),Y`. `find_instructions from:$6700 to:$87FF` returns zero, the same answer it gives for bytes nobody uses. The "17 indirect accesses could not be resolved" note is honest but identical on every answer, so it carries no information about *this* query. I only found the table by pulling 12K with `read_bytes` and scanning for screen-code runs in my own script. That means the orientation path for a big data mass is "leave the tools and write a scanner". Something like `find_pointer_sources` — who writes a zero-page pair later used as `(zp),Y` into a range — would have turned twenty minutes into one call, and it is a question about programs, not about this program.

### The extent trap

I gave `keyMatrixCodeTable` extent 32 when the table is 31 bytes. The next address is `$56EC`, a jump target, and the listing rendered `JMP keyMatrixCodeTable + $001F` — a jump into the middle of a data table, stated with complete confidence. An off-by-one in an extent does not render as an error, it renders as a plausible sentence. The hygiene rules cover a label *inside an instruction* but not an extent swallowing the address after it.

### `post_message` has an undocumented 2000-character limit

My first substantial status post was rejected outright at ~2600 characters. The description says nothing about a limit and the failure is all-or-nothing. For the channel that is explicitly where you tell collaborators what you are working on, in a project where findings are paragraphs, 2000 is tight and the silence about it is worse than the limit.

### `bind_constants` rejections name the symptom, not the mistake

I passed the address of the `BNE` instead of the `CMP` for three keys. "Takes no immediate operand, so there is no value to name" is true and unhelpful — it does not say what instruction is at that address, and the obvious error (off by one instruction) is the one it could have named. The partial-batch behaviour was exactly right: six landed, three reported, nothing lost.

### `call_graph` refuses the entry point

`call_graph address:$C065` — the project's own first entry point — returns "is not in a routine this can see". Understandable given the definition, still the wrong answer to "show me the shape of this program", which is the first thing a reader asks.

### `find_unnamed` returns `targets`

Minor, but I parsed the wrong key twice. `total: 464` with an empty-looking body is confusing when the array is named something you did not guess.

### What worked

- `run_decoder` settled sprites-versus-charset in one call, and the text rendering made it readable in a terminal. The difference between a guess and a finding.
- `read_bytes` returning hex and base64 is right; every offline scan came from one call.
- Partial batches with a `rejected` list are the correct contract.
- Extents make the listing genuinely better: `zone07Name + $0012` says something `dat_6D2A` never could.
- Write-side instruction deltas are the feedback loop that made `mark_function` on `$545C` and the `code` region on `$87F0` feel worth doing.

### One thing I could not settle

`CopySpriteSet`'s source table has six entries and two of them — `$5000` and `$5800` — are program code. Either the index never takes those values (readable now that amber and beryl have the zone records' sprite-bank byte decoded across all 42), or my reading of the interleaved lo/hi table is wrong for them. I recorded the question rather than picking an answer, and said in the comment exactly what would settle it.
