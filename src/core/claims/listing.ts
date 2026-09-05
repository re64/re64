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
 * **Nothing splits, including a claim declared inside another.** That rule was
 * tried and is unsound. It assumes an interpretation is byte-local — that
 * rendering `[a,b)` then `[c,d)` equals rendering `[a,d)` minus the middle —
 * which holds for hex and roughly for text and is false for `bitmap` and for
 * `snippet:<id>`: a `char:8` sheet split at byte 37 breaks the glyph grid, and a
 * decoder run over two fragments is not the decoder run over the span.
 *
 * The reason it looked necessary is worth more than the rule. An 8,400-byte
 * `data` claim called `zoneDataTable` explains 1,680 of its own bytes — 20% —
 * and dumps to completion before the forty strings inside it appear. Splitting
 * made that read tolerably; what it really did was compensate in the display for
 * a document problem, which is the mirror of a mistake this project already
 * names in the other direction. Deleting the claim takes the project from 6 gaps
 * to 48 and from 3,824 unexplained bytes to 10,544, which is the honest number:
 * the placeholder was hiding 42 entries from the one list whose job is to show
 * unexplained work.
 *
 * So the rule underneath is about claims rather than rendering: **a claim should
 * cover exactly what it explains.** One covering bytes it does not explain is a
 * placeholder, and a placeholder belongs in the gap list rather than over it.
 * Composition — a struct decomposing into fields — is the real answer for spans
 * that genuinely have parts, and it has to be *declared* rather than inferred
 * from containment, because that is exactly the difference between "this is a
 * struct" and "these are forty strings and forty unexplained runs".
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

  items.sort(compareItems);

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
  for (const item of items) {
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
