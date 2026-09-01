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
    // The *stores*, not the loads that fed them. Running the path makes the
    // distinction meaningful: a pointer byte can be established through any
    // chain of instructions — `LDA #$D0 / TAX / STX $03` — and the write to the
    // cell is the only fixed point common to all of them.
    const { index, blocks } = program([
      0xa9, 0x00, 0x85, 0x02, 0xa9, 0xd0, 0x85, 0x03, 0x91, 0x02, 0x60,
    ]);
    expect(resolvePointer(index.get(0x1008)!, blocks)?.setAt).toEqual([0x1002, 0x1006]);
  });

  it("folds the index too, so three writes through one pointer are three addresses", () => {
    // The reason this was rewritten. Gridrunner sets the whole VIC through
    // `($02),Y`, and reporting the shared base $D000 for each made the
    // character base, the border and the background indistinguishable.
    //
    // LDA #$D0 / STA $03 / LDA #$00 / STA $02 / LDY #$18 / TYA / STA ($02),Y
    const { index, blocks } = program([
      0xa9, 0xd0, 0x85, 0x03, 0xa9, 0x00, 0x85, 0x02,
      0xa0, 0x18, 0x98, 0x91, 0x02, 0x60,
    ]);
    expect(resolvePointer(index.get(0x100b)!, blocks)).toMatchObject({
      base: 0xd000,
      address: 0xd018,
      // The byte stored, which is what makes the answer say something: $18 sets
      // the character base to $2000.
      value: 0x18,
    });
  });

  it("gives the base but no address when the index was never assigned", () => {
    // Y unassigned means the machine ran it as zero, so the address it touched
    // *is* the base. Reporting that as the address would dress an assumption up
    // as a finding, and the pointer is still worth having.
    const { index, blocks } = program([
      0xa9, 0x00, 0x85, 0x02, 0xa9, 0xd0, 0x85, 0x03, 0xa9, 0x1b, 0x91, 0x02, 0x60,
    ]);
    const resolved = resolvePointer(index.get(0x100a)!, blocks)!;
    expect(resolved.base).toBe(0xd000);
    expect(resolved.address).toBeUndefined();
  });

  it("locates the pointer through X for ($zp,X), rather than assuming zero", () => {
    // The hand folder read the pointer from $zp whatever X held, which is
    // silently wrong for any X but zero. Here the pair lives at $06/$07.
    //
    // LDA #$34 / STA $06 / LDA #$12 / STA $07 / LDX #$04 / LDA ($02,X)
    const { index, blocks } = program([
      0xa9, 0x34, 0x85, 0x06, 0xa9, 0x12, 0x85, 0x07,
      0xa2, 0x04, 0xa1, 0x02, 0x60,
    ]);
    expect(resolvePointer(index.get(0x100a)!, blocks)).toMatchObject({
      base: 0x1234,
      address: 0x1234,
    });
  });

  it("refuses ($zp,X) when X is unknown, since the pointer cannot be located", () => {
    const { index, blocks } = program([
      0xa9, 0x34, 0x85, 0x06, 0xa9, 0x12, 0x85, 0x07, 0xa1, 0x02, 0x60,
    ]);
    expect(resolvePointer(index.get(0x1008)!, blocks)).toBeUndefined();
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
