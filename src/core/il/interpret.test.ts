import { describe, it, expect } from "vitest";
import { Machine, execute } from "./interpret.js";
import { PcodeOp, REG, constant, reg, unique } from "./pcode.js";

const run = (ops: PcodeOp[], setup?: (m: Machine) => void) => {
  const machine = new Machine();
  setup?.(machine);
  const flow = execute(ops, machine);
  return { machine, flow };
};

describe("evaluating the primitives", () => {
  it("copies and truncates to the width of the destination", () => {
    const { machine } = run([{ op: "COPY", output: reg(REG.A), inputs: [constant(0x1ff, 2)] }]);
    expect(machine.get(reg(REG.A))).toBe(0xff);
  });

  it("adds with wraparound, and says separately whether it carried", () => {
    // The distinction both references got wrong. Carry is its own operation,
    // not something a reader reconstructs from the result.
    const { machine } = run([
      { op: "INT_CARRY", output: reg(REG.C), inputs: [reg(REG.A), constant(0x01)] },
      { op: "INT_ADD", output: reg(REG.A), inputs: [reg(REG.A), constant(0x01)] },
    ], (m) => m.set(reg(REG.A), 0xff));

    expect(machine.get(reg(REG.A))).toBe(0x00);
    expect(machine.get(reg(REG.C))).toBe(1);
  });

  it("does not carry when the sum fits", () => {
    const { machine } = run([
      { op: "INT_CARRY", output: reg(REG.C), inputs: [reg(REG.A), constant(0x01)] },
    ], (m) => m.set(reg(REG.A), 0x10));
    expect(machine.get(reg(REG.C))).toBe(0);
  });

  it("distinguishes signed overflow from carry", () => {
    // $50 + $50 = $A0: no carry, but signed overflow — 80 + 80 exceeds +127.
    // Setting V = C, as one reference does, gets this exactly backwards.
    const { machine } = run([
      { op: "INT_CARRY", output: reg(REG.C), inputs: [reg(REG.A), constant(0x50)] },
      { op: "INT_SCARRY", output: reg(REG.V), inputs: [reg(REG.A), constant(0x50)] },
    ], (m) => m.set(reg(REG.A), 0x50));

    expect(machine.get(reg(REG.C))).toBe(0);
    expect(machine.get(reg(REG.V))).toBe(1);
  });

  it("compares signed and unsigned differently", () => {
    // $80 is 128 unsigned and -128 signed, which is the whole point of N.
    const { machine } = run([
      { op: "INT_LESS", output: unique(0), inputs: [constant(0x80), constant(0x10)] },
      { op: "INT_SLESS", output: unique(1), inputs: [constant(0x80), constant(0x10)] },
    ]);
    expect(machine.get(unique(0))).toBe(0);
    expect(machine.get(unique(1))).toBe(1);
  });

  it("shifts right without dragging the sign, unless asked to", () => {
    const { machine } = run([
      { op: "INT_RIGHT", output: unique(0), inputs: [constant(0x80), constant(1)] },
      { op: "INT_SRIGHT", output: unique(1), inputs: [constant(0x80), constant(1)] },
    ]);
    expect(machine.get(unique(0))).toBe(0x40);
    expect(machine.get(unique(1))).toBe(0xc0);
  });

  it("reads and writes memory little-endian", () => {
    const machine = new Machine();
    machine.write(0x1000, 0x1234, 2);
    expect(machine.memory[0x1000]).toBe(0x34);
    expect(machine.memory[0x1001]).toBe(0x12);
    expect(machine.read(0x1000, 2)).toBe(0x1234);
  });
});

describe("where control goes", () => {
  it("continues by default", () => {
    expect(run([{ op: "COPY", output: reg(REG.A), inputs: [constant(1)] }]).flow).toEqual({
      kind: "next",
    });
  });

  it("takes a conditional branch only when the condition holds", () => {
    const branch: PcodeOp[] = [
      { op: "CBRANCH", inputs: [constant(0x8000, 2), reg(REG.Z)] },
    ];
    expect(run(branch, (m) => m.set(reg(REG.Z), 1)).flow).toEqual({
      kind: "goto",
      address: 0x8000,
    });
    expect(run(branch, (m) => m.set(reg(REG.Z), 0)).flow).toEqual({ kind: "next" });
  });

  it("reports a call and a return as themselves", () => {
    expect(run([{ op: "CALL", inputs: [constant(0x8000, 2)] }]).flow).toMatchObject({
      kind: "call",
    });
    expect(run([{ op: "RETURN", inputs: [] }]).flow).toEqual({ kind: "return" });
  });

  it("stops at an effect it does not model, rather than inventing one", () => {
    // Decimal-mode arithmetic and the unstable illegal opcodes land here. Going
    // on would produce a number nobody can justify.
    const { flow, machine } = run([
      { op: "CALLOTHER", inputs: [constant(0)] },
      { op: "COPY", output: reg(REG.A), inputs: [constant(0x42)] },
    ]);
    expect(flow).toEqual({ kind: "unmodelled" });
    expect(machine.get(reg(REG.A))).toBe(0);
  });
});

describe("temporaries", () => {
  it("do not survive the instruction that made them", () => {
    const machine = new Machine();
    execute([{ op: "COPY", output: unique(0), inputs: [constant(0x7f)] }], machine);
    expect(machine.get(unique(0))).toBe(0x7f);

    execute([{ op: "COPY", output: reg(REG.A), inputs: [unique(0)] }], machine);
    expect(machine.get(reg(REG.A))).toBe(0);
  });
});
