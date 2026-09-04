/**
 * What is known about the machine's state at each instruction, without inputs.
 *
 * A forward dataflow over the block graph, running the lifted operations through
 * the known-bits domain until nothing moves. It subsumes the three bespoke flag
 * walkers that came before it: `D` is a register the lifter writes from `SED`
 * and `CLD`, and so are `C`, `I`, `Z`, `N` and `V` — so "prove this flag" stops
 * being a rule per flag and becomes one question asked of the state.
 *
 * The two that could not be done any other way are the reason it exists:
 *
 * - **`N` is bit seven of a value.** `AND #$7F` proves it clear without a single
 *   other bit being known, which no set/clear-instruction walker can see.
 * - **`B` is not stored anywhere at all.** It exists only as bit four of the byte
 *   `PHP` and `BRK` push, so the only way to reason about it is to follow that
 *   byte onto the stack and back off it — which is why the stack is modelled as
 *   a stack.
 *
 * Termination is by construction rather than by a widening rule: every value is
 * a fixed number of bits, and a bit only ever goes from known to unknown, so the
 * lattice has finite height.
 */

import { BasicBlock } from "./blocks.js";
import { AbstractState, cloneState, initialState, joinStates, sameState, stepAbstract } from "../il/abstract.js";
import { Bits, and, exact, or, shiftLeft, unknown } from "../il/known-bits.js";
import { lift } from "../il/lift.js";
import { PcodeOp, REG, Varnode, writes } from "../il/pcode.js";

export type Known = "set" | "clear" | "unknown";

/**
 * How an origin is entered, which decides what can be assumed there.
 *
 * Seeding every origin with "nothing is known" is right for something reached
 * from outside the program and wrong for the two ways this machine re-enters
 * its own code. An interrupt does not arrive from nowhere: it arrives from
 * *somewhere in this program*, and the processor changes almost nothing on the
 * way in — it pushes the return address and the status byte, sets `I`, and
 * jumps. `A`, `X`, `Y`, memory and every other flag are exactly what the
 * interrupted code had.
 */
export type OriginKind =
  /** Reached from outside. Nothing can be assumed. */
  | "external"
  /** Asynchronous: can arrive between any two instructions, with `B` clear. */
  | "interrupt"
  /** Reached by executing a `BRK`, so only from those sites, and `B` is set. */
  | "brk"
  /**
   * Both, which on a bare 6502 is the ordinary case: `BRK` and `IRQ` share
   * `$FFFE`. `B` is then genuinely undecidable at the handler's first
   * instruction, which is exactly why a real one looks at it.
   */
  | "interruptOrBrk";

export interface ValueAnalysis {
  /** The state as each instruction is about to run. */
  before: ReadonlyMap<number, AbstractState>;
}

/**
 * Which registers a routine can write, following what it calls.
 *
 * Without this, a call would clear every flag and the answer after one `JSR`
 * would be "unknown" for ever — which is exactly how the first decimal proof
 * came back unknown at 17 of Gridrunner's 19 sites. Assumes the worst while
 * walking, so a recursive routine answers conservatively rather than looping.
 */
function registersWrittenFrom(blocks: readonly BasicBlock[]): (entry: number) => Set<number> {
  const byStart = new Map(blocks.map((b) => [b.start, b]));
  const cache = new Map<number, Set<number>>();
  const everything = new Set([...Array(16).keys()]);

  const walk = (entry: number): Set<number> => {
    const held = cache.get(entry);
    if (held) return held;
    cache.set(entry, everything);

    const found = new Set<number>();
    const seen = new Set<number>();
    const pending = [entry];
    while (pending.length > 0) {
      const at = pending.pop()!;
      if (seen.has(at)) continue;
      seen.add(at);
      const block = byStart.get(at);
      if (!block) return everything;
      for (const instruction of block.instructions) {
        for (const node of writes(lift(instruction))) {
          if (node.space === "register") found.add(node.offset);
        }
      }
      pending.push(...block.successors, ...block.calls);
    }

    cache.set(entry, found);
    return found;
  };

  return walk;
}

