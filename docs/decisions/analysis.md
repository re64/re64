# Static analysis and the IL

The disassembler, the P-Code lifter, the abstract domain, and the proofs built on them — plus what reachability does and does not mean.

> **History, not reference.** Each entry is a decision with the bug that produced
> it. Entries are accurate as of when they were written and are **append-only**:
> a superseded decision keeps its text and gains a note pointing forward, because
> the value of a corrected decision is the correction. For what is true *now*, see
> `docs/05-model.md`, `docs/06-algebra.md`, `docs/07-api.md` and `docs/04-developer-guide.md`.

---

## Disassembler Design

The 6502 disassembler uses a work-queue approach:
1. Start with entry points in the queue
2. Decode instruction at queue head
3. Add control flow targets (branches, jumps, fall-through) to queue
4. Skip addresses in non-code regions
5. Continue until queue is empty

This discovers all reachable code without disassembling data as instructions.

## What a routine touches

The question naming one requires, and the first answer here that crosses a call.
Everything it needed already existed — blocks with the strict definition, a
lifter over the documented instruction set, and `blockEffects` reading a block's
reads and writes off its operations. Four decisions, each settled by measuring
the reference project rather than by argument:

**The extent is derived, and a declared one would be actively wrong.** Not merely
coarse — *wrong*: 20 of 50 routines here are not one contiguous span, and the
worst tail-jumps across a 2602-byte hole. One real answer has **twelve** spans
between `$8015` and `$8DCA`. A declared extent is a single range and cannot say
that, so `mark_function` does not need one — which also frees the label field it
was sharing with array extents, and with it the bug where declaring a routine
turned `BPL loc_8050` into `BPL UpdateExplosion + $0010`.

**It answers the complaint it was built for.** `find_references` had to be told a
routine's extent to say which routine a call site sat in, and without one fell
back to the nearest preceding flow label — a local branch target on any real
routine. Reader-3 in experiment 2 got 20 of 35 callers of one routine attributed
to `loc_XXXX`. Deriving the routine needs nobody to declare anything: all 35 now
name a routine entry, none a branch target.

**Ownership is not a partition and does not need to be.** 87 of 431 blocks are
reachable from more than one entry — the shared-tail idiom, one block reached
from five routines. For a *may* answer that is fine: effects are a union over
what is reachable, and over-approximating is the sound direction. No dominators,
no arbitrating who owns a shared tail.

**A tail jump ends the routine**, and this was wrong first — badly, and in a way
worth keeping written down. The walk originally followed jumps through on the
grounds that control really does go there and never comes back, checked against
"does any routine swallow the program" (no: median 5 blocks, largest 93 of 450).

That was the wrong check. The same structure was then used to answer *which*
routine an address is in, which needs exactly one answer, and there it failed:
seven routines claimed `$8393`, one routine absorbed 26% of the program, and on
a project nobody had annotated yet **every SID write in the game reported as
being in `ColdStart`**. Two readers in the second run of experiment 2 reported it
independently and one diagnosed it exactly — the game's top level is a `JMP`
chain, not JSR/RTS, so a flow-derived extent merges it.

The boundary is the instruction: a `JMP` transfers and never returns, while a
6502 branch reaches ±127 bytes and is structurally local — the same fact the
arrow gutter relies on. Bounding there took the largest routine from 26% of the
program to 5% and left four ambiguous addresses instead of 764. The symmetric
half is that a jump *target* becomes a routine of its own, or a `JMP` chain
would be a program in which no address is in any routine.

Nothing is lost: the target is recorded as `continuesInto` and its effects fold
into `total`, exactly as a callee's do. What changes is that the extent stops.

**Membership is asked of blocks, never of spans.** A span is a merged contiguous
range, and two routines whose blocks interleave have overlapping spans while
sharing no block — which turned an exact question into 272 false ambiguities.
`spans` shows a reader where the code is; `blockStarts` decides what belongs to
whom.

The visible cost, worth stating: attribution now names `loc_XXXX` where it used
to say `MaterializeShip`, because the call site is in a smaller jump-bounded unit
inside it. That is precise rather than recognisable, and it is a *different*
thing from the original complaint — those `loc_` names are jump targets, real
units nobody has named, where the old wrong answer named branch targets, which
are not units at all.

**May, never must.** A union is always answerable; an intersection over paths
often is not, and a "must" that is quietly sometimes a "may" is worse than not
offering one.

Two details worth keeping. The interprocedural pass is a **fixpoint** rather than
one bottom-up sweep, even though this call graph is acyclic — a program that
calls itself is ordinary, and a walk assuming otherwise would not terminate.
And `PC` and `SP` are **left out of the reported sets**: every `JSR` and `RTS`
moves both, so including them would put the same two entries on the answer for
essentially every routine. Neither is a data effect, which is the question being
asked — where control went is the exit and the call list, and what happened to
the stack is `stackDelta`, which says more than "touched" ever could.

