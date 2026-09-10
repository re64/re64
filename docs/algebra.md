# The operation algebra

Every low-level type is one of **two shapes**, and each shape has exactly one set
of verbs. There are no other spellings, no per-type exceptions, and no upserts.

This document exists because the vocabulary drifted into **three** different
update semantics without anyone writing them side by side — each type was shaped
when a different bug was fresh, and each was locally reasonable. Set out in a
table it was obviously wrong.

## Shape 1 — Entity

Has an **id**, minted by the writer. Lives in a collection.

| verb | meaning |
|---|---|
| `<n>.add` | mints the id and carries the whole value. **Always adds, never replaces.** |
| `<n>.set` | by id. **Partial**: named fields change, omitted fields are left alone, `null` clears. |
| `<n>.remove` | by id. |

Members: **capture, claim, comment, constant, decoder, evidence, field, layer,
message, scenario, target, type.**

**A message is an entity, and undo still does not reach it.** Chat was outside
this vocabulary on the ground that "unsay that" has no computable inverse —
`message.add` inverts to `message.remove`, so it does. The real objection was
that Ctrl-Z must not eat what somebody said, and that is a question about what
*undo replays*, not about what the algebra covers. Chat therefore has three
verbs and stays outside the undo manager's tracked roots; taking a message back
is `remove_message`, which somebody decides. It is also the one entity stored as
a **list** rather than an id-keyed map, because the order of a conversation is
its content — the opposite of a field or a binding, where position was
masquerading as identity.

**Being nested does not make something a lesser entity.** A field lives inside a
type and a capture inside a scenario, but each has its own id and its own three
verbs, because the alternative is what `edit_type` used to do: carry the whole
field list, so two writers editing different fields of the same record lose one
of the edits, and a caller who omits a field cannot be distinguished from one
who meant to remove it. The containing entity's `set` therefore never carries
its children — it names the parent's own fields and nothing else.

**Every meaningful entity has an id, and the id is the only handle.** No
exceptions, including targets. A name is a field somebody chose and may change;
it is never an identity. This project has been caught four times by keying a
write on something that is not an identity — a slot, an address, a span, a name
— and each time the fix was the same, so the rule is stated once here rather
than rediscovered per type.

**Who mints the id, and who may not.** The id is minted at creation and
**returned to the caller**, which then uses it to refer to the thing. A caller
never supplies an id for something that does not exist:

- **`add` never takes an id from an API caller.** The server mints it. At the
  *operation* level the id is carried in the op, because a disconnected writer
  has to mint its own for the edit to merge and for the inverse to be
  computable — but that is the session building the op, not the caller.
- **An unknown id is always "not found".** `set` and `remove` never create.
  A write that creates on an unrecognised id is an upsert wearing a different
  spelling, and it is the exact bug this document exists to remove.

The one place that rule bends is *inside* the CRDT, and deliberately: applying a
`set` for a record another peer concurrently removed does nothing rather than
throwing, because a merge has no caller to report to and "a delete racing an
edit heals itself" is the convergence rule everywhere else here. The **error
belongs at the API boundary**, where somebody is waiting for an answer.

Three rules follow, and they are the ones this project keeps rediscovering:

- **An address, a name or a span never identifies an entity.** Several claims
  cover one address, several comments sit at one, two constants may share a
  value. Only the id says which, which is why `add` returns it.
- **`set` is partial, so a rename is a rename.** A full-value PUT means changing
  one field requires resending every other, which is both unusable and
  last-writer-wins over fields the writer never looked at.
- **`null` clears; omitted leaves alone.** `Partial<T>` cannot express the
  difference, and without it a field can be set and never taken off.

## Shape 2 — Binding

A **key → id** map. The key is a position — an address — and the value names an
entity. No id of its own is needed at the wire level: the key is the identity.

| verb | meaning |
|---|---|
| `<n>.bind` | put. Binding the same key again repoints it; last-write-wins on that key. |
| `<n>.unbind` | clear the key. |

Members: **labelUse, constantUse, primary.**

A *declaration* and a *use* are different objects and now have different nouns.
They used to share one — `constant.set` and `constant.bind` were about a
declaration and a site respectively, under a single name, and `label.bind` named
an entity that no longer exists at all, since a label is a claim. The nouns match
the fields they live in: `labelUses`, `constantUses`.