export function proveValues(
  blocks: readonly BasicBlock[],
  origins: readonly number[],
  options: {
    /**
     * Blocks to analyse conservatively if the origins never reach them.
     *
     * Pass the decode roots. Coverage and precision pull in opposite directions
     * here and the order is what reconciles them: seeding a routine label as an
     * origin asserts "nothing is known here", which joins into shared code and
     * destroys what the program's real start had proved. Seeding it only *after*
     * the origins have had their say leaves those proofs standing and still
     * gives an answer for code no origin reaches.
     *
     * That the second pass then loses a proof in code both reach is not a
     * shortcoming: if a routine really is entered from somewhere this analysis
     * cannot see, the flags really are unknown there.
     */
    cover?: readonly number[];
    /**
     * What is already on the stack when an origin is entered, deepest first.
     *
     * An interrupt handler is the case this exists for. It is entered with a
     * status byte pushed underneath it, and the one bit that distinguishes how
     * it got there — `B`, set by `BRK` and clear by a hardware interrupt — is
     * not stored anywhere else on this machine. Seeding that byte with `B`
     * decided and the rest unknown is what lets the same handler be analysed
     * twice and produce two different answers, which is the honest way to render
     * "what does this do", because it does two things.
     */
    stackAt?: ReadonlyMap<number, readonly Bits[]>;
    /**
     * How each origin is entered. Anything unlisted is `external`.
     *
     * `interrupt` and `brk` origins are deliberately *not* seeded on the first
     * pass. Their entry state is derived from the program once the rest of it
     * has been analysed, and then joined in repeatedly until it stops moving —
     * joining only ever loses precision, so that terminates.
     */
    kinds?: ReadonlyMap<number, OriginKind>;
  } = {}
): ValueAnalysis {
  const real = blocks.filter((b) => !b.alternate);
  const byStart = new Map(real.map((b) => [b.start, b]));
  const written = registersWrittenFrom(real);

  const entering = new Map<number, AbstractState>();
  const before = new Map<number, AbstractState>();
  const queue: number[] = [];

  // Seed only the entry points nothing else reaches.
  //
  // An entry point means "state is unknown here", and a `function` label is not
  // that — it is a routine something calls, and it gets its state from whoever
  // calls it. Seeding those too joins `unknown` into the flow and destroys what
  // the program's real start had proved: on the reference project the single
  // `CLD` in `ColdStart` proves `D` binary at all 18 arithmetic sites when the
  // analysis begins where the program does, and at none of them once the
  // fifteen declared routine labels are each seeded as an origin.
  //
  // This is where an `entry` label differs from a `function` one in something
  // other than name. An address nothing reaches is where execution must have
  // begun — Gridrunner's IRQ handler among them, which the KERNAL enters and no
  // instruction here does.
  const seed = (at: number) => {
    if (!byStart.has(at) || entering.has(at)) return;
    const state = initialState();
    const pushed = options.stackAt?.get(at);
    if (pushed) state.stack = [...pushed];
    entering.set(at, state);
    queue.push(at);
  };
  const kindOf = (at: number): OriginKind => options.kinds?.get(at) ?? "external";
  const reentrant = origins.filter((at) => byStart.has(at) && kindOf(at) !== "external");
  const started = origins.filter((at) => byStart.has(at) && kindOf(at) === "external");
  // Every declared origin is reached from inside, so there is no outside to
  // start from. Fall back to the decode roots and assume nothing anywhere.
  for (const at of started.length > 0 ? started : (options.cover ?? [])) seed(at);

  // Bounded rather than trusted: the lattice has finite height, so this is a
  // guard against a graph that is not what it claims rather than against the
  // analysis itself.
  let budget = real.length * 24 + 1000;
  const drain = () => {
  for (let step = 0; queue.length > 0 && budget-- > 0; step++) {
    const at = queue.shift()!;
    const block = byStart.get(at);
    const incoming = entering.get(at);
    if (!block || !incoming) continue;

    const state = cloneState(incoming);
    for (const instruction of block.instructions) {
      before.set(instruction.address, cloneState(state));
      stepAbstract(state, lift(instruction));
    }

    const propagate = (next: number, outgoing: AbstractState) => {
      if (!byStart.has(next)) return;
      const held = entering.get(next);
      const merged = held ? joinStates(held, outgoing) : cloneState(outgoing);
      if (held && sameState(held, merged)) return;
      entering.set(next, merged);
      queue.push(next);
    };

    if (block.exit === "call") {
      // The callee gets the state as it stands. Without this a routine body is
      // a block nothing ever enters — a `JSR`'s successor is where it *returns
      // to*, not where it goes — and the answer everywhere inside it is
      // "unknown". That is exactly how the first decimal proof came back
      // unknown at 17 of Gridrunner's 19 sites, and it is worth failing for
      // twice only if the second time is written down.
      for (const target of block.calls) propagate(target, state);

      // What the caller sees afterwards loses whatever the callee can write,
      // and keeps what it cannot — which is the whole value of asking.
      const resumed = cloneState(state);
      const touched = new Set<number>();
      for (const target of block.calls) for (const offset of written(target)) touched.add(offset);
      for (const offset of touched) {
        // Keep the taint: the depth is still relative to where we started, since
        // an ordinary call returns balanced. A callee that does not is reported
        // by `describeReturns` rather than guessed at here.
        resumed.registers[offset] = {
          bits: unknown(),
          fromStack: resumed.registers[offset]?.fromStack ?? offset === REG.SP,
        };
      }
      resumed.memory.clear();
      for (const next of block.successors) propagate(next, resumed);
      continue;
    }

    for (const next of block.successors) propagate(next, state);
  }
  };

  drain();

  // Now the origins that are re-entered from inside the program.
  //
  // An interrupt can arrive between any two instructions, so its handler is
  // entered with the join of the state everywhere; a `BRK` handler is entered
  // only from the `BRK` instructions, which is both narrower and more useful.
  // Either way the processor pushes the return address and the status byte,
  // sets `I`, and changes nothing else — so the handler inherits `A`, `X`, `Y`,
  // memory, and every flag but `I`.
  //
  // Repeated because the handler's own instructions become states to join over,
  // and stopped when nothing moves. It converges because joining can only ever
  // lose precision.
  const brkSites: number[] = [];
  for (const block of real) {
    for (const instruction of block.instructions) {
      if (instruction.mnemonic.toUpperCase() === "BRK") brkSites.push(instruction.address);
    }
  }

  for (let round = 0; round < 4 && reentrant.length > 0; round++) {
    let moved = false;
    for (const origin of reentrant) {
      const kind = kindOf(origin);
      const sites = kind === "brk" ? brkSites : [...before.keys()];
      const breakFlag =
        kind === "brk" ? exact(1, 1) : kind === "interrupt" ? exact(0, 1) : unknown();
      const entered = interruptedState(sites, before, breakFlag);
      if (!entered) continue;
      const held = entering.get(origin);
      const merged = held ? joinStates(held, entered) : entered;
      if (held && sameState(held, merged)) continue;
      entering.set(origin, merged);
      queue.push(origin);
      moved = true;
    }
    if (!moved) break;
    drain();
  }

  // Anything still unreached, analysed conservatively — and only now, so it
  // cannot take back what the origins proved on the way in, nor pre-empt a
  // handler's derived entry state with a blanket "nothing is known".
  for (const root of options.cover ?? []) {
    if (entering.has(root)) continue;
    seed(root);
    drain();
  }

  return { before };
}

