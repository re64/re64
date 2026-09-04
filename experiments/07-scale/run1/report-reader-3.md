# reader-3 (beryl) — Revenge of the Mutant Camels

Three of us shared one document. I ended up owning **the data**: `$0801-$4FFF`,
the `$6700` zone table, and `$A000-$BFFF`. That was not the plan — it was the
result of losing a race for the code, which turns out to be the most interesting
thing in this report and I have put it under what fought me, where it belongs.

Roughly what I put in the project: **~120 labels, ~60 comments, 10 regions, 6
constants and 12 bindings, 1 tag.** Collectively the project went from 40,359
unexplained bytes to 34.

---

## What I worked out

### The memory map below $5000 is entirely graphics and state

Nobody had touched 18KB of it. It is six things:

| span | what | how I know |
|---|---|---|
| `$0801-$0FFF` | the live sprite bank, blocks `$20-$3F` | `$5007` copies here; `$92CB` writes `$07F8-$07FF` |
| `$1000-$1CFF` | sprite bank 0 (the camel) | rendered it: 24x21, 3 bytes/row, 64-byte blocks |
| `$1D00-$1FFF` | game state, 336 instructions reference it | see below |
| `$2000-$23FF` | the character set, 128 glyphs | `$D018 = $18` at `$8AE7`; rendered it |
| `$2400-$3FFF` | resident sprites, blocks `$90-$FF` | rendered it; the zone records use these blocks |
| `$4000-$4FFF` | two more banks, out of VIC reach | rendered; `$4000` is multicolour |

The thing that makes the split *mean* something: the VIC bank is `$0000-$3FFF`,
so anything from `$0800` to `$3FFF` is reachable by a sprite pointer with no copy
at all. `$4000` and `$4800` are outside it. **That is the entire reason the bank
table at `$502F` exists** — not to save memory, but because those two sets are
unreachable where they sit.

I first declared the character set as 2K and it is 1K. The correction came from
data, not from looking harder: I extracted `animFirst`/`animLast` for all
42 x 8 creature templates and found sprite blocks `$90-$9F` in use, which are
`$2400-$27FF`. Rendering `$2400` as sprites gives a walking creature; as
characters it gives nothing. The game never writes a screen code above `$7F`, so
128 glyphs is all it needs and the top half of the nominal charset is pictures.

### $1D00-$1FFF is the object system, and it is the whole game

Eight creature types per zone, six live slots, nineteen attributes per type.

`sub_9772` is the spawn, and it is what named everything: it copies one column of
a template block into the matching per-slot arrays, so the mapping is *proved* by
the copy rather than guessed.

```
$1DA0-$1E37   19 tables of 8    the creature templates, per zone
$1D00         typeSpawnTimer    countdown per type
$1D10-$1FB0   the live slots    type, anim state, speeds, position, lifetime
$1F40-$1F8F   the sprite state  X, Y, colour, shape, in-use
```

All nineteen template fields are now named and every one is read somewhere:
spawn interval, move type, animation first/last/mode, the three
become-something-else pointers, speeds, step, spawn cap, spawn X/Y/mode, colour,
lifetime, score value, explosion length.

**Four separate routes from one creature to another** — shot (`$9B00`), exploded
(`$9B63`), aged out (`$9A4F`), bounced out (`$9A20`) — all landing in the same
`sub_9772`. A zone is a directed graph of eight creature types and the zone
record is its adjacency list.

The payoff, and the finding I like most: **there is no explosion subsystem.**
Blocks `$EC-$EE` are used by every one of the 42 zones as one of the eight
creature types, and `tmplTypeWhenExploded` for the other seven reads
`3 3 3 0 3 3 3 3`. An explosion is a creature with a twelve-tick lifetime and
`tmplNextType = $FF`. Blowing something up is the same call as a bird laying an
egg.

### The zone table: $6700, 42 records of 200 bytes

`$93D8` loads `$6700` into `$3E/$3F` and adds `$C8` once per `$58`. `loc_9699`
then pulls 152 bytes through `($3E),Y` into `$1DA0`, and `loc_9CB5` **carries on
from Y=152 with the same pointer, never resetting it**: 8 wave parameters, then
40 bytes of screen text. 152 + 8 + 40 = 200 exactly. The structure closes on
itself, which is the proof.

The evidence that settles it beyond argument is that decoding offset +160 of each
record gives 42 consecutive English sentences — `ASSORTED EASY AVIAN ALIENS`,
`CAREFUL WITH THAT AXE, EUGENE`, `REVENGE OF THE MUTANT MUTANT CAMELIDS`. A wrong
stride does not produce that.

I labelled all 42 records and wrote a per-record comment carrying its title and
its eight decoded parameters, so the largest object in the program is readable in
the listing rather than being a hex column.

