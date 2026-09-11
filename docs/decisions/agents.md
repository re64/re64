# Agents as a consumer

The MCP surface: what a tool is for, what the read side was missing, and what each experiment moved.

> **History, not reference.** Each entry is a decision with the bug that produced
> it. Entries are accurate as of when they were written and are **append-only**:
> a superseded decision keeps its text and gains a note pointing forward, because
> the value of a corrected decision is the correction. For what is true *now*, see
> `docs/05-model.md`, `docs/06-algebra.md`, `docs/07-api.md` and `docs/04-developer-guide.md`.

---

## Agents as a first-class consumer

## The read side was the thing missing, not the write side

The mutation side was already agent-shaped: `src/core/ops/` is a closed
vocabulary of operations targeting objects by id, each with a computable
inverse. The read side was not. `analyze()` computed the instruction map, the
reference map, and the merged label index *including* the auto-generated
`sub_`/`loc_`/`dat_` names — and then discarded all of it, returning rendered
text rows with character offsets. Of seven questions an agent needs answered,
exactly one had a reachable home.

So `src/core/analysis/program.ts` keeps what was being thrown away, and
`analyze()` renders over it. `AnalysisResult` is deliberately **unchanged**:
`src/ui/main.ts` holds it for the life of the view, and folding an
`InstructionIndex` into it would make every browser retain about 8MB it never
reads.

**Basic blocks exist** (`src/core/analysis/blocks.ts`): straight-line runs with
one way in and one way out, each carrying its successors, what it calls, and how
it leaves. 364 of them on Gridrunner, median three instructions. Derived and
never stored, like the region tree.

They are the floor for four things, not the answer to any of them yet. A
function's extent still needs grouping blocks by a call graph and dominators;
what a routine calls outbound needs the same. A wrong extent is not visibly
wrong, so neither is guessed — an extent can be *declared* on `mark_function`,
which is a different act from inferring one.

**Control enters a block only at its start, never in the middle.** That is the
whole point of the definition rather than an incidental property: it is what
lets an analysis treat a block as one transfer function, with inputs fixed at
entry and everything inside ignorable. SSA needs it outright, because phi-nodes
sit at block entries and nowhere else.

Holding it means splitting at more places than a loose definition would:

- every jump and branch **target**, so nothing lands inside a run;
- what follows a **branch**, which is reachable both ways;
- what follows a **call**, because that is where the call returns to. A `JSR`
  therefore ends a block. The looser convention treats a call as an opaque
  instruction and keeps the run going, which puts the return edge in the middle
  of a block. On this machine it earns its keep twice over: arguments travel in
  A, X and Y with no calling convention, so "what does A hold after this call"
  is precisely the question a boundary exists to ask.

A `ret` is an **exit of this graph**, which is intraprocedural — not a claim
that control goes nowhere. The return edge is real and belongs to the call
graph, computed from call sites, because one `RTS` returns to as many places as
the routine has callers and the block knows none of them. A call's successor
*is* recorded, as the address it returns to; that assumes it returns, which is
stated rather than hidden, because a routine that never returns would otherwise
make the rest of its caller look unreachable, and that is the worse lie.

**And on this machine even that edge cannot be assumed**, which is why each
block carries a `stackDelta`: net bytes left on the stack, computable *exactly*
because a block is straight-line — no branch inside one for the count to depend
on, which is a dividend of splitting strictly. Undefined after `TXS`, which sets
the pointer outright and where saying zero would be a guess.

An ordinary routine ending in `ret` is `-2`: the return address it pops.
Anything else has been at the stack deliberately. Gridrunner has two of 62, and
both are real:

- `$83E2` `PLA TAY PLA TAX PLA RTI` — an interrupt handler restoring registers.
- `$87FE` `PLA PLA RTS` — a routine that **discards its own return address** and
  returns to its caller's caller. Any call graph assuming the ordinary return
  edge is wrong about this one, and the human reference does not remark on it.

Two more blocks have an unknowable delta. That is four addresses in the program
where interprocedural reasoning has to be careful, found by counting, and worth
having before a call graph rather than after.

The invariant is asserted against Gridrunner: every control-flow edge lands on a
block start, zero exceptions, data references excluded since reading a byte
inside code is not control arriving there. It caught a real bug when first
written — `JMP` to the immediately following address had its target discarded by
a filter meant to remove fall-through, and a jump has no fall-through to remove.
450 blocks, exits: 154 branch, 95 call, 69 jump, 70 fallthrough, 62 ret.

