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
   * Where each of those blocks starts.
   *
   * Membership is asked of *this*, never of `spans`. A span is a merged
   * contiguous range, and two routines whose blocks interleave in memory have
   * overlapping spans while sharing no block at all — which turned an exact
   * question into 272 false ambiguities. `spans` is for showing a reader where
   * the code is; this is for deciding what belongs to whom.
   */
  blockStarts: number[];
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
  /**
   * `total`, but not entering a callee that does not come back.
   *
   * Sound and useless is still useless. Four of Gridrunner's six main-loop
   * subsystems can reach a routine that resets the stack and jumps into the
   * death path, so `total` unions most of the program and says nothing about
   * what playing the game does. Stopping there is not a claim that control does
   * not go on — `cut` names every place it stopped, and asking about one of
   * those directly gives the rest.
   */
  returning: Effects;
  /** Callees left out of `returning`, because they do not return ordinarily. */
  cut: number[];
  /** Subroutines it calls, directly. */
  calls: number[];
  /**
   * Routines it jumps into and never returns from.
   *
   * A tail call. Their effects count towards `total` exactly as a callee's do,
   * but their code is theirs — which is what keeps an address in at most one
   * routine, and attribution therefore answerable.
   */
  continuesInto: number[];
  /**
   * Every way it leaves that is not an ordinary return.
   *
   * Derived from `stackDelta`, which already knows: the count is exact because
   * a block is straight-line, so "how much did the stack move" needs no guessing.
   */
  returns: ReturnBehaviour[];
  /** True when it returns past its caller, so a caller does not get control back. */
  skipsFrames: boolean;
  /**
   * Why the answer may be short — named, so a caller can act on it.
   *
   * These used to be sentences. Prose is the right thing to *show* somebody and
   * the wrong thing to hand a caller who has to decide what to do about it: an
   * agent that knows the routine at `$F1CA` cannot say "ignore that one" when
   * the only handle it has is a string it would have to parse. Every other
   * observation here carries a kind — `DisassemblyWarning`, `HygieneFinding`,
   * and now `ReturnBehaviour` — and this was the holdout, on the one field that
   * answers "can I trust this list".
   *
   * The prose is still there. `describeGap` renders it, exactly as
   * `describeWarning` does, so nothing is lost by naming it.
   */
  incomplete: EffectGap[];
}

/**
 * A reason an effects answer may be short.
 *
 * Named rather than written out, so an agent can bring knowledge this analysis
 * does not have — that an unlifted instruction is an illegal opcode it
 * recognises, that a callee it has already read is harmless — and settle the
 * ambiguity itself. The C64 is full of these: what looks like a gap is very
 * often an idiom somebody could name in one word.
 */
export type EffectGap =
  /** An instruction with no modelled semantics. Both sets are short by an unknown amount. */
  | { kind: "unmodelledInstruction"; at: number; mnemonic: string }
  /** A callee that returns past its caller, so the code after the `JSR` is not reached through it. */
  | { kind: "calleeSkipsFrames"; at: number }
  /** A callee nothing decoded, so what it touches is unknown. */
  | { kind: "calleeNotDecoded"; at: number };

/** A gap as a line somebody can read. Structure for a caller, prose for a reader. */
export function describeGap(gap: EffectGap): string {
  switch (gap.kind) {
    case "unmodelledInstruction":
      return (
        `${hex(gap.at)} is ${gap.mnemonic}, which has no modelled semantics, so ` +
        `these sets are short by an unknown amount`
      );
    case "calleeSkipsFrames":
      return (
        `${hex(gap.at)} returns past whoever called it, so the code after that ` +
        `JSR is not reached through it`
      );
    case "calleeNotDecoded":
      return `it calls ${hex(gap.at)}, which did not decode, so what that touches is unknown`;
  }
}

export interface Effects {
  reads: Varnode[];
  writes: Varnode[];
  flags: number[];
  readsComputedMemory: boolean;
  writesComputedMemory: boolean;
}

export interface ReturnBehaviour {
  at: number;
  /**
   * Which of three genuinely different things this is.
   *
   * `skipsFrames` alone could not say: it was 0 both for a routine that resets
   * the stack and never comes back, and for one whose depth the analysis simply
   * could not determine. Those are opposite kinds of statement — one is a fact
   * about the program, the other an admission about the analysis — and folding
   * them together made `follow: "returning"` cut a KERNAL entry point's whole
   * body because two paths reached one block at different depths.
   */
  kind:
    /** Abandons its call chain outright. Control does not come back. */
    | "abandons"
    /** Returns, but further up than its caller. */
    | "skips"
    /** The analysis cannot tell where it returns to. Says nothing about the code. */
    | "ambiguous";
  /** How many extra call frames it pops. Meaningful for `skips`. */
  skipsFrames: number;
  why: string;
}

