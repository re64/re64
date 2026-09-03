# Experiment 5 — builder-2 — Revenge of the Mutant Camels

Project: `camels-2`. Server 5171, identity `builder-2` (claimed, codename *amber*).

## Headline

| point | instructions |
|---|---|
| PRG layer added, nothing else | **5** |
| `$080D` marked a function (the SYS target) | 39 |
| decruncher disassembled at its true addresses | 136 |
| decrunched image added, `$C065` marked, image declared code | 2593 |
| after IRQ/NMI vectors and one jump table | **3456** |

Unexplained bytes at the end: **638 of 47,391**. 47 things named by hand,
21 regions, 10 comments.

The program does not begin at `$0801` and it does not begin at the SYS address
either. What is on the disk is a **crunched** program: about 330 bytes of loader
and 18.5KB of compressed stream. The program the game actually runs is 47,391
bytes at `$0800-$C11E` and its entry is **`$C065`**.

## What I did, in order

1. `create_project` -> `prepare_upload` -> PUT the `.d64` -> `list_disk_files`.
   Two files: `revenge fixed` (75 blocks) and `attack mutant.hi` (1 block, the
   high score file). `add_byte_layer` type `prg`. Load span `$0801-$51A6`.
   **5 instructions.**

2. `read_bytes $0801`: `0B 08 14 00 9E 32 30 36 31 00 00 00` — BASIC line
   `20 SYS 2061`, i.e. `$080D`. Declared `$0801-$080C` data, `mark_function
   $080D`. **39 instructions**, and the whole loader fell out:

   ```
   080D  LDY #$38 / SEI / INC $01 / TSX
   0813  LDA $50A3,X / STA $00FC,X / DEX / BNE
   081C  JMP $5068
   ```

   `INC $01` takes `$37 -> $38`, the config where `$D000-$DFFF` is RAM. The copy
   count comes from `TSX`, not a constant.

3. Sampled `$1000`, `$2800`, `$4000` with `read_bytes`: uniformly high-entropy,
   no `$00` runs, no `A9/20/4C` clustering. Compressed, not code and not
   graphics.

4. **Disassembled the decruncher where it actually runs, using a second layer.**
   The copy maps file address *S* to run address *S - $4FA7*. So I pulled
   `$50A3-$5199` out with `read_bytes`, wrote it to a file, `prepare_upload`,
   and `add_byte_layer type:raw address:$00FC`. Declaring `$0100-$01F2` code gave
   a clean 96-instruction decode of **Exomizer 2**: `get_bits` at `$0100`, the
   decrunch loop at `$013E`, the two 3-byte tables at `$01C1`/`$01C4`, and the
   exit at `$01BB`:

   ```
   01BB  DEC $01 / CLI / JMP $C065
   ```

   That is the answer to "where does it really begin". Evidence for the rest of
   the boot chain, all from the listing:

   - `$5068` copies `$516E-$51A5` to `$07E7-$081E`. That is the *head* of the
     crunched stream, which could not be stored at those addresses in the file
     because the BASIC stub sits there. So the stream is `$07E7-$5067`.
   - `$5071` builds three 52-entry tables at `$0333`/`$0367`/`$039B`.
   - `$011F` is `LDA $5068` with its own operand at `$0120/$0121` decremented
     each fetch — the stream is read **backwards** from `$5067`.
   - `$0115-$011A` is `DEC $01 / STX $DBE7 / INC $01`: bank I/O in for one store
     to colour RAM. A loading stripe.

   **136 instructions.**

5. **Ran the loader.** No re64 tool executes a program; `run_block` is one
   straight-line block by design. I called `run_program` and `run_until` once
   each so the gap is in the transcript (both `Tool not found`), then wrote a
   ~230-line 6502 interpreter in the run directory (`run6502.mjs`) with a
   two-state `$01` bank model, seeded `$01=$37`, `S=$F6`, started at `$080D` and
   stopped at `$C065`.

   1,768,814 instructions later it arrived. Instrumenting the decruncher's own
   store (`STA ($FE),Y` at `$0139`) gives the output span exactly:
   **`$0800-$C11E`, 47,391 bytes, no holes.** Uploaded it and added it as a third
   layer at `$0800`.

6. `set_region $0800-$C11F code` + `mark_function $C065`: **2593**. `$C065`
   turned out to be `SETLFS/SETNAM/LOAD "ATTACK MUTANT.HI" -> $5E00`, then
   `JMP $8A3C`; its sibling at `$C082` saves the same buffer back as
   `@:ATTACK MUTANT.HI`.

