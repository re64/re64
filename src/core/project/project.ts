import { Comment, CommentPlacement, createComment } from "../memory/comment.js";
import {
  Constant,
  ConstantUse,
  createConstant,
  createConstantUse,
} from "../memory/constant.js";
import {
  Label,
  LabelType,
  LabelUse,
  createLabelUse,
  createUserLabel,
} from "../memory/label.js";
import { TEXT_ENCODINGS, TextEncoding } from "../c64/text.js";
import { Region, RegionKind, createUserRegion } from "../memory/region.js";
import { derivedId } from "./identity.js";

/**
 * Layer definition in a project file.
 *
 * Labels and regions nest inside the layer that owns them, so reordering the
 * stack moves annotations with the content they describe rather than leaving
 * them pointing at whatever else lands at that address.
 */
export interface ProjectLayer {
  /**
   * Stable identity. Optional in the file: a project written before ids
   * existed gets one derived from its content, and the next write persists it.
   */
  id?: string;
  /** Layer type. "symbols" carries names for addresses with no loaded bytes. */
  type: "prg" | "raw" | "bytes" | "symbols";
  /** File path (for prg/raw) */
  path?: string;
  /** Load address (for raw, optional override for prg) */
  address?: number | string;
  /** Hex bytes (for bytes type) */
  bytes?: string;
  /** Length for fill/repeat */
  length?: number;
  /** Suppress automatic entry point for PRG files */
  noAutoEntry?: boolean;
  /** Display name, defaulting to the file basename or a generated one */
  name?: string;
  /** Labels owned by this layer */
  labels?: ProjectLabel[];
  /** Regions carved out of this layer, overriding its default kind */
  regions?: ProjectRegion[];
  /** Comments about addresses this layer owns */
  comments?: ProjectComment[];
  /** Operands in this layer that mean a named constant */
  constantUses?: ProjectConstantUse[];
  /** Operands in this layer that mean one particular label */
  labelUses?: ProjectLabelUse[];
}

/**
 * An operand that means one of several labels at an address.
 *
 * Keyed by the site — the instruction doing the referring — because the point
 * is that two instructions touching one address can mean different names for
 * it. Dangling means "fall back to the primary".
 */
export interface ProjectLabelUse {
  id?: string;
  address: number | string;
  label: string;
}

/**
 * An operand that means a constant, rather than the number it literally is.
 *
 * Owned by the layer holding the instruction. The declaration it points at is
 * project-level, because a name for a value describes no bytes and so has
 * nothing to move with when the stack is reordered.
 */
export interface ProjectConstantUse {
  id?: string;
  address: number | string;
  /** The declared constant's id. Dangling means "render the literal". */
  constant: string;
}

/**
 * A comment in a project file.
 *
 * Owned by a layer for the same reason labels are: reordering the stack has to
 * move an annotation with the bytes it describes.
 */
export interface ProjectComment {
  /** Stable identity; derived from content when the file omits it. */
  id?: string;
  address: number | string;
  /** Default "before". An inline comment shares the instruction's row. */
  placement?: CommentPlacement;
  text: string;
}

/** Label definition in a project file */
export interface ProjectLabel {
  /** Stable identity; derived from content when the file omits it. */
  id?: string;
  /** Address (hex string like "$83C1" or number) */
  address: number | string;
  /** Label name */
  name: string;
  /** Label type (default: "address") */
  type?: LabelType;
  /**
   * How many bytes this name covers, when it names an array.
   *
   * An operand inside it renders as `SCREEN_RAM + $000F` rather than a bare
   * address — which is what makes a screen coordinate readable without doing
   * hex arithmetic on every line.
   */
  extent?: number;
  /**
   * Superseded by first-class comments, and read only so an older file does not
   * lose one: the loader turns it into a `before` comment at the same address.
   *
   * It was stored, carried through the model, and rendered nowhere, so a
   * comment could not exist anywhere a label did not — which made commenting an
   * instruction mean inventing a name for it.
   */
  comment?: string;
}

/** Region definition in a project file */
export interface ProjectRegion {
  /** Stable identity; derived from content when the file omits it. */
  id?: string;
  /** Start address (hex string like "$8000" or number) */
  start: number | string;
  /** End address (exclusive) or length with + prefix */
  end: number | string;
  /** Region kind */
  kind: RegionKind;
  /** How to read a `text` region's bytes. Default "ascii". */
  encoding?: TextEncoding;
  /** Optional name/label for the region */
  name?: string;
  /** Optional comment */
  comment?: string;
}