/**
 * What a handler is entered with, given every point it can be entered from.
 *
 * The processor's own contribution is three bytes on the stack and `I` set. The
 * status byte is assembled from the joined flags, so `PLP` restores what the
 * interrupted code had and `PLA / AND #$10` answers about `B` — which is the
 * only place `B` exists on this machine.
 *
 * The stack is seeded as exactly those three entries rather than as the joined
 * one. Depths differ all over a program, so a joined stack is abandoned almost
 * immediately, and abandoning it is the one thing that makes `B` unreachable.
 * Claiming a depth of three is not a claim that nothing is underneath: a fourth
 * pull simply comes back unknown, which is the truth.
 */
function interruptedState(
  sites: readonly number[],
  before: ReadonlyMap<number, AbstractState>,
  breakFlag: Bits
): AbstractState | undefined {
  let joined: AbstractState | undefined;
  for (const at of sites) {
    const state = before.get(at);
    if (!state) continue;
    joined = joined ? joinStates(joined, state) : cloneState(state);
  }
  if (!joined) return undefined;

  const flag = (offset: number): Bits => joined!.registers[offset]?.bits ?? unknown();
  // Masked to its own bit *before* shifting, so every other bit is a known
  // zero. Without that, OR-ing in one unknown flag destroys a known zero
  // elsewhere in the byte — which is exactly bit four, and would lose `B` for a
  // hardware interrupt while keeping it for a `BRK`, since OR preserves a known
  // one and not a known zero.
  const bit = (value: Bits, shift: number): Bits =>
    shiftLeft(and(value, exact(1, 1), 1), exact(shift, 1), 1);

  // Bit 5 has no flag behind it and reads as set; bit 4 is `B`, which is a
  // property of how the byte got here rather than of any stored state.
  let status: Bits = or(exact(0x20, 1), shiftLeft(and(breakFlag, exact(1, 1), 1), exact(4, 1), 1), 1);
  for (const [offset, shift] of [
    [REG.C, 0],
    [REG.Z, 1],
    [REG.I, 2],
    [REG.D, 3],
    [REG.V, 6],
    [REG.N, 7],
  ] as const) {
    status = or(status, bit(flag(offset), shift), 1);
  }

  const entered = cloneState(joined);
  entered.registers[REG.I] = { bits: exact(1, 1), fromStack: false };
  entered.stack = [unknown(), unknown(), status];
  return entered;
}

