# Experiment 1: expressiveness — findings

**Trial 1** is below. **Trial 2**, run after ten of these were fixed, is in
`trial2/findings.md` — it found one serious defect (a single write making a
project unwritable through every interface) and a different, more advanced set of
gaps. Each trial keeps the agent's own report beside the transcript it was
written from.


One agent, 97 requests over 7 minutes, 41 addresses named, `$8000`–`$8400` walked
in order. The project went from 5 decoded instructions to 1475.

Everything below was cross-checked against the transcript. Where the agent's
account and the log disagree, the log is quoted and the agent's reading is marked
wrong — three of them were.

## The one correctness bug

**A label at a mid-instruction address silently corrupts the decode.** Verified
independently on a clean project:

```
before   8D59  85 35      STA $35
         8D5B  4C 8E 8D   JMP loc_8D8E

set_label $8D5A  ->  {"ok": true, "delta": 1}

after    8D59  85 35      STA $35
         8D5B  4C                       |L|
         8D5C  8E 8D CE   STX dat_CE8D
```

`JMP` becomes an orphan byte, the decoder resyncs one byte late into garbage, and
the label itself is not rendered. It reports success.

Worth being careful about the cause: branching into the middle of an instruction
is a **legitimate 6502 technique**, and the reference disassembly uses it twice
(`b8737 = *+$01`, `b8D5A = *+$01`). The model is right to permit overlapping
decode. What breaks is the renderer, which assumes one linear instruction stream
per address and has no way to show two.

So this is not "reject mid-instruction labels". It is a gap between what the
model can represent and what the row builder can draw. Every other finding here
is incompleteness; this is the only one that produces a *wrong* answer.

**Since:** still unfixed, and now recorded in CLAUDE.md under known limitations
so it is not rediscovered. It does announce itself now — the disassembler was
already emitting an `overlap` warning naming both addresses, and every write
returns the warnings it introduced, so this returns them instead of a bare `ok`.

Note the same operation succeeded harmlessly at `$807F` (`CopyrightLine = *-$01`),
resolving correctly in `LDA CopyrightLine,X` and damaging nothing — while also
being invisible in the listing. Two outcomes, neither documented.

## The largest gap: no way to name anything outside the loaded bytes

`set_label` on zero page is refused:

> No layer owns $0002. Add a layer of type "symbols" to name addresses outside
> the loaded bytes.

The message names the fix and the API cannot perform it. `add_layer`, `set_layer`
and `list_layers` were all called; none exist.

This is not a corner. On a 6502 program every variable lives in zero page. The
reference opens with 48 zero-page equates, 12 field equates and 4 KERNAL equates.
Without them the listing reads `LDA $0C` where the human's reads
`LDA previousYPosition` — roughly half of what a person contributes to a 6502
listing is unreachable.

The same refusal blocks renaming a platform label (`$D418` to `SID_VOLUME`),
**even though `list_labels` reports `writable: true` on every one of them**.
Confirmed in `workspace.ts`: the flag is `!invented`, so it excludes only auto
labels. It is the field an agent uses to decide what it may edit, and it is wrong.

## Reached for and not there

All thirteen confirmed in the transcript — the agent called every one.

| Tool | For |
|---|---|
| `add_layer`, `set_layer`, `list_layers` | a symbols layer for zero page and I/O |
| `set_comment` | a comment on an address with no label |
| `set_constant`, `set_enum` | `GRID = $00`, `ORANGE = $08`, used as `LDA #ORANGE` |
| `set_operand` | naming one immediate at one site |
| `set_labels` | 41 labels meant 41 round trips |
| `find_undecoded`, `coverage` | what is left to decode — the orientation question on a blank project |
| `list_warnings` | `describe_project` reports a count and nothing else |
| `export_project` | seeing the work as a listing, which is what the reference is |
| `set_entry_point` | `set_label type:"entry"` does work; the docs say it is not for users |

`set_comment` is the second-largest gap after layers. Comments exist only as a
field on `set_label` and `set_region`, so commenting an instruction means
inventing a label for it and polluting the listing with names nobody wrote.

## Three things the agent got wrong

Kept because they are the argument for reading the log alongside the report.

**"`jumptable` does not do what its description says."** It does. The agent
marked `$8000-$8001`, `end` is exclusive, so the region covered one byte and no
16-bit address fitted. Re-run with `$8000-$8002` on a clean project:
`delta: 1469` — the whole program opens from the vector.

