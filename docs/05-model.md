# Document model reference

This reference describes current data shapes, their representations and the
code that reads them. Read the [architecture](02-architecture.md) for concepts
and ownership, the [contracts](03-contracts.md) for required behavior, and the
[operation algebra](06-algebra.md) for mutations. Worked tasks belong in the
[developer guide](04-developer-guide.md); exact tool schemas belong in the
[generated API reference](07-api.md).

The definitions in [project.ts](../src/core/project/project.ts) and
[claims/model.ts](../src/core/claims/model.ts), together with their adapters and
readers, are the implementation anchors below. A source comment or historical
decision is not sufficient evidence of current behavior.

## 1. Representations

| Representation | Contains | Entry point |
|---|---|---|
| Project document | Mergeable state in one replica | [CRDT adapter](../src/core/crdt/doc.ts) |
| `Project` | Plain serializable project data, also used for import/export | `projectFromDoc`, [project types](../src/core/project/project.ts) |
| Program projection | Project data with messages removed | `programFromDoc` |
| Loaded project | Target-selected layers, resolved byte sources and absolute domain claims | [loader](../src/core/project/loader.ts) |
| `.re64` text | Serialized project content; may also contain legacy input shapes | [parser](../src/core/project/project.ts), [serializer](../src/core/project/serialize.ts) |
| Database snapshot and history | Stored CRDT state/updates and operation records used for persistence, reconstruction and undo | [store](../src/store/project-store.ts) |

A `Project` value is not a second live replica. Editing the plain value does
not synchronize it. It also does not contain all CRDT metadata, operation
history, blob bytes or session state.

Optional ids on import types allow older files to load.
[Identity helpers](../src/core/project/identity.ts) establish ids before
document operations address the entities. Claims in the loaded domain have a
required id and numeric absolute address.

## 2. Document roots

The root layout and projection are defined in
[crdt/doc.ts](../src/core/crdt/doc.ts). Maps holding entities use nested maps
for their fields unless stated otherwise.

| Root | Document shape | Project representation |
|---|---|---|
| `layers` | Ordered array of layer maps; annotations and use maps nested within each layer | `layers: ProjectLayer[]` |
| `claims` | Map by claim id, flattened claim fields | `claims: ProjectClaim[]` |
| `targets` | Map by target id | `targets: ProjectTarget[]` |
| `constants` | Map by constant id | `constants: ProjectConstant[]` |
| `decoders` | Map by decoder id | `decoders: ProjectDecoder[]` |
| `types` | Map by type id; nested field maps keyed by field id | `types: ProjectType[]`, each with a field list |
| `files` | Map by filename | `files: {name, hash, size}[]` |
| `primaryLabels` | Map from address key to claim id | `primaryLabels: Record<string, string>` |
| `meta` | Project scalars: name, description, entryPoints | Corresponding top-level properties |
| `scenarios` | Map by scenario id; steps stored as one JSON string value | Scenarios with ordered step lists |
| `captures` | Map by capture id | `captures: ProjectCapture[]` |
| `evidence` | Map by evidence id | `evidence: ProjectEvidence[]` |
| `chat` | Ordered array of message maps | `messages: ProjectMessage[]` |

Map projections use deterministic ordering; layer and chat sequences retain
their stored order. S3 defines the ordering obligation. The `meta.set`
operation exposes only name and description; a stored scalar is not necessarily
editable through every surface.

Presence is maintained by [participants.ts](../src/core/crdt/participants.ts)
outside the project projection. Chat survives project export but is removed
from the program projection used for the program version. Chat is excluded from
program undo; explicit message operations are still part of the algebra.

## 3. Layers and targets

A `ProjectLayer` has an id and a byte-source type, with optional name,
reference flag, annotations and uses:

| Type | Source and placement |
|---|---|
| `prg` | File at `path`; its first two bytes provide the load address |
| `raw` | File at `path`, with declared `address` |
| `bytes` | Inline hex `bytes`, declared address and optional repeated `length` |
| `symbols` | Annotations without bytes or an occupied range |
| `rom` | Host-supplied BASIC, KERNAL or character ROM at its hardware address |

