/**
 * Translating 6502 instructions into P-Code.
 *
 * The point where the IL stops being a data structure and starts being an
 * answer. Once an instruction is here, "what does this clobber", "which flags
 * does it touch", "what does this block read" and "what does this block leave
 * behind" are all `reads`/`writes` over the operations — computed, not
 * tabulated, so they cannot drift away from the semantics they describe.
 *
 * Two conventions worth knowing before reading any of it:
 *
 * **A statically known address becomes a `ram` varnode, not a `LOAD`.** `LDA $10`
 * lifts to a read of `$(0x10)` directly, so a block's inputs and outputs name
 * the zero-page cells it uses. `LDA $10,X` cannot: its address depends on X, so
 * it lifts to a `LOAD` from a computed varnode and the static answer is "reads
 * memory somewhere". Losing that distinction would mean either inventing an
 * address or reporting none, and on this machine, where zero page *is* the
 * variable space, the direct case is most of the interesting traffic.
 *
 * **Hardware quirks are modelled rather than smoothed over.** Zero-page indexing
 * wraps inside the page, `($ff,X)` takes its high byte from `$00`, and
 * `JMP ($xxff)` reads its high byte from the start of the same page. These are
 * not edge cases in hand-written C64 code — they are things people relied on —
 * and an IL that quietly gets them right is worth more than one that documents
 * being wrong.
 *
 * Decimal mode is **not** modelled: `ADC` and `SBC` lift to binary arithmetic
 * regardless of `D`. That is a known gap rather than an oversight, and callers
 * that can observe `D` should say so rather than report a confident sum.
 */

import { Instruction } from "../arch/mos6502/instruction.js";
import { Opcode, PcodeOp, REG, Varnode, constant, ram, reg, unique } from "./pcode.js";

/**
 * P-Code names the address space of a `LOAD`/`STORE` with a constant first
 * input. A 6502 has exactly one, so this is the only value it ever takes.
 */
const RAM_SPACE = constant(0, 4);

/** Builds up one instruction's operations, handing out temporaries as it goes. */
class Sequence {
  readonly ops: PcodeOp[] = [];
  private nextTemp = 0;

  /** A fresh temporary, dead at the end of this instruction. */
  temp(size = 1): Varnode {
    return unique(this.nextTemp++, size);
  }

  /** Emit an operation whose result goes somewhere named. */
  to(output: Varnode, op: Opcode, ...inputs: Varnode[]): void {
    this.ops.push({ op, output, inputs });
  }

  /** Emit an operation into a fresh temporary, and return it. */
  into(op: Opcode, size: number, ...inputs: Varnode[]): Varnode {
    const out = this.temp(size);
    this.ops.push({ op, output: out, inputs });
    return out;
  }

  /** Emit an operation that produces no value. */
  effect(op: Opcode, ...inputs: Varnode[]): void {
    this.ops.push({ op, inputs });
  }
}

/**
 * Where an instruction's operand lives.
 *
 * `direct` and `computed` are the same addressing question answered at two
 * different times, and keeping them apart is what lets a block report `$(0x10)`
 * as an input while honestly saying nothing about `LDA $10,X`.
 */
type Location =
  | { kind: "immediate"; value: Varnode }
  | { kind: "accumulator" }
  /** A cell whose address is known without running anything. */
  | { kind: "direct"; cell: Varnode }
  /** A two-byte varnode holding the address, computed by ops already emitted. */
  | { kind: "computed"; address: Varnode }
  /** No operand: implied, or a control-flow target handled by the caller. */
  | { kind: "none" };

/** Zero-page indexing wraps within the page: `$ff,X` with X=2 is `$01`, not `$0101`. */
function zeroPageIndexed(seq: Sequence, base: number, index: Varnode): Varnode {
  const wrapped = seq.into("INT_ADD", 1, constant(base & 0xff), index);
  return seq.into("INT_ZEXT", 2, wrapped);
}

function absoluteIndexed(seq: Sequence, base: number, index: Varnode): Varnode {
  const wide = seq.into("INT_ZEXT", 2, index);
  return seq.into("INT_ADD", 2, constant(base & 0xffff, 2), wide);
}