7. Pushed further with the read tools:
   - `find_instructions from:$0314 to:$0315` -> `$886F` installs IRQ `$88D5` and
     NMI `$88D4`. Marking those three functions: **+761 -> 3354**.
   - `find_instructions mnemonic:JMP | grep '('` -> exactly one indirect jump,
     `$994C JMP ($02)`, fed from a split lo/hi table at `$9933`/`$9934`.
     `set_region kind:jumptable` over `$9933-$9938`: **+104 -> 3444**.
   - `$545C` is a loop that fills `$5E00` with spaces and copies a default table
     — `mark_function` -> **3456**, and `$5474-$5543` is the built-in high score
     table in PETSCII ("I LIKE CAMELS REALLY").

8. Classified the bulk by sampling and declared it:
   - `$0800-$4FFF` graphics. Declared one span at `$3000` as
     `kind:bitmap view:sprite:2` — it draws a **camel**, which is about as good
     as evidence gets.
   - `$1D60-$1FBF` carved back out of that: parallel per-object arrays on a
     16-byte stride. `$1F40` X, `$1F50` Y, `$1F60` colour (-> `$D027,X`),
     `$1F70` shape pointer (-> `$07F8,X`), `$1FB0` the behaviour index that feeds
     the jump table. Read from `$929D`.
   - `$5848-$87FD` data: note/duration pairs from `$5900`, tables at `$6800`,
     screen-code text at `$7C00`.
   - `$9FEF-$BFFF` zero-filled working storage.
   - `$90E4-$916F` PETSCII: "OF THE MUTANT CAMELS  PLAYER ONE  0000000  NEXT
     ZONE 00 KM".

Final layout, all recorded in the project:

```
$0800-$4FFF  graphics (sprites), with $1D60-$1FBF object tables
$5000-$5847  code
$5848-$87FD  data (music, maps, text)
$87FE-$9FEE  code
$9FEF-$BFFF  zeroed working storage
$C000-$C0CA  code (high score load/save, KERNAL vector restore)
$C0CB-$C11E  the filename
```

## What the tools made easy

- **The setup path is genuinely good.** `create_project -> prepare_upload ->
  list_disk_files -> add_byte_layer` is four calls and each one told me what the
  next was. `prepare_upload` handing back an HTTP URL rather than wanting base64
  is exactly right for a 175KB image.
- **`read_bytes` returning hex *and* base64.** Reading hex to think, piping
  base64 to a file to work on. I built both extra layers out of `read_bytes`
  output without ever touching the `.d64` myself.
- **Layers did the thing CLAUDE.md claims they do.** Disassembling relocated code
  at its run address by uploading the same bytes as a `raw` layer at `$00FC` is a
  two-call trick and the result is a clean, correct listing of code that never
  executes where it is stored. That is the best moment in this run.
- **Every write returning a delta.** `mark_function $88D5` -> `delta: 761` is
  immediate feedback that a guess was right. `orphaned` caught my mistake at
  `$9FEF-$C065` (which swallowed real code at `$C000`) in the same reply that
  made it.
- **`find_instructions` with an operand range and a routine name per site.**
  `from:$0314 to:$0315` found the interrupt installer in one call. `from:$D000
  to:$D010` found the sprite update routine in one call, and that named four
  tables.
- **The bitmap region.** `view:sprite:2` in a listing, rendered as text, settled
  "is `$0800-$5000` graphics" with a picture instead of an argument.
- **`set_region` nesting and `nestedInside`.** Declaring `objectTables` inside
  `graphicsBank` did the right thing and said so.

## What fought me

**1. There is no way to run a program, and this program cannot be read without
running one.** This is the big one. re64 has a 6502 interpreter, a lifter, and
`run_block` — and `run_block` is one block, deliberately. A crunched file is not
an exotic case on this machine; it is the normal shipping format for anything
from about 1985 on. Without an external emulator this project stops at 136
instructions, and 136 of them are somebody else's decruncher. I wrote a 6502
interpreter in the run directory to get past it. The tools I reached for first
were `run_program` and `run_until`; neither exists.

I am not sure the answer is "add an emulator". A narrower shape that fits this
codebase: something that runs from an entry point to a stop address and offers
the written memory back as a **layer**, because the thing I actually wanted was
never a memory dump — it was a layer.

**2. A shadowed layer is not really shadowed, and a shadowing one destroys
annotations.** Two halves of the same problem, and it is the overlay case
CLAUDE.md already names.

