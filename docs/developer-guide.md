# re64 for developers

What the document model is, what the API does, and how to use both. Written to
be read start to finish once; after that, `docs/algebra.md` is the rule sheet and
`docs/model.md` is the reference.

---

## 1. The shape of the thing

A **project** is a CRDT document — a Yjs `Y.Doc` — backed by SQLite. Every
participant holds a copy, edits merge without a coordinator, and a `.re64` file
is an *import source* or an *export target*, never the truth.

There is no save step. An edit is durable when the call returns.

The document has a small number of top-level roots:

| root | holds |
|---|---|
| `layers` | where the bytes come from, and the annotations that describe those bytes |
| `claims` | what anybody says about an address |
| `constants` | names for values |
| `decoders` | sandboxed JS that reads bytes nothing built-in can |
| `types` | record layouts |
| `targets` | named views over the layer stack |
| `files` | uploaded binaries, content-addressed |
| `primaryLabels` | which of several names at an address renders |
| `chat`, `participants` | people and what they said; deliberately outside the project projection |

---

## 2. Bytes: layers and targets

A **layer** is a dumb byte resource. It knows what bytes it has and nothing about
where it sits. A PRG file, a raw dump, a ROM, or a *symbols* layer that carries
no bytes at all.

A **target** is a named view: an ordered list of **links**, each putting one layer
at one address. Order is z-order — the last link shadows the ones before it.

```
target "runtime"
  ├── link → layer "platform symbols"   (no bytes; names only)
  ├── link → layer "packed.prg"  at $0801
  └── link → layer "decrunched"  at $0801   ← shadows the packed bytes
```

This is why a target is better described as **a phase of the program's life**
than as a filter. A game loads, decrunches, then pulls in levels; each is a
target, each correct at a different moment. `order` says which comes first and
`description` says what the phase is.

**Every read takes a `target`.** There is no current target on the server — a
view is a parameter of the request, because one client can show two at once and
neither may move the other. Omit it and you get the project's `defaultTarget`.

What this does **not** solve is banking: `$D000` being VIC registers or character
ROM depending on `$01` is runtime alternation inside one moment, not a sequence
of moments. Layers cannot express it and stacking two does not help.

---

## 3. Meaning: the claim

**One noun for everything anybody says about an address.**

```ts
{ id, at, frame?, extent?, name?, says?, root?, description?, by }
```

- `name` — what to call it
- `says` — what the bytes are: `data`, `text`, `bitmap`, `jumptable`, `record`
- `extent` — how many bytes it covers; absent means a point
- `root` — decode from here regardless of what reaches it
- `by` — who said it, and how it arose

Three things about this shape decide almost everything else.

**There is no `code` and no `unknown`.** Code is what bytes are when nobody has
said otherwise, so a claim never says it — "decode from here" is a `root`. And
not saying is how you do not say; `unknown` was the absence of a claim wearing
the name of a kind.

**Several claims cover any interesting address, and that is the design.** `$08`
is a scratch byte in most of a program and something specific in one routine, and
both are true. So an address cannot identify a claim, every write adds, and
correcting one is by id.

**Nothing resolves at rest.** Which name an operand shows, which reading a row
uses, what nests inside what — all derived when something asks.
`disagreements()` reports where the project contradicts itself; it never picks a
winner.

### Where a claim lives

A claim belongs to a **layer** when a layer supplies those bytes, and to the
**target** otherwise. You do not choose: it is derived from the topmost layer in
the current view supplying that byte. It is *reported* on every write and read,
because it decides whether the claim travels when the stack is reordered — and a
property only the writer can see is one that gets fought over.

Layer-scoped claims are stored **relative to the layer's bytes**, so relinking a
layer at a different address moves its annotations with it by arithmetic rather
than by promise. Offsets never cross the wire: every tool is absolute.

---

## 4. The other four entities

**Constants.** A name for a *value*, and a value has no single meaning —
`LEFT_ZAPPER = $01` and `WHITE = $01` in the same program. So it is two objects:
a **declaration** at project level, and a **use** binding one instruction site to
one declaration. `LDA #$01` stays `#$01` until somebody says which they meant,
and nothing infers it.

**Types.** A record layout: a size, and fields by offset. **Holes are legal** —
`size` is declared rather than derived, so a reader who has proved nineteen
fields of a 200-byte record can say so without inventing padding. How many
records is derived from `extent / size`; storing a count would be a third fact
that can disagree.

**Decoders.** Sandboxed JavaScript, `bytes → data`, for the cases no built-in
format covers — a title screen packed with run-length encoding is assembler
logic, and the honest way to express that is code. It runs under SES with no
ambient authority: no network, no filesystem, no clock, no randomness. A decoder
that fails makes a listing plainer, never absent.

**Layers.** Above. The only editable field is `name`; the rest is what the layer
*is*.

