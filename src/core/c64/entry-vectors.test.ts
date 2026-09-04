import { describe, it, expect } from "vitest";
import { kernalClobbers, classifyOrigins } from "./entry-vectors.js";
import { KERNAL_CLOBBERS } from "./kernal-effects.js";
import { MemoryMap } from "../memory/memory-map.js";
import { BytesLayer } from "../memory/layer.js";
import { InstructionIndex, disassemble } from "../arch/mos6502/disassembler.js";
import { buildBlocks } from "../analysis/blocks.js";
import { proveValues, valueBefore } from "../analysis/values.js";
import { isExact } from "../il/known-bits.js";
import { REG } from "../il/pcode.js";
import { REGISTER_NAMES } from "../il/run.js";

const ORG = 0x1000;

describe("what a caller is told an undecoded ROM call costs it", () => {
  /** A routine in the table that writes a register and gives it back. */
  const givesBack = (name: string) =>
    KERNAL_CLOBBERS.find((c) => c.writes.includes(name) && c.preserves.includes(name));

  it("drops a register the routine provably restores", () => {
    // The `TXA / TAX` shape, and the reason preservation is tracked at all: a
    // summary of what a routine *writes* says a caller loses something it in
    // fact gets back. Two routines in this ROM write X and restore it.
    const routine = givesBack("X");
    expect(routine, "no routine both writes and preserves X").toBeDefined();

    const told = kernalClobbers(new MemoryMap())(routine!.address) ?? [];
    expect(told.map((offset) => REGISTER_NAMES[offset])).not.toContain("X");
    // The rest of what it writes is still reported: this subtracts, it does not
    // discard the answer.
    expect(told.length).toBeGreaterThan(0);
  });

  it("keeps the caller's X across a call to it", () => {
    // The whole path, rather than either half: LDX #$42 / JSR <routine> / RTS,
    // with nothing supplying the callee. Without the subtraction the analysis
    // assumes the call wrote X and the value is gone.
    const routine = givesBack("X")!;
    const map = new MemoryMap();
    map.addLayer(
      new BytesLayer(
        "caller",
        ORG,
        new Uint8Array([0xa2, 0x42, 0x20, routine.address & 0xff, routine.address >> 8, 0x60])
      )
    );
    expect(map.readByte(routine.address), "the callee must be undecoded").toBeUndefined();

    const index = new InstructionIndex(disassemble(map, { entryPoints: [ORG] }).instructions);
    const analysis = proveValues(buildBlocks(index, [ORG]), [ORG], {
      externalWrites: kernalClobbers(map),
    });

    const x = valueBefore(analysis, ORG + 5, REG.X);
    expect(isExact(x, 1)).toBe(true);
    expect(x.value).toBe(0x42);

    // And A, which that routine really does destroy, is gone.
    expect(isExact(valueBefore(analysis, ORG + 5, REG.A), 1)).toBe(false);
  });

  it("assumes the worst about an address the table does not cover", () => {
    // An absent row means "no idea", never "touches nothing" — the omission that
    // produced a proof out of thin air before any of this existed.
    const map = new MemoryMap();
    map.addLayer(new BytesLayer("caller", ORG, new Uint8Array([0xa2, 0x42, 0x20, 0x00, 0x90, 0x60])));
    const index = new InstructionIndex(disassemble(map, { entryPoints: [ORG] }).instructions);
    const analysis = proveValues(buildBlocks(index, [ORG]), [ORG], {
      externalWrites: kernalClobbers(map),
    });
    expect(isExact(valueBefore(analysis, ORG + 5, REG.X), 1)).toBe(false);
  });

  it("says nothing about an address the project supplies itself", () => {
    // A project that loads its own ROM has a better answer, and it is right
    // about *that* ROM rather than the one this table came from.
    const map = new MemoryMap();
    map.addLayer(new BytesLayer("rom", 0xe000, new Uint8Array(0x2000)));
    expect(kernalClobbers(map)(KERNAL_CLOBBERS[0].address)).toBeUndefined();
  });

  it("reads the handler kinds out of the bytes", () => {
    const map = new MemoryMap();
    map.addLayer(new BytesLayer("vectors", 0x0314, new Uint8Array([0x00, 0x20, 0x00, 0x30])));
    const kinds = classifyOrigins(map);
    expect(kinds.get(0x2000)).toBe("interrupt");
    expect(kinds.get(0x3000)).toBe("brk");
  });
});
