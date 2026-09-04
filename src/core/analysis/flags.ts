/**
 * What is known about a processor flag at each instruction, proved rather than
 * assumed.
 *
 * `lift` takes a `DecimalMode`, and until this existed nothing computed one:
 * every static caller took the binary default, which is a *guess* that happens
 * to be right on the programs to hand. Effect sets come out identical either
 * way, so nothing showed — but a reader of the lifted operations was being told
 * something the analysis had not established.
 *
 * Three flags are worth proving, and the reason differs for each:
 *
 * - **`D`** changes what an instruction *means*, so proving it is a correctness
 *   requirement rather than a nicety. It is the only flag that does.
 * - **`C`** is a finding. `CLC` before `SBC` subtracts one more than the operand
 *   reads, and that idiom was found by hand three times across two binaries
 *   before anything computed it.
 * - **`I`** is a finding too: code running with interrupts off is timing
 *   critical, and a routine that turns them back on under its caller is a
 *   surprise worth reporting.
 *
 * `Z`, `N` and `V` are deliberately absent. They fall out of data rather than
 * being set and cleared, so a flag lattice would answer "unknown" nearly
 * everywhere — a check that fires on healthy code. They yield to *value*
 * tracking instead, which is a different pass and a parked one.
 *
 * **The proof has to be interprocedural or it says nothing.** A first version
 * followed block successors only — which deliberately exclude the call target,
 * since a `JSR`'s successor is where it *returns to* — so every routine body
 * was a block nothing entered, seeded `unknown`. It came back `unknown` at 17 of
 * Gridrunner's 19 decimal sites, because the one `CLD` is in `ColdStart` and
 * never reached what `ColdStart` calls. Judged on that output the pass looks
 * useless, which is exactly the trap.
 *
 * **Entry points start `unknown`.** A 6502 clears none of these on reset or on
 * interrupt — unlike the 65C02 — which is precisely why real reset routines and
 * KERNAL handlers do it themselves. Assuming otherwise would assume the very
 * thing those instructions exist to establish.
 */

import { BasicBlock } from "./blocks.js";
import { DecimalMode, lift } from "../il/lift.js";
import { FLAGS, REG, flagsWritten } from "../il/pcode.js";
import { Instruction } from "../arch/mos6502/instruction.js";

/** What is known about a flag at a point. */
export type FlagState = "clear" | "set" | "unknown";

/** Kept for the decimal case, which is the one with a lifting consequence. */
export type DecimalState = FlagState;

/**
 * The flags this can prove, and the instructions that decide them outright.
 *
 * Anything else that *writes* the flag makes it unknown, and who that is comes
 * from the lifter rather than from a table here — the same rule the rest of this
 * project follows, since a table beside the semantics drifts away from them.
 */
interface FlagRules {
  register: number;
  sets: string;
  clears: string;
}

export const FLAG_RULES = {
  decimal: { register: REG.D, sets: "SED", clears: "CLD" },
  carry: { register: REG.C, sets: "SEC", clears: "CLC" },
  interruptDisable: { register: REG.I, sets: "SEI", clears: "CLI" },
} as const satisfies Record<string, FlagRules>;

export type ProvableFlag = keyof typeof FLAG_RULES;

/**
 * Two paths meeting. Agreement survives; disagreement does not.
 *
 * `undefined` means a path has not been seen yet, so it contributes nothing —
 * without that, the first predecessor examined would drag every block to
 * `unknown` before the fixpoint had a chance to agree.
 */
function meet(a: FlagState | undefined, b: FlagState): FlagState {
  if (a === undefined) return b;
  return a === b ? a : "unknown";
}

/**
 * How one instruction changes what is known.
 *
 * The two named instructions decide it; anything else that writes the flag —
 * `PLP` and `RTI` for all three, and every arithmetic and shift instruction for
 * carry — makes it unknown. Asking the lifter who writes it keeps this from
 * becoming a hand table that drifts: `flagsWritten` reads the operations, so a
 * new instruction is covered the day it is lifted.
 */
function after(
  state: FlagState,
  instruction: Instruction,
  rules: FlagRules,
  writes: (instruction: Instruction) => boolean
): FlagState {
  const mnemonic = instruction.mnemonic.toUpperCase();
  if (mnemonic === rules.sets) return "set";
  if (mnemonic === rules.clears) return "clear";
  return writes(instruction) ? "unknown" : state;
}

