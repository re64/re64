# Running it: bytes, ROMs and targets

Executing the program's own code, learning the machine's defaults from its own ROM, decoders, and the layer stack a target arranges.

> **History, not reference.** Each entry is a decision with the bug that produced
> it. Entries are accurate as of when they were written and are **append-only**:
> a superseded decision keeps its text and gains a note pointing forward, because
> the value of a corrected decision is the correction. For what is true *now*, see
> `docs/model.md`, `docs/algebra.md`, `docs/api.md` and `docs/developer-guide.md`.

---

## Decoders somebody else wrote

The escape hatch that stops this growing a mechanism per oddity. A character set
is a permutation and a sprite is a bitmap — both built in — but a title screen
packed with run-length encoding and partial frame updates is *assembler logic*,
and the only honest way to express that is code. A decoder is a way for a reverse
engineer to say it in a modern language.

**A decoder is a pure function from bytes to data**, never to a picture and never
to markup. That is what lets one serve the browser, the CLI and an agent at once,
and it is also the whole of the safety story: a function that can only return
numbers cannot inject anything, whatever it does inside. A bitmap comes back to
an agent drawn as text, because the caller may be something that cannot look at
pixels.

**Two mechanisms, because neither is sufficient alone.** SES removes the
*authority* to have side effects — a `Compartment` has no ambient globals, and
`lockdown()` freezes the intrinsics so one decoder cannot poison another. A
worker thread supplies the one thing SES cannot: an infinite loop is not a
permissions problem and no compartment can interrupt one. The thread also keeps
`lockdown()` off the main realm, which matters because hardening intrinsics is
process-wide and the server shares its realm with everything else. That
isolation is not an optimisation.

Determinism comes free and is worth having: `Date.now()` and `Math.random()`
throw inside a compartment, so the same bytes give the same answer and a listing
cannot flicker.

**It runs on both sides, and the browser's is the one that matters.** A decoder
is *analysis*, and analysis belongs where the person is — the same rule that put
disassembly in the browser so a rename does not round-trip. Sliding a width in
the explorer and watching the picture change has exactly that feel, and a network
hop inside a loop somebody is doing by hand would ruin it. The server keeps its
own runner for agents, who have no browser to run one in. That is the same split
as `analyzeProgram`: both sides do it, each for its own consumer.

The two workers must stay mirrors. The same source has to mean the same thing
whoever runs it, or a decoder that works for a person fails for an agent looking
at the same project. They are separate files only because one is a Node worker
thread and the other a bundled browser worker; `validateDecoded` in core is
literally the same function on both paths, so a result rejected in one place is
rejected in the other for the same reason.

The browser worker is **its own esbuild entry**, so the 84KB of SES is fetched
the first time somebody runs a decoder rather than by everyone at first paint.
The main bundle does not move. That measurement is why running decoders on the
server was the wrong call: the cost I assumed it avoided was not there.

**The Node worker's source is inline, not a file beside the runner.** A path
resolves differently from source and from `dist`, and the failure mode of
getting that wrong is running a *stale* sandbox — not a class of bug to accept in
the one file whose job is to contain somebody else's code.

**A text region can be rendered by a decoder**, and getting there meant giving
something up deliberately. A program with its own character set is the ordinary
case on this machine, and none of the three built-in encodings can read one — so
declaring such a span `text` produced confident nonsense, exactly the failure
ruled out everywhere else here.

A listing is built in **one synchronous pass** and a row cannot await, so this
decoder runs in the calling realm rather than in a worker: `src/sandbox/sync.ts`.
The trade, stated rather than buried:

- **Given up: termination.** A decoder that loops forever hangs whatever called
  it — a tab, a `re64 disasm`, or the server's event loop and with it every
  connected client. Synchronous JavaScript cannot be interrupted from inside its
  own realm.
- **Kept: authority.** SES still denies the network, the filesystem, the clock
  and randomness. A decoder can waste time; it cannot reach anything. That is the
  half that matters for code arriving inside a project file, and it is not
  weakened.

`lockdown()` hardening this realm's intrinsics was the other reason to prefer a
worker, and it was **measured before being relied on**: the analysis, the Yjs
document and the SQLite store all work unchanged under it.

If the loop risk ever bites, the fix is not to re-isolate this one call — it is
to move the *whole* analysis into a worker and make it asynchronous, which
removes the constraint that created the file. That is a real option, not a
consolation: the browser already analyses locally, and a worker is still local.