**How a routine leaves is derived, not flagged as uncertain**, and the stack
delta already determines it — but only when **accumulated from the entry**.
Three things had to be right, and each was wrong first:

- **The expected depth depends on the return instruction.** `RTS` pops two bytes,
  `RTI` three. Comparing everything against `-2` reports every interrupt handler
  in every program as broken.
- **A block cannot be judged alone.** A handler saves its registers in one block
  and restores them in another, so the returning block is three bytes short and
  looks wrong while the routine is balanced.
- **A call is net zero.** `JSR` pushes a return address that the callee's `RTS`
  pops again. Counting the push makes every routine look two bytes deeper per
  call it makes — which is how this first produced *48 findings across 50
  routines*, one of them "30 bytes deeper" for a routine that simply made
  fifteen calls. The implausible volume was the tell.

With all three right it reports **five** things about Gridrunner, and they are
all real: two routines that reset the stack pointer outright and abandon their
call chain, and three that return to their *caller's caller*. `$87FE` is the
`PLA PLA RTS` this file already knew about; the other two were invisible before,
because the pops and the return sit in **different blocks** — `$8A2F` discards
the address and `$8A41` returns, eight blocks apart.

A caller is told too: a callee that returns past whoever called it means the code
after that `JSR` is not reached through it, which the caller cannot see for
itself and which the block graph assumes otherwise.

What it still cannot see: an instruction with no modelled semantics leaves both
sets short by an unknown amount, and reachability is static, so a computed jump
leads somewhere no walk follows.

## Indirect writes: run them, do not pattern-match them

`STA ($02),Y` names no address, so a range search cannot see it — and that is not
a corner case: Gridrunner writes the VIC-II *only* through a pointer, so
searching `$D000-$D02E` returned one dead instruction and missed every write that
mattered. Both readers in the second run hit it.

**This was constant folding first, and that was the mistake.** A hand-written
backward walk looked for `LDA #imm` immediately before `STA $zp` — a mechanism
built beside one that already existed. The lifter describes all 56 documented
instructions and the interpreter runs them, so the address a block reaches is
something the machine **computes exactly**, not something a pattern
reconstructs. The pattern could not see past its own shape either:

- It required the load to sit *immediately* before the store, so
  `LDA #$D0 / TAX / STX $03` defeated it.
- It never folded the **index**, so all three of Gridrunner's VIC writes reported
  the shared base `$D000` instead of `$D018`, `$D020`, `$D021` — which is the
  difference between "something writes the VIC" and "the character base is set
  to $2000 here".
- It read `($zp,X)` from `$zp` whatever X held, which is silently wrong for any X
  but zero. The interpreter just does the addressing, so that is right for free.

**Running is exact only when nothing was assumed, and that is a certificate
rather than a hope.** The run is seeded with **nothing** — no load image, because
zero page in a `.prg` holds whatever was in the file before the program
initialised it, which is exactly where pointers live. Any cell the path did not
write itself therefore reads as `unknown`, and one such read refuses the answer.

Two exemptions, both load-bearing:

- **A cell the run wrote is `computed`, not unknown.** The pointer this block
  built out of literals is not an assumption, and counting it as one would refuse
  every answer worth having. `TraceSource` carries that third case; the
  block-level summary has no use for it because such a cell is not an *input*.
- **At the access itself only the pointer cells are checked.** The last read *is*
  the target, and its value is precisely what nobody claims to know — requiring
  it to be supplied would refuse every load through a pointer, which is half the
  question.

**It stops rather than guessing**, in the same two places as before and for the
same reasons. At a **join**, because walking back through single predecessors is
path-insensitive *and sound* only while there is one way in. And at a **computed
store** — Gridrunner's screen pointer comes from a table, so it genuinely depends
on runtime state, and that read is `unknown`.

Paths are tried **shortest first**. The refusal is deliberately blunt, so a
longer path can only ever poison an answer a shorter one gave; trying them in
order is what keeps the extra reach from costing precision.

**An unassigned index gives a base and not an address.** With Y never assigned
the machine runs it as zero, so the address it touched *is* the pointer —
reporting that as the address would dress an assumption as a finding. Both are
returned, and the answer says which it has.

On the reference project this resolves 3 of 18 indirect accesses — **the same
three** the folder did. What changed is not coverage but precision, and that
there is no second mechanism to maintain. The other 15 are not a folding failure:
they are loop bodies with several predecessors whose pointer comes from the
screen-line table and genuinely differs per iteration. Running the path through
unique predecessors was measured and gains nothing, because there is no unique
predecessor to run. They are reported as unresolved on the answer itself, so a
caller knows the search had a blind spot rather than reading an empty result as
an absence.

## Known Limitations & Future Features

## What "reachable" means, and what the binary might be doing

re64 computes **statically reachable**, which is strictly smaller than
*executed*, and the gap between them is not a defect to be closed. A 6502
program reaches code by means no walk can follow: a computed `JMP ($xx)`, an
address pushed and `RTS`-dispatched, a table index from a variable,
self-modifying code. A game from 1983 also contains dead routines left over
from development, and may simply have bugs.