/**
 * The 16-bit value held in two consecutive zero-page bytes.
 *
 * The second byte wraps inside the page, so a pointer at `$ff` takes its high
 * byte from `$00`. Emitted as two byte loads and a `PIECE` rather than one
 * two-byte load, because a two-byte load would read `$0100` and be wrong in
 * exactly the case the wrap exists to describe.
 */
function zeroPagePointer(seq: Sequence, low: Varnode): Varnode {
  const lowAddress = seq.into("INT_ZEXT", 2, low);
  const lowByte = seq.into("LOAD", 1, RAM_SPACE, lowAddress);
  const highPointer = seq.into("INT_ADD", 1, low, constant(1));
  const highAddress = seq.into("INT_ZEXT", 2, highPointer);
  const highByte = seq.into("LOAD", 1, RAM_SPACE, highAddress);
  return seq.into("PIECE", 2, highByte, lowByte);
}

/** Resolve the operand's location, emitting whatever address arithmetic it needs. */
function locate(seq: Sequence, instr: Instruction): Location {
  const operand = instr.operand;
  switch (operand.type) {
    case "immediate":
      return { kind: "immediate", value: constant(operand.value) };
    case "accumulator":
      return { kind: "accumulator" };
    case "zeroPage":
    case "absolute":
      return { kind: "direct", cell: ram(operand.address) };
    case "zeroPageX":
      return { kind: "computed", address: zeroPageIndexed(seq, operand.address, reg(REG.X)) };
    case "zeroPageY":
      return { kind: "computed", address: zeroPageIndexed(seq, operand.address, reg(REG.Y)) };
    case "absoluteX":
      return { kind: "computed", address: absoluteIndexed(seq, operand.address, reg(REG.X)) };
    case "absoluteY":
      return { kind: "computed", address: absoluteIndexed(seq, operand.address, reg(REG.Y)) };
    case "indexedIndirect": {
      // ($nn,X): the index is added to the pointer, in zero page, before the read.
      const pointer = seq.into("INT_ADD", 1, constant(operand.address & 0xff), reg(REG.X));
      return { kind: "computed", address: zeroPagePointer(seq, pointer) };
    }
    case "indirectIndexed": {
      // ($nn),Y: the pointer is read first, and the index added to what it holds.
      const base = zeroPagePointer(seq, constant(operand.address & 0xff));
      const wide = seq.into("INT_ZEXT", 2, reg(REG.Y));
      return { kind: "computed", address: seq.into("INT_ADD", 2, base, wide) };
    }
    default:
      return { kind: "none" };
  }
}

/** The operand's value, loading it if that takes work. */
function load(seq: Sequence, at: Location): Varnode {
  switch (at.kind) {
    case "immediate":
      return at.value;
    case "accumulator":
      return reg(REG.A);
    case "direct":
      return at.cell;
    case "computed":
      return seq.into("LOAD", 1, RAM_SPACE, at.address);
    case "none":
      throw new Error("This instruction has no operand to read");
  }
}

function store(seq: Sequence, at: Location, value: Varnode): void {
  switch (at.kind) {
    case "accumulator":
      seq.to(reg(REG.A), "COPY", value);
      return;
    case "direct":
      seq.to(at.cell, "COPY", value);
      return;
    case "computed":
      seq.effect("STORE", RAM_SPACE, at.address, value);
      return;
    default:
      throw new Error("This instruction has no operand to write");
  }
}

/** N and Z, which almost every instruction sets from the value it produced. */
function setZN(seq: Sequence, value: Varnode): void {
  seq.to(reg(REG.Z), "INT_EQUAL", value, constant(0));
  seq.to(reg(REG.N), "INT_SLESS", value, constant(0));
}

/** A single bit of a byte, as a flag-shaped 0 or 1. */
function bitOf(seq: Sequence, value: Varnode, mask: number): Varnode {
  const masked = seq.into("INT_AND", 1, value, constant(mask));
  return seq.into("INT_NOTEQUAL", 1, masked, constant(0));
}

const STACK_PAGE = constant(0x0100, 2);

