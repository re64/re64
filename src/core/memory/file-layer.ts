import { Layer } from "./layer.js";
import { Label, createLayerLabel } from "./label.js";
import { RegionIndex, RegionKind } from "./region.js";

/**
 * A layer backed by file data. Preserves the file path for serialization/display.
 * Like BytesLayer, supports optional length for repeat/fill behavior.
 */
export class FileLayer implements Layer {
  public readonly length: number;
  /** Whether this file is a PRG (content is code) */
  public readonly isPrg: boolean;
  /** Whether to suppress auto-generated entry point label */
  public readonly suppressEntry: boolean;
  /** Default region kind - code for PRG, data otherwise */
  public readonly defaultRegionKind: RegionKind;
  public readonly hasBytes = true;
  public readonly regions = new RegionIndex();

  constructor(
    public readonly name: string,
    public readonly path: string,
    public readonly start: number,
    public readonly data: Uint8Array,
    length?: number,
    isPrg: boolean = false,
    suppressEntry: boolean = false
  ) {
    this.isPrg = isPrg;
    this.suppressEntry = suppressEntry;
    this.defaultRegionKind = isPrg ? "code" : "data";
    this.length = length ?? data.length;

    if (data.length === 0) {
      throw new Error("Data must not be empty");
    }
    if (this.length <= 0) {
      throw new Error("Layer length must be positive");
    }
    if (start < 0 || start > 0xffff) {
      throw new Error("Start address must be in range 0x0000-0xFFFF");
    }
    if (start + this.length > 0x10000) {
      throw new Error("Layer exceeds address space");
    }
  }

  get end(): number {
    return this.start + this.length;
  }

  readByte(address: number): number | undefined {
    if (address < this.start || address >= this.end) {
      return undefined;
    }
    const offset = address - this.start;
    return this.data[offset % this.data.length];
  }

  getLabels(): readonly Label[] {
    if (!this.isPrg || this.suppressEntry) {
      return [];
    }
    // PRG files have an entry point at the start address
    const basename = this.path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? this.name;
    return [createLayerLabel(this.start, basename, "entry", this.name)];
  }
}
