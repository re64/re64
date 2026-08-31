/**
 * Running a basic block, concretely.
 *
 * Static effects say *which* slots a block touches; this says *what happens* to
 * them for one set of inputs. Both are worth having and neither substitutes for
 * the other — "this block writes $D020" is a fact about the code, and "given
 * X=3 it writes 6 to $D020" is a fact about a run.
 *
 * The reason to expose it at all is that a straight-line block is exactly the
 * unit where this is honest. There is no branch inside one, so the instructions
 * that run are known before it starts; nothing has to be guessed about which way
 * anything went, and the answer cannot depend on a path chosen for you. Run a
 * whole routine instead and you are writing an emulator, with everything an
 * emulator needs to be right about.
 *
 * Two things are reported that a plain result would hide, because without them
 * the answer looks more solid than it is:
 *
 * - **Memory read but never supplied.** It read as zero, and zero is a real
 *   value that produces a real-looking result. Anyone reading the output has to
 *   know which parts of it rest on an assumption they did not make.
 * - **An instruction with no semantics.** Execution stops there rather than
 *   skipping it, since carrying on would report the state of a machine that
 *   never existed.
 */

import { Instruction, formatInstruction } from "../arch/mos6502/instruction.js";
import { decode } from "../arch/mos6502/decoder.js";
import { BasicBlock } from "../analysis/blocks.js";
import { Flow, Machine, execute } from "./interpret.js";
import { lift } from "./lift.js";
import { REG } from "./pcode.js";

/** The machine's own state, by the names a 6502 programmer uses. */
export const REGISTER_NAMES = ["A", "X", "Y", "SP", "C", "Z", "I", "D", "B", "V", "N"] as const;
export type RegisterName = (typeof REGISTER_NAMES)[number];

const OFFSETS: Record<RegisterName, number> = {
  A: REG.A, X: REG.X, Y: REG.Y, SP: REG.SP,
  C: REG.C, Z: REG.Z, I: REG.I, D: REG.D, B: REG.B, V: REG.V, N: REG.N,
};

export interface BlockInputs {
  /** Starting register and flag values. Anything omitted starts at zero. */
  registers?: Partial<Record<RegisterName, number>>;
  /** Starting memory, by address. Anything omitted reads as zero and is reported. */
  memory?: Record<number, number>;
}

/** Where control went when the block finished. */
export type BlockExit =
  /** Ran off the end into the next block. */
  | { kind: "fallthrough"; to: number }
  /** Branched or jumped, and to where — the answer a conditional block exists to give. */
  | { kind: "goto"; to: number }
  | { kind: "call"; to: number; returnsTo: number }
  | { kind: "return"; to?: number }
  /** Stopped early: an instruction with no semantics, or bytes that do not decode. */
  | { kind: "stopped"; at: number; reason: "unmodelled" | "undecodable" };

export interface BlockRun {
  start: number;
  /** Every instruction that actually ran, in order. */
  executed: { address: number; text: string }[];
  /** Final value of every register and flag. */
  registers: Record<RegisterName, number>;
  /** Only those that differ from what went in — usually the short, useful list. */
  changed: RegisterName[];
  /** Final value at each address the block wrote, in address order. */
  memoryWritten: { address: number; value: number }[];
  /**
   * Each address the block read, and whether a value was supplied for it.
   *
   * Includes addresses reached through indexing and indirection, which is the
   * question no static reading of the block can answer.
   */
  memoryRead: { address: number; value: number; supplied: boolean }[];
  exit: BlockExit;
  /** Anything that makes the result less trustworthy than it looks. */
  warnings: string[];
}

/** Read bytes straight out of the machine, so code and data are the same memory. */
const readerFor = (machine: Machine) => ({
  readByte: (address: number) => machine.memory[address & 0xffff],
});

/**
 * Decode, lift and execute one instruction.
 *
 * Exported because it is the primitive both the block runner and the acceptance
 * test are built from, and because running a whole program one instruction at a
 * time is how the functional test is driven.
 */
export function stepMachine(
  machine: Machine,
  address: number
): { instruction: Instruction; flow: Flow; next: number } | undefined {
  const decoded = decode(readerFor(machine), address);
  if (!decoded.ok) return undefined;

  const instruction = decoded.instruction;
  const flow = execute(lift(instruction), machine);
  const after = (address + instruction.bytes.length) & 0xffff;

  const next =
    flow.kind === "goto" || flow.kind === "call" ? flow.address : after;
  return { instruction, flow, next };
}

