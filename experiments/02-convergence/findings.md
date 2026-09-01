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

**It is specifically the *custom* mapping that is missing, and nothing else.**
Worth stating, because the obvious hypothesis — that the encoding feature was
too hidden to find — is wrong, and the evidence is in the transcript. Readers
passed `encoding` seven times without being told to: six `screen`, one
`petscii`. That `petscii` call was reader-3 declaring the cartridge signature,
which renders correctly:

```
8004  CBM80Signature:
8004  C3 C2 CD 38 30           .TEXT "CBM80"
```

So the built-in encodings are discoverable, reached for unprompted, and right.
The three refused calls — two `custom`, one `charset` — are the whole of the
gap.

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
- ~~Tools reached for and refused~~ — **all seven are now built or answered**:
  `read_bytes` and `whoami` outright; `render_charset` by bitmap regions, the
  pixel explorer and `run_decoder`; `run_routine` by `run_block` and
  `routine_effects`; `find_hardware_access` and `find_instructions` as one tool,
  since the first is the second with a range filled in; `call_graph` and
  `list_comments` as themselves. Only `set_text_encoding` with a `charsetAt`
  remains, and a decoder covers it in substance
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

---

# Second run — what it produced

Same brief, same three-reader shape, against 49 tools instead of 37. `CLAUDE.md`
was parked for the duration, which run 1 had not done.

**Not saturated, but the frontier moved.** None of run 1's seven invented tools
was invented again. The new ones — `find_memory_access`, `remove_entry_point`,
`find_table_users`, `find_bytes`, `find_stores`, `trace`, `set_charset`,
`decode_text`, `annotate_table` — are a narrower list, and several are the same
question twice.

## The finding about the experiment, which is the most valuable one

**The answer key ships inside the tool descriptions.** `add_label` cited
`randomValue`/`gridXPos`; `set_constant` cited `LEFT_ZAPPER`/`ORANGE`. Two
readers found it independently, and one made the point that matters: sanitising
the filesystem does not close it, because those descriptions arrive from the
server no matter where a reader runs. Now generic.

## Fixed from this run

| finding | |
|---|---|
| routine attribution confidently wrong — one routine absorbed 26% of the program, every SID write reported "in ColdStart" | a `JMP` ends a routine; largest fell to 5%, ambiguous addresses 764 → 4 |
| `find_instructions $D000-$D02E` returned one dead instruction | runs the path on the lifted code, so `STA ($02),Y` resolves to `$D018` **and** the byte it stored; unresolved ones reported |
| no custom text encoding, so every string was unreadable | a text region renders through a decoder |
| `$(0xD)` in effects, a notation used nowhere else | names the slot: `frameCounter ($000D)` |
| `find_references` empty for zero page, reading as unanswerable | points at `find_instructions`, which answers it |
| `block_effects` returning one instruction at a routine head | says so, and names `routine_effects` |
| no `find_bytes` | added, with `??` wildcards |

## Did not reproduce

`export_listing` emitting invalid JSON. Checked across the whole program and
across all three readers' own final projects, every page: no control characters
and no parse failures. Recorded rather than fixed — the same call the transcript
forced in run 1, where a reported `LDY #` refusal turned out to be four
instructions that take no immediate.

## Still open

- `kind:"code"` creates entry points nothing can remove, and `remove_entry_point`
  was invented for exactly that
- `bind_constants` is all-or-nothing with no partial report — reported in both runs
- the ±1 label tolerance overrode an exact auto label on a branch target
- the auto entry point at `$8000` leaves a permanent warning as the reward for
  correctly declaring the cartridge header data
- `set_label indexBase:` for the twelve 1-indexed tables

## Run 1 against run 2

The same brief, the same three readers, against the tools built in between. The
headline is that they did **less**, for the same money:

| | run 1 | run 2 |
|---|---|---|
| MCP requests | 712 | 472 (−34%) |
| comments written | 661 | 288 (−56%) |
| names per reader | 206 / 197 / 198 | 116 / 179 / 175 |
| output tokens | 772k | 736k |
| harness tool-uses | 195 | 195 |

Near-identical budgets with a third fewer requests is the finding. Run 1's
CLAUDE.md was contaminated — it named Gridrunner's charset address, its
copyright string, its cartridge header — so run 1 was partly *transcribing*. Run
2 had to derive the same things, and the effort moved out of the API and into
thinking. That is the right direction and it makes the two runs not directly
comparable on volume, which is worth saying plainly rather than reading the drop
as a regression.

The tool descriptions were generalised between runs for exactly this reason.

## What actually cost the time: interpreting, not locating

Measured from `run2/convergence.mcp.jsonl`, per reader, by call number:

| reader | calls | `find_undecoded` | reached `$8E00` | first decoder |
|---|---|---|---|---|
| agate | 105 | 10 | 26 | 27 |
| amber | 248 | 17 | 24 | 25 |
| basalt | 119 | 14 | 28 | 47 |

All three asked what was unexplained within seventeen calls and were looking at
the character set by call 28; two ran a decoder on the very next call. **Finding
the interesting span was easy.** Working out what was in it was not, and one
reader spent nineteen calls on it.

So a statistical "this looks like graphics" hint would have solved a problem
nobody had. It was tested anyway — bit-pattern symmetry does separate the charset
from every code window on this binary, where entropy does not — and rejected: it
holds for simple glyphs, fails for complex ones and for most bitmaps and sprites,
and calls flat `$00`/`$FF` filler graphics.

What answers it instead is already the API's own shape — **ask what uses a span,
not what it looks like**:

```
find_instructions from:$D018 to:$D018
  $810B  STA ($02),Y  →  $D018 = $18      in InitializeGame
$18 puts the VIC character base at $2000
find_instructions from:$2000
  $82F1  STA charSetLocation,X            in LoadCharacterSetData
  $82EE  LDA characterSetData,X    ← $8E00
```

Every link is evidence in the program. That chain only became followable with
the interpreter-based pointer resolution above: folding the pointer but not the
index returned three indistinguishable sites all claiming `$D000`, and the trail
stopped at step one. It is pinned by a test.
