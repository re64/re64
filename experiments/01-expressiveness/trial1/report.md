# Trial 1 — the agent's own report

Run on 2026-08-30, against the API as it stood at commit `c79c05b`. One agent,
97 requests over 7 minutes, ~62 tool calls, 41 addresses named, 5 decoded
instructions to 1475.

**This is the agent's account, unedited**, including the parts that turned out
to be wrong. It is kept verbatim because the disagreements between it and
`transcript.jsonl` are the argument for reading both — see `../findings.md`,
which marks the three claims that did not survive checking and says what was
actually going on in each case.

The transcript beside this file is what was really called.

---

## Report

41 addresses named, `$8000`–`$8400` walked in order, 1475 instructions decoded
from a starting 5. About 62 tool calls. What follows is what went wrong.

### What I could not express at all

**Zero-page and I/O symbol names — the single largest omission.** The reference
opens with 48 zero-page equates (`currentXPosition = $02`,
`screenLineLoPtr = $06`, `joystickInput = $0E`, …), 12 field equates
(`screenLinesLoPtrArray = $0340`, `charSetLocation = $2000`,
`explosionXPosArray = $1500`), and 4 KERNAL equates. **None of them can be set.**
`set_label '{"address":"$02","name":"currentXPosition"}'` returns:

> `No layer owns $0002. Add a layer of type "symbols" to name addresses outside the loaded bytes.`

That message tells me exactly what to do and gives me no tool to do it. I called
`add_layer`, `set_layer`, and `list_layers` — all three are `Tool not found`. So
the API instructs the agent to perform an action the API does not support. This
is not a corner: on a 6502 program, every variable lives in zero page. My
disassembly reads `LDA $0C`, `STA $08`, `INC $0A` where the human's reads
`LDA previousYPosition`, `STA gridXPos`, `INC materializeShipOffset`. Roughly
half of what a human contributes to a 6502 listing is unreachable through MCP.

The same refusal blocks renaming platform labels: `set_label $D418 SID_VOLUME`
is refused with the same message — even though `list_labels '{"source":"platform"}'`
reports **`"writable": true`** on every one of them. That field is simply wrong,
and it is the field an agent would use to decide what it may edit.

**Symbolic constants.** `GRID = $00`, `SHIP = $07`, `EXPLOSION1 = $16`,
`ORANGE = $08`, `VERTICAL_LINE = $3F`. These are values, not addresses, and the
reference uses them everywhere (`LDA #ORANGE`, `LDA #EXPLOSION1`). I called
`set_constant`, `set_enum`, and `set_operand` (to name one immediate at one
site). All three: not found. There is no home for a named constant anywhere in
the model, and it materially changes how the listing reads.

**Comments not attached to a label.** The reference is dense with inline
commentary — `STA $D401 ;Voice 1: Frequency Control - High-Byte`, and
free-standing section comments inside routines like
`; Draw the horizontal lines of the grid` and `; Draw the full grid`. `comment`
only exists as a field on `set_label` and `set_region`, so to comment an
instruction I must invent a label for it, which pollutes the listing with names
the human never wrote. I called
`set_comment '{"address":"$8011","comment":"..."}'` — not found. This is the
second-biggest gap after symbols layers.

**Overlapping instructions — and this one is actively destructive.** The
reference contains `b8737 = *+$01` and `b8D5A = *+$01`: labels pointing one byte
*into* the following instruction, a standard 6502 branch-into-operand trick. I
set `set_label $8D5A`. It returned `ok`. Then:

- the label was **not rendered at all** in `read_disassembly`; and
- `$8D5B JMP DisplayTitleScreen` stopped decoding, becoming an orphan `4C` data
  byte, and the decoder re-synced one byte late into garbage
  (`8D5C STX dat_CE8D`, `8D5F *RLA`).

I removed the label and the correct decode came back. So **setting a label at a
mid-instruction address silently corrupts the surrounding disassembly and gives
no warning**. `set_region kind:"code"` over the same span did not repair it
(`delta: 0`). Note that the *other* mid-instruction label in the reference,
`CopyrightLine = *-$01` at `$807F`, was accepted, resolved correctly in
`LDA CopyrightLine,X`, did *not* damage anything — and is also invisible in the
listing. Same operation, two different outcomes, neither documented.

**Aliases.** `vicRegisterLoPtr = $02` alongside the global
`currentXPosition = $02`; `gridXPos = $08`; `podLoPtr = currentXPosition`.
`set_label` names *an address*, one name per address, so locally-scoped second
names have no representation. (Moot here since ZP is unreachable anyway, but it
would bite inside the layer too.)

**The `$0800` BASIC stub and `PrepareGame`.** The reference's first code —
`SYS 2061` and `PrepareGame` at `$080D` doing `JMP ($8000)` — is a second
segment not in this project's single layer. No `add_layer`, so the program's
actual entry point cannot be represented; the best I managed was a `comment` on
the `$8000` region saying what jumps there.

### What was awkward