So a disagreement between this analysis and a human's listing is not evidence
that either is wrong. Three explanations are always live:

- the annotation is wrong,
- the decode leading there is wrong,
- **the program does something the analysis cannot see, or is buggy.**

Everything here that talks about reachability has to leave the third open.
`find_references` already does — it states on every answer that it sees absolute
addressing only. The `flowIntoData` warning and the `orphaned` hint say "this
analysis arrives here", not "execution reaches here", and offer `mark_function`
for the case where something reaches an address in a way no walk can show. An
earlier draft of that warning offered exactly two explanations and was wrong for
the reason this section exists.

`find_undecoded` reports spans **nothing has explained** — not dead code. The
distinction matters most on a fresh project, where almost everything is
unexplained and none of it is dead.

## Instruction semantics: what exists, and why we write our own

Wanted eventually: an IL with real 6502 semantics, SSA over basic blocks, and
symbolic execution — the shape panopticon has. Searched first, because writing a
lifter is not something to start by accident.

**Nothing exists to port.** No RREIL implementation for JavaScript or
TypeScript. No binary-lifting IL for JS at all: the 6502 packages on npm are
emulators and assemblers, which execute rather than describe. P-Code/SLEIGH is
the IL with traction and every binding is native — `pypcode` (Python, drives
angr), `sleighcraft` and `rsleigh` (Rust), `lifting-bits/sleigh` (C++).

**A native binding is ruled out by the architecture, not by taste.** re64's
analysis runs in the browser, deliberately, so that a rename does not round-trip
to the server. Nothing behind node-gyp can go there, and a WASM build of SLEIGH
is a very large dependency for a project with almost none. Writing the IL in
TypeScript is therefore the only shape that fits, and is not reinvention: there
is no wheel of this shape.

**Neither reference is correct about flags, and they are wrong differently.**
Checked before writing anything, on `ADC`, `SBC` and the flag macros:

| | Ghidra `6502.slaspec` | panopticon `semantic.rs` |
|---|---|---|
| `N` | `value s< 0` — right | signed `<=` , so `$00` sets N — wrong |
| `SBC` | `A - op1 - !C` — right | `A - r + C`, no borrow — wrong |
| `ADC` carry | computed before adding carry-in, so `$FF+$00+C` reports none | `AND` where the rule needs `OR`; reduces to `(res==A) && C_in` |
| `ADC` overflow | `V = C` — plainly wrong, V is *signed* overflow | same `AND`-shaped bug |
| decimal mode | no `D` check at all | written, then commented out |

So porting one and checking it against the other would have produced a wrong
lifter whichever won a disagreement. **Use them for structure and coverage, not
for arithmetic**: Ghidra for how instructions decompose and which flags each
touches, panopticon for the illegal opcodes Ghidra omits, and the ISA definition
for what the flags actually are:

```
sum   = A + M + C
result= sum & 0xFF
C     = sum > 0xFF
V     = (~(A ^ M) & (A ^ result) & 0x80) != 0
N     = result & 0x80
Z     = result == 0
```

This is the argument for making Klaus Dormann's 6502 functional test suite the
acceptance bar rather than a nicety. Reading two references agreeing would not
have caught any of the above; running the program does, and names the
instruction.

**Deferred, with a shape in mind: illegal opcodes as a chip variant.** They lift
to `CALLOTHER` meanwhile, so clobber analysis stays conservative rather than
quietly wrong. Worth knowing when that arrives: the C64's processor is a **6510**,
a 6502 with an on-chip I/O port at `$0000`/`$0001` — and that port is the bank
switching register, so a chip option reaches the memory model and not only the
opcode table.

**Two references, with different standing.**

- Ghidra's `Ghidra/Processors/6502/data/languages/6502.slaspec` is complete,
  maintained, and **Apache 2.0** — compatible with this project, so it can be
  read and lifted from freely.
- panopticon's `mos6502/src/semantic.rs` is **GPL-3 and mixed authorship**. The
  target was written by this project's author in December 2015 (decoding,
  illegal opcodes, loader, semantics) and converted to RREIL by Kai Michaelis in
  2016, with three other contributors since. So the design is one thing and the
  current text is another: usable as a reference whose reasoning is already
  understood, not as source to copy into an MIT project.

## The lifter, and what a block can now say about itself

Written, and all 56 documented instructions are in it. Gridrunner lifts
completely: 1449 of 1449 instructions, 446 of 446 blocks fully modelled.

Two conventions carry the design, and both are about refusing to blur a
distinction:

**A statically known address becomes a `ram` varnode, not a `LOAD`.** `LDA $10`
lifts to a read of `$(0x10)` directly, so a block's inputs and outputs name the
zero-page cells it uses — which on this machine is most of the interesting
traffic, since zero page *is* the variable space. `LDA $10,X` cannot name
anything; it lifts to a `LOAD` from a computed varnode, and the static answer is
"reads memory at a computed address". Losing that distinction would mean either
inventing an address or reporting none.

