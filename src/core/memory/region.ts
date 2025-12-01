import { Label, createRegionLabel } from "./label.js";

/** What kind of data a memory region contains */
export type RegionKind =
  | "code"       // Disassemble as instructions
  | "data"       // Raw bytes (display as hex)
  | "text"       // ASCII/PETSCII text
  | "jumptable"  // Array of addresses (each is an entry point)
  | "unknown";   // Not yet analyzed

/** Source of a region - where it came from */
export interface RegionSource {
  /** Kind of source: "layer" for auto-generated, "user" for user-defined */
  kind: "layer" | "user";
  /** Name of the layer that generated this region (if kind is "layer") */
  layerName?: string;
}

/**
 * A region defines what a range of memory contains.
 * Regions are used to guide disassembly and display.
 */
export interface Region {
  /** Start address (inclusive) */
  readonly start: number;
  /** End address (exclusive) */
  readonly end: number;
  /** What kind of data this region contains */
  readonly kind: RegionKind;
  /** Optional name/label for the region */
  readonly name?: string;
  /** Where this region came from */
  readonly source: RegionSource;
}

/** Create an auto-generated region from a layer */
export function createLayerRegion(
  start: number,
  end: number,
  kind: RegionKind,
  layerName: string,
  name?: string
): Region {
  return {
    start,
    end,
    kind,
    name,
    source: { kind: "layer", layerName },
  };
}

/** Create a user-defined region */
export function createUserRegion(
  start: number,
  end: number,
  kind: RegionKind,
  name?: string
): Region {
  return {
    start,
    end,
    kind,
    name,
    source: { kind: "user" },
  };
}

/**
 * Index for fast region lookup by address.
 * Handles overlapping regions with priority (user > layer).
 */
export class RegionIndex {
  private regions: Region[] = [];

  addRegion(region: Region): void {
    this.regions.push(region);
  }

  addRegions(regions: readonly Region[]): void {
    for (const region of regions) {
      this.addRegion(region);
    }
  }

  /**
   * Get the effective region at an address.
   * User-defined regions take priority over layer-generated ones.
   */
  getRegionAt(address: number): Region | undefined {
    let best: Region | undefined;

    for (const region of this.regions) {
      if (address >= region.start && address < region.end) {
        if (!best) {
          best = region;
        } else if (region.source.kind === "user" && best.source.kind === "layer") {
          // User regions take priority
          best = region;
        } else if (region.source.kind === best.source.kind) {
          // Same priority - prefer more specific (smaller) region
          if (region.end - region.start < best.end - best.start) {
            best = region;
          }
        }
      }
    }

    return best;
  }

  /** Check if an address is in a code region */
  isCode(address: number): boolean {
    const region = this.getRegionAt(address);
    return region?.kind === "code";
  }

  /** Check if an address is in a data region (non-code) */
  isData(address: number): boolean {
    const region = this.getRegionAt(address);
    return region !== undefined && region.kind !== "code";
  }

  /** Get all regions sorted by start address */
  getAllRegions(): readonly Region[] {
    return [...this.regions].sort((a, b) => a.start - b.start);
  }

  /** Get all regions of a specific kind */
  getRegionsByKind(kind: RegionKind): readonly Region[] {
    return this.regions.filter((r) => r.kind === kind);
  }

  /** Get all jumptable regions (for extracting entry points) */
  getJumptables(): readonly Region[] {
    return this.getRegionsByKind("jumptable");
  }

  get size(): number {
    return this.regions.length;
  }

  /**
   * Generate labels from named region boundaries.
   * Creates a label at the start of each named region.
   * For code regions, the label type is "entry"; otherwise "address".
   */
  generateLabels(): Label[] {
    const labels: Label[] = [];

    for (const region of this.regions) {
      if (region.name) {
        const type = region.kind === "code" ? "entry" : "address";
        labels.push(createRegionLabel(region.start, region.name, type, region.name));
      }
    }

    return labels;
  }
}