`reference: true` excludes a layer from the rendered listing while leaving its
bytes available for resolution; ROM layers default to reference. Legacy
`labels` and `regions` are input compatibility fields. Current interpretations
are claims.

A `ProjectTarget` carries `id`, `name`, an ordered `layers` list and optional
`entryPoints`, `order` and `description`. A list entry is a layer id or
`{id?, layer, at?}`. Explicit `at` relocates that layer in this target;
otherwise it uses its source address. Later links shadow earlier links.
Symbols layers remain available without being linked. Missing layer references
are skipped.

A target can represent a packed image, decrunched memory, a loader stage or a
patched arrangement. Its stored fields describe an arrangement; they do not
record the transformation between those images or a live CPU/device state.

Target selection is implemented by `selectTarget`, `projectForTarget` and
`withSyntheticTarget` in the loader:

- Requests needing a memory arrangement select a target by id or unambiguous
  name. With several targets, omission is refused.
- A single target is unambiguous. A project with none can use its whole stack;
  `withSyntheticTarget` supplies one arrangement for surfaces that need one.
- Document-only operations, such as listing targets or editing a type, do not
  require target selection.
- There is no stored `defaultTarget`. Target selection belongs to request or
  client context. Target `order` is descriptive sequencing, not a default.

## 4. Claims and frames

The loaded `Claim` in [claims/model.ts](../src/core/claims/model.ts) has
`id`, numeric absolute `at`, `origin`, and optional `frame`, `extent`,
`name`, `says`, `root` and `description`.

| Value | Alternatives |
|---|---|
| `Frame` | `{space:"address"}`, `{space:"layer", layer:<id>}`, `{space:"target", target:<id>}` |
| `Interpretation` | `{is:"data"}`, `{is:"text", encoding?, view?}`, `{is:"bitmap", view?}`, `{is:"jumptable"}`, `{is:"record", typeId}` |
| `RootKind` | `entry`, `routine`, `location`, `data` |
| `ClaimOrigin` | `user`, `layer`, `platform`, `auto`, `analysis` |

The project/file/document representation flattens `says` into `is`,
`encoding`, `view` and `typeId`, and the frame into `layer` or `target`.
Omitting both frame fields denotes address-space scope. A layer-framed stored `at` is
an offset; the loader adds the selected layer placement to obtain absolute
`Claim.at`. MCP address arguments are absolute and named `address`; they are
not the file's `at` field.

`placed` in [ops/edits.ts](../src/core/ops/edits.ts) chooses the topmost byte
layer as the default owner. With no supplying layer it chooses address-space
scope, which travels across targets. Explicit target frames are represented
and filtered by the loader; selecting a target for a request does not by itself
give a new claim a target frame. Which writes should expose explicit target
framing remains a design question.

`extent` always measures bytes. Absent extent is a point; for a record claim
the number of records is derived from extent divided by the type's size.
It is not a stored record count. The interpretations have no `code` or
`unknown` member; decode roots and absence of interpretation serve those roles
under the B contracts.

| Field | Reader/effect |
|---|---|
| `says` | Row strategy and interpretation disagreements |
| `encoding`, `view`, `typeId` | Text/bitmap rendering or record layout |
| `extent` | Span, containment and record-array reach |
| `root` | Decode roots and root-in-data disagreements |
| `frame` | Relocation and target filtering |
| `name` | Label rendering and name disagreements |
| `origin` | Name ranking, platform-name hiding and hygiene filtering |
| `description` | Explanatory text |

See [claim names](../src/core/claims/names.ts),
[claim set](../src/core/claims/set.ts) and [rows](../src/core/view/rows.ts).
Provenance belongs to evidence; `origin` is not a contributor's identity.

## 5. Declarations and bindings

| Declaration | Project fields | Reference/use |
|---|---|---|
| Constant | `id, name, value` | Layer `constantUses`: site address → constant id |
| Type | `id, name, size, unit?, fields` | Claim `typeId`; nested field-type expression |
| Decoder | `id, name, source` | Claim `view: "snippet:<id>"` and decoder tools |

