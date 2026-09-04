# builder-1: building `camels-1` from a disk image

217 tool calls. Project `camels-1`, tagged `built`, version `8f3137c14a29`.

## Headline

| stage | instructions |
|---|---|
| `.prg` layered, nothing declared | **5** (the BASIC stub read as opcodes) |
| `$080D` declared a routine (`SYS 2061`) | **39** — the ceiling for static analysis of this disk |
| decrunched image layered, `$C065` declared | **2,482** |
| + raster IRQ `$88D5` and NMI `$88D4` | **3,243** |
| + `$9933` jump table, `InitHighScoreTable`, region work | **3,358** |

47,392 bytes in the runtime image. 21,179 still unexplained at the end, down from 40,257.

## What I did, in order

1. `whoami`, `list_projects`, `create_project camels-1`.
2. `prepare_upload` -> `PUT` the 175KB `.d64` over HTTP -> `list_disk_files`. Two files: `revenge fixed` (75 blocks) and `attack mutant.hi` (1 block).
3. `add_byte_layer prg revenge-of-the-mutant-camels.d64:revenge fixed`. Loads `$0801-$51A6`. **5 instructions.**
4. `read_bytes $0801` — the BASIC line is `9E "2061"`, so `SYS 2061` = `$080D`. Declared `$0801-$080D` data (`basicStub`) and `mark_function $080D`. **39 instructions**, and that is all there is: `LDY #$38 / SEI / INC $01 / TSX / LDA $50A3,X / STA $00FC,X / DEX / BNE / JMP $5068`. A decruncher relocating itself onto the stack page, then Exomizer-shaped table building at `$5068` and `JMP $013E` into the relocated copy — code at addresses no layer supplies, so nothing static can read it.
5. `run_program from $080D`. 1,768,854 instructions, stops at `$FFBA` when the PC enters ROM. Captured and layered the image.
6. Read the decruncher's tail in the crunched file: `DEC $01 / CLI / JMP $C065`. `mark_function $C065`. **2,482 instructions** — the moment of the exercise.
7. `$C065` turned out not to be the game: it is `SETLFS/SETNAM/LOAD` of `ATTACK MUTANT.HI` into `$5E00`, then `JMP $8A3C`. `$8A3C` is the game.
8. `find_instructions from:$0314 to:$0315` found `InstallIrq` at `$886F` writing `$0314/$0315 = $88D5` and `$0318/$0319 = $88D4`. Declared both. **3,243** — the raster handler alone is 760 instructions, 23% of everything decoded.
9. Chased `JMP ($0002)` at `$994C` back to a 3-entry lo/hi table at `$9933`; `set_region kind:jumptable`. **+104**.
10. Region and naming work: character set, graphics banks, zone table, HUD text, string tables, music. 57 things named by hand, 40 regions, 15 comments.
11. Everything above is in the project — description, region comments, instruction comments — not only here.

## The one that actually cost the run

**`run_program`'s `wrote` report is incomplete, and it silently sent me down a wrong path for about a third of the run.**

It reported the decrunch wrote `$51A7-$C11E` (28,536 bytes). I believed it, captured exactly that, and layered it. Everything looked right: 2,482 instructions, sensible code, named routines.

Then the decoded game turned out to contain `JSR $5000`, `$5007`, `$508B`, `$5143` — eight call sites, from code that read as entirely genuine (`DEC $1E50 / CMP #$80 / LDX #$06 / JSR $5000` is an animation delay loop, not garbage). Those addresses are *below* `$51A7`, where the project supplied only crunched data that disassembles as illegal opcodes. `find_instructions from:$5000 to:$51A6` found no store into that range from anywhere in the image, so nothing filled it at runtime either.

I settled it by capturing `$4E00-$51A7` after the same run, layering it, and diffing against the crunched bytes: **929 of 937 bytes differ**. `$5000` after the run is `DEY / BNE / DEX / BNE / RTS` — exactly the delay routine the call sites imply. Extending the probe: the whole of `$0801-$51A6` differs too. So the decruncher wrote `$0801-$C11E`, 47,392 bytes, and `wrote` named 60% of it.

What makes this expensive rather than merely wrong: **every layer of the wrong answer was self-consistent.** The partial capture produced a working project with real code in it. The only tell was an inbound reference into a region the report said was never touched, and that took chasing four `undefined bytes` warnings that looked like ordinary KERNAL noise in a list of eleven.

Cost: three extra captures, a layer stack I could not clean up, and a rebuild of every annotation.

## What else fought me

**No `remove_layer`.** Once I had the right capture I had four byte layers where I wanted one, and no way to delete the three wrong ones. `undo` walks the log backwards and would have unwound my annotations with them. I worked around it with targets — `runtime` names only the good layer — which is genuinely the right mechanism, but it means the project permanently carries dead layers and a reader has to be told to read it through a target. `remove_layer`, `rename_layer` and `reorder_layers` were all called and are all absent. The last two matter for the reason CLAUDE.md already gives: z-order is cited as the *justification* for annotations belonging to layers, and nothing can exercise it.

**Rebuilding on a new layer costs every annotation.** This is documented behaviour ("annotations follow activation") and it is correct, but the practical shape of it is that a mis-sized first capture is not a small mistake. Seven labels, one region and the entry-point marks all had to be re-issued against the new layer. With `remove_layer` plus a way to move annotations between layers, or simply a way to *extend* a layer's range, it would have been one call.