const MODE: Record<FlagState, DecimalMode> = {
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
/**
 * What is known about one flag at every instruction that reads it.
 *
 * `interesting` picks which addresses are recorded: for decimal that is `ADC`
 * and `SBC`, the only instructions whose result depends on it, because a map of
 * every address would be mostly noise.
 */
export function proveFlag(
  blocks: readonly BasicBlock[],
  entryPoints: readonly number[],
  flag: ProvableFlag,
  interesting: (instruction: Instruction) => boolean
): Map<number, FlagState> {
  const rules = FLAG_RULES[flag];
  const real = blocks.filter((b) => !b.alternate);
  const byStart = new Map(real.map((b) => [b.start, b]));

  // Lifting is not free and the fixpoint revisits blocks, so who clobbers the
  // flag is asked once per instruction.
  const clobbers = new Map<number, boolean>();
  const writes = (instruction: Instruction): boolean => {
    const known = clobbers.get(instruction.address);
    if (known !== undefined) return known;
    const found = flagsWritten(lift(instruction)).includes(rules.register);
    clobbers.set(instruction.address, found);
    return found;
  };

  /** What is known on entry to each block. */
  const entering = new Map<number, FlagState>();

  /**
   * Whether anything reachable from a call target can change the flag.
   *
   * Asking what a callee *leaves* would be more precise and needs a second
   * fixpoint over routine exits. Asking whether it can touch the flag at all is
   * one walk, and answers the question that actually arises: for `D` and `I`
   * almost nothing does, so the caller carries on with what it had.
   */
  const touches = new Map<number, boolean>();
  const canTouch = (target: number): boolean => {
    const known = touches.get(target);
    if (known !== undefined) return known;
    // Assume the worst while walking, so a recursive routine terminates by
    // answering conservatively rather than by looping.
    touches.set(target, true);

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
        if (mnemonic === rules.sets || mnemonic === rules.clears || writes(instruction)) {
          found = true;
        }
      }
      pending.push(...block.successors, ...block.calls);
    }

    touches.set(target, found);
    return found;
  };

  const known = new Map<number, FlagState>();
  const queue: number[] = [];
  let guard = real.length * 16 + 1024;

  const push = (start: number, state: FlagState) => {
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
        if (interesting(instruction)) {
          const before = known.get(instruction.address);
          // A site reached two ways is only proved if both ways agree.
          known.set(
            instruction.address,
            before === undefined || before === state ? state : "unknown"
          );
        }
        state = after(state, instruction, rules, writes);
      }

      for (const target of block.calls) push(target, state);
      if (block.exit === "call" && block.calls.some(canTouch)) state = "unknown";

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

  return known;
}

/** The instructions whose result depends on `D`, and on `C`. */
const isArithmetic = (instruction: Instruction): boolean => {
  const mnemonic = instruction.mnemonic.toUpperCase();
  return mnemonic === "ADC" || mnemonic === "SBC";
};

export function decimalModes(
  blocks: readonly BasicBlock[],
  entryPoints: readonly number[]
): Map<number, DecimalMode> {
  const proved = proveFlag(blocks, entryPoints, "decimal", isArithmetic);
  return new Map([...proved].map(([address, state]) => [address, MODE[state]]));
}

/**
 * Where an `ADC` or `SBC` runs with the carry provably decided.
 *
 * The finding this exists for, and it was made by hand three times before
 * anything computed it: `CLC` before `SBC` subtracts one more than the operand
 * reads, and `SEC` before `ADC` adds one more. Gridrunner has six such
 * subtractions and no `SEC/SBC` at all, so every subtraction in the game is one
 * out; Camels reaches two of its glyphs only because of the same idiom.
 *
 * Reported as a **fact, not a defect**. Sometimes it is deliberate, and on
 * Gridrunner all six sit inside visual effects where being one out is
 * invisible — which is presumably why it shipped.
 */
export function carrySites(
  blocks: readonly BasicBlock[],
  entryPoints: readonly number[]
): { address: number; mnemonic: string; carry: "clear" | "set" }[] {
  const proved = proveFlag(blocks, entryPoints, "carry", isArithmetic);
  const byAddress = new Map<number, Instruction>();
  for (const block of blocks) {
    for (const instruction of block.instructions) byAddress.set(instruction.address, instruction);
  }

  return [...proved]
    .filter(([, state]) => state !== "unknown")
    .map(([address, state]) => ({
      address,
      mnemonic: byAddress.get(address)?.mnemonic.toUpperCase() ?? "?",
      carry: state as "clear" | "set",
    }))
    .sort((a, b) => a.address - b.address);
}

/**
 * Runs of code that provably execute with interrupts disabled.
 *
 * Timing-critical work, usually — and the reason to report it is the shape the
 * KERNAL turned up: `RDTIM` ends by falling into `SETTIM`, which does `CLI`, so
 * reading the clock inside what a caller believes is a critical section turns
 * interrupts back on underneath it.
 *
 * Block starts rather than every address, because a critical section is a
 * region of code and listing each instruction in it would bury the point.
 */
export function interruptsDisabledAt(
  blocks: readonly BasicBlock[],
  entryPoints: readonly number[]
): number[] {
  const starts = new Set(blocks.filter((b) => !b.alternate).map((b) => b.start));
  const proved = proveFlag(blocks, entryPoints, "interruptDisable", (instruction) =>
    starts.has(instruction.address)
  );
  return [...proved]
    .filter(([, state]) => state === "set")
    .map(([address]) => address)
    .sort((a, b) => a - b);
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