**Hardware quirks are modelled rather than smoothed over.** Zero-page indexing
wraps inside the page, `($ff,X)` takes its high byte from `$00`, and
`JMP ($10ff)` reads its high byte from `$1000`. These are not edge cases in
hand-written C64 code — they are things people relied on.

Decimal mode is still not modelled: `ADC` and `SBC` lift to binary arithmetic
regardless of `D`. What changed is that it now says so at the point of use
rather than being a footnote.

The arithmetic is tested by *running* it, against the four carry/overflow cases
where the two published references disagree and both are wrong — which is the
whole argument for the interpreter existing, and why it was written before the
lifter rather than after.

**The functional test found two defects that every hand-written case had
passed**, which is the argument for it in one line. Both were invisible to
inspection and to the tests written alongside the code:

- `RETURN` discarded its address, so every `RTS` continued at the byte *after
  itself* rather than at its caller. Nothing noticed until something actually
  returned. The address is not decoration even in the ordinary case, and on this
  machine a routine that rewrites its own return address is a standard computed
  jump.
- Signed overflow across a three-way add combined with `BOOL_OR`. Both halves
  **can** overflow, and then they *cancel*: `$FF + $80 + 1` is `-128`, which is
  representable, so V is clear. Carry genuinely cannot happen twice — a carry
  out of `A + M` leaves at most `$FE`, and `$FE + 1` does not carry — so carry
  keeps its `OR`. The asymmetry is the trap, and the code says so where it
  happens.

It now reaches the decimal section (test case 42) having executed all 56
documented instructions, and stops there.

**How much is behind that stop is now known, and it is very little.** The suite
has 45 groups: 0-43, then 240 as a completion marker. We clear 0-41. Group 43 is
the only real test after the stop, and it is *also* decimal — `CLD/PHP/ADC`
against `SED/PHP/ADC`, checking that `D` survives `PHP`, `PLP` and `RTI`, and
verifying it through decimal arithmetic (`$55 + $55` is `$AA` binary and `$10`
decimal). The flag plumbing it exercises already works; only the arithmetic
fails. Group 240 is `LDA #$F0 / STA $0200 / JMP *`, the success marker.

So implementing decimal takes the suite from "stops at 42" to complete, with
nothing else outstanding — which is a more useful thing to know than "stops
partway". Established by scanning the binary for the `LDA #n / STA $0200` that
each group writes, then disassembling `$340C` with re64's own disassembler. That boundary is asserted by
`src/core/il/functional.test.ts` rather than described, so the gap is a passing
test instead of prose, and nothing can regress into looking like a decimal
failure. It is opt-in twice: the binary is fetched rather than committed, and
26 million instructions take about thirteen seconds.

**Decimal is done, and the suite now passes outright.** All 45 groups: 0-43 and
the `$F0` success marker. Three things made it smaller than it looked.

The functional test checks **only the accumulator and the carry** in decimal
mode — `PHP / CMP` for the result, then `PLA / AND #$01 / CMP` for the carry. It
never looks at N, V or Z there. So the notorious part of NMOS decimal, where N
and V come from a partly-corrected intermediate, is not what stands between this
model and a passing suite.

`Z` is the *binary* result's on real hardware, so it is right for free. N and V
stay binary and that is a **stated gap** rather than an oversight, recorded at
the point it happens: no real program branches on N after a decimal add, and
inventing an answer there would be exactly the confident wrong answer this
project refuses everywhere else.

The arithmetic is **two new IL operations**, `INT_BCD_ADD` and `INT_BCD_SUB` —
the one place this IL departs from Ghidra's vocabulary, and it departs because
there is nothing to be faithful to: Ghidra's `6502.slaspec` does not check `D` at
all. Each returns two bytes, result in the low and carry in bit 8, so one
operation answers both and `SUBPIECE` takes them apart. The alternative was
thirty-odd branchless nibble operations per `ADC`, unreadable in a listing and
still not right about the flags.

Decimal `SBC` is **not** decimal `ADC` of the complement — the correction goes
the other way — so it cannot ride on the binary path the way binary `SBC` does.
And only the accumulator differs: every flag after a decimal `SBC` is the one
binary subtraction would have set. Worth knowing, because the first attempt read
`A` and `C` *after* the binary pass had already overwritten them.

**The select costs nothing measurable.** Execution lifts as though `D` were in
doubt, since the machine holds a real flag and resolves it exactly: the
decruncher runs 1,768,854 instructions in 672-748ms with the select, against
831ms before it existed.

**That is not a reason to skip proving `D`, and treating it as one was wrong.**
`lift` took a `DecimalMode` with three values and nothing computed two of them —
the same shape as `meta.set` with no emitter and `layer.add` filtered to symbols,
three times over. The binary default was a *guess*: correct on the programs to
hand, and silently wrong for anything that does use decimal. Effect sets hid it,
because both paths touch identical registers.

