/**
 * Applying operations to a document.
 *
 * The same vocabulary the project text understands, expressed against Yjs so
 * concurrent edits merge. Operations stay the interface; this is only how they
 * reach the shared state.
 *
 * Everything runs inside a transaction tagged with an origin, which is what
 * lets `UndoManager` revert one participant's edits and leave the rest alone.
 */

import * as Y from "yjs";
import { ClaimEdit, Op } from "../ops/types.js";
import { Claim } from "../claims/model.js";
import { encodeClaim, decodeClaim, claimsRoot } from "./claims.js";

const hex4 = (n: number) => "$" + n.toString(16).toUpperCase().padStart(4, "0");

function layerById(doc: Y.Doc, id: string): Y.Map<unknown> {
  for (const layer of doc.getArray<Y.Map<unknown>>("layers")) {
    if (layer.get("id") === id) return layer;
  }
  throw new Error(`No layer with id ${id}`);
}

/**
 * One message and where it currently sits, by id.
 *
 * A scan, because chat is the one root stored as a list: the sequence is the
 * state, so an id-keyed map would have to agree an order some other way. The
 * index is only valid inside the transaction that found it — a concurrent
 * insert moves it — which is why nothing holds one.
 */
function messageAt(
  doc: Y.Doc,
  id: string
): { entry: Y.Map<unknown>; index: number } | undefined {
  const chat = doc.getArray<Y.Map<unknown>>("chat");
  for (let index = 0; index < chat.length; index++) {
    const entry = chat.get(index);
    if (entry?.get("id") === id) return { entry, index };
  }
  return undefined;
}

function childMap(layer: Y.Map<unknown>, key: string): Y.Map<Y.Map<unknown>> {
  let map = layer.get(key) as Y.Map<Y.Map<unknown>> | undefined;
  if (!map) {
    map = new Y.Map<Y.Map<unknown>>();
    layer.set(key, map);
  }
  return map;
}

/** Set fields on an entry, removing the ones the operation left out. */
function assign(entry: Y.Map<unknown>, fields: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) entry.delete(key);
    else entry.set(key, value);
  }
}

/**
 * Write only the fields a partial `set` named.
 *
 * The difference from `assign` is the whole reason `set` is partial: **omitted
 * means leave alone**, where `assign` reads absence as "clear it". Writing only
 * the named keys is also what makes the merge right — two peers revising
 * different fields of one record touch different keys and both survive, where a
 * whole-value write would make the later one win over fields it never read.
 *
 * `null` is the explicit clear, which is the distinction an optional field
 * cannot make.
 */
function revise(entry: Y.Map<unknown>, fields: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (value === null) entry.delete(key);
    else entry.set(key, value);
  }
}

/** A type's field map, made on first use. Nested, so offsets merge separately. */
function fieldsOf(entry: Y.Map<unknown>): Y.Map<unknown> {
  let fields = entry.get("fields") as Y.Map<unknown> | undefined;
  if (!(fields instanceof Y.Map)) {
    fields = new Y.Map<unknown>();
    entry.set("fields", fields);
  }
  return fields;
}

/** The record a partial `set` names, or nothing if it is gone. */
function entryFor(map: Y.Map<Y.Map<unknown>>, id: string): Y.Map<unknown> | undefined {
  return map.get(id);
}

/**
 * Apply one operation.
 *
 * `origin` identifies who is editing — a user id, an agent name — and decides
 * whose undo stack the change lands on.
 */
export function applyOpToDoc(doc: Y.Doc, op: Op, origin: unknown = "local"): void {
  doc.transact(() => applyOpInTransaction(doc, op), origin);
}

/**
 * Apply a batch as **one** change.
 *
 * A transaction is the unit of undo, so operations that belong to a single
 * action have to share one — promoting a label to a function both sets its type
 * and renames `loc_8100` to `sub_8100`, and undo must take back both or
 * neither. Applying them one at a time would leave the user pressing undo twice
 * for something they did once.
 */
export function applyOpsToDoc(doc: Y.Doc, ops: readonly Op[], origin: unknown = "local"): void {
  if (ops.length === 0) return;
  doc.transact(() => {
    for (const op of ops) applyOpInTransaction(doc, op);
  }, origin);
}

