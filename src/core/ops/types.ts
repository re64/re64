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
import { TextEncoding } from "../c64/text.js";
import { RegionKind } from "../memory/region.js";
import { Claim } from "../claims/model.js";



/**
 * A field of a claim, as an edit may name it.
 *
 * `null` means **clear this**, which `undefined` cannot: an object simply
 * missing a key says "leave it alone", and both statements have to be
 * expressible or the inverse of "set a root on a claim that had none" cannot be
 * written — and `runOps` computes an inverse on every write.
 *
 * The alternative was carrying the whole claim, as `region.set` does. That makes
 * clearing trivial and merging wrong: two peers revising different fields would
 * clobber each other, which is the `target.set` bug this project already found
 * and fixed by making that op partial.
 */
export type ClaimEdit = { [K in keyof Omit<Claim, "id">]?: Claim[K] | null };

/**
 * Add a claim. **Always adds; never replaces.**
 *
 * An id already present means the same claim arriving twice — a retry, or a
 * replayed op — never two people meaning different things, because ids are
 * minted by the writer rather than inferred from a span.
 */
export interface ClaimAddOp {
  op: "claim.add";
  claim: Claim;
}

/** Revise named fields of a claim, leaving the rest alone. */
export interface ClaimSetOp {
  op: "claim.set";
  id: string;
  fields: ClaimEdit;
}

export interface ClaimRemoveOp {
  op: "claim.remove";
  id: string;
}



/** Set a comment's text or placement, creating it if the id is new. */
export interface CommentSetOp {
  op: "comment.set";
  id: string;
  layerId: string;
  address: number;
  placement: CommentPlacement;
  text: string;
  /** Position among the comments at this address; unset until arranged. */
  order?: number;
}

export interface CommentDeleteOp {
  op: "comment.delete";
  id: string;
  layerId: string;
}

/**
 * Set a project-level field: its name, or what it is.
 *
 * The reference keeps its provenance and licence in an 18-line file header,
 * and there was nowhere in a project for that to live — `description` existed
 * in the schema and could only arrive by importing a file that already had one.
 */
