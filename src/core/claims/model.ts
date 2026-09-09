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
/**
 * How somebody came to believe a claim.
 *
 * Ordered roughly by how much independent checking each represents, but the
 * ordering is not the point — *difference* is. Two accounts reached by the same
 * method are one account.
 */
export type ClaimMethod =
  /** A hypothesis. Worth recording, and not yet evidence of anything. */
  | "guessed"
  /** Copied by hand from a listing, a book, or another project. */
  | "transcribed"
  /** Reasoned from the code by a person or an agent reading it. */
  | "read"
  /** Computed by an analysis pass here, so it is as good as that pass. */
  | "derived"
  /** Watched happening in the machine. */
  | "ran";

/**
 * What kind of thing a claim is: machinery, or somebody's judgement.
 *
 * Intrinsic to the claim and therefore the one part of the old `by` that stayed
 * on it. `user` is a person or an agent deciding something; the rest are
 * generated, and the distinction decides hygiene — warning that two invented
 * `dat_XXXX` names collide would be noise on the first day of every project.
 * Camels' seeded document has 383 platform names and 472 automatic ones against
 * none by hand, which is the scale that makes the gate matter.
 */
export type ClaimOrigin = "user" | "layer" | "platform" | "auto" | "analysis";

/**
 * Who vouched for something, and how they know.
 *
 * **This belongs to an act of vouching, not to the thing vouched for**, which is
 * why it lives on evidence rather than on a claim. A claim carrying its own
 * author cannot be shared: two readers reaching the same finding produce two
 * claims, and merging them would erase one of them. Four runs on Camels
 * independently re-derived the zone table, the cheat, the IRQ handler and the
 * high-score file — that is one finding with four accounts, and the old shape
 * could only say it as four findings.
 *
 * The same category error this project already fixed once, when labels and
 * regions turned out to be two halves of one noun.
 */
export interface Provenance {
  /** A user id, an agent codename, or `cli`. Never resolved on read. */
  readonly author: string;
  /** Milliseconds since the epoch, supplied by the caller. */
  readonly when?: number;
  /**
   * **How the claimer knows** — the method, not the strength.
   *
   * This was `confidence: asserted | inferred | guess`, and it was on the wrong
   * axis. Experiment-0 settled it: neither agent asked for strength, both asked
   * for method, and one of them said exactly why —
   *
   * > *"Agreement between two accounts is only evidence when the methods
   * > differ, and nothing in either document records **method** at claim
   * > granularity, so there is no way to tell an independent confirmation from
   * > a correlated one."*
   *
   * That is not abstract. Both agents concluded glyphs `$03`/`$04` were never
   * drawn, both were wrong, and the refutation was in one of their own screen
   * dumps — they agreed because they used the *same* static reasoning and shared
   * its blind spot. A confidence number cannot detect that. A method can.
   *
   * `transcribed` earns its place separately: it is the category both agents'
   * own trust ledgers lacked, and the one that *"generated most of the errors on
   * both sides"* — a fact copied by hand from a listing carries that listing's
   * mistakes and none of its own checking.
   *
   * Absent means unstated, which is honest for the many claims nobody thought
   * about. See `docs/invariants.md` **E10**.
   */
  readonly method?: ClaimMethod;
}

/**
 * Where a claim's position is measured from.
 *
 * Absolute is the ordinary case. A layer-relative claim is a symbol at a section
 * offset: it resolves wherever a target places that layer, so a decruncher that
 * copies itself to the stack page can be annotated once and appear at both
 * addresses — which the address-keyed model cannot express at all.
 */
/**
 * What a claim belongs to. A claim is never global.
 *
 * `layer` is the common one and the only relocatable one: the claim is stored
 * as an **offset into that layer's bytes**, so relinking the layer somewhere
 * else moves the claim with it by arithmetic rather than by promise. The
 * alternative — absolute against a remembered default — fails the offline test,
 * because editing that default while somebody else names an address offline
 * silently repoints their claim after the merge.
 *
 * `target` is for what a layer cannot own: zero-page variables, I/O registers,
 * anything about an address no layer supplies. Absolute, because a target *is*
 * an address space.
 *
 * `address` is the machine — the built-in C64 table and nothing else. A project
 * claim never has it: naming `$D020` `borderDuringExplosion` is not amending
 * the machine definition, it is saying what this program does with the
 * register, which is a fact about the arrangement.
 */
export type Frame =
  | { readonly space: "address" }
  | { readonly space: "layer"; readonly layer: string }
  /**
   * A fact about one arrangement of the stack — zero page, a hardware register.
   *
   * **`target` is a target *id*, never a name.** A name is a field somebody
   * chose and may change; storing one here made renaming a target orphan every
   * claim framed on it, silently, and admitted two targets that could not be
   * told apart. Names are accepted at the API as aliases and resolved at the
   * boundary; what reaches the document is an id, like every other reference in
   * it.
   */
  | { readonly space: "target"; readonly target: string };

export interface Claim {
  /**
   * Stable identity, independent of position, name and extent.
   *
   * An address cannot identify a claim, for the reason it could never identify a
   * label: several sit at one address and the whole design depends on that.
   */
  readonly id: string;
  /**
   * **Absolute, always, in the domain.**
   *
   * The file and the document store a layer-framed claim's position as an
   * offset instead, and the loader is the one place that adds the layer's start
   * back. Writers go the other way with `storedAt`. Everything between those
   * two boundaries — the row builder, the analysis, every tool answer — sees
   * one kind of number, which is the same split the file already has between
   * `"$8400"` and `33792`.
   */
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
  /**
   * Machinery or judgement — see `ClaimOrigin`.
   *
   * All that remains of the old `by`. Who said it and how they know moved to
   * the evidence that says so, because those describe an act and this describes
   * the object.
   */
  readonly origin: ClaimOrigin;
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

/**
 * Where a claim about this address belongs, and what to store for it.
 *
 * Derived, never chosen. The topmost layer supplying the byte, else the target.
 * It is total, so no write can fail on it — and there is deliberately no way
 * for a caller to override it, because the only thing an override could reach
 * is binding a claim to a layer that does *not* supply its bytes, which is
 * exactly the bug layer ownership exists to prevent.
 */
export function scopeFor(
  address: number,
  owner: { id: string; start: number } | undefined,
  /** The **id** of the target being read, where the project declares any. */
  target: string | undefined
): { frame: Frame; at: number } {
  if (owner) {
    return { frame: { space: "layer", layer: owner.id }, at: address - owner.start };
  }
  // No layer supplies it, so it is a fact about this arrangement. With no
  // target selected there is one implicit arrangement and the address space is
  // the whole of it.
  return target === undefined
    ? { frame: { space: "address" }, at: address }
    : { frame: { space: "target", target }, at: address };
}

/** The absolute address of a stored claim, given where its layer landed. */
export function resolveAt(
  stored: number,
  frame: Frame | undefined,
  layerStart: (id: string) => number | undefined
): number | undefined {
  if (frame?.space !== "layer") return stored;
  const start = layerStart(frame.layer);
  // A claim on a layer this target does not link is not in this view at all —
  // which is the same rule that makes annotations follow linking, said once.
  return start === undefined ? undefined : start + stored;
}

/** How a scope reads to somebody who has to know whether a claim travels. */
export function describeScope(frame: Frame | undefined): string {
  if (frame === undefined || frame.space === "address") return "machine";
  return frame.space === "layer" ? `layer:${frame.layer}` : `target:${frame.target}`;
}
