# builder-2 — building `camels-2` from a disk image

Project: `camels-2`. Tag `done` at cursor 141.
Final instruction count: **3453**.

## What I did, in order

1. `tools/list` (there is no `list_tools` tool; the raw JSON-RPC method works). 65 tools.
2. `whoami` — told me plainly that `builder-2` is not a known user and my edits would be
   recorded as a claim. Useful; nothing else on the surface would have said so.
3. `create_project camels-2`, `prepare_upload revenge.d64`, `PUT` the 175KB image.
4. `list_disk_files` — two files: `revenge fixed` (75 blocks) and `attack mutant.hi` (1 block).
5. `add_byte_layer prg revenge.d64:revenge fixed` → loads `$0801-$51A6`. **5 instructions.**
   That is the BASIC stub and nothing else.
6. Read the stub: `0B 08 14 00 9E 32 30 36 31` = line 20, `SYS 2061`.
   `mark_function $080D` → **44 instructions**:

   ```
   080D  LDY #$38 / SEI / INC $01 / TSX
   0813  LDA $50A3,X / STA $00FC,X / DEX / BNE $0813
   081C  JMP $5068
   ```

   `$5068` is Exomizer 2's table init — 52 entries into `$0334`/`$0368`/`$039C`, then
   `JMP $013E` into the stub it just copied into page 1.

7. **Found the entry without running anything.** `read_bytes $50A3` (the stub source, before
   it is copied) ends `... 4C 3B 01  C6 01  58  4C 65 C0` — `JMP $013B`, then
   `DEC $01 / CLI / JMP $C065`. So the decruncher hands control to **`$C065`**.
   `run_program from:$080D` then confirmed it: 1,768,854 instructions, stopping at `$FFBA`,
   which is the first KERNAL call `$C065` makes.