An extent can be **declared**, though, which is a different thing from inferring
one: somebody reading the code knows where the routine ends. `mark_function`
takes it, and it is what lets `find_references` say which routine a call came
from. Without one that answer falls back to the nearest preceding flow label,
which on a real routine is usually a local branch target — so "who calls this"
came back naming `b81BC` for two call sites both inside `DrawGrid`.

## The server analyses now, and that is a reversal

The old rule was that the server does not know what a 6502 is. That was about
*interactive latency* — do not round-trip to rename a label — and the browser
still analyses locally and is untouched. But an agent has no local analysis, so
the server grew one, cached per document version and computed only when a tool
asks. It is lazy because it is synchronous: an uncached analysis on the event
loop stalls every connected browser's socket, which is why the O(n²)
`findOverlap` had to go first rather than after.

## MCP lives inside the web server

Not beside it. An agent's edit goes through the same `runOps` a click does and
broadcasts on the same socket, so it lands in an open browser without a reload —
verified end to end, at the definition and at every call site. A separate MCP
process would have had to become a client of this one to achieve that, which is
the same thing with a hop in it.

The transport is **stateless**: what is turn-based is an agent's attention, not
its socket — the client process is long-lived and could hold a stream, so this
is a choice rather than a constraint, and the earlier wording claiming otherwise
was wrong. It costs a fresh `McpServer` and transport per request, which is the
SDK's own pattern for the mode — reusing one silently answers nothing after the
first, so a test sends two requests to hold that.

**Identity rides on the `x-re64-user` header, never in a tool schema.** A model
can omit a parameter, invent one, or claim to be someone else, and removing the
parameter later breaks every schema carrying it. Real auth replaces
`resolveCaller` and no tool changes. It is the same unverified claim the socket
already accepts.

## The tool vocabulary

Orient, read, decide, act, catch up:

| | |
|---|---|
| `list_projects`, `describe_project` | what is here, and how far along it is |
| `read_disassembly`, `list_claims` | structured rows, never rendered text — an agent cannot use character offsets into a text column |
| `find_references`, `find_unnamed`, `find_instructions`, `call_graph` | who calls this, what touches the SID, and the shape of the whole |
| `effects` | what code at an address touches, over a scope the caller names |
| `run_block` | what a routine *does*, by running it |
| `add_claim`, `add_claims`, `set_claim`, `remove_claim` | saying something about an address, and correcting what you said |
| `claims_at`, `list_roots`, `disagreements` | what is already there, where decoding starts, and where the project contradicts itself |
| `list_decoders`, `set_decoder`, `remove_decoder` | decoders the project carries |
| `undo` | the same inverse the CLI and the browser use |
| `changes_since` | what happened while the agent was not looking |

**One noun, so one verb each.** `add_label` and `set_region` were two writes
because an assembler source file has labels and directives, and the machine has
neither — so naming an address and saying what a span holds were the same act
wearing two schemas, with two spellings for an extent and two ways to be refused.
`add_claim` takes a `name`, an `is`, an `extent` and a `root`, any of them, at
least one of them.

Three things fell out, and the third is the one that keeps the surface from
growing back:

- **`extent` replaced the `end`/`length` pair**, so the two ways of getting a
  span wrong — passing both, passing neither — are gone rather than validated.
- **Adding always adds and correcting is by id.** Every write returns the ids it
  made, because `set_decoder` returned none and two agents in one run made the
  same decoder twice looking for it. `set_claim` is partial, and **`null` clears
  a field**, which is the distinction `Partial<>` cannot make — without it a root
  could be declared and never taken off.
- **There is no `add_root`/`remove_root`.** A root is a *field on a claim*, so
  those would be a second spelling for `add_claim root:` and `set_claim
  root: null`. `list_roots` exists because a **read** has nowhere else to live:
  `describe_project` counts them, which answers "is anything decoding" and not
  "what did I declare, and can I take it back". A root with no id is inherent to
  a file rather than something the project said.

**No deprecation aliases.** An MCP surface is rediscovered from the schema every
session and has no persisted callers, so a retired name is a second vocabulary to
learn for nothing. A transport test asserts the old names are *absent*, not
merely unmentioned.

Three things the tools say about themselves, because a confident wrong answer is
worse than a gap:

- **Every write returns an instruction delta.** `mark_function` on an address
  nothing reaches reports `delta: 3` — the decision decoded three instructions
  that were invisible before. That is the feedback that tells an agent its
  judgement was worth something, and it is why the tool returns more than `ok`.