So `decimalModes` proves it, and the proof had to be **interprocedural or it says
nothing**. A first version followed block successors only — which deliberately
exclude the call target, since a `JSR`'s successor is where it *returns to* — so
every routine body was a block nothing entered, seeded `unknown`. It came back
`unknown` at **17 of Gridrunner's 19 sites**, because the one `CLD` is in
`ColdStart` and never reached what `ColdStart` calls. Judged on that output the
pass looks useless, which is exactly the trap.

Following calls, both real targets appeared to prove **binary everywhere**: 19 of
19 on Gridrunner, 3 of 3 in the KERNAL, no unknowns.

**That number was never real, and how it was produced is the more useful thing to
record.** `canTouch` walked from a call target and did `if (!block) continue` —
so a callee it could not see was assumed to touch nothing. Gridrunner calls five
KERNAL routines and the project loads no ROM, so all five were skipped and `D`
sailed through them. It was not a proof, it was an omission that looked like one.

The value analysis assumes an unseen callee can write anything, which is sound
and costs the whole proof. The right answer is neither: it is to **ask**, and
`KERNAL_CLOBBERS` exists to be asked — what calling any of the ROM's 202 routines
writes, derived from the ROM so a project without one can still be understood.
Consulted only where the project supplies no bytes itself, since a project that
loads its own ROM has a better answer about *that* ROM. Only routines whose
analysis is complete are listed at all, because an under-approximation here would
be believed; an absent row means "assume anything".

It takes `D` on the reference project from 3 proved clear to 9, and no further,
for a reason worth keeping: **every write to `D` in the entire KERNAL is a
`PLP`** — four of them, no `CLD` and no `SED` anywhere. So "CHROUT writes D" is
true and costs a caller nothing, and Gridrunner's one `JSR $FFD2` still loses the
flag for the rest of the program.

Saying so needs a *preservation* result, and that is where this stops rather than
guessing. Running the routine with distinct seeds and seeing what comes back
matching was built and does find it — 142 of 202 routines look like they preserve
`D` — and was then taken back out of the shipped analysis, because it is a
**check and not a proof**: a routine doing `if C then D := 0` passes complementary
seeds while preserving nothing. A sampled result presented as an analysis result
is exactly the confident wrong answer refused everywhere else here.

**So the proof is an identity rather than a sample, and it is built.** Each value
at an origin carries an identifier that survives only operations which provably
*move* a bit — `COPY`, a push and its matching pull, a shift, `AND` against a
known one, `OR` against a known zero — and is dropped by anything that computes.
A register still holding the identifier it started with was restored, and that is
a proof: no arithmetic can manufacture an identity.

Per bit rather than per value, and `PHP` is why, exactly as it is for the value
domain itself: seven flags are shifted into one byte and `PLP` takes them apart
again, so a whole-value identifier dies at the assembly while a per-bit one rides
through. It settles `TXA / TAX` preserving `X` for free — the idiom the reviewing
agent noticed by hand.

Three things it needed, none of them obvious in advance:

- **A flag register holds nought or one**, and must be seeded saying so. Modelled
  as a whole opaque byte, `PHP`'s `OR` has no known zeros to merge into and every
  identity is lost at the first flag.
- **`bitOf` had to stop comparing.** It lifted `PLP`'s bit extraction as
  `(v & mask) != 0`, and a comparison *computes* a value. Against a single-bit
  mask a shift is identical and only moves one, so that is what it emits now.
  Klaus Dormann's suite passes unchanged, which is the bar for touching a lift.
- **A routine has to be analysed alone.** Read out of a whole-ROM analysis, what
  arrives at a routine's entry is whatever its callers held, so a caller that had
  already lost a flag makes the callee look as though it destroyed one.

It costs nothing measurable — 27ms with and without on the reference project —
because an identity is dropped at the first computation, so the arrays are hardly
ever allocated.

**Result: 142 of the ROM's 202 routines provably give `D` back**, and four of the
five KERNAL routines Gridrunner calls. The fifth is `CHROUT`, and it is a **true
negative rather than a limitation**: its screen path pops a status byte at
`$E7B4` and `$E7C1` that it never pushed — no `PHP` anywhere in that routine — so
what it restores depends on a caller this analysis is not looking at. One
`JSR $FFD2` therefore still costs Gridrunner its decimal proof, honestly.

The general lesson is worth more than the instance, and this file has now been
caught by it twice: **a check that cannot see something must say so, not skip
it.** A silent skip is indistinguishable from a proof at the point of use.

The question a callee raises is *"can this touch `D` at all"* rather than *"what
does it leave"*. The second is more precise and needs a second fixpoint over
routine exits; the first is one walk and answers what actually arises, because
almost nothing touches the flag and the caller simply carries on. A routine that
might makes everything after the call `unknown` — honest, and rare.

**Entry points start `unknown`, not clear.** A 6502 does not clear `D` on reset
or on interrupt, unlike the 65C02, which is precisely why real reset routines and
KERNAL handlers do it themselves. Assuming clear would assume the thing those
`CLD`s exist to establish.

