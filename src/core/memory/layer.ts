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

  /** Returns the byte at address, or undefined if outside this layer's range */
  readByte(address: number): number | undefined;
}

/**
 * A layer backed by a byte pattern that can be repeated to fill a range.
 * If length is not specified, the layer is exactly the size of the data.
 * If length is specified, the data is repeated (or truncated) to fill.
 */
export class BytesLayer implements Layer {
  public readonly length: number;

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
}
