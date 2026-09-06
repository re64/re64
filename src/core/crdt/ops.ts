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
      case "comment.set": {
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

      case "comment.delete":
        childMap(layerById(doc, op.layerId), "comments").delete(op.id);
        break;

      case "meta.set": {
        const meta = doc.getMap<unknown>("meta");
        if (op.value === undefined) meta.delete(op.key);
        else meta.set(op.key, op.value);
        break;
      }

      case "label.bind": {
        const uses = childMap(layerById(doc, op.layerId), "labelUses");
        let entry = uses.get(op.id);
        if (!entry) {
          entry = new Y.Map<unknown>();
          uses.set(op.id, entry);
        }
        assign(entry, { id: op.id, address: hex4(op.address), label: op.labelId });
        break;
      }

      case "label.unbind":
        childMap(layerById(doc, op.layerId), "labelUses").delete(op.id);
        break;

      case "constant.set": {
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

      case "constant.delete":
        doc.getMap<Y.Map<unknown>>("constants").delete(op.id);
        break;

      case "target.set": {
        const targets = doc.getMap<Y.Map<unknown>>("targets");
        let entry = targets.get(op.name);
        if (!entry) {
          entry = new Y.Map<unknown>();
          targets.set(op.name, entry);
        }
        // Only the fields this operation carries. `assign` deletes on
        // undefined, and an omitted field means "leave it alone" — so two
        // people revising different parts of one target both survive, which
        // whole-object writes would not allow.
        assign(entry, {
          name: op.name,
          ...(op.layers !== undefined ? { layers: op.layers } : {}),
          ...(op.entryPoints !== undefined
            ? { entryPoints: op.entryPoints.length ? op.entryPoints.map(hex4) : undefined }
            : {}),
          ...(op.order !== undefined ? { order: op.order } : {}),
          ...(op.description !== undefined ? { description: op.description } : {}),
        });
        break;
      }

      case "target.remove": {
        doc.getMap<Y.Map<unknown>>("targets").delete(op.name);
        // A selection pointing at nothing reads as a filter that silently does
        // nothing, which is worse than no selection at all.
        const meta = doc.getMap<unknown>("meta");
        if (meta.get("defaultTarget") === op.name) meta.delete("defaultTarget");
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

      case "decoder.set": {
        const decoders = doc.getMap<Y.Map<unknown>>("decoders");
        let entry = decoders.get(op.id);
        if (!entry) {
          entry = new Y.Map<unknown>();
          decoders.set(op.id, entry);
        }
        assign(entry, { id: op.id, name: op.name, source: op.source });
        break;
      }

      case "decoder.delete":
        doc.getMap<Y.Map<unknown>>("decoders").delete(op.id);
        break;

      case "type.set": {
        const types = doc.getMap<Y.Map<unknown>>("types");
        let entry = types.get(op.id);
        if (!entry) {
          entry = new Y.Map<unknown>();
          types.set(op.id, entry);
        }
        assign(entry, { id: op.id, name: op.name, size: op.size });

        // The fields are a map of their own, written key by key, so two readers
        // adding different fields to one record both survive. Replacing the
        // whole map — which is what writing it as a value would do — is
        // last-writer-wins over the lot, and losing a field somebody proved
        // from a copy routine is exactly the silent destruction this project
        // has now been caught by three times.
        let fields = entry.get("fields") as Y.Map<unknown> | undefined;
        if (!(fields instanceof Y.Map)) {
          fields = new Y.Map<unknown>();
          entry.set("fields", fields);
        }
        const wanted = new Set(Object.keys(op.fields));
        // A key the operation does not mention is one it removed: a whole-value
        // op says "the record looks like this", and leaving a stale field would
        // make a removal silently fail.
        for (const key of [...fields.keys()]) {
          if (!wanted.has(key)) fields.delete(key);
        }
        for (const [offset, field] of Object.entries(op.fields)) {
          const held = fields.get(offset);
          if (JSON.stringify(held) !== JSON.stringify(field)) fields.set(offset, field);
        }
        break;
      }

      case "type.delete":
        doc.getMap<Y.Map<unknown>>("types").delete(op.id);
        break;

      case "constant.bind": {
        const uses = childMap(layerById(doc, op.layerId), "constantUses");
        let entry = uses.get(op.id);
        if (!entry) {
          entry = new Y.Map<unknown>();
          uses.set(op.id, entry);
        }
        assign(entry, { id: op.id, address: hex4(op.address), constant: op.constantId });
        break;
      }

      case "constant.unbind":
        childMap(layerById(doc, op.layerId), "constantUses").delete(op.id);
        break;

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

      case "primary.set":
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

        // Re-encoded whole from the merged claim rather than key by key, so the
        // flat spelling of `says` and `by` stays consistent — setting an
        // interpretation to `data` must clear the `encoding` a previous `text`
        // left behind, which a per-key write would not do.
        const merged: Record<string, unknown> = { ...decodeClaim(entry) };
        for (const [key, value] of Object.entries(op.fields as ClaimEdit)) {
          if (value === null) delete merged[key];
          else merged[key] = value;
        }
        const fields = encodeClaim(merged as unknown as Claim);
        for (const key of [...entry.keys()]) {
          if (!(key in fields)) entry.delete(key);
        }
        for (const key of Object.keys(fields).sort()) entry.set(key, fields[key]);
        break;
      }

      case "claim.remove":
        claimsRoot(doc).delete(op.id);
        break;

      case "primary.clear":
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