/** Project file structure */
export interface Project {
  /** Project name */
  name?: string;
  /** Project description */
  description?: string;
  /** Memory layers, each owning its labels and regions */
  layers: ProjectLayer[];
  /** Manual entry points (addresses) */
  entryPoints?: (number | string)[];
  /**
   * Which label to show where several share an address, by label id.
   *
   * Keyed by address, so "one primary per address" is structural rather than a
   * flag several labels could each set. Project level rather than per-layer,
   * because two layers can hold labels at the same address.
   *
   * An id that no longer exists means "no primary" and falls back to rank, so
   * deleting a promoted label needs no cleanup.
   */
  primaryLabels?: Record<string, string>;
  /**
   * Names for values, project-wide.
   *
   * A value has no address and no single meaning — the reference disassembly
   * names $01 both LEFT_ZAPPER and WHITE — so these are declarations only.
   * Which one an operand means is recorded per site, in the owning layer.
   */
  constants?: ProjectConstant[];
}

export interface ProjectConstant {
  id?: string;
  name: string;
  /** 8-bit value, as a number or "$1F". */
  value: number | string;
}

/**
 * Valid values for the string-typed fields a project file can set.
 *
 * These are user-written, so they are checked here rather than deeper down:
 * a typo should name the offending region, not surface as a crash inside the
 * render walk.
 */
const REGION_KINDS: readonly RegionKind[] = [
  "code",
  "data",
  "text",
  "jumptable",
  "unknown",
];
const LABEL_TYPES: readonly LabelType[] = ["entry", "function", "code", "address"];

/** Parse an address that may be a number or hex string */
export function parseProjectAddress(value: number | string): number {
  if (typeof value === "number") {
    return value;
  }
  const str = value.trim();
  if (str.startsWith("$")) {
    return parseInt(str.slice(1), 16);
  }
  if (str.startsWith("0x")) {
    return parseInt(str.slice(2), 16);
  }
  return parseInt(str, 10);
}

/**
 * Convert project labels to Label objects.
 *
 * A label without an id gets one derived from its layer, address, and name, so
 * every client that loads the same un-migrated file agrees on it. The next
 * write persists a real id and the derivation stops mattering.
 */
export function projectLabelsToLabels(
  projectLabels: ProjectLabel[],
  layerId: string
): Label[] {
  return projectLabels.map((pl) => {
    const address = parseProjectAddress(pl.address);
    const type = pl.type ?? "address";
    const id = pl.id ?? derivedId("lbl", layerId, address, pl.name);
    return createUserLabel(id, address, pl.name, type, pl.comment, pl.extent);
  });
}

/**
 * Convert project comments to Comment objects.
 *
 * A legacy `comment` on a label becomes a `before` comment at its address, so
 * an older file keeps what it said rather than dropping it silently.
 */
export function projectCommentsToComments(
  layer: ProjectLayer,
  layerId: string
): Comment[] {
  const comments = (layer.comments ?? []).map((pc) => {
    const address = parseProjectAddress(pc.address);
    const placement = pc.placement ?? "before";
    const id = pc.id ?? derivedId("cmt", layerId, address, placement);
    return createComment(id, address, placement, pc.text);
  });

  for (const label of layer.labels ?? []) {
    if (!label.comment) continue;
    const address = parseProjectAddress(label.address);
    comments.push(
      createComment(
        derivedId("cmt", layerId, address, "from-label"),
        address,
        "before",
        label.comment
      )
    );
  }

  return comments;
}

/** Convert a layer's constant uses to ConstantUse objects. */
export function projectConstantUses(layer: ProjectLayer, layerId: string): ConstantUse[] {
  return (layer.constantUses ?? []).map((u) => {
    const address = parseProjectAddress(u.address);
    return createConstantUse(u.id ?? derivedId("cst", layerId, address, "use"), address, u.constant);
  });
}

/** Convert project constants to Constant objects. */
/** Convert a layer's label uses to LabelUse objects. */
export function projectLabelUses(layer: ProjectLayer, layerId: string): LabelUse[] {
  return (layer.labelUses ?? []).map((u) => {
    const address = parseProjectAddress(u.address);
    return createLabelUse(u.id ?? derivedId("lbl", layerId, address, "use"), address, u.label);
  });
}