8. `run_program ... capture` the decrunched block, `add_byte_layer` it, `mark_function $C065`
   → **2679 instructions** (still with the packed file's garbage decoding underneath).

9. Two targets: `loader` (the disk file as it loads, entry `$080D`) and `runtime`
   (the memory image after the decruncher ran, entry `$C065`).

10. `$C065` is **not the game.** It is a high-score loader bolted onto the end of the image
    by whoever "fixed" this release: `SETLFS/SETNAM/LOAD` of `ATTACK MUTANT.HI` to `$5E00`,
    then `JMP $8A3C`. `$C082` is the matching `SAVE` of `@:ATTACK MUTANT.HI`, `$5E00-$5ED0`.
    The game proper starts at **`$8A3C`**.

11. `find_instructions from:$0314 to:$0315` → `$886F` installs `CINV = $88D5` and
    `NMINV = $88D4`. `mark_function $88D5` is worth **+719 instructions** on its own — the
    raster handler is reached only through the vector, so no walk finds it.
    `$88D4` is a bare `RTI`: RESTORE is dead.

12. Fixed the memory model (see below), which took the count to **3242**.

13. `JMP ($0002)` at `$994C`, fed by `LDA $9933,Y` / `LDA $9934,Y` — three little-endian
    addresses at `$9933`. Declared it a `jumptable`: **+104 instructions**.

14. `mark_function $013E`/`$0100` for the decruncher itself, and `$C000`, `$C019`, `$C023`,
    `$C046` in the appendix. **3453.**

15. Declared regions and wrote the findings in: charset, sprite banks, screen RAM,
    Exomizer tables, the zero fill, three text blocks, the file names.

## What I worked out and put in the project

- **`$2000-$27FF` is the character set.** `$8AE7 STA $D018` with `#$18`, no write to `$DD00`
  anywhere, so VIC bank 0, video matrix `$0400`, char base `$2000`. Declared
  `bitmap view:char:8` and it renders `@ABCDEFG` — a plain uppercase font.
- **`$0800-$1CFF` and `$2800-$4FFF` are sprites.** Declared `bitmap view:sprite:8`; the art
  is recognisably camels. `$1D00-$1FFF` is variable space (everything the code touches with
  absolute,X stores: `$1D60`, `$1E40-$1E5F`, `$1E70`, `$1F00-$1FBF`).
- **`$59FF-$5F30` is screen-code text, not PETSCII** — the intro scroll, the empty
  high-score table, the status line. Jeff Minter's credits, James Lisney's music, "may the
  fleas of 1000 camels infest your armpits forever".
- **`$5870-$59C8` is leftover assembler source.** BASIC-style line records — link word,
  line number, PETSCII text, `$00` — holding 6502 source lines: ` STA $07F7,X`, ` RTS`,
  `SSET TYA`, ` AND #$07`, `TANGE ROL A`. The build was snapshotted with an assembler's
  source buffer still in memory and the cruncher packed it along with the game.
- **`$A001-$BFFF` is 8K of zeroes** in the decrunched image; nothing decoded touches it.
- **`$C023` and `$C046` are twins** that write different literals into the same seven
  operand bytes (`$9C22`, `$9EEA`, `$9FBB`, `$9E68`, `$9C12`, `$9EB8`, `$9FB0`) and then
  call `$9E0A` or `$9DBB`. Two self-modified variants of one routine, selected by which of
  the pair you call. Neither is reachable by absolute addressing; I found `$C046` by reading
  the bytes between the routine before it and `$C065`.

## The count, before and after

| state | instructions |
|---|---|
| packed `.prg` as it loads | 5 |
| + `SYS 2061` marked a routine | 44 |
| + decrunched block, entry still the PRG load address | 256 (nearly all garbage) |
| + `$C065` marked, packed file still visible underneath | 2679 |
| runtime target, decrunched block only | 2341 |
| **+ the rest of the decrunched memory (see below)** | **3242** |
| + jump table, decruncher, four appendix routines | **3453** |

## What the tools made easy

- `run_program` with `capture` is the whole experiment. One call decrunches 1.77M
  instructions in under a second, and one more turns the result into a layer. Nothing about
  Exomizer had to be reimplemented.
- `read_bytes` returning hex *and* base64. I piped the base64 into python for a nonzero-page
  density map and for screen-code decoding, and never had to scrape a listing.
- `find_instructions from:$D018 to:$D018` answering "where is the charset" in one call, and
  `from:$0314 to:$0315` answering "where is the IRQ handler". Both were the single most
  valuable calls in their part of the run.
- `set_region kind:bitmap view:sprite:8` — pointing it at `$3000` and seeing camels is the
  fastest confirmation of a guess I have had from any tool here.
- Every write returning an instruction delta. `+719` for `mark_function $88D5` is not a
  status code, it is the finding.
- `list_disk_files` giving the exact `path` string to hand `add_byte_layer`.

## What fought me

### 1. `run_program`'s `wrote` list only reports addresses the project does not already supply — and that is a trap, not a detail

This cost the most time by a wide margin and it produced a *confidently wrong* memory model.

The loader run reported the lowest write as `$51A7`. I believed the decrunched image was
`$51A7-$C11E` and captured exactly that. It decoded to 2341 instructions and looked fine.
But the game calls `$5000`, `$5007`, `$503B`, `$5049`, `$50D9`, `$508B` and `$5143` — ten
call sites, one of them from the per-frame IRQ path — and in that model those all pointed at
the packed file's own decruncher, which disassembles as `PHP / TAY / *SRE / *JAM`.

I spent a long time on the wrong hypothesis (the game must copy code down at runtime;
`find_instructions from:$5000 to:$51A6` proved it does not — ten sites, all calls, no
stores). The truth is that the decruncher overwrote `$0801-$51A6` in place and **not one byte
of that was reported**, because the loader layer already supplied those addresses. The
tool told me what changed *relative to the project*, and I read it as what changed
*in memory*.

Fixing it — capture `$0100-$51A7` as well, add it as a second layer — took the count from
2341 to **3242** in one step. That is 900 instructions, the charset, and every sprite,
hidden behind a summary field that was true and useless.

Two things would fix this. Report all writes, or say on the answer which ones are being
omitted and why. And: `capture` should refuse, or at least warn, when its range is not
covered by what the run actually wrote — mine silently produced a correct-looking file.

### 2. `run_program` runs over the selected target, and says nothing when that is empty

I asked for a capture while the `runtime` target was selected. `from:$080D` is in the
*loader* layer, which that target hides. The reply was
`instructions: 0, stoppedAt: $080D, reason: "left the program"` — and a `captured` block,
with a hash, a byte count, and the cheerful `next:` hint. A 20,649-byte file of nothing.

"left the program" is exactly the right words for the wrong situation. Zero instructions
executed from the address you asked for is not a run that left; it is a run that never
started, and it should say so.

### 3. A PRG layer's auto entry point cannot be suppressed, and there is no `set_layer`

`add_byte_layer prg decrunched.prg` puts an entry label at `$51A7` because that is the load
address. `$51A7` is a string of screen codes in the middle of the game's data. That entry
decoded garbage that jumped to `$0502`, `$0C37`, `$0EAF`, `$1714` and produced five
warnings on a project three calls old. CLAUDE.md documents `noAutoEntry` in the schema;
nothing on the tool surface can set it, and there is no `layer.set` operation behind it
either. I called `set_layer` once so it is in the transcript. The workaround was to declare
regions over the data, which is the right thing to do anyway but should not have been
forced.

Relatedly there is no `remove_layer`. My runtime view is two snapshot layers
(`$0100-$51A6` and `$51A7-$C11E`) that would be one file if I could have replaced the first
one after learning the truth in §1. I could add, but not take back. `list_files` does not
exist either — files show up in `describe_project`'s export, which works, but I called it
looking for a way to check what I had uploaded.

### 4. `find_undecoded` on a fresh project answers with the whole binary, which is the one time it cannot help

The first useful orientation came from `read_bytes` plus my own histogram, not from any
tool. `find_undecoded` said `$0100-$4FFF, 20224 bytes` — true, and there is no way to act
on it. What actually oriented me was a nonzero-density map per page, which took three
`read_bytes` calls and ten lines of python. That is a hex-editor staple and it would pass
the "would you put this in a human's UI" test easily: *show me where the data is*.

### 5. Small things

- `read_bytes` caps `length` at 8192, and the cap is not in the description. Fine once
  known; it cost one round trip and one crashed pipeline.
- `set_region ... comment` containing `"` is painful through a shell wrapper — my own
  problem, not the API's, but it did make me build the JSON in python for two calls.
- `find_instructions` reports `19 indirect accesses could not be resolved` on every answer.
  That is exactly the disclosure this project's notes argue for, and it was directly
  useful: it stopped me concluding that nothing writes the sprite pointers.
- `find_references` inbound said `$9F67` is referenced only from `$9F76`, which is inside
  `$9F67`'s own routine — a self-loop and no other caller. Correct, but it took a second to
  realise the tool was not broken; the block simply falls in from above.
- `whoami` volunteering that my identity matched nothing is the single best-designed reply
  on the surface. It answered a question I did not know to ask.

## What I did not settle

- `$5F30-$87FD` — 10,446 bytes — is unexplained. Sampling shows note/duration pairs around
  `$6000` (music) and screen-shaped tables around `$8DF4`. I declared nothing there rather
  than guess at a layout.
- Whether the twin routines at `$C023`/`$C046` are difficulty, play mode, or something else.
  The seven patched bytes are all operands inside decoded instructions; reading the seven
  sites would settle it and I did not do it.
- What `$50` means in `$C000`'s two `CMP #$50` against `$DC01`. The routine reads CIA1 port B
  without selecting a row on port A, so it depends on whatever the IRQ left driving.