A decoder is reached by `view: "snippet:<id>"`, the same slot a bitmap region
uses, so one mechanism covers "draw these bytes" and "read these bytes". A
decoder that fails, throws, or returns the wrong shape falls back to the declared
encoding: a broken one makes a listing plainer, never absent.

**All four consumers render it the same way.** `src/sandbox/sync.ts` has no
`node:` imports, so the browser uses the identical module the CLI and the server
do — a listing looks the same whoever is reading it, which is the property the
row model exists to have. It costs SES in the page: the bundle goes from 1.1MB
to 1.3MB unminified, which is 84KB minified and well inside the 2MB tripwire.
Note the bundle is not minified at all, so that number overstates what a built
page would carry.

Deliberately *not* deferred behind a dynamic import. esbuild inlines those
without `--splitting`, so it would have cost the same bytes while looking like it
did not — the sort of thing that reads as an optimisation and is a comment.

**Running it here is a convenience, not the only way, and the tools say so.**
An agent may prefer its own tooling, and nothing should push it towards a
sandbox it did not ask for — so `read_bytes` hands over the same bytes and
imposes nothing on what happens next. What `run_decoder` buys is that the
isolation is already there and the result comes back drawn.

`read_bytes` also closes the loudest finding of experiment 2. There was no way
to get bytes at all, so every reader scraped the hex column out of
`export_listing`'s rendered text with a regular expression — a lot of work to
undo formatting that existed only for a human. It returns hex *and* base64
because those answer different questions: one is readable in a transcript, the
other is what you paste into your own script.

It reads through the **memory map**, and that is the part reading the `.prg`
cannot reproduce: a project is a stack of layers and the topmost one supplying
an address wins. Addresses nothing supplies are reported as unmapped rather than
zero-filled, because a gap is a fact about the project and silent zeroes would
let a decoder draw something that looks like data.

**A decoder lives at project level**, and the shape was already decided by
precedent rather than invented: it is exactly the split a constant has.

| | declaration | use |
|---|---|---|
| constant | `{id, name, value}` at project level | `{id, address, constantId}` in the layer holding that instruction |
| decoder | `{id, name, source}` at project level | `view: "snippet:<id>"` on the region holding those bytes |

Same justification, word for word: a way of *reading* bytes describes none of its
own, so there is no layer for it to move with when the stack is reordered. It
travels with the file, so whoever opens the project next has it.

Two things this does **not** do. It does not let a decoder draw a listing row —
`analyze()` is synchronous and running one is not, which is a separate and larger
decision. And it does not change the safety story, though it does change when the
question becomes real: inline source is code you pasted, stored source is code
that arrived with a project somebody handed you. Nothing runs until it is asked
to, and the sandbox is the same either way.

Adding the op surfaced three exhaustiveness holes at compile time — `applyOp`,
`inverseOp` and `describeOp` — which is the vocabulary being closed doing its
job. `decoders` is also added to the undo manager's tracked roots; `constants`
is still missing from that list, which is a separate and pre-existing gap.

## Running the program's own code, and what experiment 5 settled

Two agents were given a disk image and nothing else. Both identified the packer
as Exomizer 2, **both wrote their own 6502 interpreter outside re64**, both
snapshotted the decrunched image as a layer, and they finished four instructions
apart — 3452 and 3456 — having never seen each other's work. Static analysis of
that disk tops out at **141 instructions**; everything past it happened
elsewhere. As one of them put it: *"Every commercial C64 disk is crunched;
without this, building from a disk image builds a project of the decruncher."*

**Built: `run_program`.** Runs from an address, follows branches and calls, and
stops when control leaves the program; `capture` keeps a range of the resulting
memory as an ordinary `.prg` in the file store, so the rest of the flow —
`add_byte_layer`, `mark_function` — is unchanged. Running and capturing happen
in one call because a run is under a second and holding one between requests
would be state the transport does not have.

**The stop rule had to be corrected by running the real thing**, and the
correction is the interesting part. "Stop where no layer supplies a byte" sounds
right and is wrong: a loader *relocates itself* and jumps to the copy, so the
rule fires on the program's own code. Revenge of the Mutant Camels moves its
decruncher onto the stack page, and the first version stopped at `$0100` after
1,258 of the 1,768,853 instructions that matter. Code the program wrote is still
the program; code nobody wrote is the KERNAL, or nowhere. That is a rule a
walkthrough found and no amount of reading would have.

