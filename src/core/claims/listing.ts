/**
 * One address-sorted emission of everything that covers a byte.
 *
 * The rule that settled overlapping *instructions*, applied to the whole listing:
 *
 * > Emit **every** block in order of where it starts, and mark any whose start
 * > the walk has already passed.
 *
 * `layoutClaims` did something weaker and, on reflection, wrong: it decided per
 * address which claim *owned* the byte, innermost first. That is a resolution,
 * and this model's whole premise is that nothing resolves at rest — it just moved
 * `getRegionAt`'s decision from the data structure into a layout pass, where it
 * is no more visible to the person the disagreement belongs to.
 *
 * Here blocks and claims are peers in one list. Nothing owns a byte; several
 * things describe it and all of them are emitted, in the order they start, with
 * anything beginning inside what came before marked as sharing those bytes.
 *
 * Three consequences worth stating:
 *
 * - **"Primary" continues not to be a question.** It means "reached first in
 *   address order" and nothing else, exactly as it does for blocks.
 * - **A gap is a hex dump, not a kind.** Bytes nothing covers get no
 *   interpretation and no `unknown` region — which is what makes the absence of a
 *   claim the honest spelling of "nobody has explained this yet", and makes
 *   `find_undecoded` a question about the gaps rather than a whitelist.
 * - **Inclusion is reachability, not annotation.** A claim appears because
 *   something reaches it or because it is rooted. A sprite bank nothing names and
 *   nobody rooted is genuinely not in the listing, which is a fact about the
 *   project rather than an oversight.
 */

import { BasicBlock, buildBlocks } from "../analysis/blocks.js";
import { InstructionIndex } from "../arch/mos6502/disassembler.js";
import { Instruction } from "../arch/mos6502/instruction.js";
import { DecodeGraph } from "./graph.js";
import { Reachability, Root } from "./reach.js";
import { claimEnd } from "./model.js";
import { ClaimSet, PlacedClaim, OPERAND_TOLERANCE } from "./set.js";

export type ListingItem =
  | {
      readonly kind: "block";
      readonly start: number;
      readonly end: number;
      readonly block: BasicBlock;
      /** Begins inside something already emitted. */
      readonly shadow: boolean;
      /** What it shares bytes with, when it does. */
      readonly sharesWith?: ListingItem;
    }
  | {
      readonly kind: "claim";
      readonly start: number;
      readonly end: number;
      readonly claim: PlacedClaim;
      readonly shadow: boolean;
      readonly sharesWith?: ListingItem;
      /** One piece of a claim split around something declared inside it. */
      readonly fragment?: { readonly of: number; readonly to: number };
    }
  | {
      /** Bytes nothing covers. Rendered as hex, described by nobody. */
      readonly kind: "gap";
      readonly start: number;
      readonly end: number;
    };

export interface ListingRange {
  readonly from: number;
  readonly to: number;
}

/**
 * Materialise the instructions a walk reached, so blocks can be built from them.
 *
 * The graph holds typed arrays precisely so 64K `Instruction` objects are never
 * allocated; this allocates only what a query surfaced, which on the reference
 * project is about 1,500 of 65,536.
 */
export function instructionsFor(graph: DecodeGraph, reach: Reachability): InstructionIndex {
  const map = new Map<number, Instruction>();
  for (const address of reach.code) {
    const instruction = graph.instructionAt(address);
    if (instruction) map.set(address, instruction);
  }
  return new InstructionIndex(map);
}

/**
 * Which claims belong in the listing.
 *
 * Rooted, or reached. The `+/-1` window is the 1-indexed table idiom — `LDA
 * table-1,X` names the byte before the claim — and without it `copyrightLine`,
 * `txtBattleStations` and `screenHeaderColors` all read as unreferenced.
 */
export function claimsInListing(set: ClaimSet, reach: Reachability): PlacedClaim[] {
  return set.all().filter((claim) => {
    if (claim.root !== undefined) return true;
    if (claim.says === undefined) return false;
    for (let a = claim.at - OPERAND_TOLERANCE; a < claimEnd(claim); a++) {
      if (reach.data.has(a) || reach.code.has(a)) return true;
    }
    return false;
  });
}

/**
 * Everything that covers a byte, in the order it starts.
 *
 * A total order is needed or two peers would emit differently: start, then the
 * wider span first — so a container introduces what is inside it — then blocks
 * before claims, then by id. Every tie-break is arbitrary and none of them
 * decides what is *shown*, only what is shown first.
 */
function compareItems(a: ListingItem, b: ListingItem): number {
  if (a.start !== b.start) return a.start - b.start;
  const spanA = a.end - a.start;
  const spanB = b.end - b.start;
  if (spanA !== spanB) return spanB - spanA;
  if (a.kind !== b.kind) return a.kind === "block" ? -1 : 1;
  const idA = a.kind === "claim" ? a.claim.id : "";
  const idB = b.kind === "claim" ? b.claim.id : "";
  return idA.localeCompare(idB);
}

