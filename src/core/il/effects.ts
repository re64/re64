/**
 * What a block touches, without running it.
 *
 * The static half of the same question `runBlock` answers concretely, and the
 * one that holds for *every* input rather than for one. "This block writes A and
 * $D020" is a fact about the code; "given X=3 it writes 6 to $D020" is a fact
 * about a run. Neither substitutes for the other, and an agent reading a routine
 * generally wants this one first.
 *
 * Computed by union over the block's lifted operations, which is sound because a
 * block is straight-line: every instruction in it runs, in order, with no branch
 * inside for the answer to depend on. That is the analysis dividend of splitting
 * blocks strictly — at calls and at every jump target — rather than loosely.
 *
 * Memory is reported only where the address is static. `LDA $10` names `$(0x10)`;
 * `LDA $10,X` cannot name anything and is reported as `readsComputedMemory`
 * instead, because inventing an address would be worse than admitting to one.
 */

import { Instruction } from "../arch/mos6502/instruction.js";
import { DecimalMode, lift } from "./lift.js";
import {
  FLAGS,
  PcodeOp,
  REG,
  Varnode,
  formatVarnode,
  reads,
  sameVarnode,
  writes,
} from "./pcode.js";

export interface BlockEffects {
  /** Slots read before this block wrote them: what it depends on. */
  inputs: Varnode[];
  /** Slots left changed: what it produces. */
  outputs: Varnode[];
  /** Flags written, by register offset — usually the question being asked. */
  flags: number[];
  /** True when some address it reads or writes depends on a register. */
  readsComputedMemory: boolean;
  writesComputedMemory: boolean;
  /**
   * Instructions with no semantics here.
   *
   * Non-empty means the sets above are incomplete, and by an unknown amount —
   * an unlifted instruction could touch anything. Reported rather than folded
   * in, so a caller can decide whether a partial answer is usable.
   */
  unmodelled: { address: number; mnemonic: string }[];
}

/**
 * Union the effects of a sequence of operation-lists.
 *
 * The ordering rule from a single instruction carries over unchanged: a slot
 * counts as an input only if something reads it before anything in this block
 * has written it. A loop counter incremented and then tested is an input; one
 * loaded and then tested is not.
 */
function accumulate(sequences: readonly (readonly PcodeOp[])[]): {
  inputs: Varnode[];
  outputs: Varnode[];
} {
  const inputs: Varnode[] = [];
  const outputs: Varnode[] = [];

  for (const ops of sequences) {
    for (const node of reads(ops)) {
      if (node.space === "unique") continue;
      if (outputs.some((v) => sameVarnode(v, node))) continue;
      if (!inputs.some((v) => sameVarnode(v, node))) inputs.push(node);
    }
    for (const node of writes(ops)) {
      if (!outputs.some((v) => sameVarnode(v, node))) outputs.push(node);
    }
  }

  return { inputs, outputs };
}

export function blockEffects(
  instructions: readonly Instruction[],
  /**
   * What was proved about `D` at each address, where anybody has proved it.
   *
   * Optional because a caller holding a bare instruction list has no block
   * graph to prove anything from, and the effect sets are identical either
   * way — the decimal select touches exactly the same registers as the binary
   * path, which is what made choosing branchless worth it. It matters for the
   * *operations*, which is what anybody reading the lift is shown.
   */
  decimal?: ReadonlyMap<number, DecimalMode>
): BlockEffects {
  const sequences = instructions.map((instr) => lift(instr, decimal?.get(instr.address)));
  const { inputs, outputs } = accumulate(sequences);

  const unmodelled = instructions
    .filter((instr, i) => sequences[i].some((op) => op.op === "CALLOTHER"))
    .map((instr) => ({ address: instr.address, mnemonic: instr.mnemonic }));

  // A dynamic address arrives as a LOAD or STORE; a static one is a `ram`
  // varnode and never becomes either.
  const all = sequences.flat();

  return {
    inputs,
    outputs,
    flags: outputs
      .filter((v) => v.space === "register" && (FLAGS as readonly number[]).includes(v.offset))
      .map((v) => v.offset),
    readsComputedMemory: all.some((op) => op.op === "LOAD"),
    writesComputedMemory: all.some((op) => op.op === "STORE"),
    unmodelled,
  };
}

/** The effects as short readable lists, for a listing or a tool result. */
export function describeEffects(effects: BlockEffects): { reads: string[]; writes: string[] } {
  const reads = effects.inputs.map(formatVarnode);
  const writes = effects.outputs.map(formatVarnode);
  if (effects.readsComputedMemory) reads.push("memory at a computed address");
  if (effects.writesComputedMemory) writes.push("memory at a computed address");
  return { reads, writes };
}

/**
 * Net bytes a straight-line run leaves on the stack, or undefined when that
 * cannot be known.
 *
 * Derived from the lifted operations rather than from a table of which nine
 * opcodes touch the stack. That table was a stopgap and this is what replaces
 * it: `JSR` counts two because it emits two pushes, not because somebody wrote
 * `2` beside its name, so the count cannot drift away from the semantics.
 *
 * Exact only because a block is straight-line — there is no branch inside one
 * for the total to depend on.
 *
 * Undefined the moment the stack pointer is written by anything other than a
 * step of a known size. `TXS` is the case that matters: it *sets* the pointer,
 * so the delta is whatever the program decided, and reporting zero would be a
 * guess dressed as an answer.
 *
 * It exists because `RTS` on this machine does not reliably return to its
 * caller. Pushing an address and returning is a standard computed jump, and
 * popping the return address to read inline data is a standard way to pass
 * arguments — a block ending in `ret` with a non-zero delta is doing one of
 * those, and a call graph assuming the ordinary return edge is wrong about it.
 */
export function stackDelta(instructions: readonly Instruction[]): number | undefined {
  let delta = 0;

  for (const instruction of instructions) {
    for (const op of lift(instruction)) {
      if (!op.output || op.output.space !== "register" || op.output.offset !== REG.SP) continue;

      // Pushes and pulls are `SP = SP ± n`. Anything else writing SP — `TXS`
      // above all — cannot be reduced to a number.
      if (op.op !== "INT_ADD" && op.op !== "INT_SUB") return undefined;
      const [target, amount] = op.inputs;
      if (target?.space !== "register" || target.offset !== REG.SP) return undefined;
      if (amount?.space !== "const") return undefined;

      // The stack grows downward, so a push is a subtraction and counts as a
      // byte gained.
      delta += op.op === "INT_SUB" ? amount.offset : -amount.offset;
    }
  }

  return delta;
}