export interface MetaSetOp {
  op: "meta.set";
  /**
   * `activeTarget` rides here rather than getting an operation of its own:
   * selecting a view is setting one project-level scalar, which is exactly what
   * this op is for.
   */
  key: "name" | "description" | "activeTarget";
  value?: string;
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

/**
 * Record that the project uses a file, by name and content hash.
 *
 * An operation rather than a side effect of uploading, so adding a binary is
 * attributed and undoable like every other edit — and so an upload that is
 * never linked cannot exist, which is what a project-less upload would have
 * allowed.
 */
/** Declare or revise a named view over the layer stack. */
/**
 * Declare or revise a named view over the layer stack.
 *
 * Every field but the name is optional, and an omitted one is *left alone*
 * rather than cleared. That is what makes two people revising one target
 * survive each other: writing the whole object would mean somebody changing a
 * description silently reverted somebody else's layer list, which fails the
 * rule that an edit made offline has to work when it lands.
 *
 * A target that does not exist yet needs `layers`, since a view over nothing is
 * not a view.
 */
export interface TargetSetOp {
  op: "target.set";
  name: string;
  layers?: string[];
  entryPoints?: number[];
  order?: number;
  description?: string;
}

export interface TargetRemoveOp {
  op: "target.remove";
  name: string;
}

export interface FileAddOp {
  op: "file.add";
  name: string;
  hash: string;
  size: number;
}

export interface FileRemoveOp {
  op: "file.remove";
  name: string;
}

export interface DecoderSetOp {
  op: "decoder.set";
  id: string;
  name: string;
  /** The body of a function taking `(bytes, params)`. */
  source: string;
}

export interface DecoderDeleteOp {
  op: "decoder.delete";
  id: string;
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
  /**
   * What the layer is.
   *
   * `symbols` was the only kind an operation could make, which meant a project
   * could never be *built* — only annotated, from a stack somebody had already
   * declared in a file by hand. A byte layer is what lets an agent handed a
   * disk image end up with something to disassemble.
   */
  layerType: "symbols" | "prg" | "raw";
  name: string;
  /** For a byte layer: the file it reads, as `name` or `disk.d64:NAME`. */
  path?: string;
  /** For a `raw` layer, which carries no load address of its own. */
  address?: number;
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
  | ClaimAddOp
  | ClaimSetOp
  | ClaimRemoveOp
  | CommentSetOp
  | CommentDeleteOp
  | MetaSetOp
  | LabelBindOp
  | LabelUnbindOp
  | ConstantSetOp
  | ConstantDeleteOp
  | DecoderSetOp
  | DecoderDeleteOp
  | ConstantBindOp
  | ConstantUnbindOp
  | LayerAddOp
  | LayerRemoveOp
  | PrimarySetOp
  | PrimaryClearOp
  | FileAddOp
  | FileRemoveOp
  | TargetSetOp
  | TargetRemoveOp;

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
    case "comment.set": {
      // The text, not its length: a history entry saying "commented $8870" is
      // no use when the question is which comment was lost.
      const oneLine = op.text.replace(/\s+/g, " ").trim();
      const shown = oneLine.length > 40 ? `${oneLine.slice(0, 39)}\u2026` : oneLine;
      return `comment ${hex(op.address)} ${op.placement}: ${shown}`;
    }
    case "comment.delete":
      return `delete comment ${op.id}`;
    case "meta.set":
      return op.value === undefined ? `clear the project ${op.key}` : `set the project ${op.key}`;
    case "label.bind":
      return `read ${hex(op.address)} as one particular label`;
    case "label.unbind":
      return `read ${op.id} by the usual rule again`;
    // Read as the action, because these become undo descriptions and history
    // lines: "name $8004 ByBob" is what somebody did, where "claim ByBob at
    // $8004" is what the data looks like afterwards.
    case "claim.add": {
      const claim = op.claim;
      const where = claim.extent
        ? `${hex(claim.at)}-${hex(claim.at + claim.extent)}`
        : hex(claim.at);
      const named = claim.name ? ` (${claim.name})` : "";
      if (claim.says) return `declare ${where} ${claim.says.is}${named}`;
      if (claim.root === "routine") return `mark ${where} a routine${named}`;
      if (claim.root === "entry") return `mark ${where} an entry point${named}`;
      if (claim.root === "location") return `mark ${where} a code location${named}`;
      return claim.name ? `name ${where} ${claim.name}` : `claim ${where}`;
    }

    case "claim.set": {
      const fields = op.fields;
      // The common single-field edits read as themselves; anything else lists
      // what it touched, which is what a reader needs to judge an undo.
      if (Object.keys(fields).length === 1) {
        if (typeof fields.name === "string") return `rename ${op.id} to ${fields.name}`;
        if (fields.root === null) return `unmark ${op.id}`;
        if (fields.says) return `read ${op.id} as ${fields.says.is}`;
      }
      const named = Object.keys(fields);
      return `revise ${op.id}: ${named.length ? named.join(", ") : "nothing"}`;
    }

    case "claim.remove":
      return `remove ${op.id}`;

    case "constant.set":
      return `define ${op.name} as $${op.value.toString(16).toUpperCase().padStart(2, "0")}`;
    case "constant.delete":
      return `delete constant ${op.id}`;

    case "target.set":
      // Says what the write actually changed, since it need not change layers.
      return `define target ${op.name}${
        op.layers ? ` over ${op.layers.length} layer(s)` : ""
      }${op.description !== undefined ? ", described" : ""}${
        op.order !== undefined ? `, order ${op.order}` : ""
      }`;
    case "target.remove":
      return `remove target ${op.name}`;

    case "file.add":
      return `add file ${op.name} (${op.size} bytes)`;
    case "file.remove":
      return `remove file ${op.name}`;

    case "decoder.set":
      return `define decoder ${op.name}`;
    case "decoder.delete":
      return `remove decoder ${op.id}`;
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
