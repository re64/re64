# Editorial notes

Written from the editor's chair: what I asked for, what I could not get, what I had
to build, and how much I could trust what came back.

---

## 1. The thing that shaped the whole run

**The readers found a memo from a previous experiment on the same binary, in the
repository, within ninety seconds of starting.** `assets/mutant-camels/mutant-camel-story.md`
is 249 lines of prior findings by three earlier readers, and reader two flagged it
in chat before doing anything else — which was the right call, and I said so.

But it changed my job completely. Almost every big finding was already written down.
So the editorial standard I set in the second message was:

> Anything already in that memo is not news unless you can **show** it to me. A
> sentence I cannot photograph, play, or watch happen is the weakest thing I can print.

That turned out to be the single most productive instruction I gave, and it is
worth generalising. **Asking for evidence rather than facts is what produced the
new material.** Every genuinely new thing in the article came from somebody being
made to demonstrate a claim rather than restate it:

- the orphan tune turned out to be a **duplicate**, not a lost arrangement, because
  I went to compare the bytes rather than accept "unreachable music";
- the cheat turned out to be **OATS**, not GOATS, because reader two stepped the
  routine with `run_block` instead of reading it;
- the sprite bank duplicate, the zone-7 cycle, the payphone and the fuel gauge made
  of H's are all new, and all came out of "show me".

A run whose brief is *coverage* produces a memo. A run whose brief is *an article*
produces pictures. Those are different work and they find different things.

---

## 2. What I asked for: one thing that arrived, two that did not

**A screenshot with the camel in it — since fixed, and the fix is the finding.**
For most of this run the `screen`/`frames` capture rendered characters and
background but **not hardware sprites**. I did not find that in any documentation;
I found it by taking forty screenshots of a game whose main character was invisible
in all of them, and confirmed it with a control experiment — poke a filled sprite
into RAM, enable it, set its colour, run thirty frames; the background changes and
the sprite never appears.

**The emulator now draws sprites, and every image in the article is a true capture.**
The same control scenario, re-run against the rebuilt server, now returns exactly
504 pixels of the sprite colour — 24 × 21, the whole sprite. So this belongs under
"what it cost", not under "what is missing". What it cost was about ninety minutes
and a wrong picture, and the wrong picture is worth keeping a record of.

*What I did in the meantime.* I stopped trying to photograph sprites and
reconstructed them. Reader one's trace of the sprite multiplexer gave the addresses
of the game's own object table — X, Y, colour and sprite pointer per slot, at
`$1F40`, `$1F50`, `$1F60`, `$1F70`. So: `capture: screen` and `capture: ram` over
that table as two consecutive steps with no run between them, then draw each slot's
sprite at `(X−24, Y−50)` in its own colour.

*And it was wrong in two ways, one of which I would never have found.* Setting the
reconstruction beside the real capture of the same frame:

| | reconstruction | capture |
|---|---|---|
| sprite pointer | correct, all eight | — |
| Y position | correct, exactly | — |
| colour | correct, exactly | — |
| X position | correct **modulo 256** | five of eight were 256px to the left |
| size | always 24 × 21 | camel 46 × 42; four birds 48 wide |

Measured properly, by finding every sprite in the capture and comparing it with what
I had predicted: **Y was exact for all eight slots**, colour and sprite pointer were
exact for all eight, X was exact for three and off by exactly 256 for the other
five, and the sizes were wrong for the camel and for the four birds. The camel's
top-left corner in my reconstruction was at (160, 150); in the capture it is at
(160, 150), at 46 × 42 pixels instead of 24 × 21. So the object-table reading was
right. What it could not contain was **three video-chip registers that are not
in the table**: the ninth bit of X in `$D010`, and the expansion bits in `$D01D`
and `$D017`. My picture had the right objects in the right order at the right
heights and got their widths and a third of their horizontal positions wrong.

**That is the exact failure mode this project's own brief warns about**, and it is
worth quoting against myself: *a confident wrong answer is worse than a gap.* My
composite was captioned honestly — it said it was a composite and said how it was
made — and it was still the most misleading thing in the article, because it was
*almost* right. Nobody checks an image that looks correct. A visibly broken picture
would have cost less.

