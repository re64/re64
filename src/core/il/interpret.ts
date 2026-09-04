/**
 * Running P-Code, concretely.
 *
 * Not a feature of the disassembler: clobber sets, flag sets and stack effects
 * all come from the *shape* of the operations and never evaluate anything. This
 * exists to check that the shapes are right, by executing them against a
 * program written by somebody else — which is the only way the flag arithmetic
 * gets tested at all, and both published references we compared get `ADC`
 * wrong, so believing our own is not good enough.
 *
 * It is also the evaluation structure symbolic execution would reuse later,
 * with values that are expressions rather than numbers. That is a reason to
 * keep it small and obvious rather than fast.
 */

import { PcodeOp, REG, Varnode } from "./pcode.js";

/** Where control went after an instruction's operations ran. */
export type Flow =
  | { kind: "next" }
  | { kind: "goto"; address: number }
  | { kind: "call"; address: number }
  /**
   * Returned, to the address the operation carried.
   *
   * The address is not decoration. `RTS` pops it off the stack, and a routine
   * that rewrote its own return address — a standard computed jump on this
   * machine — returns somewhere its caller never chose. Dropping it made every
   * `RTS` continue at the byte after itself, which is wrong even in the
   * ordinary case and silently so.
   */
  | { kind: "return"; address: number }
  /** An effect that is real and not modelled; the machine cannot go on honestly. */
  | { kind: "unmodelled" };

/**
 * Notified of every memory access as it happens.
 *
 * The only way a computed address becomes visible. `LDA $10,X` reads an address
 * no static analysis can name, and the whole value of running the thing is
 * finding out which one — so the access is reported rather than reconstructed.
 */
export interface Watcher {
  read(address: number, size: number, value: number): void;
  write(address: number, size: number, value: number): void;
}

/** Everything a 6502 program can observe. */
export class Machine {
  readonly memory = new Uint8Array(0x10000);
  private readonly registers = new Uint16Array(16);
  private readonly temporaries = new Map<number, number>();

  /** Set to observe memory traffic; left unset it costs one comparison. */
  watch?: Watcher;

  get(node: Varnode): number {
    switch (node.space) {
      case "const":
        return node.offset & mask(node.size);
      case "register":
        return this.registers[node.offset] & mask(node.size);
      case "unique":
        return (this.temporaries.get(node.offset) ?? 0) & mask(node.size);
      case "ram":
        return this.read(node.offset, node.size);
    }
  }

  set(node: Varnode, value: number): void {
    const truncated = value & mask(node.size);
    switch (node.space) {
      case "register":
        this.registers[node.offset] = truncated;
        break;
      case "unique":
        this.temporaries.set(node.offset, truncated);
        break;
      case "ram":
        this.write(node.offset, truncated, node.size);
        break;
      case "const":
        throw new Error("A constant cannot be assigned to");
    }
  }

  /** Little-endian, which is what this machine is. */
  read(address: number, size: number): number {
    let value = 0;
    for (let i = size - 1; i >= 0; i--) value = (value << 8) | this.memory[(address + i) & 0xffff];
    value = value >>> 0;
    this.watch?.read(address & 0xffff, size, value);
    return value;
  }

  write(address: number, value: number, size: number): void {
    for (let i = 0; i < size; i++) this.memory[(address + i) & 0xffff] = (value >>> (8 * i)) & 0xff;
    this.watch?.write(address & 0xffff, size, value & mask(size));
  }

  /** A register by offset, for reporting final state. */
  register(offset: number): number {
    return this.registers[offset];
  }

  /** Temporaries do not survive the instruction that made them. */
  clearTemporaries(): void {
    this.temporaries.clear();
  }

  get pc(): number {
    return this.registers[REG.PC];
  }

  set pc(address: number) {
    this.registers[REG.PC] = address & 0xffff;
  }
}

const mask = (size: number): number => (size >= 4 ? 0xffffffff : (1 << (8 * size)) - 1);

/** The top bit of a value of this width, for signed comparisons. */
const signBit = (size: number): number => 1 << (8 * size - 1);

/** Read a value as signed, given its width. */
const signed = (value: number, size: number): number => {
  const bit = signBit(size);
  return value & bit ? value - bit * 2 : value;
};

/**
 * Run one instruction's operations.
 *
 * Returns where control goes, which the caller applies — this does not advance
 * the program counter itself, because "the next instruction" is a fact about
 * decoding that P-Code does not carry.
 */
export function execute(ops: readonly PcodeOp[], machine: Machine): Flow {
  machine.clearTemporaries();
  let flow: Flow = { kind: "next" };

  for (const op of ops) {
    const next = executeOne(op, machine);
    if (next) {
      if (next.kind === "unmodelled") return next;
      flow = next;
    }
  }

  return flow;
}

/**
 * Run one operation, and say where control goes if it decides that.
 *
 * Split out of `execute` so the abstract interpreter can borrow these semantics
 * rather than restate them. It needs a concrete answer for every operation whose
 * inputs it happens to know completely, and 37 opcodes written twice is 37
 * chances for the two to disagree — with the abstract one being the copy nobody
 * runs against Klaus Dormann's suite.
 *
 * Returns `undefined` where control simply falls through, which is most of them.
 */
