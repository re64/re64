# The re64 document model, as it stands

What the model *is*, with no account of how it got here. `CLAUDE.md` carries the
reasoning and the history; this carries the shape. Where the two disagree, read
the code — but this file is meant to be checked against it and kept true.

Written to be read cold, in about ten minutes, by somebody deciding what to
change. `docs/api.md` is how you reach it, and `docs/experiments.md` is where most of
this came from.

---

## 1. The document

A project is a Yjs document with nine roots. It is the truth; a `.re64` file is
an import source or an export target and is never synced to.

| root | holds | shape |
|---|---|---|
| `layers` | byte resources | array, order is declaration order |
| `claims` | everything anybody says about an address | map by id, flat |
| `targets` | named arrangements of layers | map by name |
| `constants` | `{id, name, value}` | map by id |
| `decoders` | `{id, name, source}` | map by id |
| `types` | `{id, name, size, fields}` | map by id, fields nested by offset |
| `files` | the binaries, content-addressed | map by name |
| `primaryLabels` | address → claim id | map |
| `meta` | `name`, `description`, `defaultTarget` | map |

Two further roots live in their own modules — `crdt/chat.ts` and
`crdt/participants.ts` — and are deliberately outside `projectFromDoc`'s
whitelist, so a message or an arrival never reaches a `Project`, never reaches
an export, and never moves the version.

---

## 2. Layers — byte resources

A layer holds bytes and knows nothing about where it sits.

```ts
type: "prg" | "raw" | "bytes" | "symbols" | "rom"
```

- **`prg`** — a file whose first two bytes are its load address
- **`raw`** — a file placed at an address the project gives
- **`bytes`** — inline hex, optionally repeated to a length
- **`symbols`** — names only, supplies no bytes, occupies no range
- **`rom`** — a machine ROM (`basic`, `kernal`, `characters`), resolved from the
  host, landing where the hardware decodes it

A layer may carry `reference: true` — bytes to resolve *through* rather than to
read. Default for `rom`. Reference layers answer every question and are left out
of the rendered listing.

A layer still owns its **comments**. It also still declares `labels` and
`regions` in the schema; those are read when migrating an older file and are
never written.

---

## 3. Targets — arrangements

A target is a memory map: which layers, in what order, at what address.

```json
{ "name": "runtime",
  "layers": ["lay_symbols", { "layer": "lay_runtime", "at": "$0100" }],
  "entryPoints": ["$C065"],
  "order": 2,
  "description": "the image the loader expands into" }
```

- **Order is z-order**, bottom-up: the last entry shadows the ones before it.
- A bare id links a layer at its own address; the object form moves it.
- A symbols layer is never linked and never filtered.
- A link naming a layer that has gone is skipped, not refused.

**There is no current target on the server.** A view is a parameter of the
request: every tool takes `target`, every answer reports the one it used, and a
project may declare `defaultTarget` for callers that name none. A project
without targets gets one derived from its layers in declaration order.

---

## 4. Claims — statements about addresses

One noun. Formerly two: a "label" is a claim with a `name`, a "region" is a
claim with an `extent` and an interpretation.

### In the model

```ts
interface Claim {
  id: string
  at: number            // absolute, always, in the domain
  frame?: Frame         // what it belongs to
  extent?: number       // how far it reaches; absent means a point
  name?: string
  says?: Interpretation // what the bytes are
  root?: RootKind       // decode from here
  description?: string  // what a name means on this machine
  by: Provenance
}
```

At least one of `name`, `says`, `root` must be present.

### The four value types

```ts
Frame = { space: "address" }                        // the machine
      | { space: "layer";  layer: string }          // stored as an offset
      | { space: "target"; target: string }         // absolute in that target

Interpretation = { is: "data" }
               | { is: "text";   encoding?: TextEncoding; view?: string }
               | { is: "bitmap"; view?: string }
               | { is: "jumptable" }
               | { is: "record"; typeId: string }

RootKind = "entry" | "routine" | "location" | "data"

Provenance = { author: string
               source: "user" | "layer" | "platform" | "auto" | "analysis"
               when?: number
               confidence?: "asserted" | "inferred" | "guess" }
```

### In the file and the API

`says` and `by` are flattened, so what a reader meets is sixteen flat keys:

