# Developer guide

Use this guide to investigate a program, prepare an article, or extend re64.
The [architecture](02-architecture.md) defines vocabulary and component
boundaries. The [model reference](05-model.md) owns data shapes and their
readers; the [contracts](03-contracts.md) and [operation algebra](06-algebra.md)
own behavioral requirements. Exact MCP arguments live in the
[generated API reference](07-api.md).

Examples below use compact MCP call notation, not shell commands. Replace the
illustrative ids with ids returned by your calls. Add `project` when the server
hosts several projects and `target` when the operation needs a particular memory
arrangement. The examples are independent; their addresses describe different
investigation tasks.

## 1. Open an investigation

1. Call `list_projects` to find the project and inspect the connection identity.
2. Call `describe_project` for its current summary and `list_targets` for its
   arrangements and layer ids. Follow the
   [target selection rules](05-model.md#3-layers-and-targets) when choosing one.
3. Use `read_disassembly`, `claims_at` and `list_claims` to inspect the relevant
   range before adding an interpretation. Read reported scope and warnings as
   part of the result.
4. For a new binary, start with `create_project`, `prepare_upload` and
   `add_layer`; use `list_disk_files` to select a member of a disk image.
   Follow the upload instructions returned by the API.

A packed executable, decrunched memory and a patched variant can require
different targets. Choose the arrangement the question concerns; the same
address can contain different bytes in each.

## 2. Record and revise an interpretation

Name a routine, retain the returned claim id, and use it for a later correction:

```text
add_claim address:$8100 name:InitializeGame root:routine → clm_a1
edit_claim id:clm_a1 name:SetUpGame
```

To record a different interpretation, create another claim. If the practical
question is which name the listing should display, choose a primary name:

```text
add_claim address:$8100 name:MaybeInit → clm_b2
bind_primary_name address:$8100 claim:clm_a1
```

Inspect `claims_at` and `disagreements` afterward. A primary selection changes
presentation; it does not establish that the selected account is true.

To interpret a span as graphics:

```text
add_claim address:$8E00 extent:512 is:bitmap view:"char:8" → clm_c3
```

Use [claim fields and frames](05-model.md#4-claims-and-frames) to understand the
result. For corrections, send only the intended fields. Check the tool schema
before clearing a field with `null`; the general nullability audit remains
[#29](https://github.com/re64/re64/issues/29).

## 3. Describe a value or a record layout

Declare a constant, then bind the instruction site that uses that meaning:

```text
add_constant name:WHITE value:$01 → cst_d4
bind_constants bindings:[{address:$8213,constant:cst_d4}]
```

For a record, declare the known fields and attach the layout to a claim:

```text
add_type name:Creature size:4 fields:{"0":{name:"x",type:"u8"},"1":{name:"y",type:"u8"}} → typ_e5
add_claim address:$9000 extent:32 is:record typeId:typ_e5 → clm_f6
add_field typeId:typ_e5 offset:2 name:flags type:u8 → fld_g7
```

Use `edit_field` to correct a field by id and `edit_type` for the record's own
properties. Read `where` and the listing to check the layout against the bytes.
Leave unexplained portions as holes. See
[declarations and bindings](05-model.md#5-declarations-and-bindings) for units,
type syntax and reference behavior.

If built-in formats cannot express the data, use a decoder. Inspect an existing
decoder and the `add_decoder` schema first; its input/output contract and
sandbox behavior are described in the model reference and linked source.

## 4. Build a repeatable check

Use `effects` for static effects and `run_block` for a concrete block execution.
Read the result's scope and assumptions: a union of reachable effects and a
single executed path answer different questions.

Use a scenario when the question needs the running machine. This example tests
a narrow memory condition after booting a cartridge; it is not a general proof
about the game's behavior:

```text
add_scenario name:"boot memory check" steps:[
  {kind:"start",at:"$8000",vector:true},
  {kind:"run",frames:220},
  {kind:"assert",memory:{"$C5":0x29},note:"expected memory value after boot"}
] → scn_h8
run_scenario id:scn_h8 target:runtime
```

Inspect every check and warning. Add capture steps when another reader needs
to inspect the output without rerunning it. `run_scenario` returns capture ids
and URLs; `list_scenarios` lets you find retained outputs later. Captures may
contain indexed pixel data or traces rather than a finished publication image.

Keep the target and external byte inputs with the explanation of the result.
The [scenario and capture reference](05-model.md#6-scenarios-and-captures)
describes what the project actually records. A passing check proves its stated
condition under those inputs; naming a scenario as evidence does not establish
that it tests the claim adequately.

## 5. Attach evidence and handle a correction

Inspect `list_evidence claim:<id>` before adding another account. Connect a
repeatable check to the claim it supports:

```text
add_evidence claim:clm_a1 kind:supports method:ran scenario:scn_h8 note:"Explain which assertion tests this interpretation"
```

Only make that connection after the check actually addresses the claim. Use
`capture` for a retained output, `other` for a related claim and `note` for the
reasoning that a reference alone cannot carry.

Use `refutes` to record a contrary account. Use `retire_claim` when deciding to
take an interpretation out of the working set while keeping it and the reason
inspectable. Review it with `list_retired`; `restore_claim` brings it back.
Use `remove_claim` for an entry made by mistake. The
[evidence reference](05-model.md#7-evidence-and-retirement) distinguishes these
effects and identifies their readers.

## 6. Coordinate with another participant

Use the user/session identity supplied by the connection. Distinct sessions
matter even when two participants use the same user id; see
[replica ownership](02-architecture.md#5-collaboration-vocabulary).

`changes_since(cursor)` reads recorded actions; save its returned cursor for the
next read. `pending` on a response reports unmerged work where present. `merge`
explicitly imports the room's state into an MCP session's replica.

Session visibility and undo are still under repair in
[#28](https://github.com/re64/re64/issues/28) /
[#35](https://github.com/re64/re64/pull/35). Until that repair lands, do not
assume all reads use the same replica or that undo is isolated from incoming
work. The architecture tracks this limitation; this guide does not establish a
second session policy.

When undoing, inspect the receipt and read the affected entities again. For
changes to the history implementation, follow S2, S4 and S5 in the contracts
and test durable reconstruction as well as the live result.

## 7. Prepare an article

Start with an editorial question and select findings that answer it. Assemble
the source material, interpretations, checks and media needed for a reader to
assess the account. Preserve target, byte inputs and material limitations.
Caption captured behavior, decoded data, reconstructions and illustrations
according to how they were produced.

An editor's request for a demonstration may expose a missing check or an
incorrect interpretation. Record the resulting discovery or correction back
in the project, including work left out of the finished article.

The [experiment 9 article](../experiments/09-editorial/run1/article.html) and
[editorial notes](../experiments/09-editorial/run1/editorial-notes.md) demonstrate
this process. Apply P1–P3 in the contracts during editorial review. Dedicated
article storage, structured citations and publication versioning remain
unresolved in the architecture; there is no article CRUD workflow to document.

## 8. Implement a change

Locate the existing path for the feature before choosing a representation:

| Work | Start here | Check against |
|---|---|---|
| Add or revise an MCP tool | `src/server/mcp/tools.ts`, `src/server/workspace.ts` | Live schema and transport tests |
| Change shared data | `src/core/project/project.ts`, `src/core/ops/types.ts`, `src/core/crdt/` | Model, algebra and applicable contracts |
| Change analysis or rendering | `src/core/analysis/`, `src/core/view/` | Domain inputs, assumptions and golden listing |
| Change persistence or history | `src/store/`, `src/server/sync.ts` | S2, S4, S5 and store/write-path tests |
| Change an editorial concept | Architecture and P contracts | Explicit design status and experiment evidence |

For a new shared field or entity, identify its owner, identity, references,
independent edits, reader and operation shape. Use the existing edit path and
keep shared-type details inside the CRDT adapter. Trace the value through the
tool schema, handler, operation, adapters, projection and eventual reader;
compilation alone does not establish that a tool exposes or uses it.

The exhaustive `src/core/crdt/roundtrip.test.ts` harness checks the operation
vocabulary. For concurrency-sensitive changes, extend the applicable tests in
`concurrency.test.ts` or `offline.test.ts` to assert the information that must
survive, as well as replica agreement. For persisted shape changes, test opening
old snapshots and using old history. The contracts identify the relevant
failures and verification points.

Run `npm test`, `npm run typecheck` and `npm run build:ui`. If MCP schemas or
generated prose change, run `npm run gen:api` and include the generated diff.
Update the document that owns the changed fact according to the
[documentation ownership table](02-architecture.md#7-maintaining-the-documentation).
Record new reasoning in the decision archive; a workflow example should link to
the rule it demonstrates rather than restate the whole rule.
