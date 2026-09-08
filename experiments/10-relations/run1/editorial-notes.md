# Editorial notes — experiment 10, stage two

I am the editor. I read the `camels` project as somebody else's document, wrote
`article.html` from it, and kept a record of where the document carried me and
where I gave up on it and went back to the bytes.

I did not read the readers' `findings.md`, `docs/`, `assets/mutant-camels/*.md`,
or any source. I did read `read_messages`, and I flag below what that changed —
it turns out to matter a great deal.

Everything below is about what a *document* can hold. None of it is a criticism
of the two readers, whose work was careful, well-hedged and — this is the part
that made it usable — honest about its own gaps every single time.

---

## 1. The shape of what I was handed

```
runtime target:  3388 instructions decoded
                 68 claims named by hand, 523 auto-named
                 93 comments
                 4 record types
                 1 scenario (the decrunch that produced the target)
                 0 constants
                 0 decoders
                 0 evidence entries
                 0 tags
                 0 findings from disagreements()
                 2 undecoded spans, 9728 bytes
```

Thirty minutes of reading — `describe_project`, `list_comments`, `list_types`,
`list_claims` — put me most of the way into the program. That is the headline
result and it should not be buried: **the document is a good one.** What follows
is about the specific class of thing it could not hold.

---

## 2. What the project told me plainly, and through which mechanism

### `describe_project` → the `regions` block

The single most valuable read of the run. Fifty named spans in address order,
each with a kind. One call and I knew where the messages were, where the tables
were, where the code stopped. Nothing else I did produced as much orientation per
token. If I could keep one mechanism it would be `add_claim` with `extent` and
`is`, because this is what it adds up to.

### `add_comment` → almost all of the reasoning

93 comments, and the relational content of the project is almost entirely inside
their prose. These carried me directly and I used them without re-deriving:

| what I learned | comment |
|---|---|
| `$898C`/`$89CD` are the lo/hi halves of one note table | `cmt_ckvfr2`, `cmt_d6139e` — and they explicitly say *why* it is two comments and not one type: "two parallel arrays … so add_type does not fit this shape; recording the pairing in these two comments/names is the workaround" |
| the object system is slot → type → property, two levels | `cmt_igjemn` on `$1D10` |
| `spawn_object_from_template` copies ten parallel per-type arrays into ten per-instance arrays, and the ten pairs are listed | `cmt_ondcod` on `$9772` |
| `$C023` and `$C046` are opposite self-modifying-code patchers over the same seven opcode bytes | `cmt_01aw4a` — with the byte values, so I could check it |
| `$883A` turns a screen pointer into a colour pointer by adding `$D4` to the high byte | `cmt_rvodbc` |
| the ONE/TWO suffix patching, and that `msg_enter_your_name` uses a *different* mechanism (two windows in one string, not a patch) | `cmt_r1y758`, `cmt_c4lffs` |
| the keyboard scan-code table and character table share an index space | `cmt_qmohuo`, `cmt_6afz88` |
| `$5474` is the seed for the `$5E00` buffer, *proved* rather than size-matched | `cmt_ija83h` — the best single comment in the project |
| the credits scroll names the game and the author, and the reader flagged that he already knew both facts and was not presenting them as a cold discovery | `cmt_ce5ib0` |

That last one is worth naming as a practice. It is the only place in the document
where somebody separated "the bytes say this" from "I knew this anyway", and it
made me trust everything around it more.

### `add_type` → the one place a relation survived structurally

`HighScoreEntry` and `HighScoreEntryLive` are the same 52-byte shape declared
twice because the same field is PETSCII in one copy and screen-code in the other,
and the `message` field description on the live one names the routine that
converts between them. That is a relation — *this table is that table, after that
routine* — expressed in a place a later reader will actually hit. I used it
without checking it, and when I did check it, it held.

`MusicStep` likewise: the `note` field description says what indexes what and
what terminates it.

The type descriptions did more relational work than the type *fields* did.

### `find_instructions` by operand range

The tool that answered the most questions per call once I was working
independently. "What writes `$D010`" → one hit. "What writes `$D018`" → one hit,
and that one hit was the answer to a question the document had left open four
times.

