# Experiment 2: convergence — findings

Three readers, three separate projects, no reference, ~33 minutes of tool time
each. Each went from **5 decoded instructions** to ~1480, ~200 hand-written
names, ~27 regions and ~100 comments. 665 MCP requests.

Read with the transcript, which is at `run/convergence.mcp.jsonl`. Where a
report and the log disagree, the log wins.

---

## 0. The convergence measurement is void, and that is my fault

**`CLAUDE.md` is injected into every subagent's system context, and it names
Gridrunner specifics.** The isolation rules in the briefs covered `assets/`,
`src/`, and the web; they missed the file that loads automatically.

What it hands a reader before it starts:

| In `CLAUDE.md` | What a reader then "found" |
|---|---|
| ``$83E2` `PLA TAY PLA TAX PLA RTI` — an interrupt handler` | all three named `$83E2` an NMI/interrupt handler |
| `Gridrunner's copyright line reads `(c) 1982 HES` through the charset at `$2000`` | all three "recovered" that string from glyph bitmaps |
| `laserAndPodInterval`, `leftLaserYPosition`, `droidXPositionArray`, `explosionXPosArray`, `SCREEN_RAM`, `selectedLevel`, `DrawGrid`, `CopyrightLine` | the vocabulary they named zero page with |
| `$87FE` discards its own return address; `$8D16` flow-into-data | oddities reported as discoveries |

So agreement between readers cannot be distinguished from shared priming, and
the specific agreements I reported earlier — `$83E2`, the copyright string — are
exactly the contaminated ones. **Reader-3 flagged this itself, unprompted**,
which is the single most valuable thing in the run.

The numbers, recorded only so a clean run has something to beat:

```
                names   instructions   regions
  reader-1       206        1480          27
  reader-2       197        1509          25
  reader-3       198        1480          28

  addresses named by more than one reader:  166 of 221 distinct (75%)
  with identical names:                      31 (19%)
```

**The re-run must start from a session whose working directory is outside this
repository**, so no project file is loaded. Nothing else about the setup needs
to change. Until then, treat convergence as unmeasured.

One disagreement is worth keeping because it is about *substance* rather than
wording: `$0003` is `PlotRow` to two readers and `podPtrHi` to the third. That
is the kind of finding the experiment exists to produce, and it survives
contamination because nothing primed it.

## 1. What survives: the tooling findings

Friction does not depend on knowing the answer, so **section 3 of all three
reports is unaffected** — and per the README that section is the experiment's
actual output. Independently reported by more than one reader:

### Unanimous, and the largest gap: no custom character set

All three readers hit it, all three worked around it the same way — **scraping
the hex column out of `export_listing`'s text with a regex and writing their own
bitmap printer.** The most valuable analysis in every run happened outside re64.

The game ships a 64-glyph font at `$8E00`, copied to `$2000`. `set_region` offers
`ascii | petscii | screen`, all three wrong for a game with its own font, which
is the normal case rather than an exotic one. Readers called
`set_region encoding:"custom" charset:"$2000"` and were refused.

This was already recorded in `CLAUDE.md` as "still not solved". It is now the
top item, measured rather than guessed: it is the only gap that cost every
reader real time, and the workaround is a script.

Two tools are missing, and they are separable: a `charmap` on a text region, and
a way to **see glyph data as glyphs**.

### `extent` is one field doing two irreconcilable jobs

Reported by two readers, who between them backed it out of 73 routines.

`mark_function` takes an extent so `find_references` can attribute a call site to
a routine. A label's extent means "this name covers N bytes", so an operand
inside it renders as `NAME + $000F`. They are the same field:

```
before   804A  10 04   BPL loc_8050
after    804A  10 04   BPL UpdateExplosion + $0010      # and loc_8050: is gone
```

A hand-chosen label at `$8050` survives — the documented "an extent beats an
invented name, not a chosen one" rule works — but inside a routine the invented
names are exactly what you want to keep, and inside an array exactly what you
want to suppress.

The cost of *not* declaring an extent is the other half of the trap: reader-3
reports 20 of 35 call sites to its busiest routine attributed to `loc_XXXX`.

**Unresolved — it is a model decision.** Options, in increasing size:
1. Key the operand-rewriting rule on the label's **type**: an extent on
   `function`/`code`/`entry` describes a routine and does not rewrite operands;
   on `address`/`data` it describes an array and does. Uses information already
   present; costs the ability to write `Routine + $10` for a table inside code.
2. Give a function its own `size`, leaving `extent` purely about arrays. Cleanest
   conceptually, and a schema addition.

