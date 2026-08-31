import { TextEncoding } from "../c64/text.js";
import { Label, createRegionLabel } from "./label.js";
import { derivedId } from "../project/identity.js";

/** What kind of data a memory region contains */
export type RegionKind =
  | "code"       // Disassemble as instructions
  | "data"       // Raw bytes (display as hex)
  | "text"       // ASCII/PETSCII text
  | "jumptable"  // Array of addresses (each is an entry point)
  | "bitmap"     // Graphics: a character set, sprites, a screen
  | "unknown";   // Not yet analyzed

/**
 * A region declares what a range of memory contains, overriding the
 * `defaultRegionKind` of the layer that owns it.
 *
 * Regions belong to a layer rather than to the address space: reordering the
 * layer stack has to move annotations with the bytes they describe, not leave
 * them pointing at whatever ends up at that address.
 */
export interface Region {
  /**
   * Stable identity, independent of extent.
   *
   * Regions move and grow, so keying on the start address would make "extend
   * this region" indistinguishable from delete-plus-create.
   */
  readonly id: string;
  /** Start address (inclusive) */
  readonly start: number;
  /** End address (exclusive) */
  readonly end: number;
  /** What kind of data this region contains */
  readonly kind: RegionKind;
  /** Optional name/label for the region */
  readonly name?: string;
  /** Optional comment */
  readonly comment?: string;
  /**
   * How to read the bytes of a `text` region.
   *
   * Defaults to ASCII, which is what this always assumed and is wrong for most
   * C64 text: neither PETSCII nor screen codes are ASCII, so reading either
   * that way produces confident nonsense.
   */
  readonly encoding?: TextEncoding;
  /**
   * How to draw a `bitmap` region: `char:8`, `bits:3`, `sprite`.
   *
   * One string rather than a format, a stride and a column count, because each
   * of those would need threading through the schema, the serializer, the CRDT
   * assignment, the op, the diff, the inverse and four signatures. It also
   * leaves room for `snippet:<id>` without doing that again.
   */
  readonly view?: string;
}

/** Create a user-defined region */
export function createUserRegion(region: {
  id: string;
  start: number;
  end: number;
  kind: RegionKind;
  name?: string;
  comment?: string;
  encoding?: TextEncoding;
  view?: string;
}): Region {
  const { id, start, end, kind, name, comment, encoding, view } = region;
  return { id, start, end, kind, name, comment, encoding, view };
}

/**
 * The regions declared inside a single layer.
 *
 * Nesting is resolved smallest-first, so carving a small `text` span out of a
 * larger `data` region works without deleting or splitting the outer one. There
 * is no source priority to arbitrate: a layer's default kind is a property of
 * the layer, not a competing region, so anything in here is user intent.
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

  /** The innermost region containing an address, or undefined if none does. */
  getRegionAt(address: number): Region | undefined {
    let best: Region | undefined;

    for (const region of this.regions) {
      if (address >= region.start && address < region.end) {
        if (!best || region.end - region.start < best.end - best.start) {
          best = region;
        }
      }
    }

    return best;
  }

  /**
   * Kind at an address, or undefined if no region covers it.
   *
   * Undefined genuinely means "not declared here" — a bare index has no layer
   * default to fall back to. `MemoryMap.getKindAt` supplies that.
   */
  getKindAt(address: number): RegionKind | undefined {
    return this.getRegionAt(address)?.kind;
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
        // Derived from the region's own id so the label is stable across loads.
        labels.push(
          createRegionLabel(
            derivedId("lbl", region.id, "name"),
            region.start,
            region.name,
            type,
            region.name
          )
        );
      }
    }

    return labels;
  }
}