The by-product is worth as much as the correctness: `decimalSites` reports every
`ADC`/`SBC` not proved binary, and BCD on this machine almost always means a
score, a clock, or a number being shown to somebody.

## One analysis under all of it: known bits

`flags.ts` had a walker per flag, and the two it could not do at all were the
argument for replacing it. `N` is bit seven of a *value*, so no amount of
watching `SEC`/`CLC`-shaped instructions will ever prove it; `B` is not stored
anywhere on this machine and exists only as bit four of the byte `PHP` and `BRK`
push. So the flags stopped being a special case: every one of them is a register
the lifter already writes, and `src/core/analysis/values.ts` runs the lifted
operations over an abstract domain until nothing moves. `proveFlag` is a query
over that now, and `flags.ts` went from 328 lines to 212.

**The domain is known *bits*, not known bytes, and `PHP` is why.** It assembles
one byte out of seven independent flags, and a handler asks about exactly one of
them with `AND #$10`. Under a whole-byte lattice that byte is simply unknown and
the question has no answer. Per-bit, `B` survives the round trip through the
stack and the `AND` extracts it.

Three things fell out that were not the reason for doing it:

- **`N` from one bit.** `AND #$7F` proves the flag clear with every other bit of
  the value still a mystery.
- **`Z` in both directions.** Any bit known set proves it clear; all bits known
  clear proves it set.
- **Carry out of an addition**, which is often settled where the sum is not —
  two known zeros in the top bits carry nothing whatever the low bits do.

**Comparisons are done on ranges, not by scanning bits.** Scanning from the top
stops at the first undetermined bit and answers nothing, which is exactly what
`AND #$7F` leaves; the range says 0 to 127, and nothing in it is negative. That
one change is the difference between `N` being provable and not.

**Not symbolic execution, and the boundary is what keeps it cheap.** A symbolic
domain tracks *expressions*, so it can say "A is whatever X was" and relate two
values it never learned. This tracks per-bit facts only: it cannot say two
unknowns are equal and never builds a term. In exchange every value is a fixed
width, the lattice has finite height, and a loop reaches a fixpoint with no
widening rule. If relational reasoning is ever wanted the escalation is an SMT
solver rather than a bigger lattice — **Triton** (`triton-library.github.io`) is
the reference implementation of that shape, with the same caveat as SLEIGH: it
is C++/Python, so it cannot go where this analysis goes.

**The stack is modelled as a stack.** Its absolute address is not knowable —
nothing says where `SP` started — but *what was pushed* is, so a value keeps its
identity across `PHP … PLP` even though the cell it sat in is anonymous.
Addresses derived from `SP` are found by taint, the same property `blockEffects`
uses to keep the stack out of "an address I could not name", and the whole stack
is abandoned when `SP` is assigned from anywhere else — which is `TXS`, and means
the depth has stopped being relative to anything.

**An interrupt handler can be seeded with what it was entered with.** `stackAt`
on the analysis and `stack` on `runBlock`: a status byte with `B` decided and
everything else unknown. That is what lets the same handler be analysed twice
and give two answers, which is honest, because it does two things. Both were
reachable before by setting `SP` and the `$01xx` cells by hand, and nobody would.

**Lazy, and it has to be.** The fixpoint costs about as much again as the
disassembly — 13ms to analyse Gridrunner, 22ms more for this — and `analyze()`
runs on every document update against a budget of roughly 30ms before the
browser stutters under a collaborator. `ProgramAnalysis.values` is a memoised
getter and nothing on the read path touches it until something asks about a flag.

**The lattice is checked exhaustively rather than by example.** Every pair of
one-byte patterns against every concrete pair they stand for, for and, or, xor,
add, subtract, both comparisons and equality: a bit the domain claims to know
must be that bit in every concretisation. It is cheap at this width and it is
the property everything above rests on.

## An interrupt is not entered from nowhere

Seeding every origin with "nothing is known" is right for something reached from
outside and wrong for the two ways this machine re-enters its own code. An
interrupt arrives from *somewhere in this program*, and the processor changes
almost nothing on the way in: it pushes the return address and the status byte,
sets `I`, and jumps. `A`, `X`, `Y`, memory and every other flag are exactly what
the interrupted code had.

So an origin has a **kind**, and the two re-entrant ones are derived rather than
declared:

| | entered from | `B` |
|---|---|---|
| `external` | outside; nothing can be assumed | — |
| `interrupt` | between any two instructions | clear |
| `brk` | the `BRK` instructions, and only those | set |
| `interruptOrBrk` | both, so it cannot be told | unknown |

The last row is the ordinary case on a bare 6502, where `BRK` and `IRQ` share
`$FFFE` — and it is exactly why a real handler tests bit four rather than knowing.
The C64 splits them, because the KERNAL's own handler reads `B` and dispatches to
`$0316` or `$0314`.

