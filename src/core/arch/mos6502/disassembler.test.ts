import { describe, it, expect } from "vitest";
import { disassemble, InstructionIndex } from "./disassembler.js";
import { ByteReader } from "./decoder.js";
import { RegionIndex, createUserRegion } from "../../memory/region.js";

/** Simple byte reader from an array at a base address */
function arrayReader(base: number, bytes: number[]): ByteReader {
  return {
    readByte(address: number): number | undefined {
      const offset = address - base;
      if (offset < 0 || offset >= bytes.length) return undefined;
      return bytes[offset];
    },
  };
}

describe("disassemble", () => {
  it("disassembles a simple linear sequence", () => {
    // LDA #$01; LDX #$02; RTS
    const reader = arrayReader(0x1000, [0xa9, 0x01, 0xa2, 0x02, 0x60]);
    const result = disassemble(reader, { entryPoints: [0x1000] });

    expect(result.instructions.size).toBe(3);
    expect(result.warnings).toHaveLength(0);

    const instrs = [...result.instructions.values()].sort((a, b) => a.address - b.address);
    expect(instrs[0].mnemonic).toBe("LDA");
    expect(instrs[1].mnemonic).toBe("LDX");
    expect(instrs[2].mnemonic).toBe("RTS");
  });

  it("follows unconditional jumps", () => {
    // JMP $1010 at $1000
    // NOP at $1010
    // RTS at $1011
    const bytes = new Array(0x20).fill(0);
    bytes[0x00] = 0x4c; // JMP
    bytes[0x01] = 0x10;
    bytes[0x02] = 0x10;
    bytes[0x10] = 0xea; // NOP
    bytes[0x11] = 0x60; // RTS

    const reader = arrayReader(0x1000, bytes);
    const result = disassemble(reader, { entryPoints: [0x1000] });

    expect(result.instructions.size).toBe(3);
    expect(result.instructions.has(0x1000)).toBe(true); // JMP
    expect(result.instructions.has(0x1010)).toBe(true); // NOP
    expect(result.instructions.has(0x1011)).toBe(true); // RTS
    // Should NOT have decoded 0x1003 (after JMP)
    expect(result.instructions.has(0x1003)).toBe(false);
  });

  it("follows conditional branches both ways", () => {
    // BEQ +$05 at $1000 (branch to $1007)
    // NOP at $1002 (fall-through)
    // RTS at $1003
    // ...
    // NOP at $1007 (branch target)
    // RTS at $1008
    const bytes = new Array(0x10).fill(0);
    bytes[0x00] = 0xf0; // BEQ
    bytes[0x01] = 0x05; // +5 -> $1007
    bytes[0x02] = 0xea; // NOP
    bytes[0x03] = 0x60; // RTS
    bytes[0x07] = 0xea; // NOP
    bytes[0x08] = 0x60; // RTS

    const reader = arrayReader(0x1000, bytes);
    const result = disassemble(reader, { entryPoints: [0x1000] });

    expect(result.instructions.size).toBe(5);
    expect(result.instructions.has(0x1000)).toBe(true); // BEQ
    expect(result.instructions.has(0x1002)).toBe(true); // NOP (fall-through)
    expect(result.instructions.has(0x1003)).toBe(true); // RTS
    expect(result.instructions.has(0x1007)).toBe(true); // NOP (branch target)
    expect(result.instructions.has(0x1008)).toBe(true); // RTS
  });

  it("follows JSR and continues after", () => {
    // JSR $1010 at $1000
    // RTS at $1003 (after JSR returns)
    // ...
    // NOP at $1010 (subroutine)
    // RTS at $1011
    const bytes = new Array(0x20).fill(0);
    bytes[0x00] = 0x20; // JSR
    bytes[0x01] = 0x10;
    bytes[0x02] = 0x10;
    bytes[0x03] = 0x60; // RTS
    bytes[0x10] = 0xea; // NOP
    bytes[0x11] = 0x60; // RTS

    const reader = arrayReader(0x1000, bytes);
    const result = disassemble(reader, { entryPoints: [0x1000] });

    expect(result.instructions.size).toBe(4);
    expect(result.instructions.has(0x1000)).toBe(true); // JSR
    expect(result.instructions.has(0x1003)).toBe(true); // RTS (after JSR)
    expect(result.instructions.has(0x1010)).toBe(true); // NOP (subroutine)
    expect(result.instructions.has(0x1011)).toBe(true); // RTS
  });

  it("handles multiple entry points", () => {
    // Two separate routines
    const bytes = new Array(0x20).fill(0);
    bytes[0x00] = 0xea; // NOP at $1000
    bytes[0x01] = 0x60; // RTS
    bytes[0x10] = 0xea; // NOP at $1010
    bytes[0x11] = 0x60; // RTS

    const reader = arrayReader(0x1000, bytes);
    const result = disassemble(reader, { entryPoints: [0x1000, 0x1010] });

    expect(result.instructions.size).toBe(4);
  });

  it("stops at undefined bytes", () => {
    // NOP, then undefined
    const reader = arrayReader(0x1000, [0xea]);
    const result = disassemble(reader, { entryPoints: [0x1000] });

    expect(result.instructions.size).toBe(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].type).toBe("undefined");
    expect(result.warnings[0].address).toBe(0x1001);
  });

  it("stops at data regions", () => {
    // NOP, NOP, NOP - but second NOP is in a data region
    const reader = arrayReader(0x1000, [0xea, 0xea, 0xea]);
    const regions = new RegionIndex();
    regions.addRegion(createUserRegion("rgn_1001", 0x1001, 0x1003, "data"));

    const result = disassemble(reader, {
      entryPoints: [0x1000],
      regions,
    });

    expect(result.instructions.size).toBe(1);
    expect(result.instructions.has(0x1000)).toBe(true);
    expect(result.instructions.has(0x1001)).toBe(false);
  });

  it("warns on overlapping instructions", () => {
    // Two entry points that would create overlapping instructions
    // LDA $1234 at $1000 (3 bytes)
    // Entry at $1001 would try to decode mid-instruction
    const reader = arrayReader(0x1000, [0xad, 0x34, 0x12, 0x60]);
    const result = disassemble(reader, { entryPoints: [0x1000, 0x1001] });

    expect(result.warnings.some((w) => w.type === "overlap")).toBe(true);
  });

  it("does not re-decode already visited addresses", () => {
    // Loop: NOP; JMP $1000
    const reader = arrayReader(0x1000, [0xea, 0x4c, 0x00, 0x10]);
    const result = disassemble(reader, { entryPoints: [0x1000] });

    expect(result.instructions.size).toBe(2);
  });
});