export function projectConstants(constants: readonly ProjectConstant[] = []): Constant[] {
  return constants.map((c) => {
    const value = parseProjectAddress(c.value);
    return createConstant(c.id ?? derivedId("cst", c.name, value), c.name, value);
  });
}

/** Convert project regions to Region objects */
export function projectRegionsToRegions(
  projectRegions: ProjectRegion[],
  layerId: string
): Region[] {
  return projectRegions.map((pr) => {
    const start = parseProjectAddress(pr.start);
    let end: number;

    // Support "end" as either absolute address or "+length" format
    if (typeof pr.end === "string" && pr.end.startsWith("+")) {
      const length = parseProjectAddress(pr.end.slice(1));
      end = start + length;
    } else {
      end = parseProjectAddress(pr.end);
    }

    const id = pr.id ?? derivedId("rgn", layerId, start, pr.kind);
    return createUserRegion(id, start, end, pr.kind, pr.name, pr.comment, pr.encoding);
  });
}

/** Load and parse a project file */
export function parseProject(json: string): Project {
  const project = JSON.parse(json) as Project;

  // Validate required fields
  if (!project.layers || !Array.isArray(project.layers)) {
    throw new Error("Project must have a 'layers' array");
  }

  for (const layer of project.layers) {
    if (!layer.type) {
      throw new Error("Each layer must have a 'type' field");
    }
    if (layer.type === "prg" || layer.type === "raw") {
      if (!layer.path) {
        throw new Error(`Layer type '${layer.type}' requires a 'path' field`);
      }
    }
    if (layer.type === "raw" && layer.address === undefined) {
      throw new Error("Layer type 'raw' requires an 'address' field");
    }
    if (layer.type === "bytes") {
      if (!layer.bytes) {
        throw new Error("Layer type 'bytes' requires a 'bytes' field");
      }
      if (layer.address === undefined) {
        throw new Error("Layer type 'bytes' requires an 'address' field");
      }
    }
    if (layer.type === "symbols") {
      // An empty symbols layer used to be refused, on the grounds that a layer
      // contributing nothing is almost always a mistake. That stopped being
      // true once one could be created deliberately: `add_layer` makes an empty
      // one to be filled, and naming an address that no layer owns creates one
      // in the same action as the label going into it. It supplies no bytes and
      // no names, so it is inert rather than wrong.
      // A symbols layer supplies no bytes, so a region on one says how to read
      // something that is not there. Dropped rather than refused: this used to
      // throw, and a single accepted write could put a region here and leave
      // the project unopenable — unwritable through the agent API, the HTTP
      // API and the CLI alike, with no way back. Refusing the *write* is the
      // fix; refusing to load is how the damage became permanent.
      if (layer.regions?.length) delete layer.regions;
    }
  }

  for (const [index, layer] of project.layers.entries()) {
    const where = layer.path ?? layer.name ?? `layer ${index}`;

    for (const region of layer.regions ?? []) {
      if (!REGION_KINDS.includes(region.kind)) {
        throw new Error(
          `Unknown region kind "${region.kind}" at ${String(region.start)} in ${where}. ` +
            `Expected one of: ${REGION_KINDS.join(", ")}`
        );
      }
      // Unvalidated until now, and `decodeText` used to fall through to ASCII,
      // so a typo like "petsci" was accepted, written back, and rendered as
      // confident nonsense with nothing said anywhere.
      if (region.encoding !== undefined && !TEXT_ENCODINGS.includes(region.encoding)) {
        throw new Error(
          `Unknown text encoding "${region.encoding}" at ${String(region.start)} in ${where}. ` +
            `Expected one of: ${TEXT_ENCODINGS.join(", ")}`
        );
      }
    }

    for (const label of layer.labels ?? []) {
      if (label.type !== undefined && !LABEL_TYPES.includes(label.type)) {
        throw new Error(
          `Unknown label type "${label.type}" for "${label.name}" in ${where}. ` +
            `Expected one of: ${LABEL_TYPES.join(", ")}`
        );
      }
    }
  }

  // The flat top-level form was replaced by per-layer ownership. Fail loudly
  // rather than silently ignoring annotations the user expects to see.
  const legacy = project as { labels?: unknown; regions?: unknown };
  if (legacy.labels !== undefined || legacy.regions !== undefined) {
    throw new Error(
      "Top-level 'labels'/'regions' are no longer supported: move them into the " +
        "owning layer, or into a layer of type 'symbols' for addresses with no bytes"
    );
  }

  return project;
}
