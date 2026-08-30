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

import { CommentPlacement } from "../memory/comment.js";
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

/** Set a comment's text or placement, creating it if the id is new. */
export interface CommentSetOp {
  op: "comment.set";
  id: string;
  layerId: string;
  address: number;
  placement: CommentPlacement;
  text: string;
}

export interface CommentDeleteOp {
  op: "comment.delete";
  id: string;
  layerId: string;
}

/** Say that the operand at an address means one particular label. */
export interface LabelBindOp {
  op: "label.bind";
  id: string;
  layerId: string;
  address: number;
  labelId: string;
}

export interface LabelUnbindOp {
  op: "label.unbind";
  id: string;
  layerId: string;
}

/** Declare that a name exists for a value, creating it if the id is new. */
export interface ConstantSetOp {
  op: "constant.set";
  id: string;
  name: string;
  value: number;
}

export interface ConstantDeleteOp {
  op: "constant.delete";
  id: string;
}

/** Say that the operand at an address means a constant. */
export interface ConstantBindOp {
  op: "constant.bind";
  id: string;
  layerId: string;
  address: number;
  constantId: string;
}

export interface ConstantUnbindOp {
  op: "constant.unbind";
  id: string;
  layerId: string;
}

/**
 * Add a layer, at a position in the declaration order.
 *
 * Only `symbols` for now, which is what naming an address outside the loaded
 * bytes needs — zero page, I/O registers, KERNAL entry points. A layer that
 * supplies bytes would have to say where they come from, and nothing needs
 * that through an operation yet.
 */
export interface LayerAddOp {
  op: "layer.add";
  id: string;
  layerType: "symbols";
  name: string;
  /** Where in declaration order; the bottom of the stack when omitted. */
  index?: number;
}

export interface LayerRemoveOp {
  op: "layer.remove";
  id: string;
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
  | CommentSetOp
  | CommentDeleteOp
  | LabelBindOp
  | LabelUnbindOp
  | ConstantSetOp
  | ConstantDeleteOp
  | ConstantBindOp
  | ConstantUnbindOp
  | LayerAddOp
  | LayerRemoveOp
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
  /**
   * The session that did it, when one is known.
   *
   * Scoping undo to this rather than to the author is what stops two agents
   * under one identity taking back each other's work, and it is the same rule
   * the browser already follows.
   */
  session?: string;
  /**
   * Which action this op was part of.
   *
   * One tool call or one click is one changeset, however many ops it produces.
   * The boundary already existed as a transaction and simply went unrecorded,
   * which is why undo took back a third of a decision.
   *
   * It is a record of *intent*. It cannot promise the ops landed together —
   * a CRDT converges per field and has no idea they were one thought — and
   * every use of it has to survive some of them having been superseded.
   */
  changeset?: string;
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
    case "comment.set": {
      // The text, not its length: a history entry saying "commented $8870" is
      // no use when the question is which comment was lost.
      const oneLine = op.text.replace(/\s+/g, " ").trim();
      const shown = oneLine.length > 40 ? `${oneLine.slice(0, 39)}\u2026` : oneLine;
      return `comment ${hex(op.address)} ${op.placement}: ${shown}`;
    }
    case "comment.delete":
      return `delete comment ${op.id}`;
    case "label.bind":
      return `read ${hex(op.address)} as one particular label`;
    case "label.unbind":
      return `read ${op.id} by the usual rule again`;
    case "constant.set":
      return `define ${op.name} as $${op.value.toString(16).toUpperCase().padStart(2, "0")}`;
    case "constant.delete":
      return `delete constant ${op.id}`;
    case "constant.bind":
      return `read ${hex(op.address)} as a constant`;
    case "constant.unbind":
      return `read ${op.id} as a literal again`;
    case "layer.add":
      return `add ${op.layerType} layer ${op.name}`;
    case "layer.remove":
      return `remove layer ${op.id}`;
    case "primary.set":
      return `show ${op.labelId} at ${hex(op.address)}`;
    case "primary.clear":
      return `clear the primary label at ${hex(op.address)}`;
  }
}