Reading all 42 records also settled two things reading code could not:

- The bank index (offset +156) is only ever 0, 2, 4 or 6. **Entries 8 and 10 of
  the `$502F` table, which point at `$5000` and `$5800`, are dead** — a relief,
  since those addresses hold code and text. The bank changes exactly three times
  in 42 zones.
- The slot count (offset +155) is 8 in 41 zones and 6 in zone 6. That bounds
  `FindFreeObjectSlot` to slots 2-7, which is what proved amber's finding that
  the sprite multiplexer never actually runs.

### $A000-$BFFF is not data. It is BASIC ROM showing through.

`$8D1D` is `INC $24 / LDX $24 / LDA $A000,X / RTS`, with eleven callers, and
`$50BD` reads the same table. `$A000-$BFFF` in the image is 8192 bytes of zero —
I profiled every page. If that read RAM the generator would return zero for ever
and all eleven callers would take the same branch every time.

**Nothing in this program writes `$00` or `$01`.** I searched: zero instructions
touch the processor port. So the 6510 keeps its power-on `$37` and BASIC ROM is
banked in. The game's random number generator is a byte of BASIC ROM.

Two consequences worth stating. It is perfectly deterministic — same `$24`, same
byte, every machine, every run — so a wave is reproducible. And **re64 cannot
model it**: memory is flat, a layer supplying `$A000` wins, and no ROM image is
loaded, so every tool will answer with zeros here for ever. I could only record
it in prose and declare the span so it stops counting as unexplained.

The landscape is generated from it: `$8EB9` is `NextRandom AND #$07 ORA #$01`
choosing the next hill.

### Smaller things

- **`$C023` / `$C046` are a self-modifying-code pair.** `$C023` pokes `DEC`,
  `STA`, `INC` opcodes into seven sites in `$9C00-$9FFF`; `$C046` pokes `LDA`
  into the same seven. One routine driven in write mode and read mode. `$C046`
  was sitting as data; marking it recovered exactly the 10 instructions the byte
  reading predicted.
- **The starfield** (`$8FB0`/`$8FD2`): twelve stars, each cycling its character
  down `$1F` to `$1B` in place before moving one column left and wrapping at 39.
- **The terrain** (`$8D2F`): six characters written to `$0657, $067F, $06A7,
  $06CF, $06F7, $071F` — forty apart, so one vertical column, rows 14-19 of
  column 39. New ground arrives at the right edge. `$8DF4`/`$8E24` are hill
  profiles, six bytes per frame; `$26` rising slope, `$28` solid, `$27` falling.
- **The `JMP ($0002)` at `$994C`** hid 103 instructions. The table at `$9933` has
  three entries and entry 0 points at the `$60` immediately *after* the table — a
  table byte doubling as an RTS, so "movement type 0" costs no code.
- **The two movement handlers read the same fields differently.** Handler 1
  treats `objSpeedX` as a *countdown*, so a bigger number is a slower object;
  handler 2 treats it as a per-frame step with `objSpeedY` as a gravity-
  accelerated velocity. Anyone naming those fields with one meaning is wrong half
  the time.
- **`$985E` does `PLA PLA RTS`** when it cannot find the object to spawn relative
  to — unwinding two levels to cancel the spawn. Any call graph through
  `PlaceNewObject` is wrong about it.
- **The player is a camel** and I drew it: block `$C0` at `$3000`, leap frames
  `$CD-$D2`. Slot 0 in both the object arrays and the sprite arrays, which is what
  `loc_5049` compares every creature against when it turns them to face you.

### What I could not settle

- Which of `objField40`/`objField50` semantics apply under handler 2 — I named
  them from handler 1's use and said so.
- Virtual sprite slots 8-15 are updated by `$98A9` but never allocated. amber
  established they are dead; I have not established what the code *intended*.
- `$87D0-$87FD` is 32 zeros then 14 `$EA`. I called it padding. It could be a
  removed routine.

---

## What fought me

### 1. `set_labels` silently destroyed another author's work

This is the one that matters and it is not close.

basalt had labelled all 42 zone-record starts `waveNN_<Name>`. I then labelled the
same 42 addresses. **41 of their names were gone and neither of us was told.** The
reply was `"ok": true`, `delta: 0`, and 42 lines reading `set $6700 to zone00` —
which is byte-for-byte the shape of a successful creation. basalt only found out
by going back to tidy up.

`add_comment`'s description says, in as many words, "This never overwrites
anybody, including you." `set_label` is the exact opposite and says nothing. On a
document whose premise is several writers, that asymmetry is a trap, and it is
worse in a batch: one call, forty-two silent overwrites, one `ok`.