describe("InstructionIndex", () => {
  it("provides fast lookup by address", () => {
    const reader = arrayReader(0x1000, [0xea, 0xea, 0x60]);
    const result = disassemble(reader, { entryPoints: [0x1000] });
    const index = new InstructionIndex(result.instructions);

    expect(index.get(0x1000)?.mnemonic).toBe("NOP");
    expect(index.get(0x1001)?.mnemonic).toBe("NOP");
    expect(index.get(0x1002)?.mnemonic).toBe("RTS");
    expect(index.get(0x1003)).toBeUndefined();
  });

  it("returns sorted instructions", () => {
    const reader = arrayReader(0x1000, [0xea, 0xea, 0x60]);
    const result = disassemble(reader, { entryPoints: [0x1000] });
    const index = new InstructionIndex(result.instructions);

    const all = index.all();
    expect(all[0].address).toBe(0x1000);
    expect(all[1].address).toBe(0x1001);
    expect(all[2].address).toBe(0x1002);
  });

  it("returns instructions in range", () => {
    const reader = arrayReader(0x1000, [0xea, 0xea, 0xea, 0x60]);
    const result = disassemble(reader, { entryPoints: [0x1000] });
    const index = new InstructionIndex(result.instructions);

    const range = index.range(0x1001, 0x1003);
    expect(range.length).toBe(2);
    expect(range[0].address).toBe(0x1001);
    expect(range[1].address).toBe(0x1002);
  });
});

describe("scaling", () => {
  /**
   * Guards a change that is invisible in correctness and enormous in cost.
   *
   * Overlap detection used to scan every instruction decoded so far for every
   * address queued, which is quadratic: fine at a thousand instructions, four
   * seconds at forty thousand. Analysis now runs on the server, where that
   * would block the event loop and stall every connected browser.
   */
  it("stays linear over a large program", () => {
    // NOP-sleds decode one byte at a time, so this is 0x8000 instructions.
    const size = 0x8000;
    const bytes = new Uint8Array(size).fill(0xea);
    const reader = {
      readByte: (a: number) => (a >= 0x8000 && a < 0x8000 + size ? bytes[a - 0x8000] : undefined),
    };

    const started = performance.now();
    const result = disassemble(reader, { entryPoints: [0x8000] });
    const elapsed = performance.now() - started;

    expect(result.instructions.size).toBe(size);
    // The quadratic version took seconds at this size; the bound is generous so
    // this fails on a regression rather than on a slow machine.
    expect(elapsed).toBeLessThan(500);
  });

  it("still reports an instruction landing inside another", () => {
    // JMP $8001 — into the middle of its own three-byte encoding.
    const bytes = new Uint8Array([0x4c, 0x01, 0x80]);
    const reader = {
      readByte: (a: number) => (a >= 0x8000 && a < 0x8003 ? bytes[a - 0x8000] : undefined),
    };

    const result = disassemble(reader, { entryPoints: [0x8000] });
    expect(result.warnings).toContainEqual({
      type: "overlap",
      address: 0x8001,
      existingAddress: 0x8000,
    });
  });
});
