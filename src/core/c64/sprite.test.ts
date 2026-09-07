import { describe, it, expect } from "vitest";
import { C64 } from "../machine/c64.js";
import { composeScreen, WIDTH } from "./screen.js";

/**
 * Sprites, and specifically the two bits that made a picture *almost* right.
 *
 * Experiment 9's editor could not photograph the game, because `composeScreen`
 * drew characters only — so it reconstructed the scene from the game's own
 * object table instead. That image was faithful except for size: the camel came
 * out at half scale and the birds at half width, because nothing read `$D01D`
 * and `$D017`. An almost-faithful picture is the confident wrong answer this
 * project refuses everywhere else, which is why expansion is asserted here
 * rather than assumed.
 */

/** The sprite's data block, and a machine with a blank screen under it. */
function withSprite(fill: number[]): C64 {
  const machine = new C64();
  // Screen at $0400, characters at $1000 — the ordinary arrangement, so the
  // pointers land at $07F8 where a real program would look for them.
  machine.bus.writeByte(0xd018, 0x14);

  // 64-byte blocks from the base of the VIC's bank, which is bank 0 here.
  const block = 0x30;
  machine.cpu.memory[0x07f8] = block;
  for (let i = 0; i < fill.length; i++) machine.cpu.memory[block * 64 + i] = fill[i];

  machine.bus.writeByte(0xd000, 24 + 8); // eight pixels in from the left
  machine.bus.writeByte(0xd001, 50 + 8); // and eight down
  machine.bus.writeByte(0xd027, 7); // yellow
  machine.bus.writeByte(0xd015, 0x01); // sprite 0 on
  return machine;
}

/** Twenty-one rows of three $FF bytes — every pixel of the sprite lit. */
const SOLID = Array.from({ length: 63 }, () => 0xff);

const count = (frame: { pixels: Uint8Array }, colour: number) =>
  frame.pixels.reduce((total, pixel) => total + (pixel === colour ? 1 : 0), 0);

describe("sprites", () => {
  it("draws twenty-four by twenty-one at its own position", () => {
    const machine = withSprite(SOLID);
    const frame = composeScreen(machine.bus, machine.cpu.memory);

    expect(count(frame, 7)).toBe(24 * 21);
    // Top-left corner exactly where the chip's coordinates put it.
    expect(frame.pixels[8 * WIDTH + 8]).toBe(7);
    expect(frame.pixels[7 * WIDTH + 7]).not.toBe(7);
  });

  it("doubles width, height, or both, which is what was missing", () => {
    const wide = withSprite(SOLID);
    wide.bus.writeByte(0xd01d, 0x01);
    expect(count(composeScreen(wide.bus, wide.cpu.memory), 7)).toBe(48 * 21);

    const tall = withSprite(SOLID);
    tall.bus.writeByte(0xd017, 0x01);
    expect(count(composeScreen(tall.bus, tall.cpu.memory), 7)).toBe(24 * 42);

    // The camel: expanded both ways, four times the area of what was drawn.
    const both = withSprite(SOLID);
    both.bus.writeByte(0xd01d, 0x01);
    both.bus.writeByte(0xd017, 0x01);
    expect(count(composeScreen(both.bus, both.cpu.memory), 7)).toBe(48 * 42);
  });

  it("reads bit pairs in multicolour, two pixels to a pair", () => {
    // %01010101 is four pairs of 01, so the whole row is multicolour 0.
    const machine = withSprite(Array.from({ length: 63 }, () => 0x55));
    machine.bus.writeByte(0xd01c, 0x01); // multicolour
    machine.bus.writeByte(0xd025, 4); // pair 01
    machine.bus.writeByte(0xd026, 5); // pair 11

    const frame = composeScreen(machine.bus, machine.cpu.memory);
    expect(count(frame, 4)).toBe(24 * 21);
    expect(count(frame, 5)).toBe(0);
    // The sprite's own colour is what a 10 pair would use, and there are none.
    expect(count(frame, 7)).toBe(0);
  });

  it("goes behind the characters when $D01B says so", () => {
    const machine = withSprite(SOLID);
    // Glyph 1 has every pixel lit; glyph 0 stays blank, because every other
    // cell on the screen holds it and a solid glyph 0 would make the whole
    // screen foreground.
    for (let row = 0; row < 8; row++) machine.cpu.memory[0x1000 + 8 + row] = 0xff;
    machine.cpu.memory[0x0400 + 1 * 40 + 1] = 1; // row 1, column 1
    machine.cpu.memory[0xd800 + 1 * 40 + 1] = 1;

    const front = composeScreen(machine.bus, machine.cpu.memory);
    machine.bus.writeByte(0xd01b, 0x01);
    const behind = composeScreen(machine.bus, machine.cpu.memory);

    // Sixty-four pixels of the sprite are covered by that one character cell.
    expect(count(front, 7) - count(behind, 7)).toBe(64);
  });

  it("is clipped rather than wrapped at the edges", () => {
    const machine = withSprite(SOLID);
    machine.bus.writeByte(0xd000, 8); // left of the display entirely
    const frame = composeScreen(machine.bus, machine.cpu.memory);

    // Sixteen of the twenty-four columns are off the left edge.
    expect(count(frame, 7)).toBe(8 * 21);
    // And nothing has appeared on the right-hand side.
    expect(frame.pixels[8 * WIDTH + (WIDTH - 1)]).not.toBe(7);
  });
});
