# The experiments, and what each one changed

Ten runs. They exist to find gaps in re64 by watching agents hit them, rather
than by imagining what an agent would want — so what matters about each is not
whether it "went well" but which line of code it moved.

Third companion to `docs/model.md` and `docs/api.md`. Those two are the state;
this is where most of it came from.

---

## How they are read

**The reports and the request log together, and where they disagree the log
wins.** An agent is an unreliable narrator of its own difficulty: it invents a
tool name and then describes the invention as a gap, and works silently around
whatever actually hurt. The report says what to look for; the log says whether
it happened.

`npm run experiments:transcript -- <file.mcp.jsonl>` counts what a report
cannot: tools reached for that do not exist, refusals by reason, whether
`target` was ever named, and addresses two readers both wrote about.
`npm run experiments:collisions` counts writes where one agent's conclusion
replaced another's.

**Group by project, or the number is nonsense.** Experiments 2 and 5 put agents
on *independent clones*; the log is per server, so a pass ignoring the `project`
argument reads three projects as one and counts every agent's independent naming
of `$8000` as a collision. That mistake inflates the answer fifteenfold, and the
inflated number is the more persuasive one.

**Only fix what blocks the next run** — where "fix" means build the capability
an agent wished for. Everything else becomes a list and stays a list. That is
not a licence to leave a confirmed defect standing: the rule guards against
chasing every wish, and a bug that has been reproduced and located is not a
wish.

## The oracle, and its limits

`assets/gridrunner/gridrunner.asm` is a complete human reverse engineering of
the same binary — mwenge's `matrix`, public domain. It is **a linear sweep with
names, not a reachability analysis**, so:

- coverage is not comparable — a sweep names everything it sees, a walk names
  what it can reach;
- it asserts things that are not so, presenting dead code as routines;
- it is silent about reachability, which is what re64 computes.

Use it for **expressiveness** — what the API cannot say that a person said. Not
for scoring.

---

## The runs

### 1 — Expressiveness

**Question.** Give an agent the project *and* the human's disassembly, and have
it reproduce that through MCP. Not a test of whether the agent can reverse
engineer — it has the answer — but of whether the API can *say* what a person
said. Score friction, not similarity.

**What it changed.** A label at a mid-instruction address silently corrupted the
decode — the one way to get a *wrong* listing rather than an incomplete one. And
comments attached only to labels and regions, so the human's instruction-level
commentary had nowhere to live: commenting an instruction meant inventing a name
for it. Comments became their own objects with their own ids.

Run twice, the second after ten fixes, which is the only run here with a
before-and-after.

### 2 — Convergence

**Question.** Five agents, no labels, only the binary, on **five independent
clones**. Shared, they would see each other's names and converge partly by
contagion, which measures influence and calls it agreement. The last moment it
could be measured uncontaminated.

**What it changed.** Three things, none of them convergence:

- **The first attempt was void, and that is recorded rather than buried.**
  `CLAUDE.md` is injected into every subagent's context and it names addresses
  in this program. The re-run had to start outside the repository.
- **`read_bytes` did not exist**, so every reader scraped the hex column out of
  rendered listings with a regular expression — a lot of work to undo formatting
  that existed for a human.
- **Seven tools were invented**, and that list was worth more than any of the
  prose. All seven are now built or answered. `whoami` is one of them: identity
  rides on a header, so there was no way to ask who you were.

It also exposed that `resolveCaller` ended in `?? known[0]`, so three agents
announcing themselves as `reader-1/2/3` had every edit recorded as the first row
of the users table, silently.

### 3 — Collaboration

**Question.** One shared document, a chat, a person watching live. **No claims,
no leases, no work assignment**, because building coordination machinery in
advance decides what coordination looks like before anyone has seen any.
Deliberately open-ended: an earlier draft named an expected finding and that
read as a shared premise, which is how you stop seeing the others.

**What it changed.** `set_comment` matched by `(address, placement)` and reused
the id it found — an upsert keyed by *slot*, justified as "one person changing
their mind". True of one author, false the moment there are two: an agent's
comment silently replaced another's, and **three of four readers across two runs
invented the same bad workaround**, using the `inline` slot as a second channel
to dodge the collision. One asked for `append_comment` by name.

