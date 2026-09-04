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
  /**
   * What this name means, where somebody other than this project decided.
   *
   * Deliberately *not* a `Comment`, and the distinction is the point. A comment
   * is what someone wrote about an address **in this project**; this is what a
   * name means on this **machine**, and it travels with the name rather than
   * with the address. The practical difference: nothing supplies the bytes at
   * `$FFD2` in an ordinary game, so a comment there would render nowhere, while
   * the description is reachable everywhere the name is.
   *
   * It does not reintroduce the field that was removed from labels. That one
   * was the *only* home for a comment, so commenting an instruction meant
   * inventing a name for it; comments are still their own objects and still
   * reach any address. This carries documentation for names the project did not
   * choose — today the built-in C64 symbol table, which had 382 descriptions
   * that reached no consumer at all.
   */
  readonly description?: string;
  /**
   * How many bytes this name covers, when it names an array rather than a spot.
   *
   * An operand inside the extent renders as `SCREEN_RAM + $000F` instead of a
   * bare address, which is how the reference disassembly reads and what makes a
   * screen coordinate recoverable without hex arithmetic on every line.
   *
   * Extent rather than a wider `labelTolerance`, because tolerance is a
   * distance with no notion of whether the offset means anything: at a window
   * wide enough to reach `$040F` from `$0400`, every address in the program
   * would borrow whatever name happened to be near it. An extent says this
   * operand indexes that array, which is either true or not.
   */
  readonly extent?: number;
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
  type: LabelType = "address",
  description?: string
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
    ...(description === undefined ? {} : { description }),
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
  comment?: string,
  extent?: number
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
    extent,
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
  /**
   * True when the address falls inside the label's declared extent.
   *
   * Rendered differently from a tolerance match, because the two say different
   * things: inside an extent means "element N of this array", a tolerance match
   * means "just before this label", which is the 1-indexed table idiom.
   */
  within?: boolean;
}

/**
 * Index for fast label lookup by address.
 * Multiple labels can exist at the same address.
 */
/**
 * Which label a particular site means.
 *
 * Keyed by the address of the *referring instruction*, not the target: the
 * whole point is that two instructions touching one address can mean different
 * names for it. The label it names knows its own target.
 *
 * One per site, on the same ground as a constant use — the 6502 has one operand
 * per instruction — so there is no slot to disambiguate.
 *
 * Needed for more than nicknames. A C64 program overwrites memory with an
 * overlay and switches banks under a fixed address, so what lives at an address
 * genuinely depends on when and on machine state. This cannot express the
 * differing *bytes* — the row model still gives an address one reading — but it
 * lets each site say which of several names it meant.
 */
export interface LabelUse {
  readonly id: string;
  readonly address: number;
  readonly labelId: string;
}

export function createLabelUse(id: string, address: number, labelId: string): LabelUse {
  return { id, address, labelId };
}

export class LabelIndex {
  /** Ids already held, so overlapping sources do not double-count. */
  private readonly seen = new Set<string>();

  private byAddress = new Map<number, Label[]>();
  private all: Label[] = [];
  /** Site address to label id: what this instruction calls the thing it names. */
  private readonly uses = new Map<number, string>();

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
    // Ignore one already held. The merged index is built from sources that
    // overlap — a layer's labels arrive both through the memory map and
    // directly — and the same label counted twice makes every total wrong.
    if (this.seen.has(label.id)) return;
    this.seen.add(label.id);

    this.all.push(label);
    this.namesCache = undefined;
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

  /**
   * The name to *show* for a label, which is not always the name it holds.
   *
   * Two labels can share a name. In a CRDT that cannot be prevented — peers
   * name things without seeing each other, and a merge brings both in — so the
   * question is not how to refuse a collision but how to render one without
   * lying. And the listing does lie today: with `scoreDigits` at $0410 and at
   * $0413, both render as bare `scoreDigits`, and `scoreDigits+4` means $0414
   * against one and $0417 against the other. A reader cannot tell which.
   *
   * `primaryLabels` does not help here, and it is worth saying why: it picks
   * one name among the labels at *one address*. This is the transpose — one
   * name across *several addresses* — and nothing arbitrated it.
   *
   * So a name is qualified with the label's id when it is shared, leaving the
   * bare name to exactly one holder. The invariant that buys is the one that
   * matters: **every name that appears identifies exactly one label.** Which
   * holder keeps the bare name is decided by `compareLabels` — source rank,
   * then id — the same deterministic rule used for labels at one address, so
   * every peer shows the same thing without coordinating.
   *
   * Derived, never stored. The `.re64` keeps the name somebody chose; this is a
   * rendering decision, like the region tree, and disappears the moment the
   * collision is resolved.
   */
  displayName(label: Label): string {
    return this.ambiguous(label.name) ? `${label.name}@${label.id}` : label.name;
  }