**And chasing the discrepancy found something real.** Asking *why* the camel was
double-size sent me to `$D01D`/`$D017`, and from there to `LoadZoneScalars` at
`$9CB5`, which writes them — from the zone record. Three of the eight per-zone
scalars nobody had decoded turn out to be bitmasks over the eight creature types:
`+$98` multicolour, `+$99` double height, `+$9A` double width, ORed into the
registers as each creature spawns. Zone 1's `+$9A` is `$63`, and bits 0, 1, 5 and 6
of zone 1 are the birds — which is why the birds are twice as wide. Zone 12's `+$98`
is `$55`, bit 0 set, and type 0 of zone 12 is the Pac-Man ghosts — which upgrades my
"they only read correctly in multicolour" from an observation about how they look
into a fact stated by the data. And the same routine fetches the eighth scalar and
overwrites it on the next instruction, which makes "somebody reserved a byte and
never used it" into something much better: it is read once a wave and dropped.

None of that would have been found if the picture had been right the first time.
That is not an argument for shipping broken renderers; it is an argument for
**putting the reconstruction and the capture side by side**, which is a thing this
tool could do for anybody and currently does for nobody.

*One thing survived the correction intact, and it is the best moment of the run.*
From the zone record alone I worked out that sprite `$9D` — a weight with
<i>16 TONS</i> lettered on it — is creature type 4 of zone 1. I had no picture of
zone 1 at the time and no way to check. Both the reconstruction and, afterwards,
the true capture show it there. Predict from the data, then photograph it: that
loop is only available because the machine and the model are the same project, and
it is the strongest thing this tool did all day. It is also the answer to the
question the correction raises — how do you know a picture is right? You do not
check the picture. You predict it first.

**Two more corrections, both from the person who commissioned the piece, both found
by looking at the running game rather than at the file.** They are worth recording
together because they are the same failure: I published two things that were
plausible and unchecked, and in both cases the check was available.

*The title letters were rendered hires, and they are multicolour.* This is the
**same trap as the ghosts, in the other direction.** With the ghosts I tried hires,
saw vertical stripes, recognised the signature of a wrongly-decoded multicolour
sprite, and switched. With `REVENGE` I tried hires, it looked like letters, and I
stopped. Looking like letters is not evidence: a multicolour sprite read as hires
still resolves into a legible shape, just a ragged one at twice the width. Two
things would have caught it and I did neither — comparing the plate against the
screenshot on the same page, and reading `$D01C`, which the title setup sets to
`$1E` twelve instructions before it sets the sprite pointers.

Chasing it produced the best small find of the whole run. `$D01C = $1E` puts sprites
1–4 in multicolour; the letters use only two of the three available colours, one of
which is `$D025`; and the title-screen loop is five instructions long and spends one
of them on `INC $D025`. It is a fake raster bar built out of a single increment, and
it is only visible with the machine running. The numbers close exactly: 138 bit-pairs
of one colour and 77 of the other in the sprite data, ×8 for multicolour-plus-both-
expansions, giving 1,104 and 616 — and eighteen consecutive captured frames show
1,104 pixels of yellow that never move and 616 pixels that change colour every frame.

*The audio was seven times too fast.* My synthesiser read `(ticks, note)` pairs and
treated a tick as one video frame, because that is what the format looks like. It
is not. The player runs on the raster interrupt, but it counts down a divider first
and only advances the music when the divider reaches zero — and the divider is `$11`,
which holds **7**. Written once in the entire program at `$88C2`, read in exactly one
place at `$8907`. So a tick is 140ms, the title tune is eighty-nine seconds rather
than twelve and a half, and everything I had rendered was a burst of clicks.

The instructive part is that **I had the evidence to catch this from the start and
used it for something else.** I captured the SID writes with cycle timestamps, and I
used them to check the *pitches* — which matched, so I declared the section proved
and moved on. The same log had the durations in it. The first note is held for
275,184 cycles, which is 13.97 frames, against the 2 the stream says: the ratio is
sitting there in the first two rows of a log I had already downloaded.

Both tracks are now rendered from the capture instead of from my reading of the
format: pitches from the frequency registers, note lengths from the gaps between
gate-on and gate-off, envelope from the ADSR registers the game programmed. Only the
waveshape is invented. That is the same move as retiring the sprite compositor, and
it points at a rule worth stating plainly:

> **Where a log of what the machine did exists, render from the log, not from your
> reading of the data.** Reading the data is a hypothesis. The log is the answer,
> and this project can produce one for both pictures and sound.

**Keyboard input.** `input` drives a joystick only. There is no way to type. That
cost me the two most cinematic shots in the piece: typing OATS and watching the
banner appear, and pressing F1 on the options screen. I got the cheat banner by
forcing the flag byte instead, which is honest but is a re-enactment rather than a
photograph, and I said so in the caption. Reader one lost a whole line of work to
the same gap trying to trigger the zone-skip half of the cheat.

*What I wanted:* an `input` step with `keys`, or a way to write to `$DC00`/`$DC01`.

