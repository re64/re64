/**
 * Label types:
 * - "entry" - explicit entry points (from project file or PRG load)
 * - "function" - subroutine entry points (JSR targets, added to disassembly queue)
 * - "code" - code locations (JMP targets, loops, etc. - added to disassembly queue)
 * - "address" - general named addresses (not queued for disassembly)
 */
export type LabelType = "entry" | "function" | "code" | "address";

/** Source of a label - where it came from */
export interface LabelSource {
  /** Kind of source: "layer" for layer-generated, "user" for user-defined, "region" for region-generated, "platform" for the built-in symbol set, "auto" for disassembler-generated */
  kind: "layer" | "user" | "region" | "platform" | "auto";
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
  /**
   * Stable identity, independent of address and name.
   *
   * Several labels can share an address, and a rename changes the name — so
   * neither can identify one. Edits and the primary-label index name this.
   */
  readonly id: string;
  /** Address in range 0x0000-0x10000 (end-of-memory allowed) */
  readonly address: number;
  /** Label name */
  readonly name: string;
  /** Label type */
  readonly type: LabelType;
  /** Source of this label */
  readonly source: LabelSource;
  /** Optional user comment */
  readonly comment?: string;
}

/**
 * Which label wins when several name the same address.
 *
 * Higher wins. Previously this was insertion order, which silently made a
 * layer's auto entry label beat a user's own name, and would have let the
 * built-in symbol set override a project's chosen names.
 */
export const LABEL_RANK: Record<LabelSource["kind"], number> = {
  user: 4,
  region: 3,
  layer: 2,
  platform: 1,
  auto: 0,
};

/**
 * Which label wins at an address, when several sit there.
 *
 * Order: an explicit primary, then source rank, then id. The last step matters
 * more than it looks — comparing rank alone leaves equal-ranked labels in
 * insertion order, which differs between clients that declared them in
 * different orders, so the same data would resolve to different names. Id is
 * used rather than name because a rename should not silently move the primary.
 */
function compareLabels(a: Label, b: Label, primaryId?: string): number {
  if (primaryId !== undefined) {
    if (a.id === primaryId) return -1;
    if (b.id === primaryId) return 1;
  }
  const rank = LABEL_RANK[b.source.kind] - LABEL_RANK[a.source.kind];
  return rank !== 0 ? rank : a.id.localeCompare(b.id);
}

/** Creates a label from the built-in platform symbol set */
export function createPlatformLabel(
  id: string,
  address: number,
  name: string,
  type: LabelType = "address"
): Label {
  if (address < 0 || address > 0x10000) {
    throw new Error("Label address must be in range 0x0000-0x10000");
  }
  return {
    id,
    address,
    name,
    type,
    source: { kind: "platform", auto: true },
  };
}

/** Creates an auto-generated label from a layer */
export function createLayerLabel(
  id: string,
  address: number,
  name: string,
  type: LabelType,
  layerName: string
): Label {
  if (address < 0 || address > 0x10000) {
    throw new Error("Label address must be in range 0x0000-0x10000");
  }
  return {
    id,
    address,
    name,
    type,
    source: { kind: "layer", layerName, auto: true },
  };
}

/** Creates a user-defined label */
export function createUserLabel(
  id: string,
  address: number,
  name: string,
  type: LabelType,
  comment?: string
): Label {
  if (address < 0 || address > 0x10000) {
    throw new Error("Label address must be in range 0x0000-0x10000");
  }
  return {
    id,
    address,
    name,
    type,
    source: { kind: "user", auto: false },
    comment,
  };
}

/** Creates an auto-generated label from a region boundary */
export function createRegionLabel(
  id: string,
  address: number,
  name: string,
  type: LabelType,
  regionName: string
): Label {
  if (address < 0 || address > 0x10000) {
    throw new Error("Label address must be in range 0x0000-0x10000");
  }
  return {
    id,
    address,
    name,
    type,
    source: { kind: "region", regionName, auto: true },
  };
}

/** Creates an auto-generated label from disassembly analysis */
export function createAutoLabel(
  id: string,
  address: number,
  name: string,
  type: LabelType
): Label {
  if (address < 0 || address > 0x10000) {
    throw new Error("Label address must be in range 0x0000-0x10000");
  }
  return {
    id,
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

  /**
   * Explicit primary label per address, by id.
   *
   * A separate index rather than a flag on each label, so "one primary per
   * address" is a single map entry. Two clients promoting different labels
   * write the same key and converge; a flag on each would leave both true,
   * which is a multi-object invariant nothing could repair.
   *
   * A dangling id — the label was deleted — means no primary, and resolution
   * falls back to rank. That self-heals rather than needing a cleanup pass.
   */
  private primary = new Map<number, string>();

  setPrimaryLabels(primary: ReadonlyMap<number, string>): void {
    this.primary = new Map(primary);
  }

  /** The label id explicitly promoted at an address, if any. */
  primaryAt(address: number): string | undefined {
    return this.primary.get(address);
  }

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

  /** Labels at an address, highest priority first. */
  getLabelsAt(address: number): readonly Label[] {
    const labels = this.byAddress.get(address);
    if (!labels) return [];
    const primaryId = this.primary.get(address);
    return [...labels].sort((a, b) => compareLabels(a, b, primaryId));
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
    // First, try exact match — explicit primary, then rank, then id
    const exact = this.byAddress.get(address);
    if (exact && exact.length > 0) {
      return { label: this.getLabelsAt(address)[0], offset: 0 };
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
