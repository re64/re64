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
import { ValueAnalysis, flagBefore, proveValues } from "./values.js";
import { DecimalMode } from "../il/lift.js";
import { REG } from "../il/pcode.js";
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
 * A flag at every instruction the caller cares about.
 *
 * A thin query over `proveValues` now, rather than a walker of its own. Every
 * flag on this machine is a register the lifter writes — `SED` and `CLD` write
 * `D` exactly as `LDA` writes `Z` and `N` — so "prove this flag" stopped being
 * a rule per flag and became one question asked of the state. What that bought,
 * beyond having one mechanism instead of two: `N` can now be proved from bit
 * seven of a value nobody knows, which no set/clear-instruction walker can see.
 */
export function proveFlag(
  blocks: readonly BasicBlock[],
  entryPoints: readonly number[],
  flag: ProvableFlag,
  interesting: (instruction: Instruction) => boolean,
  analysis?: ValueAnalysis
): Map<number, FlagState> {
  const values = analysis ?? proveValues(blocks, entryPoints, { cover: entryPoints });
  const register = FLAG_RULES[flag].register;
  const found = new Map<number, FlagState>();
  for (const block of blocks) {
    if (block.alternate) continue;
    for (const instruction of block.instructions) {
      if (interesting(instruction)) {
        found.set(instruction.address, flagBefore(values, instruction.address, register));
      }
    }
  }
  return found;
}

/** The instructions whose result depends on `D`, and on `C`. */
const isArithmetic = (instruction: Instruction): boolean => {
  const mnemonic = instruction.mnemonic.toUpperCase();
  return mnemonic === "ADC" || mnemonic === "SBC";
};

export function decimalModes(
  blocks: readonly BasicBlock[],
  entryPoints: readonly number[],
  analysis?: ValueAnalysis
): Map<number, DecimalMode> {
  const proved = proveFlag(blocks, entryPoints, "decimal", isArithmetic, analysis);
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
  entryPoints: readonly number[],
  analysis?: ValueAnalysis
): { address: number; mnemonic: string; carry: "clear" | "set" }[] {
  const proved = proveFlag(blocks, entryPoints, "carry", isArithmetic, analysis);
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
  entryPoints: readonly number[],
  analysis?: ValueAnalysis
): number[] {
  const starts = new Set(blocks.filter((b) => !b.alternate).map((b) => b.start));
  const proved = proveFlag(
    blocks,
    entryPoints,
    "interruptDisable",
    (instruction) => starts.has(instruction.address),
    analysis
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
  entryPoints: readonly number[],
  analysis?: ValueAnalysis
): { address: number; mode: DecimalMode }[] {
  return [...decimalModes(blocks, entryPoints, analysis)]
    .filter(([, mode]) => mode !== "binary")
    .map(([address, mode]) => ({ address, mode }))
    .sort((a, b) => a.address - b.address);
}
