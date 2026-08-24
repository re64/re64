import { describe, it, expect } from "vitest";
import { XrefIndex } from "./xrefs.js";
import { Reference } from "../arch/mos6502/disassembler.js";

const refs = (entries: [number, Reference[]][]) => new XrefIndex(new Map(entries));

describe("XrefIndex", () => {
  it("reports the references pointing at an address", () => {
    const index = refs([
      [0x8100, [{ type: "call", from: 0x8000 }, { type: "call", from: 0x8010 }]],
    ]);

    expect(index.count(0x8100)).toBe(2);
    expect(index.to(0x8100).map((r) => r.from)).toEqual([0x8000, 0x8010]);
    expect(index.count(0x9999)).toBe(0);
  });

  it("distinguishes call targets from branch targets", () => {
    // The seed of call-graph analysis: a JSR target has callers and a return
    // contract; a branch target is intra-function.
    const index = refs([
      [0x8100, [{ type: "call", from: 0x8000 }]],
      [0x8200, [{ type: "branch", from: 0x81f0 }]],
      [0x8300, [{ type: "data", from: 0x8020 }]],
    ]);

    expect(index.callTargets()).toEqual([0x8100]);
    expect(index.hasType(0x8200, "branch")).toBe(true);
    expect(index.hasType(0x8200, "call")).toBe(false);
  });

  it("counts an address once even with mixed reference types", () => {
    const index = refs([
      [0x8100, [{ type: "call", from: 0x8000 }, { type: "jump", from: 0x8010 }]],
    ]);

    expect(index.callTargets()).toEqual([0x8100]);
    expect(index.count(0x8100)).toBe(2);
  });

  it("returns targets in ascending address order", () => {
    const index = refs([
      [0x8300, [{ type: "call", from: 0 }]],
      [0x8100, [{ type: "call", from: 0 }]],
      [0x8200, [{ type: "call", from: 0 }]],
    ]);

    expect(index.targets()).toEqual([0x8100, 0x8200, 0x8300]);
    expect(index.size).toBe(3);
  });
});