**`set_label` on a byteless address created a symbols layer that my target then hid, and said `ok`.** `set_labels` for `$0340`/`$0360` reported `"add symbols layer camels-1 symbols"` and `"set $0340 to screenRowLo"`. Both names then rendered nowhere: `list_labels` returned the auto `dat_0340`. The layer is created on demand *after* the target was defined, so the target excludes it. This is exactly the failure mode this project's own notes call out — a write that reports success and renders nowhere — and it is invisible unless you go back and read. Fix in my project: name the symbols layer in every target. Fix in the tool: either a target should follow layers created after it, or a write into a layer no active target contains should say so.

**`export_project` emits layers whose `layer.add` was undone.** The document has 5 layers (`list_targets`), the ops log marks `add prg layer sp` as `undone: true`, and the export contains **8**, reporting `changed: false`. `sp.prg` shadows `$07F8-$07FF`, so re-importing that `.re64` gives a different memory map than the live project. This is the same shape as the three cases CLAUDE.md already records (`meta.set` with no emitter, `layer.add` filtered to symbols, `layer.add` for byte layers) — the closed vocabulary is compiler-checked and *whether anything emits a member of it* is not. This is the fourth, on the removal side.

**Argument-name guessing cost four rejections in the first ten calls.** `create_project` takes no `description`; `list_disk_files` takes `name`, not `file`; `add_layer` does not take `type`/`path` — that is `add_byte_layer`, and the name does not suggest it makes the *main* layer of a project. I gave up and pulled `tools/list` to read the schemas, which is what I should have done first, but a wrapper that is deliberately dumb makes that the only route. `add_layer`'s description does say "Usually unnecessary", which is a good sign once you are reading it and no help at all when you are guessing.

**`set_region` refused `id: ""`.** `"No region  in the layer holding $1000"`. Elsewhere in this API an explicit empty string means "clear this" (`view`); here it means "look up a region whose id is the empty string". Small, but it is an inconsistency inside one tool's own schema.

**`find_bytes` has no address range.** When I wanted to know whether the 12KB span `$58F9-$87FD` contained code, there was no way to search inside a range — `find_instructions` only sees what is already decoded, and `find_bytes` searches everything. I sampled `read_bytes` at eight addresses by hand instead, which worked but is guesswork dressed as method.

## What the tools made easy

- **`run_program` with `capture` is the whole game.** Every experiment before this stopped at a decruncher; this one went from a packed disk file to 3,358 decoded instructions in about eight calls. The stop rule — PC enters ROM — needed no budget guessing and landed exactly where it should.
- **Naming a target on a vector write.** `find_instructions from:$0314 to:$0315` -> `$88D5` -> `mark_function` -> 760 instructions. That is the tool surface doing precisely what a person would do, in three calls, and the `delta` on the write is what tells you the judgement was worth something.
- **`set_region kind:jumptable`** decoded both live entries of the `JMP ($0002)` table without my working out where they went.
- **`kind:bitmap view:char:32`** settled the character-set question outright: `$2000` renders as legible glyphs, which confirmed `$D018 = $18` and refuted my own earlier guess that `$0800` was the charset. Being able to *look* is worth more than any statistic.
- **`text` + `encoding:screen`** turned 4KB of noise into 21 zone titles.
- The warnings are good. `orphaned` naming the first casualty of a region declaration caught two mistakes; `incomplete` on `find_references` and `find_instructions` stated the blind spot on every answer, which is how I knew an empty result was not an absence.

## What I found, and what I could not settle

Recorded in the project, not only here.

- **Character set at `$2000`**, proved: `LDA #$18 / STA $D018` at `$8AE7`, no write to `$DD00` anywhere, and the bitmap render shows glyphs.
- **Six 2KB graphics banks** at `$1000, $1800, $4000, $4800, $5000, $5800`, from the interleaved lo/hi table at `$502F`, copied to `$0800-$0FFF` by `CopyGraphicsBank` (`$5007`). Sprite data on the evidence — `$0800` in bank 0 is pointer values `$20-$3F`, and the game writes `$D01C`. **Not proved**: a run of `GameMain` leaves `$07F8-$07FF` all zero, because it clears the screen and then walks off at `$0000` with no VIC to drive it. What would settle it is resolving the 17 indirect accesses `find_instructions` reports over the `$D018` range, or an emulator that reaches the game loop. Two table entries (`$5000`, `$5800`) point at this file's own code and at the pause message respectively, so either they are never selected or those banks are built at runtime; I removed the `$5800` region I had declared, because the bytes contradict it.
- **21 zone records of 200 bytes at `$7800`**, 40-byte screen-code title at `+8`. Stride found by differencing the three visible messages and confirmed by every one of the 21 landing on readable text. The titles are the level names — *BUT IT'S ONLY SPACE INVADERS*, *DON'T CALL US WE'LL CALL EWE*, *REVENGE OF THE MUTANT MUTANT CAMELIDS*.
- **A chain of zero-terminated assembler-listing strings at `$5870`** — `"86 STA $07F7,X"`, `"B6 RTS"`, `"AND #$07"` — linked by 2-byte forward pointers. Almost certainly an easter egg. Not decoded further; what would settle it is finding the routine that walks the chain.
- **Probable music at `$6000`**: alternating small/large byte pairs reading as duration/pitch. Not proved, and the region comment says so.
- Screen code `$53` renders as a heart in the built-in tables and is an apostrophe in this game's own charset — `"IT<heart>S"` is `"IT'S"`. A text region decoded with a built-in encoding is only approximately right for a program that ships its own glyphs, which is the open problem CLAUDE.md already names.

## One thing I'd change about the surface

The single highest-value fix is not a new tool: it is making `run_program`'s `wrote` report complete, or saying plainly what it does and does not count. It is the *only* evidence a caller has about what a decruncher produced, the whole build flow keys off it, and being quietly short by 18KB produced a project that looked finished and was wrong. Everything else here cost me calls; that cost me a rebuild.
