import { describe, it, expect } from "vitest";
import { REGISTER_LAYOUTS, fieldsInMask, registerAt } from "./registers.js";
import { fieldBits } from "../memory/type.js";

/**
 * The bit layouts, against the arithmetic this repository already writes by hand.
 *
 * `devices/vic.ts` is the oracle here and it is a good one: it decodes these
 * registers to run the machine, so a layout that disagrees with it is wrong
 * about hardware that boots Gridrunner in the test suite next door.
 */
describe("what the bits of a register mean", () => {
  it("agrees with the shifts and masks vic.ts writes out", () => {
    // `(registers[0x18] >> 4) & 0x0f) * 0x400` — screen base.
    const vmcsb = registerAt(0xd018)!;
    expect(vmcsb.type.fields[4].name).toBe("screenBase");
    expect(fieldBits(vmcsb.type.fields[4].type, () => undefined)).toBe(4);
    // `((registers[0x18] >> 1) & 0x07) * 0x800` — character base.
    expect(vmcsb.type.fields[1].name).toBe("charBase");
    expect(fieldBits(vmcsb.type.fields[1].type, () => undefined)).toBe(3);
    // `registers[0x12] | ((registers[0x11] & 0x80) << 1)` — the ninth raster bit.
    expect(registerAt(0xd011)!.type.fields[7].name).toBe("rasterBit8");
  });

  it("names the fields a mask touches, which is the question AND asks", () => {
    // The acceptance test: write the whole byte and it is SCROLY; touch one bit
    // and the answer says which.
    expect(fieldsInMask(0xd011, 0x80)).toEqual(["SCROLY.rasterBit8"]);
    expect(fieldsInMask(0xd011, 0x07)).toEqual(["SCROLY.yScroll"]);
    // $7F is every field but the raster bit — the mask a program uses to clear
    // it, and exactly the change the 2021 patch made at $8BED.
    expect(fieldsInMask(0xd011, 0x7f)).toEqual([
      "SCROLY.extendedColour",
      "SCROLY.bitmapMode",
      "SCROLY.displayEnable",
      "SCROLY.rows25",
      "SCROLY.yScroll",
    ]);
    // A field only half covered has still been touched, and saying "none"
    // would be worse than saying which.
    expect(fieldsInMask(0xd018, 0x10)).toEqual(["VMCSB.screenBase"]);
    expect(fieldsInMask(0x9000, 0xff)).toEqual([]);
  });

  it("declares every field inside the byte it belongs to", () => {
    // A layout whose fields ran past the register would make every offset in it
    // a lie, and there is no reason to find that out from a listing.
    for (const { address, type } of REGISTER_LAYOUTS) {
      const bound = type.size * 8;
      const taken = new Set<number>();
      for (const [key, field] of Object.entries(type.fields)) {
        const offset = Number(key);
        const width = fieldBits(field.type, () => undefined) ?? 0;
        expect(offset + width, `${type.name} ${field.name}`).toBeLessThanOrEqual(bound);
        for (let b = offset; b < offset + width; b++) {
          expect(taken.has(b), `${type.name} bit ${b} declared twice`).toBe(false);
          taken.add(b);
        }
      }
      expect(registerAt(address)!.type.name).toBe(type.name);
    }
  });

  it("agrees with the SID renderer, which decodes these to play a tune", () => {
    // `sid-audio.ts` is the oracle here for the same reason `vic.ts` is above:
    // it reads these registers to render audio, so a layout that disagreed with
    // it would be wrong about a chip this repository can already play.
    //
    // `case 4: (value & 1) === 1` is the gate.
    expect(fieldsInMask(0xd404, 0x01)).toEqual(["SIDCTRL1.gate"]);
    // `case 5: attack = (value >> 4) & 0x0f; decay = value & 0x0f`.
    expect(fieldsInMask(0xd405, 0xf0)).toEqual(["SIDAD1.attack"]);
    expect(fieldsInMask(0xd405, 0x0f)).toEqual(["SIDAD1.decay"]);
    // `register === 24: volume = value & 0x0f`.
    expect(fieldsInMask(0xd418, 0x0f)).toEqual(["SIDVOLFILT.volume"]);

    // Three voices, seven registers apart, and the names say which — because
    // `SIDCTRL2.gate` must not be ambiguous about whose gate it is.
    for (const [voice, base] of [[1, 0xd404], [2, 0xd40b], [3, 0xd412]] as const) {
      expect(registerAt(base)!.type.name).toBe(`SIDCTRL${voice}`);
      expect(fieldsInMask(base, 0x80)).toEqual([`SIDCTRL${voice}.noise`]);
    }
  });

  it("keeps the platform's ids out of any project's namespace", () => {
    // These belong to the machine the way the symbol table does, so nothing an
    // operation can name may collide with one.
    for (const { type } of REGISTER_LAYOUTS) expect(type.id.startsWith("plat_")).toBe(true);
  });
});