A control run without personas found the other half: two labels sharing a name
render identically, so `scoreDigits+4` meant different addresses depending on
which you read. Both neutral readers hit it; one called it *a wrong answer that
looks right*.

### 4 — Beat the human

**Question.** Seed the project with the human's own work and ask an agent to
exceed it. Not reproduction — improvement.

**What it changed.** The largest silent failure yet found: it **wrote into the
document for a quarter of its run while the `.re64` never moved, and every tool
answered `ok`**. Three faults stacked — a line serializer that assumed its own
output, a debounced writer that swallowed what it threw, and no tool that could
reach the export at all. The question underneath was not about files: *"an agent
cannot save the project"* is written by somebody who believes there is a save
step, and the bug made that misunderstanding look correct. Server instructions
now say there is not.

It also found `meta.set` had a type, an inverse, and no emitter — so
`set_project_description` reached the document and was absent from every export.

Two of its claims did **not** reproduce and are recorded as not reproducing.

### 5 — Building a project

**Question.** A disk image and nothing else. Get from that to a project that
decodes. Every earlier run was handed a project that already existed.

**What it changed.** Two agents, independently, **both wrote their own 6502
interpreter outside re64** — both identified the packer as Exomizer 2, both
snapshotted the decrunched image, and they finished four instructions apart
(3452 and 3456) having never seen each other's work. Static analysis of that
disk tops out at **141 instructions**. As one put it: *"Every commercial C64
disk is crunched; without this, building from a disk image builds a project of
the decruncher."*

So `run_program` exists. The stop rule had to be corrected by running the real
thing: "stop where no layer supplies a byte" fires on the program's own
relocated code, and Camels moves its decruncher onto the stack page.

Both builders also lost a full rebuild to the same wrong `wrote` list — two
agent-runs spent on a bug that took twenty minutes to fix once believed.

### 6 — Read the KERNAL

**Question.** 8KB of system ROM, nothing annotated. Not a game: entered through
a jump table, threaded with indirect vectors through RAM, with a public
interface documented for forty years.

**What it changed.** Fifteen of the 42 documented entry points are a three-byte
jump through a RAM vector, so decoding from the jump table gives **669
instructions** where declaring the sixteen targets gives **2583**. The agent
worked every target out by hand and recorded that it had — `$F1CA` for
`CHROUT`, `$F13E` for `GETIN` — which is a great deal of effort to recover
something the memory map can be asked for. An indirect jump is still not
followed, because a vector holds whatever the program last wrote there, but the
warning now names the cell, what it currently reads, and `mark_function` as the
remedy.

Downstream: the KERNAL effects table, derived from a ROM and committed while the
ROM never is.

### 7 — Collaboration at scale

**Question.** Three readers, one document, Revenge of the Mutant Camels
decrunched — 47KB, ten times Gridrunner, and the first program here big enough
that two readers are not in the same routine because there is nowhere else to
be. Every collaboration run before it measured crowding.

**What it changed.** They **partitioned themselves with no machinery for it** —
*"I lost a race for the code, so I took the data"* was the whole negotiation.
648 calls, unexplained bytes from 40,359 to 13, and nobody asked for a claim or
a lease.

What they collided over was **naming, and it was invisible**. `set_label` was an
upsert keyed by address, so it renamed rather than added: for three authors it
destroyed **123 names across 74 addresses and told nobody**, writer or loser,
both getting `ok`. The losses were disagreements rather than duplicates —
`jumpTimer` against `jumpVelocity` — which is exactly the outcome a shared
document exists to prevent.

That is what produced the claims vocabulary: adding always adds, correcting is
by id, and the one thing anybody sets is which name renders.

Two more: an **extent was shared state nobody could see** — it reshapes every
operand in its range and no read tool reported it, so two readers each hit the
same 2K extent and each blamed the other. And **`select_target` was shared, so a
whole target went unread**: reading another view meant changing it for
everybody, which nobody was willing to do.

### 8 — Gridrunner from nothing, one reader against two

**Question.** The first run on this binary that does not start from somebody
else's annotations: one PRG layer, five instructions decoding a cartridge
header. One reader alone and two sharing a document, on identical blank
projects. Same program as the earliest runs, against a model and an API that
have both been replaced since.

