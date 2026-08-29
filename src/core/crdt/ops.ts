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
  doc.transact(() => {
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
          comment: op.comment,
        });
        break;
      }

      case "label.delete":
        childMap(layerById(doc, op.layerId), "labels").delete(op.id);
        break;

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
  }, origin);
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
    { trackedOrigins: new Set([origin]) }
  );
}
