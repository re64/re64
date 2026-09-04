/**
 * Where decimal mode is on, proved rather than assumed.
 *
 * `lift` takes a `DecimalMode`, and until this existed nothing computed one:
 * every static caller took the binary default, which is a *guess* that happens
 * to be right on the programs to hand. Effect sets come out identical either
 * way, so nothing showed — but a reader of the lifted operations was being told
 * something the analysis had not established.
 *
 * `D` is set by `SED`, cleared by `CLD`, and restored from the stack by `PLP`
 * and `RTI`. Within a block that is a straight read, because a block is a
 * straight line; across blocks it is a forward dataflow to a fixpoint, the same
 * shape `analyzeRoutines` already runs for effects.
 *
 * **Entry points start `unknown`, not clear.** A 6502 does not clear `D` on
 * reset or on an interrupt — unlike the 65C02 — which is exactly why real reset
 * routines and KERNAL interrupt handlers do it themselves. Assuming clear at an
 * entry would be assuming the very thing those `CLD`s exist to establish.
 *
 * On both real targets here the proof lands on `binary` everywhere: Gridrunner
 * clears `D` once at `$83C2` and never sets it, and the KERNAL clears it in its
 * reset routine at `$FCE6` with no reachable `SED` anywhere in 8KB. So the cost
 * of modelling decimal falls only on programs that genuinely leave it in doubt.
 */

import { BasicBlock } from "./blocks.js";
import { DecimalMode } from "../il/lift.js";

/** What is known about `D` at a point. */
export type DecimalState = "clear" | "set" | "unknown";

/**
 * Two paths meeting. Agreement survives; disagreement does not.
 *
 * `undefined` means a path has not been seen yet, so it contributes nothing —
 * without that, the first predecessor examined would drag every block to
 * `unknown` before the fixpoint had a chance to agree.
 */
function meet(a: DecimalState | undefined, b: DecimalState): DecimalState {
  if (a === undefined) return b;
  return a === b ? a : "unknown";
}

/** How one instruction changes what is known. */
function after(state: DecimalState, mnemonic: string): DecimalState {
  switch (mnemonic) {
    case "SED":
      return "set";
    case "CLD":
      return "clear";
    // Off the stack, so it is whatever was pushed. `RTI` is why an interrupt
    // handler can leave `D` however it found it.
    case "PLP":
    case "RTI":
      return "unknown";
    default:
      return state;
  }
}

const MODE: Record<DecimalState, DecimalMode> = {
  clear: "binary",
  set: "decimal",
  unknown: "unknown",
};

/**
 * The decimal mode in force at every instruction that cares about it.
 *
 * Only `ADC` and `SBC` appear: they are the only instructions whose result
 * depends on `D`, so a map of every address would be mostly noise.
 */
export function decimalModes(
  blocks: readonly BasicBlock[],
  entryPoints: readonly number[]
): Map<number, DecimalMode> {
  const real = blocks.filter((b) => !b.alternate);
  const byStart = new Map(real.map((b) => [b.start, b]));

  /** What is known on entry to each block. */
  const entering = new Map<number, DecimalState>();
  /**
   * Whether anything reachable from a call target can change `D`.
   *
   * The analysis has to be interprocedural or it says nothing. A first version
   * followed `successors` only — which deliberately exclude the call target,
   * since a `JSR`'s successor is where it *returns to* — so every routine body
   * was a block nothing entered, seeded `unknown`, and the answer came back
   * `unknown` at 17 of Gridrunner's 19 sites. Its one `CLD` is in `ColdStart`
   * and never reached the routines `ColdStart` calls.
   *
   * Asking what a callee *leaves* would be more precise and needs a second
   * fixpoint over routine exits. Asking whether it can touch the flag at all is
   * one walk, and answers the question that actually arises: almost nothing
   * does, so the caller carries on with what it had.
   */
  const touchesD = new Map<number, boolean>();
  const canTouchD = (target: number): boolean => {
    const known = touchesD.get(target);
    if (known !== undefined) return known;
    // Assume the worst while walking, so a recursive routine terminates by
    // answering conservatively rather than by looping.
    touchesD.set(target, true);

    const seen = new Set<number>();
    const pending = [target];
    let found = false;
    while (pending.length > 0) {
      const at = pending.pop()!;
      if (seen.has(at)) continue;
      seen.add(at);
      const block = byStart.get(at);
      if (!block) continue;
      for (const instruction of block.instructions) {
        const mnemonic = instruction.mnemonic.toUpperCase();
        if (mnemonic === "SED" || mnemonic === "CLD" || mnemonic === "PLP" || mnemonic === "RTI") {
          found = true;
        }
      }
      pending.push(...block.successors, ...block.calls);
    }

    touchesD.set(target, found);
    return found;
  };

  const modes = new Map<number, DecimalMode>();
  const queue: number[] = [];
  let guard = real.length * 16 + 1024;

  const push = (start: number, state: DecimalState) => {
    if (!byStart.has(start)) return;
    const merged = meet(entering.get(start), state);
    if (entering.get(start) === merged) return;
    entering.set(start, merged);
    queue.push(start);
  };

  const settle = () => {
    while (queue.length > 0 && guard-- > 0) {
      const start = queue.shift()!;
      const block = byStart.get(start);
      if (!block) continue;

      let state = entering.get(start) ?? "unknown";
      for (const instruction of block.instructions) {
        const mnemonic = instruction.mnemonic.toUpperCase();
        if (mnemonic === "ADC" || mnemonic === "SBC") {
          const known = modes.get(instruction.address);
          const now = MODE[state];
          // A site reached two ways is only proved if both ways agree.
          modes.set(instruction.address, known === undefined || known === now ? now : "unknown");
        }
        state = after(state, mnemonic);
      }

      // Into whatever it calls, with the flag as it stands at the call.
      for (const target of block.calls) push(target, state);

      // A callee that cannot touch the flag leaves it as it found it, so the
      // caller carries straight on. One that might makes everything after the
      // call unknown, which is the honest answer and is rare.
      if (block.exit === "call" && block.calls.some(canTouchD)) state = "unknown";

      for (const next of block.successors) push(next, state);
    }
  };

  for (const entry of entryPoints) push(entry, "unknown");
  settle();

  // Only now: a block the walk never entered gets `unknown` and is read on its
  // own terms. Seeding these up front is what a first version did, and it
  // defeats the analysis — `unknown` meets everything to `unknown`, so a block
  // would be spoiled by its own placeholder before any predecessor agreed.
  for (const block of real) {
    if (entering.has(block.start)) continue;
    push(block.start, "unknown");
    settle();
  }

  return modes;
}

/**
 * The sites that are not plain binary — which is the interesting answer.
 *
 * A by-product worth having on its own: BCD arithmetic on this machine almost
 * always means a score, a clock, or a number being shown to somebody, so
 * "decimal here" is a lead rather than a curiosity.
 */
export function decimalSites(
  blocks: readonly BasicBlock[],
  entryPoints: readonly number[]
): { address: number; mode: DecimalMode }[] {
  return [...decimalModes(blocks, entryPoints)]
    .filter(([, mode]) => mode !== "binary")
    .map(([address, mode]) => ({ address, mode }))
    .sort((a, b) => a.address - b.address);
}
