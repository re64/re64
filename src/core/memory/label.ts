/** Label types - "entry" for entry points, "address" for general labels */
export type LabelType = "entry" | "address";

/** Source of a label - where it came from */
export interface LabelSource {
  /** Kind of source: "layer" for layer-generated, "user" for user-defined, "region" for region-generated */
  kind: "layer" | "user" | "region";
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
}
