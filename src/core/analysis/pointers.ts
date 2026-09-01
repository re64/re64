/**
 * Where an indirect access actually goes, when that can be known.
 *
 * `STA ($02),Y` names no address, so a search over an address range cannot see
 * it — and on this machine that is not a corner case. Gridrunner writes the
 * VIC-II *only* through a pointer, so asking "what touches $D000-$D02E" returned
 * a single dead instruction and missed every write that matters. Two readers hit
 * that independently.
 *
 * What makes it recoverable is that the pointer is usually built from immediate
 * loads a few instructions earlier: `LDA #$D0 / STA $03` and `LDA #$00 / STA $02`
 * make `($02),Y` mean `$D000,Y`. That is constant folding, not symbolic
 * execution — it needs no path exploration and no solver.
 *
 * **It stops rather than guesses**, in two places that matter:
 *
 * - At a **join**. Walking back from the access through single predecessors is
 *   path-insensitive *and sound* precisely because there is one way in; the
 *   moment a block has two predecessors the answer could differ per path, so
 *   there is no answer to give.
 * - At a **computed store**. Gridrunner's screen pointer is loaded from a table
 *   (`LDA $0340,X / STA $06`), so it genuinely depends on runtime state.
 *   Reporting a base for that would be inventing one.
 *
 * Both are the same rule the rest of this project follows: an explicit gap beats
 * a confident wrong answer.
 */

import { Instruction } from "../arch/mos6502/instruction.js";
import { BasicBlock } from "./blocks.js";

export interface ResolvedPointer {
  /** The address the pointer holds, before indexing. */
  base: number;
  /** Where the two halves were set, so a reader can check the claim. */
  setAt: number[];
}

/** How far back to look. Beyond this the pointer is somebody else's business. */
const MAX_BLOCKS = 4;

/** The zero-page pair an indirect operand names, or undefined for anything else. */
function pointerOf(instruction: Instruction): number | undefined {
  const operand = instruction.operand;
  return operand.type === "indirectIndexed" || operand.type === "indexedIndirect"
    ? operand.address
    : undefined;
}

/**
 * Resolve the pointer an indirect instruction uses, by looking back for the
 * immediate loads that built it.
 *
 * Returns undefined whenever anything is in doubt — a join, a computed store, or
 * simply running out of room to look.
 */
export function resolvePointer(
  instruction: Instruction,
  blocks: readonly BasicBlock[]
): ResolvedPointer | undefined {
  const pointer = pointerOf(instruction);
  if (pointer === undefined) return undefined;

  const real = blocks.filter((b) => !b.alternate);
  const containing = real.find(
    (b) => instruction.address >= b.start && instruction.address < b.end
  );
  if (!containing) return undefined;

  const half = new Map<number, { value: number; at: number }>();
  let block: BasicBlock | undefined = containing;
  let before = instruction.address;

  for (let depth = 0; depth < MAX_BLOCKS && block; depth++) {
    // Backwards through the block, so the *nearest* store to each half wins —
    // which is what actually executed.
    const body = block.instructions.filter((i) => i.address < before);
    for (let i = body.length - 1; i >= 0; i--) {
      const store = body[i];
      if (store.mnemonic !== "STA" && store.mnemonic !== "STX" && store.mnemonic !== "STY") continue;
      if (store.operand.type !== "zeroPage") continue;

      const slot = store.operand.address;
      if (slot !== pointer && slot !== pointer + 1) continue;
      if (half.has(slot)) continue;

      // What was loaded into that register immediately before? Anything other
      // than a literal — a table read, arithmetic — means the pointer is built
      // at runtime and there is nothing constant to fold.
      const load = body[i - 1];
      const wanted =
        store.mnemonic === "STA" ? "LDA" : store.mnemonic === "STX" ? "LDX" : "LDY";
      if (!load || load.mnemonic !== wanted || load.operand.type !== "immediate") return undefined;

      half.set(slot, { value: load.operand.value, at: load.address });
      if (half.size === 2) {
        const lo = half.get(pointer)!;
        const hi = half.get(pointer + 1)!;
        return {
          base: (lo.value | (hi.value << 8)) & 0xffff,
          setAt: [lo.at, hi.at].sort((a, b) => a - b),
        };
      }
    }

    // One way in, or no answer. With two predecessors the halves could have been
    // set differently on each path, and picking one would be a guess.
    const predecessors = real.filter((b) => b.successors.includes(block!.start));
    if (predecessors.length !== 1) return undefined;
    block = predecessors[0];
    before = block.end;
  }

  return undefined;
}

/** Every address an instruction is known to touch: its operand, or a resolved pointer. */
export function targetsOf(
  instruction: Instruction,
  blocks: readonly BasicBlock[]
): { address: number; indirect: boolean; setAt?: number[] } | undefined {
  const operand = instruction.operand as { address?: number; type: string };
  if (pointerOf(instruction) !== undefined) {
    const resolved = resolvePointer(instruction, blocks);
    return resolved
      ? { address: resolved.base, indirect: true, setAt: resolved.setAt }
      : undefined;
  }
  return operand.address === undefined ? undefined : { address: operand.address, indirect: false };
}
