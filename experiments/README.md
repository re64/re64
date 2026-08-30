# Experiments

Three, escalating, each adding one variable. They exist to find gaps in re64 by
watching agents hit them, rather than by imagining what an agent would want.

The rare thing here is an **oracle**. `assets/gridrunner.asm` is a complete human
reverse engineering of the same binary — mwenge's `matrix`, released into the
public domain — so there is a gold standard to compare against. Most agent
evaluation has nothing of the kind.

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