function applyOpInTransaction(doc: Y.Doc, op: Op): void {
  {
    switch (op.op) {
      case "comment.add": {
        const comments = childMap(layerById(doc, op.layerId), "comments");
        let entry = comments.get(op.id);
        if (!entry) {
          entry = new Y.Map<unknown>();
          comments.set(op.id, entry);
        }
        assign(entry, {
          id: op.id,
          address: hex4(op.address),
          // "before" is the default and is recorded by absence, matching the
          // project file so a flatten produces the same text.
          placement: op.placement === "before" ? undefined : op.placement,
          text: op.text,
          // Unset until somebody arranges the comments at this address, and
          // recorded by absence like `placement`, so an unarranged project
          // flattens to the same text it always did.
          order: op.order,
        });
        break;
      }

      case "comment.set": {
        const entry = entryFor(childMap(layerById(doc, op.layerId), "comments"), op.id);
        if (entry) {
          revise(entry, {
            ...(op.fields.address === undefined ? {} : { address: hex4(op.fields.address) }),
            // "before" is the default and is recorded by absence, matching the
            // project file so a flatten produces the same text.
            ...(op.fields.placement === undefined
              ? {}
              : { placement: op.fields.placement === "before" ? null : op.fields.placement }),
            ...(op.fields.text === undefined ? {} : { text: op.fields.text }),
            ...(op.fields.order === undefined ? {} : { order: op.fields.order }),
          });
        }
        break;
      }

      case "comment.remove":
        childMap(layerById(doc, op.layerId), "comments").delete(op.id);
        break;

      case "meta.set": {
        const meta = doc.getMap<unknown>("meta");
        if (op.value === undefined) meta.delete(op.key);
        else meta.set(op.key, op.value);
        break;
      }

      // Keyed by the site, like every binding — see `constantUse.bind` for what
      // keying by a minted use id cost.
      case "labelUse.bind": {
        const uses = childMap(layerById(doc, op.layerId), "labelUses");
        const at = hex4(op.address);
        let entry = uses.get(at);
        if (!entry) {
          entry = new Y.Map<unknown>();
          uses.set(at, entry);
        }
        assign(entry, { id: op.id, address: at, label: op.labelId });
        break;
      }

      case "labelUse.unbind":
        childMap(layerById(doc, op.layerId), "labelUses").delete(hex4(op.address));
        break;

      case "constant.add": {
        const constants = doc.getMap<Y.Map<unknown>>("constants");
        let entry = constants.get(op.id);
        if (!entry) {
          entry = new Y.Map<unknown>();
          constants.set(op.id, entry);
        }
        assign(entry, {
          id: op.id,
          name: op.name,
          value: `$${op.value.toString(16).toUpperCase().padStart(2, "0")}`,
        });
        break;
      }

      case "constant.set": {
        const entry = entryFor(doc.getMap<Y.Map<unknown>>("constants"), op.id);
        if (entry) {
          revise(entry, {
            ...(op.fields.name === undefined ? {} : { name: op.fields.name }),
            ...(op.fields.value === undefined
              ? {}
              : { value: `$${op.fields.value.toString(16).toUpperCase().padStart(2, "0")}` }),
          });
        }
        break;
      }

      case "constant.remove":
        doc.getMap<Y.Map<unknown>>("constants").delete(op.id);
        break;

      case "target.add": {
        const targets = doc.getMap<Y.Map<unknown>>("targets");
        let entry = targets.get(op.id);
        if (!entry) {
          entry = new Y.Map<unknown>();
          targets.set(op.id, entry);
        }
        assign(entry, {
          id: op.id,
          name: op.name,
          layers: op.layers ?? [],
          entryPoints: op.entryPoints?.length ? op.entryPoints.map(hex4) : undefined,
          order: op.order,
          description: op.description,
        });
        break;
      }

      case "target.set": {
        // Only the fields this operation carries, so two people revising
        // different parts of one target both survive.
        const entry = entryFor(doc.getMap<Y.Map<unknown>>("targets"), op.id);
        if (entry) {
          const f = op.fields;
          revise(entry, {
            ...(f.name === undefined ? {} : { name: f.name }),
            ...(f.layers === undefined ? {} : { layers: f.layers }),
            ...(f.entryPoints === undefined
              ? {}
              : { entryPoints: f.entryPoints?.length ? f.entryPoints.map(hex4) : null }),
            ...(f.order === undefined ? {} : { order: f.order }),
            ...(f.description === undefined ? {} : { description: f.description }),
          });
        }
        break;
      }

      case "target.remove": {
        // Nothing to clean up beside it: the document used to hold a selected
        // target, and a selection pointing at a removed one read as a filter
        // that silently did nothing. A view is now a property of whoever is
        // reading, so there is nothing here for a delete to dangle.
        doc.getMap<Y.Map<unknown>>("targets").delete(op.id);
        break;
      }

      case "file.add": {
        const files = doc.getMap<Y.Map<unknown>>("files");
        let entry = files.get(op.name);
        if (!entry) {
          entry = new Y.Map<unknown>();
          files.set(op.name, entry);
        }
        assign(entry, { name: op.name, hash: op.hash, size: op.size });
        break;
      }

      case "file.remove": {
        doc.getMap<Y.Map<unknown>>("files").delete(op.name);
        break;
      }

      case "decoder.add": {
        const decoders = doc.getMap<Y.Map<unknown>>("decoders");
        let entry = decoders.get(op.id);
        if (!entry) {
          entry = new Y.Map<unknown>();
          decoders.set(op.id, entry);
        }
        assign(entry, { id: op.id, name: op.name, source: op.source });
        break;
      }

      case "decoder.set": {
        const entry = entryFor(doc.getMap<Y.Map<unknown>>("decoders"), op.id);
        if (entry) revise(entry, { ...op.fields });
        break;
      }

      case "decoder.remove":
        doc.getMap<Y.Map<unknown>>("decoders").delete(op.id);
        break;

      case "type.add": {
        const types = doc.getMap<Y.Map<unknown>>("types");
        let entry = types.get(op.id);
        if (!entry) {
          entry = new Y.Map<unknown>();
          types.set(op.id, entry);
        }
        assign(entry, {
          id: op.id,
          name: op.name,
          size: op.size,
          ...(op.unit === undefined ? {} : { unit: op.unit }),
        });
        const fields = fieldsOf(entry);
        for (const [offset, field] of Object.entries(op.fields)) fields.set(offset, field);
        break;
      }

      /**
       * Revise a layout. Fields **merge by offset**; `null` removes one.
       *
       * The fields are a map of their own, written key by key, so two readers
       * adding different fields to one record both survive. This used to delete
       * any offset the operation did not mention — whole-value semantics
       * reaching into the one structure that exists specifically not to have
       * them, so a concurrent addition was lost the next time anybody renamed
       * the type. Losing a field somebody proved from a copy routine is exactly
       * the silent destruction this project has been caught by three times.
       */
      case "type.set": {
        const entry = entryFor(doc.getMap<Y.Map<unknown>>("types"), op.id);
        if (entry) {
          revise(entry, {
            ...(op.fields.name === undefined ? {} : { name: op.fields.name }),
            ...(op.fields.size === undefined ? {} : { size: op.fields.size }),
            ...(op.fields.unit === undefined ? {} : { unit: op.fields.unit }),
          });
          if (op.fields.fields) {
            const fields = fieldsOf(entry);
            for (const [offset, field] of Object.entries(op.fields.fields)) {
              if (field === null) fields.delete(offset);
              else if (JSON.stringify(fields.get(offset)) !== JSON.stringify(field)) {
                fields.set(offset, field);
              }
            }
          }
        }
        break;
      }

      case "type.remove":
        doc.getMap<Y.Map<unknown>>("types").delete(op.id);
        break;

      // **A field is written into its record's own map, keyed by offset.** That
      // key is the merge property — two readers adding different fields to one
      // record touch different keys and both survive — so these operate on it
      // directly rather than replacing the map, exactly as `type.set` does.
      case "field.add": {
        const entry = entryFor(doc.getMap<Y.Map<unknown>>("types"), op.typeId);
        if (entry) {
          fieldsOf(entry).set(String(op.offset), {
            id: op.id,
            name: op.name,
            type: op.type,
            ...(op.description === undefined ? {} : { description: op.description }),
          });
        }
        break;
      }

      case "field.set": {
        const entry = entryFor(doc.getMap<Y.Map<unknown>>("types"), op.typeId);
        if (!entry) break;
        const fields = fieldsOf(entry);
        const at = [...fields.keys()].find(
          (k) => (fields.get(k) as { id?: string } | undefined)?.id === op.id
        );
        if (at === undefined) break;
        const was = fields.get(at) as Record<string, unknown>;
        const next: Record<string, unknown> = { ...was };
        if (op.fields.name !== undefined) next.name = op.fields.name;
        if (op.fields.type !== undefined) next.type = op.fields.type;
        if (op.fields.description === null) delete next.description;
        else if (op.fields.description !== undefined) next.description = op.fields.description;

        // A move is a delete and a set on the *key*, which is the one thing
        // offset-as-identity could not express without losing the field.
        const to = String(op.fields.offset ?? at);
        if (to !== at) fields.delete(at);
        fields.set(to, next);
        break;
      }

      case "field.remove": {
        const entry = entryFor(doc.getMap<Y.Map<unknown>>("types"), op.typeId);
        if (!entry) break;
        const fields = fieldsOf(entry);
        const at = [...fields.keys()].find(
          (k) => (fields.get(k) as { id?: string } | undefined)?.id === op.id
        );
        if (at !== undefined) fields.delete(at);
        break;
      }

      case "scenario.add": {
        const scenarios = doc.getMap<Y.Map<unknown>>("scenarios");
        let entry = scenarios.get(op.id);
        if (!entry) {
          entry = new Y.Map<unknown>();
          scenarios.set(op.id, entry);
        }
        assign(entry, {
          id: op.id,
          name: op.name,
          description: op.description,
          // One value, unlike a type's fields. A scenario is one author's
          // sequence and the order is the meaning, so there is no key to merge
          // on — the trade is written down in `ProjectScenario`.
          steps: JSON.stringify(op.steps),
        });
        break;
      }

      case "scenario.set": {
        const entry = entryFor(doc.getMap<Y.Map<unknown>>("scenarios"), op.id);
        if (entry) {
          revise(entry, {
            ...(op.fields.name === undefined ? {} : { name: op.fields.name }),
            ...(op.fields.description === undefined
              ? {}
              : { description: op.fields.description }),
            ...(op.fields.steps === undefined
              ? {}
              : { steps: JSON.stringify(op.fields.steps) }),
          });
        }
        break;
      }

      case "scenario.remove":
        doc.getMap<Y.Map<unknown>>("scenarios").delete(op.id);
        break;

      case "capture.add": {
        const captures = doc.getMap<Y.Map<unknown>>("captures");
        let entry = captures.get(op.id);
        if (!entry) {
          entry = new Y.Map<unknown>();
          captures.set(op.id, entry);
        }
        assign(entry, {
          id: op.id,
          scenario: op.scenario,
          step: op.step,
          kind: op.kind,
          file: op.file,
          when: op.when,
        });
        break;
      }

      case "capture.set": {
        const entry = entryFor(doc.getMap<Y.Map<unknown>>("captures"), op.id);
        if (entry) revise(entry, { ...op.fields });
        break;
      }

      case "capture.remove":
        doc.getMap<Y.Map<unknown>>("captures").delete(op.id);
        break;

      case "evidence.add": {
        const all = doc.getMap<Y.Map<unknown>>("evidence");
        let entry = all.get(op.id);
        if (!entry) {
          entry = new Y.Map<unknown>();
          all.set(op.id, entry);
        }
        assign(entry, {
          id: op.id,
          claim: op.claim,
          kind: op.kind,
          author: op.by?.author,
          method: op.by?.method,
          when: op.by?.when,
          scenario: op.scenario,
          capture: op.capture,
          other: op.other,
          note: op.note,
        });
        break;
      }

      case "evidence.set": {
        const entry = entryFor(doc.getMap<Y.Map<unknown>>("evidence"), op.id);
        // `by` is spread into the flat keys the document stores, like `says` on
        // a claim: a revision touches exactly the keys it names, so two peers
        // revising different halves of one record do not revert each other.
        if (entry) {
          const { by, ...rest } = op.fields;
          revise(entry, { ...rest });
          if (by !== undefined) {
            revise(entry, {
              author: by === null ? undefined : by.author,
              method: by === null ? undefined : by.method,
              when: by === null ? undefined : by.when,
            });
          }
        }
        break;
      }

      // **A list, so these are the only three operations here that are not
      // keyed.** Ordering is the content of a conversation and the array CRDT
      // converges it without a clock; the id makes an entry addressable, which
      // is a separate property and one chat also wants. Finding an entry is a
      // scan, which is affordable for the one root whose size is bounded by how
      // much people type.
      case "message.add": {
        const chat = doc.getArray<Y.Map<unknown>>("chat");
        const entry = new Y.Map<unknown>();
        entry.set("id", op.id);
        entry.set("at", op.at);
        entry.set("author", op.author);
        entry.set("name", op.name);
        entry.set("text", op.text);
        chat.push([entry]);
        break;
      }

      case "message.set": {
        const held = messageAt(doc, op.id);
        if (held && op.fields.text !== undefined) held.entry.set("text", op.fields.text);
        break;
      }

      case "message.remove": {
        const held = messageAt(doc, op.id);
        if (held) doc.getArray<Y.Map<unknown>>("chat").delete(held.index, 1);
        break;
      }

      case "evidence.remove":
        doc.getMap<Y.Map<unknown>>("evidence").delete(op.id);
        break;

      // **A binding is keyed by its site**, which is what `docs/algebra.md` has
      // always said it is: an address-to-id map, where binding again is how a
      // binding is updated.
      //
      // It was keyed by a *minted use id*, so every bind added a competitor
      // rather than replacing one. Two uses then sat at one address, the loaded
      // index kept whichever the projection sorted last — by id, which is
      // random — and unbinding removed one and left the other still resolving.
      // Which value showed depended on the ids, not on which bind happened
      // later.
      case "constantUse.bind": {
        const uses = childMap(layerById(doc, op.layerId), "constantUses");
        const at = hex4(op.address);
        let entry = uses.get(at);
        if (!entry) {
          entry = new Y.Map<unknown>();
          uses.set(at, entry);
        }
        assign(entry, { id: op.id, address: at, constant: op.constantId });
        break;
      }

      case "constantUse.unbind":
        childMap(layerById(doc, op.layerId), "constantUses").delete(hex4(op.address));
        break;

      case "layer.set": {
        const layers = doc.getArray<Y.Map<unknown>>("layers");
        const held = layers.toArray().find((l) => l.get("id") === op.id);
        if (held) revise(held, { ...op.fields });
        break;
      }

      case "layer.add": {
        const layers = doc.getArray<Y.Map<unknown>>("layers");
        // Already there: two participants naming an unowned address at the
        // same moment both decide to create one. The check narrows the window
        // rather than closing it — the array is a sequence, so two genuinely
        // concurrent inserts both land. Harmless, since ownership resolves to
        // the first, and visible enough to be tidied up.
        const existing = layers.toArray().some((l) => l.get("id") === op.id);
        if (existing) break;

        const entry = new Y.Map<unknown>();
        entry.set("id", op.id);
        entry.set("type", op.layerType);
        if (op.rom !== undefined) entry.set("rom", op.rom);
        entry.set("name", op.name);
        if (op.path !== undefined) entry.set("path", op.path);
        if (op.address !== undefined) entry.set("address", hex4(op.address));
        if (op.bytes !== undefined) entry.set("bytes", op.bytes);
        if (op.length !== undefined) entry.set("length", op.length);
        entry.set("labels", new Y.Map<Y.Map<unknown>>());
        entry.set("regions", new Y.Map<Y.Map<unknown>>());
        entry.set("comments", new Y.Map<Y.Map<unknown>>());
        layers.insert(Math.max(0, Math.min(op.index ?? 0, layers.length)), [entry]);
        break;
      }

      case "layer.remove": {
        const layers = doc.getArray<Y.Map<unknown>>("layers");
        const at = layers.toArray().findIndex((l) => l.get("id") === op.id);
        if (at >= 0) layers.delete(at, 1);
        break;
      }

      case "primary.bind":
        doc.getMap<string>("primaryLabels").set(hex4(op.address), op.labelId);
        break;

      case "claim.add": {
        const entry = new Y.Map<unknown>();
        const fields = encodeClaim(op.claim);
        for (const key of Object.keys(fields).sort()) entry.set(key, fields[key]);
        claimsRoot(doc).set(op.claim.id, entry);
        break;
      }

      case "claim.set": {
        const entry = claimsRoot(doc).get(op.id);
        // A revision of a claim somebody deleted concurrently does nothing,
        // rather than resurrecting it with half its fields. Same rule as a
        // dangling `primaryLabels` entry: the delete wins and nothing sweeps.
        if (!entry) break;

        // **Only the keys this patch reaches.**
        //
        // This re-encoded the whole claim and wrote every key back, which was
        // defended on the ground that `says` is spelled flat — setting an
        // interpretation to `data` has to clear the `encoding` a previous `text`
        // left behind, and a naive per-key write would not. True, and the cure
        // was worse: a partial patch reasserted every field it did not name, so
        // one peer changing `root` while another renamed the claim converged on
        // the old name. The API said partial and the write set was the whole
        // record.
        //
        // So the patch's fields are mapped to the storage keys they own, in
        // *groups* where a value is spelled across several — that is what makes
        // clearing `encoding` part of setting `is` rather than a side effect of
        // rewriting everything.
        const OWNS: Record<string, readonly string[]> = {
          says: ["is", "encoding", "view", "typeId"],
          frame: ["layer", "target"],
        };
        const touched = new Set<string>();
        for (const key of Object.keys(op.fields as ClaimEdit)) {
          for (const owned of OWNS[key] ?? [key]) touched.add(owned);
        }

        const merged: Record<string, unknown> = { ...decodeClaim(entry) };
        for (const [key, value] of Object.entries(op.fields as ClaimEdit)) {
          if (value === null) delete merged[key];
          else merged[key] = value;
        }
        const fields = encodeClaim(merged as unknown as Claim);
        for (const key of touched) {
          if (key in fields) entry.set(key, fields[key]);
          else entry.delete(key);
        }
        break;
      }

      case "claim.remove":
        claimsRoot(doc).delete(op.id);
        break;

      case "primary.unbind":
        doc.getMap<string>("primaryLabels").delete(hex4(op.address));
        break;

      // The switch returns `void`, so until this existed a missing case
      // compiled cleanly: the op was accepted, `runOps` reported success, and
      // nothing reached the document. That is the worst failure shape in this
      // codebase — indistinguishable from working — and it sits on the one
      // switch the compiler was not already guarding. Same idiom as
      // `rowStrategy` and `decodeText`.
      default: {
        const unhandled: never = op;
        throw new Error(`unhandled operation: ${JSON.stringify(unhandled)}`);
      }
    }
  }
}