export function executeOne(op: PcodeOp, machine: Machine): Flow | undefined {
  let flow: Flow | undefined;
  {
    const input = (i: number) => machine.get(op.inputs[i]);
    const put = (value: number) => {
      if (op.output) machine.set(op.output, value);
    };
    switch (op.op) {
      case "COPY":
        put(input(0));
        break;

      // LOAD and STORE take the space as their first input, which for a 6502
      // is always ram; the address is the second.
      case "LOAD":
        put(machine.read(input(1), op.output?.size ?? 1));
        break;
      case "STORE":
        machine.write(input(1), input(2), op.inputs[2].size);
        break;

      case "INT_ADD":
        put(input(0) + input(1));
        break;
      case "INT_SUB":
        put(input(0) - input(1));
        break;
      case "INT_2COMP":
        put(-input(0));
        break;

      // Binary-coded decimal, as the NMOS 6502 does it. Result in the low byte,
      // carry in bit 8, so one operation answers both.
      case "INT_BCD_ADD": {
        const a = input(0);
        const m = input(1);
        let low = (a & 0x0f) + (m & 0x0f) + (input(2) & 1);
        if (low > 0x09) low += 0x06;
        let high = (a >> 4) + (m >> 4) + (low > 0x0f ? 1 : 0);
        if (high > 0x09) high += 0x06;
        put((((high & 0x0f) << 4) | (low & 0x0f)) | (high > 0x0f ? 0x100 : 0));
        break;
      }

      case "INT_BCD_SUB": {
        const a = input(0);
        const m = input(1);
        const borrow = 1 - (input(2) & 1);
        let low = (a & 0x0f) - (m & 0x0f) - borrow;
        let high = (a >> 4) - (m >> 4);
        if (low & 0x10) {
          low -= 0x06;
          high -= 1;
        }
        if (high & 0x10) high -= 0x06;
        // Carry after a decimal SBC is the *binary* borrow, not a decimal one:
        // on this chip only the accumulator differs between the two modes.
        const binary = a - m - borrow;
        put((((high & 0x0f) << 4) | (low & 0x0f)) | (binary >= 0 ? 0x100 : 0));
        break;
      }

      // Carry and borrow are their own operations rather than something a
      // reader has to reconstruct, which is where both references went wrong.
      case "INT_CARRY":
        put((input(0) + input(1)) > mask(op.inputs[0].size) ? 1 : 0);
        break;
      case "INT_SCARRY": {
        const a = signed(input(0), op.inputs[0].size);
        const b = signed(input(1), op.inputs[1].size);
        const sum = a + b;
        const limit = signBit(op.inputs[0].size);
        put(sum >= limit || sum < -limit ? 1 : 0);
        break;
      }
      case "INT_SBORROW": {
        const a = signed(input(0), op.inputs[0].size);
        const b = signed(input(1), op.inputs[1].size);
        const difference = a - b;
        const limit = signBit(op.inputs[0].size);
        put(difference >= limit || difference < -limit ? 1 : 0);
        break;
      }

      case "INT_NEGATE":
        put(~input(0));
        break;
      case "INT_XOR":
        put(input(0) ^ input(1));
        break;
      case "INT_AND":
        put(input(0) & input(1));
        break;
      case "INT_OR":
        put(input(0) | input(1));
        break;
      case "INT_LEFT":
        put(input(0) << input(1));
        break;
      case "INT_RIGHT":
        put(input(0) >>> input(1));
        break;
      case "INT_SRIGHT":
        put(signed(input(0), op.inputs[0].size) >> input(1));
        break;

      case "INT_EQUAL":
        put(input(0) === input(1) ? 1 : 0);
        break;
      case "INT_NOTEQUAL":
        put(input(0) !== input(1) ? 1 : 0);
        break;
      case "INT_LESS":
        put(input(0) < input(1) ? 1 : 0);
        break;
      case "INT_LESSEQUAL":
        put(input(0) <= input(1) ? 1 : 0);
        break;
      case "INT_SLESS":
        put(signed(input(0), op.inputs[0].size) < signed(input(1), op.inputs[1].size) ? 1 : 0);
        break;
      case "INT_SLESSEQUAL":
        put(signed(input(0), op.inputs[0].size) <= signed(input(1), op.inputs[1].size) ? 1 : 0);
        break;

      case "INT_ZEXT":
        put(input(0));
        break;
      case "INT_SEXT":
        put(signed(input(0), op.inputs[0].size));
        break;
      case "PIECE":
        put((input(0) << (8 * op.inputs[1].size)) | input(1));
        break;
      case "SUBPIECE":
        put(input(0) >>> (8 * input(1)));
        break;

      case "BOOL_NEGATE":
        put(input(0) === 0 ? 1 : 0);
        break;
      case "BOOL_AND":
        put(input(0) !== 0 && input(1) !== 0 ? 1 : 0);
        break;
      case "BOOL_OR":
        put(input(0) !== 0 || input(1) !== 0 ? 1 : 0);
        break;
      case "BOOL_XOR":
        put(input(0) !== 0 !== (input(1) !== 0) ? 1 : 0);
        break;

      case "BRANCH":
        flow = { kind: "goto", address: input(0) };
        break;
      case "CBRANCH":
        if (input(1) !== 0) flow = { kind: "goto", address: input(0) };
        break;
      case "BRANCHIND":
        flow = { kind: "goto", address: input(0) };
        break;
      case "CALL":
      case "CALLIND":
        flow = { kind: "call", address: input(0) };
        break;
      case "RETURN":
        flow = { kind: "return", address: input(0) };
        break;

      // Real, and not described here. Carrying on would invent a result.
      case "CALLOTHER":
        return { kind: "unmodelled" };
    }
  }

  return flow;
}
