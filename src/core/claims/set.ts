/**
 * A queryable set of claims, with nothing resolved.
 *
 * Every read returns *all* the claims that answer it, in `compareClaims` order.
 * That is the whole difference from `RegionIndex`, whose `getRegionAt` returned
 * the smallest covering region — a view decision living in the data, and the
 * mechanism by which two agents disagreeing about a span produced one silent
 * winner and no record that anybody disagreed.
 *
 * Picking is still necessary — an operand substitutes exactly one name, a listing
 * row renders one way — but it happens in a *named* function a consumer calls,
 * where the choice is visible and can differ per consumer.
 */

import { Claim, RootKind, compareClaims, covers, claimEnd } from "./model.js";
import { EvidenceKind } from "../project/project.js";

/**
 * Where a target puts a layer's bytes.
 *
 * A layer may be placed more than once: Revenge of the Mutant Camels relocates
 * its decruncher onto the stack page and jumps to the copy, so one set of bytes
 * is genuinely at two addresses, and a layer-relative claim resolves to both.
 */
export interface LayerPlacement {
  readonly layer: string;
  /** Absolute address of the first placed byte. */
  readonly base: number;
  /** How many bytes are placed. */
  readonly length: number;
  /** Which byte of the layer `base` corresponds to. Default 0. */
  readonly from?: number;
}

/** A claim resolved to an absolute address, remembering where it came from. */
export interface PlacedClaim extends Claim {
  /** The claim as authored, when this one was resolved through a placement. */
  readonly relativeTo?: { readonly layer: string; readonly offset: number };
}

export class ClaimSet {
  private readonly claims: readonly PlacedClaim[];
  private readonly byId: ReadonlyMap<string, PlacedClaim>;

  constructor(claims: readonly PlacedClaim[]) {
    this.claims = [...claims].sort(compareClaims);
    this.byId = new Map(this.claims.map((c) => [c.id, c]));
  }

  /**
   * Resolve layer-relative claims through a target's placements.
   *
   * Absolute claims pass through untouched. A relative claim whose layer this
   * target does not load simply does not appear — which is how annotations
   * follow a view without the old rule that made them *belong* to a layer, and
   * with it the whole symbols-layer apparatus that existed only to give an
   * annotation an owner.
   */
  static place(claims: readonly Claim[], placements: readonly LayerPlacement[]): ClaimSet {
    const out: PlacedClaim[] = [];
    for (const claim of claims) {
      if (claim.frame?.space !== "layer") {
        out.push(claim);
        continue;
      }
      const layer = claim.frame.layer;
      for (const placement of placements) {
        if (placement.layer !== layer) continue;
        const offset = claim.at - (placement.from ?? 0);
        if (offset < 0 || offset >= placement.length) continue;
        out.push({
          ...claim,
          // Ids must stay distinct when one claim resolves twice, or the second
          // placement would silently replace the first in every id-keyed map.
          id: `${claim.id}@${placement.base.toString(16)}`,
          at: placement.base + offset,
          frame: { space: "address" },
          relativeTo: { layer, offset: claim.at },
        });
      }
    }
    return new ClaimSet(out);
  }

  get size(): number {
    return this.claims.length;
  }

  all(): readonly PlacedClaim[] {
    return this.claims;
  }

  get(id: string): PlacedClaim | undefined {
    return this.byId.get(id);
  }

  /** Every claim whose span includes this address. Narrowest first. */
  covering(address: number): PlacedClaim[] {
    return this.claims.filter((c) => covers(c, address));
  }

  /** Every claim positioned exactly here, whatever its extent. */
  startingAt(address: number): PlacedClaim[] {
    return this.claims.filter((c) => c.at === address);
  }

  /** Every claim that says what its bytes are, covering this address. */
  interpretationsAt(address: number): PlacedClaim[] {
    return this.covering(address).filter((c) => c.says !== undefined);
  }

  /** Every name reaching this address, including from inside an extent. */
  namesAt(address: number): PlacedClaim[] {
    return this.covering(address).filter((c) => c.name !== undefined);
  }

  roots(kinds?: readonly RootKind[]): PlacedClaim[] {
    return this.claims.filter(
      (c) => c.root !== undefined && (kinds === undefined || kinds.includes(c.root))
    );
  }

  /** Claims sharing a name, keyed by name. Only names somebody chose. */
  sharedNames(): Map<string, PlacedClaim[]> {
    const byName = new Map<string, PlacedClaim[]>();
    for (const claim of this.claims) {
      if (claim.name === undefined || claim.origin !== "user") continue;
      const list = byName.get(claim.name);
      if (list) list.push(claim);
      else byName.set(claim.name, [claim]);
    }
    for (const [name, list] of byName) {
      if (list.length < 2) byName.delete(name);
    }
    return byName;
  }
}