### `block_effects` answers a question nobody asked

Reader-1, precisely: on a routine head with 35 callers it returns a
**one-instruction block**, because a `JSR` ends a block. The description promises
what a routine touches; the tool gives what a straight-line run touches.

The block scope is right and defensible — it is what makes `run_block` honest —
but "what does this routine clobber" is the question an agent actually has, and
it now has a floor to be built on: blocks, a declared extent, and lifted
semantics. `routine_effects` is the missing tool, and it is a dataflow fixpoint
over the CFG rather than a rename.

### Silent identity fallback

Two readers noticed. `x-re64-user: reader-2` is not a user id, so ~230 edits
landed as `usr_agent` with no warning, and one constant session header produced
three codenames. Notable for an experiment premised on three distinguishable
readers, and it means attribution in this run is by project, not by identity.

## 2. Fixed during the run

Seven, all found by watching a reader fail rather than by imagining what a reader
would want.

| | |
|---|---|
| `run_block` uncallable | `z.record` over an enum makes every key required, so one register was rejected for omitting ten |
| Byte values | took `$8100` for an address and refused `$05` for a value — inconsistent with itself |
| Paging livelock | `nextStart == start` forever when one address owns more rows than a page. A reader's own 47-line comment caused it: **the failure arrives through following the brief well** |
| `find_references` quoted the wrong line | `lineForAddress` points at the *first* row, so a labelled caller quoted its own name, or somebody's prose — worst exactly at routine heads |
| `find_immediates` | same root cause, same fix |
| `run_block` on `RTS` | reported `exit: to $0001 (R6510)` — a meaningless address with a label resolved against it. Now a bare return, and says the stack was empty |
| Stack pointer | started at zero, so every returning block reported reading `$0100`/`$0101` as a finding. Starts at `$FF`, as a program sets it |

The two schema bugs shipped through a green suite for a structural reason:
`Workspace` is tested thoroughly and network-free, and the schema in front of it
was tested by nothing. Tool schemas now get transport-level tests.

## 3. Where a report was wrong

The README's rule earned its place twice.

- Reader-3: "`bind_constant` accepts `LDX #` but rejects `LDY #`". **False.** The
  log shows the refused addresses were `$810A` `TYA`, `$87C1` `CLC`, `$8508`
  `BNE`, `$86B0` `STA` — none of them immediate. The check is
  `operand.type !== "immediate"` and never sees a mnemonic. The tool was right
  and the report invented a mechanism for its own difficulty.
- Reader-1 corrected **us**, and was right: `CLAUDE.md` still described a
  mid-instruction label desynchronising the decode into garbage. The overlap work
  had removed that and the section was never updated. An `address` label changes
  nothing; a `function` label starts a second stream that is shown and marked.
  Corrected.

## 4. The list, not yet acted on

Per the standing rule, only what blocks the next experiment gets fixed.

- `set_regions` batch; `bind_constants` is all-or-nothing with no partial report,
  turning one batch call into 49
- `namePattern` is an undocumented substring match
- `add_label`'s confirmation text reads like a rename
- `find_references` still cannot see zero-page or indirect targets — which on a
  6502 is every variable. Stated on every answer, so it misleads nobody, but two
  readers wanted it
- The change log is per-op: 875 rows for ~25 actions
- A mid-instruction label renders nowhere, though it resolves correctly
- Tools reached for and refused: `find_hardware_access`, `find_instructions`,
  `call_graph`, `list_comments`, `run_routine`, `whoami`
- `run_block` cannot carry state between calls. Reader-3: "run `InitScreen`, then
  run `CalcRowAddress` in the memory that left behind." This program builds its
  tables at runtime, so most routines read zeros out of the cartridge image — the
  tool flags that honestly and the flag is not the same as an answer

## 5. What the readers found in the binary

Recorded because it is checkable later, and because agreement here is worth more
than agreement about names — with the contamination in section 0 applying to
anything `CLAUDE.md` mentions.

All three, independently and correctly: **it is an autostart cartridge, not a
PRG.** `$8000` holds vectors and the `CBM80` signature; the project's auto entry
point was decoding them as five nonsense instructions. One `mark_function $83C1`
took each project from 5 to ~1474 instructions. Every other finding depended on
that call, and no tool suggested it — `find_undecoded` reported 4086 unexplained
bytes without ever pointing at the header.

Also unanimous: no sprites (only `$D016`/`$D018`/`$D020`/`$D021` are written), no
raster interrupt (a free-running loop with counted timing), and **the screen
matrix is the world model** — no object table, collisions read back out of screen
RAM, the score living as characters at `$040F`.