**What it changed.** Six defects in the write path, every one introduced by the
work immediately before the run, and two readers found them independently:
`add_claim` with a `root` was a **destructive upsert**; `root: "location"` was
stored as `"entry"`; `add_claims` dropped the `comment` on any claim that also
said what the bytes were; `did` reported stored offsets as addresses; batch ids
were positional and landed six corrections on claims nobody had looked at; and
`view: "snippet:<id>"` was accepted everywhere and stored nowhere.

**The collaboration model held.** Both readers wrote the same sentence
unprompted: *two names at one address was not the failure mode, it was the
mechanism that made the disagreement visible.* They partitioned in two messages,
collided only on zero page — the one region an address split cannot divide —
and one conceded three readings and kept their reasoning as a comment saying
which lost and why.

And the summary that matters: *in a session with two writers deliberately trying
to collide, the API destroyed more of my work than my collaborator did, by
roughly twenty to nothing.*

Nobody named a `target` once, in 724 calls — both projects had one, so the
optional-but-reported design is untested rather than vindicated.

---

### 9 — Two readers, an editor, and an article as the deliverable

**Question.** Not coverage. Two readers on Revenge of the Mutant Camels with the
machine model and the evidence model, plus a third agent whose job was to write
an accessible, evidence-rooted article about what they found — and who could
refuse a claim, demand a picture, and would not release the readers until the
piece was done.

**The prior memo changed the run, and improved it.** The readers found 249 lines
of findings from experiment 7 on the same binary within ninety seconds, and
flagged it rather than transcribing it. The editor's response is the most
productive instruction anybody gave in ten runs: *anything already in that memo
is not news unless you can show it to me — a sentence I cannot photograph, play
or watch happen is the weakest thing I can print.* Three of the article's best
findings are **corrections** to that memo, and each came from somebody being made
to demonstrate a claim rather than restate it. An answer key raised the floor
instead of spoiling the run.

**What it changed.**

- **`composeScreen` drew no sprites**, found by a control experiment rather than
  from documentation — poke a filled sprite into RAM, enable it, run, and watch
  nothing appear. All eight sprites' registers were being stored and none was
  ever read, which is the sixth instance of the shape this file already names:
  the state was complete and no consumer reached it. Sprites now render, with
  expansion, multicolour and priority; `src/core/c64/sprite.test.ts` is the
  coverage, because Gridrunner turns out to enable no sprites at all and its
  acceptance test therefore says nothing about them.
- **The codename allocator handed out a name that was still in use.** The server
  was rebuilt and restarted mid-run; the lease map is memory, so the pool began
  again at the top and the editor was issued `basalt` while the reader holding
  `basalt` was online. Two of its messages are recorded in that project's chat as
  spoken by somebody else, permanently, because a message records how its author
  was named *at the time* — the right rule, resting on an assumption that a
  codename identifies one participant. `freeCodename` now excludes every name the
  sessions table remembers.

**An almost-faithful picture is worse than a broken one**, and the editor turned
this project's own rule on itself. Unable to photograph sprites, it reconstructed
them from the game's own object table and captioned the composite honestly. Set
beside a true capture of the same frame, the reconstruction had the right sprite
pointers, the right colours and the right Y for all eight — and was wrong about
width, and about the X of five of them by exactly 256, because the ninth X bit
lives in `$D010` and the expansion bits in `$D01D`/`$D017`, none of which the
object table contains. *Nobody checks an image that looks correct.*

Chasing that discrepancy decoded three per-zone fields nobody had: `+$98`,
`+$99` and `+$9A` are bitmasks over the eight creature types for multicolour,
double height and double width. And `+$9F`, previously written off as a reserved
byte, is fetched by the loader and overwritten on the very next instruction —
read once a wave since 1984 and discarded every time.

**The restart is the first evidence for a property this repository only argued.**
A live analysis survived replacing the binary underneath it: document, claims,
scenarios, captures, targets and blobs all came back, and three agents carried on.
Scope, stated rather than implied — it holds **between** calls, not during one;
session leases are memory and were re-issued; agent undo is the persisted `ops`
table and survived, while a browser's in-memory stack would not.

