/**
 * Running a program without knowing its inputs.
 *
 * The same operations the concrete interpreter runs, over values whose bits are
 * individually known or not — so `LDA #$00 / ORA $10` leaves `Z` undecided and
 * `AND #$7F` proves `N` clear without knowing one other bit.
 *
 * **Not symbolic execution**, and the line is worth stating because it is what
 * keeps this cheap. A symbolic domain tracks *expressions*, so it can say "A
 * equals whatever X was" and relate two values it never learned. This tracks
 * per-bit facts only: it cannot say two unknowns are equal, and it never builds
 * a term. In exchange, every value has a fixed size, the lattice has finite
 * height, and a fixpoint over a loop terminates without a widening rule.
 *
 * The stack is modelled as a stack rather than as memory. The absolute address
 * is not knowable — nothing says where `SP` started — but *what was pushed* is,
 * so a value keeps its identity across `PHP … PLP` even though the cell it sat
 * in is anonymous. Addresses derived from `SP` are recognised by taint, the same
 * property `blockEffects` uses to keep the stack out of "an address I could not
 * name", and the stack is abandoned outright when `SP` is assigned from anywhere
 * else — which is `TXS`, and means the depth is no longer relative to anything.
 */

import { Machine, executeOne } from "./interpret.js";
import { FLAGS, PcodeOp, REG, Varnode } from "./pcode.js";
import {
  Bits,
  add,
  addWithCarry,
  and,
  concat,
  equal,
  exact,
  isExact,
  join,
  lessThan,
  negate,
  not,
  or,
  same,
  shiftLeft,
  tagged,
  taggedBit,
  shiftRight,
  signExtend,
  signedLessThan,
  subpiece,
  subtract,
  truncate,
  unknown,
  xor,
  zeroExtend,
} from "./known-bits.js";

/** A value, and whether it was computed from the stack pointer. */
interface Tracked {
  bits: Bits;
  /** True when this came from `SP`, so an address built on it is a stack slot. */
  fromStack: boolean;
}

const opaque = (): Tracked => ({ bits: unknown(), fromStack: false });

/**
 * Either of two flag-shaped bits, where one being known true settles it.
 *
 * `a <= b` is `a < b || a == b`, and either half alone can decide it — so this
 * must not simply demand that both are known.
 */
function orBool(a: Bits, b: Bits): Bits {
  const isTrue = (x: Bits) => (x.known & 1) !== 0 && (x.value & 1) !== 0;
  const isFalse = (x: Bits) => (x.known & 1) !== 0 && (x.value & 1) === 0;
  if (isTrue(a) || isTrue(b)) return exact(1, 1);
  if (isFalse(a) && isFalse(b)) return exact(0, 1);
  return unknown();
}

export interface AbstractState {
  /** By register offset, including the flags. */
  registers: Tracked[];
  /** Cells whose contents are partly known. Absent means nothing is known. */
  memory: Map<number, Bits>;
  /**
   * What is on the stack, deepest first, or `undefined` once abandoned.
   *
   * Abandoned by `TXS`, and by two paths meeting at different depths — after
   * either, "the value two pushes ago" no longer names anything.
   */
  stack: Bits[] | undefined;
}

/**
 * The identity given to bit `bit` of the register at `offset`.
 *
 * Non-zero and unique, so "still whatever it was" is decidable by comparison.
 * Sixteen registers of eight bits fit in a byte with room to spare.
 */
export const identityOf = (offset: number, bit: number): number => offset * 8 + bit + 1;

export function initialState(identity = false): AbstractState {
  const registers = Array.from({ length: 16 }, opaque);
  if (identity) {
    const isFlag = new Set<number>(FLAGS);
    for (let offset = 0; offset < registers.length; offset++) {
      // A flag holds nought or one, and saying so is what lets `PHP` merge the
      // seven of them into a byte without losing which is which.
      const bits = isFlag.has(offset)
        ? taggedBit(identityOf(offset, 0))
        : tagged(identityOf(offset, 0), 1);
      registers[offset] = { bits, fromStack: false };
    }
  }
  // The stack pointer's *value* is unknown — nothing says where it started — but
  // it is the origin of the taint, so an address built on it is recognisable as
  // a stack slot. That is the whole trick: the cell is anonymous, the position
  // is not.
  registers[REG.SP] = { bits: registers[REG.SP].bits, fromStack: true };
  return { registers, memory: new Map(), stack: [] };
}

export function cloneState(state: AbstractState): AbstractState {
  return {
    registers: state.registers.map((r) => ({ ...r })),
    memory: new Map(state.memory),
    stack: state.stack ? [...state.stack] : undefined,
  };
}

