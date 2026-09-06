# The experiments, and what each one changed

Eight runs. They exist to find gaps in re64 by watching agents hit them, rather
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
