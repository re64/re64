/**
 * Resolving a name for an address, out of the claims that cover it.
 *
 * This was `LabelIndex` over a parallel `Label` record, and the record is what
 * went: a claim already carries an id, a position, a name, an extent, a
 * provenance and a description, so a second structure holding the same fields
 * had nothing to add but a chance to disagree. What survives is the *index* —
 * the resolution, the extents, the collision rendering, the per-site bindings —
 * because none of that was ever about labels being their own kind of thing.
 *
 * Two comparators, deliberately not merged. `compareClaims` in `model.ts`
 * orders a *listing*: position, then narrowest, then id. This file orders
 * *names at one address*, which is a different question with a different
 * answer — and the ordering below is what a listing's would reduce to if every
 * candidate shared a position, plus the one thing specificity cannot express.
 */

import { Claim, Provenance } from "./model.js";

/**
 * A claim that has a name, which is the only kind this index holds.
 *
 * A claim may be anonymous — an unnamed span of sprite data is perfectly
 * ordinary — so `name` is optional on the model and every reader here would
 * otherwise assert it. `addLabel` refuses an anonymous claim, so stating the
 * guarantee in the type is the honest form of that assertion: made once, where
 * it is enforced, rather than at each of the twenty places that read a name.
 */
export type NamedClaim = Claim & { readonly name: string };
import { LabelType } from "../memory/label-type.js";

/**
 * Which name wins when several cover one address.
 *
 * Higher wins. `region` is gone from this list and its absence is the point: a
 * named region used to generate a label of its own, ranking between `layer` and
 * `user`, and under claims the span *is* the name — one object, so there is
 * nothing to rank against itself. A person's name for an exact address and
 * their name for the array containing it are two claims of equal source, and
 * the tie falls to the narrower one, which is the specific answer.
 *
 * That is why the two rules are ordered source-first and narrowness-second. A
 * built-in `CHROUT` must lose to a project's `ROM_CHROUT` however wide either
 * is, so specificity alone would decide it by id — at random.
 */
export const CLAIM_RANK: Record<Provenance["source"], number> = {
  user: 4,
  analysis: 3,
  layer: 2,
  platform: 1,
  auto: 0,
};

/**
 * The label type a claim's root implies.
 *
 * Kept as a projection rather than a field: the four types are genuinely
 * distinct concepts and the disassembler treats three of them alike only
 * because it queues all three, so the information has to survive somewhere —
 * but `root` is where a claim says it, and a second field would be a second
 * place for it to be wrong.
 */
export function labelTypeOf(claim: Claim): LabelType {
  switch (claim.root) {
    case "entry":
      return "entry";
    case "routine":
      return "function";
    case "location":
      return "code";
    default:
      // `data` roots and no root at all: a name, not a place to decode from.
      return "address";
  }
}

/**
 * Which of several names at one address is shown.
 *
 * Explicit primary first — that is what `primaryLabels` is for, and it is an
 * index rather than a flag precisely so concurrent promotions converge. Then
 * source rank, then the narrower claim, then id. Id, not name, so a rename does
 * not silently move the primary.
 */
function compareForDisplay(a: Claim, b: Claim, primaryId?: string): number {
  if (primaryId !== undefined) {
    if (a.id === primaryId) return -1;
    if (b.id === primaryId) return 1;
  }
  const rank = CLAIM_RANK[b.by.source] - CLAIM_RANK[a.by.source];
  if (rank !== 0) return rank;
  // Narrower is more specific: a name on the exact byte beats the name of the
  // table it sits in, which is what the old `region` rank was really saying.
  const span = (a.extent ?? 1) - (b.extent ?? 1);
  return span !== 0 ? span : a.id.localeCompare(b.id);
}

/** Result of resolving a label with possible offset */
export interface ResolvedName {
  /** The label that was found */
  label: NamedClaim;
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

export class NameIndex {
  /** Ids already held, so overlapping sources do not double-count. */
  private readonly seen = new Set<string>();

  private byAddress = new Map<number, NamedClaim[]>();
  private all: NamedClaim[] = [];
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

  addLabel(label: Claim): void {
    // An anonymous claim is not a name and has no business in a name index —
    // an unnamed span of sprite data is a perfectly ordinary claim, and every
    // count and every resolution here would be wrong if it were counted as one.
    if (label.name === undefined) return;
    const named = label as NamedClaim;
    // Ignore one already held. The merged index is built from sources that
    // overlap — a layer's names arrive both through the memory map and
    // directly — and the same claim counted twice makes every total wrong.
    if (this.seen.has(label.id)) return;
    this.seen.add(label.id);

    this.all.push(named);
    this.namesCache = undefined;
    const existing = this.byAddress.get(label.at);
    if (existing) {
      existing.push(named);
    } else {
      this.byAddress.set(label.at, [named]);
    }
  }