Layer `labelUses` similarly bind a site to a claim id under the legacy field
name `label`. Both use maps are keyed by normalized site address in the
document; their project lists retain use ids for operation/history
compatibility. `primaryLabels` is a project-level address → claim-id choice.
The algebra owns bind/unbind semantics.

### Record fields

Each field is `{id, offset, name, type, description?}`. The project holds a
list; the document keys nested field maps by id. Several fields can occupy
one offset. `size` is declared rather than computed from the fields, so holes
are representable.

Field syntax is parsed by [memory/type.ts](../src/core/memory/type.ts):

| Form | Meaning |
|---|---|
| `u8`, `i8`, `u16`, `u16be`, `ptr`, `ptrbe` | Numeric and pointer fields with explicit width/order |
| `char(n)`, `char(n,encoding)`, `bytes(n)` | Text or byte spans |
| `bits(n)` | Field within a bit record |
| Another type's id | Nested record |
| `T[n]`, `T[first..last]` | Array and optional nonzero index origin |
| `T[countConstantId]` | Array with a named count reference |
| `T[4][8]` | Nested arrays, outer dimension first |

A type's `unit` defaults to bytes; `unit:"bits"` makes field offsets count
bits. Type `size` and `fieldSize` still measure bytes; `fieldBits` handles
bit widths. Bit records can nest inside byte records. `pathAt` derives paths
such as `zones[2].name`; paths are not stored and holes produce no field path.

Readable type/count names are resolved at the boundary and ids stored inside
field expressions. Resolution accepts an id, a unique name, or `name@id`
where supported; an ambiguous name is refused. A name is not made unique by
deleting a competing declaration. Missing references use the relevant reader's
fallback rather than a cascading deletion.

### Decoders

`source` is the body of a function receiving `(bytes, params)` and returning
a validated `Decoded` value. [sandbox/run.ts](../src/sandbox/run.ts) runs it
in a worker with SES and a timeout; the browser uses
[decoder-worker.ts](../src/ui/decoder-worker.ts). Decoders drive tools and the
explorer. The synchronous listing does not execute arbitrary decoder source.

### Reference limits