**re64 can already run it.** Checked rather than assumed: loading the crunched
file and stepping from `$080D` with the existing `Machine` runs **1,768,853
instructions in 831ms** — no unmodelled instruction, no illegal opcode, no
undecodable byte, 140 distinct addresses executed, one I/O address touched. The
result disassembles to 2481 instructions from `$C065` and 3241 with the raster
IRQ, against the agents' 2495 and 2593. So the CPU is not the missing piece; a
driver is.

**Flat memory is correct here, for a specific reason.** On this machine writes to
`$A000-$BFFF` and `$E000-$FFFF` always land in RAM whatever is banked in — which
is why `POKE I, PEEK(I)` copies ROM into the RAM beneath it — and the only
exception is `$D000-$DFFF` while I/O is banked in. A decruncher writes under ROM,
so a flat 64K model gives the right answer *for the right reason*. What it would
get wrong is reading ROM, or touching I/O with I/O banked in. This binary does
neither, and the next one might.

**The stop condition is semantic, not a budget.** The run ends when the PC enters
ROM — here `$FFBA`, a KERNAL call to load the next file — which is necessarily
after decrunching is done. Nothing has to guess a limit.

## Running the ROM to learn the machine's own defaults

`CHROUT`, `GETIN` and `LOAD` are a `JMP` through a vector in RAM. That is how
they are hooked, so it is correct rather than a failure — and it means their
effects cannot be derived from the ROM alone, because the vector is empty until
something installs it.

`RESTOR` installs it, and `RESTOR` is in the ROM. So the defaults are not
something re64 has to be told: **it runs the routine that sets them.** 232
instructions, writing exactly the 32-byte vector table at `$0314`, and every
value matches published documentation — `$0314` → `$EA31`, `$0326` → `$F1CA`,
`$0330` → `$F4A5`. Which is the trick that gets a project past a decruncher,
turned on the machine itself.

Worth recording because **the chain was not designed**. The lifter and
interpreter exist because two published 6502 references *both* get `ADC` wrong,
so the flag arithmetic had to be tested by executing it rather than by reading
either one. That produced a CPU; Klaus Dormann's suite made it trustworthy; a
trustworthy CPU could run a decruncher; and the driver written for decrunchers
turns out to execute the KERNAL. Every step was justified on its own, and the
capability at the end was nobody's plan.

It is opt-in twice, like the functional test: the ROM is not in this repository
and never will be, so `kernal-vectors.test.ts` skips when it is absent.

## Calling a ROM routine, rather than launching it

`runProgram` starts a program. Calling a *subroutine* is a different thing, and
the difference was hidden until it produced two opposite verdicts on the same
shape of code. `RESTOR` — 232 instructions, an ordinary `RTS` — reported *"left
the program"*, which read as a clean finish. `IOINIT` — 38 instructions, no
illegal opcode, an ordinary `RTS` — reported *"unmodelled instruction"*.

Neither was about the routine. Nothing had pushed a return address, so both
`RTS`s popped an untouched stack and carried on into whatever that pointed at;
one address happened to land outside the map and the other inside the ROM. The
verdict was decided by where the wreckage came to rest.

So `returnTo` pushes a return address and stops when it is reached, giving a
`returned` reason that means what it says. All three of `RESTOR`, `IOINIT` and
`RAMTAS` now return cleanly — `RAMTAS` after 895,862 instructions, because
sizing the RAM means writing all of it.

Worth keeping because the technique it protects is load-bearing: running the
KERNAL's own initialisation is how this project learns the machine's defaults
without being told them, and it was working by luck.

## Shipping what the KERNAL does, to people with no ROM

`npm run gen:kernal` derives `src/core/c64/kernal-effects.ts` — what each of the
39 documented entry points reads and writes, and what calling any of the ROM's
202 routines clobbers — and that file is committed while the ROM never is.

**Kept beside `symbols.ts` rather than inside it**, because the two are different
in kind: one is *curated* — names and prose somebody chose — and the other is
*derived*, machine output that must never be hand-edited. The dependency runs one
way, since the generator reads `C64_SYMBOLS` for its names and a test asserts
they still agree, so merging them would be circular.