**`set_region kind:"code"` is inert.** The description of `set_region` implies
regions guide the disassembler, and the docs say the disassembler skips non-code
regions. But marking a span `code` does **not** seed decoding:
`set_region $8011-$8013 code` gave `delta: 0`. The only way to decode
unreferenced code is `mark_function`, which forces a `function` label and
therefore a name onto it. `$8011` in the reference is a bare
`JMP InitializeGame` with no label; to make it visible I had to `mark_function`
it and accept a fabricated `sub_8011`. "This is code" and "this is a subroutine
entry" are conflated in the only tool that seeds.

**`jumptable` does not do what its description says.** `set_region` says:
*"marking a jumptable decodes the code it points at, which no control-flow walk
can reach on its own."* I marked the 2-byte vector at `$8000-$8001` as
`jumptable`. `delta: 0`, and `$83C1` stayed data. I got the program open only by
guessing `mark_function $83C1` from reading the reference — `delta: 1474`, which
is essentially the whole program. An agent without the answer sheet would have
been stuck at 5 instructions with a tool description that told it the vector
would be followed.

**`end` is exclusive, and nothing says so.** `set_region $8080-$809F kind:text`
left `$809F` outside the region, rendering as a stray data byte. The `.re64`
schema documents `end` with a `"+$100"` length form, which reads as inclusive. I
had to notice the stray byte and redo the call.

**Unknown arguments are accepted silently.** `set_region` with
`encoding:"custom", charset:"$2000"` returned `ok` and ignored them.
`list_labels` with `start`/`end` returned `$D000`-range labels for a
`$0000-$00FF` query — silently ignored. For an agent probing what an API can do,
"ok, did nothing" is the worst possible answer; these should be schema errors.

**No bulk write.** 41 labels meant 41 round trips, each returning a full
before/after instruction delta I did not need. `set_labels` with an array: not
found. The reference has hundreds of labels; at this rate reproducing it is a
thousand calls of pure protocol overhead.

**`find_references` inbound is unsorted and address-only.** 35 call sites came
back as `$81F9, $81C4, $827D, $8D88, $8287…` — not sorted, and with no
indication of which routine each call site is *in*. "Who calls this" is a
question about names; I got a bag of hex. Nearest-preceding-label would cost
nothing and answer it. I also did not see the documented absolute-addressing
caveat on the answer (the brief says it appears on every one).

**Auto-labelling misses branch targets mid-run, and renders the gap as
arithmetic.** `$821F BNE CheckForPausePressed-1` — the branch target `$821A` is
a real control-flow destination (the reference labels it `b821A`) and got no
`loc_` label. Worse, the same offset-rendering hits every zero-page byte adjacent
to an auto label: `$02` renders as `dat_0003-1`, `$04` as `dat_0003+1`, twelve
times in `InitializeGame` alone, including `STA (dat_0003-1),Y`. `$02` would have
been more readable than that. Label-relative rendering should be off for zero
page entirely.

**Text regions render worse than data.** `kind:"text"` produced
`8080  3C 3D 20 31 39 38 32 20  .TEXT` — hex plus a bare `.TEXT` directive and no
characters at all. The `data` rendering it replaced at least showed an ASCII
column. Marking a span as text made it strictly less readable.

### What I expected and did not find

- `add_layer` / a symbols layer — the error message's own recommendation.
- `set_comment` on a bare address.
- `set_constant` / `set_enum`.
- `set_entry_point`. `set_label type:"entry"` turns out to work and does add to
  `entryPoints`, but the docs say `entry` is "emitted by a layer or region, not
  by the user", so I did not expect to be allowed and would not have tried
  without probing.
- `find_undecoded` / `coverage`. `describe_project` reports `instructions: 1475`
  and `warnings: 5` with no way to see either the undecoded spans or the
  warnings — and `list_warnings` is not found. "What is left to decode" is the
  primary orientation question on a blank project and there is no tool for it.
  `find_unnamed` only lists things already *reached*.
- `export_project` — no way to see my work as a listing, which is what the
  reference is.

### What the descriptions got wrong

`set_region`'s jumptable sentence promises decoding it does not perform.
`find_unnamed`'s framing as "the work queue" is misleading on a fresh project —
the real work queue is the undecoded bytes, which it cannot see. `list_labels`'
description advertises narrowing "by an address range" that its schema does not
accept and its implementation ignores. `list_labels` reports `writable: true` on
platform labels that are not writable. `mark_function`'s description is accurate
but it is doing double duty as "make this decode", which nothing tells you.

### What I would fix first

**Add `add_layer` for symbols layers** — or, better, let `set_label` create the
layer implicitly instead of refusing with advice the API cannot act on. It is the
largest single fraction of the human's work, it is the difference between a
listing full of `$0C` and one full of `previousYPosition`, and the error message
already concedes the model supports it. Everything else on this list makes the
output worse; this one makes half of it impossible.

Immediately after: **make a mid-instruction label either work or be refused.**
Silently accepting it, hiding it, and corrupting twenty bytes of surrounding
decode is the only failure I found that produces a *wrong* disassembly rather
than an incomplete one, and an agent has no way to notice.