- **`find_references` states its own blind spot on every answer.**
  `extractReferences` handles absolute addressing only, so a routine reached
  through zero-page or an indirect jump appears to have no callers. An agent
  that trusted it silently would conclude the opposite of the truth.
- **Auto-generated labels are marked `writable: false` and their ids withheld.**
  Those ids are derived, not stored. Handing one to a model invites a write
  carrying an identity nothing owns.

## Asking what a routine does, two ways

The read tools answered what code *is* — rows, labels, references. None answered
what a routine *does*, which is what naming it requires. Two tools, deliberately
kept apart, because they answer different questions with different standing:

- **`effects` at `follow: "block"`** is static: what the block at an address
  reads and writes, unioned over its lifted operations. True for every input.
  Sound only because a block is straight-line, which is the analysis dividend of
  splitting strictly — at calls and at every jump target — rather than loosely.
- **`run_block`** is concrete: execute it with values the caller chose. It
  reports the address a computed operand *actually reached* — with `X=2` the read
  was `$1502` — which is the question no static reading can answer, and it
  reports which way the branch went, which turns a conditional into a decision
  you can watch being made.

**One block, and not a routine.** A block has no branch inside it, so the
instructions that run are known before it starts and no path is chosen on the
caller's behalf. Running further means following jumps whose targets depend on
state nobody supplied — an emulator, with everything an emulator has to be right
about. The scope is what makes the answer honest, not a limitation to be lifted
later.

**Every value says where it came from, three ways**, because collapsing them
would let the weakest borrow credibility from the strongest:

| | means | worth |
|---|---|---|
| `given` | the caller vouched for it | as good as the caller |
| `image` | the program as loaded | true of a constant table; usually false of anything initialised at runtime |
| `unknown` | nothing knew | read as zero, and zero produces a real-looking result |

The last two each raise their own warning. A result that silently assumed zeros
looks exactly like one that did not, which is the failure mode worth spending
output on.

A label is attached to a read only on an exact match or *inside a declared
extent*. `explosionXPosArray` declares none, so a read of `$1502` is reported
bare rather than as `+2` — the same rule operand rendering follows, and a reason
for an agent to declare extents.

## A schema is not covered by testing what it calls

Both `run_block` bugs got through a green suite, and the reason is structural
rather than an oversight: `Workspace` is tested thoroughly and network-free, and
the schema in front of it was tested by nothing. Everything the tests exercised
worked perfectly; the tool could not be called at all.

- `z.record` over an enum of the register names makes every key **required**, so
  passing one register was rejected for omitting the other ten.
- Byte values had to be numbers while addresses could be `$8100`, so the API was
  inconsistent with itself and every caller found out by being rejected.

Neither is visible from inside. Tool schemas are now exercised over the real
transport in `src/server/mcp/transport.test.ts`, which is the only layer where
this class of bug exists. The rule that follows: **if a tool grows an argument,
it grows a transport test**, because "the logic is tested" is exactly the belief
that let these ship.

## What belongs in the vocabulary, and what does not

A tool earns its place by being **reusable**, not by being cheap. The analysis
behind one may be arbitrarily expensive — `effects` walks a call graph to
a fixpoint — and that is fine. What disqualifies a tool is answering *one
project's question*: `do_the_work_for_me()` wearing a specific name.

One useful signal, not a rule: **would you put this in a human's UI?** It is
quick to answer and it fires reliably in one direction — a capability a person
would reach for is a capability. `find_bytes` is a hex-editor staple and belongs
in a search box as much as in a tool call. `find_table_users` is not something
anyone would put in a menu; it is `find_instructions` with a range, once the
addressing modes are handled, and `find_hardware_access` failed the same way and
was folded in.

**A negative answer proves nothing**, and treating it as a test would delete
several tools that exist for good reasons. Agents genuinely differ from people:

- **They cannot see.** `read_disassembly` returns fields rather than rendered
  text because character offsets into a column are useless to a caller — that is
  the finding the whole MCP surface was built on. `whoami` exists because a
  person sees the identity picker and an agent sees nothing.
- **They are not pushed to.** `changes_since` is a poll standing in for the
  socket a browser has.
- **They work in bulk.** `set_labels` and `bind_constants` are batch because a
  person names one thing at a time and an agent names forty.
- **They need to state assumptions.** `expectVersion` is a conflict dialog that
  cannot be shown.

