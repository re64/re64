import { describe, it, expect } from "vitest";
import {
  screenAddress,
  screenCell,
  spriteAddress,
  spriteAt,
  parseGeometry,
  COLOUR_RAM,
} from "./geometry.js";

/**
 * The arithmetic three runs did by hand.
 *
 * `$0592` to row 10, column 2 is the specific conversion experiment 8's readers
 * repeated most and asked for by name three times, so it is the one asserted
 * first.
 */
describe("where a thing is on the screen", () => {
  it("converts the address readers kept converting", () => {
    expect(screenAddress(10, 2)).toBe(0x0592);
    expect(screenCell(0x0592)).toEqual({
      row: 10,
      column: 2,
      cell: 402,
      colourRam: COLOUR_RAM + 402,
    });
  });

  it("round-trips every cell on the screen", () => {
    for (let row = 0; row < 25; row++) {
      for (let column = 0; column < 40; column++) {
        const cell = screenCell(screenAddress(row, column));
        expect(cell?.row).toBe(row);
        expect(cell?.column).toBe(column);
      }
    }
  });

  it("follows a screen the program has moved", () => {
    // The reason the base is an argument: a game that moves its screen to
    // $4000 would otherwise be given a confidently wrong address.
    expect(screenAddress(10, 2, 0x4000)).toBe(0x4192);
    expect(screenCell(0x4192, 0x4000)?.row).toBe(10);
    // And the same address means nothing against the default base.
    expect(screenCell(0x4192)).toBeUndefined();
  });

  it("pairs a cell with its colour, which never moves", () => {
    // Colour RAM is not banked and not movable, so this is the one part of the
    // answer that is the same whatever the program has done.
    expect(screenCell(0x0400)?.colourRam).toBe(0xd800);
    expect(screenCell(0x07e7)?.colourRam).toBe(0xdbe7);
  });

  it("says when an address is not on the screen at all", () => {
    expect(screenCell(0x03ff)).toBeUndefined();
    expect(screenCell(0x07e8)).toBeUndefined();
    expect(() => screenAddress(25, 0)).toThrow(/not on the screen/);
    expect(() => screenAddress(0, 40)).toThrow(/not on the screen/);
  });
});

describe("where a sprite is", () => {
  it("indexes 64-byte blocks from the bank", () => {
    // The distinction the decoder needed: a sprite uses 63 bytes and occupies
    // 64, so pointers are 64 apart.
    expect(spriteAddress(0)).toBe(0);
    expect(spriteAddress(0x9d)).toBe(0x2740);
    expect(spriteAddress(1)).toBe(64);
  });

  it("finds the pointer that reaches an address, and how far in", () => {
    expect(spriteAt(0x2740)).toEqual({ pointer: 0x9d, offset: 0 });
    // Only offset zero is a sprite's start; anything else is somebody reading
    // the middle of a picture.
    expect(spriteAt(0x2743)).toEqual({ pointer: 0x9d, offset: 3 });
  });

  it("follows the VIC bank, because a pointer is relative to it", () => {
    expect(spriteAddress(0x9d, 0x4000)).toBe(0x6740);
    expect(spriteAt(0x6740, 0x4000)).toEqual({ pointer: 0x9d, offset: 0 });
    // A bank is 16K, so nothing outside it is reachable by any pointer.
    expect(spriteAt(0x4000)).toBeUndefined();
  });

  it("refuses a pointer that is not one byte", () => {
    expect(() => spriteAddress(256)).toThrow(/one byte/);
    expect(() => spriteAddress(-1)).toThrow(/one byte/);
  });
});

describe("the same thing written into an address argument", () => {
  it("accepts a call with integer arguments, in the spellings addresses use", () => {
    expect(parseGeometry("screen(10,2)")).toBe(0x0592);
    expect(parseGeometry("screen(402)")).toBe(0x0592);
    expect(parseGeometry("sprite($9D)")).toBe(0x2740);
    expect(parseGeometry("sprite(157)")).toBe(0x2740);
    expect(parseGeometry(" SCREEN( 10 , 2 ) ")).toBe(0x0592);
  });

  it("takes a base or a bank, so a moved screen is expressible", () => {
    expect(parseGeometry("screen(10,2,$4000)")).toBe(0x4192);
    expect(parseGeometry("sprite($9D,$4000)")).toBe(0x6740);
  });

  it("is not an expression language, and does not pretend to be", () => {
    // The line: a call is a lookup with parentheses. Arithmetic would be a
    // grammar, with precedence to define and four consumers to keep identical.
    expect(parseGeometry("sprite($9D)+3")).toBeUndefined();
    expect(parseGeometry("screen(10,2) - 1")).toBeUndefined();
    expect(parseGeometry("$8000")).toBeUndefined();
    expect(parseGeometry("zone(5)")).toBeUndefined();
  });

  it("refuses arguments that are not a place", () => {
    expect(() => parseGeometry("screen(99,0)")).toThrow(/not on the screen/);
    expect(() => parseGeometry("screen(1,2,3,4)")).toThrow(/takes a cell/);
    expect(() => parseGeometry("sprite(999)")).toThrow(/one byte/);
  });
});