/** The address the stack pointer currently designates. */
function stackAddress(seq: Sequence, pointer: Varnode): Varnode {
  const wide = seq.into("INT_ZEXT", 2, pointer);
  return seq.into("INT_ADD", 2, STACK_PAGE, wide);
}

/** Write a byte at the stack pointer, then move it down. */
function push(seq: Sequence, value: Varnode): void {
  seq.effect("STORE", RAM_SPACE, stackAddress(seq, reg(REG.SP)), value);
  seq.to(reg(REG.SP), "INT_SUB", reg(REG.SP), constant(1));
}

/** Move the stack pointer up, then read the byte it now designates. */
function pull(seq: Sequence): Varnode {
  seq.to(reg(REG.SP), "INT_ADD", reg(REG.SP), constant(1));
  return seq.into("LOAD", 1, RAM_SPACE, stackAddress(seq, reg(REG.SP)));
}

/**
 * The flags gathered into the byte `PHP` pushes.
 *
 * Bit 5 has no flag behind it and reads as set; `B` reads as set for `PHP` and
 * `BRK` and clear for an interrupt, which is a property of the push rather than
 * of any stored state — so it is written here rather than kept in `REG.B`.
 */
function statusByte(seq: Sequence): Varnode {
  let status: Varnode = seq.into("COPY", 1, reg(REG.C));
  const merge = (flag: number, shift: number) => {
    const bit = seq.into("INT_LEFT", 1, reg(flag), constant(shift));
    status = seq.into("INT_OR", 1, status, bit);
  };
  merge(REG.Z, 1);
  merge(REG.I, 2);
  merge(REG.D, 3);
  merge(REG.V, 6);
  merge(REG.N, 7);
  return seq.into("INT_OR", 1, status, constant(0x30));
}

/** Scatter a status byte back into the individual flags. */
function restoreStatus(seq: Sequence, status: Varnode): void {
  seq.to(reg(REG.C), "COPY", bitOf(seq, status, 0x01));
  seq.to(reg(REG.Z), "COPY", bitOf(seq, status, 0x02));
  seq.to(reg(REG.I), "COPY", bitOf(seq, status, 0x04));
  seq.to(reg(REG.D), "COPY", bitOf(seq, status, 0x08));
  seq.to(reg(REG.V), "COPY", bitOf(seq, status, 0x40));
  seq.to(reg(REG.N), "COPY", bitOf(seq, status, 0x80));
}

/** `A - operand`, without keeping the difference: `CMP`, `CPX`, `CPY`. */
function compare(seq: Sequence, register: Varnode, value: Varnode): void {
  // Carry is set when no borrow was needed, which is the unsigned `>=`.
  seq.to(reg(REG.C), "INT_LESSEQUAL", value, register);
  seq.to(reg(REG.Z), "INT_EQUAL", register, value);
  const difference = seq.into("INT_SUB", 1, register, value);
  seq.to(reg(REG.N), "INT_SLESS", difference, constant(0));
}

/**
 * `A + operand + C`, binary.
 *
 * Three-way, so carry and overflow each get two chances to occur — and they
 * combine differently, which is the whole trap:
 *
 * - **Carry combines with OR**, because it cannot happen twice. A carry out of
 *   `A + M` leaves a partial sum of at most `$FE`, and `$FE + 1` does not carry.
 * - **Overflow combines with XOR**, because it can happen twice and then
 *   *cancels*. `$FF + $80 + 1` overflows negative on the first add and positive
 *   on the second, and the true answer is `-128`, which is representable — so V
 *   is clear. An `OR` here reports overflow on a sum that did not overflow.
 *
 * That case is not hypothetical: it is where Klaus Dormann's functional test
 * caught this code, having passed every hand-written case first. It is also the
 * reason the interpreter exists — the two published references disagree about
 * these flags and both are wrong, so the only way to be right is to run a
 * program somebody else wrote.
 */
