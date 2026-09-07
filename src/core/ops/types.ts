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
import { LabelType } from "../memory/label-type.js";
import { TextEncoding } from "../c64/text.js";
import { LayerDefault } from "../memory/region.js";
import { Claim } from "../claims/model.js";
import { EvidenceKind, ProjectCapture, ProjectStep } from "../project/project.js";



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



/** Write a comment. **Always adds.** See `docs/algebra.md`, Shape 1. */
export interface CommentAddOp {
  op: "comment.add";
  id: string;
  layerId: string;
  address: number;
  placement: CommentPlacement;
  text: string;
  /** Position among the comments at this address; unset until arranged. */
  order?: number;
}

/** Revise a comment by id. Omitted leaves alone; `null` clears. */
export interface CommentSetOp {
  op: "comment.set";
  id: string;
  layerId: string;
  fields: {
    address?: number;
    placement?: CommentPlacement;
    text?: string;
    order?: number | null;
  };
}

export interface CommentRemoveOp {
  op: "comment.remove";
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
   * `defaultTarget` rides here rather than getting an operation of its own:
   * selecting a view is setting one project-level scalar, which is exactly what
   * this op is for.
   */
  key: "name" | "description" | "defaultTarget";
  value?: string;
}

/** Say that the operand at an address means one particular label. */
export interface LabelBindOp {
  op: "labelUse.bind";
  id: string;
  layerId: string;
  address: number;
  labelId: string;
}

export interface LabelUnbindOp {
  op: "labelUse.unbind";
  id: string;
  layerId: string;
}

/** Declare that a name exists for a value. **Always adds.** */
export interface ConstantAddOp {
  op: "constant.add";
  id: string;
  name: string;
  value: number;
}

