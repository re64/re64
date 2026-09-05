/**
 * A claim: the one noun that labels and regions were two halves of.
 *
 * The old pair had the same identity rule, the same containment semantics and
 * the same resolution — innermost wins — implemented twice, and the split ran
 * along a line the file format drew rather than one the machine does. A label
 * was a claim with no extent; a region was a claim with one. Nothing else
 * distinguished them.
 *
 * Three rules govern this file, and each is a thing the old model could not do:
 *
 * - **Code is never claimed.** A `code` region did three jobs — seed the decode,
 *   not be one of the other kinds, and pick a row strategy — and for the walk it
 *   was indistinguishable from `unknown` and from silence. Code is the default
 *   reading of bytes; what a person declares is a *root* (decode from here) or an
 *   *interpretation* (these bytes are not instructions). Those are separate
 *   fields because they are separate statements, and a claim carrying both would
 *   be the contradiction this model exists to represent rather than to hold.
 * - **Nothing resolves at rest.** `at()` returns every claim, in a stable order,
 *   and picking one is something a *consumer* does with a named function. The old
 *   `getRegionAt` returning the smallest cover was a view decision that had
 *   migrated into the data structure, which is why two agents disagreeing about
 *   a span produced one silent winner.
 * - **Every claim carries who made it.** The reason a collaborator's lens is
 *   foggy and the reason agents overwrite each other are the same reason: the
 *   document recorded conclusions and not who reached them.
 */

import { TextEncoding } from "../c64/text.js";

/**
 * What a claim says the bytes are.
 *
 * There is no `code` member and no `unknown` member, and both absences are the
 * point. Code is what bytes are when nobody has said otherwise, and `unknown` is
 * the absence of a claim rather than a claim of absence — which is what makes
 * "unexplained" a question about the claim set instead of a kind to filter for.
 */
export type Interpretation =
  | { readonly is: "data" }
  // `view` on text as well as bitmap, because a program with its own character
  // set is the ordinary case on this machine and none of the three built-in
  // encodings can read one — so `snippet:<id>` is how such a span is made
  // legible at all. One slot covers "draw these bytes" and "read these bytes",
  // which is why it is one field rather than a decoder slot per kind.
  | { readonly is: "text"; readonly encoding?: TextEncoding; readonly view?: string }
  | { readonly is: "bitmap"; readonly view?: string }
  | { readonly is: "jumptable" }
  /**
   * An array of records, whose layout is a project-level type.
   *
   * Additive rather than absorbing `data`/`text`/`bitmap`: those are what a
   * reader reaches for on the first day, and folding them into a type system
   * would make saying "this is text" require declaring a type first.
   *
   * **How many records is derived**, from `extent / size`. Storing a count
   * would be a third fact that can disagree with the other two — the same
   * reason the equate block is derived and the region tree is derived.
   *
   * A `typeId` nothing declares renders the bytes, exactly as a dangling
   * constant renders the literal: a delete racing a reference heals itself
   * rather than needing a sweep.
   */
  | { readonly is: "record"; readonly typeId: string };

/**
 * Why an address is surfaced regardless of what reaches it.
 *
 * The code roles are the old `LabelType` minus `address`, kept apart on the
 * grounds this project already wrote down: they behave alike only because the
 * disassembler queues all three, and they diverge the moment anything reasons
 * about call graphs.
 *
 * `data` is the new one and it is what an unreferenced sprite sheet needs. Under
 * operand reachability a claim is surfaced because something reaches it, so
 * bytes nothing names have to be rooted explicitly — which makes entry points
 * and "show me this sprite sheet" one list instead of two mechanisms.
 */
export type RootKind = "entry" | "routine" | "location" | "data";

/** Who made a claim, and how much weight it carries. */
export interface Provenance {
  /** A user id, an agent codename, or `cli`. Never resolved on read. */
  readonly author: string;
  /**
   * How the claim arose.
   *
   * `user` is somebody's judgement. The rest are machinery, and the distinction
   * decides hygiene: warning that two invented `dat_XXXX` names collide would be
   * noise on the first day of every project.
   */
  readonly source: "user" | "layer" | "platform" | "auto" | "analysis";
  /** Milliseconds since the epoch, supplied by the caller. */
  readonly when?: number;
  /**
   * How strongly it is meant.
   *
   * A weak commitment is the thing the old model had no way to spell: an agent
   * that thinks a span is probably a sprite sheet had to either assert it and
   * overwrite somebody, or say nothing. Absent means asserted.
   */
  readonly confidence?: "asserted" | "inferred" | "guess";
}

