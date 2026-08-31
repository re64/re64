import { describe, it, expect } from "vitest";
import { decode } from "../arch/mos6502/decoder.js";
import { Instruction } from "../arch/mos6502/instruction.js";
import { BasicBlock } from "../analysis/blocks.js";
import { blockEffects, describeEffects, stackDelta } from "./effects.js";
import { BlockInputs, runBlock } from "./run.js";
import { formatVarnode } from "./pcode.js";
import { lift } from "./lift.js";

/** A block straight from bytes, so a test reads as the assembler it is about. */
function blockOf(bytes: number[], start = 0x8000): BasicBlock {
  const memory = new Uint8Array(0x10000);
  memory.set(bytes, start);
  const reader = { readByte: (a: number) => memory[a & 0xffff] };

  const instructions: Instruction[] = [];
  let at = start;
  while (at < start + bytes.length) {
    const decoded = decode(reader, at);
    if (!decoded.ok) throw new Error(`undecodable at $${at.toString(16)}`);
    instructions.push(decoded.instruction);
    at += decoded.instruction.bytes.length;
  }
  return { start, end: at, instructions, successors: [], calls: [], exit: "fallthrough" };
}

const run = (bytes: number[], inputs: BlockInputs = {}) => runBlock(blockOf(bytes), inputs);

describe("loads and flags", () => {
  it("loads a value and reports what it set", () => {
    const result = run([0xa9, 0x1f]); // LDA #$1F
    expect(result.registers.A).toBe(0x1f);
    expect(result.registers.Z).toBe(0);
    expect(result.registers.N).toBe(0);
    expect(result.changed).toEqual(["A"]);
  });

  it("sets Z on zero and N on a high bit", () => {
    expect(run([0xa9, 0x00]).registers.Z).toBe(1);
    expect(run([0xa9, 0x80]).registers.N).toBe(1);
  });

  it("names the cell a static address reads, so it is an input of the block", () => {
    // LDA $10 / STA $11
    const effects = blockEffects(blockOf([0xa5, 0x10, 0x85, 0x11]).instructions);
    expect(effects.inputs.map(formatVarnode)).toEqual(["$(0x10)"]);
    expect(effects.outputs.map(formatVarnode)).toContain("$(0x11)");
    expect(effects.readsComputedMemory).toBe(false);
  });

  it("admits to an address it cannot name", () => {
    // LDA $10,X — the address depends on X, so no static answer exists.
    const effects = blockEffects(blockOf([0xb5, 0x10]).instructions);
    expect(effects.readsComputedMemory).toBe(true);
    expect(describeEffects(effects).reads).toContain("memory at a computed address");
    expect(effects.inputs.map(formatVarnode)).toContain("X");
  });
});

describe("addressing quirks the hardware actually has", () => {
  it("wraps zero-page indexing inside the page", () => {
    // LDX #$02 / LDA $FF,X  reads $01, not $0101.
    const result = run([0xa2, 0x02, 0xb5, 0xff], { memory: { 0x01: 0x42, 0x0101: 0x99 } });
    expect(result.registers.A).toBe(0x42);
    expect(result.memoryRead.map((r) => r.address)).toContain(0x01);
  });

  it("takes the high byte of ($FF,X) from $00", () => {
    // LDA ($FF,X) with X=0: pointer low from $FF, high from $00.
    const result = run([0xa1, 0xff], {
      memory: { 0xff: 0x34, 0x00: 0x12, 0x1234: 0x7e },
    });
    expect(result.registers.A).toBe(0x7e);
  });

  it("reproduces the JMP indirect page-boundary bug", () => {
    // JMP ($10FF) takes its high byte from $1000, not $1100.
    const result = run([0x6c, 0xff, 0x10], {
      memory: { 0x10ff: 0x34, 0x1000: 0x12, 0x1100: 0xee },
    });
    expect(result.exit).toEqual({ kind: "goto", to: 0x1234 });
  });
});