### `render` and `read_bytes`

The pair I leaned on hardest. `render` for "is this a font?" (yes, instantly),
`read_bytes` when I wanted to draw it myself.

### `read_messages` — and this is a finding

The chat log carries things that exist nowhere else in the project:

- **"`$6230-$87FD` (~8.6KB) has no absolute-address reference anywhere I can
  find."** This is the single most useful orientation fact in the whole project
  and it is in a message. There is no claim over that span. A reader who does not
  call `read_messages` sees only that `find_undecoded` reports a big hole, with no
  indication that somebody has already looked in it and what they tried.
- The division of labour, and therefore *who looked at what and did not find
  anything*.
- A reported tool limitation (record claims not clearing `find_undecoded`).
- Reader two's cross-check of reader one's `cur_player` finding against
  `sub_8A42` — a genuine relation, confirmed by a second person, that never
  became a comment.

`post_message`'s own description says it "goes nowhere near the listing … is not
in the exported file". That is the correct design for a conversation. The problem
is that **what has been ruled out is not a conversation, it is a result**, and it
had nowhere else to go.

---

## 3. What I had to re-derive, and where I gave up on the document

This is the list the brief asked for. In each case I name the moment I stopped
reading and started running or drawing.

### 3.1 Nobody had ever run it

**Gave up at:** `list_scenarios` returning 1 — the decrunch that built the target.

The whole project had been made by reading. There was no picture of the game
anywhere in it, and no record that anyone had tried and failed. Since the article
needed pictures, everything from here on was mine.

### 3.2 Getting it to boot

**Gave up at:** the first `run_scenario`, which stopped at `$0000` with a black
screen and said nothing about why.

Binary-searched with `maxInstructions` + `trace` captures to find that it dies
about 430 instructions in, immediately after `sub_886F` does `CLI`. Cause: this
host has no ROM files, so the hardware interrupt vector at `$FFFE` is unmapped.
Supplied 17 bytes standing in for `$FF48`, `$EA31` and `$EA81` and it came up.

Nothing in the document is at fault here. But note the failure was *silent*:
`stopped: {reason: frames, at: $0000}` and an all-black 320×200 capture. It took
five scenarios to learn that the machine had no operating system.

### 3.3 The NMI vector, and a correction to the document

**Gave up at:** `cmt_xq726k` / `cmt_wd5323` on `$88D4`, which call the bare `RTI`
"a stray leftover from an earlier RTI-terminated stub", and `cmt_xq726k`'s
"installed dynamically … something later repoints it here".

Both are answered sixty bytes earlier in `sub_886F`, which the same reader had
looked at:

```
8872  LDA #$D5 / STA $0314        ; IRQ vector  -> $88D5
8877  LDA #$88 / STA $0315
8881  LDA #$D4 / STA $0318        ; NMI vector  -> $88D4
8886  LDA #$88 / STA $0319
```

The `RTI` is the deliberate RESTORE-key swallower. The "something later" is five
instructions into main init.

**Why the document could not hold this.** The connection is that two *immediate*
operands, `#$D4` and `#$88`, loaded one after another, constitute an address.
`find_references` on `$88D4` will never see it — its own answer says so. There is
no mechanism in the project for "the pair of immediates at these two sites is a
pointer to that address". `bind_name` binds an operand that already refers to an
address; an `LDA #$D4` has no address operand to bind.

This exact shape cost me four re-derivations (below). It is the biggest single
gap I hit.

### 3.4 Where the letters live

**Gave up at:** the fourth comment saying "one non-letter glyph byte"
(`cmt_lpl6wz`, `cmt_h6xyvh`, `cmt_v274be`, `cmt_y4ohpy`). Four separate notes
reason their way to "punctuation from a redefined character set" and stop.

One call — `find_instructions` with `from`/`to` = `$D018` — gives one hit:
`LDA #$18 / STA $D018` at `$8AE5`, meaning screen at `$0400` and characters at
`$2000`. `render` at `$2000` with `char:32` shows a font immediately.

That resolved, in about four minutes:

- `$51`=`.` `$52`=`,` `$53`=`'` `$54`=`!` `$55`=`?` `$56`=`:` — all four
  "non-letter glyph" notes at once.