`src/core/c64/entry-vectors.ts` reads the kinds **out of the project's bytes**,
the same stance taken with the KERNAL's default vectors: the hardware vectors if
a ROM is loaded, the RAM vectors if RAM is, and a cartridge's warm start if the
`CBM80` signature is there. Which is how Gridrunner turned out to be a cartridge
dump: `$8000 → $83C1` cold, `$8002 → $83E2` warm, `CBM80` at `$8004`. Both of the
project's `entry` labels are that header, and `$83E2` is the **warm start**
reached through NMI rather than an IRQ handler the game installed.

Two details in the derivation. The entry state's **status byte is assembled from
the joined flags**, so `PLP` restores what the interrupted code had and
`PLA / AND #$10` answers about `B`. Each flag is masked to its own bit *before*
being shifted into place, because OR-ing in one unknown flag otherwise destroys a
known **zero** elsewhere in the byte — it preserves a known one, so this failed
for hardware interrupts while working for `BRK`, which is a confusing way to
find out. And the **stack is seeded as exactly the three entries the processor
pushed**, not as the joined one: depths differ all over a program, so a joined
stack is abandoned immediately, and abandoning it is the one thing that makes `B`
unreachable. Claiming a depth of three is not a claim that nothing is underneath
— a fourth pull comes back unknown, which is the truth.

It converges because the handler's own instructions become states to join over,
and joining only ever loses precision.

## `BRK` is a jump through a vector, and now says so

`BRK`'s flow type is `halt`, so the walk stopped dead at one — no target, and,
unlike an indirect `JMP`, **no warning either**. That was an inconsistency rather
than a decision: the two are the same shape of problem, a transfer through a cell
a program may rehook, and one of them named what it would have reached while the
other said nothing at all.

It gets the same treatment and for the same reasons. Not followed — a program
installs its own handler, and on this machine the KERNAL's own reads `B` and
dispatches again through `$0316` — but the warning names `$FFFE`, what the map
holds there, and `mark_function` as the remedy. It also says the handler runs
with `B` set, since that is how a handler tells a `BRK` from an interrupt and it
is the one thing about the entry that is knowable without looking at anything.

The second half was that **a handler is usually a decode root rather than an
origin**. Marking it a routine is how anybody gets it decoded, and that makes it
a `function` label — so keying the re-entrant treatment on `origins` alone left
every such handler seeded with nothing known, which is exactly the case the
machinery was built for. The kinds are read from the *bytes*, so an address
`$FFFE` or `$0316` points at is one the machine enters whoever declared it, and
that is now what decides it.

## An origin is not a decode root

The pass needed seeding, and seeding it with `entryPoints` was wrong in a way
this file predicted years earlier. `entryPointsFor` returns every `entry`,
`function` and `code` label plus every code region start, because all of them are
places the *disassembler* must look. An origin is something else: an address
reached from outside, where nothing can be assumed.

The guidance on label types said exactly this would happen:

> Do not collapse these because they behave alike today. That sameness is an
> artifact of the disassembler only ever queueing them; they diverge as soon as
> there is call-graph or basic-block analysis, which is where the information
> would be needed and no longer recoverable.

Treating a `function` label as an origin is not merely imprecise, it is
**contaminating**: an origin asserts "the flags are unknown here", and joining
that into code the real start had proved something about destroys the proof.
`ProgramAnalysis.origins` is therefore a separate, strict subset — declared entry
points, load addresses, and `entry`-typed labels.

Coverage and precision then pull in opposite directions, and the order reconciles
them: run from the origins first, and only afterwards seed any decode root they
never reached. Proofs made on the way in survive; code no origin reaches still
gets an answer. That the second pass can then lose a proof in code both reach is
not a shortcoming — if a routine really is entered from somewhere this analysis
cannot see, the flags really are unknown there.

## The same proof, for carry and for interrupts

`flags.ts` generalises it. Three flags are worth proving and the reason differs
for each, which is the interesting part:

- **`D`** changes what an instruction *means*, so proving it is a correctness
  requirement. It is the only flag that does.
- **`C`** is a finding. `CLC` before `SBC` subtracts one more than the operand
  reads — an idiom found **by hand three times across two binaries** before
  anything computed it. `carrySites` now reports Gridrunner's at `$8279`,
  `$828D`, `$82CA`, `$82E5`; the readers reported `$8278`, `$828C`, `$82C9`,
  `$82E4`, which are the `CLC`s one byte earlier. Same finding, mechanised.
- **`I`** is a finding too, and the KERNAL supplied its shape: `RDTIM` falls
  through into `SETTIM`, which does `CLI`, so reading the clock inside what a
  caller believes is a critical section turns interrupts back on underneath it.
  `interruptsDisabledAt` reports four such blocks in Gridrunner.

**Reported as facts, not defects.** `CLC/SBC` is sometimes deliberate, and all
of Gridrunner's sit inside visual effects where one out is invisible — which is
presumably why it shipped.

