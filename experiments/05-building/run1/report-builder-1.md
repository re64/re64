# Experiment 5, builder-1 — building `camels-1` from a disk image

## Headline

| stage | instructions |
|---|---|
| `revenge fixed` added as a PRG layer, nothing else | **5** |
| + the BASIC `SYS 2061` target at `$080D` | 44 |
| + the decruncher, at the address it actually runs at (`$0100`) | **141** — the ceiling for the file as it exists on disk |
| decrunched 47,391-byte image added, entered only at its load address `$0800` | **14** |
| + the real entry point `$C065` | **2495** |
| + interrupt vectors, two unreached routines, region work | **3452** |

Unexplained bytes went from 60,519 to **412** (of 47,391).

The "before and after" the brief asks for is the middle pair: **14 → 2495**. The
program loads at `$0800` and begins at `$C065`, an address the file never
occupies.

## What I did, in order

1. `create_project` (it takes `name` only — I had passed `id`, which was
   refused), `prepare_upload`, `PUT` the 174,848-byte `.d64`, `list_disk_files`.
   Two files: `revenge fixed` (75 blocks) and `attack mutant.hi` (1 block).
2. `add_byte_layer type:prg` on `revenge.d64:revenge fixed` -> `$0801-$51A6`,
   **5 instructions**. `read_bytes $0801` shows `0B 08 14 00 9E 32 30 36 31 00`
   — BASIC line `10 SYS 2061`. So the ML entry is `$080D`.
3. `mark_function $080D` -> 44 instructions, and the decode reads:

   ```
   080D  A0 38      LDY #$38
   080F  78         SEI
   0810  E6 01      INC R6510
   0812  BA         TSX
   0813  BD A3 50   LDA $50A3,X
   0816  9D FC 00   STA $00FC,X
   0819  CA         DEX
   081A  D0 F7      BNE $0813
   081C  4C 68 50   JMP $5068
   ```

   A ~200-byte routine copied from `$50A4` into `$00FD-$01F2` — i.e. onto the
   stack page — and then `JMP $5068`. Everything from `$081F` to `$5067` is
   high-entropy: the program is compressed.

4. **Made the copied code readable at its run-time address.** re64 has no way to
   say "these bytes execute somewhere else", so I did it with a layer:
   `read_bytes $50A4 length:201`, wrote those bytes to a file, `prepare_upload`,
   `add_byte_layer type:raw address:$00FD`, `set_region $0100-$01C0 kind:code`.
   This is the nicest thing that happened all run — the stub decoded cleanly at
   the addresses it really uses, `JSR $0100` and `JMP $013B` resolved, and the
   identification fell straight out: tables of 52 entries at `$0334`/`$0368`/
   `$039C`, `CPY #$34`, a bit-reader at `$0100`, a self-modified `LDA $5068`
   whose operand at `$0120/$0121` walks *backwards*. That is **Exomizer 2**.

   The last three instructions of it are the whole exercise:

   ```
   01BB  C6 01      DEC R6510
   01BD  58         CLI
   01BE  4C 65 C0   JMP $C065
   ```

   `set_region` immediately reported `$C065: undefined bytes` — re64 named the
   answer before I did.

5. **Ran the loader.** re64 cannot, so I wrote `run/extract-d64.cjs` (sector-chain
   extractor) and `run/run6502.cjs` (a documented-opcode 6502 interpreter with
   `$01` banking modelled and `$D000-$DFFF` treated as I/O so register writes do
   not pollute the snapshot). Executed from `$080D`, stopped at `$C065`:

   ```
   stopped at $c065 after 1768814 instructions
   written range $1-$c11e
   I/O register writes: 73
   unwritten gaps >=16 bytes in $0800-$C11F: none
   ```

   Every byte of `$0800-$C11E` was written by the decruncher — 47,391 bytes, no
   holes. That is the certificate that the snapshot is the program and not a
   partial run.

6. Wrapped that range as a PRG (`$0800` load address), uploaded it, added it as
   layer 2. With only its own load address as an entry it decodes **14**
   instructions, because `$0800` is sprite data. `mark_function $C065` -> **2495**.

