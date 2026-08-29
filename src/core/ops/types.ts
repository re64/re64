/**
 * The vocabulary of edits.
 *
 * Every change to a project is one of these. They are the primary interface —
 * the agent API, the history record, and the undo description — while the CRDT
 * beneath them only decides how concurrent edits merge. Nothing needs to read a
 * binary CRDT update to know what happened.
 *
 * Plain JSON, so an agent can emit a list of them without linking against
 * anything, and a person can read one in a history entry.
 *
 * Every op names its target by **id**, never by address or position: addresses
 * are shared between labels and change when a region moves, and an op that
 * renames something cannot identify it by the name it is about to change.
 */

import { LabelType } from "../memory/label.js";
import { RegionKind } from "../memory/region.js";

/** Set a label's fields, creating it if the id is new. */
export interface LabelSetOp {
  op: "label.set";
  id: string;
  layerId: string;
  address: number;
  name: string;
  type?: LabelType;
  comment?: string;
}

export interface LabelDeleteOp {
  op: "label.delete";
  id: string;
  layerId: string;
}

/** Set a region's extent and kind, creating it if the id is new. */
export interface RegionSetOp {
  op: "region.set";
  id: string;
  layerId: string;
  start: number;
  end: number;
  kind: RegionKind;
  name?: string;
  comment?: string;
}

export interface RegionDeleteOp {
  op: "region.delete";
  id: string;
  layerId: string;
}

/** Promote a label at an address, or clear the choice. */
export interface PrimarySetOp {
  op: "primary.set";
  address: number;
  labelId: string;
}

export interface PrimaryClearOp {
  op: "primary.clear";
  address: number;
}

export type Op =
  | LabelSetOp
  | LabelDeleteOp
  | RegionSetOp
  | RegionDeleteOp
  | PrimarySetOp
  | PrimaryClearOp;

/** One edit, with enough context to undo it and to say who made it. */
export interface Change {
  /** What was done. */
  op: Op;
  /** What undoes it — computed against the state before `op` was applied. */
  inverse: Op;
  /** Who did it: a user id, an agent name, or "cli". */
  author?: string;
  /** Milliseconds since the epoch, supplied by the caller. */
  at?: number;
  /**
   * Set once this change has been undone.
   *
   * Marked rather than removed so redo has something to point at, and so the
   * log still records that the edit happened — history should show what was
   * tried, not only what survived.
   */
  undone?: boolean;
}

/** A short human-readable summary, for history listings and undo prompts. */
export function describeOp(op: Op): string {
  const hex = (n: number) => `$${n.toString(16).toUpperCase().padStart(4, "0")}`;
  switch (op.op) {
    case "label.set":
      return `set ${hex(op.address)} to ${op.name}${op.type ? ` (${op.type})` : ""}`;
    case "label.delete":
      return `delete label ${op.id}`;
    case "region.set":
      return `set ${hex(op.start)}-${hex(op.end)} to ${op.kind}${op.name ? ` (${op.name})` : ""}`;
    case "region.delete":
      return `delete region ${op.id}`;
    case "primary.set":
      return `show ${op.labelId} at ${hex(op.address)}`;
    case "primary.clear":
      return `clear the primary label at ${hex(op.address)}`;
  }
}