export function collectListing(
  graph: DecodeGraph,
  reach: Reachability,
  set: ClaimSet,
  roots: readonly Root[],
  range: ListingRange
): ListingItem[] {
  const instructions = instructionsFor(graph, reach);
  const codeRoots = roots.filter((r) => r.kind === "code").map((r) => r.address);

  const items: ListingItem[] = [];
  for (const block of buildBlocks(instructions, codeRoots)) {
    if (block.end <= range.from || block.start >= range.to) continue;
    items.push({ kind: "block", start: block.start, end: block.end, block, shadow: false });
  }
  for (const claim of claimsInListing(set, reach)) {
    const end = claimEnd(claim);
    if (end <= range.from || claim.at >= range.to) continue;
    // A point claim covers no bytes to render. It is a name or a root, and it
    // attaches to whatever else covers that address rather than emitting a span.
    if (claim.extent === undefined) continue;
    items.push({ kind: "claim", start: claim.at, end, claim, shadow: false });
  }

  // Split containers *before* marking, or a nested item is marked as sharing
  // bytes with a container that has just yielded them to it. Order matters here
  // and getting it wrong is invisible: the listing looks right and reports 45
  // conflicts where there are 2.
  const pieces = split(items).sort(compareItems);

  // Mark anything beginning inside what has already been emitted. `coveredTo` is
  // a high-water mark rather than a set, because "already passed" is a statement
  // about the order of emission, not about coverage.
  //
  // Not seeded with `range.from`: an item extending into the window from before
  // it has not been passed by anything, and seeding with the window edge makes
  // the same listing read differently depending on where you started reading —
  // the viewport-dependent classification the arrow gutter rules already forbid,
  // arriving by a different door.
  const marked: ListingItem[] = [];
  let coveredTo = Number.NEGATIVE_INFINITY;
  let covering: ListingItem | undefined;
  for (const item of pieces) {
    if (item.kind === "gap") continue;
    const shadow = item.start < coveredTo;
    marked.push({ ...item, shadow, ...(shadow && covering ? { sharesWith: covering } : {}) });
    if (item.end > coveredTo) {
      coveredTo = item.end;
      covering = item;
    }
  }

  // Gaps: bytes no item covers. From merged intervals rather than from the
  // emission order, since a shadow item still covers its bytes.
  const covered: [number, number][] = marked
    .map((i) => [Math.max(i.start, range.from), Math.min(i.end, range.to)] as [number, number])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);

  const gaps: ListingItem[] = [];
  let at = range.from;
  for (const [start, end] of covered) {
    if (start > at) gaps.push({ kind: "gap", start: at, end: start });
    if (end > at) at = end;
  }
  if (at < range.to) gaps.push({ kind: "gap", start: at, end: range.to });

  return [...marked, ...gaps].sort(compareItems);
}

/**
 * Break a span around anything declared strictly inside it.
 *
 * Without this the emission order is right and the *reading* order is not: an
 * 8,400-byte zone table dumps to completion and its own forty strings appear
 * after all of it, at addresses the reader passed thousands of bytes ago.
 *
 * It resolves nothing — both items still render, in full, and neither is chosen
 * over the other. A container renders in the pieces its children leave, which is
 * what nesting has always looked like and is why the reference project can say
 * "this 8K span is the zone table" and "these forty bytes are text" at once.
 *
 * **Only containment splits.** A partial overlap is two people disagreeing about
 * where something ends, and fragmenting one around the other would present a
 * conflict as a structure. Those keep the shadow mark instead, which is what
 * having one is for: on the project three agents built, that is 2 marks where the
 * unsplit rule gives 45.
 */
function split(items: readonly ListingItem[]): ListingItem[] {
  const out: ListingItem[] = [];
  for (const item of items) {
    if (item.kind !== "claim") {
      out.push(item);
      continue;
    }
    const inner = items
      .filter(
        (other) =>
          other !== item &&
          other.kind !== "gap" &&
          other.start >= item.start &&
          other.end <= item.end &&
          other.end - other.start < item.end - item.start
      )
      .sort((a, b) => a.start - b.start);

    if (inner.length === 0) {
      out.push(item);
      continue;
    }

    let at = item.start;
    const fragments: [number, number][] = [];
    for (const child of inner) {
      if (child.start > at) fragments.push([at, child.start]);
      if (child.end > at) at = child.end;
    }
    if (at < item.end) fragments.push([at, item.end]);

    // Every byte taken by something inside it: nothing left to draw, and nothing
    // disagrees — so it contributes no row rather than a marked one.
    for (const [start, end] of fragments) {
      out.push({ ...item, start, end, fragment: { of: item.start, to: item.end } });
    }
  }
  return out;
}

/** What each item is, in one line, for a listing header or a tool result. */
export function describeItem(item: ListingItem): string {
  const hex = (n: number) => "$" + n.toString(16).toUpperCase().padStart(4, "0");
  const span = `${hex(item.start)}-${hex(item.end)}`;
  switch (item.kind) {
    case "gap":
      return `${span}  (${item.end - item.start} bytes, nothing explains these)`;
    case "block":
      return (
        `${span}  ${item.block.instructions.length} instruction(s)` +
        (item.shadow ? "  [also decodes from here, sharing bytes above]" : "")
      );
    case "claim":
      return (
        `${span}  ${item.claim.says?.is ?? "named"} ${item.claim.name ?? ""}`.trimEnd() +
        (item.shadow ? "  [also reads these bytes, shared above]" : "")
      );
  }
}