So the criterion that actually decides is **reusability** — does this answer a
question about programs, or about *this* program. The UI question is a fast way
to notice narrowness, and the rest of the time it is quiet rather than negative.

Corollary worth stating: when an agent invents a narrow tool, the finding is
usually that the *general* one is missing something — not that the narrow one
should exist. `find_hardware_access` was invented because `find_instructions`
could not see indirect writes, which is a gap in the general tool.

## Finding the character set, and what actually cost the time

Experiment 2's readers all had to work out that `$8E00` was a character set.
Measuring the transcripts settles what was hard, and it was not what it looked
like:

| reader | calls | `find_undecoded` | reached `$8E00` | first decoder |
|---|---|---|---|---|
| agate | 105 | 10 | 26 | 27 |
| amber | 248 | 17 | 24 | 25 |
| basalt | 119 | 14 | 28 | 47 |

**Locating was never the problem.** All three asked what was unexplained within
the first seventeen calls and were looking at the right span by call 28; two ran a
decoder on the very next call. The budget went on deciding *what the bytes were*.

A statistical hint was considered and rejected. It works — bit-pattern symmetry
separates the charset from every code window on this binary, where entropy does
not — but it is the wrong kind of answer: mirror symmetry holds for simple glyphs
and fails for complex ones, for most bitmaps and sprites, and reports flat `$00`
or `$FF` filler as graphics. A confident wrong answer about what a span *is* is
the failure this project refuses everywhere else.

**The evidence is in the code, and following it needs no new mechanism.** The
whole chain for Gridrunner:

```
find_instructions from:$D018 to:$D018
  $810B  STA ($02),Y  →  $D018 = $18      in InitializeGame

$18 puts the VIC character base at $2000

find_instructions from:$2000
  $82F1  STA charSetLocation,X            in LoadCharacterSetData
  $82EE  LDA characterSetData,X    ← $8E00
```

Every link is a fact about the program. That chain is what the interpreter-based
resolution above was built to make followable — with the pointer folded but not
the index, step one returns three indistinguishable sites all claiming `$D000`,
and the trail stops. It is pinned by a test for that reason.

The general lesson, worth more than the instance: **ask what uses a span, not
what it looks like.** Hardware writes say what a region is *for*, and on this
machine they are the strongest available evidence — which is also why they must
be resolved precisely enough to name a register.

## The export had one writer, and it failed in silence

Experiment 4 wrote into the document for a quarter of its run while the `.re64`
never moved, and **every tool answered `ok`**. Three faults stacked, and each is
worth keeping apart because each is a different lesson.

**The serializer assumed its own output.** `insertEntry` finds the line whose
address sorts after the new one and splices there. On a pretty-printed file
every entry spans five lines, so it matched the `"address"` line *inside* an
object and put the new entry between that object's own fields. `upsertLabel`'s
`parseProject` guard then threw — correctly — and `applyOps` abandoned the whole
batch, including the 47 labels that were fine.

A `.re64` is ordinary JSON and anything may write one, so the line editor has to
cope with a shape it did not produce. It now reformats such a file once, through
the escape hatch it already used when a layer had no array to edit at all, and
every edit after that is a one-line diff again. Layout is lost on a file that
never had the layout this preserves; the alternative was corruption.

**The failure reached nobody.** The live writer is a debounced timer, and
`detached` swallows what it throws on the grounds that losing the server is worse
than losing a write — which is right, and is not the same as losing the *record*.
`ProjectStore` now keeps the last failure until one succeeds and
`describe_project` reports `exportStale`, so the one question that mattered —
"is what I am writing reaching the file?" — has an answer.

**There was no tool to reach the export at all, and none to ask about it.** The
agent went looking for `save_project`, found nothing, and located
`POST /api/export` by reading the server's source. `export_project` now returns
the `.re64` text.

**Writing it to disk was tried and taken back out**, which is worth recording
because the reasoning failed twice in opposite directions. First it was waved
through as by design — wrongly, since `re64 export` writes the file and a
capability the CLI has and the tool surface does not is a gap, not a principle.
Then it was built, and that was worse: it overwrote **the file the project was
imported from**, which this file says elsewhere is out of the picture the moment
it is imported — and in the run that prompted it, that file was the experiment's
own fixture.

The deeper objection is that a path on disk is not a thing an MCP server can
assume it shares with its caller. It works for an agent on this machine and means
nothing over a network, so it is the wrong shape for the surface it was added to.