/**
 * An undo stack scoped to one participant.
 *
 * `trackedOrigins` is the whole point: in a shared document, undo must revert
 * *your* edits and leave a collaborator's in place. A global history would
 * reach across and remove someone else's work.
 */
export function undoManagerFor(doc: Y.Doc, origin: unknown = "local"): Y.UndoManager {
  return new Y.UndoManager(
    [
      doc.getArray("layers"),
      doc.getMap("primaryLabels"),
      doc.getMap("meta"),
      // Every root, because the alternative is a whitelist that silently drops
      // one. `decoders` was added when a decoder edit turned out to be
      // invisible to undo, with a note that `constants` still had the same gap
      // — and it still did, three roots later. A list that has to be extended
      // by hand is one that will be short again.
      doc.getMap("decoders"),
      doc.getMap("types"),
      doc.getMap("constants"),
      doc.getMap("files"),
      doc.getMap("targets"),
      doc.getMap("claims"),
      doc.getMap("scenarios"),
      doc.getMap("captures"),
      doc.getMap("evidence"),
    ],
    {
      trackedOrigins: new Set([origin]),
      // Zero, not the default 500ms. That default merges anything done inside
      // half a second into one undo step, which is right for typing characters
      // and wrong here: renaming two labels quickly are two deliberate actions
      // and must undo separately. Grouping is expressed by sharing a
      // transaction, not by happening to be close together in time.
      captureTimeout: 0,
    }
  );
}
