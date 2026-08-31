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

import { BasicBlock } from "../analysis/blocks.js";
import { lift } from "./lift.js";
import { FLAGS, PcodeOp, Varnode, formatVarnode, reads, sameVarnode, writes } from "./pcode.js";

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

export function blockEffects(block: BasicBlock): BlockEffects {
  const sequences = block.instructions.map(lift);
  const { inputs, outputs } = accumulate(sequences);

  const unmodelled = block.instructions
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
