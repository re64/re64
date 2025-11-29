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

export abstract class BaseLayer implements Layer {
  constructor(
    public readonly name: string,
    public readonly start: number,
    public readonly length: number
  ) {
    if (length <= 0) {
      throw new Error("Layer length must be positive");
    }
    if (start < 0 || start > 0xffff) {
      throw new Error("Start address must be in range 0x0000-0xFFFF");
    }
    if (start + length > 0x10000) {
      throw new Error("Layer exceeds address space");
    }
  }

  get end(): number {
    return this.start + this.length;
  }

  contains(address: number): boolean {
    return address >= this.start && address < this.end;
  }

  abstract readByte(address: number): number | undefined;
}

export class ConstantLayer extends BaseLayer {
  constructor(
    name: string,
    start: number,
    length: number,
    public readonly value: number
  ) {
    super(name, start, length);
    if (value < 0 || value > 0xff) {
      throw new Error("Constant value must be in range 0x00-0xFF");
    }
  }

  readByte(address: number): number | undefined {
    return this.contains(address) ? this.value : undefined;
  }
}

export class ArrayLayer extends BaseLayer {
  constructor(
    name: string,
    start: number,
    public readonly data: Uint8Array
  ) {
    super(name, start, data.length);
  }

  readByte(address: number): number | undefined {
    if (!this.contains(address)) {
      return undefined;
    }
    return this.data[address - this.start];
  }
}