/**
 * Pick one interpretation for a consumer that can only render one.
 *
 * Narrowest wins, which is the rule the old model had — but it is *here*, in a
 * function with a name, taking the whole candidate list, so a caller that wants
 * to show a disagreement instead of resolving it simply does not call this.
 */
export function narrowest(candidates: readonly PlacedClaim[]): PlacedClaim | undefined {
  return candidates.find((c) => c.says !== undefined);
}

/**
 * What two claims disagree about at one address.
 *
 * `interpretation` is two people saying the bytes are different things.
 * `rootInData` is somebody saying "decode from here" inside somebody else's
 * "these are not instructions" — the shape that silently deleted a named routine
 * from the reference project, because a claim about bytes was allowed to stop a
 * jump.
 */
export type Disagreement =
  | {
      readonly kind: "interpretation";
      readonly address: number;
      /** One past the last contested byte. */
      readonly end: number;
      readonly claims: readonly PlacedClaim[];
    }
  | {
      readonly kind: "rootInData";
      readonly address: number;
      readonly root: PlacedClaim;
      readonly data: PlacedClaim;
    }
  | {
      readonly kind: "nameShared";
      readonly name: string;
      readonly claims: readonly PlacedClaim[];
    }
  /**
   * A contradiction somebody *declared*, rather than one the bytes imply.
   *
   * Everything above is geometric — claims covering the same address, a root
   * inside somebody's data. That finds a whole class and misses another, and
   * experiment-0's two real disagreements were both in the class it misses:
   * `$8DF9` holding `$3B` refutes a claim about the *glyph* `$3B`, which lives
   * somewhere else entirely and overlaps nothing.
   */
  | {
      readonly kind: "declared";
      readonly evidence: string;
      readonly claim: PlacedClaim;
      readonly other?: PlacedClaim;
      readonly note?: string;
      /**
       * Who said so, taken from the evidence rather than from the claim.
       *
       * The inferred findings above carry no author on purpose: a claim is a
       * statement and no longer records who made it, because that belongs to
       * the vouching. Here there *is* a vouching — that is what "declared"
       * means — so the name is available and worth printing.
       */
      readonly author?: string;
    };

/**
 * How far before a claim an operand may point and still be reaching it.
 *
 * `LDA table-1,X` with X starting at 1 is the standard 1-indexed table idiom, so
 * the operand names the byte *before* the claim. Without this window every such
 * table reports as unreferenced: on the reference project it hid `copyrightLine`,
 * `txtBattleStations` and `screenHeaderColors`, each missed by exactly one byte.
 *
 * It is the same +/-1 the label resolver already applies, and for the same
 * reason — which is the argument for the constant being shared rather than for
 * the window being widened.
 */
export const OPERAND_TOLERANCE = 1;

/**
 * Does one of these claims sit strictly inside the other?
 *
 * Nesting is refinement, not contradiction: "this 8K block is the zone table"
 * and "these 40 bytes inside it are text" are both true, and the model was
 * changed to nest rather than replace precisely so they could both stand.
 * Reporting it would make the ordinary way of working look like a fault.
 *
 * What *is* a contradiction is an overlap neither claim contains — two people
 * drawing boundaries that clash — and an identical span read two ways, where
 * neither refines anything. On the project three agents built, that rule takes
 * 44 interpretation findings down to one, and the one is real: a sprite set and
 * a tune stream disagreeing about six bytes.
 */
function refines(a: PlacedClaim, b: PlacedClaim): boolean {
  const aEnd = claimEnd(a);
  const bEnd = claimEnd(b);
  if (a.at === b.at && aEnd === bEnd) return false;
  return (b.at <= a.at && aEnd <= bEnd) || (a.at <= b.at && bEnd <= aEnd);
}

/**
 * Every disagreement the claim set contains, without reference to any analysis.
 *
 * Deliberately reported rather than prevented. Two writers producing a document
 * that contradicts itself is the expected outcome of conflict-free merge, not a
 * bug to be engineered out at the point of writing — and a disagreement that is
 * visible is one somebody settles, where a silent winner is one nobody knows
 * about.
 *
 * Reported per *overlap*, never per address. A first version walked byte by byte
 * and turned one span two people read differently into 1,832 findings on the
 * project experiment 7 produced — the same mistake as reporting thirty swallowed
 * instructions as thirty problems, which is a list nobody reads.
 */