/** What two paths agree on. A bit survives only where both know it and match. */
export function joinStates(a: AbstractState, b: AbstractState): AbstractState {
  const registers = a.registers.map((left, i) => {
    const right = b.registers[i];
    return {
      bits: join(left.bits, right.bits, i === REG.PC ? 2 : 1),
      fromStack: left.fromStack && right.fromStack,
    };
  });

  const memory = new Map<number, Bits>();
  for (const [address, left] of a.memory) {
    const right = b.memory.get(address);
    if (!right) continue;
    const merged = join(left, right, 1);
    if (merged.known !== 0) memory.set(address, merged);
  }

  // Different depths mean the stack no longer names anything positionally, which
  // is the same reason `describeReturns` calls that case ambiguous.
  const stack =
    a.stack && b.stack && a.stack.length === b.stack.length
      ? a.stack.map((v, i) => join(v, b.stack![i], 1))
      : undefined;

  return { registers, memory, stack };
}

export function sameState(a: AbstractState, b: AbstractState): boolean {
  if (a.registers.length !== b.registers.length) return false;
  for (const [i, left] of a.registers.entries()) {
    if (!same(left.bits, b.registers[i].bits)) return false;
    if (left.fromStack !== b.registers[i].fromStack) return false;
  }
  if (a.memory.size !== b.memory.size) return false;
  for (const [address, value] of a.memory) {
    const other = b.memory.get(address);
    if (!other || !same(value, other)) return false;
  }
  if ((a.stack === undefined) !== (b.stack === undefined)) return false;
  if (a.stack && b.stack) {
    if (a.stack.length !== b.stack.length) return false;
    for (const [i, value] of a.stack.entries()) if (!same(value, b.stack[i])) return false;
  }
  return true;
}

/**
 * Run one instruction's operations over the abstract state.
 *
 * Every operation this does not model bit-precisely falls back to the concrete
 * interpreter when its inputs happen to be fully known, and to `unknown`
 * otherwise. That is why `executeOne` was split out: 37 opcodes written twice
 * is 37 chances for the two to disagree, and the abstract copy is the one no
 * functional test suite ever runs.
 */