**A committed generated file goes stale in silence**, and this one stopped being
inert the moment the clobber sets began feeding the value analysis: a drift
between the ROM and the table would surface as a wrong flag proof somewhere else
entirely, with nothing pointing back here. So the generation is split from the
writing — `kernal-effects-source.ts` returns the text — and a test regenerates
and compares whenever the ROM is present. re64 has always shipped *names* for those addresses; this is
what they **do**, computed by its own lifter and call graph rather than
transcribed from a book.

Three steps, and the first is what makes the rest possible:

1. **Run `RESTOR` out of the ROM** for the default vectors. Ten of the 39 are a
   `JMP` through RAM, so their behaviour is not in the ROM alone — and rather
   than assume the published values, the generator executes the routine that
   installs them.
2. **Declare what the indirect jumps resolve to.** The walk still refuses to
   follow one; the generator supplies them, which is sound here precisely
   because step 1 just watched the machine install them.
3. **Analyse**, recording both the wide and the narrow scope.

**Both scopes ship, and that is an admission rather than a convenience.**
`CHROUT` dispatches on the current output device, so following its callees
unions the screen editor, the serial bus, the tape system and the RS-232 code
into **90 cells** — sound, and no use to somebody asking what printing a
character does. `follow: "returning"` does not help: the ROM contains no routine
that abandons its call chain, so there is nothing to cut. The narrow pair is the
dispatch itself, `$009A` and four registers, and is too little. Publishing one
and hiding the other would dress a limitation as an answer, so both are there
with the reason written down. **A dispatching routine wants per-path effects,
which is a real piece of work and is not this.**

One thing the derivation found that a transcription never would: `CHROUT`
appears to read `$03A9` and `$10A9`. Both are the `BIT` skip idiom — `2C A9 10`
is `BIT $10A9`, which exists to swallow the `LDA #$10` in its own operand — so
the read is genuine on real hardware and meaningless as an effect. Left in and
recorded rather than filtered, because recognising `BIT`-as-skip is a decode
question and inventing an exception here would hide it.

## A ROM is a layer you ask for, and never one you get by default

`{"type": "rom", "rom": "basic"}` resolves from wherever the host keeps ROMs —
`3party/roms/` under Node, nowhere in a browser — and lands at the address the
machine decodes it at, which is fixed rather than a property of a link: a ROM is
not linked anywhere, the hardware puts it there.

**Never automatic, and that is the whole decision.** Loading these into every
project whenever the files happen to be present would add twelve kilobytes to
its address space and make the analysis depend on a *gitignored file* — the
golden test passing on a machine without ROMs and failing on one with them. That
is worse than a missing feature: it is a suite that means different things in
different places. A project asks, and the request is committed even though the
bytes never are.

**A project asking for one it cannot get still opens.** The layer supplies
nothing and `describe_project` reports `romsMissing`, because somebody who
cannot legally be handed a ROM must still be able to read a project that wants
one — and because every answer that would have used those bytes is then short by
an unknown amount, which is exactly the unexplained short answer this file keeps
recording.

**`reference: true` is what keeps eight kilobytes of BASIC out of the listing.**
A ROM is bytes to resolve *through*, not bytes to read: you want to know what a
program reads out of it, and you emphatically do not want it rendered as your
disassembly. One step along from what a symbols layer already is — that
describes the address space without occupying any of it; this occupies it
without being what you are reading — and it costs one flag and one condition,
the filter that already excludes symbol layers from the rendered range.

`add_rom_layer` is its own call rather than an argument to `add_byte_layer`,
because every argument that one takes is one this must refuse: a ROM's bytes
come from the host rather than the project's files, it lands where the hardware
decodes it rather than anywhere a caller chooses, and it is reference. Folding
them together would be a call with three arguments meaningless half the time. It
goes at the bottom of the stack, since reference material must shadow nothing.

What it makes answerable: `$A000-$BFFF` is where the flat memory model finally
cost something real, since Gridrunner's random number generator reads ROM bytes
for entropy through eleven callers and nothing supplied them. A project that
asks now has an answer. Banking is still not modelled — a ROM layer is present
for the whole analysis, where the real machine banks it in and out — so this is
the reference half of the problem rather than the whole of it.

## BASIC, named by the machine rather than by a book