**Audio out of the machine.** `capture: sid` gives a JSON array of
`{cycle, register, value}`, which is exactly the right primitive and I am glad it
is a log rather than a rendering. But there is no path from it to something a
reader can listen to. I wrote a synthesiser (below). The captured log was still
decisive — it is what proved the note table, the streams and the actual playback
all agree — so this is a "last mile" gap, not a missing capability.

**A live confirmation of the second half of the cheat.** Read-traced by reader one,
disputed by reader two, and I resolved half of it live: with cheat mode on and a
key held, the game really does write the key code into `$46` (I watched it land).
The zone still never advances. That is in the article as an unresolved thing,
which I think is the right outcome — but it is the one place where I would have
liked another hour.

---

## 3. What I had to build

All of it in `work/`, all of it small, none of it interesting except as a list of
things that were missing:

| Built | Why |
|---|---|
| `png.py` | A PNG writer (zlib + struct). There is no image library on this machine, and every capture is JSON palette indices. ~40 lines. |
| `spr.py` | A C64 sprite renderer — 24×21, 3 bytes a row, hires and multicolour — plus a contact-sheet layout, which is how the whole sprite library was found. |
| a charset renderer | 8×8 glyph grid with a highlight, for the font figure. |
| `synth.py` | A square-wave synthesiser: reads the game's own note table at `$898C`/`$89CD`, converts the `(ticks, note)` streams to samples, mixes three voices, writes an 8-bit WAV. This is what makes the article playable. |
| a music-stream scanner | Finds `(ticks, note)` streams by shape and finds their `$FF` terminators. This is how the fourth stream and its duplicate were found. |
| a zone-table decoder | Screen-code → text, record striding, the 19-column field layout, and the per-zone transformation graph with cycle detection. |
| a duplicate-block detector | Hashing 256-byte windows across the image. Found the sprite bank in one call. |
| a contact-sheet builder | 80 captured frames at thumbnail size on one plate, so I could pick the good ones by eye instead of rendering them one at a time. Used three times over, and again after the emulator gained sprites, when every frame had to be looked at afresh. |
| a sprite compositor | Now retired. It drew the game's object table over a captured screen, and it is described above, including the two ways it was wrong. |
| `build.py` | Inlines images and audio as data URIs into a template. |

**The single most productive thing I built was a contact sheet of 112 consecutive
64-byte blocks rendered as sprites.** It took ten minutes to write, five seconds to
run, and it is where the camel walk cycle, the author's signature, the sixteen-ton
weight, the payphone, the Pac-Man ghosts and the peace symbol all came from. None
of them was reachable through any tool on the surface. And once the sprite
*numbers* in the zone records could be looked at as pictures, a whole layer of the
game opened up — zone 12 is called *Inky, Pinky, Blinky, and Thud!* and contains
actual Pac-Man ghosts; zone 6 is called *This Kiosk Is A Nuclear Free Zone* and
four of its eight creature types are a CND peace symbol. The joke is in the data,
and you cannot see it without a renderer.

There is a trap in that, and it cost me a wrong reading before I caught it: the
ghosts are **multicolour** sprites — twelve pixels wide, bit pairs — and rendering
them as hires gives vertical stripes. Which mode a sprite uses is a per-sprite bit
in `$D01C`, decided at run time, so it is not in the data at all. A renderer has to
offer both and let the reader pick, which is exactly what "slide the width until an
image appears" already means for bitmaps.

**The tool I most wanted and does not exist: a picture.** re64 can render bitmaps
and character sets into a listing as text art, but there is no way to get an
*image* out of it — not a sprite, not a charset, not a screen capture. Everything
visual in this article was rendered by code I wrote in the first hour. Every one
of the three readers in the previous experiment on this binary reportedly wrote
their own bitmap printer too. That is four independent implementations of the same
missing feature.

Concretely, the four calls I kept reaching for:

- `render_sprites(from, to)` → an image (or a base64 PNG), given a range and a mode
- `render_charset(address)` → the same for an 8×8 font
- `capture: screen` returning a PNG as well as indices
- `play_sid(capture)` → a WAV, from a SID write log

The first two are not analysis; they are the *only* way to answer "what is this
data". I found the sprite library by rendering 112 consecutive 64-byte blocks and
looking at them. Nothing in the tool surface does that, and it took ten minutes to
write and five seconds to run.

**One more, smaller:** `export_listing` ignored my `start` and `end` arguments and
returned a single row at an unrelated address every time, whatever I passed
(`"$C000"`, `49152`). `read_disassembly` with `start` worked fine, so I used that
throughout and did not chase it.

---

## 4. Where the analysis was strong, and where it was thin