**What they reached for and could not have:** an `input` step that can type,
which cost the two most cinematic shots in the article and a whole line of
reader-one's work; any way to get an *image* out of re64 rather than text art —
four independent hand-written bitmap printers across two runs on this binary now;
a read-side complement to `add_type`, so a declared record can be handed back
decoded instead of re-parsed from hex every time; a range-versus-range compare in
`find_bytes`; and `play_sid`, since a capture is a write log with no last mile to
something audible.

**`method` was never read**, having been asked for explicitly. Grading happened in
chat, because the editor's questions were about *sentences somebody wrote* and
`method` is a field on an address. What it wanted instead: **a claim carrying the
call that reproduces it** — not a category but the literal invocation, so
"verified" becomes something an editor can execute. Every time that arrived in
chat, the claim went straight into the piece.

**Two findings in this entry are guided, and are marked so rather than counted.**
After the article was first finished, the person who commissioned it checked it
against the running game and caught two things: the title letters are multicolour
rather than hires, and every note in the rendered audio had the same length. Those
observations are theirs. But the message relaying them also carried the diagnosis —
where to look for a per-frame colour write, and that the cycle-stamped SID capture
was a better source for durations than the stream format — so what came back is not
evidence of what an agent reaches for unaided, and `docs/experiments.md` is the
wrong place to let that blur.

What the steer did **not** contain, and the editor found: the flicker is one
instruction, `INC $D025` at `$8F7F`, sitting in an eight-instruction wait loop
beside the joystick read — no target value, no colour table, and not video-synced,
which is why it jumps rather than slides. It closes to the pixel: the four letter
sprites hold 138 bit-pairs of `11` and 77 of `01`, and eighteen consecutive
captured frames show exactly 1,104 pixels that never move and 616 that change
every frame. And the audio was wrong by a factor of seven because `$11` is a tempo
divider — written once at `$88C2`, read once at `$8907` — so a tick is 140ms and
the title tune is 89 seconds rather than 12.5.

**The self-criticism it volunteered is the finding worth keeping**: it had the SID
capture from the beginning and used it only to check pitches. The first note is
held 275,184 cycles, 13.97 frames against the 2 the stream format claims, and that
ratio was in the first two rows of a file it had already downloaded. The evidence
was captured, in the document and on disk, and the wrong answer was published
anyway — because turning a log into sound meant writing a synthesiser, and the
synthesiser was built from an interpretation of the format instead. That is the
argument for rendering audio inside the framework rather than leaving it to
callers: not that it cannot be done outside, but that outside it the cheap path
and the true path are different paths.

**And trust ran one way.** The editor asked twice for its own four claims to be
audited; both readers stayed online and answered everything asked *of the program*
and nothing asked *of the editor*. There was no object to attach it to —
`add_evidence` supports or refutes a claim in the document, and the article was in
a file only the editor could see. Nor is there anywhere to record that two claims
conflict: the run's best unresolved question, whether cheat mode does anything
beyond its banner, existed only as two chat messages that happened to be read by
the same person.

### 10 — Coverage first, then the article, and what a field cannot say

**Question.** Two things at once. First, a re-run of 7's shape on the new claims
model: does a surface with one noun cover ground as fast as one with three? So
stage one is **two readers, coverage and structure, no prose**. Second, and the
reason for the run: can the model hold what a reader finds *between* things — a
field whose value selects another, a byte whose bits pick out members of a set, a
table indexed by a variable? Stage two puts an editor over the same document to
write an article, as run 9 did, with the previous stage's work as its input.

Both briefs forbade reading this repository. Run 9's readers found a prior memo
in ninety seconds and it changed what that run measured; this one starts from the
bytes.

**The measurement.** 418 tool calls over about ninety minutes: reader one 92,
reader two 215, the editor 111.

| | after stage one | after stage two |
|---|---|---|
| claims | 80 | **80** |
| record types / fields | 4 / 12 | **4 / 12** |
| comments | 93 | **93** |
| constants | **0** | **0** |
| scenarios / captures | 1 / 1 | 14 / 59 |
| evidence records | **0** | **0** |

**Stage two added no analysis to the document at all.** The editor read, ran
fourteen scenarios, took fifty-nine captures, and wrote a 257KB article and 514
lines of notes — and the claims, types, comments and constants are unchanged to
the object. Run 9 ended with the same complaint from the other side: there was
nothing to attach an editorial judgement *to*. This run says it in numbers.

