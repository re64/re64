/**
 * Reachability as a query over the decode graph.
 *
 * The current walk decides three things at once — where to start, what to
 * follow, and what to refuse — and bakes the answer into one `InstructionIndex`.
 * Here the graph is fixed and only the *roots* vary, which is what makes the
 * question askable more than once: two targets ask the same graph with different
 * roots, and "what would this look like if `$8E00` were a routine" is a walk
 * rather than a rebuild.
 *
 * Claims do not appear here at all. Nothing a person declares can stop control
 * flow — a jump into data is a jump into data — so a claim's effect on a listing
 * is to *hide* blocks, never to prevent them existing. That separation is what
 * turns `flowIntoData` from bespoke machinery into an ordinary disagreement
 * between two things the system knows.
 */

import { DecodeGraph, ADDRESS_SPACE } from "./graph.js";

/**
 * How a root seeds this walk.
 *
 * `code` seeds the control-flow walk; `data` seeds nothing and marks an address
 * whose *bytes* somebody wants surfaced. Entry points and "show me this sprite
 * sheet" are the same kind of statement, which is why they belong in one list.
 *
 * Deliberately not `RootKind`, which `model.ts` exports from the same directory
 * with different members: a claim's `root` says what somebody *declared*
 * (`entry`, `routine`, `location`, `data`), and this says what a walk *does*
 * with it. Two concepts sharing one name in one directory is a collision
 * waiting for the first consumer that imports the wrong one.
 */
export type SeedKind = "code" | "data";

export interface Root {
  readonly address: number;
  readonly kind: SeedKind;
  /** Where the root came from, for reporting. Never used in the walk. */
  readonly why: string;
}

export interface ReachOptions {
  /** Follow `JSR` into callees. Default true. */
  readonly calls?: boolean;
  /**
   * Collect the addresses reachable code's operands name.
   *
   * This is the data closure: a claim is surfaced because something reaches it,
   * so an unreferenced sprite sheet needs an explicit root rather than arriving
   * because a region happened to cover it.
   */
  readonly operands?: boolean;
}

export interface Reachability {
  /** Instruction start addresses control reaches. */
  readonly code: ReadonlySet<number>;
  /** Addresses named by an operand of reachable code. */
  readonly data: ReadonlySet<number>;
  /** Which reachable instruction named each data address, for attribution. */
  readonly dataFrom: ReadonlyMap<number, number[]>;
  /** Addresses control reached where nothing decodes. */
  readonly undecodable: ReadonlySet<number>;
  readonly ms: number;
}

/**
 * Walk forward from a root set.
 *
 * Iterative rather than recursive: a 64K graph can produce a chain longer than
 * any engine's stack, and this is exactly the code that must not fall over on a
 * pathological binary.
 */
export function reachFrom(
  graph: DecodeGraph,
  roots: readonly Root[],
  options: ReachOptions = {}
): Reachability {
  const started = performance.now();
  const followCalls = options.calls !== false;
  const collectOperands = options.operands === true;

  const code = new Set<number>();
  const data = new Set<number>();
  const dataFrom = new Map<number, number[]>();
  const undecodable = new Set<number>();

  const queue: number[] = [];
  for (const root of roots) {
    if (root.kind === "code") queue.push(root.address);
    else data.add(root.address);
  }

  while (queue.length > 0) {
    const address = queue.pop()!;
    if (address < 0 || address >= ADDRESS_SPACE) continue;
    if (code.has(address)) continue;

    if (!graph.decodes(address)) {
      undecodable.add(address);
      continue;
    }
    code.add(address);

    if (collectOperands) {
      const ref = graph.operandRef(address);
      if (ref !== undefined) {
        data.add(ref);
        const sites = dataFrom.get(ref);
        if (sites) sites.push(address);
        else dataFrom.set(ref, [address]);
      }
    }

    const next = graph.fallThrough(address);
    if (next !== undefined) queue.push(next);

    const transfer = graph.transferTo(address);
    if (transfer !== undefined) {
      const isCall = graph.flowAt(address) === "call";
      if (!isCall || followCalls) queue.push(transfer);
    }
  }

  return { code, data, dataFrom, undecodable, ms: performance.now() - started };
}

/**
 * Which reachable instructions could transfer to an address.
 *
 * The backwards question, which the current model cannot ask at all: the walk
 * keeps no predecessor edges, so "what reaches this byte" has only ever been
 * answerable for addresses the walk already accepted. Scanning the reachable set
 * is O(reached) rather than O(64K) and needs no second index.
 */
export function predecessorsOf(
  graph: DecodeGraph,
  reach: Reachability,
  address: number
): number[] {
  const found: number[] = [];
  for (const from of reach.code) {
    if (graph.transferTo(from) === address) found.push(from);
    else if (graph.fallThrough(from) === address) found.push(from);
  }
  return found.sort((a, b) => a - b);
}

/**
 * Every address in the whole space whose instruction would transfer here.
 *
 * Unlike `predecessorsOf`, this ignores reachability — it answers "if anything
 * ever got to `$8123`, it would land here", which is what makes a speculative
 * decode judgeable. Exhaustive by construction, so it is O(64K) and is a
 * deliberate second function rather than a flag.
 */
export function potentialPredecessorsOf(graph: DecodeGraph, address: number): number[] {
  const found: number[] = [];
  for (let from = 0; from < ADDRESS_SPACE; from++) {
    if (!graph.decodes(from)) continue;
    if (graph.transferTo(from) === address) found.push(from);
  }
  return found;
}
