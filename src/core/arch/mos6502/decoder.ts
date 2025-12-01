import { OPCODES } from "./opcodes.js";
import { Instruction, Operand } from "./instruction.js";

/** Result of attempting to decode an instruction */
export type DecodeResult =
  | { ok: true; instruction: Instruction }
  | { ok: false; reason: "undefined"; address: number }
  | { ok: false; reason: "truncated"; address: number; needed: number; available: number };

/** Interface for reading bytes - can be backed by MemoryMap or raw array */
export interface ByteReader {
  readByte(address: number): number | undefined;
}

/**
 * Decode a single instruction at the given address.
 * Returns the decoded instruction or an error reason.
 */
export function decode(reader: ByteReader, address: number): DecodeResult {
  const opcode = reader.readByte(address);
  if (opcode === undefined) {
    return { ok: false, reason: "undefined", address };
  }

  const info = OPCODES[opcode];
  const bytes = new Uint8Array(info.bytes);
  bytes[0] = opcode;

  // Read remaining bytes
  for (let i = 1; i < info.bytes; i++) {
    const b = reader.readByte(address + i);
    if (b === undefined) {
      return {
        ok: false,
        reason: "truncated",
        address,
        needed: info.bytes,
        available: i,
      };
    }
    bytes[i] = b;
  }

  const operand = decodeOperand(info.mode, bytes, address);

  return {
    ok: true,
    instruction: {
      address,
      bytes,
      mnemonic: info.mnemonic,
      operand,
      mode: info.mode,
      illegal: info.illegal ?? false,
      flow: info.flow,
    },
  };
}

/** Decode the operand based on addressing mode */
function decodeOperand(
  mode: string,
  bytes: Uint8Array,
  address: number
): Operand {
  switch (mode) {
    case "imp":
      return { type: "implied" };
    case "acc":
      return { type: "accumulator" };
    case "imm":
      return { type: "immediate", value: bytes[1] };
    case "zp":
      return { type: "zeroPage", address: bytes[1] };
    case "zpx":
      return { type: "zeroPageX", address: bytes[1] };
    case "zpy":
      return { type: "zeroPageY", address: bytes[1] };
    case "abs":
      return { type: "absolute", address: bytes[1] | (bytes[2] << 8) };
    case "abx":
      return { type: "absoluteX", address: bytes[1] | (bytes[2] << 8) };
    case "aby":
      return { type: "absoluteY", address: bytes[1] | (bytes[2] << 8) };
    case "ind":
      return { type: "indirect", address: bytes[1] | (bytes[2] << 8) };
    case "izx":
      return { type: "indexedIndirect", address: bytes[1] };
    case "izy":
      return { type: "indirectIndexed", address: bytes[1] };
    case "rel": {
      // Relative offset is signed
      const offset = bytes[1] < 128 ? bytes[1] : bytes[1] - 256;
      // Target is relative to the address AFTER the instruction
      const target = (address + 2 + offset) & 0xffff;
      return { type: "relative", offset, target };
    }
    default:
      return { type: "implied" };
  }
}
