/**
 * What a routine touches.
 *
 * The question naming one requires, and the first thing here that is genuinely
 * *inter*procedural. Everything it needs already existed: basic blocks with the
 * strict definition, a lifter covering the documented instruction set, and
 * `blockEffects` reading a block's reads and writes off its operations rather
 * than off a table.
 *
 * Four decisions, all of them settled by measuring Gridrunner rather than by
 * argument:
 *
 * **A routine's extent is derived, never declared.** A declared extent is a
 * single span, and 20 of 50 routines here are *not* one contiguous span — one
 * tail-jumps across a 2602-byte hole. So an extent cannot describe them, which
 * makes it wrong rather than merely coarse. `mark_function` no longer needs to
 * carry one, which also frees the label field it was sharing with array extents.
 *
 * **Ownership is not a partition, and does not need to be.** 87 of 431 blocks
 * are reachable from more than one entry — the shared-tail idiom, one block
 * reached from five routines. For a *may* answer that is fine: effects are a
 * union over what is reachable, and over-approximating is the sound direction.
 * No dominators, no arbitrating who owns a shared tail.
 *
 * **A tail jump belongs to the routine.** The walk follows branches and jumps
 * and does not stop at another routine's entry, because control genuinely goes
 * there and never comes back. That could have swallowed the program and does
 * not: the median routine is 5 blocks and the largest 93 of 450.
 *
 * **May, not must.** A union is always answerable; an intersection over paths
 * often is not, and a "must" that is sometimes silently a "may" is worse than
 * no answer. So: everything this routine *can* touch.
 */

import { BasicBlock } from "./blocks.js";
import { BlockEffects, blockEffects } from "../il/effects.js";
import { FLAGS, REG, Varnode, sameVarnode } from "../il/pcode.js";

export interface RoutineEffects {
  entry: number;
  /** Blocks reachable from the entry without following a call. */
  blocks: number;
  /**
   * The address ranges its code occupies, in order.
   *
   * More than one whenever the routine tail-jumps away — which is why a single
   * declared extent could never have described it.
   */
  spans: { start: number; end: number }[];
  /** What its own blocks touch, ignoring anything it calls. */
  own: Effects;
  /**
   * What calling it touches: its own effects plus everything its callees can
   * reach, transitively. The question a caller is actually asking.
   */
  total: Effects;
  /** Subroutines it calls, directly. */
  calls: number[];
  /**
   * Why the answer may be short, in the caller's terms.
   *
   * Never empty of meaning: an instruction with no semantics makes both sets
   * incomplete by an unknown amount, and a routine that leaves the stack
   * somewhere unexpected breaks the return edge every caller assumes.
   */
  incomplete: string[];
}

export interface Effects {
  reads: Varnode[];
  writes: Varnode[];
  flags: number[];
  readsComputedMemory: boolean;
  writesComputedMemory: boolean;
}

const empty = (): Effects => ({
  reads: [],
  writes: [],
  flags: [],
  readsComputedMemory: false,
  writesComputedMemory: false,
});

/**
 * The program counter and the stack pointer, which every routine touches.
 *
 * Left out of the reported sets on purpose. `JSR` and `RTS` move both, so
 * including them would put `SP` and `PC` on the answer for essentially every
 * routine in the program — noise on every line, in the two entries a reader
 * would learn to skip. Neither is a *data* effect, which is the question being
 * asked: where control went is described by the exit and the call list, and what
 * happened to the stack by `stackDelta`, which says more than "touched" ever
 * could.
 */
const PLUMBING = [REG.PC, REG.SP];
const isPlumbing = (v: Varnode) =>
  v.space === "register" && (PLUMBING as readonly number[]).includes(v.offset);

function add(into: Effects, from: Effects | BlockEffects): Effects {
  const merge = (target: Varnode[], source: readonly Varnode[]) => {
    for (const node of source) {
      if (isPlumbing(node)) continue;
      if (!target.some((v) => sameVarnode(v, node))) target.push(node);
    }
  };
  merge(into.reads, "reads" in from ? from.reads : from.inputs);
  merge(into.writes, "writes" in from ? from.writes : from.outputs);
  into.readsComputedMemory ||= from.readsComputedMemory;
  into.writesComputedMemory ||= from.writesComputedMemory;
  into.flags = into.writes
    .filter((v) => v.space === "register" && (FLAGS as readonly number[]).includes(v.offset))
    .map((v) => v.offset);
  return into;
}

/** Where a routine can start: anything called, plus anything declared to be one. */
export function routineEntries(
  blocks: readonly BasicBlock[],
  declared: readonly number[] = []
): number[] {
  const real = blocks.filter((b) => !b.alternate);
  const starts = new Set(real.map((b) => b.start));
  const called = real.flatMap((b) => b.calls);
  return [...new Set([...called, ...declared])].filter((a) => starts.has(a)).sort((a, b) => a - b);
}