**The question underneath was not about files at all.** *"An agent cannot save
the project and cannot tell that it has not been saved"* is written by somebody
who believes there is a save step. There is not — the document took every edit as
it landed — and nothing said so, so the agent went looking for a save button,
found a stale file instead, and had the wrong model confirmed. The bug made the
misunderstanding look correct.

Two things came out of that, and neither is a file:

- **Server instructions.** The MCP `ServerOptions.instructions` field carries
  what no per-tool description can, because it is a fact about the system rather
  than about any one call: the project is live, every edit is durable when the
  tool returns, there is nothing to save. Worth noting how this was nearly
  missed — `McpServer` is dynamically imported here behind a hand-written type
  that had only the first constructor argument, so passing instructions failed
  to compile against a signature the SDK has always had. **Narrower-than-reality
  is the failure mode of hand-typing a dynamic import**, and it is invisible
  until something reaches for the part that was left out.
- **Tags.** A named point, in the git sense, and cheap enough to be worth having
  for that reason alone: it copies nothing. `cursor` is an `ops.seq`, which
  `changes_since` already takes, so `changes_since(tag: "before-renames")` needed
  no new machinery. `version` is the projection hash, which answers the
  *different* question of whether the project has actually moved — an edit and
  its undo move the count and not the content, and a tag reports both.

  Keyed by **name**, unlike everything in the document. The reason ids exist
  there is that a rename must not change what a thing is; a tag is never edited,
  so that does not arise, and git names tags the same way for the same reason.
  It also stays out of the export, alongside `ops` and `history`, which is the
  parked question about history travelling with a project rather than a new one.

Still open, and not built: getting the bytes out cheaply. Text costs tokens on
every call, and an MCP **`ResourceLink`** — a uri and mimeType in the tool result,
with the client fetching the body through `resources/read` — is the protocol's
own answer, verified present in the shipped SDK alongside base64 `blob`
resources. Nobody has needed it yet.

The general shape, worth more than the instance: **a write path whose only
failure channel is stderr is a write path with no failure channel.** Nothing
downstream of the swallow could distinguish "saved" from "silently not saved",
and no test could either, because every layer in isolation behaved correctly.

## An operation nothing emits is a feature that exists only from the inside

`meta.set` had a type, an `applyOp` case and a computable inverse, and
`diffProjects` never produced one — so `set_project_description` reached the
document, showed up in `describe_project`, and was absent from every export.
`diffProjects` now diffs `name` and `description` like everything else.

The same shape as the `layer.add` gap this file already records: the vocabulary
being closed is checked by the compiler, and *whether anything ever emits a
member of it* is not.

## Smaller things experiment 4 found, and one it got wrong

Fixed, each because the answer's shape was the problem rather than its content:

- **`list_labels` advertised an address range it did not have.** `labels()` took
  one all along; the schema in front of it did not, so "what is named in zero
  page" meant fetching all 336 and filtering locally.
- **`find_immediates` named no routine**, where the neighbouring
  `find_instructions` does — and "does this value mean the same thing over
  there" is unanswerable from bare addresses.
- **An annotation inside an instruction is accepted and renders nowhere.** True
  of labels, and equally of comments; two were lost that way. Both writes now
  warn and name the instruction's start.
- **`bind_constants` was all-or-nothing**, so one bad entry rejected 167 good
  ones — in both runs that used it. It is partial now and reports what it
  declined. A batch tool that fails whole is not a batch tool.
- **A region's `view` could not be cleared.** Omitting the argument reads as
  "leave it alone", so an explicit `""` now means "remove it".
- **`export_listing` took `lines` where `set_region` takes `end`.** It takes
  both.
- **A long `inline` comment cannot wrap** — correctly, it shares a row — and
  nothing said so, so a paragraph ran a listing line to several hundred
  characters. The write hints; it does not refuse, because what fits depends on
  the instruction beside it.

Two claims did **not** reproduce, and are recorded rather than fixed:

- **The text decoders' high half.** `fromScreenCode` masks `& 0x7f` and
  `fromPetscii` maps `$C1-$DA` to `A-Z` already; `C3 C2 CD 38 30` decodes to
  `CBM80` in PETSCII today. Reading it as *screen* codes gives graphics, which
  is correct — the cartridge signature is PETSCII.
- **A duplicated comment block in the listing.** Each renders exactly once from
  the model; the duplication is an artifact of the agent's own paging loop
  concatenating overlapping pages.