The fix is not to refuse — `add_label` already exists for the two-names case, and
sometimes you really do want to rename. The fix is for the *result* to say
`renamed 41, created 1`, and to name who owned the 41.

### 2. Extents are writable and unreadable

`list_labels` never reports `extent`. Not once, for any label, in any query I
made — I checked deliberately after I got suspicious.

An extent silently changes how **every operand in its range** renders. amber's
`spriteSet1` at `$1800` carried a 2K one, so `$1E28` — the per-type score table —
rendered as `spriteSet1 + $0628`, and `$1DD8`, the ninth template table, rendered
as `spriteSet1 + $05D8` and was invisible as a table at all until I chased it. I
only noticed because a *variable* address came out looking like sprite data.

So: a property that reshapes the whole listing, set by any writer, visible from no
read tool. I found it by accident and fixed it by guessing a length. amber
independently reported the same problem, blaming me for a label that was theirs —
which is precisely what happens when nobody can see who set what.

### 3. Every write is batched except regions

`set_labels`, `add_comments`, `set_constants`, `bind_constants` all exist.
`set_regions` does not. I declared ten regions one call at a time, each with a
long comment, and the shape of the work — "here is the map of 18KB, in six
pieces" — is exactly the shape a batch is for. I called `set_regions` once with
the name I wanted: `Tool set_regions not found`.

### 4. Nothing tells you a comment is already there

All three of us wrote a long, careful, near-identical comment at `$6700`. Mine was
the third. The listing there now carries three overlapping essays about the same
200-byte stride before it reaches a byte of data.

`add_comment` is right not to overwrite. But the write returns nothing about what
is already at that address, and the only way to find out is `list_comments` over
the whole project and grep. One line in the result — `2 comments already at
$6700` — would have stopped all three of us duplicating the single most expensive
analysis in the run.

### 5. A warning that cannot be discharged

`$994C: jumps through $0002` was the most useful line `list_warnings` produced —
it pointed straight at 103 hidden instructions. I marked both jump targets,
declared the jumptable region, and named the dispatcher. The warning is still
there, verbatim, indistinguishable from the day it appeared.

So `list_warnings` cannot be used as a work queue, which is what a list of ten
items obviously wants to be. `find_undecoded` shrinks as you work and is excellent
for exactly this reason.

### 6. Small friction, itemised

- `find_references` takes `direction: "in"|"out"|"both"` while its description
  says "Inbound entries carry the calling line". I passed `"inbound"` and lost a
  call to a validation error.
- `post_message` caps at 2000 characters and refuses rather than truncating. Three
  of my messages had to be split and re-sent; on a chat that is the coordination
  channel, that is friction at exactly the wrong moment.
- `set_region` with `kind: "jumptable"` refused a 7-byte span and **told me
  precisely what I meant** — "did you mean end $9939 (3 entries) or $993B (4
  entries)?". That is the best error message in the tool set and worth copying
  everywhere.

### 7. The flat memory model has no way to say "ROM is here"

Covered above under `$A000`. Recording it needs prose because the model cannot
hold it: a project layer supplying an address always wins, and there is no ROM
image. It is the overlay problem in a different costume — same address, same
instant, different contents depending on a register nothing models.

---

## What worked, since that changes software too

**`run_decoder` is the best tool here and its description undersells it.** It is
documented as a graphics tool. I used it as *"run arbitrary code over these bytes
and give me the answer"*, and it carried most of this report:

- a per-page byte profiler that found 8KB of zeros in one call and settled the ROM
  question;
- a wave-record decoder that produced all 42 titles and their parameters at once,
  which is what proved the zone table;
- a template matrix printer, one call per zone, that validated all nineteen field
  names simultaneously;
- a sprite-block usage map across all 42 x 8 templates, which caught my own
  charset error.

`read_bytes` would have cost tens of thousands of tokens of hex for the same
answers. The `{kind:"text", lines}` return is the whole reason: an agent's
"decoder" is usually an *analyser*, and the sandbox happens to be the right place
to run one.

**Bitmap regions render in the listing and it is delightful.** `export_listing` at
`$3000` draws the camel, in text art, in the middle of a disassembly. That is the
single most convincing thing in the project — you cannot argue with it — and it is
what let me correct the charset boundary and identify the player.

**Collaboration worked where the tools let it.** amber picked up my `$C023`
self-modifying-code finding and used it to explain the neutronium bar. basalt's
`PrintCharAt` unlocked the terrain. amber's leftover assembler source named
`NEXINI` — which is the `$6700 + 200n` pointer arithmetic I had just derived from
the other end. amber corrected my multiplexer claim with evidence I could check,
and I recorded the correction beside the original rather than editing it away. All
of that went through chat, and all of it held.
