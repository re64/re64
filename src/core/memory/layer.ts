import { Label } from "./label.js";
import { Region, RegionIndex, RegionKind } from "./region.js";

/**
 * A memory layer maps a contiguous address range to byte values.
 * Layers are stacked in a MemoryMap, with upper layers shadowing lower ones.
 */
export interface Layer {
  readonly name: string;
  /** Start address (inclusive) */
  readonly start: number;
  /** End address (exclusive) */
  readonly end: number;
  /** Default region kind for this layer's content */
  readonly defaultRegionKind: RegionKind;
  /**
   * Whether this layer supplies bytes. False for symbol layers, which carry
   * names only and are excluded from the map's address range.
   */
  readonly hasBytes: boolean;
  /**
   * Regions declared inside this layer.
   *
   * Owned by the layer rather than the address space, so reordering the stack
   * moves them with the bytes they describe.
   */
  readonly regions: RegionIndex;

  /**
   * User labels owned by this layer. Like regions, they travel with the layer
   * when the stack is reordered.
   */
  readonly labels: Label[];

  /** Returns the byte at address, or undefined if outside this layer's range */
  readByte(address: number): number | undefined;

  /** Layer-generated labels (e.g. PRG entry points) plus its owned labels */
  getLabels(): readonly Label[];
}

/**
 * The innermost declared region at an address, or undefined when the address
 * falls outside the layer or no region overrides the layer default there.
 */
export function layerRegionAt(layer: Layer, address: number): Region | undefined {
  if (address < layer.start || address >= layer.end) {
    return undefined;
  }
  return layer.regions.getRegionAt(address);
}

/**
 * The effective region kind at an address, falling back to the layer default.
 * Undefined outside the layer's range.
 */
export function layerKindAt(layer: Layer, address: number): RegionKind | undefined {
  if (address < layer.start || address >= layer.end) {
    return undefined;
  }
  return layer.regions.getRegionAt(address)?.kind ?? layer.defaultRegionKind;
}

/**
 * A layer backed by a byte pattern that can be repeated to fill a range.
 * If length is not specified, the layer is exactly the size of the data.
 * If length is specified, the data is repeated (or truncated) to fill.
 */
export class BytesLayer implements Layer {
  public readonly length: number;
  public readonly defaultRegionKind: RegionKind = "data";
  public readonly hasBytes = true;
  public readonly regions = new RegionIndex();
  public readonly labels: Label[] = [];

  constructor(
    public readonly name: string,
    public readonly start: number,
    public readonly data: Uint8Array,
    length?: number
  ) {
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
    return this.labels;
  }
}