  /**
   * Whether a name points at more than one *address*.
   *
   * Distinct addresses, not merely distinct labels — and the difference is the
   * whole check. Two labels at one address holding one name is duplication:
   * `COLOR_RAM` still identifies $D800, the listing renders the row once, and
   * nothing is ambiguous. The reference project has ten such pairs, so a check
   * that counted them would fire on a healthy project, which is the definition
   * of a check that is really a progress metric.
   *
   * Ambiguity is one name reaching two addresses, because that is when
   * `name+4` stops having an answer.
   */
  private ambiguous(name: string): boolean {
    const held = this.byName().get(name);
    if (!held || held.length < 2) return false;
    return new Set(held.map((l) => l.address)).size > 1;
  }

  /** Every name that points at more than one address, with its holders. */
  collisions(): { name: string; labels: readonly Label[] }[] {
    return [...this.byName()]
      .filter(([name]) => this.ambiguous(name))
      .map(([name, labels]) => ({ name, labels }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Labels by the name they hold, each group in the order display uses. */
  private byName(): Map<string, Label[]> {
    if (this.namesCache) return this.namesCache;
    const names = new Map<string, Label[]>();
    for (const label of this.all) {
      const held = names.get(label.name);
      if (held) held.push(label);
      else names.set(label.name, [label]);
    }
    for (const held of names.values()) held.sort((a, b) => compareLabels(a, b));
    this.namesCache = names;
    return names;
  }

  private namesCache?: Map<string, Label[]>;

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

  /**
   * Labels matching every criterion given.
   *
   * Exists because "which addresses are still auto-named" is the question a
   * reverse engineer actually asks, and answering it used to mean scanning
   * every label and testing its source by hand.
   */
  filter(criteria: {
    source?: LabelSource["kind"];
    type?: LabelType;
    /** Matched against the name, case-insensitively, as a substring. */
    namePattern?: string;
    /** Half-open, as everywhere else. */
    range?: { start: number; end: number };
  }): readonly Label[] {
    const pattern = criteria.namePattern?.toLowerCase();

    return this.getAllLabels().filter((label) => {
      if (criteria.source !== undefined && label.source.kind !== criteria.source) return false;
      if (criteria.type !== undefined && label.type !== criteria.type) return false;
      if (pattern !== undefined && !label.name.toLowerCase().includes(pattern)) return false;
      if (
        criteria.range &&
        (label.address < criteria.range.start || label.address >= criteria.range.end)
      ) {
        return false;
      }
      return true;
    });
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
  /** Record that the operand at `site` means a particular label. */
  bindUse(site: number, labelId: string): void {
    this.uses.set(site, labelId);
  }

  /**
   * The label the operand at this site means, if it says.
   *
   * Undefined when nothing is bound *and* when the binding names a label that
   * no longer exists — a dangling use falls back to the ordinary resolution
   * rather than breaking, so deleting a label needs no sweep over the sites
   * that referred to it.
   */
  labelForSite(site: number): Label | undefined {
    const id = this.uses.get(site);
    if (id === undefined) return undefined;
    return this.all.find((l) => l.id === id);
  }

  /**
   * The innermost label whose declared extent covers this address.
   *
   * Innermost so a nested array wins over the one containing it.
   */
  private containing(address: number): ResolvedLabel | undefined {
    let best: ResolvedLabel | undefined;
    for (const label of this.all) {
      if (label.extent === undefined) continue;
      const offset = address - label.address;
      if (offset <= 0 || offset >= label.extent) continue;
      if (!best || label.extent < best.label.extent!) {
        best = { label, offset, within: true };
      }
    }
    return best;
  }

  resolve(address: number, tolerance: number = 0): ResolvedLabel | undefined {
    // First, try exact match — explicit primary, then rank, then id
    const exact = this.byAddress.get(address);
    if (exact && exact.length > 0) {
      const best = this.getLabelsAt(address)[0];
      // ...unless the only name here is one the disassembler invented and
      // something else says this address is inside a named array. `dat_040F`
      // says nothing; `SCREEN_RAM + $000F` says which screen cell it is. A
      // name a person chose still wins — they named that exact spot on purpose.
      if (best.source.kind !== "auto") return { label: best, offset: 0 };
      const inside = this.containing(address);
      return inside ?? { label: best, offset: 0 };
    }

    const inside = this.containing(address);
    if (inside) return inside;

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