**Strong.**

- *Method discipline.* Both readers volunteered how they knew things without being
  asked twice, distinguished "read" from "ran", and — crucially — **flagged their
  own uncertainty in the right places**. Reader one's message about the
  multiplexer is a model: "no direct writer, no observed writes in play, a slot
  allocator that cannot reach those slots — but writes through a pointer cannot be
  ruled out." That paragraph went into the article almost verbatim as a
  "how firm this one is" box, because it is better than anything I would have
  written.
- *Self-correction.* Reader one corrected the memo's claim that both bullet
  collision gates were stubbed (only one is; the other is a real if oddly written
  test) — unprompted, and against a source they had every reason to trust. Reader
  two corrected GOATS to OATS by stepping the routine.
- *Independent convergence.* Both readers arrived at `FindFreeObjectSlot` for
  `$9735` separately, one from the data side and one from the code side. That is
  worth more than either finding alone and they noticed it themselves.
- *Running things.* Reader two's playback of the unreachable music stream through
  the game's own interrupt-driven player is the best single piece of work in the
  run. It converts "these bytes look like music" into "the machine played them and
  here is every write it made".

**Thin.**

- *Anything requiring live gameplay.* Neither reader had a working
  boot-and-play recipe until I posted mine, and one of them burned a line of
  enquiry on a game that had never actually started (the PC kept returning to a
  wait loop). A shared "how to get into a zone" recipe would have paid for itself
  five times.
- *The visual layer, entirely.* Neither reader rendered a sprite, a glyph or a
  screen. They named creature types by sprite *number*. I named them by looking at
  them. Zone 10's creature is a payphone; nobody knew that until it was drawn. This
  is not a failure of curiosity — there is nothing on the tool surface that would
  have let them, and all three readers of the previous run hit the same wall and
  wrote their own printers. It is the clearest capability gap the run produced.
- *Prose for a reader.* When I asked for "one sentence per type saying what a
  player would call it", what came back was still addresses and lifetimes. That is
  not a criticism of the analysis — it is the right output for a disassembly — but
  it means the *translation* step is entirely the editor's, and it is most of the
  work.

---

## 5. Could I tell how much to trust a claim?

**Partly, and the part that worked was not the part built for it.**

What actually told me how much to trust something, in descending order of value:

1. **The chat.** Every useful trust signal came from prose in `read_messages`:
   "verified two ways", "I could not get live confirmation", "flagging, not
   claiming", "that is a guess about intent, not something the code can confirm".
   Both readers were scrupulous about this, and it is why I could grade claims at
   all.
2. **Whether the claim named a single call I could re-run.** "One call settles it:
   `read_disassembly` at `$C000` shows the identical `CMP #$50` twice" is a claim I
   can check in ten seconds. That phrasing came from my asking for it, not from
   any field.
3. **Whether I could re-derive it myself.** In practice I re-derived nearly
   everything that went into the article, because reading the bytes with a script
   was usually faster than asking. That is a healthy sign about the *data* and a
   bad sign about the *reporting path*.

What did **not** tell me: `method` on a claim, which I never once read. I asked for
it explicitly in my second message and then never consulted it, because by the time
I needed to grade something I was reading the chat, not the claim list. `method` is
a per-address field and my questions were never about an address; they were about a
sentence somebody wrote.

**What would have told me faster.** One thing, and it is small:

> **A claim should be able to carry the call that reproduces it.**

Not "how I know" as a category (`read`, `ran`, `guessed`) but the literal
invocation: the tool, the arguments, and what it returned. Then an editor can
re-run the evidence for a claim without asking anybody, and "verified" stops being
a word somebody typed and becomes something I can execute. Every time I got that in
chat — reader two's `scn_9pffxy` and its capture URL, reader one's "read_bytes at
$87A8" — the claim went straight into the piece. Every time I did not, I re-derived
it myself, which took longer than either of us would have liked.

The second thing, and it is bigger:

> **There was nowhere to record a disagreement, and one of the two best moments in
> the run was a disagreement.**

Reader two said nothing reads `$46` back. Reader one said `$9468` reads it and
jumps into the zone-transition code. Both were being careful; they were looking at
different halves of the same mechanism. I only found out because they each said so
in chat and I happened to read both messages. There is no object in the document
that says *these two claims are about the same thing and they conflict* — and that
conflict was worth a paragraph of the article, because resolving it half-way (the
write fires; the skip does not) is more interesting than either position.

---

## 6. The audit that never came back

