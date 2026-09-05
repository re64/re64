/**
 * Laying out claims that disagree, without choosing between them.
 *
 * The parked question — what a listing row does when two interpretations are live
 * at one address — and it has an answer already, in this project, one object
 * along. Overlapping *instructions* were solved by refusing the question:
 *
 * > Which reading is "primary" turned out not to be a question. It looked like a
 * > policy decision — fall-through wins, or the declared entry point wins, or the
 * > longer decode wins — and every candidate was arbitrary. It dissolves instead:
 * > emit **every** block in order of where it starts, and mark any whose start
 * > the walk has already passed.
 *
 * The same rule applies here, and produces the same shape of listing. What it
 * needs on top is the distinction the disagreement report already draws:
 *
 * - **Containment is refinement.** "This 8K span is the zone table" and "these 40
 *   bytes inside it are text" are both true, and the inner one simply renders
 *   inside the outer, which is what the model has always done. It is not an
 *   alternate and must not be marked as one, or the ordinary way of working
 *   would look like a fault 43 times on one project.
 * - **Anything else is a second reading.** A partial overlap, or an identical
 *   span read two ways, is two people disagreeing — so both are emitted, in
 *   start order, and the later one is marked as sharing bytes with what came
 *   before.
 *
 * Deliberately a plan rather than text. What a `bitmap` claim draws and what a
 * `text` claim decodes are the row builder's business; this decides only which
 * claim owns which bytes, and where a second reading begins.
 */

import { claimEnd } from "./model.js";
import { ClaimSet, PlacedClaim } from "./set.js";

export interface ClaimSegment {
  readonly start: number;
  /** One past the last byte. */
  readonly end: number;
  /** Which claim renders these bytes. */
  readonly claim: PlacedClaim;
  /**
   * A second reading of bytes an earlier segment already rendered.
   *
   * Never set for a nested claim, which is a refinement and renders in place.
   */
  readonly alternate: boolean;
  /** What it shares bytes with, when it is a second reading. */
  readonly sharesWith?: PlacedClaim;
}

function refines(inner: PlacedClaim, outer: PlacedClaim): boolean {
  const innerEnd = claimEnd(inner);
  const outerEnd = claimEnd(outer);
  if (inner.at === outer.at && innerEnd === outerEnd) return false;
  return outer.at <= inner.at && innerEnd <= outerEnd;
}

/**
 * Which claim renders each byte, plus the readings that lost.
 *
 * Two passes rather than one, because the primary layout is a question about
 * *addresses* — what renders here — and the alternates are a question about
 * *claims* — did this one get to render at all. Trying to answer both in one
 * walk is what makes a layout algorithm need a tie-break rule.
 */
export function layoutClaims(set: ClaimSet, from: number, to: number): ClaimSegment[] {
  const spans = set.all().filter((c) => c.says !== undefined && claimEnd(c) > from && c.at < to);

  // Pass one: at each address the innermost claim renders, which is the rule
  // `getRegionAt` has always applied — now written where a reader can see it.
  const owner = new Map<number, PlacedClaim>();
  for (let address = from; address < to; address++) {
    let best: PlacedClaim | undefined;
    for (const claim of spans) {
      if (address < claim.at || address >= claimEnd(claim)) continue;
      if (!best) {
        best = claim;
        continue;
      }
      const span = claimEnd(claim) - claim.at;
      const bestSpan = claimEnd(best) - best.at;
      // Narrower wins; ties go to the lower id, so every peer agrees without
      // coordinating and neither writer is privileged by having arrived first.
      if (span < bestSpan || (span === bestSpan && claim.id < best.id)) best = claim;
    }
    if (best) owner.set(address, best);
  }

  const segments: ClaimSegment[] = [];
  let runStart: number | undefined;
  let runClaim: PlacedClaim | undefined;
  for (let address = from; address <= to; address++) {
    const here = address < to ? owner.get(address) : undefined;
    if (here?.id !== runClaim?.id) {
      if (runClaim && runStart !== undefined) {
        segments.push({ start: runStart, end: address, claim: runClaim, alternate: false });
      }
      runStart = address;
      runClaim = here;
    }
  }

  // Pass two: a claim that rendered nowhere is either fully refined by claims
  // inside it, or contradicted by one that is not.
  //
  // Both look identical in pass one — the claim owns no byte — and conflating
  // them would mark an 8K table fully covered by its own entries as a second
  // reading of itself. The test is whose claim took each byte: something that
  // *refines* this one is the model working, and anything else disagrees.
  const rendered = new Set(segments.map((s) => s.claim.id));
  for (const claim of spans) {
    if (rendered.has(claim.id)) continue;

    let sharesWith: PlacedClaim | undefined;
    for (let address = claim.at; address < claimEnd(claim); address++) {
      const took = owner.get(address);
      if (!took || took.id === claim.id) continue;
      if (refines(took, claim)) continue;
      sharesWith = took;
      break;
    }
    // Every byte went to something inside it. Nothing disagrees; it simply has
    // nothing left to draw.
    if (!sharesWith) continue;

    segments.push({
      start: claim.at,
      end: claimEnd(claim),
      claim,
      alternate: true,
      sharesWith,
    });
  }

  return segments.sort((a, b) =>
    a.start !== b.start ? a.start - b.start : Number(a.alternate) - Number(b.alternate)
  );
}

/** One line describing where a second reading begins, for a listing. */
export function describeAlternate(segment: ClaimSegment): string {
  const hex = (n: number) => "$" + n.toString(16).toUpperCase().padStart(4, "0");
  const what = segment.claim.name ?? segment.claim.says!.is;
  return segment.sharesWith
    ? `; also reads ${hex(segment.start)}-${hex(segment.end)} as ${what} (${segment.claim.by.author}), sharing bytes with ${segment.sharesWith.name ?? "the reading above"}`
    : `; also reads ${hex(segment.start)}-${hex(segment.end)} as ${what} (${segment.claim.by.author})`;
}
