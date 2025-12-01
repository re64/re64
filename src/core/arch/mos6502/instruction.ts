import { AddressingMode, FlowType } from "./opcodes.js";

/** Operand types for structured representation */
export type Operand =
  | { type: "implied" }
  | { type: "accumulator" }
  | { type: "immediate"; value: number }
  | { type: "zeroPage"; address: number }
  | { type: "zeroPageX"; address: number }
  | { type: "zeroPageY"; address: number }
  | { type: "absolute"; address: number }
  | { type: "absoluteX"; address: number }
  | { type: "absoluteY"; address: number }
  | { type: "indirect"; address: number }
  | { type: "indexedIndirect"; address: number }  // ($xx,X)
  | { type: "indirectIndexed"; address: number }  // ($xx),Y
  | { type: "relative"; offset: number; target: number };

/** A decoded 6502 instruction */
export interface Instruction {
  /** Address of the instruction */
  address: number;
  /** Raw bytes of the instruction */
  bytes: Uint8Array;
  /** Instruction mnemonic (e.g., "LDA", "JMP") */
  mnemonic: string;
  /** Structured operand */
  operand: Operand;
  /** Addressing mode */
  mode: AddressingMode;
  /** Whether this is an illegal/undocumented opcode */
  illegal: boolean;
  /** How control flow proceeds */
  flow: FlowType;
}

/** Label resolver function type */
export type LabelResolver = (address: number) => string | undefined;

/** Format an operand as a string, optionally resolving labels */
export function formatOperand(operand: Operand, resolveLabel?: LabelResolver): string {
  const resolve16 = (addr: number) => resolveLabel?.(addr) ?? `$${hex16(addr)}`;
  const resolve8 = (addr: number) => resolveLabel?.(addr) ?? `$${hex8(addr)}`;

  switch (operand.type) {
    case "implied":
      return "";
    case "accumulator":
      return "A";
    case "immediate":
      return `#$${hex8(operand.value)}`;
    case "zeroPage":
      return resolve8(operand.address);
    case "zeroPageX":
      return `${resolve8(operand.address)},X`;
    case "zeroPageY":
      return `${resolve8(operand.address)},Y`;
    case "absolute":
      return resolve16(operand.address);
    case "absoluteX":
      return `${resolve16(operand.address)},X`;
    case "absoluteY":
      return `${resolve16(operand.address)},Y`;
    case "indirect":
      return `(${resolve16(operand.address)})`;
    case "indexedIndirect":
      return `(${resolve8(operand.address)},X)`;
    case "indirectIndexed":
      return `(${resolve8(operand.address)}),Y`;
    case "relative":
      return resolve16(operand.target);
  }
}

/** Format a full instruction as a string */
export function formatInstruction(
  instr: Instruction,
  resolveLabel?: LabelResolver
): string {
  const prefix = instr.illegal ? "*" : " ";
  const operandStr = formatOperand(instr.operand, resolveLabel);
  if (operandStr) {
    return `${prefix}${instr.mnemonic} ${operandStr}`;
  }
  return `${prefix}${instr.mnemonic}`;
}

/** Get all possible next PC values after this instruction */
export function getTargets(instr: Instruction): number[] {
  const nextAddr = instr.address + instr.bytes.length;

  switch (instr.flow) {
    case "next":
      return [nextAddr];
    case "branch":
      // Branches can go to target or fall through
      if (instr.operand.type === "relative") {
        return [nextAddr, instr.operand.target];
      }
      return [nextAddr];
    case "jump":
      // JMP absolute has known target, JMP indirect does not
      if (instr.operand.type === "absolute") {
        return [instr.operand.address];
      }
      // Indirect jump - target unknown at decode time
      return [];
    case "call":
      // JSR: continue after call returns, plus the subroutine target
      if (instr.operand.type === "absolute") {
        return [nextAddr, instr.operand.address];
      }
      return [nextAddr];
    case "ret":
    case "halt":
      // No known targets
      return [];
  }
}

/** Check if instruction continues to next byte */
export function continues(instr: Instruction): boolean {
  return instr.flow === "next" || instr.flow === "branch" || instr.flow === "call";
}

function hex8(n: number): string {
  return n.toString(16).toUpperCase().padStart(2, "0");
}

function hex16(n: number): string {
  return n.toString(16).toUpperCase().padStart(4, "0");
}