/**
 * Run a block once, with the inputs given.
 *
 * Instructions come from the block rather than from decoding the machine's
 * memory, so the run follows the reading the block represents. That matters for
 * contested bytes: an alternate block is a different sequence over the same
 * addresses, and re-decoding would silently execute the other one.
 */
export function runBlock(block: BasicBlock, inputs: BlockInputs = {}): BlockRun {
  const machine = new Machine();

  const supplied = new Set<number>();
  for (const [address, value] of Object.entries(inputs.memory ?? {})) {
    const at = Number(address) & 0xffff;
    machine.memory[at] = value & 0xff;
    supplied.add(at);
  }

  const before = {} as Record<RegisterName, number>;
  for (const name of REGISTER_NAMES) {
    const value = inputs.registers?.[name] ?? 0;
    machine.set({ space: "register", offset: OFFSETS[name], size: 1 }, value);
    before[name] = machine.register(OFFSETS[name]);
  }

  // Reads are recorded on first sight so a cell read twice reports the value it
  // held on entry, which is what "the block's input" means. Writes report the
  // last value, which is what "the block's output" means.
  const reads = new Map<number, { value: number; supplied: boolean }>();
  const writes = new Map<number, number>();
  machine.watch = {
    read(address, size, value) {
      for (let i = 0; i < size; i++) {
        const at = (address + i) & 0xffff;
        if (reads.has(at) || writes.has(at)) continue;
        reads.set(at, { value: (value >>> (8 * i)) & 0xff, supplied: supplied.has(at) });
      }
    },
    write(address, size, value) {
      for (let i = 0; i < size; i++) {
        writes.set((address + i) & 0xffff, (value >>> (8 * i)) & 0xff);
      }
    },
  };

  const executed: { address: number; text: string }[] = [];
  const warnings: string[] = [];
  let exit: BlockExit = { kind: "fallthrough", to: block.end };

  for (const instruction of block.instructions) {
    if (usesDecimal(instruction) && machine.register(REG.D)) {
      warnings.push(
        `${instruction.mnemonic} at $${hex(instruction.address)} ran with D set; ` +
          `decimal arithmetic is not modelled, so this result is the binary one`
      );
    }

    const flow = execute(lift(instruction), machine);
    executed.push({ address: instruction.address, text: formatInstruction(instruction).trim() });

    if (flow.kind === "unmodelled") {
      exit = { kind: "stopped", at: instruction.address, reason: "unmodelled" };
      warnings.push(
        `Stopped at $${hex(instruction.address)}: ${instruction.mnemonic} has no semantics here` +
          `${instruction.illegal ? " (undocumented opcode)" : ""}`
      );
      break;
    }

    const after = (instruction.address + instruction.bytes.length) & 0xffff;
    if (flow.kind === "goto") exit = { kind: "goto", to: flow.address };
    else if (flow.kind === "call") exit = { kind: "call", to: flow.address, returnsTo: after };
    else if (flow.kind === "return") exit = { kind: "return", to: machine.pc };
    else exit = { kind: "fallthrough", to: after };
  }

  const registers = {} as Record<RegisterName, number>;
  const changed: RegisterName[] = [];
  for (const name of REGISTER_NAMES) {
    registers[name] = machine.register(OFFSETS[name]);
    if (registers[name] !== before[name]) changed.push(name);
  }

  const assumed = [...reads].filter(([, r]) => !r.supplied).map(([a]) => a);
  if (assumed.length) {
    warnings.push(
      `Read ${assumed.length} address${assumed.length === 1 ? "" : "es"} no value was given ` +
        `for (${assumed.slice(0, 6).map((a) => `$${hex(a)}`).join(", ")}` +
        `${assumed.length > 6 ? ", …" : ""}); they read as zero`
    );
  }

  return {
    start: block.start,
    executed,
    registers,
    changed,
    memoryWritten: [...writes]
      .sort((a, b) => a[0] - b[0])
      .map(([address, value]) => ({ address, value })),
    memoryRead: [...reads]
      .sort((a, b) => a[0] - b[0])
      .map(([address, r]) => ({ address, value: r.value, supplied: r.supplied })),
    exit,
    warnings,
  };
}

/** The two instructions whose result depends on the decimal flag. */
const usesDecimal = (instr: Instruction): boolean =>
  instr.mnemonic === "ADC" || instr.mnemonic === "SBC";

const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");
