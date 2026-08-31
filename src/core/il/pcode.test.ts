import { describe, it, expect } from "vitest";
import {
  PcodeOp,
  REG,
  constant,
  flagsWritten,
  formatOp,
  formatOps,
  formatVarnode,
  reads,
  reg,
  sameVarnode,
  unique,
  writes,
} from "./pcode.js";

/** `LDA #$1F` as it would be lifted: load the value, then set N and Z from it. */
const LDA_IMMEDIATE: PcodeOp[] = [
  { op: "COPY", output: reg(REG.A), inputs: [constant(0x1f)] },
  { op: "INT_EQUAL", output: reg(REG.Z), inputs: [reg(REG.A), constant(0)] },
  { op: "INT_SLESS", output: reg(REG.N), inputs: [reg(REG.A), constant(0)] },
];

describe("naming a slot", () => {
  it("prints a register by name, not by number", () => {
    expect(formatVarnode(reg(REG.A))).toBe("A");
    expect(formatVarnode(reg(REG.PC, 2))).toBe("PC");
  });

  it("distinguishes a literal from an address", () => {
    // #0x10 is the number sixteen; $(0x10) is what lives at address sixteen.
    expect(formatVarnode(constant(0x10))).toBe("#0x10");
    expect(formatVarnode({ space: "ram", offset: 0x10, size: 1 })).toBe("$(0x10)");
  });

  it("shows a temporary's width only when it is not a byte", () => {
    expect(formatVarnode(unique(3))).toBe("u3");
    expect(formatVarnode(unique(3, 2))).toBe("u3:2");
  });

  it("treats size as part of identity", () => {
    // The same offset at two widths is two different values, which is how a
    // 16-bit PC and its 8-bit halves coexist.
    expect(sameVarnode(reg(REG.PC, 2), reg(REG.PC, 1))).toBe(false);
    expect(sameVarnode(reg(REG.A), reg(REG.A))).toBe(true);
  });
});

describe("printing an operation", () => {
  it("reads as an assignment when it produces a value", () => {
    expect(formatOp(LDA_IMMEDIATE[0])).toBe("A = COPY #0x1F");
  });

  it("omits the assignment when it does not", () => {
    expect(formatOp({ op: "BRANCH", inputs: [constant(0x8000, 2)] })).toBe("BRANCH #0x8000");
  });

  it("prints a sequence one operation per line", () => {
    expect(formatOps(LDA_IMMEDIATE).split("\n")).toHaveLength(3);
  });
});

describe("what an instruction touches", () => {
  it("reads the clobber set off the operations", () => {
    // The whole reason for the IL: this is derived, not a table kept beside the
    // semantics that can drift away from them.
    expect(writes(LDA_IMMEDIATE).map(formatVarnode)).toEqual(["A", "Z", "N"]);
  });

  it("names the flags separately, since that is the usual question", () => {
    expect(flagsWritten(LDA_IMMEDIATE).sort()).toEqual([REG.Z, REG.N].sort());
  });

  it("does not count a temporary as clobbered", () => {
    // A unique dies with the instruction that made it. Reporting it would say
    // every instruction destroys state nobody can observe.
    const ops: PcodeOp[] = [
      { op: "INT_ADD", output: unique(0), inputs: [reg(REG.A), constant(1)] },
      { op: "COPY", output: reg(REG.A), inputs: [unique(0)] },
    ];
    expect(writes(ops).map(formatVarnode)).toEqual(["A"]);
  });

  it("counts only what is read before this instruction wrote it", () => {
    // LDA writes A and then reads it back to set the flags. It does not depend
    // on the old A, and saying it did would make every instruction look like it
    // depends on everything it touches.
    expect(reads(LDA_IMMEDIATE).map(formatVarnode)).toEqual([]);
  });

  it("does count a register read before being written", () => {
    //  INC A: reads A, then writes it.
    const ops: PcodeOp[] = [
      { op: "INT_ADD", output: reg(REG.A), inputs: [reg(REG.A), constant(1)] },
    ];
    expect(reads(ops).map(formatVarnode)).toEqual(["A"]);
  });

  it("ignores literals, which are read from nowhere", () => {
    expect(reads([{ op: "COPY", output: reg(REG.A), inputs: [constant(9)] }])).toEqual([]);
  });
});