7. Pushed further with the tools:
   - `find_instructions from:$0314 to:$0319` found the vector installer at
     `$886F`: `CINV -> $88D5`, `NMINV -> $88D4`. Marking the raster IRQ added
     **761** instructions — the second biggest single win after the entry point.
   - `find_undecoded` + `read_bytes` on the residue found three routines nothing
     reaches statically (`$994F`, `$99C0`, `$C046`): +113.
   - `find_instructions from:$D018` -> one site, `$8AE7 STA $D018` with `#$18`;
     nothing writes `$DD00`. So VIC bank 0, video matrix `$0400`, character base
     `$2000`. Declared `$2000-$27FF` a `bitmap` region with `view:"char:32"` and
     the listing drew a legible font — evidence, not assertion.
   - `run_decoder` as a scanner rather than a picture-drawer: one pass returning
     `{kind:"text"}` gave a zero/sparse/dense density map of all 47K (finding
     `$A100-$BFFF` is 7,936 bytes of nothing); a second pass returning runs of
     printable screen codes gave every string in the game, including
     `THIS PROGRAM WAS WRITTEN OVER A TWO MONTH PERIOD BY JEFF MINTER` and the
     42 wave names on an exact **200-byte stride** from `$67A0` to `$8618`.
   - 25 regions declared from that: graphics, the wave descriptor table, the
     music data, 15 screen-code text spans, the PETSCII status-line template at
     `$90F8` (identified because `$8A44` reads it with `AND #$3F`, which is the
     PETSCII-to-screen-code conversion), and the hi-score block `$5E00-$5ECF`
     (identified from the `SETNAM`/`SAVE` at `$C09C-$C0B3`).
   - 13 comments, 43 hand-named addresses, a project description carrying the
     whole boot chain and memory map, and a tag `builder-1-done`.

## What the tools made easy

- **`prepare_upload` + PUT + `list_disk_files` + `add_byte_layer`** is a clean
  path from a disk image to something disassembling. Four calls, no friction, no
  base64 in the transcript. The `path` form `image.d64:FILE` is exactly right.
- **Every write returning an instruction delta.** This is the single best thing
  in the API for this task. The entire experiment is a sequence of deltas, and
  each one told me immediately whether a hypothesis was worth anything —
  `mark_function $88D5` returning `delta: 761` is a stronger statement than
  anything I could have reasoned my way to.
- **`set_region` naming the casualty.** `orphaned: firstAt $0100` and
  `$C065: undefined bytes` both arrived unprompted and both were the next thing
  I needed to know.
- **Uploading a reconstructed byte range as a layer.** Putting the stack-page
  decruncher at `$00FD` turned an unreadable relocated blob into a listing. This
  is a genuinely good use of the layer model and I did not expect it to work.
- **`run_decoder` is a general compute-over-bytes tool**, and its `text` return
  makes it a search engine. Both my most useful orientation calls were decoders
  that drew no picture at all.
- **`find_instructions` stating its blind spot on every answer.** `19 indirect
  accesses could not be resolved` is what stopped me reading "0 writes to
  `$DD00`" as proof. I still used it as evidence, but as weak evidence, and said
  so in the region comment.
- **Text regions with `encoding:"screen"`** turned fifteen holes into readable
  English in one call each.

## What fought me

Ordered by how much it cost.

### 1. There is no way to run the program, and re64 already has an interpreter

The decisive step — going from 141 instructions to 3452 — happened **outside
re64**, in 300 lines of JavaScript I had to write. That is the whole difference
between a project and a curiosity, and the tool surface has no reach into it.