export function stepAbstract(state: AbstractState, ops: readonly PcodeOp[]): void {
  const temporaries = new Map<number, Tracked>();

  const read = (node: Varnode): Tracked => {
    switch (node.space) {
      case "const":
        return { bits: exact(node.offset, node.size), fromStack: false };
      case "register":
        return state.registers[node.offset] ?? opaque();
      case "unique":
        return temporaries.get(node.offset) ?? opaque();
      case "ram": {
        const held = state.memory.get(node.offset);
        return { bits: held ? truncate(held, node.size) : unknown(), fromStack: false };
      }
    }
  };

  const write = (node: Varnode | undefined, result: Tracked): void => {
    if (!node) return;
    switch (node.space) {
      case "register":
        // Assigning SP from anything not derived from it is TXS: the depth stops
        // being relative to where this routine started, so nothing on the stack
        // can still be addressed by position.
        if (node.offset === REG.SP && !result.fromStack) state.stack = undefined;
        state.registers[node.offset] = {
          bits: truncate(result.bits, node.size),
          fromStack: result.fromStack || node.offset === REG.SP,
        };
        break;
      case "unique":
        temporaries.set(node.offset, { ...result, bits: truncate(result.bits, node.size) });
        break;
      case "ram":
        state.memory.set(node.offset, truncate(result.bits, node.size));
        break;
      case "const":
        break;
    }
  };

  for (const op of ops) {
    const inputs = op.inputs.map(read);
    const size = op.output?.size ?? 1;
    const tainted = inputs.some((i) => i.fromStack);
    const plain = (bits: Bits) => write(op.output, { bits, fromStack: tainted });

    switch (op.op) {
      case "COPY":
        write(op.output, { bits: truncate(inputs[0].bits, size), fromStack: inputs[0].fromStack });
        continue;

      case "LOAD": {
        const address = inputs[1];
        if (address.fromStack) {
          // A pull. The stack pointer has already been stepped by the operation
          // before this one, so the value wanted is the one on top.
          const value = state.stack?.pop();
          plain(value ?? unknown());
          continue;
        }
        if (isExact(address.bits, op.inputs[1].size)) {
          const held = state.memory.get(address.bits.value);
          plain(held ? truncate(held, size) : unknown());
          continue;
        }
        plain(unknown());
        continue;
      }

      case "STORE": {
        const address = inputs[1];
        if (address.fromStack) {
          state.stack?.push(truncate(inputs[2].bits, op.inputs[2].size));
          continue;
        }
        if (isExact(address.bits, op.inputs[1].size)) {
          state.memory.set(address.bits.value, truncate(inputs[2].bits, op.inputs[2].size));
          continue;
        }
        // A write nobody can place could have landed anywhere, so nothing about
        // memory survives it. The stack does: it is addressed by position rather
        // than by number, and this store was not on it.
        state.memory.clear();
        continue;
      }

      case "INT_AND":
        plain(and(inputs[0].bits, inputs[1].bits, size));
        continue;
      case "INT_OR":
        plain(or(inputs[0].bits, inputs[1].bits, size));
        continue;
      case "INT_XOR":
        plain(xor(inputs[0].bits, inputs[1].bits, size));
        continue;
      case "INT_NEGATE":
        plain(not(inputs[0].bits, size));
        continue;
      case "INT_ADD":
        plain(add(inputs[0].bits, inputs[1].bits, size));
        continue;
      case "INT_SUB":
        plain(subtract(inputs[0].bits, inputs[1].bits, size));
        continue;
      case "INT_2COMP":
        plain(negate(inputs[0].bits, size));
        continue;
      case "INT_LEFT":
        plain(shiftLeft(inputs[0].bits, inputs[1].bits, size));
        continue;
      case "INT_RIGHT":
        plain(shiftRight(inputs[0].bits, inputs[1].bits, size));
        continue;
      case "INT_ZEXT":
        plain(zeroExtend(inputs[0].bits, op.inputs[0].size, size));
        continue;
      case "INT_SEXT":
        plain(signExtend(inputs[0].bits, op.inputs[0].size, size));
        continue;
      case "SUBPIECE":
        plain(subpiece(inputs[0].bits, inputs[1].bits.value, size));
        continue;
      case "PIECE":
        plain(concat(inputs[0].bits, inputs[1].bits, op.inputs[1].size, size));
        continue;
      case "INT_LESS":
        plain(lessThan(inputs[0].bits, inputs[1].bits, op.inputs[0].size));
        continue;
      case "INT_SLESS":
        plain(signedLessThan(inputs[0].bits, inputs[1].bits, op.inputs[0].size));
        continue;
      case "INT_LESSEQUAL": {
        const less = lessThan(inputs[0].bits, inputs[1].bits, op.inputs[0].size);
        const eq = equal(inputs[0].bits, inputs[1].bits, op.inputs[0].size);
        plain(orBool(less, eq));
        continue;
      }
      case "INT_SLESSEQUAL": {
        const less = signedLessThan(inputs[0].bits, inputs[1].bits, op.inputs[0].size);
        const eq = equal(inputs[0].bits, inputs[1].bits, op.inputs[0].size);
        plain(orBool(less, eq));
        continue;
      }
      case "INT_EQUAL":
        plain(equal(inputs[0].bits, inputs[1].bits, op.inputs[0].size));
        continue;
      case "INT_NOTEQUAL": {
        const eq = equal(inputs[0].bits, inputs[1].bits, op.inputs[0].size);
        plain(eq.known === 0 ? unknown() : exact(eq.value ? 0 : 1, 1));
        continue;
      }
      // The carry and the overflow out of an addition are single bits, and both
      // are often settled where the sum is not — two known zeros in the top bits
      // carry nothing whatever the low bits do.
      case "INT_CARRY":
        plain(addWithCarry(inputs[0].bits, inputs[1].bits, exact(0, 1), op.inputs[0].size).carry);
        continue;
      case "INT_SCARRY":
        plain(
          addWithCarry(inputs[0].bits, inputs[1].bits, exact(0, 1), op.inputs[0].size).overflow
        );
        continue;
      case "BOOL_NEGATE": {
        const v = inputs[0].bits;
        plain(v.known & 1 ? exact(v.value & 1 ? 0 : 1, 1) : unknown());
        continue;
      }
      default:
        plain(concretely(op, inputs) ?? unknown());
        continue;
    }
  }
}

/**
 * The concrete answer, where every input happens to be fully determined.
 *
 * Borrowed rather than restated: these are the semantics Klaus Dormann's suite
 * is run against, and a second copy would be the one nobody checks.
 */
function concretely(op: PcodeOp, inputs: readonly Tracked[]): Bits | undefined {
  if (!op.output) return undefined;
  for (const [i, node] of op.inputs.entries()) {
    if (node.space === "const") continue;
    if (!isExact(inputs[i].bits, node.size)) return undefined;
  }

  const machine = new Machine();
  op.inputs.forEach((node, i) => {
    if (node.space !== "const") machine.set(node, inputs[i].bits.value);
  });
  executeOne(op, machine);
  return exact(machine.get(op.output), op.output.size);
}
