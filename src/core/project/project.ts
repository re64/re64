import { Comment, CommentPlacement, createComment } from "../memory/comment.js";
import { Label, LabelType, createUserLabel } from "../memory/label.js";
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
    return createUserLabel(id, address, pl.name, type, pl.comment);
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
    return createUserRegion(id, start, end, pr.kind, pr.name, pr.comment);
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
      // A symbol layer with no labels contributes nothing; that is almost
      // always a mistake rather than an intent.
      if (!layer.labels?.length) {
        throw new Error("Layer type 'symbols' requires a non-empty 'labels' array");
      }
      if (layer.regions?.length) {
        throw new Error("Layer type 'symbols' cannot have regions: it supplies no bytes");
      }
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