export function disagreements(
  set: ClaimSet,
  /**
   * Refutations somebody wrote down.
   *
   * Passed in rather than held by the set, because a `ClaimSet` is claims and
   * evidence is a different root — and because the sweep below is on the read
   * path and must not grow a second index it does not need.
   */
  declared: readonly {
    id?: string;
    claim: string;
    kind: string;
    other?: string;
    note?: string;
    author?: string;
  }[] = []
): Disagreement[] {
  const found: Disagreement[] = [];

  // Declared first: somebody saying "this is wrong, and here is why" outranks
  // anything inferred from where the bytes happen to sit.
  //
  // **Every kind is decided here, and the `never` is what makes that true.**
  // This read `if (item.kind !== "refutes") continue;`, so `supports` reached no
  // reader at all — and `supersedes`, which used to be a third member, reached
  // none either. That one was removed rather than wired up: it stored an
  // ordering, and an ordering is what a conflict-free merge cannot supply.
  const byId = new Map(set.all().map((c) => [c.id, c]));
  for (const item of declared) {
    const claim = byId.get(item.claim);
    if (!claim) continue;
    const other = item.other === undefined ? undefined : byId.get(item.other);

    const kind = item.kind as EvidenceKind;
    switch (kind) {
      case "refutes":
        found.push({
          kind: "declared",
          evidence: item.id ?? "",
          claim,
          ...(other ? { other } : {}),
          ...(item.note === undefined ? {} : { note: item.note }),
          ...(item.author === undefined ? {} : { author: item.author }),
        });
        break;

      // Backing, not conflict. Two of these by different authors reaching a
      // claim different ways is an independent confirmation, which is the fact
      // the provenance shape exists to make sayable — but it is not a
      // disagreement, and nothing here reports it.
      case "supports":
        break;

      default: {
        const unhandled: never = kind;
        throw new Error(`unhandled evidence kind: ${String(unhandled)}`);
      }
    }
  }

  for (const [name, claims] of set.sharedNames()) {
    const addresses = new Set(claims.map((c) => c.at));
    // One name at one address is duplication and renders fine; one name reaching
    // two addresses makes every operand carrying it ambiguous.
    if (addresses.size > 1) found.push({ kind: "nameShared", name, claims });
  }

  // A sweep over claims ordered by start, holding those still open. Pairwise over
  // the whole set would be O(n^2), and this file is on the read path.
  const ordered = set.all().filter((c) => c.says !== undefined || c.root !== undefined);
  const open: PlacedClaim[] = [];
  for (const claim of ordered) {
    for (let i = open.length - 1; i >= 0; i--) {
      if (claimEnd(open[i]) <= claim.at) open.splice(i, 1);
    }
    for (const other of open) {
      const from = claim.at;
      const to = Math.min(claimEnd(claim), claimEnd(other));
      if (to <= from) continue;

      if (
        claim.says &&
        other.says &&
        claim.says.is !== other.says.is &&
        !refines(claim, other)
      ) {
        found.push({ kind: "interpretation", address: from, end: to, claims: [other, claim] });
      }
      // A decode root inside somebody's "these are not instructions". The shape
      // that deleted a named routine from the reference project, because a claim
      // about bytes was allowed to stop a jump.
      if (claim.root !== undefined && claim.root !== "data" && other.says) {
        found.push({ kind: "rootInData", address: claim.at, root: claim, data: other });
      }
      if (other.root !== undefined && other.root !== "data" && claim.says && other.at >= claim.at) {
        found.push({ kind: "rootInData", address: other.at, root: other, data: claim });
      }
    }
    open.push(claim);
  }

  return found;
}

/** Human-readable, for a listing or a tool result. */
export function describeDisagreement(d: Disagreement): string {
  switch (d.kind) {
    case "nameShared":
      return `"${d.name}" names ${new Set(d.claims.map((c) => c.at)).size} addresses: ${d.claims
        .map((c) => `$${c.at.toString(16).toUpperCase()}`)
        .join(", ")}`;
    case "interpretation":
      return (
        `$${d.address.toString(16).toUpperCase()}-$${d.end.toString(16).toUpperCase()} is claimed as ` +
        d.claims.map((c) => c.says!.is).join(" and ")
      );
    case "rootInData":
      return (
        `$${d.address.toString(16).toUpperCase()} is a ${d.root.root} root ` +
        `inside ${d.data.name ?? "a claim"} declared ${d.data.says!.is}`
      );
    case "declared":
      return (
        `${d.author ?? "somebody"} says ${d.other ? `${d.other.id} is wrong` : "this is contradicted"}` +
        `${d.other ? ` — ${d.other.name ?? `the claim at $${d.other.at.toString(16).toUpperCase()}`}` : ""}` +
        `${d.note ? `: ${d.note}` : ""}`
      );
  }
}