**Who clobbers a flag comes from the lifter, not from a table.** `flagsWritten`
reads the operations, so `PLP`, `RTI`, and every arithmetic and shift
instruction that touches carry are covered without anyone maintaining a list
that drifts away from the semantics.

`Z`, `N` and `V` are deliberately absent, and parked rather than forgotten. They
fall out of *data* rather than being set and cleared, so a flag lattice would
answer `unknown` nearly everywhere — a check that fires on healthy code, which
is the disqualifier hygiene already settled on. They yield to **value** tracking
instead: `LDA #$00` fixes `Z` and `N` exactly, and the interpreter is already the
right evaluation structure for it, with values that are expressions rather than
numbers. Whether anything interesting depends on knowing them statically is the
open question, and nothing has asked yet.

Decimal used to be the one thing left, and it did not touch the subject at hand —
Gridrunner has a single `CLD` at `$83C2` and no `SED` anywhere. When it is
wanted, the shape is a **branchless select** rather than intra-instruction
control flow: `mask = INT_SUB(#0, D)` is `$00` or `$FF`, and
`result = binary ^ ((binary ^ decimal) & mask)` picks between them without a
`CBRANCH` — which matters because the effect sets must stay identical either
way, and because `execute` has no way to skip operations.

`stackDelta` **is derived now**, and the hand table of nine opcodes is gone.
`JSR` counts two because it emits two pushes, not because somebody wrote `2`
beside its name, so the count cannot drift away from the semantics. `TXS` still
yields undefined — it *sets* the pointer rather than stepping it, and reporting
zero would be a guess dressed as an answer.

It reproduces what the table found and then some: `$87FE`, which discards its
own return address, and `$83E2` alongside it.

## An indirect jump is not followed, and now says what it would have reached

`JMP ($0326)` names no destination, so the walk queues nothing. That is right and
it was silent, and silence is what made the KERNAL undecodable: 15 of its 42
documented entry points are a three-byte jump through a RAM vector, so decoding
from the jump table gives **669 instructions** where declaring the 16 targets
gives **2583**. Experiment 6's agent worked every one of those targets out by
hand and recorded that it had — `$F1CA` for `CHROUT`, `$F13E` for `GETIN` — which
is a lot of effort to recover something the memory map can be asked for.

**Following it is still refused, and hooking `$0314` is exactly why.** A vector
holds whatever the program last wrote there; the bytes in the map are what it
held when the project was put together. Reading them and queueing the target
would be the `flowIntoData` mistake again — a correct-looking answer from a
premise nothing checked — and it would be wrong precisely where vectors are most
used, since installing your own raster interrupt is the standard idiom on this
machine.

**But knowing nothing and saying nothing are different.** The warning names the
cell, what the map currently holds there, and `mark_function` as the remedy:

```
$FFC0: jumps through $031A, which this walk does not follow — a vector holds
       whatever the program last wrote there. It currently reads $F34A;
       mark_function there if that is the routine you mean.
```

It asserts nothing about whether control goes there. That judgement needs
somebody who knows whether this vector is hooked, which is the same division of
labour every other warning here follows.

Two details. Where no layer supplies the pointer the warning says so rather than
omitting itself, because "nothing to read" is a different problem from "read
something" and leads somewhere else. And the high byte comes from the **same
page** — `JMP ($10FF)` takes it from `$1000` — modelled here for the reason the
lifter models it: people relied on it.

**An edit that stops code decoding says so separately from `delta`.** A
catastrophic loss used to arrive in the same field, shape and tone as a useful
gain, and every tool description here teaches a reader that a positive delta is
the reward for a good decision. `orphaned` names the first casualty *outside*
the span written — bytes inside it are the point of the edit — and suggests the
`code` region that restores it. It makes no claim about *how* the address was
reached: fall-through is the usual cause, but the same report follows from
removing a jump's only decoding, and asserting a mechanism it cannot check would
be a guess in the one message meant to be trusted.

## A catalogue of the machine's trickery, in the fewest bytes that show it

`src/core/arch/mos6502/idioms.test.ts`. Every entry was met in a real binary —
Gridrunner, the KERNAL, or Revenge of the Mutant Camels — and each is a place
where the obvious reading of the bytes is wrong.

It exists because **the evidence now spans three programs and is growing**, and a
corner case pinned only against a 65KB binary is one nobody can see: that
assertion says "Gridrunner still works", not "this is what `PLA PLA RTS` means".
So each is reduced to the fewest bytes that still show it and records **where it
was seen**, so the provenance outlives the binary. Duplicating a component's own
test is deliberate and cheap — a component test says the component works, this
says what the machine does.

The rule for adding one: a *naive* reading gives a confidently wrong answer. Not
merely unusual — wrong.

Two of the first fifteen were written with the wrong expectation, which is the
argument for the file in one line. `PLA TAY PLA TAX PLA RTI` is *not* balanced —
the interrupt pushed what it is popping — and asserting otherwise would have
pinned a bug. And a `JMP` whose target is inside its own operand bytes was
written twice, in two different sessions.