describe("arithmetic, against the cases both published references get wrong", () => {
  const adc = (a: number, m: number, carry = 0) =>
    run([0xa9, a, 0x69, m], { registers: { C: carry } }).registers;

  it("$50 + $50 overflows without carrying", () => {
    const r = adc(0x50, 0x50);
    expect([r.A, r.C, r.V]).toEqual([0xa0, 0, 1]);
  });

  it("$D0 + $90 both carries and overflows", () => {
    const r = adc(0xd0, 0x90);
    expect([r.A, r.C, r.V]).toEqual([0x60, 1, 1]);
  });

  it("$50 + $D0 carries without overflowing", () => {
    const r = adc(0x50, 0xd0);
    expect([r.A, r.C, r.V]).toEqual([0x20, 1, 0]);
  });

  it("carries the incoming carry in", () => {
    expect(adc(0x01, 0x01, 1).A).toBe(0x03);
  });

  const sbc = (a: number, m: number, carry = 1) =>
    run([0xa9, a, 0xe9, m], { registers: { C: carry } }).registers;

  it("$50 - $F0 borrows", () => {
    const r = sbc(0x50, 0xf0);
    expect([r.A, r.C, r.V]).toEqual([0x60, 0, 0]);
  });

  it("$50 - $B0 overflows", () => {
    const r = sbc(0x50, 0xb0);
    expect([r.A, r.C, r.V]).toEqual([0xa0, 0, 1]);
  });

  it("compares without keeping the difference", () => {
    // LDA #$50 / CMP #$60
    const r = run([0xa9, 0x50, 0xc9, 0x60]).registers;
    expect(r.A).toBe(0x50);
    expect([r.C, r.Z, r.N]).toEqual([0, 0, 1]);
  });
});

describe("shifts and rotates", () => {
  it("shifts the high bit into carry", () => {
    const r = run([0xa9, 0x81, 0x0a]).registers; // LDA #$81 / ASL A
    expect([r.A, r.C]).toEqual([0x02, 1]);
  });

  it("rotates carry back in at the bottom", () => {
    const r = run([0xa9, 0x80, 0x2a], { registers: { C: 1 } }).registers; // ROL A
    expect([r.A, r.C]).toEqual([0x01, 1]);
  });

  it("shifts a memory cell in place", () => {
    const result = run([0x06, 0x10], { memory: { 0x10: 0x40 } }); // ASL $10
    expect(result.memoryWritten).toEqual([{ address: 0x10, value: 0x80 }]);
    expect(result.registers.N).toBe(1);
  });
});

describe("the stack", () => {
  it("pushes and pulls the same byte", () => {
    // LDA #$7F / PHA / LDA #$00 / PLA
    const r = run([0xa9, 0x7f, 0x48, 0xa9, 0x00, 0x68], { registers: { SP: 0xff } });
    expect(r.registers.A).toBe(0x7f);
    expect(r.registers.SP).toBe(0xff);
  });

  it("survives a round trip through the status byte", () => {
    // SEC / PHP / CLC / PLP  — carry comes back.
    const r = run([0x38, 0x08, 0x18, 0x28], { registers: { SP: 0xff } });
    expect(r.registers.C).toBe(1);
  });

  it("pushes the address RTS expects, minus one", () => {
    const result = run([0x20, 0x00, 0x90], { registers: { SP: 0xff } }); // JSR $9000
    expect(result.exit).toEqual({ kind: "call", to: 0x9000, returnsTo: 0x8003 });
    // $8002 is the last byte of the JSR; RTS adds one to get $8003.
    expect(result.memoryWritten).toEqual([
      { address: 0x01fe, value: 0x02 },
      { address: 0x01ff, value: 0x80 },
    ]);
  });
});