But the underlying observation was right and *more* important than the agent
realised: the exclusive end silently turned the single most valuable tool on a
blank project into a no-op that reported `ok`. An agent without the answer sheet
would have sat at 5 instructions with a description promising otherwise.

**"I did not see the absolute-addressing caveat."** It is returned on every
answer, unconditionally — `workspace.ts` puts `incomplete` outside the
conditional. It was there among 35 results and went unread. A caveat that is
present and unnoticed is still a problem, but it is a different one from a
caveat that is missing.

**"`set_region kind:"code"` is inert."** True but by design: regions say how to
*interpret* bytes, entry points say where to *start*. The complaint is about the
description, not the behaviour.

## Awkward, ranked by how much it cost

- **`end` is exclusive and nothing says so.** Caused the jumptable failure above
  and a stray byte outside a text region. The schema documents a `"+$100"` length
  form that reads as inclusive.
- **Unknown arguments are accepted silently.** `set_region` with
  `encoding`/`charset` returned `ok` and ignored them; `list_labels` with
  `start`/`end` returned `$D000` labels for a `$0000-$00FF` query. For an agent
  probing what an API can do, "ok, did nothing" is the worst possible answer.
- **No bulk write.** 41 labels, 41 round trips, each returning a full instruction
  delta nobody asked for. The reference has hundreds.
- **`find_references` inbound gives no enclosing routine.** "Who calls this" is a
  question about names; the answer is a bag of addresses in no order.
- **Label-relative rendering on zero page.** `$02` renders as `dat_0003-1`,
  `$04` as `dat_0003+1` — including `STA (dat_0003-1),Y`. The raw address would
  be more readable. It should be off for zero page entirely.
- **Text regions render worse than data.** `kind:"text"` produced
  `8080 3C 3D 20 ... .TEXT` — hex and a bare directive, no characters. The `data`
  rendering it replaced at least showed an ASCII column.
- **Auto-labelling misses some branch targets.** `$821A` is a real branch
  destination and got no `loc_`; it renders as `CheckForPausePressed-1`.
- **`mark_function` does double duty.** It is the only way to make unreferenced
  code decode, so declaring "this is code" forces a fabricated `sub_` name onto
  an address the reference leaves unnamed.

## Status

Fixed since this run, in commit order:

| Finding | |
|---|---|
| `end` exclusivity silently doing nothing | `length` accepted, coverage reported, degenerate jumptable refused |
| `writable: true` on labels that are not | now false for platform labels too |
| unknown arguments accepted silently | tool schemas are strict |
| `set_region kind:"code"` inert | seeds decoding, named or not |
| no way to see what is left | `find_undecoded` |
| comments only on labels and regions | first-class, `before` and `inline` |
| nothing outside the loaded bytes can be named | symbols layer created on demand, plus `add_layer` |
| zero-page label-relative rendering | fuzzy matching off below `$0100` |
| warnings counted but not readable | `list_warnings` |
| `find_references` unsorted, address-only | sorted, and names the enclosing routine |

Two bugs found while fixing those, neither visible from the run: `diffProjects`
did not diff layers at all, and a stale browser tab could crash the server by
asking for a project it did not hold.

Trial 1's raw materials are in `trial1/`: the agent's own report, unedited, and
the transcript of what it actually called.

Still open: bulk `set_labels`, named constants, `export_project`, text-region
rendering, and the mid-instruction correctness bug — which needs the renderer to
be able to draw two overlapping instruction streams, and is the only one of
these that produces a wrong answer rather than a missing one.

## Triage

Blocks experiment 2 (five agents from scratch, no answer sheet):

1. **`end` exclusivity** — silent no-ops on the tool that opens a blank project.
2. **`find_undecoded` / coverage** — without it the orientation question on a
   blank project has no answer, and `find_unnamed` only sees what is already
   reached. Five agents would each rediscover this.
3. **`writable: true` on labels that are not writable** — actively false data an
   agent uses to plan.

Not blocking, on the list:

- symbols layers (largest gap, but agents without the reference will name what
  they can reach)
- `set_comment` on a bare address
- mid-instruction rendering (correctness, but rarely reached without the answer)
- bulk write, constants, warnings, export, richer `find_references`
- text and zero-page rendering

## Still unmeasured

The host question. This run used a shell pass-through rather than a real MCP
client, so no `initialize` arrived: `distinct MCP session ids: 0`, `calls with no
session handle: 96`, no client announced itself. Whether N spawned agents are N
MCP clients or one shared client needs a real client connected with
`claude mcp add`.