- Adding the `decrunched` layer over `$0800-$C11E` shadowed the crunched
  `revenge` layer, so every region and comment I had written about the loader
  stopped rendering. They are still in the export, which is something, but they
  are gone from the listing. I got lucky: the interesting part of the loader is
  the decruncher, which lives at `$0100` and does not overlap.
- Meanwhile `find_undecoded` still reports spans **in the shadowed layer** —
  `$082B-$4FFF inLayer: revenge` sits in the list next to the identical span in
  `decrunched`, doubling the work queue with bytes nothing can see. Whatever the
  answer to overlays is, this half looks like a plain bug: a layer that supplies
  no visible byte should not be generating holes.

**3. `remove_label` picks one of two labels at an address, silently, and the
wrong one.** I had two `GameEntry` labels at `$C065` — a `function` in the
decrunched layer and an `address` left over in the auto-created symbols layer.
`list_labels` shows both, with **no id and no layer**, so there is nothing to
choose with. `remove_label $C065` deleted the typed one. Calling it again to get
the other refused with

> `$C065 is named GameEntry, but that comes from user rather than from this
> project, so there is nothing here to remove.`

which is wrong on its face — `list_labels` reports that same label as
`source: user, writable: true`. So the duplicate is now unreachable. This is the
project's own identity rule ("an address cannot identify a label") not being
applied to `remove_label` or to `list_labels`' output.

The duplicate arose innocently: I named `$C065` before its bytes existed, which
auto-created a symbols layer — correct and documented — and then the real layer
arrived under it.

**4. `extent` and the `table-1,X` idiom collide, and extent wins.** Four sprite
tables at `$1F40/$1F50/$1F60/$1F70`, indexed 1-based, so the code reads
`$1F3F,X`, `$1F4F,X`, `$1F5F,X`. With `extent: 16` — the honest length — `$1F4F`
falls *inside* `spriteXPos` and renders `spriteXPos + $000F,X` where the program
means `spriteYPos-1,X`. Same address, wrong statement. CLAUDE.md says "an extent
beats an invented name, not a chosen one", but `$1F4F` is not an exact match for
a chosen label, it is the +-1 neighbour of one, and that case is not covered. I
worked around it with `extent: 15`, which is a lie about the array and produces a
correct listing. Adjacent 1-based tables are a common C64 layout, so this recurs.

**5. `create_project` takes only a name, and the id is the name.** I was told to
call the project `camels-2`; `{"id": "camels-2", "name": "..."}` was rejected for
the unrecognised key, so the project is *named* `camels-2` and has no display
name. Minor, but the description says "Start a project" without saying the name
is the identifier.

**6. Declaring a whole layer `code` starts a linear decode at its first byte.**
`$0800-$C11F kind:code` was the only way to let flow from `$C065` reach anything,
and it also began decoding at `$0800`, which is zeros — 14 junk instructions and
an "overlaps instruction at `$0813`" warning until I declared `$0800-$5000` data.
Nothing was harmed, but "permit decoding here" and "start decoding here" are two
different requests with one verb. On a raw layer, where the default is `data`,
`mark_function` alone does nothing — I had to guess that a `code` region was also
required, and the `delta: 0` from `mark_function $C065` was the only hint.

**7. Two small ones.**
- `list_labels` has no layer column, which is what made #3 unresolvable.
- The `.re64` export names `decrunched.bin` and `decruncher.bin` by path only;
  the bytes live in the server's blob store. The export is a complete description
  and not a complete artefact, which is fine as long as somebody says so.

## Things I could not settle

- Whether anything in `$0800-$4FFF` is executed. Nothing decoded transfers
  control there and it renders as sprites, but reachability here is static and
  the game reaches code through `JMP ($02)` at least once. What would settle it:
  running the game rather than the loader.
- The 19 indirect accesses `find_instructions` reports as unresolved. Some of
  them are probably the writes to `$D000-$D02E` that the range search cannot see.
- `$5900-$87FD` is classified by eye (note pairs, map tables, text) and not by
  finding the routines that read it.

## Files written (run directory only)

- `fetch-bytes.mjs` — pulls a span out of the project through `read_bytes`.
- `run6502.mjs` — the 6502 interpreter used to run the loader.
- `revenge.bin` — the PRG body as read out of the project.
- `decruncher.bin`, `decrunched.bin` — the two extra layers.
- `all.bin` — the interpreter's full written-RAM dump.