## How far to look is the caller's question, not the tool's

`block_effects` and `routine_effects` were two fixed points on one axis, and the
axis was never named. The tell was in `block_effects`'s own description, which
apologised for its scope and pointed at the other tool: *"at a routine head that
begins `JSR` this answers about a single instruction — correct, and almost never
what you wanted."* An agent had to discover that by trying it.

So one tool, `effects`, with `follow`:

| | |
|---|---|
| `block` | the straight-line block here — **exact**, because there is one path |
| `routine` | its own blocks, not entering what it calls |
| `calls` | plus everything its callees reach, transitively — the default |
| `returning` | `calls`, refusing to enter a callee that never comes back |

`returning` is the answer to what this file previously parked as a design
question: `routine_effects` was sound and useless on Gridrunner's main-loop
subsystems, because all of them can reach a routine that resets the stack and
jumps into the death path, so the may-analysis unioned most of the program. Of
the two proposals — report effects up to the first non-returning transfer
separately, or let a caller mark a node as not returning — the first turned out
not to need a second report at all. It is a **scope**, which is the axis that was
already there.

Measured on the reference project, as a share of every slot the program touches:

| routine | `calls` | `returning` |
|---|---|---|
| `sub_8753` | 47% | 13% |
| `sub_8635` | 55% | 26% |
| `sub_88C9` | 53% | 28% |
| `ReenterMainGameLoop` | 86% | 71% |

The last row is not a failure. It is the main loop, and a main loop does touch
most of the program — which is the check that the cut is bounding the right
thing rather than just making numbers smaller.

Three things this needed that were not obvious:

- **A bounded answer has to be built out of bounded answers.** It is a second
  fixpoint, not a flag on the first: folding a callee's unbounded `total` in here
  would leak the whole program back through one hop.
- **`stoppedAt` names every place it stopped**, so this is never a claim that
  control ends there — and asking about one of those addresses directly gives the
  rest. Truncating in silence would be the confident wrong answer this project
  refuses everywhere else.
- **It cuts where the program provably leaves, never where the analysis is
  unsure**, and getting that wrong is the most instructive part. `ReturnBehaviour`
  reported `skipsFrames: 0` both for a routine that resets the stack pointer and
  for one whose depth two paths disagreed about — opposite kinds of statement,
  one a fact about the code and one an admission about the pass. A cut keyed on
  that threw away whole routine bodies: **SCNKEY reported touching nothing at
  all**, because two paths reach one block at different depths. So the behaviour
  now says which of three it is — `abandons`, `skips`, `ambiguous` — and only
  `abandons` cuts.
- **Calls and tail jumps both**, because a program leaves by whichever it likes.
  Gridrunner's top level is a `JMP` chain, so its death path is reached by a tail
  jump and cutting only calls catches none of it. Cutting only tail jumps is
  equally wrong the other way: a KERNAL entry point *is* a bare `JMP` to its
  implementation, so that would report the effects of a three-byte stub.

The scopes differ in **standing**, not only in width, so the answer says which
one it is: `block` is exact, and everything above it is a union over paths — what
the code *can* touch, never what it must.

## The tools agents invented

Experiment 2's transcript records seven tools readers reached for that did not
exist. That list is worth more than any of their prose, because inventing a tool
name is an unguarded statement about what the API should have had — and all
seven are now built or answered.

Two of them turned out to be **one** tool. `find_hardware_access` over
`$D000-$DFFF` and `find_instructions` with an operand pattern are the same
question with the range filled in, so building both would have been the
mechanism-per-oddity mistake. `find_instructions` takes a mnemonic, an operand
range, or both, and its description names the ranges — `$D000` VIC, `$D400` SID,
`$DC00` CIA — so the hardware question stays discoverable without a second tool
to find.

Each site says **which routine it is in**, which is what makes a list of fifty
addresses usable rather than a haystack: "what makes a sound" comes back as 57
stores across 13 named routines rather than 57 addresses.

That attribution needed one correction worth keeping. `routineEntries` took
`function`-typed labels only, so everything reachable *solely from where the
program starts* belonged to no routine — most of the initialisation code, showing
as `in -` on half the answers. An `entry` label is a routine root as much as
anything a `JSR` points at.

## A change cursor, because the agent has no socket

Statelessness removes the channel by which anything learns a project moved. A
browser is pushed to; an agent would otherwise re-read the whole disassembly and
diff it — roughly 25K tokens per poll on a 64K project, plus a full analysis
each time. `changes_since(cursor)` returns what was recorded after that point
with author and time, and the cursor to use next.

