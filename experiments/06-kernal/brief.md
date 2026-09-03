# Read the KERNAL

The project holds 8KB of Commodore 64 KERNAL ROM (revision 901227-03) at
`$E000-$FFFF`, as a raw layer. Nothing is annotated.

This is not a game. It is system ROM: entered through a jump table, threaded
with indirect vectors through RAM, shared between routines, and with a public
interface that has been documented for forty years.

## What you are being asked for

re64 ships a table of names for the KERNAL's documented entry points —
`$FFD2 CHROUT`, `$FFBA SETLFS` and so on, with a one-line comment each. Those
names are all it knows about the machine. The plan is to ship more: what each
entry point **reads and writes**, derived by re64's own analysis, so a program
calling `JSR $FFD2` can be understood without anyone owning a ROM.

Your job is to find out whether that plan is sound, and to write the part a
machine cannot.

**1. Check what the analysis derives.** For each documented entry point, get the
effects re64 computes and say whether they are right. You have `run_block`,
`block_effects`, `routine_effects`, `run_program`, the disassembly, and the ROM
itself. Where the analysis is wrong, incomplete, or stops early, say so and say
why — that is more valuable than a clean report.

**2. Say what is missing.** Entry points we do not name, addresses worth naming,
RAM locations the KERNAL uses that a caller needs to know about. Our table has
about 160 entries; the KERNAL touches more than that.

**3. Describe each routine.** What it does, its **calling convention** — what
goes in `A`, `X`, `Y`, what comes back, what the carry means — and anything
important: what it clobbers, when it fails, what it assumes was set up first.
This is the part the analysis cannot produce, because it is meaning rather than
mechanism.

**Do not rewrite the short comments.** We keep those. If one is wrong,
misleading, or could be better, say so separately and say what it should be.

## You may use outside knowledge

The KERNAL is thoroughly documented and you almost certainly know a lot about it
already. Use that, and use the internet if you have it. This is not a test of
whether you can reverse engineer it blind — it is a check on whether **re64's
derived answers agree with what is known**, and where they disagree, which one
is wrong.

Say which claims come from the analysis and which from outside knowledge. Where
they conflict, that conflict is the finding.

## Deliverables

Two files in the run directory.

`review.json` — structured, so it can be used:

```json
{
  "entries": [
    {
      "address": "$FFBA",
      "name": "SETLFS",
      "shortComment": "Set logical file parameters",
      "commentVerdict": "good" | "wrong" | "could-be-better",
      "suggestedComment": "...",
      "derivedEffects": { "reads": ["A","X","Y"], "writes": ["$B8","$BA","$B9"] },
      "effectsVerdict": "correct" | "incomplete" | "wrong",
      "effectsNote": "...",
      "callingConvention": "...",
      "description": "...",
      "source": "analysis" | "knowledge" | "both"
    }
  ],
  "missingSymbols": [{ "address": "$..", "name": "...", "why": "..." }]
}
```

`report.md` — prose: what you found, what the analysis got right and wrong,
what fought you, and anything about the KERNAL worth knowing that does not fit
the per-entry shape.

## Rules

- Findings belong in the project too — name things, comment them, declare
  regions. The project is a deliverable as much as the files are.
- Evidence over assertion. "The analysis says X, the documentation says Y, and
  here is why I think Y" is exactly the shape wanted.
- Do not modify any source code in the repository.
- If you want a tool that does not exist, call it once with the name you wanted
  so it lands in the transcript, then work around it.

## Budget

Generous. This is 8KB of the most-studied code on the machine, and the output
feeds a shipped table. Do not stop while entry points remain unexamined.