/** Blocks reachable from an entry without following a call. */
function bodyOf(entry: number, byStart: Map<number, BasicBlock>): BasicBlock[] {
  const seen = new Set<number>();
  const queue = [entry];
  while (queue.length > 0) {
    const at = queue.pop() as number;
    if (seen.has(at)) continue;
    seen.add(at);
    // Successors only. A call's successor is where it *returns to*, which is in
    // this routine; who it called is the interprocedural question, kept apart.
    for (const next of byStart.get(at)?.successors ?? []) queue.push(next);
  }
  return [...seen].map((s) => byStart.get(s)).filter((b): b is BasicBlock => b !== undefined);
}

/** Contiguous runs of the blocks a routine occupies, in address order. */
function spansOf(blocks: readonly BasicBlock[]): { start: number; end: number }[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  const spans: { start: number; end: number }[] = [];
  for (const block of sorted) {
    const last = spans[spans.length - 1];
    if (last && block.start <= last.end) last.end = Math.max(last.end, block.end);
    else spans.push({ start: block.start, end: block.end });
  }
  return spans;
}

/**
 * Every routine, with what it touches.
 *
 * Derived and never stored, like blocks and the region tree.
 *
 * The interprocedural pass is a fixpoint rather than a single walk: Gridrunner's
 * call graph happens to be acyclic, so one bottom-up sweep would do, but a
 * program that calls itself is ordinary and a walk that assumed otherwise would
 * not terminate. Iterating until nothing changes costs a few passes and is
 * indifferent to the shape.
 */
export function analyzeRoutines(
  blocks: readonly BasicBlock[],
  declared: readonly number[] = []
): Map<number, RoutineEffects> {
  const real = blocks.filter((b) => !b.alternate);
  const byStart = new Map(real.map((b) => [b.start, b]));
  const entries = routineEntries(real, declared);

  const routines = new Map<number, RoutineEffects>();

  for (const entry of entries) {
    const body = bodyOf(entry, byStart);
    const own = empty();
    const incomplete: string[] = [];
    const calls = new Set<number>();

    for (const block of body) {
      const effects = blockEffects(block.instructions);
      add(own, effects);
      for (const target of block.calls) calls.add(target);

      for (const { address, mnemonic } of effects.unmodelled) {
        incomplete.push(
          `${hex(address)} is ${mnemonic}, which has no modelled semantics, so ` +
            `these sets are short by an unknown amount`
        );
      }
      // A routine that leaves the stack somewhere unexpected is not returning
      // where its caller thinks. $87FE in Gridrunner pops its own return
      // address and returns to its caller's caller.
      if (block.exit === "ret" && block.stackDelta !== undefined && block.stackDelta !== -2) {
        incomplete.push(
          `${hex(block.start)} returns having moved the stack by ${block.stackDelta} ` +
            `rather than -2, so it does not return where its caller expects`
        );
      }
      if (block.stackDelta === undefined) {
        incomplete.push(`${hex(block.start)} sets the stack pointer outright, so its depth is unknown`);
      }
    }

    routines.set(entry, {
      entry,
      blocks: body.length,
      spans: spansOf(body),
      own,
      total: add(empty(), own),
      calls: [...calls].sort((a, b) => a - b),
      incomplete: [...new Set(incomplete)],
    });
  }

  // Fold callees in, repeatedly, until nothing moves.
  for (let pass = 0; pass < entries.length + 1; pass++) {
    let changed = false;
    for (const routine of routines.values()) {
      const before = routine.total.reads.length + routine.total.writes.length;
      const flags = [routine.total.readsComputedMemory, routine.total.writesComputedMemory];
      for (const target of routine.calls) {
        const callee = routines.get(target);
        if (callee) add(routine.total, callee.total);
      }
      const after = routine.total.reads.length + routine.total.writes.length;
      if (
        after !== before ||
        flags[0] !== routine.total.readsComputedMemory ||
        flags[1] !== routine.total.writesComputedMemory
      ) {
        changed = true;
      }
    }
    if (!changed) break;
  }

  // A call to something that never decoded is a hole in the interprocedural
  // answer, and only visible once every routine is known.
  for (const routine of routines.values()) {
    for (const target of routine.calls) {
      if (!routines.has(target)) {
        routine.incomplete.push(
          `it calls ${hex(target)}, which did not decode, so what that touches is unknown`
        );
      }
    }
  }

  return routines;
}

const hex = (n: number) => `$${n.toString(16).toUpperCase().padStart(4, "0")}`;