What stings is that re64 *has* a 6502 interpreter: `run_block`, the P-Code
lifter, a functional test suite that executes 26 million instructions. The scope
rule for `run_block` ("one block, deliberately, so no path is chosen on your
behalf") is the right rule for *reasoning about a routine*. It is the wrong rule
for *running a loader*, where I do not want to reason at all — I want the bytes
the machine would have had.

I called `run_program` once so it is in the transcript. The shape I wanted:

```
run_program(start, stopAt, snapshotAs) -> a new layer of what got written
```

with the exit condition, the instruction count, and the written extent reported.
The honesty requirements are the ones this project already meets elsewhere: say
which addresses were read as `unknown`, say what banking was assumed, refuse
rather than guess. My run needed exactly two machine facts beyond the CPU —
`$01` banking, and "`$D000-$DFFF` is I/O, do not snapshot it" — and re64 already
knows both.

This is not an exotic case. Practically every commercial C64 disk is crunched. A
tool that builds projects from disk images without this builds projects of
decrunchers.

### 2. Layers cannot be edited at all, and it bit immediately

Called and refused: `set_layer`, `remove_layer`.

The concrete cost: the decrunched image `$0800-$C11E` necessarily shadows the
crunched file `$0801-$51A6`. So the project can show the file as it loads *or*
the program as it runs, never both. The boot stub at `$080D` and the decruncher
source at `$50A3` are now invisible — I preserved them only by re-uploading 201
bytes at a *different* address and by writing prose into the project description.

This is the overlay problem from CLAUDE.md ("a C64 game loads a level over memory
that held code a moment ago; both readings are correct, at different times") and
it does not wait for Bard's Tale. It is the **first** thing that happens when you
build a project from a disk, because the loader and the program share `$0800`.

Also missing and wanted: `describe_memory_map` — a per-address view of which
layer wins. I had to infer shadowing from failures.

### 3. An annotation on a shadowed layer is unreachable, and three tools disagree about it

The sharpest bug I hit. `SysEntry` was a `function` label at `$080D` on layer 0.
Once layer 2 covered `$080D`:

- `unmark_function $080D` -> `REFUSED: $080D is not marked as a function`
- `list_labels` -> `{"address":"$080D","name":"SysEntry","type":"function","source":"user","writable":true}`
- `set_label $080D name:"SysEntry" type:"address"` -> **`ok`**, and it minted a
  *second* label, so `list_labels` then showed `SysEntry` twice at one address
  with two different types
- `remove_label $080D` -> deleted one, then refused the other with
  `"$080D is named SysEntry, but that comes from user rather than from this
  project, so there is nothing here to remove"` — which contradicts `list_labels`
  in the same breath and is not a sentence anybody can act on

Net result: an orphan `function` label I cannot delete, which still acts as an
entry point and decoded 14 instructions of sprite data as code until I covered it
with a `data` region. Writes resolve against the topmost layer; reads do not; and
`set_label`'s "or rename what is already there" quietly becomes "add another one".

### 4. `add_byte_layer` has no `noAutoEntry`, and `raw` is unusable without a follow-up

The project schema has `noAutoEntry`; the tool does not expose it. So a PRG layer
whose load address is data — which is what a memory snapshot always is —
permanently carries a wrong entry point, and the only cure is to declare that
address `data`. That happened to be true here, so it looked like tidying rather
than a workaround, but it was a workaround.

The mirror problem: `add_byte_layer type:raw` defaults every byte to `data`, so a
raw layer decodes nothing until you `set_region kind:code` over it. Two calls
where the tool description implies one.

### 5. `find_undecoded` counts fully shadowed layers

Every hole was reported twice — once `inLayer: "revenge (decrunched)"`, once
`inLayer: "revenge"` — for a layer supplying no visible bytes at all. On a big
project that doubles the list and inflates `unexplainedBytes`. Regions resolve by
z-order; this does not.

### 6. `describe_project.entryPoints` does not list the entry points

It reported `["$0801","$0800"]` while `decodeStartsFrom: 19`. Function labels and
`code` regions are entry points and are not in the list, so the one field named
after the thing I was manipulating never showed me what I had. I tracked the set
by hand.

### 7. Smaller things

- `create_project` takes `name` and not `id`, so a project cannot be given the id
  you were told to use. Harmless here; awkward if two projects want one display
  name.
- `bitmap` with `view:"char:32"` produces ~450-character listing lines. Legible,
  but `char:16` is what a font wants and nothing in the description suggests a
  sensible column count per view.
- `find_bytes` names its argument `pattern`; I guessed `bytes` and was rejected.
  Fine — the wrapper is deliberately dumb — but the shape mismatches I hit
  (`create_project.id`, `find_bytes.bytes`, and my own misread of
  `routine_effects`' `itself` / `including_what_it_calls` keys) were all cured
  only by reading `tools/list`.
- `export_project` reported `"changed": false` on a project that had just taken
  ~150 edits. I could not tell whether that means "the stored copy is current" or
  "nothing was written", and nothing else in the reply distinguishes them.

## Findings recorded in the project (not only here)

- Project description: provenance, the full boot chain, how the snapshot was
  produced and its verification, and the run-time memory map.
- `$C065` — a `before` comment naming it the real entry point with the chain and
  the 14 -> 2495 measurement; inline comments on the KERNAL call sequence.
- `$0100` region + comment — the Exomizer decruncher, its table addresses, its
  backwards stream, and its exit.
- `$886F`, `$88D4`, `$8A3C`, `$C082`, `$8AE7`, `$9328`, `$8D25`, `$5359` —
  comments, each stating the evidence.
- 25 regions, 43 hand-named addresses, tag `builder-1-done`.

## Files written (all inside the run directory)

- `extract-d64.cjs` — sector-chain extractor
- `run6502.cjs` — the 6502 interpreter used to run the loader
- `revenge-fixed.prg`, `decruncher-at-00FD.bin`, `memory-after-decrunch.bin`,
  `written.bin`, `revenge-decrunched.prg`
