import { describe, it, expect } from "vitest";
import { resolvePointer, targetsOf } from "./pointers.js";
import { buildBlocks } from "./blocks.js";
import { InstructionIndex, disassemble } from "../arch/mos6502/disassembler.js";
import { MemoryMap } from "../memory/memory-map.js";
import { BytesLayer } from "../memory/layer.js";

const ORG = 0x1000;

function program(bytes: number[]) {
  const map = new MemoryMap();
  map.addLayer(new BytesLayer("test", ORG, new Uint8Array(bytes)));
  const result = disassemble(map, { entryPoints: [ORG] });
  const index = new InstructionIndex(result.instructions);
  return { index, blocks: buildBlocks(index, [ORG]) };
}

describe("where an indirect access actually goes", () => {
  it("folds a pointer built from immediate loads", () => {
    // LDA #$00 / STA $02 / LDA #$D0 / STA $03 / LDA #$1B / STA ($02),Y / RTS
    // — which is how this program writes the VIC at all, and what a search of
    // $D000-$D02E could not see.
    const { index, blocks } = program([
      0xa9, 0x00, 0x85, 0x02, 0xa9, 0xd0, 0x85, 0x03, 0xa9, 0x1b, 0x91, 0x02, 0x60,
    ]);
    const store = index.get(0x100a)!;
    expect(store.mnemonic).toBe("STA");
    expect(resolvePointer(store, blocks)?.base).toBe(0xd000);
  });

  it("says where the halves were set, so the claim can be checked", () => {
    const { index, blocks } = program([
      0xa9, 0x00, 0x85, 0x02, 0xa9, 0xd0, 0x85, 0x03, 0x91, 0x02, 0x60,
    ]);
    expect(resolvePointer(index.get(0x1008)!, blocks)?.setAt).toEqual([0x1000, 0x1004]);
  });

  it("refuses when a half comes from a table rather than a literal", () => {
    // LDA $0340,X / STA $02 — a runtime value, so there is nothing to fold and
    // inventing a base would be worse than saying nothing.
    const { index, blocks } = program([
      0xbd, 0x40, 0x03, 0x85, 0x02, 0xa9, 0xd0, 0x85, 0x03, 0x91, 0x02, 0x60,
    ]);
    expect(resolvePointer(index.get(0x1009)!, blocks)).toBeUndefined();
  });

  it("refuses when only one half is known", () => {
    const { index, blocks } = program([0xa9, 0xd0, 0x85, 0x03, 0x91, 0x02, 0x60]);
    expect(resolvePointer(index.get(0x1004)!, blocks)).toBeUndefined();
  });

  it("takes the nearest store, since that is the one that ran", () => {
    // Set to $C000, then to $D000, then used.
    const { index, blocks } = program([
      0xa9, 0x00, 0x85, 0x02, 0xa9, 0xc0, 0x85, 0x03,
      0xa9, 0xd0, 0x85, 0x03, 0x91, 0x02, 0x60,
    ]);
    expect(resolvePointer(index.get(0x100c)!, blocks)?.base).toBe(0xd000);
  });

  it("leaves an ordinary operand alone", () => {
    const { index, blocks } = program([0x8d, 0x20, 0xd0, 0x60]); // STA $D020
    expect(targetsOf(index.get(ORG)!, blocks)).toMatchObject({
      address: 0xd020,
      indirect: false,
    });
  });
});
