import { describe, it, expect } from "vitest";
import { Machine, execute } from "./interpret.js";
import { stepMachine } from "./run.js";
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
    // The address is carried, not implied. Dropping it made every RTS continue
    // at the byte after itself, which the functional test caught and no
    // hand-written case here did.
    expect(run([{ op: "RETURN", inputs: [constant(0x9042, 2)] }]).flow).toEqual({
      kind: "return",
      address: 0x9042,
    });
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

describe("chips on the bus", () => {
  /**
   * A device answers a read, which a `Watcher` fundamentally cannot.
   *
   * The seam the whole machine model rests on. A watcher is *told* what
   * happened after memory has already decided, so a VIC register read came back
   * as whatever had last been written to that cell of RAM — and `$D012` is the
   * raster line, which no amount of observing produces.
   */
  it("answers a read instead of memory", () => {
    const machine = new Machine();
    machine.memory[0xd012] = 0x00;
    machine.bus = {
      readByte: (at) => (at === 0xd012 ? 0x37 : undefined),
      writeByte: () => false,
    };

    expect(machine.read(0xd012, 1)).toBe(0x37);
    // Untouched: the device answered, so memory was never consulted.
    expect(machine.memory[0xd012]).toBe(0x00);
    // And "not mine" still reads memory.
    machine.memory[0xd013] = 0x99;
    expect(machine.read(0xd013, 1)).toBe(0x99);
  });

  it("absorbs a write, leaving no shadow in memory behind it", () => {
    // Writing to memory as well would leave a byte a later read past the device
    // would find — which is how a write-only register grows a phantom value.
    const machine = new Machine();
    const taken: number[] = [];
    machine.bus = {
      readByte: () => undefined,
      writeByte: (at, value) => {
        if (at !== 0xd020) return false;
        taken.push(value);
        return true;
      },
    };

    machine.write(0xd020, 0x0e, 1);
    machine.write(0xd021, 0x06, 1);

    expect(taken).toEqual([0x0e]);
    expect(machine.memory[0xd020]).toBe(0x00);
    expect(machine.memory[0xd021]).toBe(0x06);
  });

  it("asks one byte at a time, so a 16-bit access may straddle its edge", () => {
    // What the hardware does, and it means a device never has to reason about
    // an access half of which is not its own.
    const machine = new Machine();
    machine.memory[0xd000] = 0x11;
    machine.memory[0xd001] = 0x22;
    machine.bus = {
      readByte: (at) => (at === 0xd001 ? 0xff : undefined),
      writeByte: () => false,
    };

    expect(machine.read(0xd000, 2)).toBe(0xff11);
  });

  it("still sees a write the device took", () => {
    // `runProgram` counts hardware traffic through the watcher, so a write the
    // VIC absorbed has to reach it or the report loses exactly the accesses it
    // exists to report.
    const machine = new Machine();
    const seen: number[] = [];
    machine.bus = { readByte: () => undefined, writeByte: () => true };
    machine.watch = { read: () => {}, write: (address) => void seen.push(address) };

    machine.write(0xd020, 0x0e, 1);
    expect(seen).toEqual([0xd020]);
  });

  it("is flat 64K with nothing installed", () => {
    const machine = new Machine();
    machine.write(0xd012, 0x42, 1);
    expect(machine.read(0xd012, 1)).toBe(0x42);
    expect(machine.memory[0xd012]).toBe(0x42);
  });
});

describe("counting cycles as it runs", () => {
  /** Run one instruction at $1000 over the bytes given, and say what it cost. */
  function cost(bytes: number[], setup: (m: Machine) => void = () => {}): number {
    const machine = new Machine();
    machine.memory.set(new Uint8Array(bytes), 0x1000);
    setup(machine);
    return stepMachine(machine, 0x1000)!.cycles;
  }

  it("charges the table's count when nothing is conditional", () => {
    expect(cost([0xa9, 0x01])).toBe(2); // LDA #$01
    expect(cost([0xad, 0x00, 0x20])).toBe(4); // LDA $2000
  });

  it("charges one more when an indexed read carries into the high byte", () => {
    // LDA $20FF,X — the penalty the opcode table can only mark as possible,
    // because whether it happens depends on what X holds when it runs.
    const withX = (x: number) => (m: Machine) =>
      m.set({ space: "register", offset: REG.X, size: 1 }, x);
    expect(cost([0xbd, 0xff, 0x20], withX(0x00))).toBe(4);
    expect(cost([0xbd, 0xff, 0x20], withX(0x01))).toBe(5);
  });

  it("charges a store the fix-up whether it carries or not", () => {
    // STA $20FF,X is five either way: a store cannot skip the fix-up, because
    // it has to know where to put the byte.
    const withX = (x: number) => (m: Machine) =>
      m.set({ space: "register", offset: REG.X, size: 1 }, x);
    expect(cost([0x9d, 0xff, 0x20], withX(0x00))).toBe(5);
    expect(cost([0x9d, 0xff, 0x20], withX(0x01))).toBe(5);
  });

  it("charges a branch by whether it was taken, and how far", () => {
    // BNE, with Z decided by the caller. Two not taken, three taken, four taken
    // onto another page — and a frame drifts if a taken branch counts as two.
    const zero = (set: number) => (m: Machine) =>
      m.set({ space: "register", offset: REG.Z, size: 1 }, set);
    expect(cost([0xd0, 0x02], zero(1))).toBe(2);
    expect(cost([0xd0, 0x02], zero(0))).toBe(3);
    // Backwards over the page boundary below $1000.
    expect(cost([0xd0, 0x80], zero(0))).toBe(4);
  });

  it("charges an indirect read through a pointer that carries", () => {
    // LDA ($10),Y with the pointer at $20FF: the same rule one indirection on.
    const setup = (y: number) => (m: Machine) => {
      m.memory[0x10] = 0xff;
      m.memory[0x11] = 0x20;
      m.set({ space: "register", offset: REG.Y, size: 1 }, y);
    };
    expect(cost([0xb1, 0x10], setup(0x00))).toBe(5);
    expect(cost([0xb1, 0x10], setup(0x01))).toBe(6);
  });
});