/** Revise a constant by id. Omitted leaves alone. */
export interface ConstantSetOp {
  op: "constant.set";
  id: string;
  fields: { name?: string; value?: number };
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
/**
 * Declare a named view over the layer stack. **Always adds.**
 *
 * Keyed by id, like every other entity. A target's *name* is what a request
 * names and what `defaultTarget` records, but a name is a field somebody chose
 * and is resolved as a lookup — never an identity. See `docs/algebra.md`.
 */
export interface TargetAddOp {
  op: "target.add";
  id: string;
  name: string;
  layers?: TargetLink[];
  entryPoints?: number[];
  order?: number;
  description?: string;
}

/** Revise a target by id. Omitted leaves alone. */
export interface TargetSetOp {
  op: "target.set";
  id: string;
  fields: {
    name?: string;
    /**
     * The linked layers, bottom-up, and where each lands. Order is z-order, so
     * this is also how the stack is reordered.
     *
     * Each link carries an **id**, because a link is a thing the API addresses
     * on its own — moving one layer to a different address, or taking one out
     * of the stack, is an edit to that link and not a rewrite of the list. A
     * whole-array write is the same last-writer-wins bug as a whole-value
     * `set`, one level down: two people adjusting different layers of one
     * target would lose each other's work with nothing reported.
     */
    layers?: TargetLink[];
    /** `null` clears, which an omitted field cannot say. */
    entryPoints?: number[] | null;
    order?: number | null;
    description?: string | null;
  };
}

/**
 * One field of a record layout, at an offset into it.
 *
 * Carries an id like everything else the API addresses on its own. The offset
 * used to be the key *and* the identity, which made moving a field a delete
 * plus a create — losing its description and anything else somebody wrote about
 * it. An offset is a property of a field, not its name.
 */
export interface TypeField {
  id: string;
  name: string;
  type: string;
  description?: string;
}

/** One layer in a target's stack, at the address that target puts it. */
export interface TargetLink {
  id: string;
  layer: string;
  /** Where it lands; absent means the layer's own address. */
  at?: number;
}


export interface TargetRemoveOp {
  op: "target.remove";
  id: string;
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

/** Carry a decoder in the project. **Always adds.** */
export interface DecoderAddOp {
  op: "decoder.add";
  id: string;
  name: string;
  /** The body of a function taking `(bytes, params)`. */
  source: string;
}

/** Revise a decoder by id. Omitted leaves alone. */
export interface DecoderSetOp {
  op: "decoder.set";
  id: string;
  fields: { name?: string; source?: string };
}

export interface DecoderRemoveOp {
  op: "decoder.remove";
  id: string;
}

/**
 * Declare or revise a record layout.
 *
 * Whole-value, like `decoder.set`, and for the same reason: a layout is small,
 * a caller sends the shape it means, and there is nothing here that two people
 * would want to edit halves of the way they edit halves of a claim. What *does*
 * merge per-key is the fields map inside the CRDT, which is where two readers
 * adding different fields converge without either of them saying so.
 */
/** Declare a record layout. **Always adds.** */
export interface TypeAddOp {
  op: "type.add";
  id: string;
  name: string;
  /** Bytes per record. Holes are legal, so this is declared, not derived. */
  size: number;
  /** By offset. Two fields cannot share one, so the key is the identity. */
  fields: Record<number, TypeField>;
}

/**
 * Revise a type by id. Omitted leaves alone.
 *
 * `fields` is **merged by offset**, and a `null` at an offset removes that one
 * field — never a whole-map write. Two people adding different fields to one
 * record touch different keys and both survive, which is the merge property the
 * offset keys exist for; sending the map as one value would make it
 * last-writer-wins over the lot and lose a field somebody proved from a copy
 * routine.
 */
export interface TypeSetOp {
  op: "type.set";
  id: string;
  fields: {
    name?: string;
    size?: number;
    fields?: Record<number, TypeField | null>;
  };
}

export interface TypeRemoveOp {
  op: "type.remove";
  id: string;
}

export interface ConstantRemoveOp {
  op: "constant.remove";
  id: string;
}

/** Say that the operand at an address means a constant. */
export interface ConstantBindOp {
  op: "constantUse.bind";
  id: string;
  layerId: string;
  address: number;
  constantId: string;
}

export interface ConstantUnbindOp {
  op: "constantUse.unbind";
  id: string;
  layerId: string;
}

/**
 * Add a layer, at a position in the declaration order.
 *
 * Every kind the project file can hold, because the file format and the
 * operation vocabulary drifting apart is how a layer ends up in a document that
 * cannot be written back out.
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
  layerType: "symbols" | "prg" | "raw" | "rom" | "bytes";
  /** Which machine ROM, for a `rom` layer. */
  rom?: "basic" | "kernal" | "characters";
  name: string;
  /** For a byte layer: the file it reads, as `name` or `disk.d64:NAME`. */
  path?: string;
  /** For a `raw` or `bytes` layer, which carries no load address of its own. */
  address?: number;
  /**
   * The bytes themselves, in hex, for a `bytes` layer.
   *
   * The one layer kind whose content is *in* the project rather than beside it,
   * which is what a patch, a poked value or a hand-assembled shim needs: no
   * file to upload, and the diff shows the bytes changing.
   */
  bytes?: string;
  /** Repeat or pad a `bytes` layer to this width. */
  length?: number;
  /** Where in declaration order; the bottom of the stack when omitted. */
  index?: number;
}

/**
 * Revise a layer by id. Omitted leaves alone.
 *
 * The hole this file recorded for months: z-order moved to the target, so the
 * missing operation was never reordering — it was that a layer could not be
 * *renamed*. `path`, `address` and the rest are what a layer is; only `name` is
 * a label somebody chose, so only `name` is editable here.
 */
export interface LayerSetOp {
  op: "layer.set";
  id: string;
  fields: { name?: string };
}

export interface LayerRemoveOp {
  op: "layer.remove";
  id: string;
}

/** Promote a label at an address, or clear the choice. */
export interface PrimaryBindOp {
  op: "primary.bind";
  address: number;
  labelId: string;
}

export interface PrimaryUnbindOp {
  op: "primary.unbind";
  address: number;
}

/** Say something about a claim. **Always adds.** */
export interface EvidenceAddOp {
  op: "evidence.add";
  id: string;
  claim: string;
  kind: EvidenceKind;
  scenario?: string;
  capture?: string;
  other?: string;
  note?: string;
}

/** Revise a piece of evidence by id. Omitted leaves alone; `null` clears. */
export interface EvidenceSetOp {
  op: "evidence.set";
  id: string;
  fields: {
    kind?: EvidenceKind;
    scenario?: string | null;
    capture?: string | null;
    other?: string | null;
    note?: string | null;
  };
}

export interface EvidenceRemoveOp {
  op: "evidence.remove";
  id: string;
}

/** Declare a workflow for the machine. **Always adds.** */
export interface ScenarioAddOp {
  op: "scenario.add";
  id: string;
  name: string;
  description?: string;
  steps: ProjectStep[];
}

/**
 * Revise a scenario by id. Omitted leaves alone; `null` clears.
 *
 * `steps` is written whole, unlike a type's fields. A scenario is one author's
 * sequence of intentions and the order is the meaning, so there is no key to
 * merge on — which is stated here rather than left to be discovered when two
 * people revise one and the shorter list wins.
 */
export interface ScenarioSetOp {
  op: "scenario.set";
  id: string;
  fields: {
    name?: string;
    description?: string | null;
    steps?: ProjectStep[];
  };
}

export interface ScenarioRemoveOp {
  op: "scenario.remove";
  id: string;
}

/** Record what a run produced. **Always adds.** */
export interface CaptureAddOp {
  op: "capture.add";
  id: string;
  scenario: string;
  step: string;
  kind: ProjectCapture["kind"];
  file: string;
  when?: number;
}

/** Revise a capture by id — its name, in practice. */
export interface CaptureSetOp {
  op: "capture.set";
  id: string;
  fields: { file?: string; when?: number | null };
}

export interface CaptureRemoveOp {
  op: "capture.remove";
  id: string;
}

/**
 * Every edit, in two shapes. See `docs/algebra.md`.
 *
 * **Entity** — `add` mints an id and always adds, `set` revises named fields by
 * id, `remove` takes it back by id. **Binding** — `bind` puts a key, `unbind`
 * clears it, and re-binding a key is how a binding is updated.
 *
 * There is no third shape and no upsert. A write that infers *which* thing it
 * revises from a span, an address, a name or a slot has been wrong every time
 * it has been tried here — four times, each found by an experiment rather than
 * by review.
 */
export type Op =
  // Entities: add / set / remove, by id
  | ClaimAddOp | ClaimSetOp | ClaimRemoveOp
  | CommentAddOp | CommentSetOp | CommentRemoveOp
  | ConstantAddOp | ConstantSetOp | ConstantRemoveOp
  | DecoderAddOp | DecoderSetOp | DecoderRemoveOp
  | TypeAddOp | TypeSetOp | TypeRemoveOp
  | LayerAddOp | LayerSetOp | LayerRemoveOp
  | TargetAddOp | TargetSetOp | TargetRemoveOp
  | ScenarioAddOp | ScenarioSetOp | ScenarioRemoveOp
  | CaptureAddOp | CaptureSetOp | CaptureRemoveOp
  | EvidenceAddOp | EvidenceSetOp | EvidenceRemoveOp
  // Bindings: bind / unbind, by key
  | LabelBindOp | LabelUnbindOp
  | ConstantBindOp | ConstantUnbindOp
  | PrimaryBindOp | PrimaryUnbindOp
  // Immutable attachments, and the project's own scalars
  | FileAddOp | FileRemoveOp
  | MetaSetOp;

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
/**
 * Where a claim is, in the only terms a reader thinks in.
 *
 * A layer-framed claim stores an offset into its layer's bytes, so describing
 * one without resolving it reports `$03C1` for a claim at `$83C1` — which the
 * first reader to meet it read as their write having landed 32KB away. Offsets
 * never cross the wire, and a description is very much the wire: it is the
 * field a caller checks to see that its write did what it asked.
 *
 * Optional because two of the four callers describe an op with no project to
 * hand. Where it is absent the position is spelled as the offset it is, rather
 * than as an address it is not.
 */
export type AddressResolver = (claim: { at: number; frame?: Claim["frame"] }) => number | undefined;

export function describeOp(op: Op, resolve?: AddressResolver): string {
  const hex = (n: number) => `$${n.toString(16).toUpperCase().padStart(4, "0")}`;
  switch (op.op) {
    case "comment.add": {
      // The text, not its length: a history entry saying "commented $8870" is
      // no use when the question is which comment was lost.
      return `comment ${hex(op.address)} ${op.placement}: ${shorten(op.text)}`;
    }
    case "comment.set":
      return op.fields.text !== undefined
        ? `reword comment ${op.id}: ${shorten(op.fields.text)}`
        : `revise comment ${op.id}`;
    case "comment.remove":
      return `remove comment ${op.id}`;
    case "meta.set":
      return op.value === undefined ? `clear the project ${op.key}` : `set the project ${op.key}`;
    case "labelUse.bind":
      return `read ${hex(op.address)} as one particular label`;
    case "labelUse.unbind":
      return `read ${op.id} by the usual rule again`;
    // Read as the action, because these become undo descriptions and history
    // lines: "name $8004 ByBob" is what somebody did, where "claim ByBob at
    // $8004" is what the data looks like afterwards.
    case "claim.add": {
      const claim = op.claim;
      const at = resolve?.(claim);
      // Inclusive, like `covers` and like every other span this surface prints:
      // `extent: 32` at `$8F00` is `$8F00-$8F1F`, not `-$8F20`.
      const where =
        at === undefined
          ? claim.extent
            ? `+${hex(claim.at)}-+${hex(claim.at + claim.extent - 1)}`
            : `+${hex(claim.at)}`
          : claim.extent
            ? `${hex(at)}-${hex(at + claim.extent - 1)}`
            : hex(at);
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

    case "constant.add":
      return `define ${op.name} as $${op.value.toString(16).toUpperCase().padStart(2, "0")}`;
    case "constant.set":
      return `revise constant ${op.id}${op.fields.name ? ` to ${op.fields.name}` : ""}`;
    case "constant.remove":
      return `remove constant ${op.id}`;

    case "target.add":
      return `define target ${op.name}${
        op.layers ? ` over ${op.layers.length} layer(s)` : ""
      }`;
    case "target.set": {
      // Says what the write actually changed, since it need not change layers.
      const f = op.fields;
      return `revise target ${op.id}${f.name ? ` to ${f.name}` : ""}${
        f.layers ? `, ${f.layers.length} layer(s)` : ""
      }${f.description !== undefined ? ", described" : ""}${
        f.order !== undefined ? `, order ${f.order}` : ""
      }`;
    }
    case "target.remove":
      return `remove target ${op.id}`;

    case "file.add":
      return `add file ${op.name} (${op.size} bytes)`;
    case "file.remove":
      return `remove file ${op.name}`;

    case "decoder.add":
      return `define decoder ${op.name}`;
    case "decoder.set":
      return `revise decoder ${op.id}${op.fields.name ? ` to ${op.fields.name}` : ""}`;
    case "decoder.remove":
      return `remove decoder ${op.id}`;
    case "type.add":
      return `define type ${op.name}`;
    case "type.set": {
      // Names the fields, because a merge that touches one offset and a rename
      // are the two different things this op does and they read alike otherwise.
      const touched = Object.keys(op.fields.fields ?? {}).length;
      return `revise type ${op.id}${op.fields.name ? ` to ${op.fields.name}` : ""}${
        touched ? `, ${touched} field(s)` : ""
      }`;
    }
    case "type.remove":
      return `remove type ${op.id}`;
    case "constantUse.bind":
      return `read ${hex(op.address)} as a constant`;
    case "constantUse.unbind":
      return `read ${op.id} as a literal again`;
    case "scenario.add":
      return `define scenario ${op.name} (${op.steps.length} step(s))`;
    case "scenario.set":
      return `revise scenario ${op.id}${op.fields.name ? ` to ${op.fields.name}` : ""}${
        op.fields.steps ? `, ${op.fields.steps.length} step(s)` : ""
      }`;
    case "scenario.remove":
      return `remove scenario ${op.id}`;

    case "capture.add":
      return `keep ${op.kind} as ${op.file}`;
    case "capture.set":
      return `revise capture ${op.id}`;
    case "capture.remove":
      return `remove capture ${op.id}`;

    case "evidence.add":
      return `${op.kind} ${op.claim}${op.other ? ` with ${op.other}` : ""}${
        op.scenario ? ` by running ${op.scenario}` : ""
      }`;
    case "evidence.set":
      return `revise evidence ${op.id}`;
    case "evidence.remove":
      return `withdraw evidence ${op.id}`;

    case "layer.add":
      return `add ${op.layerType} layer ${op.name}`;
    case "layer.set":
      return `rename layer ${op.id}${op.fields.name ? ` to ${op.fields.name}` : ""}`;
    case "layer.remove":
      return `remove layer ${op.id}`;
    case "primary.bind":
      return `show ${op.labelId} at ${hex(op.address)}`;
    case "primary.unbind":
      return `clear the primary label at ${hex(op.address)}`;
  }
}

/** A comment's own words, on one line, for a history entry. */
function shorten(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 40 ? `${oneLine.slice(0, 39)}\u2026` : oneLine;
}