/**
 * How a routine leaves, worked out from the stack.
 *
 * The delta already determines this and nothing needs to be guessed — but it
 * has to be accumulated **from the routine's entry**, not read off the block
 * that returns. An interrupt handler saves its registers in one block and
 * restores them in another, so the returning block alone is three bytes short
 * and looks broken; the routine is balanced. Judging blocks in isolation
 * reports every handler in every program as anomalous.
 *
 * The convention: at the entry, depth is 0 and the caller's return address is
 * already on the stack. A routine that returns normally is back at 0 by the
 * time its `RTS` runs. Sitting at -2 means an extra address has been popped and
 * it returns one frame further up — which is what `$87FE` in Gridrunner does.
 *
 * `RTS` pops two bytes, `RTI` three, and that difference is the whole reason
 * this cannot be compared against one number.
 */
function describeReturns(entry: number, body: readonly BasicBlock[]): ReturnBehaviour[] {
  const byStart = new Map(body.map((b) => [b.start, b]));
  const depth = new Map<number, number | undefined>([[entry, 0]]);
  const found: ReturnBehaviour[] = [];
  const queue = [entry];
  const conflicted = new Set<number>();

  while (queue.length > 0) {
    const at = queue.pop() as number;
    const block = byStart.get(at);
    if (!block) continue;

    const here = depth.get(at);
    // A `JSR` pushes a return address that the callee's `RTS` pops again, so
    // across a call the net effect on *this* routine's stack is nothing. The
    // block's own delta counts the push, because a block cannot see what
    // happens after it — leaving it in makes every routine look two bytes
    // deeper per call it makes, which is how this first reported 48 findings
    // across 50 routines: 30 bytes deeper meant fifteen calls, not a bug.
    //
    // It assumes the callee returns normally. Where one does not, that is
    // reported against the callee and against everyone who calls it.
    const pushedByCall = block.exit === "call" ? 2 : 0;
    // `TXS` sets the pointer rather than moving it, so the chain is not deeper
    // or shallower — it is gone, along with whatever was going to return.
    const after = here === undefined || block.stackDelta === undefined
      ? undefined
      : here + block.stackDelta - pushedByCall;

    for (const next of block.successors) {
      if (!depth.has(next)) {
        depth.set(next, after);
        queue.push(next);
      } else if (depth.get(next) !== after && !conflicted.has(next)) {
        // Two ways in leaving the stack at different depths. Worth saying: it
        // means the return address is not always in the same place.
        conflicted.add(next);
        found.push({
          at: next,
          kind: "ambiguous",
          skipsFrames: 0,
          why:
            `${hex(next)} is reached with the stack at two different depths, so ` +
            `where this routine returns to depends on the path taken`,
        });
      }
    }

    if (block.stackDelta === undefined) {
      found.push({
        at: block.start,
        kind: "abandons",
        skipsFrames: 0,
        why:
          `${hex(block.start)} sets the stack pointer outright, abandoning whatever ` +
          `call chain it was in — so nothing that called it gets control back`,
      });
      continue;
    }
    if (block.exit !== "ret" || here === undefined) continue;

    const last = block.instructions[block.instructions.length - 1];
    const pops = last?.mnemonic === "RTI" ? 3 : 2;
    // What the stack looked like just before the return instruction ran.
    const before = here + block.stackDelta + pops;
    if (before === 0) continue;

    const frames = -before / 2;
    found.push(
      Number.isInteger(frames) && frames > 0
        ? {
            at: block.start,
            kind: "skips",
            skipsFrames: frames,
            why:
              `${hex(block.start)} reaches its ${last?.mnemonic ?? "return"} with ` +
              `${frames * 2} bytes already popped, so it returns to its caller's ` +
              `${frames === 1 ? "caller" : `caller ${frames} deep`} — whatever called ` +
              `it does not get control back`,
          }
        : {
            at: block.start,
            kind: "ambiguous",
            skipsFrames: 0,
            why:
              `${hex(block.start)} reaches its ${last?.mnemonic ?? "return"} with the ` +
              `stack ${before > 0 ? before + " bytes deeper" : -before + " bytes shallower"} ` +
              `than it started, so the address it returns to is not the one pushed for it`,
          }
    );
  }

  return found;
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

/**
 * Where a routine can start: anything called, anything declared to be one, and
 * anything jumped to.
 *
 * The last is the symmetric half of bounding a routine at a `JMP`. If a jump
 * leaves the routine it was in, the code it lands on has to belong to
 * *something* — otherwise a top-level `JMP` chain is a program in which no
 * address is in any routine, which is a different useless answer from the one
 * this replaced.
 *
 * It means a program's structure is read as it is written rather than as
 * subroutine theory would prefer: on this machine a chain of `JMP`s is an
 * ordinary top level, and each link really is a separate piece of code that
 * runs to completion and hands on.
 */
export function routineEntries(
  blocks: readonly BasicBlock[],
  declared: readonly number[] = []
): number[] {
  const real = blocks.filter((b) => !b.alternate);
  const starts = new Set(real.map((b) => b.start));

  const called = real.flatMap((b) => b.calls);
  const jumpedTo = real.filter((b) => b.exit === "jump").flatMap((b) => b.successors);

  return [...new Set([...called, ...declared, ...jumpedTo])]
    .filter((a) => starts.has(a))
    .sort((a, b) => a - b);
}

/**
 * Blocks reachable from an entry, without following a call and without walking
 * into another routine.
 *
 * **Stopping at another entry is the whole of the correction here.** Following
 * tail jumps through was defensible for a *may* effects answer — over-approximate
 * and the union is still sound — and it was measured against "does any routine
 * swallow the program", which it did not.
 *
 * That was the wrong question. The same structure was then used to say *which*
 * routine an address is in, which needs exactly one answer, and there it fails
 * badly: on a program whose top level is a `JMP` chain rather than JSR/RTS, one
 * routine absorbed a quarter of the code and every SID write in the program was
 * reported as "in ColdStart". Seven different routines claimed `$8393`.
 *
 * Bounded here, and the transfer is not lost: a tail jump into another routine
 * is recorded as `continuesInto` and its effects are folded into `total`,
 * exactly as a call's are. What changes is that the *extent* stops, so an
 * address belongs to at most one routine and attribution can be precise.
 */
function bodyOf(
  entry: number,
  byStart: Map<number, BasicBlock>,
  entries: ReadonlySet<number>
): { body: BasicBlock[]; continuesInto: number[] } {
  const seen = new Set<number>();
  const leaves = new Set<number>();
  const queue = [entry];

  while (queue.length > 0) {
    const at = queue.pop() as number;
    if (seen.has(at)) continue;
    seen.add(at);

    const block = byStart.get(at);
    if (!block) continue;

    // Successors only. A call's successor is where it *returns to*, which is in
    // this routine; who it called is the interprocedural question, kept apart.
    for (const next of block.successors) {
      // A `JMP` leaves. A branch does not.
      //
      // This is the line that decides whether "which routine is this in" has an
      // answer. Bounding only at known entries is not enough: on a project
      // nobody has annotated yet almost nothing *is* a known entry, so a
      // top-level `JMP` chain merges into one routine that absorbs a quarter of
      // the program — every SID write in the game reported as "in ColdStart".
      //
      // The instruction says it plainly: a `JMP` transfers and never comes back,
      // while a 6502 branch reaches ±127 bytes and is structurally local, which
      // is the same fact the arrow gutter already relies on. Splitting at jumps
      // errs towards small, precisely attributed units; the alternative errs
      // towards one blob, and only one of those two is useful.
      //
      // Nothing is lost: the target is recorded as `continuesInto` and its
      // effects fold into `total`, exactly as a callee's do.
      if (next !== entry && (block.exit === "jump" || entries.has(next))) {
        leaves.add(next);
        continue;
      }
      queue.push(next);
    }
  }

  return {
    body: [...seen].map((s) => byStart.get(s)).filter((b): b is BasicBlock => b !== undefined),
    continuesInto: [...leaves].sort((a, b) => a - b),
  };
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

  const entrySet = new Set(entries);

  for (const entry of entries) {
    const { body, continuesInto } = bodyOf(entry, byStart, entrySet);
    const own = empty();
    const incomplete: EffectGap[] = [];
    const returns: ReturnBehaviour[] = [];
    let skipsFrames = false;
    const calls = new Set<number>();

    for (const block of body) {
      const effects = blockEffects(block.instructions);
      add(own, effects);
      for (const target of block.calls) calls.add(target);

      for (const { address, mnemonic } of effects.unmodelled) {
        incomplete.push({ kind: "unmodelledInstruction", at: address, mnemonic });
      }
    }

    const returnBehaviour = describeReturns(entry, body);
    returns.push(...returnBehaviour);
    skipsFrames = returnBehaviour.some((r) => r.skipsFrames > 0);

    routines.set(entry, {
      entry,
      blocks: body.length,
      blockStarts: body.map((b) => b.start).sort((a, b) => a - b),
      spans: spansOf(body),
      own,
      total: add(empty(), own),
      returning: add(empty(), own),
      cut: [],
      calls: [...calls].sort((a, b) => a - b),
      continuesInto,
      returns,
      skipsFrames,
      // Deduplicated on the whole observation, not on a sentence: the same
      // unlifted instruction reached twice is one gap, and two different ones
      // are two.
      incomplete: [...new Map(incomplete.map((g) => [JSON.stringify(g), g])).values()],
    });
  }

  // Fold callees in, repeatedly, until nothing moves.
  for (let pass = 0; pass < entries.length + 1; pass++) {
    let changed = false;
    for (const routine of routines.values()) {
      const before = routine.total.reads.length + routine.total.writes.length;
      const flags = [routine.total.readsComputedMemory, routine.total.writesComputedMemory];
      for (const target of [...routine.calls, ...routine.continuesInto]) {
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

  // The same fold, refusing to enter anything that does not come back. Run
  // separately rather than as a flag on the first, because a bounded answer
  // has to be built out of bounded answers: folding a callee's unbounded
  // `total` in here would leak the whole program back through one hop.
  // Cut where the program *provably* leaves, never because the analysis is
  // unsure. `abandons` is a fact about the code — it reset the stack pointer, so
  // nothing that reached it gets control back. `ambiguous` is an admission about
  // this pass, and cutting on it silently threw away a routine's whole body:
  // three KERNAL entry points have two paths reaching one block at different
  // depths, and SCNKEY reported touching nothing at all.
  const abandons = (at: number) =>
    routines.get(at)?.returns.some((r) => r.kind === "abandons") ?? false;
  // Only *calls* are cut, never a tail jump. The rule is about a caller not
  // getting control back, so the code after its `JSR` is not reached through
  // that call — and a tail jump has no "after": it is this routine continuing,
  // and its target's effects are this routine's effects. Cutting those made a
  // KERNAL entry point, which is a bare `JMP` to its implementation, report
  // that it touches nothing at all.
  // Both calls and tail jumps, because a program leaves by whichever it likes:
  // Gridrunner's top level is a JMP chain, so its death path is reached by a
  // tail jump and cutting only calls would have caught none of it.
  for (const routine of routines.values()) {
    routine.cut = [...routine.calls, ...routine.continuesInto]
      .filter(abandons)
      .sort((a, b) => a - b);
  }
  for (let pass = 0; pass < entries.length + 1; pass++) {
    let changed = false;
    for (const routine of routines.values()) {
      const before = routine.returning.reads.length + routine.returning.writes.length;
      const flags = [routine.returning.readsComputedMemory, routine.returning.writesComputedMemory];
      for (const target of [...routine.calls, ...routine.continuesInto]) {
        const into = routines.get(target);
        if (!into || abandons(target)) continue;
        add(routine.returning, into.returning);
      }
      const after = routine.returning.reads.length + routine.returning.writes.length;
      if (
        after !== before ||
        flags[0] !== routine.returning.readsComputedMemory ||
        flags[1] !== routine.returning.writesComputedMemory
      ) {
        changed = true;
      }
    }
    if (!changed) break;
  }

  for (const routine of routines.values()) {
    for (const target of routine.calls) {
      // A callee that returns past its caller means the code after the `JSR`
      // is not reached through that call — which the caller cannot see for
      // itself and which the block graph assumes otherwise.
      const callee = routines.get(target);
      if (callee?.skipsFrames) {
        routine.incomplete.push({ kind: "calleeSkipsFrames", at: target });
      }
      if (!routines.has(target)) {
        routine.incomplete.push({ kind: "calleeNotDecoded", at: target });
      }
    }
  }

  return routines;
}

const hex = (n: number) => `$${n.toString(16).toUpperCase().padStart(4, "0")}`;

/**
 * Which routine an address is in, or undefined when nothing owns it.
 *
 * By block, not by span — see `blockStarts`. Where more than one routine still
 * claims a block, the smallest wins: the most specific claim is the most useful
 * thing that can be said, and it is stable rather than depending on iteration
 * order.
 */
export function routineAt(
  routines: ReadonlyMap<number, RoutineEffects>,
  blocks: readonly BasicBlock[],
  address: number
): RoutineEffects | undefined {
  const block = blocks
    .filter((b) => !b.alternate && address >= b.start && address < b.end)
    .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
  if (!block) return undefined;

  return [...routines.values()]
    .filter((r) => r.blockStarts.includes(block.start))
    .sort((a, b) => a.blocks - b.blocks)[0];
}