`npm run gen:basic` derives `src/core/c64/basic-effects.ts` — what each of
BASIC's 58 keyword routines touches — and that file is committed while neither
ROM ever is. Same arrangement as the KERNAL table, one step further, because
re64 ships no *names* for `$A000-$BFFF` at all: `C64_SYMBOLS` has 137 entries in
the KERNAL range and **zero** in BASIC's.

**So the names come from the machine too.** BASIC carries its own keyword table
at `$A09E` — 76 entries in PETSCII with bit 7 marking each last character, which
is what its tokeniser reads — and two dispatch tables sit beside it in exactly
that order:

| | | |
|---|---|---|
| `$A00C` | 35 statements, `END` to `NEW` | **target − 1** |
| `$A052` | 23 functions, `SGN` to `MID$` | plain |

The `− 1` is the RTS-dispatch idiom this project's catalogue already records,
met here in the place it was invented for: BASIC pushes the address and executes
`RTS`. Getting it wrong would put every statement one byte early and still
produce a plausible-looking table, so `END` at `$A831` and `FOR` at `$A742` are
pinned by name.

The seven keywords between the tables — `TAB(`, `TO`, `FN`, `SPC(`, `THEN`,
`NOT`, `STEP` — and the ten operators are syntax rather than routines and
dispatch through neither, which is why 58 of 76 keywords get a row.

Three things this found that a transcription would not:

- **Eleven BASIC routines live in the KERNAL ROM.** `RND`, `SYS`, `SAVE`,
  `VERIFY`, `LOAD`, `OPEN`, `CLOSE` and the four trig functions are at
  `$E000-$E4FF`, because BASIC's code outgrew its own chip. That is why the
  generator loads both ROMs and not merely because BASIC calls the KERNAL:
  without the second, those eleven would decode as nothing and report touching
  nothing, which reads exactly like a routine with no effects. The same shape as
  `canTouch` skipping an unseen callee and turning an omission into what looked
  like a proof.
- **`USR` dispatches through `$0310`**, a RAM cell BASIC's own initialisation
  fills, so what it reaches is in neither ROM. Reported as vectored rather than
  dropped, for the reason an absent row is always dangerous here: it is
  indistinguishable from a routine that touches nothing.
- **`PRINT#` and `PRINT` collided.** The first version of the name derivation
  stripped punctuation, so two routines shared one name — the ambiguity this
  project refuses everywhere, since a name reaching two addresses makes `name+4`
  identify nothing. `#` and `$` are spelled out now, and the generator *asserts*
  uniqueness rather than hoping, because it is a property of this ROM revision's
  keyword list.

`BASIC_CLOBBERS` ships alongside, covering 239 routines rather than the 58
entry points, for the reason the KERNAL's does: programs call ROM internals
directly and games lean on BASIC's floating-point routines without going near a
keyword. It is consulted through the same `kernalClobbers` seam, with the
KERNAL's row winning where the two overlap — that one carries a *proved*
preservation set and this one does not, and shipping an unmeasured preservation
column would be exactly the confident wrong answer refused everywhere else.

## Targets: a named view over the layer stack

The problem both builders hit second: the decrunched image must shadow the
crunched file, so a project can show the bytes **as they load** or the program
**as it runs**, never both, and annotations on the shadowed layer vanish. That is
"one interpretation per address" arriving on call five rather than with Bard's
Tale.

A **target** is a named set of active layers, and it is a view rather than a
change to what a layer is. Two of them here: the loader, and the runtime image.
Annotations keep belonging to layers, so they follow activation — which turns a
mysterious disappearance into a consequence a reader can name.

**Built.** `projectForTarget` narrows the project *before* the memory map is
built, so ownership, annotations and analysis all work on a stack that simply
has fewer layers — rather than each of them learning about targets separately.
Filtering there also keeps `layers[i]` corresponding to `project.layers[i]`,
which several things rely on.

**A view is a parameter of the request, and the server holds no current one.**

That is a reversal, and the reasoning it replaces is worth keeping because the
mistake was subtle. The selection used to live in the document, on the grounds
that "a view is a fact about the project, and two agents disagreeing about which
one to read is a conversation rather than a setting". Half of that is true: which
targets *exist*, and which one a project opens with, are facts about the project.
Which one **I am reading right now** is not. It is a cursor — the distinction
this file already drew for presence, and then missed here.