**Scenarios.** What to ask the machine to do: a list of typed steps — `start`,
`set`, `input`, `run`, `capture` — executed in order. A list rather than a script,
because you cannot checkpoint inside a running function and prefix caching is
what makes "continue from step five" cheap.

**Captures.** What a run produced, and where it went. The bytes go to the
content-addressed blob store; the document holds a reference, so a capture
travels wherever the project travels.

**Evidence.** Something said about a *claim* rather than about an address:
`supports`, `refutes` or `supersedes`. See §4b.

---

## 4a. Watching it run

`run_block` and `effects` answer what code *is*. A **scenario** answers what a
program *does*, by running it on a machine with chips attached: a raster counter
that advances with cycles, timers, joystick ports, and a SID that records what it
was told.

```
add_scenario name:"play" steps:[
  {kind:"start",   at:"$8000", vector:true},
  {kind:"run",     frames:220},
  {kind:"input",   port:1, fire:true},
  {kind:"run",     frames:200},
  {kind:"capture", what:"frames", count:5, every:40, name:"playing.json"},
]                                                        → scn_a1
run_scenario id:scn_a1
```

Three things about this are worth knowing before using it.

**The machine is never stored.** It is derived from the steps and the project's
bytes, so the script is the truth and the machine is a cache keyed on a prefix of
it — held in memory, lost on restart, and a miss simply re-runs from the start.
That is why the surface stays stateless and why there is no "session".

**Running is deterministic**, which is what makes resuming safe. Input is
*scheduled* rather than delivered live for exactly this reason: the same steps
over the same bytes produce the same machine, byte for byte.

**A capture is evidence.** It goes to the blob store and gets a record in the
document saying which step of which scenario made it, so what a run produced can
be read again — and by somebody else — without running it.

What it does not model is stated rather than discovered: no badlines or sprite
DMA, no bitmap mode or sprites in a composed frame, the SID as a write log rather
than audio, and banking still absent. `docs/decisions/machine.md` has the whole
list.

---

## 4b. Evidence: saying something about a claim

A claim carries **`method`** — *how* the author knows, not how sure they are:
`guessed`, `transcribed`, `read`, `derived`, `ran`.

That axis is not a preference. Experiment-0 put two agents on one binary; both
concluded that glyphs `$03`/`$04` were never drawn, both were wrong, and the
refutation was sitting in one of their own screen dumps. They agreed because they
used the **same** static reasoning and shared its blind spot — so "two accounts
agree" read as corroboration when it was one account arriving twice. One of them
named the rule exactly: *agreement between two accounts is only evidence when the
methods differ.* A confidence score cannot detect that; a method can. So
`claims_at` reports `method`, and hygiene says whether duplicates were reached
different ways.

`transcribed` earns its own place: it is the category both agents' trust ledgers
lacked, and *"the one that generated most of the errors on both sides"*.

Beyond the claim, `add_evidence` says something **about** a claim:

| kind | for |
|---|---|
| `supports` | what backs it — ideally a `scenario`, which re-runs |
| `refutes` | it is wrong, and by what |
| `supersedes` | an earlier reading, kept rather than deleted |

Three things this makes expressible that nothing did:

**A refutation that shares no bytes.** `disagreements()` sweeps for claims
covering the same address. Neither real disagreement in experiment-0 had that
shape: `$8DF9` holding `$3B` refutes a claim about the *glyph* `$3B`, which lives
somewhere else. Declared refutations now come back from `disagreements` as
`kind: "declared"`.

**A refutation attached to a reading rather than a place.** *"It isn't a comment
on an address, it's a comment on an interpretation"* — a comment at `$19` cannot
say "I already tried `SC`, and it is wrong".

**Withdrawing without deleting.** `remove_claim` destroys. A superseded claim
stays, with the reason, because the wrong model that led to the right place is
worth keeping.

### Evidence that re-verifies

A scenario can `assert`, which makes it a **probe**:

```
add_scenario name:"the score awards 400" steps:[
  {kind:"start",  at:"$8000", vector:true},
  {kind:"run",    frames:220},
  {kind:"assert", memory:{"$C5":0x29}, note:"paused with the ship stopped"},
]                                                        → scn_b2
add_evidence claim:clm_a1 kind:supports scenario:scn_b2
```

`run_scenario` then returns `passed` and one line per check. This is the form
both experiment-0 agents asked for in almost the same words — they had run their
checks, the checks lived in shell history, and `findings.md` was left saying
"verified in emulation" with the instrumentation gone.

---

## 5. The API: two shapes, and no third

This is the part worth learning once. Full rules in `docs/algebra.md`.

**Entity** — claim, comment, constant, decoder, type, layer, target:

