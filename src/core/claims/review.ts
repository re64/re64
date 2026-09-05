/**
 * Where the claims and the decode graph disagree.
 *
 * Kept apart from `set.ts`, which knows nothing about any analysis, because these
 * findings need both halves: a claim about what bytes are, and a walk that says
 * control arrives at them anyway.
 *
 * The old model could not hold this disagreement, so it *resolved* it — the walk
 * refused to enter a non-code region, which meant a claim about bytes could stop
 * a jump. On the reference project that silently deleted a 32-instruction named
 * routine which an explicit `JMP` targets. Here both statements stand and the
 * conflict is the output.
 */

import { DecodeGraph } from "./graph.js";
import { Reachability } from "./reach.js";
import { ClaimSet, PlacedClaim } from "./set.js";
import { claimEnd } from "./model.js";
import { OPERAND_TOLERANCE } from "./set.js";

export type Finding =
  | {
      /** Control reaches an address somebody declared is not instructions. */
      readonly kind: "codeInClaim";
      readonly address: number;
      readonly claim: PlacedClaim;
      /** How many instructions of the run sit inside the claim. */
      readonly instructions: number;
      /** Whether anything jumps here, as opposed to falling through. */
      readonly targeted: boolean;
    }
  | {
      /** A claim nothing reaches and nothing roots: it renders nowhere. */
      readonly kind: "unreached";
      readonly claim: PlacedClaim;
    }
  | {
      /** Bytes with no claim that nothing reaches either. */
      readonly kind: "unexplained";
      readonly start: number;
      readonly end: number;
    };

export function describeFinding(f: Finding): string {
  switch (f.kind) {
    case "codeInClaim":
      return (
        `$${f.address.toString(16).toUpperCase()}: ${f.instructions} instruction(s) decode here and ` +
        `${f.targeted ? "something jumps here" : "control falls through"}, ` +
        `inside ${f.claim.name ?? "a claim"} declared ${f.claim.says!.is} by ${f.claim.by.author}`
      );
    case "unreached":
      return `${f.claim.name ?? `$${f.claim.at.toString(16).toUpperCase()}`}: nothing reaches this claim and nothing roots it, so it renders nowhere`;
    case "unexplained":
      return `$${f.start.toString(16).toUpperCase()}-$${f.end.toString(16).toUpperCase()}: no claim, and nothing reaches it`;
  }
}

/**
 * Reachable code sitting inside a claim that says the bytes are not code.
 *
 * Reported per *run* rather than per address, because a claim swallowing thirty
 * consecutive instructions is one problem and not thirty. `targeted` separates
 * the two causes that a single warning used to conflate: falling into a table is
 * usually the decode being wrong, and something jumping here is usually the
 * claim being wrong.
 */
export function codeInsideClaims(
  graph: DecodeGraph,
  reach: Reachability,
  set: ClaimSet
): Finding[] {
  const found: Finding[] = [];
  const reached = [...reach.code].sort((a, b) => a - b);
  const consumed = new Set<number>();

  for (const address of reached) {
    if (consumed.has(address)) continue;
    const claim = set.interpretationsAt(address).find((c) => c.says!.is !== "jumptable");
    if (!claim) continue;

    // Walk the run forward while it stays inside this claim.
    let count = 0;
    let at = address;
    while (at < claimEnd(claim) && reach.code.has(at)) {
      consumed.add(at);
      count++;
      const size = graph.size(at);
      if (size === 0) break;
      at += size;
    }

    found.push({
      kind: "codeInClaim",
      address,
      claim,
      instructions: count,
      targeted: [...reach.code].some((from) => graph.transferTo(from) === address),
    });
  }
  return found;
}

/**
 * Claims nothing reaches and nothing roots.
 *
 * Under operand reachability a data claim is surfaced because code names it, so
 * one that renders nowhere is a real finding rather than a fact of life: either
 * something reaches it in a way the walk cannot see, or it wants an explicit
 * root. This is what makes "root it" a deliberate act instead of a side effect of
 * a region happening to cover the bytes.
 */
export function unreachedClaims(reach: Reachability, set: ClaimSet): Finding[] {
  const found: Finding[] = [];
  const unreached: PlacedClaim[] = [];
  for (const claim of set.all()) {
    if (claim.root !== undefined) continue;
    if (claim.says === undefined) continue;
    let touched = false;
    // From one byte before the claim: `LDA table-1,X` names the byte in front of
    // a 1-indexed table, and without the window every such table looks dead.
    for (let a = claim.at - OPERAND_TOLERANCE; a < claimEnd(claim); a++) {
      if (reach.data.has(a) || reach.code.has(a)) {
        touched = true;
        break;
      }
    }
    if (!touched) unreached.push(claim);
  }

  // Report at the coarsest unit that explains the finding. `zoneDataTable` is one
  // unreferenced 8K span holding 46 nested strings, and saying so 47 times is a
  // list nobody reads — the same lesson as coalescing disagreements per overlap
  // and swallowed instructions per run. Three times now, which is the argument
  // for it being a rule rather than three fixes.
  const outermost = unreached.filter(
    (claim) =>
      !unreached.some(
        (other) =>
          other.id !== claim.id &&
          other.at <= claim.at &&
          claimEnd(claim) <= claimEnd(other) &&
          claimEnd(other) - other.at > claimEnd(claim) - claim.at
      )
  );
  for (const claim of outermost) found.push({ kind: "unreached", claim });
  return found;
}