function addWithCarry(seq: Sequence, value: Varnode): void {
  const carryA = seq.into("INT_CARRY", 1, reg(REG.A), value);
  const overflowA = seq.into("INT_SCARRY", 1, reg(REG.A), value);
  const partial = seq.into("INT_ADD", 1, reg(REG.A), value);
  const carryB = seq.into("INT_CARRY", 1, partial, reg(REG.C));
  const overflowB = seq.into("INT_SCARRY", 1, partial, reg(REG.C));
  seq.to(reg(REG.A), "INT_ADD", partial, reg(REG.C));
  seq.to(reg(REG.C), "BOOL_OR", carryA, carryB);
  seq.to(reg(REG.V), "BOOL_XOR", overflowA, overflowB);
  setZN(seq, reg(REG.A));
}

/**
 * `A - operand - (1 - C)`, binary.
 *
 * Expressed as an addition of the operand's complement, which is what the
 * hardware does and what makes carry come out right — carry set means no borrow,
 * so it enters the sum as the low bit rather than being subtracted.
 */
function subtractWithCarry(seq: Sequence, value: Varnode): void {
  const complement = seq.into("INT_XOR", 1, value, constant(0xff));
  addWithCarry(seq, complement);
}

/** One shift or rotate, over whatever the operand names. */
function shift(seq: Sequence, at: Location, mnemonic: string): void {
  const value = load(seq, at);
  // The bit leaving is captured before the shift, since the shift destroys it.
  const out = bitOf(seq, value, mnemonic === "ASL" || mnemonic === "ROL" ? 0x80 : 0x01);

  let result: Varnode;
  if (mnemonic === "ASL") {
    result = seq.into("INT_LEFT", 1, value, constant(1));
  } else if (mnemonic === "LSR") {
    result = seq.into("INT_RIGHT", 1, value, constant(1));
  } else if (mnemonic === "ROL") {
    const shifted = seq.into("INT_LEFT", 1, value, constant(1));
    result = seq.into("INT_OR", 1, shifted, reg(REG.C));
  } else {
    const shifted = seq.into("INT_RIGHT", 1, value, constant(1));
    const high = seq.into("INT_LEFT", 1, reg(REG.C), constant(7));
    result = seq.into("INT_OR", 1, shifted, high);
  }

  seq.to(reg(REG.C), "COPY", out);
  store(seq, at, result);
  // Read back rather than using the temporary: the flags describe what landed,
  // and for a memory operand that is a byte, not the intermediate.
  setZN(seq, at.kind === "accumulator" ? reg(REG.A) : result);
}

/** Add a constant to a register and set the flags, which is every INC/DEC form. */
function step(seq: Sequence, at: Location, by: number): void {
  const value = load(seq, at);
  const result = seq.into("INT_ADD", 1, value, constant(by & 0xff));
  store(seq, at, result);
  setZN(seq, result);
}

/** The flag a branch tests, and whether it branches when set or clear. */
const BRANCH_ON: Record<string, { flag: number; whenSet: boolean }> = {
  BCC: { flag: REG.C, whenSet: false },
  BCS: { flag: REG.C, whenSet: true },
  BNE: { flag: REG.Z, whenSet: false },
  BEQ: { flag: REG.Z, whenSet: true },
  BPL: { flag: REG.N, whenSet: false },
  BMI: { flag: REG.N, whenSet: true },
  BVC: { flag: REG.V, whenSet: false },
  BVS: { flag: REG.V, whenSet: true },
};

/** The flag each `CLx`/`SEx` writes, and what it writes there. */
const SET_FLAG: Record<string, { flag: number; value: number }> = {
  CLC: { flag: REG.C, value: 0 },
  SEC: { flag: REG.C, value: 1 },
  CLI: { flag: REG.I, value: 0 },
  SEI: { flag: REG.I, value: 1 },
  CLD: { flag: REG.D, value: 0 },
  SED: { flag: REG.D, value: 1 },
  CLV: { flag: REG.V, value: 0 },
};

/** Source and destination of each register-to-register move. */
const TRANSFER: Record<string, { from: number; to: number; flags: boolean }> = {
  TAX: { from: REG.A, to: REG.X, flags: true },
  TAY: { from: REG.A, to: REG.Y, flags: true },
  TXA: { from: REG.X, to: REG.A, flags: true },
  TYA: { from: REG.Y, to: REG.A, flags: true },
  TSX: { from: REG.SP, to: REG.X, flags: true },
  // The one that sets no flags, which is what makes `TXS` usable between a
  // comparison and the branch that reads it.
  TXS: { from: REG.X, to: REG.SP, flags: false },
};