describe("where the block went", () => {
  it("reports the branch target when the branch is taken", () => {
    // LDA #$00 / BEQ +2
    const result = run([0xa9, 0x00, 0xf0, 0x02]);
    expect(result.exit).toEqual({ kind: "goto", to: 0x8006 });
  });

  it("reports falling through when it is not", () => {
    const result = run([0xa9, 0x01, 0xf0, 0x02]);
    expect(result.exit).toEqual({ kind: "fallthrough", to: 0x8004 });
  });
});

describe("saying what the answer rests on", () => {
  it("warns about memory it read but was never given", () => {
    const result = run([0xad, 0x20, 0xd0]); // LDA $D020
    expect(result.registers.A).toBe(0);
    expect(result.memoryRead).toEqual([{ address: 0xd020, value: 0, source: "unknown" }]);
    expect(result.warnings.join(" ")).toContain("$D020");
  });

  it("stops rather than skipping an instruction it cannot model", () => {
    // $02 is an undocumented opcode. Carrying on would report a machine state
    // that never existed.
    const result = run([0xa9, 0x05, 0x02, 0xa9, 0x09]);
    expect(result.registers.A).toBe(0x05);
    expect(result.exit).toEqual({ kind: "stopped", at: 0x8002, reason: "unmodelled" });
    expect(result.executed).toHaveLength(2);
  });

  it("says a decimal result is the binary one", () => {
    const result = run([0xa9, 0x09, 0x69, 0x01], { registers: { D: 1 } });
    expect(result.registers.A).toBe(0x0a); // $10 on real hardware in decimal mode
    expect(result.warnings.join(" ")).toContain("decimal");
  });

  it("reports an unmodelled instruction in the static effects too", () => {
    const effects = blockEffects(blockOf([0xa9, 0x05, 0x02]).instructions);
    expect(effects.unmodelled).toEqual([{ address: 0x8002, mnemonic: "JAM" }]);
  });
});

describe("what a whole block touches", () => {
  it("counts a register read before it was written, and not after", () => {
    // LDA $10 / CLC / ADC #$01 / STA $10 — reads $10 and C, writes $10, A and flags.
    const effects = blockEffects(blockOf([0xa5, 0x10, 0x18, 0x69, 0x01, 0x85, 0x10]).instructions);
    // A is written before it is read, so it is not an input.
    expect(effects.inputs.map(formatVarnode)).toEqual(["$(0x10)"]);
    expect(effects.outputs.map(formatVarnode)).toContain("A");
    expect(effects.outputs.map(formatVarnode)).toContain("$(0x10)");
  });

  it("keeps a temporary out of both sides", () => {
    const ops = lift(blockOf([0xb5, 0x10]).instructions[0]);
    expect(ops.some((op) => op.output?.space === "unique")).toBe(true);
    expect(blockEffects(blockOf([0xb5, 0x10]).instructions).outputs.every((v) => v.space !== "unique")).toBe(
      true
    );
  });
});

describe("what a block does to the stack", () => {
  it("counts a call as two bytes, because it emits two pushes", () => {
    expect(stackDelta(blockOf([0x20, 0x00, 0x90]).instructions)).toBe(2); // JSR
    expect(stackDelta(blockOf([0x60]).instructions)).toBe(-2); // RTS
    expect(stackDelta(blockOf([0x40]).instructions)).toBe(-3); // RTI
  });

  it("nets a push against a pull", () => {
    // PHA / PHP / PLA
    expect(stackDelta(blockOf([0x48, 0x08, 0x68]).instructions)).toBe(1);
  });

  it("gives up rather than guessing after TXS", () => {
    // TXS sets the pointer outright. Nothing here can say to what, and zero
    // would be a guess dressed as an answer.
    expect(stackDelta(blockOf([0x48, 0x9a]).instructions)).toBeUndefined();
  });

  it("is zero for a run that does not touch the stack", () => {
    expect(stackDelta(blockOf([0xa9, 0x01, 0x85, 0x10]).instructions)).toBe(0);
  });
});