This only works because attribution is **unified**: socket edits, HTTP writes,
CLI writes, and agent writes all leave the same record. A feed showing agent and
CLI edits but not the human's would be blind to precisely what an agent most
needs to see. It also means the log must be **append-only** — the old
`DELETE`-and-reinsert renumbered every entry on each undo, so a held cursor
silently came to mean something else.

## What two readers on the claims model actually did

Experiment 8: Gridrunner from nothing — one PRG layer, five instructions
decoding a cartridge header — one reader alone and two sharing a document, on
identical blank projects. The first run of this binary that did not start from
somebody else's annotations.

**Both pairs reached the same account of the program, and neither needed the
oracle.** The chain each walked: `CBM80` at `$8004` says cartridge, so `$8000`
and `$8002` are vectors and the five instructions were a header being misread as
code — declaring that took the decode from 5 to 1480. Then `find_instructions
from:$D018` resolved the one indirect write (`STA ($02),Y`) to `$D018 = $18`,
putting the character base at `$2000`, and a copy loop reading `$8E00` made those
512 bytes a 64-glyph font. Every string in the game is written in it, and the set
contains only the nineteen letters those strings need — no C, K, Q, W, X or Z.

**They partitioned in two messages and never renegotiated.** One proposed a
split, the other noticed the halves overlapped and tightened the cut. Nobody
asked for a lease, a lock or a claim mechanism — the third run in a row to
decline the coordination this file deliberately did not build.

**Zero page is the one region an address split cannot divide**, and that is where
they collided: `$0B`, `$0C` and `$35`, confirmed in the log. It went well, and
the reason is mechanical rather than social. Adding is additive and pins whatever
was already rendering, so the second name landed *beside* the first and the tool
said so. Both readers wrote the same sentence unprompted: **two names at one
address was not the failure mode, it was the mechanism that made the
disagreement visible.** One conceded three readings, `set_primary_name`'d to the
other's, and kept their own reasoning as a comment recording which lost and why.

The finding that matters most is one of them's summary: *in a session with two
writers deliberately trying to collide, the API destroyed more of my work than my
collaborator did, by roughly twenty to nothing.* Every one of those twenty was a
defect introduced by the two days of work immediately before the run, and they
are listed in the section above. The collaboration model held; the write path had
one old road left in it.

**Nobody named a target once, in 724 calls.** Each project had exactly one, so
there was no reason to — which means the norm-rather-than-rule choice is
untested rather than vindicated. The next run with two targets is what answers
it.

**What they reached for that is not there**, which is the list worth more than
the prose: `bind_decoder` (twice over, by both readers, when `view: "snippet:"`
turned out to be a no-op), `find_strings`, `render_screen`, `screen_address`,
`describe_character`, `find_char_uses`, `list_routines`, `list_hygiene`,
`list_warnings` guessed as `warnings` and `hygiene`, `remove_entry_point`,
`compare_spans`, `list_tools`. Three of those cluster: on a program whose entire
state lives in screen memory, converting `$0592` to row 10 column 2 was the most
repeated arithmetic of both runs, and no tool does it.

**Two things worked better than either reader expected**, and both are worth
knowing. `is: "bitmap"` with `view: "char:8"` renders a character set as legible
glyphs *in the plain text listing* — one reader resolved two glyphs that way
after the decoder path failed them. And `run_program` with the KERNAL linked in
turned an inference into a photograph: five instructions without it, eight
million and a drawn title screen with it, the captured screen matching the other
reader's inferred reading line for line. That is a genuine cross-check rather
than two readings of one piece of evidence.

**And one trap worth recording.** `run_program`'s capture is a `.prg` with a load
address in its first two bytes. Added back as `raw`, every address in it is out
by two — a reader spent ten minutes about to report a layout bug in the game
before the other spotted it. The tool's own hint says `prg`; nothing warns when
you do otherwise.

## The experiments this is for

Three, escalating, each adding one variable. The rare thing here is an
**oracle**: `assets/gridrunner/gridrunner.asm` is 65KB of human reverse engineering, so
there is a gold standard to compare against.

1. **Expressiveness audit.** Give an agent the project *and* the human's
   disassembly, and have it reproduce that through MCP. It is not a test of
   whether the agent can reverse engineer — it has the answer — but of whether
   the API can *say* what a person said. Score friction, not similarity. Already
   known to find something: comments attach only to labels and regions, so the
   human's instruction-level commentary has nowhere to live.
