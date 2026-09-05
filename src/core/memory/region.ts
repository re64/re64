import { Claim, Interpretation } from "../claims/model.js";

/**
 * What a layer assumes its bytes are, where no claim says otherwise.
 *
 * A property of the layer rather than a competing claim: a PRG holds a program,
 * a raw file holds data, and a symbols layer holds nothing at all. Nobody
 * decided these — they follow from what the file *is*.
 *
 * Deliberately not `Interpretation["is"]`, and the two members that cannot
 * appear there are why this is its own type. `code` is what bytes are when
 * nobody has said otherwise, so it is never something a claim says; `unknown`
 * is the absence of any statement, which a claim cannot be. They shared a union
 * with the interpretations for as long as regions were their own object, and
 * separating them is what makes an exhaustive switch over an interpretation
 * mean something.
 */
export type LayerDefault = "code" | "data" | "unknown";

/**
 * How to read the bytes at an address, all things considered.
 *
 * The union of what a claim said and what the layer assumes — honest as an
 * *answer*, where it was dishonest as a field type. That is the whole of the
 * split: asking "how do I read this byte" may legitimately come back "as code,
 * because nobody said otherwise", while a claim can never *say* `code`.
 */
export type ByteReading = Interpretation["is"] | LayerDefault;

/**
 * A layer's claims, indexed for lookup by address.
 *
 * This was `RegionIndex` over a parallel `Region` record, and the record went
 * for the reason `Label`'s did: a claim carries an id, a position, an extent,
 * an interpretation and a name, so a second structure holding the same fields
 * had nothing to add but a chance to disagree.
 *
 * Nesting resolves smallest-first, so carving a small `text` span out of a
 * larger `data` one works without deleting or splitting the outer. There is no
 * source priority to arbitrate: a layer's default is a property of the layer,
 * not a competing claim, so everything in here is somebody's statement.
 */
export class RegionIndex {
  private claims: Claim[] = [];

  addRegion(claim: Claim): void {
    this.claims.push(claim);
  }

  addRegions(claims: readonly Claim[]): void {
    for (const claim of claims) this.addRegion(claim);
  }

  /** The innermost claim covering an address, or undefined if none does. */
  getRegionAt(address: number): Claim | undefined {
    let best: Claim | undefined;

    for (const claim of this.claims) {
      const span = claim.extent ?? 1;
      if (address >= claim.at && address < claim.at + span) {
        if (!best || span < (best.extent ?? 1)) best = claim;
      }
    }

    return best;
  }

  /**
   * What a claim says these bytes are, or undefined if none covers the address.
   *
   * Undefined genuinely means "nothing declared here" — a bare index has no
   * layer default to fall back to. `MemoryMap.getKindAt` supplies that.
   */
  getKindAt(address: number): Interpretation["is"] | undefined {
    return this.getRegionAt(address)?.says?.is;
  }

  /** Every claim in this layer, by position. */
  getAllRegions(): readonly Claim[] {
    return [...this.claims].sort((a, b) => a.at - b.at);
  }

  /** Every claim reading its bytes a particular way. */
  getRegionsByKind(is: Interpretation["is"]): readonly Claim[] {
    return this.claims.filter((c) => c.says?.is === is);
  }

  /** Jump tables, whose entries are each an address the program reaches. */
  getJumptables(): readonly Claim[] {
    return this.getRegionsByKind("jumptable");
  }

  get size(): number {
    return this.claims.length;
  }
}