- `$48`–`$4F` is a bar in eight widths. The project's transcription
  `"NEUTRONIUM STATUS  HHHHHHHHHHHHHHHHHH"` is eighteen full cells of a fuel
  gauge. The reading was correct; the *encoding* it was read in was the stock
  one, and this program does not use it.
- `hud_status_bar_template` at `$9149`, which the document guessed was
  characters, is a colour row. Confirmed cell by cell against a stopped machine:
  columns 0–20 colour 1, columns 21–38 `7 7 7 4 4 4` ×3, exactly the table bytes.

**Why the document could not hold this.** Same shape as 3.3: `#$18` is an
immediate whose *meaning* is two addresses. Also: nothing in the project records
"the machine configuration this program establishes". `where` even says so — it
reports `assumed: {screenBase: $0400, vicBank: $0000}` with a note that both are
runtime state — but there is nowhere to put the answer once you have it, and no
`add_constant` had been declared for `$18` either.

### 3.5 The sprite pointers — a search that missed by one byte

**Gave up at:** `cmt_pdjwew` on `$0801`: "find_instructions on the VIC
sprite-pointer range `$07F8-$07FF` turns up nothing yet … the code that actually
points the VIC at a sprite number almost certainly lives in the still-undecoded
span."

It is at `$92CB`, `STA $07F7,X` with X running 1..8. The instruction names
`$07F7`; the addresses written are `$07F8`–`$07FF`. The same routine does
`STA $D026,X`, which writes the eight sprite colour registers at `$D027`–`$D02E`.

I found it by accident, reading that listing for another reason.

**What would have caught it.** `find_instructions`' description says "the range
is the meaning", and it is right, but it matches the operand. An answer that also
reported *"3 indexed instructions have a base within 16 bytes below this range"*
would have turned a dead end into a hit. The readers did the right thing and got
nothing.

### 3.6 The sprite pipeline, and a confirmed guess

`cmt_cpmfni` on `$8B5F` guesses "shadow copies … probably built once per frame
and blitted to hardware elsewhere", and says outright "I have not traced
`dat_1F9C` to `$D010` to confirm".

Both halves are right and both are one call away. `$D010` is written exactly once
in the program, at `$927E`, from `$1F9C`. The blit is at `$925F`–`$92F5`.

What is *not* in the document at all: there are **two** shadow banks eight bytes
apart, selected by `$30` toggling every frame, so the game draws eight sprites on
even frames and a different eight on odd — sixteen objects out of eight hardware
sprites. `sub_929D` reads `$1F3F,X`; `sub_92CF` reads `$1F47,X`. That relation is
between two routines and two table pairs; it has no home in the model except
prose.

I proved the shadow→hardware link by capturing `$07F8` and `$1F71` at the same
instant in a running game — they match, with the last byte one step behind
because the blit had not reached it.

### 3.7 The 8.6KB hole: 42 levels of 200 bytes

**Gave up at:** `find_undecoded`, which reports `$622E-$87FD`, 9680 bytes, and
nothing else. There is no claim and no comment over that span. (The chat says
somebody looked. The document does not.)

`LDA ($3E),Y` is the reader. `$3E`/`$3F` are set at init:

```
8A7E  STA $3E        ; A = 0
8AB5  LDA #$67 / STA $3F     ; -> $6700
```

Then: `find_bytes` for `ASSORTED` in screen codes → `$67A7`. Scanning the span
for screen-code runs gives names 200 bytes apart, first at `$67A0`, last at
`$87A8` = `$67A0 + 41×200`. So 42 records × 200 bytes, `$6700`–`$87CF`, name at
offset `+$A0`, and the code resumes at `$87FE`.

`loc_9CB5` consumes one record: four bytes to working variables, one to `$02`
(the bank index), two to `$D025`/`$D026`, one discarded, forty to `$058F` (the
name), then `JSR sub_5007` to copy that bank in.

**Why the document could not hold this.** Third instance of the same shape:
`#$67` is an immediate that is half a pointer. Also, `add_type` would have fitted
this beautifully — 42 records of 200 bytes with a `char(40)` field at `+$A0` and
holes everywhere else is exactly what the tool describes itself as being for —
but you cannot declare a type over a span you have not found, and finding it
needed the immediate.