**`add_evidence` was never called.** Not once, by anybody, across fourteen
scenarios and fifty-nine captures. The mechanism built specifically so a finding
re-verifies rather than resting on a sentence went unused by the agent that
produced every scenario in the project. That is the strongest instance yet of
this file's own rule: the vocabulary being closed is checked by the compiler,
and whether anything reaches for a member of it is not.

**The constants half is not confounded, and neither is the ROM half.**

- `add_constant`: **0**. `bind_constants`: **0**. `find_immediates`: 6, all by
  reader two. Diagnosed and fixed twice over — the answer now names the next
  call, and `add_constant`'s description carries four idioms rather than one
  example, because the shapes those readers skipped all turned out to be wanted.
- `add_rom_layer`: **3**. `set_target`: **0**. Three ROM layers declared, linked
  into nothing, and the editor's `read_bytes $FFF8` failed as a result. Its notes
  conclude *"the host has none"* — on a host with all three. Run 9's editor
  reached the same wrong explanation by accident; this one **inherited it**,
  and then hand-wrote a seventeen-byte KERNAL shim. Fixed by making the write
  that declares a layer say it is linked into no target, and by giving the
  machine a `vectorless` stop reason instead of running into zeros.
- `where`: **2**, both by the editor, neither by a reader — while reader one did
  sprite-row address arithmetic **eight times by hand**, got the stride wrong the
  first time (63, the sprite's data size, rather than 64, the stored pitch) and
  rendered garbage before noticing.

**What the readers did reach for unprompted is the interesting half.** Both
declared record types without being told to — `add_type` four times between them,
`edit_type` once, to correct an encoding. They found the *complex* feature and
missed the simple ones, which says the barrier was never expressiveness. It was
signposting, and that is where the fixes went.

**The relations question got its manufactured evidence.** Both readers hit the
same wall and worked around it in the same shape, counted in their own reports:

- Reader two computed a **hi/lo byte pair into an address by hand** three times —
  a jump table's entries, two music pointer pairs, a screen row to its colour-RAM
  twin — and wrote: *"there is no tool here that resolves 'the word at this
  address, read as an address' for me."* The editor did it four more times from
  pairs of immediates.
- Reader two probed undecoded spans by **force-adding `root:"routine"` and
  reverting**, roughly twenty times, **six of which had to be reverted**. That is
  the only way either reader found to ask "is this code" before committing.
- Both decoded text by hand in throwaway Python — reader one six times, reader
  two more than a dozen — because nothing previewed an unclaimed span under an
  encoding. Reader one typed a field `char(38,screen)` by analogy, saw
  card-suit glyphs, and corrected it to ASCII.

Those are workarounds rather than wishes, which is the standard this file sets,
and they produced `preview`, `where`'s word reading, and the field types.

**Thirteen defects came out of the run.** The headline: `find_undecoded`
reported **1,230 bytes of proved record layouts as untouched** — both readers
noticed independently, told each other in chat, and neither could tell whether it
was their mistake; and `list_claims` returned 399 of 1,035 claims with nothing
saying so. Reader one's report is exact about the cost: *"I cross-checked each
record claim by hand rather than trusting the gap count."*

**A defect the log records and no report does.** `add_claims`, the batch form,
had no `method` or `typeId`. Reader two therefore **never used it** — 53
individual `add_claim` calls, one at a time, to keep provenance honest. The
report mentions it in a list; only the call counts show what it cost.

**Read the reports and the log together.** The editor's notes say record claims
*were* cleared by `find_undecoded` and that the readers may have misread it. They
did not: the tool was broken and was fixed between the stages. The document
recorded neither the observation nor the correction, because both went to chat —
which is itself the finding run 9 ended on, arriving a second time.

---

## What the sequence shows

Every run found the same shape of defect at a different address: **a write that
reported success and did something else.** `set_comment` keyed by slot,
`set_label` keyed by address, `set_constant` and `set_decoder` keyed by name,
`add_claim` keyed by address for rooted claims. Each was justified by
single-author use, each survived the arrival of a second author unrevisited, and
each had to be found by an experiment rather than by reading.

The second recurring shape: **a vocabulary member nothing emits.** `meta.set`
with no producer, `layer.add` filtered to symbols layers, `type.set` absent from
the diff. The union being closed is checked by the compiler; whether anything
ever emits a member of it is not.

Both are why the round-trip harness exists, and why it is now the first thing a
new root has to pass.

### Open: is the claims interface worse at naming than the three nouns were?

Raised while run 10 was in flight, and recorded because it is a question about a
**foundational** decision and the evidence to hand does not settle it.

The observation: before claims, the surface had `set_label`, `set_region` and
`set_constant` — three nouns, each naming a kind of thing you could say. Run 7,
on that surface, produced 400 labels, 114 regions and 18 constants. On the
claims model, run 9 produced 34 claims and **zero** constants, and run 10's
coverage stage 80 claims, four types and **zero** constants again.

| | run 7 | run 10, stage one |
|---|---|---|
| readers | 3 | 2 |
| tool calls | 648 | 317 |
| objects made | 400 labels + 114 regions + 18 constants | 80 claims + 4 types |
| per call | 0.79 | 0.25 |
| the brief asked for | coverage | coverage **and structure and relations** |

The per-call gap survives normalising for readers and for calls, which is the
part of the hypothesis with weight behind it. What it does not survive is the
**brief**: attention spent proving a 52-byte record layout is attention not spent
naming forty addresses, and run 10's brief redirected it deliberately. Run 10
also produced four proved record types, which run 7's model could not express at
all — that is the `zoneDataTable` finding running the other way.

**Run 10's own entry above carries the numbers**, and one of them sharpens this:
stage two added *no* claims, types, comments or constants at all. Whatever the
naming rate says about the interface, an editor writing prose over a shared
document contributed nothing to it — which is a second question wearing the same
clothes, and the one a long-term baseline would separate.

**The constants half is not confounded, and it has been diagnosed.**
`find_immediates` was called six times by the two readers and `add_constant`
zero. So they were not unaware that values existed and did not fail to look —
they used the tool built to lead there, saw the sites, and stopped. The answer
returned a list and named no next call, which is out of step with a surface
where a nested claim names how to replace it and an indirect jump names
`mark_function`. Fixed: the answer now reports how many sites load a value
nothing has named, and names `add_constant` then `bind_constants`.

**What would settle the rest, with one variable in it:** run experiment 7's
coverage-only brief against the claims model and compare with run 7 directly.
The old interface is gone, so the interface cannot be varied — but the
instruction can be held still, which is the confound that actually matters here.

### And the work itself moved, in a shape worth naming

Read across the nine, the *question* being asked changes, and each phase's
completion is what exposes the next one's poverty:

| | the question | what ended it |
|---|---|---|
| **identification** | what is this address? | labels and regions became one claim |
| **coverage** | what is unexplained? | run 7 took unexplained bytes from 40,359 to 13 — and proved coverage is not understanding, because `zoneDataTable` was "covered" by one 8,400-byte `data` claim |
| **structure** | explained *as what*? | `add_type`; run 9 declared `ZoneRecord` with 41 fields |
| **relations** | what does this field's value *refer to*? | open — see "Parked" in `decisions/claims.md` |

The tell each time is the same, and it is not a complaint anybody makes. It is
**where the good material ends up**. Run 7's account of the zone table was
finished analysis with nowhere to go, so it went into prose. Run 9's best
findings — the transformation graph, the three bitmasks over creature types,
zone 8's name explaining its own sprites — are *all relational*, and all of them
went into an article, because an article was the only thing that could hold
them.

That is the signature to watch for, one level up each time: analysis that is
complete, agreed and unstorable.

It also predicts the phase after relations, which is **behaviour** — "this
routine implements the zone transition", "this is the spawn path" — where
`effects`, the block graph and scenarios already point without quite meeting.

Run 9 added a third, and it is the one with no harness behind it: **a derived
answer that is almost right.** A reconstruction with the correct sprites in the
correct order at the correct heights, wrong about width and about a third of the
horizontal positions. A codename that identifies one participant except across a
restart. Neither reports an error, both look correct, and the only thing that
catches either is putting the derived answer beside the true one — which is why
sprite capture is now the machine's job rather than a caller's, and why the
allocator asks storage instead of memory.
