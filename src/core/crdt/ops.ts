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
import { Op } from "../ops/types.js";

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
      case "label.set": {
        const labels = childMap(layerById(doc, op.layerId), "labels");
        let entry = labels.get(op.id);
        if (!entry) {
          entry = new Y.Map<unknown>();
          labels.set(op.id, entry);
        }
        assign(entry, {
          id: op.id,
          address: hex4(op.address),
          name: op.name,
          // "address" is the default and is recorded by absence, matching the
          // project file so a flatten produces the same text.
          type: op.type === "address" ? undefined : op.type,
          extent: op.extent,
        });
        break;
      }

      case "label.delete":
        childMap(layerById(doc, op.layerId), "labels").delete(op.id);
        break;

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
        });
        break;
      }

      case "comment.delete":
        childMap(layerById(doc, op.layerId), "comments").delete(op.id);
        break;

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
        entry.set("name", op.name);
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

      case "region.set": {
        const regions = childMap(layerById(doc, op.layerId), "regions");
        let entry = regions.get(op.id);
        if (!entry) {
          entry = new Y.Map<unknown>();
          regions.set(op.id, entry);
        }
        assign(entry, {
          id: op.id,
          start: hex4(op.start),
          end: hex4(op.end),
          kind: op.kind,
          name: op.name,
          comment: op.comment,
        });
        break;
      }

      case "region.delete":
        childMap(layerById(doc, op.layerId), "regions").delete(op.id);
        break;

      case "primary.set":
        doc.getMap<string>("primaryLabels").set(hex4(op.address), op.labelId);
        break;

      case "primary.clear":
        doc.getMap<string>("primaryLabels").delete(hex4(op.address));
        break;
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