### 3.8 The random number generator is in a ROM that is not in the file

**The one place the document actively pointed the wrong way.**

`cmt_mhro2o` on `$9FEF`: "`$A001-$BFFF` (8191 bytes) is uniformly zero … Guess:
reserved/scratch RAM … deliberately left zero at rest."

`sub_8D1D`, eleven callers:

```
8D1D  INC $24
8D1F  LDX $24
8D21  LDA $A000,X
8D24  RTS
```

`$A000` is BASIC ROM. The program never touches `$0001`, so the ROM is banked in
and the CPU never sees the RAM the reader sampled. The dice are the first page of
the BASIC interpreter.

The `add_rom_layer` tool description says this almost word for word about
Gridrunner ("takes its entropy from BASIC ROM through eleven callers, and with
nothing supplying those bytes there is no answer") — same author, same trick,
same eleven callers. The mechanism to answer it *exists and was not used*.

I demonstrated the dependency rather than asserting it: two runs, identical
steps, differing only in the 256 bytes at `$A000`. With zeros the game is frozen
— frame 910 and frame 2110 are byte-identical PNGs. With 256 invented bytes it
plays. That comparison is in the article.

**Why the document could not hold this.** It could have. Nobody linked a ROM
layer. And `read_bytes` returning zeros for `$A001-$BFFF` is not a lie — the
project genuinely supplies those bytes from the captured RAM image — but a
reader has no signal that the *machine* would not read them. See §5.

### 3.9 The two readers described the same bytes and could not see each other

This is the finding I would put first if I had to pick one.

- Reader one, working up from `$0801`, claimed `sprite_sheet_main` over
  `$0801-$5000` and wrote: *"a band roughly a third of the way through that
  renders as visual noise in this hi-res view — possibly debris/explosion-particle
  sprites."*
- Reader two, working down through the game logic, claimed `obj_type` at `$1D10`
  and wrote: *"This is the central 'one thing refers to another' relation in the
  game logic."*

`$1D10` is 29% of the way through `$0801-$5000`. It is the same band. I drew it
as sprites: it is small numbers, not debris.

`claims_at $1D10` returns both claims, cleanly, with ids. `disagreements()`
returns nothing, and is right not to — a small table inside a big one is
ordinary. But the *fact that two people described these bytes incompatibly* is
not recorded anywhere, and neither comment mentions the other.

Reader one's claim also over-reaches in three other ways that only show up once
you know the machine configuration: `$2000-$27FF` is the font; VIC bank 0 means
nothing above `$3FFF` can be sprite data at all; and `$0800-$0FFF` is a
*destination* that `sub_5007` overwrites at every level change.

### 3.10 Smaller re-derivations

- `bank_copy_ptr_tbl` at `$502F`. `cmt_l40dex` reads the bytes
  `00 10 00 18 00 40 …` as little-endian addresses `$0010, $0018, …` and flags
  the indexing as unresolved. The loop reads lo from `$502F,X` and hi from
  `$5030,X`, so `X=0` gives `$1000`, `X=2` gives `$1800`, and the sources are
  `$1000 $1800 $4000 $4800 $5000 $5800`. The reader's hedge was the right call;
  the answer was in the loop they had already quoted.
- `patch_freeze_countdowns` at `$C046` has no `RTS`. It falls through into
  `$C061`, which the document names as a standalone trampoline (correctly — it
  also has a caller). Both readings are true and neither comment mentions the
  fall-through.
- The keyboard: `sub_5695` and `sub_96D2` both read `LSTX` (`$C5`), which only
  ever gets a value because the KERNAL's `$EA31` scans the keyboard on every
  interrupt. Every one of this game's IRQ exits is `JMP $EA31`. The game's key
  handling is a relation to a routine in a chip. Not recorded, and it is why
  nothing in the article is driven from the keyboard.

---

## 4. What I asked for and could not get

- **ROM images.** The host has none. `add_rom_layer` accepted `kernal`,
  `characters` and `basic` and reported `ok` for all three, but the layers never
  joined the runtime target (`list_targets` shows the runtime target with one
  layer), `$E000` stayed `unmapped`, and — the part that matters —
  `describe_project` **did not report `romsMissing`**, which its own description
  says it will. Adding a ROM changed nothing about what the emulator ran. So the
  designed answer to §3.8 was unavailable and silently so.
- **VIC registers back out of a run.** `capture: ram` over `$D000-$D02F` returns
  the RAM under I/O — all zeros. There is no way to read the video chip's state
  after a scenario, which is exactly the state `where` says it has to assume.
- **A tool listing.** The wrapper only issues `tools/call`. I wrote a four-line
  `tools/list` script; worth knowing that the first thing a new agent must build
  is the thing the brief tells it to do first.
- **Argument names.** Three misses in a row, each costing a round trip:
  `read_bytes` wants `start`, not `address`; `claims_at` wants `at`, not
  `address`; `find_bytes` wants `pattern`, not `bytes`. All three refusals were
  clear and immediate, which is the right behaviour; I record it only because the
  brief asks what I could not get first time.
- **The readers.** They had stopped. Nothing I wanted from them was a question
  about the program — it was all "did you try X" — which is the same negative
  space as §2's last point.
- **A reproduction of the readers' `find_undecoded` complaint.** Both said in
  chat that record claims do not clear the undecoded list. `find_undecoded` now
  reports only `$622E-$87FD` and `$5ED0-$5EFF`; the record claims at `$5474` and
  `$5E00` are *not* listed. Either it was fixed, or they misread it. The document
  has no record either way, because the observation went to chat.

---

## 5. What I built, and what I wished existed

### Built (all in `run/ed/tools/`, ~190 lines total)

| tool | why |
|---|---|
| `mcp-list.sh` | `tools/list`; the wrapper only does `tools/call` |
| `shot.cjs` | capture JSON (`screen`, `frames`) → PNG. Zero-dependency PNG encoder; also prints a colour histogram, which is how I proved two frames 1200 apart were identical |
| `draw.cjs` | `read_bytes` → a *legible* PNG in `char` / `sprite` / `sprite-multi` layouts at a chosen scale and chosen C64 colours. `render` gives 1:1 pixels, which is right for finding things and unusable in an article |
| `scn.cjs` | adds a scenario with the KERNAL/RNG stand-in prefixed, so I stopped hand-writing it |
| `build.cjs` | inlines `{{asset:…}}` as data URIs into one self-contained HTML |
| `scan.cjs` | scans a byte range for runs of screen-code text, using *this program's* encoding rather than the stock one. How the 42 level names fell out |

Three of the six exist because a re64 answer was correct but not in a form a
person could look at. `draw.cjs` and `scan.cjs` in particular are re64 tools with
the program's own character encoding substituted for the stock one — which is
the shape of the missing feature in §5's first bullet below.

### Wished existed

1. **A place to record the machine configuration this program establishes.**
   `$D018 = $18` is one instruction and it changes the meaning of two whole
   regions and of every text decode in the project. `where` already knows it has
   to guess (`assumed: {screenBase, vicBank}` with an honest note); `render`'s
   `char:` view and every `text` claim silently use the stock encoding. If a
   project could declare *"screen `$0400`, characters `$2000`, bank 0, text
   encoding = the glyphs at `$2000`"*, then §3.4 evaporates: the message
   transcripts come out right the first time and "HHHHHHHHHHHHHHHHHH" is never
   written down.

2. **A pointer binding for immediates.** Four of my nine re-derivations
   (§3.3, §3.4, §3.7, and the `$3E/$3F` half of §3.7) are the same shape: a pair
   of `LDA #$xx` immediates that constitute an address, invisible to
   `find_references` by construction. `bind_constant` exists for "this immediate
   means ORANGE"; there is nothing for "these two immediates mean
   `raster_irq_handler_body`". `find_immediates` finds the sites; nothing lets you
   say what one *is*.

3. **Search by effective address, not operand.** §3.5 cost a reader an entire
   region. `find_instructions` matching `STA $07F7,X` when asked about
   `$07F8-$07FF` — or merely *saying* that indexed instructions with nearby bases
   exist — turns a dead end into an answer.

4. **A recorded negative.** "I looked in `$6230-$87FD` with `find_references` and
   an immediate-high-byte spot check and found nothing" is a result, it took
   work, and it has no home. It went to chat, which is not exported.
   `find_undecoded` counts what is left to do; there is no way to say what has
   already been tried on it.

5. **Typed edges between claims.** `add_evidence` is the closest thing and it is
   about *truth* (supports / refutes / supersedes), not structure. Every relation
   in this project — "lo/hi halves of one table", "shadow of that register",
   "seed for that buffer", "opposite of that patcher", "same index space" — lives
   as English inside a comment, findable only by reading all 93. The readers knew
   this and said so twice, in the comments themselves: *"recording the pairing in
   these two comments/names is the workaround."* Two people independently
   describing the same missing feature, in the document, is about as clear a
   signal as an experiment produces.

6. **`add_evidence` pointed at a scenario.** Its description advertises exactly
   this ("Point at a `scenario` and the evidence re-verifies"). It was used zero
   times, and it is the mechanism that would have carried my strongest results:
   the `$07F8`/`$1F71` capture, the colour-row capture, the zeros-versus-ROM
   comparison. Those are now three scenarios in the project with no claim
   attached to them, which is the same failure one level up.

---

## 6. Were the annotations enough to write from?

**For the map, yes. For the game, no.**

I could have written a competent article about the *data* in this file from the
document alone: the messages, the high-score jokes, the note tables, the object
system, the two-player state swap. Roughly the first half of what I know.

I could not have written a single sentence about what the game *looks like*, and
that is the article. Every picture, the animation, both sound clips, the
typeface, the sprite pipeline, the 42 levels and the ROM dice are mine, and none
of them needed cleverness — they needed somebody to press fire.

### What would have made them enough

Ranked by how much of my day each would have saved:

1. **A scenario that boots the game, kept in the project.** Once one exists,
   everything else is cheap. Building it was the single largest cost of this run
   (five scenarios and a binary search to discover the host had no ROMs), and it
   is a cost every future reader of this project will pay again, because nothing
   I learned about the machine is recorded in a form the next person will find.
   *(I have left thirteen scenarios in the project, including `boot-with-irq-shim`,
   `rng-walk` and `rng-zeros`. They are the most useful thing I added.)*
2. **The character encoding, declared once.** §3.4.
3. **The ROM layers, linked.** §3.8, and it is the project's own documented
   answer to that exact question about that exact author.
4. **Somewhere for a negative result.** §4's last two bullets.
5. **Typed edges.** §5.5 — the readers asked for this themselves.

### The thing I would tell the next reader

The two readers split the file by address and coordinated well. That is the right
way to divide *decoding* and the wrong way to divide *understanding*, because
every interesting fact in this program is a line between two addresses that
belong to different people. Reader one owned the sprite sheet; reader two owned
the code that points at it. Reader one owned the messages; reader two owned the
character set — except nobody owned the character set, because it is inside the
sprite sheet, which is why the messages are full of unexplained glyphs.

Splitting by *subsystem* — one takes graphics wherever they live, one takes
sound and input — would have put both ends of most of these relations in one
head. It would also have made the overlap between them visible as a
disagreement instead of as silence.

---

## Appendix: what I left in the project

Additive, all of it; I removed nothing and edited nobody's claims.

- 3 rom layers (`kernal`, `characters`, `basic`) — inert on this host, but they
  make `list_targets` say so, which is more than the document did before.
- 13 scenarios, taking the project from 1 to 14: `boot-title`, `diag1`,
  `play-from-loader`, `boot2`, `probe-pc`, `probe-pc2`, `boot-with-irq-shim`,
  `press-fire`, `play-a-bit`, `rng-walk`, `rng-zeros`, `film`, `evidence-shot`.
  The last five are the ones worth keeping — `rng-walk` and `rng-zeros` are a
  matched pair that demonstrates §3.8 — and the six probes are scaffolding that
  somebody should delete.
- No claims, comments, types, constants or evidence. I was reading, not
  annotating — and, in hindsight, that was a mistake I made for the same reason
  the readers made theirs: what I found was mostly relations, and I had nowhere
  obvious to put them.