Constant and label use sites still store absolute addresses within their layer;
relocation-aware binding frames are [#26](https://github.com/re64/re64/issues/26).
Files are `{name, hash, size}` records keyed by name. Layers reference paths
and captures reference filenames, while blob content is keyed by hash.
Stable file identity is [#27](https://github.com/re64/re64/issues/27).
A content hash does not turn the filename referring to it into an immutable id.

## 6. Scenarios and captures

A `ProjectScenario` is `{id, name, description?, steps}`.
[ProjectStep](../src/core/project/project.ts) defines the ordered actions:
start, set registers/memory, joystick input, keyboard input, run, assert and
capture.

Steps have ids but are stored and replaced as one list. There are no independent
step edit operations: two revisions to the list compete as whole values.
This differs from independently editable record fields. Step ids also let
capture records name the step that produced them.

A `ProjectCapture` is:

```text
id, scenario, step, kind, file, when?
```

`scenario` and `step` identify the source; `kind` is ram, screen, frames,
trace, sid or devices. `file` names the retained bytes. Captures are separate
document entities referencing scenarios, not children embedded in the scenario
record. Removing a scenario keeps its captures.

Machine state is derived by [machine/scenario.ts](../src/core/machine/scenario.ts)
from steps and execution inputs. In-memory checkpoints accelerate reruns.
Retained capture bytes and records persist separately. Neither a scenario
reference nor a capture record contains a complete immutable bundle of every
target, ROM and external input; execution keys and S6 must account for actual
inputs, and publication reproducibility remains a separate design obligation.

## 7. Evidence and retirement

`ProjectEvidence` has `id`, `claim`, `kind` and optional `author`,
`method`, `when`, `scenario`, `capture`, `other` and `note`.
The project/document fields flatten provenance; the operation layer groups it
under `by`. Replacement and clear behavior belongs to the operation algebra.

| Field | Meaning and reader |
|---|---|
| `claim` | Claim id the account concerns |
| `kind` | `supports`, `refutes` or `retires`; read by disagreement/retirement logic |
| `author`, `method`, `when` | Attribution reported by evidence/claim reads |
| `method` | `guessed`, `transcribed`, `read`, `derived`, `ran`; also used in corroboration/hygiene descriptions |
| `scenario` | A workflow that can be rerun to inspect its checks |
| `capture` | Retained output that can be inspected without rerunning |
| `other` | Related claim, such as a competing interpretation or replacement |
| `note` | Explanation a reference alone does not supply |

Claim creation through MCP adds the caller's supporting account. Claim-tool
`method` arguments are conveniences for that evidence. Several authors can
support one claim without sharing a provenance field on the claim.

`refutes` reports a contrary account without hiding the claim. A live
`retires` record removes its claim from the loaded working set while retaining
the claim and evidence in the project and export. Retirement is derived by
`retiredClaimIds` and filtered by the loader. `restore_claim` removes retirement
evidence. The API requires a reason via `note` or `other` for refutation and
retirement. `other` is not a ranking or a supersession chain.

Different methods can help expose correlated reasoning, but do not prove
independence or truth. A scenario link permits a repeatable check; its assertions
and inputs still determine what the check establishes. The model stores no
confidence score or automatic ranking of evidential strength.

## 8. Comments, chat and derived readers

Comments are layer-owned `{id, address, placement?, text, order?}` records.
Placement is before, inline or after. Multiple comments can occupy an address.
Messages are `{id, at, author, name, text}`, where `at` is a timestamp;
message ordering is conversation order, not address order.

Analysis and rendering derive names, record paths, decode graphs, blocks,
routine effects and listings from loaded data. The following readers answer
different questions:

| Reader | Inputs | Result |
|---|---|---|
| [`disagreements()`](../src/core/claims/set.ts) | Claims and evidence | Declared refutations, shared names, overlapping interpretations, roots inside data |
| [`checkHygiene()`](../src/core/analysis/hygiene.ts) | Annotations and analysis context | Annotation problems and missing/inconsistent references |
| [`findings()`](../src/core/claims/review.ts) | Claims and decode graph | Code in interpreted spans, unreached claims and unexplained bytes |

A known distinction remains: `disagreements()` suppresses an interpretation
conflict when one span contains the other, while hygiene can report different
interpretations on that containment. These reports do not select a winning
interpretation.

## 9. Compatibility and open boundaries

File parsing/loading accepts legacy labels, regions, id-less entities and
older field layouts. [claims/migrate.ts](../src/core/claims/migrate.ts) and the
identity helpers establish the current project form. Stored CRDT snapshots
also require migration when opened; file migration alone does not reach them.

Field maps formerly keyed by offset and use maps formerly keyed by use id are
migrated and persisted by the store. Old operation rows retain their payloads;
[ops/legacy.ts](../src/core/ops/legacy.ts) and the adapters preserve supported
historical field and binding behavior during replay. S5 defines the obligation
and links the repair origins. This does not promise compatibility for every
obsolete operation spelling.

The architecture owns the status of session visibility, binding coordinates,
file identity, schema nullability and article representation. Do not infer that
those gaps are closed from this reference. In particular, current session
machinery does not yet give every read and undo path consistent isolation.

Other limitations visible in the current model:

- `view` on a claim is a rendering format; a target is a memory arrangement.
- `record` interpretations reference reusable layouts; record count is derived.
- The committed Gridrunner example still uses legacy labels/regions, so it is
  not a template for writing the current claim format.
- An operation existing in `Op` does not prove that every API/UI exposes it.
  `layer.set` exists, but the current MCP surface has no layer rename tool.

Historical arguments and the earlier long-form reference are indexed in the
[documentation decision](decisions/README.md#reference-boundaries--2026-09-11).
