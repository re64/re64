import { describe, it, expect } from "vitest";
import { decimalModes, decimalSites } from "./decimal.js";
import { buildBlocks } from "./blocks.js";
import { InstructionIndex, disassemble } from "../arch/mos6502/disassembler.js";
import { MemoryMap } from "../memory/memory-map.js";
import { BytesLayer } from "../memory/layer.js";

const ORG = 0x1000;
function program(bytes: number[]) {
  const map = new MemoryMap();
  map.addLayer(new BytesLayer("test", ORG, new Uint8Array(bytes)));
  const index = new InstructionIndex(disassemble(map, { entryPoints: [ORG] }).instructions);
  return { blocks: buildBlocks(index, [ORG]), entries: [ORG] };
}

describe("proving the decimal flag", () => {
  it("is binary after CLD", () => {
    // CLD / ADC #$01 / RTS
    const { blocks, entries } = program([0xd8, 0x69, 0x01, 0x60]);
    expect(decimalModes(blocks, entries).get(0x1001)).toBe("binary");
  });

  it("is decimal after SED", () => {
    // SED / ADC #$01 / RTS
    const { blocks, entries } = program([0xf8, 0x69, 0x01, 0x60]);
    expect(decimalModes(blocks, entries).get(0x1001)).toBe("decimal");
  });

  it("is unknown at an entry point, because nothing cleared it", () => {
    // A 6502 does not clear D on reset or on interrupt — which is exactly why
    // real reset routines do it themselves. Assuming clear here would assume
    // the thing those CLDs exist to establish.
    const { blocks, entries } = program([0x69, 0x01, 0x60]);
    expect(decimalModes(blocks, entries).get(0x1000)).toBe("unknown");
  });

  it("is unknown after PLP, since the flag came off the stack", () => {
    // CLD / PLP / ADC #$01 / RTS
    const { blocks, entries } = program([0xd8, 0x28, 0x69, 0x01, 0x60]);
    expect(decimalModes(blocks, entries).get(0x1002)).toBe("unknown");
  });

  it("carries the answer across a branch when both paths agree", () => {
    // CLD / BNE +2 / NOP NOP / ADC #$01 / RTS — clear either way.
    const { blocks, entries } = program([0xd8, 0xd0, 0x02, 0xea, 0xea, 0x69, 0x01, 0x60]);
    expect(decimalModes(blocks, entries).get(0x1005)).toBe("binary");
  });

  it("gives up where two paths disagree", () => {
    // CLD / BNE +1 / SED / ADC #$01 / RTS
    //   fallthrough sets D, the branch skips it, so the ADC sees both.
    const { blocks, entries } = program([0xd8, 0xd0, 0x01, 0xf8, 0x69, 0x01, 0x60]);
    expect(decimalModes(blocks, entries).get(0x1004)).toBe("unknown");
  });

  it("terminates on a loop rather than chasing it", () => {
    // SED / ADC #$01 / JMP back — the fixpoint has to settle.
    const { blocks, entries } = program([0xf8, 0x69, 0x01, 0x4c, 0x01, 0x10]);
    expect(decimalModes(blocks, entries).get(0x1001)).toBe("decimal");
  });

  it("carries the answer into a routine it calls", () => {
    // The whole analysis turns on this. Block successors deliberately exclude
    // the call target — a JSR's successor is where it returns to — so following
    // them alone leaves every routine body a block nothing enters. That version
    // came back `unknown` at 17 of Gridrunner's 19 sites, because its one CLD
    // is in ColdStart and never reached what ColdStart calls.
    //
    // CLD / JSR $1006 / RTS ... $1006: ADC #$01 / RTS
    const { blocks, entries } = program([
      0xd8, 0x20, 0x06, 0x10, 0x60, 0xea, 0x69, 0x01, 0x60,
    ]);
    expect(decimalModes(blocks, entries).get(0x1006)).toBe("binary");
  });

  it("keeps the answer across a call that cannot touch the flag", () => {
    // CLD / JSR $1007 / ADC #$01 / RTS ... $1007: NOP / RTS
    const { blocks, entries } = program([
      0xd8, 0x20, 0x07, 0x10, 0x69, 0x01, 0x60, 0xea, 0x60,
    ]);
    expect(decimalModes(blocks, entries).get(0x1004)).toBe("binary");
  });

  it("gives up after a call that might", () => {
    // CLD / JSR $1007 / ADC #$01 / RTS ... $1007: SED / RTS
    const { blocks, entries } = program([
      0xd8, 0x20, 0x07, 0x10, 0x69, 0x01, 0x60, 0xf8, 0x60,
    ]);
    expect(decimalModes(blocks, entries).get(0x1004)).toBe("unknown");
  });

  it("reports only the sites that are not plain binary", () => {
    // CLD / ADC #$01 / SED / ADC #$02 / RTS
    const { blocks, entries } = program([0xd8, 0x69, 0x01, 0xf8, 0x69, 0x02, 0x60]);
    expect(decimalSites(blocks, entries)).toEqual([{ address: 0x1004, mode: "decimal" }]);
  });
});
