# Experiments

Three, escalating, each adding one variable. They exist to find gaps in re64 by
watching agents hit them, rather than by imagining what an agent would want.

There is an **oracle**, with limits worth stating before anyone leans on it.
`assets/gridrunner.asm` is a complete human reverse engineering of the same
binary — mwenge's `matrix`, released into the public domain.

**It is a linear sweep with names, not a reachability analysis.** Its author
disassembled the span and named what they recognised. `PlayNewLevelSounds` and
`SetVolumeAndPlaySounds` appear there as routines and are unreachable in any
static walk of this binary — the only `JMP` to the first is inside the second,
which nothing reaches either. Three consequences:

- **Coverage is not comparable.** "The human named 300 addresses, the agent named
  85" measures method, not skill. A sweep names everything it sees; a walk names
  what it can reach.
- **It can assert things that are not so.** Dead code is presented as routines.
  `.BYTE $EA` between two routines is presented as data and is executed. An agent
  copying faithfully reproduces both.
- **It is silent about reachability**, which is what re64 computes — so the two
  disagree by construction rather than by error.

And the binary itself gets a vote. A 1983 game contains development leftovers,
reaches code through computed jumps and `RTS` dispatch that no static walk
follows, and may have bugs. A disagreement is a question, not a verdict.

So use it for **expressiveness** — what the API cannot say that a person said —
which is what experiment 1 was for and what it delivered. Do not use it to score
fidelity, and do not treat "closer to the .asm" as the goal.

| | Measures | Shared document? |
|---|---|---|
| 1. Expressiveness | can the API *say* what a person said | one agent |
| 2. Convergence | do independent readers agree, and with the human | no — five clones |
| 3. Collaboration | can they coordinate, and can a person watch | yes |

## The two rules

**Read the reports and the transcript together.** A report carries intent, what
the agent expected to find, why something felt awkward — none of which a log
holds. The transcript carries what a report cannot, because an agent is an
unreliable narrator of its own difficulty: it invents a tool name and then
describes the invention as a gap, and works silently around whatever actually
hurt. Where they disagree, the transcript wins; but the report is what makes a
line in the transcript mean anything.

**Only fix what blocks the next experiment.** Everything else becomes a list and
stays a list. Without this rule the first run's output consumes every week that
follows.

## Reading a run

Every server writes a transcript beside its database, on by default.

```
re64 transcript <name>.mcp.jsonl
re64 transcript <name>.mcp.jsonl --json   # for diffing two runs
```

It leads with **reached for and not there** — tools an agent called that do not
exist. That section is the experiment's actual output.

It also answers a question the session design is waiting on: how many distinct
MCP session ids and client instances appeared. Whether several agents spawned
together are several MCP clients or one shared client is a property of the host,
not the protocol, and it decides how agent sessions have to be keyed. Counting
them here settles it without setting anything up.

## Experiment 1: expressiveness

`01-expressiveness/` — `./setup.sh` builds a stripped project, starts a server,
and prints the command to connect an agent. The brief is `brief.md`.

It is **not** a test of whether an agent can reverse engineer: it is handed the
answer. It tests whether the API can express what the answer contains. So score
friction, not similarity to the `.asm`, and do not treat a wrong name as a
finding.

One thing already known before running it: comments attach only to labels and
regions, so the human's instruction-level commentary — a large share of the 391
comment lines in the reference — has nowhere to live.