| | |
|---|---|
| `add_*` | mints the id, **always adds**, returns the id |
| `edit_*` | by id. Names the fields that change; omitted are left alone; `null` clears |
| `remove_*` | by id |

**Binding** — a use pointing at a declaration, or a chosen primary name:

| | |
|---|---|
| `bind_*` | put a key. Binding it again repoints it |
| `unbind_*` | clear the key |

Two verbs is complete for a map, because create and update are the same act on a
key.

### Four rules that follow, and are enforced

**1. An add never takes an id, and a set never creates one.** The server mints
and returns; an id nothing holds is an error. A write that creates on an
unrecognised id is an upsert wearing a different spelling.

**2. Names resolve on reads. Writes take ids.** You may *select* a view by name,
or search for a constant by name. You may not remove one by name. "Unambiguous"
is a property of what you have synced — a name reaching one constant for you may
reach two for a peer — so a write keyed on it does different things depending on
what arrived.

**3. A revision names only what it changes.** Sending the whole object means
reasserting fields you never read, which silently reverts a collaborator.

**4. Every write returns the ids it made.** A write whose result cannot be named
again is one the caller has to go looking for.

### Doing the common things

```
# name an address
add_claim at:$8100 name:InitializeGame root:routine     → clm_a1

# correct it — names only what changes; omitted is left alone, null clears
edit_claim id:clm_a1 name:SetUpGame

# say what bytes are
add_claim at:$8E00 extent:512 is:bitmap view:"char:8"    → clm_b2

# a second opinion at the same address — both stand
add_claim at:$8100 name:MaybeInit                        → clm_c3
bind_primary_name address:$8100 claim:clm_a1

# a value, and a site that means it
add_constant name:WHITE value:$01                        → cst_d4
bind_constant address:$8213 constant:cst_d4

# a view over the stack
add_target name:runtime layers:[{layer:lay_1},{layer:lay_2,at:$0801}]  → tgt_e5
edit_target id:tgt_e5 description:"after the decruncher"
```

### What the API refuses, and what it does not

A write may refuse on **a fact about the request** — an id nothing holds, a
jumptable covering an odd number of bytes, a layer linked into one target twice.
It does not refuse on **a judgement about the result**. Two people producing an
untidy document is the expected outcome: it converges, it is visible, and
somebody tidies it. `list_warnings` reports facts about the program;
`disagreements()` reports where the project contradicts itself.

The governing rule, which has caught more bugs than any amount of reasoning
about layers: **what works offline — locally, ignorant of every other edit — must
also work online, and the reverse.** There is no second mode.

---

## 6. Reading

`read_disassembly` and `list_claims` return **structured rows, never rendered
text** — character offsets into a column are useless to a caller, which is the
finding the whole agent surface was built on.

Everything derived is derived on demand and cached per document version: the
decode graph, basic blocks, the value analysis, routine effects. Asking is cheap;
nothing is stored that can be computed.

Three tools answer "what does this code *do*", and they differ in **standing**,
which the answer states:

- `effects follow:block` — exact, because a block has one path through it
- `effects follow:routine|calls|returning` — a union over reachable code: what it
  *can* touch, never what it must
- `run_block` — concrete: run it with values you supply, and every value says
  whether it was `given`, from the `image`, or `unknown`

That last distinction is the house style. A result that rests on an assumption
says so, because a result that silently assumed zeros looks exactly like one that
did not.

---

## 7. History, undo, and identity

Every write — browser, agent, HTTP — leaves the same append-only `ops` record
with an author and a computable inverse. `changes_since(cursor)` is how a client
without a socket catches up.

**Grouping is a record of intent and can never be a guarantee about state.** Yjs
converges; it is not a distributed transaction. Three renames from one peer
interleaved with one from another converge to a state where the group is partly
superseded, and nothing remembers there was a group. So grouped undo is *partial
and reported*: it skips any operation whose target moved since and says which.

Identity rides on a header, never a tool argument. An identity that matches
nothing is **kept as claimed**, not swapped for somebody real.

---

## 8. Where to look next

| | |
|---|---|
| `docs/algebra.md` | the operation rules, and what they replaced |
| `docs/model.md` | the model as reference, with its open tensions |
| `docs/api.md` | the tool list, from the live schema |
| `docs/purpose.md` | what this is for |
| `docs/invariants.md` | what must not break, with the bug that produced each |
| `docs/experiments.md` | the runs, and which line of code each moved |
| `docs/decisions/` | the argument and the history, by subject |

**If you are adding an entity**, pick a shape from `docs/algebra.md`, add its
three (or two) operations, and let `src/core/crdt/roundtrip.test.ts` tell you
what is missing — it is keyed by `Op["op"]`, so it will not compile until your
operation has a case, and the case asserts all seven paths: applied to the
document, carried by the projection, surviving the export, emitted by the diff,
inverting, undone, and its id minted when a file omits one.