2. **Convergence.** Five agents, no labels, only the disk image — on **five
   independent clones**. Shared, they would see each other's names and converge
   partly by contagion, which measures influence and calls it agreement. This is
   the last moment it can be measured uncontaminated.
3. **Collaboration.** Shared document, a chat, a person watching live. Chat
   only — post, read, see who is here. **No claims, no leases, no work
   assignment**, because building coordination machinery in advance decides what
   coordination looks like before anyone has seen any.

   Deliberately **open-ended**: there is no hypothesis being tested here, and an
   earlier draft of this line named one — whether agents invent claim-and-release
   — which was this file's author guessing, written down where it then read as a
   shared premise. Naming an expected finding in advance is how you stop seeing
   the others. Run it, watch, and report what happened.

Two rules that make these produce measurements rather than anecdotes:

- **Take the agents' reports and the request log together.** A report carries
  what a log cannot: intent, what they expected to find, why something was
  awkward. The log carries what a report cannot, because an agent is an
  unreliable narrator of its own difficulty — it invents a tool name and then
  describes the invention as a gap, and works silently around whatever actually
  hurt. Read the reports for what to look for and the log for whether it
  happened. Where they disagree the log wins; but the report is what makes a
  line in the log mean anything.
- **Only fix what blocks the next experiment** — where "fix" means *build the
  capability an agent wished for*. Everything else becomes a list and stays a
  list, or the first experiment's output consumes every week that follows.

  **It is not a reason to leave a confirmed defect standing**, and reading it
  that way once cost a whole round. The rule protects against chasing every
  wish; a bug that has been reproduced and located is not a wish. In production
  you might leave one alone to keep a measurement clean — here the cost runs the
  other way, because the next run spends its budget rediscovering what is
  already in hand. Both of experiment 5's builders lost a full rebuild to the
  same wrong `wrote` list, which is two agent-runs spent on a bug that took
  twenty minutes to fix once it was believed.

## Connecting a client

```
claude mcp add --transport http re64 http://127.0.0.1:5164/mcp \
  --header "X-Re64-User: <user id>"
```

The user id is one from `list_users`; the server does not verify it.

## A tool built on a rhetorical flourish, and taken back out

`changes_at` answered "who has already touched this address" — `git log` with an
address range as the path. It lasted an hour. Worth recording, because the way it
got built is more instructive than the tool was.

Both readers in experiment 3 collided three times, and one of them wrote: *"the
write side is complete and the who-else-touched-this side is not."* That sentence
is a generalisation of the collision it had just hit, and it was taken as the
finding. **The log says otherwise**, and this file already carries the rule that
was not applied: where a report and the request log disagree, the log wins.

```
23:36:59  gfx   set_decoder      <- writes it
23:37:07  gfx   list_decoders    <- checks, 8s AFTER
23:38:34  lead  set_decoder      <- writes it
23:38:39  lead  list_decoders    <- checks, 5s AFTER
```

Neither checked before writing. Both called `list_decoders` immediately after, to
obtain the id `set_decoder` did not return — so that collision was not a missing
query and not a check-then-act race, and the fix was to return the id. Likewise
`changes_since(0)` "returning empty when it mattered" was empty because nothing
had happened yet, fifteen minutes before the collision it was blamed for.

The three collisions, honestly attributed:

| collision | cause | fix |
|---|---|---|
| one constant bound in two places | a real lookup gap | `boundAt` on `list_constants` |
| the duplicate decoder | `set_decoder` returned no id | it returns one |
| identical header edits, 4s apart | genuine simultaneity | none; no query prevents it |

None of them wanted a history-by-address query. **A capability that answers no
question anybody asked is the thing the vocabulary rule exists to refuse**, and
"a person would want it in a UI" is the *quiet* signal in that rule rather than a
licence.

**Parked, from the same conversation:** rather than a filter per question,
snippets already are the mechanism for expressing logic this project cannot
anticipate — so a query over the ops log could be a snippet, reusing the SES
sandbox verbatim. The cost is not safety, which is unchanged, but the contract: a
decoder is `bytes -> data` and `validateDecoded` checks the shape it returns. A
log query is `records -> records`, which widens a snippet from "numbers out" to
"JSON out" and leaves nothing to validate. Nothing needs it at this size —
scanning the whole log is cheap — so it stays written down rather than built.
