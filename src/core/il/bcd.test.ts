import { describe, it, expect } from "vitest";
import { Machine, execute } from "./interpret.js";
import { PcodeOp, constant, unique } from "./pcode.js";

/**
 * Binary-coded decimal, checked against the machine's published behaviour.
 *
 * These are the values the functional test's decimal section walks through
 * exhaustively, and the ones test 43 uses to prove `D` survives the stack:
 * `$55 + $55` is `$AA` in binary and `$10` with carry in decimal.
 */
const bcd = (op: "INT_BCD_ADD" | "INT_BCD_SUB", a: number, m: number, carryIn: number) => {
  const machine = new Machine();
  const ops: PcodeOp[] = [
    {
      op,
      output: unique(0, 2),
      inputs: [constant(a), constant(m), constant(carryIn)],
    },
  ];
  execute(ops, machine);
  const both = machine.get(unique(0, 2));
  return { result: both & 0xff, carry: (both >> 8) & 1 };
};

describe("decimal addition", () => {
  it("carries at ten rather than at sixteen", () => {
    // The case test 43 turns on: $55 + $55 is $AA binary, $10 carry 1 decimal.
    expect(bcd("INT_BCD_ADD", 0x55, 0x55, 0)).toEqual({ result: 0x10, carry: 1 });
  });

  it("adds without correction where no nibble overflows", () => {
    expect(bcd("INT_BCD_ADD", 0x12, 0x34, 0)).toEqual({ result: 0x46, carry: 0 });
  });

  it("wraps at ninety-nine", () => {
    expect(bcd("INT_BCD_ADD", 0x99, 0x01, 0)).toEqual({ result: 0x00, carry: 1 });
  });

  it("takes the carry in", () => {
    expect(bcd("INT_BCD_ADD", 0x12, 0x34, 1)).toEqual({ result: 0x47, carry: 0 });
    expect(bcd("INT_BCD_ADD", 0x99, 0x00, 1)).toEqual({ result: 0x00, carry: 1 });
  });

  it("corrects the low nibble alone", () => {
    expect(bcd("INT_BCD_ADD", 0x08, 0x04, 0)).toEqual({ result: 0x12, carry: 0 });
  });
});

describe("decimal subtraction", () => {
  it("subtracts with carry meaning no borrow", () => {
    expect(bcd("INT_BCD_SUB", 0x46, 0x12, 1)).toEqual({ result: 0x34, carry: 1 });
  });

  it("borrows across the nibble", () => {
    expect(bcd("INT_BCD_SUB", 0x32, 0x14, 1)).toEqual({ result: 0x18, carry: 1 });
  });

  it("wraps and clears carry when it goes below zero", () => {
    expect(bcd("INT_BCD_SUB", 0x12, 0x34, 1)).toEqual({ result: 0x78, carry: 0 });
  });

  it("takes the borrow in", () => {
    expect(bcd("INT_BCD_SUB", 0x46, 0x12, 0)).toEqual({ result: 0x33, carry: 1 });
  });
});
