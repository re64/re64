/**
 * Label types:
 * - "entry" - explicit entry points (from project file or PRG load)
 * - "function" - subroutine entry points (added to disassembly queue)
 * - "address" - general named addresses (not queued for disassembly)
 */
export type LabelType = "entry" | "function" | "address";

/** Source of a label - where it came from */
export interface LabelSource {
  /** Kind of source: "layer" for layer-generated, "user" for user-defined, "region" for region-generated, "auto" for disassembler-generated */
  kind: "layer" | "user" | "region" | "auto";
  /** Name of the layer that generated this label (if kind is "layer") */
  layerName?: string;
  /** Name of the region that generated this label (if kind is "region") */
  regionName?: string;
  /** Whether this label was auto-generated */
  auto: boolean;
}

/**
 * A label marks an address with a name and type.
 * Address can be 0-$10000 (inclusive) to allow end-of-memory labels.
 */
export interface Label {
  /** Address in range 0x0000-0x10000 (end-of-memory allowed) */
  readonly address: number;
  /** Label name */
  readonly name: string;
  /** Label type */
  readonly type: LabelType;
  /** Source of this label */
  readonly source: LabelSource;
}

/** Creates an auto-generated label from a layer */
export function createLayerLabel(
  address: number,
  name: string,
  type: LabelType,
  layerName: string
): Label {
  if (address < 0 || address > 0x10000) {
    throw new Error("Label address must be in range 0x0000-0x10000");
  }
  return {
    address,
    name,
    type,
    source: { kind: "layer", layerName, auto: true },
  };
}

/** Creates a user-defined label */
export function createUserLabel(
  address: number,
  name: string,
  type: LabelType
): Label {
  if (address < 0 || address > 0x10000) {
    throw new Error("Label address must be in range 0x0000-0x10000");
  }
  return {
    address,
    name,
    type,
    source: { kind: "user", auto: false },
  };
}

/** Creates an auto-generated label from a region boundary */
export function createRegionLabel(
  address: number,
  name: string,
  type: LabelType,
  regionName: string
): Label {
  if (address < 0 || address > 0x10000) {
    throw new Error("Label address must be in range 0x0000-0x10000");
  }
  return {
    address,
    name,
    type,
    source: { kind: "region", regionName, auto: true },
  };
}

/** Creates an auto-generated label from disassembly analysis */
export function createAutoLabel(
  address: number,
  name: string,
  type: LabelType
): Label {
  if (address < 0 || address > 0x10000) {
    throw new Error("Label address must be in range 0x0000-0x10000");
  }
  return {
    address,
    name,
    type,
    source: { kind: "auto", auto: true },
  };
}

/** Result of resolving a label with possible offset */
export interface ResolvedLabel {
  /** The label that was found */
  label: Label;
  /** Offset from the label address (0 for exact match, negative if address < label) */
  offset: number;
}

/**
 * Index for fast label lookup by address.
 * Multiple labels can exist at the same address.
 */
export class LabelIndex {
  private byAddress = new Map<number, Label[]>();
  private all: Label[] = [];

  addLabel(label: Label): void {
    this.all.push(label);
    const existing = this.byAddress.get(label.address);
    if (existing) {
      existing.push(label);
    } else {
      this.byAddress.set(label.address, [label]);
    }
  }

  addLabels(labels: readonly Label[]): void {
    for (const label of labels) {
      this.addLabel(label);
    }
  }

  /** Get all labels at a specific address */
  getLabelsAt(address: number): readonly Label[] {
    return this.byAddress.get(address) ?? [];
  }

  /** Check if there's any label at an address */
  hasLabelAt(address: number): boolean {
    return this.byAddress.has(address);
  }

  /** Get all labels, sorted by address */
  getAllLabels(): readonly Label[] {
    return [...this.all].sort((a, b) => a.address - b.address);
  }

  /** Get all labels in a range (inclusive start, exclusive end) */
  getLabelsInRange(start: number, end: number): readonly Label[] {
    return this.all
      .filter((l) => l.address >= start && l.address < end)
      .sort((a, b) => a.address - b.address);
  }

  /**
   * Resolve an address to a label, allowing for a configurable offset tolerance.
   * Exact matches are always preferred. If no exact match, finds the nearest
   * label within the tolerance range.
   *
   * @param address The address to resolve
   * @param tolerance Maximum offset to consider (default 0 = exact match only)
   * @returns The resolved label with offset, or undefined if no match
   */
  resolve(address: number, tolerance: number = 0): ResolvedLabel | undefined {
    // First, try exact match
    const exact = this.byAddress.get(address);
    if (exact && exact.length > 0) {
      return { label: exact[0], offset: 0 };
    }

    // If no tolerance, we're done
    if (tolerance <= 0) {
      return undefined;
    }

    // Search for nearby labels within tolerance
    // We prefer the smallest absolute offset
    let best: ResolvedLabel | undefined;
    let bestAbsOffset = tolerance + 1;

    for (const label of this.all) {
      const offset = address - label.address;
      const absOffset = Math.abs(offset);

      // Must be within tolerance
      if (absOffset > tolerance) {
        continue;
      }

      // Prefer smaller absolute offset, or if equal, prefer positive offset (label-N)
      // since that's more common in 6502 patterns
      if (
        absOffset < bestAbsOffset ||
        (absOffset === bestAbsOffset && offset < 0 && best && best.offset >= 0)
      ) {
        best = { label, offset };
        bestAbsOffset = absOffset;
      }
    }

    return best;
  }
}