Experiment 7 produced the evidence and it was misread once. The finding was not
contention over the shared selection but **avoidance**: changing what everybody
is reading so you can glance at the packed loader is a cost nobody would pay, so
a whole target went unread. The response was to give `read_bytes` its own
`target` argument — a patch on the sharing rather than a repair of it, and the
same patch was then applied to `add_claim` for the same reason.

Then a sharper objection: even a *session*-held selection is wrong, because one
client can show two targets at once. A split-screen UI has two panes over one
document, and neither may move the other out from under it. So there is nowhere
correct for a current target to live, and the patch was the mechanism all along.

- **Every tool takes `target`**, injected once in the `tool()` helper rather than
  declared seventy times.
- **A `Workspace` is a view**: it is constructed for a project *and* a target,
  which is why the target reaches seventy methods without appearing in any of
  their signatures. `view(name)` hands you another workspace; it never changes
  this one.
- **`select_target` is gone.** There is nothing to set, so reading costs no op,
  moves no version, and repaints nobody.
- **`activeTarget` became `defaultTarget`** — which view to open with, declared
  by the project and never written while reading. Renamed so it cannot drift
  back into a cursor. It survives an export for the reason it exists: somebody
  handed this file should see what it is *for*.
- **Naming a view that does not exist is refused**, not answered for with the
  default — that would be a different stack than the caller asked for, with no
  way to tell.
- **Every answer reports the view it was computed for.** Omitting the argument is
  allowed and gets the declared default; being told which one answered is what
  turns "always name your target" into a habit the API teaches rather than a rule
  it enforces. Whether agents pick it up is then a question the transcript can
  answer.

One collision worth recording, because it is the shape this file warns about:
`bind_name` already had a `target` argument meaning *the address being referred
to*. Two meanings for one argument name in one schema is exactly the ambiguity
refused everywhere else, so it is `address` now.

`list_targets` reports **every** layer, including those the current selection
hides, because that is how a caller finds the view that shows them — the read
that verifies the write, again.

Removing the selected target clears the selection. A selection pointing at
nothing reads as a filter that silently does nothing, which is worse than no
selection at all.

Entry points split rather than move wholesale. A PRG layer's load address is
*inherent to that file* and stays on the layer; `function` and `code` labels are
already layer-owned and follow for free; only the project-level `entryPoints`
list belongs to a target. That is one field moving, and it dissolves the
`describe_project` complaint that entry points read 2 while `decodeStartsFrom`
read 19 — those were two different questions with no way to say which was being
asked. A default target takes every layer and every entry point, so a one-layer
project declares nothing.

Held loosely on purpose: whether *comments* should belong to a layer or a target
is exactly the kind of thing to settle with evidence rather than by argument,
having already been burned once by `set_comment`'s slot-keyed upsert being
justified for a single author and never revisited.

**A target list is a history, and that is a better description than "a view".**
The feature was built to stop the decrunched image and the crunched file fighting
over the same addresses, which is a shadowing problem. What it produces is a
record of the program's own life: the loader, the runtime image it expands into,
and — on any game bigger than these — the levels it pulls in later, each correct
at a different moment. That is the *overlay* problem, and it is answered: a level
is a target. Banking is not, and stays open, because it is runtime alternation
inside one moment rather than a sequence of them.

So a target carries **`order`** and **`description`**: where it sits in the
program's life, and what the phase is in prose. Two fields rather than one packed
string — the `view: "char:8"` precedent packs because a format, a stride and a
column count are one rendering choice, and an ordinal and a paragraph are not one
thing.

**Adding them made `target.set` a partial write, which is the more important
change.** It replaced the whole target, so describing one would have silently
reverted somebody else's layer list — an edit that works alone and fails
together. Every field but the name is optional now and an omitted one is left
alone, so two people revising different parts of one target both survive. The
CRDT path already held a `Y.Map` per target and needed only to stop writing keys
the operation does not carry.

## A target is a memory map, not an allowlist

`target.layers` was a set of layer ids and the *project's* array held the
z-order, so a target could say which layers were active and nothing could say
where they sat or in what order. It is a list of **links** now — bottom-up, last
shadows the rest, each optionally naming where its layer lands:

```json
"layers": ["lay_symbols", {"layer": "lay_runtime", "at": "$0100"}]
```