/**
 * Which registers each flag lives in, by the name this project uses for it.
 *
 * Every flag is an ordinary register the lifter writes, which is the point: `D`
 * comes from `SED`/`CLD`, `Z` and `N` from whatever value an instruction
 * produced, and `C` from arithmetic. There is no rule per flag any more.
 */
export const FLAG_REGISTER = {
  carry: REG.C,
  zero: REG.Z,
  interruptDisable: REG.I,
  decimal: REG.D,
  break: REG.B,
  overflow: REG.V,
  negative: REG.N,
} as const;

/** A flag as it stands before an instruction runs. */
export function flagBefore(analysis: ValueAnalysis, address: number, flag: number): Known {
  const state = analysis.before.get(address);
  if (!state) return "unknown";
  const bits = state.registers[flag]?.bits;
  if (!bits || (bits.known & 1) === 0) return "unknown";
  return bits.value & 1 ? "set" : "clear";
}

/** A register's bits before an instruction runs, for anything wanting more than a flag. */
export function valueBefore(analysis: ValueAnalysis, address: number, register: number): Bits {
  return analysis.before.get(address)?.registers[register]?.bits ?? unknown();
}

/** What is on the stack before an instruction, deepest first, or undefined if abandoned. */
export function stackBefore(
  analysis: ValueAnalysis,
  address: number
): readonly Bits[] | undefined {
  return analysis.before.get(address)?.stack;
}

/** Every operation an instruction performs, for callers that want the lift too. */
export function operationsOf(instruction: Parameters<typeof lift>[0]): readonly PcodeOp[] {
  return lift(instruction);
}

export type { AbstractState, Varnode };