/**
 * Translate one instruction.
 *
 * An instruction with no translation yields a single `CALLOTHER` naming it:
 * "something happens here and this does not describe it". That keeps an
 * unlifted instruction visibly unlifted instead of silently doing nothing,
 * which would read as an instruction with no effects — the most damaging
 * possible wrong answer for a clobber set.
 */
export function lift(instr: Instruction): PcodeOp[] {
  const seq = new Sequence();
  const mnemonic = instr.mnemonic.toUpperCase();

  // Undocumented opcodes are a chip-variant question, not a semantics one; the
  // 6510 in a C64 has its own. Marked unmodelled until there is a variant to
  // model them for.
  if (instr.illegal) {
    seq.effect("CALLOTHER", constant(0));
    return seq.ops;
  }

  const transfer = TRANSFER[mnemonic];
  if (transfer) {
    seq.to(reg(transfer.to), "COPY", reg(transfer.from));
    if (transfer.flags) setZN(seq, reg(transfer.to));
    return seq.ops;
  }

  const flag = SET_FLAG[mnemonic];
  if (flag) {
    seq.to(reg(flag.flag), "COPY", constant(flag.value));
    return seq.ops;
  }

  const branch = BRANCH_ON[mnemonic];
  if (branch) {
    const target =
      instr.operand.type === "relative" ? instr.operand.target : instr.address;
    const condition = branch.whenSet
      ? reg(branch.flag)
      : seq.into("BOOL_NEGATE", 1, reg(branch.flag));
    seq.effect("CBRANCH", constant(target, 2), condition);
    return seq.ops;
  }

  switch (mnemonic) {
    case "LDA":
    case "LDX":
    case "LDY": {
      const destination = reg(mnemonic === "LDA" ? REG.A : mnemonic === "LDX" ? REG.X : REG.Y);
      seq.to(destination, "COPY", load(seq, locate(seq, instr)));
      setZN(seq, destination);
      return seq.ops;
    }

    case "STA":
    case "STX":
    case "STY": {
      const source = reg(mnemonic === "STA" ? REG.A : mnemonic === "STX" ? REG.X : REG.Y);
      store(seq, locate(seq, instr), source);
      return seq.ops;
    }

    case "AND":
    case "ORA":
    case "EOR": {
      const value = load(seq, locate(seq, instr));
      const op: Opcode = mnemonic === "AND" ? "INT_AND" : mnemonic === "ORA" ? "INT_OR" : "INT_XOR";
      seq.to(reg(REG.A), op, reg(REG.A), value);
      setZN(seq, reg(REG.A));
      return seq.ops;
    }

    case "BIT": {
      // The odd one: N and V come from the *operand*, and only Z from the test,
      // which is what makes it a way to read two bits of an I/O register
      // without disturbing A.
      const value = load(seq, locate(seq, instr));
      const test = seq.into("INT_AND", 1, reg(REG.A), value);
      seq.to(reg(REG.Z), "INT_EQUAL", test, constant(0));
      seq.to(reg(REG.N), "COPY", bitOf(seq, value, 0x80));
      seq.to(reg(REG.V), "COPY", bitOf(seq, value, 0x40));
      return seq.ops;
    }

    case "ADC":
      addWithCarry(seq, load(seq, locate(seq, instr)));
      return seq.ops;
    case "SBC":
      subtractWithCarry(seq, load(seq, locate(seq, instr)));
      return seq.ops;

    case "CMP":
      compare(seq, reg(REG.A), load(seq, locate(seq, instr)));
      return seq.ops;
    case "CPX":
      compare(seq, reg(REG.X), load(seq, locate(seq, instr)));
      return seq.ops;
    case "CPY":
      compare(seq, reg(REG.Y), load(seq, locate(seq, instr)));
      return seq.ops;

    case "INC":
      step(seq, locate(seq, instr), 1);
      return seq.ops;
    case "DEC":
      step(seq, locate(seq, instr), -1);
      return seq.ops;
    case "INX":
      step(seq, { kind: "direct", cell: reg(REG.X) }, 1);
      return seq.ops;
    case "DEX":
      step(seq, { kind: "direct", cell: reg(REG.X) }, -1);
      return seq.ops;
    case "INY":
      step(seq, { kind: "direct", cell: reg(REG.Y) }, 1);
      return seq.ops;
    case "DEY":
      step(seq, { kind: "direct", cell: reg(REG.Y) }, -1);
      return seq.ops;

    case "ASL":
    case "LSR":
    case "ROL":
    case "ROR":
      shift(seq, locate(seq, instr), mnemonic);
      return seq.ops;

    case "PHA":
      push(seq, reg(REG.A));
      return seq.ops;
    case "PHP":
      push(seq, statusByte(seq));
      return seq.ops;
    case "PLA":
      seq.to(reg(REG.A), "COPY", pull(seq));
      setZN(seq, reg(REG.A));
      return seq.ops;
    case "PLP":
      restoreStatus(seq, pull(seq));
      return seq.ops;

    case "JMP": {
      if (instr.operand.type === "indirect") {
        // The page-boundary bug: the high byte comes from the start of the same
        // page, so `JMP ($10ff)` reads `$10ff` and `$1000`. Both addresses are
        // static, so both are named directly.
        const address = instr.operand.address;
        const low = ram(address);
        const high = ram((address & 0xff00) | ((address + 1) & 0xff));
        const target = seq.into("PIECE", 2, high, low);
        seq.effect("BRANCHIND", target);
      } else if (instr.operand.type === "absolute") {
        seq.effect("BRANCH", constant(instr.operand.address, 2));
      }
      return seq.ops;
    }

    case "JSR": {
      // The pushed address is the last byte of the `JSR`, not the instruction
      // after it — `RTS` adds one on the way back. It matters for anything that
      // reads the return address to find inline data, which is a standard trick
      // on this machine.
      const ret = (instr.address + 2) & 0xffff;
      push(seq, constant((ret >> 8) & 0xff));
      push(seq, constant(ret & 0xff));
      if (instr.operand.type === "absolute") {
        seq.effect("CALL", constant(instr.operand.address, 2));
      } else {
        seq.effect("CALLIND", constant(0, 2));
      }
      return seq.ops;
    }

    case "RTS": {
      const low = pull(seq);
      const high = pull(seq);
      const address = seq.into("PIECE", 2, high, low);
      seq.to(reg(REG.PC, 2), "INT_ADD", address, constant(1, 2));
      seq.effect("RETURN", reg(REG.PC, 2));
      return seq.ops;
    }

    case "RTI": {
      restoreStatus(seq, pull(seq));
      const low = pull(seq);
      const high = pull(seq);
      seq.to(reg(REG.PC, 2), "PIECE", high, low);
      seq.effect("RETURN", reg(REG.PC, 2));
      return seq.ops;
    }

    case "BRK": {
      // One byte that behaves like two: the pushed address is `BRK` plus two,
      // so the byte after it is skipped on return and is conventionally a
      // reason code.
      const ret = (instr.address + 2) & 0xffff;
      push(seq, constant((ret >> 8) & 0xff));
      push(seq, constant(ret & 0xff));
      // `statusByte` already sets bit 4, which is what distinguishes a pushed
      // `BRK` from a pushed interrupt and is the only way a handler can tell.
      push(seq, statusByte(seq));
      seq.to(reg(REG.I), "COPY", constant(1));
      // Where it goes is not a mystery: the IRQ vector is two fixed addresses,
      // so this is an ordinary indirect jump rather than something unmodelled.
      const target = seq.into("PIECE", 2, ram(0xffff), ram(0xfffe));
      seq.effect("BRANCHIND", target);
      return seq.ops;
    }

    case "NOP":
      return seq.ops;

    default:
      seq.effect("CALLOTHER", constant(0));
      return seq.ops;
  }
}

/** Whether an instruction has real semantics here, or only a `CALLOTHER`. */
export function isLifted(instr: Instruction): boolean {
  const ops = lift(instr);
  return !ops.some((op) => op.op === "CALLOTHER");
}