A bare id is a link at the layer's own address, which for a PRG is the header
its file carries. Almost every entry is one, which is why that spelling is the
short one — and it survives a round trip rather than being normalised into a
form nobody typed.

**This is what makes a layer a dumb byte resource**: it holds bytes and knows
nothing about where it sits. Two things follow that nothing could do before.

**Reordering the stack is a target edit.** This file has invoked z-order for
years as the *reason* annotations belong to layers — "reordering the layer stack
moves them with the bytes they describe" — and recorded, correctly, that there
was no `layer.set` and so no operation behind it: "a documented behaviour with no
operation behind it is worse than a missing feature, because it reads as
supported." `set_target` with a reordered list performs it, and the missing op
turns out not to have been missing so much as on the wrong object. Z-order is a
property of an arrangement, not of a resource.

**A layer can be linked into two targets at two addresses.** Not hypothetical on
this machine: Revenge of the Mutant Camels moves its decruncher onto the stack
page, so the same bytes are read at two addresses in two phases of the program's
life. The loader target links it where it loads, the running target links it
where it runs, and both are true.

Three details worth keeping:

- **A symbols layer is never linked and never filtered.** It supplies no bytes,
  so it shadows nothing and occupies no range, and a target is a statement about
  which bytes you are reading. Putting it in each target's list is also the
  version that fails the offline test — writing a whole layer list to name one
  address means two people doing so at once drop each other's layers.
- **A link naming a layer the project no longer declares is skipped**, not
  refused. Same rule as a dangling constant, a dangling type and a dangling
  `primaryLabels` entry: a delete racing a link heals itself and nothing sweeps.
- **A layer linked twice is refused**, which is the exception rather than the
  rule here — a stack that shadows itself has no reading, and that is a fact
  about the request rather than a judgement about the result.

The existing fixtures were safe to reinterpret, and it was worth checking rather
than assuming: both Camels projects list their targets in a different order from
the project's own `layers` array, because the list was a set and order was
ignored. Each target holds exactly one byte layer plus the symbols layer, so
there is nothing to shadow and no analysis moves.

## Building a project, rather than annotating one

Every experiment before this handed agents a project that already existed, so
the path from *a binary* to *something disassemblable* had never been exercised
by anything but the CLI. `add_layer` made `symbols` layers only, nothing could
read a disk image, and there was no way to get bytes in at all — which is why
`layer.set` was recorded as missing and this was not: the gap was larger and
nobody had noticed, because no run had ever needed it.

**Bytes go over HTTP, never through a tool argument.** A D64 is 175KB, which is
~233KB of base64 and something like 58k tokens through a model's context for a
file it never reads. `prepare_upload` returns a URL; the caller PUTs the bytes.

**The token carries the project, the name and the caller**, issued before the
bytes arrive — so the upload *completes* the link and a blob with no owner
cannot be created. A project-less upload would have allowed exactly that, in a
system whose whole identity story is that every edit is attributable; if the
upload never happens the token expires and nothing was made. It is **not
authentication**, and the comment on it says so: this server has none, and what
a single-use expiring token buys is that a blind POST cannot fill the disk.

**Files are in the document, like constants and decoders.** That was the cheap
answer to "how does an agent verify the upload" — it needs no `list_files`,
because a file appears wherever the project is described, and the upload is an
op, so it is attributed, undoable, and in the export. It also closes something
older: a `.re64` said `"path": "gridrunner.prg"` and could not tell you *which*
bytes the annotations were made against. Now the hash travels with the name,
which is what the `blobs` table comment always claimed it was for.

**`diffProjects` emitted `layer.add` for symbols layers only**, from when that
was the only kind an operation could make — and the filter outlived the limit.
A byte layer reached the document, was reported by `describe_project`, and never
reached the file; the next write naming that layer then failed against a text
project that had never heard of it. Third instance of the same shape, after
`meta.set` and `layer.add` itself: **the vocabulary being closed is checked by
the compiler, and whether anything emits a member of it is not.**

Verified end to end on Revenge of the Mutant Camels: create a project, upload
the disk, read its directory, lay a `prg` layer over `revenge.d64:revenge
fixed`, and the decode is five instructions — a BASIC stub — until `SYS 2061` is
marked a routine, at which point it is forty-four. That jump is the acceptance
test, because it is the moment a project stops being a file and starts being a
program.

