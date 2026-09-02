# Gridrunner: the story the code tells

A working memo, not a listing. The project file holds what every byte *is*; this
holds what is worth **saying about it** — the findings that would carry a
published piece, and the shape that piece wants to take.

It exists because the interesting material is currently scattered across four
experiment reports and several hundred comments, and because a comment saying
"this is a bug from 1982" is stored identically to one saying "increments the
counter". Nothing can be asked for the story yet. Until it can, it is written
down here by hand.

Everything below came out of agents reading the binary, most of it unprompted.
Sources: `experiments/03-collaboration/run1/`, `experiments/04-improvement/run1/`.
Claims marked **verified** were checked against the bytes independently.

## The direction

Not a disassembly. A **publishable piece of software archaeology** — the story a
1982 cartridge tells about how it was built, what its author got wrong, and what
was left behind in it. Easter eggs, bugs, dead code, oddities: the things that
say something about the history of the code rather than about its function.

Two consequences that should shape what gets built:

- **Curation is the missing skill, not exhaustiveness.** Every run so far drove
  toward *0 unexplained bytes of 4096*, because every brief rewarded that. A
  piece needs the opposite: discard 95%, keep the 5% that carries a thesis. The
  persona that is missing is not another worker; it is an **editor**, scored on
  what it leaves out.
- **Narrative is not an annotation.** A comment is about an address. A paragraph
  of a piece is about the program, and its introduction belongs to no address at
  all. It also collides with a settled decision: comments are hard-wrapped at
  column 100 *in the model*, because the CLI needs real rows and the arrow gutter
  is per-row. Markdown must not be hard-wrapped. So this is a new object, not a
  `format:` flag on comments.

## The findings, as story beats

### The header was written over something

`$8000-$8008` is a CBM80 cartridge autostart header — `C3 C2 CD 38 30`, the
signature, with cold and warm vectors at `$83C1` and `$83E2`. **Verified.**

The eight bytes at `$8009-$8010` are read by nothing. The last three, `CA D0 F1`,
decode as `DEX / BNE -15`, and the displacement resolves to `$8002`: it is the
stranded tail of the character-set copy loop, which the header was written over.
A fossil of an earlier build, sitting in the first sixteen bytes of the file.

### A bug that shipped, in the score

`IncrementPlayerScore` propagates carry with `DEX / BNE`. `DEX` from 1 sets Z, so
the loop exits before it can touch `$040F`. Seven digits are displayed, zeroed
and compared against the high score; only six can ever be non-zero. **Verified.**

The reference disassembly by a human reverse engineer does not remark on it.

### Every subtraction in the game is one out

Six `SBC` sites, and every one is preceded by `CLC`. There is not a single
`SEC/SBC` in the whole 4K. On a 6502 that means each result is one less than
intended. All six are inside visual or volume effects — a materialise geometry,
a fade ramp — where being one out is invisible, which is presumably why it
survived. Demonstrated by running the block: with `fxCounter=$0F`, `plotCol`
comes out `$04` where `$14-$0F` is `$05`.

### Thirty-one levels, not thirty-two

The level cap makes the last entry of the level tables unreachable. Somebody
wrote a table with 32 rows and a comparison that stops at 31.

Two rows are outliers: level 13 is 16 squads of 3 among neighbours of 5-6, and
level 29 is 7 squads of 3 among neighbours of 20+. Level 13 has *both* numbers
jump at once, which is the shape of a transposed byte pair — and is also a
perfectly reasonable boss level. **Unsettled, and honestly so.** An emulator or a
second dump decides it; reading does not.

### Nothing in this game is random

Exactly two instructions in the cartridge read the I/O page, and both are the
joystick. `$D41B`, the SID oscillator that every C64 program of the era used as
its random source, is never read. No raster line, no CIA timer, no jiffy clock.

Same level plus same inputs produces an identical game, every time. Spawn
positions are constants, wave sizes are a table, the zappers are periodic.

### The game manufactures its own enemies

The mechanic the whole thing turns on, and it took three readings to see. There
are two enemy types with completely different representations:

- **Chain droids** live in arrays and move as snakes. Shooting the middle of a
  chain *splits* it into two chains rather than shortening it.
- **Pods** exist *only as characters on the screen*. No array, no coordinates, no
  id. A scan of screen memory finds them and advances each one a frame.

And the connection: glyph `$0F` — a pod, four frames from hatching — is written
by exactly **two** instructions in the whole cartridge. One at the cell where the
two zapper beams cross. One at the cell of a chain droid you just shot.

So killing a droid leaves a pod, and the zappers manufacture pods every time they
fire. The game gets harder by making more work than you remove, and the level
parameter that changes fastest is how often the zappers fire.

### The picture is the game state

No sprites at all. `$D015` is never written. Every object is a character, plotted
through one primitive with 35 callers, and collision detection is *reading the
character already in the target cell*. The score, the high score and the lives
are literally digit characters sitting in screen RAM.

### A font with no C, K, Q, W, X or Z

The cartridge ships its own 64-glyph character set and copies it to `$2000`
before anything else. The alphabet is hand-packed in the order the game's own
strings need — `$21`=G, `$22`=R, `$23`=U, `$24`=I, `$25`=D — so PETSCII and
screen codes both render every string as garbage.

`$30` is one glyph doing duty as both the letter O and the digit 0, which is why
"PRESS FIRE TO BEGIN" and a seven-digit score are made of the same byte value.
Six letters of the alphabet simply do not exist in the font.

Four of the 64 glyphs are dead art: `$0B`/`$0C` are an exact mirrored pair that
nothing loads, `$1C` is byte-identical to the `Y` glyph and unused, `$1F` is an
arrow nothing draws.

### The sound is what it does not write

66 stores into the SID, and the registers it *never* touches are the story: no
frequency low byte on any voice, no pulse width, no filter at all. Pitch is the
high byte only — 256 coarse steps. Two voices are noise with one envelope set at
boot and never changed; one voice is pitched.

The nicest detail in the program: the grid-wipe delay loop writes the voice-1
pitch from the column counter, 251 times. Its entire purpose is timing, and the
sound sweeping across with the picture is a side effect of the delay.

### It runs with the KERNAL interrupt underneath it

The game installs no interrupt of its own — `$0314` and `$D01A` are never
written — but it is not running with interrupts off either: `SEI`, then `RESTOR`,
then `CLI`. The ordinary 60Hz KERNAL IRQ runs underneath the whole game, and it
is the only reason the keyboard buffer is up to date, which is the only reason
the P-key pause works, since nothing in the game scans the keyboard.

Pacing is two free-running counters that different subsystems test at *different
values*: `CMP #$05 / BEQ` at the head of a routine is a time slot, not a magic
number.

## What this needs before it can be published from re64

- **A way to mark a finding as notable.** `kind` on a comment — `bug`,
  `dead-code`, `oddity`, `history` — so the story is a query rather than a
  re-read. Same shape as `placement` on a comment and `type` on a label, and it
  is a question about programs rather than about this one.
- **A narrative object**, unwrapped and rendered as markdown, that may sit
  between code or belong to no address at all.
- **A real renderer for the pictures.** `bitmap-view.ts` returns palette indices
  rather than pictures precisely so each consumer paints its own way, so a canvas
  for a published page is a new consumer of an existing contract.
- **An editor persona**, scored on what it discards.