  addLabels(labels: readonly Claim[]): void {
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
   * holder keeps the bare name is decided by `compareForDisplay` — source rank,
   * then id — the same deterministic rule used for labels at one address, so
   * every peer shows the same thing without coordinating.
   *
   * Derived, never stored. The `.re64` keeps the name somebody chose; this is a
   * rendering decision, like the region tree, and disappears the moment the
   * collision is resolved.
   */
  displayName(claim: Claim): string {
    // Anonymous claims are never added, so this is total in practice; the empty
    // string is what an unnamed one would render as if one ever arrived.
    const name = claim.name ?? "";
    return this.ambiguous(name) ? `${name}@${claim.id}` : name;
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
    return new Set(held.map((l) => l.at)).size > 1;
  }

  /** Every name that points at more than one address, with its holders. */
  collisions(): { name: string; labels: readonly NamedClaim[] }[] {
    return [...this.byName()]
      .filter(([name]) => this.ambiguous(name))
      .map(([name, labels]) => ({ name, labels }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Names held twice at one address by labels a person chose.
   *
   * Not ambiguity — the name still reaches exactly one address, which is the
   * distinction the collision check turns on — but the second one **renders
   * nowhere**, because the row builder shows each name at an address once. It is
   * dead weight that looks like work.
   *
   * Only possible since naming became purely additive: the write that would have
   * made one used to refuse. A retry, or a batch re-run after a partial failure,
   * is the ordinary way to end up with one.
   *
   * Restricted to labels a person chose. A layer's entry label named after its
   * file and a region's name are machinery, and the reference project pairs
   * those with user names ten times over without anything being wrong.
   */
  duplicates(): { address: number; name: string; labels: readonly Claim[] }[] {
    const found: { address: number; name: string; labels: readonly NamedClaim[] }[] = [];
    for (const [address, here] of this.byAddress) {
      const byName = new Map<string, NamedClaim[]>();
      for (const label of here) {
        if (label.by.source !== "user") continue;
        // Naming an address and naming the array that starts there are one
        // person saying one thing, and the reference project does it ten times
        // over. Only a bare name repeated is somebody having done the work
        // twice — which is the whole admission rule: this fires where the row
        // builder shows one of them and the other renders nowhere.
        if (label.says !== undefined) continue;
        const held = byName.get(label.name);
        if (held) held.push(label);
        else byName.set(label.name, [label]);
      }
      for (const [name, labels] of byName) {
        if (labels.length > 1) found.push({ address, name, labels });
      }
    }
    return found.sort((a, b) => a.address - b.address || a.name.localeCompare(b.name));
  }

  /** Labels by the name they hold, each group in the order display uses. */
  private byName(): Map<string, NamedClaim[]> {
    if (this.namesCache) return this.namesCache;
    const names = new Map<string, NamedClaim[]>();
    for (const label of this.all) {
      if (label.name === undefined) continue;
      const held = names.get(label.name);
      if (held) held.push(label);
      else names.set(label.name, [label]);
    }
    for (const held of names.values()) held.sort((a, b) => compareForDisplay(a, b));
    this.namesCache = names;
    return names;
  }

  private namesCache?: Map<string, NamedClaim[]>;

  /** Labels at an address, highest priority first. */
  getLabelsAt(address: number): readonly NamedClaim[] {
    const labels = this.byAddress.get(address);
    if (!labels) return [];
    const primaryId = this.primary.get(address);
    return [...labels].sort((a, b) => compareForDisplay(a, b, primaryId));
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
    source?: Provenance["source"];
    type?: LabelType;
    /** Matched against the name, case-insensitively, as a substring. */
    namePattern?: string;
    /** Half-open, as everywhere else. */
    range?: { start: number; end: number };
  }): readonly NamedClaim[] {
    const pattern = criteria.namePattern?.toLowerCase();

    return this.getAllLabels().filter((label) => {
      if (criteria.source !== undefined && label.by.source !== criteria.source) return false;
      if (criteria.type !== undefined && labelTypeOf(label) !== criteria.type) return false;
      if (pattern !== undefined && !(label.name ?? "").toLowerCase().includes(pattern))
        return false;
      if (
        criteria.range &&
        (label.at < criteria.range.start || label.at >= criteria.range.end)
      ) {
        return false;
      }
      return true;
    });
  }

  /** Get all labels, sorted by address */
  getAllLabels(): readonly NamedClaim[] {
    return [...this.all].sort((a, b) => a.at - b.at);
  }

  /** Get all labels in a range (inclusive start, exclusive end) */
  getLabelsInRange(start: number, end: number): readonly NamedClaim[] {
    return this.all
      .filter((l) => l.at >= start && l.at < end)
      .sort((a, b) => a.at - b.at);
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
  labelForSite(site: number): NamedClaim | undefined {
    const id = this.uses.get(site);
    if (id === undefined) return undefined;
    return this.all.find((l) => l.id === id);
  }

  /**
   * The innermost label whose declared extent covers this address.
   *
   * Innermost so a nested array wins over the one containing it.
   */
  private containing(address: number): ResolvedName | undefined {
    // The last byte of an array is the one offset an indexed load never means:
    // there is nothing to index forward into from the final element. One byte
    // before the *next* array, on the other hand, is the 1-indexed table idiom,
    // which is standard on this machine and which the reference disassembly
    // uses — `LDA screenHeaderColors,X` with X from 1 to $28.
    //
    // Both readings are true about the byte and only one is true about the
    // instruction, so where they compete the idiom wins. Merging labels and
    // regions is what made them able to compete at all: a named span now offers
    // offsets, where a region-generated label never carried an extent and so
    // this could not arise.
    if (this.byAddress.has(address + 1)) return undefined;

    let best: ResolvedName | undefined;
    for (const label of this.all) {
      if (label.extent === undefined) continue;
      const offset = address - label.at;
      if (offset <= 0 || offset >= label.extent) continue;
      if (!best || label.extent < best.label.extent!) {
        best = { label, offset, within: true };
      }
    }
    return best;
  }

  resolve(address: number, tolerance: number = 0): ResolvedName | undefined {
    // First, try exact match — explicit primary, then rank, then id
    const exact = this.byAddress.get(address);
    if (exact && exact.length > 0) {
      const best = this.getLabelsAt(address)[0];
      // ...unless the only name here is one the disassembler invented and
      // something else says this address is inside a named array. `dat_040F`
      // says nothing; `SCREEN_RAM + $000F` says which screen cell it is. A
      // name a person chose still wins — they named that exact spot on purpose.
      // ...unless the only name here is one the disassembler invented *and*
      // says nothing. `dat_040F` encodes its own address and no more, so
      // `SCREEN_RAM + $000F` — which says which screen cell — is worth more.
      //
      // An invented `loc_`/`sub_` is different in kind: it says control arrives
      // here, which is a fact about the program that no offset carries. Letting
      // an extent beat one turns `JMP loc_8D16` into
      // `JMP laserFrameRateForLevel + $0020` — a jump into the middle of a
      // table, which is a confident wrong answer about what the program does.
      // A root is exactly the difference: `dat_` has none, the other two do.
      if (best.by.source !== "auto" || best.root !== undefined) {
        return { label: best, offset: 0 };
      }
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
    let best: ResolvedName | undefined;
    let bestAbsOffset = tolerance + 1;

    for (const label of this.all) {
      const offset = address - label.at;
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

/**
 * A name the machine has, rather than one this project chose.
 *
 * The built-in C64 table: 382 addresses that every C64 program shares, plus
 * what each one is for. Its `description` is what a name means on this
 * *machine* and travels with the name — deliberately not a `Comment`, which is
 * what somebody wrote about an address in *this project*. Nothing supplies the
 * bytes at `$FFD2` in an ordinary game, so a comment there would render
 * nowhere, while a description is reachable everywhere the name is.
 */
export function platformClaim(
  id: string,
  at: number,
  name: string,
  type: LabelType = "address",
  description?: string
): Claim {
  return {
    id,
    at: checkedAddress(at),
    name,
    ...rootFor(type),
    ...(description === undefined ? {} : { description }),
    by: { author: "platform", source: "platform" },
  };
}

/** A name a layer brings with it — a PRG's load address, named after its file. */
export function layerClaim(id: string, at: number, name: string, type: LabelType): Claim {
  return {
    id,
    at: checkedAddress(at),
    name,
    ...rootFor(type),
    by: { author: "layer", source: "layer" },
  };
}

/**
 * A name the disassembler invented: `sub_`, `loc_`, `dat_`.
 *
 * Marked `auto` and given a derived id, which is why such a name is reported as
 * unwritable and its id withheld: nothing stored it, and handing one to a
 * caller invites a write carrying an identity nobody owns.
 */
export function autoClaim(id: string, at: number, name: string, type: LabelType): Claim {
  return {
    id,
    at: checkedAddress(at),
    name,
    ...rootFor(type),
    by: { author: "analysis", source: "auto" },
  };
}

/** The root a label type implies, inverse of `labelTypeOf`. */
function rootFor(type: LabelType): { root?: Claim["root"] } {
  switch (type) {
    case "entry":
      return { root: "entry" };
    case "function":
      return { root: "routine" };
    case "code":
      return { root: "location" };
    default:
      // "address" is a name and nothing more, which is a claim with no root.
      return {};
  }
}

function checkedAddress(at: number): number {
  if (at < 0 || at > 0x10000) {
    throw new Error("Claim address must be in range 0x0000-0x10000");
  }
  return at;
}