/**
 * Where a claim's position is measured from.
 *
 * Absolute is the ordinary case. A layer-relative claim is a symbol at a section
 * offset: it resolves wherever a target places that layer, so a decruncher that
 * copies itself to the stack page can be annotated once and appear at both
 * addresses — which the address-keyed model cannot express at all.
 */
export type Frame =
  | { readonly space: "address" }
  | { readonly space: "layer"; readonly layer: string };

export interface Claim {
  /**
   * Stable identity, independent of position, name and extent.
   *
   * An address cannot identify a claim, for the reason it could never identify a
   * label: several sit at one address and the whole design depends on that.
   */
  readonly id: string;
  /** Absolute address, or an offset into a layer — see `frame`. */
  readonly at: number;
  /** Absolute unless a layer frame says otherwise. */
  readonly frame?: Frame;
  /**
   * How many bytes this claim covers. Absent means a point.
   *
   * A point claim is a name or a root; an extent claim is what used to be a
   * region. The word "region" survives as shorthand for the second shape, which
   * is all it ever was.
   */
  readonly extent?: number;
  /** What to call it. A claim may be anonymous — an unnamed span of sprite data. */
  readonly name?: string;
  /** What the bytes are. Absent says nothing about them. */
  readonly says?: Interpretation;
  /** Surface this regardless of reachability. */
  readonly root?: RootKind;
  /** What the name means on this machine, where somebody else decided. */
  readonly description?: string;
  readonly by: Provenance;
}

/**
 * The extent an *operand* may render an offset against.
 *
 * Not simply `claim.extent`, and the difference is a bug this project already
 * paid for. `mark_function` used to declare a routine's extent, sharing the field
 * with the one that makes `LDA SCREEN_RAM + $000F,X` render — so declaring a
 * routine turned `BPL loc_8050` into `BPL UpdateExplosion + $0010`, because every
 * branch target inside it started rendering as an offset into its name.
 *
 * The fix then was to stop routines declaring extents at all, since a routine's
 * extent is derived and 20 of 50 in the reference project are not even
 * contiguous. Here the fields are orthogonal — a claim may carry a root *and* an
 * extent — so the constraint has to be stated rather than implied by the shape.
 *
 * A code root's extent, if somebody writes one, is a span to *show*; it is never
 * an array to index into. Only a claim about data offers offsets.
 */
export function arrayExtent(claim: Claim): number | undefined {
  if (claim.root === "entry" || claim.root === "routine" || claim.root === "location") {
    return undefined;
  }
  return claim.extent;
}

/** One past the last byte a claim covers. A point claim covers one address. */
export function claimEnd(claim: Claim): number {
  return claim.at + (claim.extent ?? 1);
}

/** Does the claim cover this address? */
export function covers(claim: Claim, address: number): boolean {
  return address >= claim.at && address < claimEnd(claim);
}

/**
 * A stable total order over claims.
 *
 * Position, then narrowest first, then id. Every peer sorts identically without
 * coordinating, which is what a merged document needs — and unlike the old
 * resolution it *orders* rather than *chooses*, so nothing is discarded by
 * having been sorted.
 */
export function compareClaims(a: Claim, b: Claim): number {
  if (a.at !== b.at) return a.at - b.at;
  const spanA = a.extent ?? 1;
  const spanB = b.extent ?? 1;
  if (spanA !== spanB) return spanA - spanB;
  return a.id.localeCompare(b.id);
}

/**
 * The half-open range a claim covers.
 *
 * A claim carries a position and a count; almost everything that looks at a
 * span wants the pair. Written once here rather than `at + (extent ?? 1)` at
 * every site, which is how an off-by-one gets in.
 */
export function claimSpan(claim: Claim): { start: number; end: number } {
  return { start: claim.at, end: claim.at + (claim.extent ?? 1) };
}