```
id  at  extent  name  is  encoding  view  typeId  root  description
target  layer  author  source  when  confidence
```

**Six are conditional on another field's value:**

| field | meaningful only when |
|---|---|
| `encoding` | `is: "text"` |
| `view` | `is: "text"` or `is: "bitmap"` |
| `typeId` | `is: "record"` |
| `layer` | layer-framed |
| `target` | target-framed |
| `extent` | means a span with `is`, an array's reach with `name`, a record count with `is: "record"` |

### Scope

Derived from the address, never chosen: the topmost layer supplying the byte,
else the target. A layer-framed claim stores an **offset** into that layer's
bytes; the loader adds the layer's start back. Offsets never appear in any tool
argument or answer. Every write reports the scope it derived.

`view` values: `char:N`, `bits:N`, `sprite`, `sprite-multi`, `snippet:<id>`.

---

## 5. The three declaration tables

Each splits a declaration from its uses, for the same reason: a declaration
describes no bytes, so there is no layer for it to travel with.

| | declaration (project) | use |
|---|---|---|
| constant | `{id, name, value}` | `{id, address, constant}` in the owning layer |
| decoder | `{id, name, source}` | `view: "snippet:<id>"` on a claim |
| type | `{id, name, size, fields}` | `says: {is: "record", typeId}` on a claim |

**Types.** `size` is bytes per record, declared rather than summed, so holes are
legal. `fields` is keyed by offset and carries no ids — two fields cannot share
an offset, so the key is the identity. Field types: `u8`, `i8`, `u16`, `u16be`,
`ptr`, `ptrbe`, `char(n)`, `char(n,encoding)`, `bytes(n)`, or another type's
name. How many records a claim holds is `extent / size`, derived.

A reference to a declaration that has gone renders the bytes, the literal, or
the plain value. Nothing sweeps.

---

## 6. Comments

Their own objects: `{id, address, placement, text, order?}` with placement
`before | inline | after`. Owned by a **layer**, unlike claims. Every comment at
an address renders; there is no index choosing one.

---

## 7. What is derived and never stored

- which name an operand shows (all claims at the address, plus `primaryLabels`)
- whether a byte is code (a walk from the roots)
- the region tree, the equate block, the TYPE block
- how many records an array holds
- basic blocks, the call graph, routine extents, effects
- disagreements and hygiene findings
- the listing itself

---

## 8. Known tensions

Stated without recommendations.

**The claim object does six jobs.** Identity, position, naming, interpretation,
decoding, provenance — sixteen flat keys in the file, six of them conditional on
a neighbour's value. That is a discriminated union flattened into a record. The
flattening buys one-line diffs and costs comprehensibility.

**One concept, two spellings.** The model says `claim.says.is`; the file and API
say `is`. `primaryLabels` is named for an object that no longer exists and is
indexed by claim id; the tool that sets it is `set_primary_name`.

**"View" means two things.** `view` on a claim is a rendering format
(`char:8`). A *target* is also routinely called a view, including in tool
descriptions. Both can appear in one call.

**`record` is unlike its siblings.** `data`, `text`, `bitmap` and `jumptable`
are byte-local. `record` points at a project-level declaration and changes what
`extent` means. Nothing in the name says an array.

**`root` and `says` are not orthogonal in practice.** Every interpretation is
given `root: "data"` so it renders, so a field that reads as a separate concern
is usually a consequence of another.

**The reference project is still in the legacy shape.** `gridrunner.re64` holds
layer `labels` and `regions` and no `claims` key; it is migrated in memory on
every load. The golden test pins the legacy file. Anybody opening the repo's
canonical example to learn the format sees the model that was replaced.

**Surfaces are lopsided.** MCP reaches 72 tools. The CLI reaches labels,
regions, undo/redo, import/export. The browser's whole write surface is
`addLabel`, `removeLabel`, `setRegion`, `removeRegion`, `undo`, `redo` — no
comments, constants, decoders, types, targets, roots, or anything claims-native,
though all of them are modelled and reachable by an agent.

**`layer.set` does not exist.** A layer cannot be renamed. Reordering is now a
target edit, so the gap is narrower than it was, but a layer's own fields are
still immutable after creation.
