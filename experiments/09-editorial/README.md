# Experiment 9 — two readers, an editor, and something a person would read

Every run before this one ended in a report written by the people who did the
work, for the people who built the tool. This one ends in an **article about the
program**, written for somebody who will never read a disassembly — and the two
readers cannot stop until the editor says it is finished.

| | |
|---|---|
| binary | Revenge of the Mutant Camels (Jeff Minter, Llamasoft, 1984) |
| port | 5192 |
| project | `camels` |
| agents | two readers sharing a document, one editor |

The project is prepared past the decruncher: a `loader` target holding the packed
file, a `runtime` target holding the image it expands into. Getting there is
settled territory — experiment 5 established the move — and the setup now does it
as a **scenario**, so one is already in the project when the readers arrive. A
mechanism nobody can see is a mechanism nobody uses, which is what happened to
`view: "snippet:"` in experiment 8.

## What is new here, and therefore what this asks

Three things landed since experiment 8 and none has been used by anybody but its
author:

- **the machine model** — scenarios, breakpoints, watchpoints, joystick input,
  screen and frame capture, a SID write log
- **`method` on a claim** — how somebody knows, rather than how sure they are
- **evidence about a claim** — supports, refutes, supersedes, and a scenario that
  re-verifies

And one thing has never been tried at all: **a consumer of the analysis who is
not doing the analysis.** Every previous run's reader was also its only reader.

**No hypothesis is named here on purpose.** The last time an expected finding was
written into a brief it read as a shared premise and stopped the run producing
others. Run it, read what came out, report what happened.

## Running it

```bash
./setup.sh                 # run/, port 5192, project "camels"
```

Then three sessions with no contact except the project's chat:

| | user | session | brief |
|---|---|---|---|
| reader one | `one` | `one` | `brief-reader.md` |
| reader two | `two` | `two` | `brief-reader.md` |
| editor | `ed` | `ed` | `brief-editor.md` |

Watch it at `http://127.0.0.1:5192/?project=camels`.

## What to read afterwards

- **`article.html`** first, as a reader would, before anything about how it was
  made. If it is not worth reading, the run failed whatever else happened.
- **`editorial-notes.md`** — what the editor asked for and could not get. This is
  the list nobody has ever been able to produce, because nobody has ever had to
  turn this analysis into something for somebody else.
- **Both `findings.md`** — and the tool each reader had to build. Inventing a
  tool name is an unguarded statement about what the API should have had.
- **`camels.mcp.jsonl`** — where the reports and the log disagree, the log wins.
  An agent invents a tool name and then describes the invention as a gap, and
  works silently around whatever actually hurt.

Two questions worth holding while reading, neither of them a hypothesis:

- Did having a reader change what the readers did? Every run so far optimised for
  coverage, because coverage was what got measured.
- Did anybody use `method`, and did it ever settle anything?