Late in the run I did the thing an editor is supposed to do: I asked the readers to
check **my** work. Four of the article's claims were mine — derived by reading bytes
in a script — and nobody had audited them. I asked for two of them to be checked,
twice at length and once cut down to two yes/no questions with nothing else in the
message.

Neither answer arrived. Both readers stayed online and both went silent after 09:52,
having answered everything I asked *of the program* and nothing I asked *of me*.

I do not think this is carelessness, and it is worth recording as a shape rather
than a complaint. Everything a reader was rewarded for in this run pointed at the
binary. "Go and check whether the editor read those 208 bytes correctly" is work
with no new territory in it, and it produces a claim that already exists. There was
also no object to attach it to: `add_evidence` can support or refute *a claim in the
document*, and my four claims were in chat, in my head and in a draft they could
not see.

I verified both myself, twice, with independent scripts, and the article stands. But
the general point holds: **the flow of trust in this run was entirely one-way.** The
readers reported to the editor, and there was no mechanism, and apparently no
instinct, for it to run back the other way. If a future run wants the editor's own
work checked, the article has to be *in* the shared document, not in a file only the
editor can see.

## 7. The restart gave me somebody else's name

Recording this because it happened to me while writing these notes, and because it
is a defect in a rule the project got right on purpose.

The server was rebuilt and restarted to add sprite rendering. My scenarios, claims
and captures all survived — that part worked exactly as advertised. But my session
was re-issued with a new id, and the codename generator handed me **`basalt`**,
which is reader one's codename, and reader one was still online. Two messages I
posted about my own work are recorded in the project chat as having been said by
another participant. `whoami` confirms the split: `userId: "ed"`, session
`ses_mtr40om93`, codename `basalt`.

The user id was right throughout, so nothing is *wrong* in the ops log. What is
wrong is the chat, and it is wrong for a reason the design chose deliberately: a
message records how its author was named **at the time**, rather than resolving the
name on read, because a log should say who spoke then. That is the right rule. It
assumes a codename identifies one participant, and across a restart it does not.

Two things would fix it and they are different sizes. The small one: do not issue a
codename that a currently-online participant already holds. The larger one: a
codename is a per-session display name, and if it can be reused it cannot also be
the thing a permanent log is keyed on — the log should carry the session id beside
it, so that a name collision is recoverable rather than silent.

I posted a correction into the chat, which is the only repair available from where
I sit, and it too is signed `basalt`.

## 8. Two smaller things worth recording

**I changed the project to do my job, and I think that was right.** The emulator
could not boot the game at all — 500 frames of black screen — because a hardware
interrupt vectored through `$FFFE`, which read as zero with no ROM present. The
fix was to upload the KERNAL and BASIC ROMs as byte layers and make a third target,
`machine`, stacking them over the runtime image the way a 6510 sees memory at
power-on. That took ten minutes and unlocked every screenshot in the article — and
as a side effect it turned the memo's prose-only claim that the RNG reads BASIC ROM
into something either reader could check with `read_bytes`, which one of them
immediately did.

Note that `add_rom_layer` — the tool that exists for exactly this — was **not**
sufficient: a `reference: true` ROM layer is invisible to the machine, so the boot
still failed. That distinction is not documented anywhere I could see, and I only
worked it out by writing a nine-instruction test program into memory with a `set`
step and reading back what `$A000`, `$E000` and `$FFFE` contained.

**Nobody used the target argument until I made a target.** Three targets existed at
the end (`loader`, `runtime`, `machine`) and the readers immediately started
passing `target: machine` for anything touching ROM. With one target it is noise;
with three it is necessary, and the habit formed instantly.

---

## 9. If this were run again

- Give the editor the boot recipe, or make the readers produce one in the first ten
  minutes. Everything visual depends on it and everyone rediscovered it separately.
- Ship a picture renderer for *data*. Capture now draws sprites, which fixed the
  screenshots; it does not help you look at sprite `$E5` sitting in the file and see
  a payphone. Those are different needs and only one of them is met.
- When a renderer is missing and somebody reconstructs one, give them a way to
  **diff the reconstruction against the truth**. Mine agreed with the capture on
  pointer, colour and Y, and disagreed on width and on five of eight X positions,
  and I could not have known which without the comparison.
- Three of my four mistakes in this run were **a plausible reading of the data,
  published without checking it against the machine** — sprite positions, sprite
  colour mode, and note durations. In all three cases the machine could have been
  asked, cheaply, and in two of them I had already captured the answer and used it
  for something else. Anything derived from a format should be checked against a run
  before it is printed.
- Keep the prior memo. It did not spoil the run; it raised the floor and forced the
  interesting question, which was *what can you show me that this does not already
  say*. Three of the article's best findings are corrections to it.
