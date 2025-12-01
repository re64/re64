import { Label, LabelType, createUserLabel } from "../memory/label.js";
import { Region, RegionKind, createUserRegion } from "../memory/region.js";

/** Layer definition in a project file */
export interface ProjectLayer {
  /** Layer type */
  type: "prg" | "raw" | "bytes";
  /** File path (for prg/raw) */
  path?: string;
  /** Load address (for raw, optional override for prg) */
  address?: number;
  /** Hex bytes (for bytes type) */
  bytes?: string;
  /** Length for fill/repeat */
  length?: number;
  /** Suppress automatic entry point for PRG files */
  noAutoEntry?: boolean;
}

/** Label definition in a project file */
export interface ProjectLabel {
  /** Address (hex string like "$83C1" or number) */
  address: number | string;
  /** Label name */
  name: string;
  /** Label type (default: "address") */
  type?: LabelType;
  /** Optional comment */
  comment?: string;
}

/** Region definition in a project file */
export interface ProjectRegion {
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
  /** Memory layers */
  layers: ProjectLayer[];
  /** Manual entry points (addresses) */
  entryPoints?: (number | string)[];
  /** User-defined labels */
  labels?: ProjectLabel[];
  /** User-defined regions (override auto-generated) */
  regions?: ProjectRegion[];
}

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

/** Convert project labels to Label objects */
export function projectLabelsToLabels(projectLabels: ProjectLabel[]): Label[] {
  return projectLabels.map((pl) => {
    const address = parseProjectAddress(pl.address);
    const type = pl.type ?? "address";
    return createUserLabel(address, pl.name, type);
  });
}

/** Convert project regions to Region objects */
export function projectRegionsToRegions(projectRegions: ProjectRegion[]): Region[] {
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

    return createUserRegion(start, end, pr.kind, pr.name);
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
  }

  return project;
}
