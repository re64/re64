# Experiment 11 — one reviewer, on work that already exists

**The first run that starts from something.** Every experiment before this began
with an empty project, so all ten measured the first hour of a project and none
could ask whether an agent can build on somebody else's work — or contradict it.

The starting point is `assets/mutant-camels/camels.re64`: 981 objects from runs
7, 9 and 10, under nine authors, imported faithfully and reviewed by nobody. It
is a *silver* image on purpose. `setup.sh` builds it — about twenty seconds,
because the decrunched image is produced by running the loader — and snapshots
the before-state so the delta is a measurement rather than an impression.

## What it asks

Three things, which turn out to be the same work from three sides:

- **Resolve conflicts.** 43 disagreements and 75 addresses carrying two names.
- **Fill gaps.**
- **Sharpen claims that are too broad.** Twelve claims cover 71,007 bytes of a
  47K program. The zone table is claimed twice over — 8,400 bytes of `data` by
  one run, an array of `ZoneRecord` by another.

All three held to one standard: **could somebody who has never seen this program
open the listing and follow it.**

## Why these three, and not "make it readable"

The earlier draft of this brief said *make the disassembly readable*, and it was
wrong for a reason worth keeping. Readability is easier to satisfy by renaming
five hundred things for consistency than by understanding one routine — motion
that looks like work. All three verbs above are anti-churn by construction: a
conflict resolved is a decision, a gap filled is an addition, and a broad claim
sharpened is strictly more specific than it was. Readability is the consequence.

The brief carries the rule explicitly, and `measure.sh` scores it: *if you rename
or rewrite something, be able to say what a reader could not tell before.*

## What it is measuring

**A scored test, which is new here.** Some of the answers are known, so this is
not purely observational. `assets/mutant-camels/README.md` lists what was left
deliberately wrong — the zone table claimed twice, run 10's sprite sheet starting
at `$0801` rather than on a 64-byte boundary, run 9's reading of `$C023` as zone
transition code when the patch work shows it is 2021 code neither run had placed.
Whether the reviewer finds those is checkable.

Two mechanisms are watched for a different reason. **`add_constant` was used zero
times across two runs** on the claims model, and **`add_evidence` three times in
the project's whole history**. Both were diagnosed as signposting failures and
both had fixes shipped — four idioms in `add_constant`'s description, a fourth
paragraph in the MCP instructions. This is the first run that can say whether
those worked.

## Running it

    ./setup.sh                     # port 5194, project `camels`
    #   paste brief.md as   RE64_USER=rev RE64_SESSION=rev
    ./measure.sh                   # before against after, and the churn share
    ../teardown.sh run             # stop the server; nothing is deleted

`measure.sh` reads the transcript as well as the counts. Where the reviewer's
report and the log disagree, the log wins — and the churn question is one only
the log can answer.

## What to keep

`run1/`: the reviewer's `findings.md`, the before and after documents, the
transcript, and the measurement.