Worth knowing about that disk: it holds a **crunched** build, `SYS 2061` into a
decruncher, and the standalone `.prg` beside it is a different, unpacked binary
at `SYS 34800`. The oracle disassembles the second. So a run given only the disk
reaches a packed program that re64 cannot unpack, which bounds what that
experiment can ask for — and is itself the kind of thing worth finding out.

## The machine model, and why the VM is not in the document

**2026-09-07.** re64 could disassemble a program and prove things about its
flags, and could not watch it run. Experiment 8 reported the Gridrunner title
screen as an *inference* — it read the code and worked out what would be drawn —
and both experiment-0 agents, given nothing but the binary, wrote their own 6502
interpreter with VIC, SID and CIA in an afternoon and used it to settle what
static analysis could not.

The hard part was already here: the CPU passes Klaus Dormann's suite outright,
decimal included. What was missing was a machine around it and a way to drive it.

**The actual missing capability was interrupts, not devices.** A game's main loop
*is* an interrupt, so a machine that cannot deliver one runs the initialisation
and then spins for ever — which is exactly what experiment 8 saw. Interrupts need
cycles to land in the right scanline, and the opcode table carried none.

**`Watcher` became a device bus**, and the shape of that change is the point. A
watcher is *told* what happened after memory has already decided, so a VIC
register read came back as whatever had last been written to that cell of RAM —
and `$D012` is the raster line, which no amount of observing produces. A `Device`
is asked one byte at a time and may answer or absorb.

The no-device path is deliberately **the same code it always was** rather than a
special case of the device path, so flat memory cannot drift. Pinned by an exact
instruction count on Camels' decruncher rather than a range.

**Cycle counts are derived from the addressing mode and what the instruction does
with its operand**, not typed out 256 times. A hand-copied column is 256 chances
to be wrong about one entry nothing would notice; the rules are seven assertions.

**The VM is a cache and never a document object.** A machine state is derived
from the script and the project's bytes, and this project does not store derived
things. Putting one in the CRDT was considered and rejected on a stronger ground
than size: `gc: false` is justified in writing on the basis that *"this document
holds maps of scalars"*, a trace is not scalars, and a deleted trace would stay
recoverable for ever.

What made that option attractive arrives anyway. Captures are bytes, and
`putBlob` is content-addressed, deduped and carried across on transfer — so the
document holds a **reference** and never the bytes, which is what `run_program`'s
capture already did.

**A scenario is a list of typed steps, not a script**, and that is what makes
prefix caching possible at all: you cannot checkpoint inside a running function.
It also makes the thing diffable, mergeable and deterministic by construction.
Snippets stay for `bytes → data`, where arbitrary code is the point.

**A checkpoint carries what the run produced, not only the machine.** Caught by a
test within a minute of the cache existing: resuming from the final step skips
every step, so the captures those steps made never happen and the run comes back
empty. Outputs are part of what a prefix produced.

It also carries **device state**. A checkpoint holding only RAM and registers
resumes with the raster somewhere else, and a raster handler then fires on the
wrong line for the rest of the run.

**Determinism is an invariant, not a nice property.** Prefix caching is sound
only because the same steps over the same bytes give the same machine, which is
also why input is *scheduled* rather than delivered live. Asserted directly:
Gridrunner run twice matches on cycles, instructions and screen bytes.

**One tool that runs, not twenty.** Everything the machine can be asked to do is
a step in the scenario rather than a call of its own, which is what stops this
surface growing a tool per capability — and it is why the steps had to be typed
records.

### What it does not model, stated rather than discovered

Badlines, sprite DMA stealing cycles, and pixel-exact raster timing: enough to
put an interrupt in the right scanline and find the screen, not enough to draw a
demo effect correctly. Bitmap mode and sprites are not composed. The SID is a
timestamped register-write log rather than a synthesiser — the question anybody
asks is *which routine makes that noise*, and a trace answers it better than
audio because you can diff two runs. Banking is still unmodelled: the chips
answer whenever they are installed, where a real machine shows them only while
I/O is banked in through `$01`.

### One number corrected

The decruncher run is **1,768,854 instructions**, not the 1,768,853 recorded
above. The prose figure was off by one and nothing pinned it, which is why it
survived; checked by running the pre-change interpreter against the same fixture
and getting the same result, so the device bus is a genuine no-op and the
discrepancy is older than it. `src/server/building.test.ts` now asserts it
exactly.