Two verbs is the complete algebra for a map, because "update" and "create" are
the same operation on a key. Nothing is missing here — this shape was already
right, and `primary` is renamed into it rather than changed.

## Immutable attachments

**`file.add` / `file.remove`.** A file is content-addressed — `{name, hash,
size}` — and layers reference it by name in their `path`. There is no `file.set`
because there is nothing to update: the hash *is* the content, and renaming one
would have to rewrite every layer that points at it, which is a refactor and not
a field edit. Add and remove is complete for an immutable thing.

## The project's own fields

**`meta.set`.** `name`, `description`, `defaultTarget` — a fixed set of scalars
on the project itself, not a collection. It is the degenerate case of Shape 2
with a closed key set, and an absent value clears.

---

## What this replaced

| type | was | now |
|---|---|---|
| claim | `add` / `set` (partial) / `remove` | unchanged — this was the model everything else is now aligned to |
| comment | `set` (**full PUT**, creates if id is new) / `delete` | `add` / `set` (partial) / `remove` |
| constant | `set` (**full PUT**) / `delete` | `add` / `set` (partial) / `remove` |
| decoder | `set` (**full PUT**) / `delete` | `add` / `set` (partial) / `remove` |
| type | `set` (**full PUT**, `fields` last-writer-wins over the lot) / `delete` | `add` / `set` (partial) / `remove` |
| layer | `add` / **nothing** / `remove` | `add` / `set` / `remove` |
| target | `set` (partial, keyed by **name**) / `remove` (by name) | `add` / `set` / `remove`, **by id** — targets gained one |
| primary | `set` / `clear` | `bind` / `unbind` |
| label use | `label.bind` / `label.unbind` | `labelUse.bind` / `labelUse.unbind` |
| constant use | `constant.bind` / `constant.unbind` | `constantUse.bind` / `constantUse.unbind` |
| file | `add` / `remove` | unchanged |

Three things that were wrong and are worth naming, because each caused a
user-visible "you can't do that":

1. **A full PUT is not an update.** Renaming a `type` meant resending its `size`
   and every field. `docs/decisions/claims.md` states directly that writing a type's field list
   as one value would make it last-writer-wins over the lot and lose a field
   somebody proved from a copy routine — and that is exactly what `type.set` did.
2. **Two types had no update at all.** A layer could not be renamed; this file
   recorded that as a known hole for months.
3. **`delete` and `remove` were the same verb spelled two ways**, split down no
   principle at all — `claim.remove` and `comment.delete`.

## The one compatibility break

Op names are persisted in the `ops` table and replayed by `applyOp` when
something is undone. Renaming `comment.delete` to `comment.remove` therefore
makes history written before the change unreplayable, and `applyOp` will refuse
it loudly rather than misapply it. `.re64db` files are gitignored working
databases, so this costs stored undo history in local experiment projects and
nothing that is committed.

## The forty-five operations

```
capture.add      capture.set      capture.remove
claim.add        claim.set        claim.remove
comment.add      comment.set      comment.remove
constant.add     constant.set     constant.remove
decoder.add      decoder.set      decoder.remove
evidence.add     evidence.set     evidence.remove
message.add      message.set      message.remove
field.add        field.set        field.remove
layer.add        layer.set        layer.remove
scenario.add     scenario.set     scenario.remove
target.add       target.set       target.remove
type.add         type.set         type.remove

labelUse.bind    labelUse.unbind
constantUse.bind constantUse.unbind
primary.bind     primary.unbind

file.add         file.remove
meta.set
```

Twelve entities × three verbs, three bindings × two, one attachment × two, one
singleton. There is nothing else, and `src/core/crdt/roundtrip.test.ts` asserts
it: the shapes, the verbs, that no operation spells removal as `delete`, that
every `set` carries its changes under `fields`, that every `add` mints an
identity, and that no operation sits outside a shape.

## Adding a type later

`src/core/crdt/roundtrip.test.ts` is keyed by `Op["op"]` and is therefore
**exhaustive by construction**: a new op cannot compile until it has a case, and
the case asserts all seven properties — applied to the document, carried by
`projectFromDoc`, survives the export, emitted by the diff, inverts, undone, and
its id minted when a file omits one. Pick a shape from this document, add the
three (or two) ops, and let the harness tell you what is missing.
