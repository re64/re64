import { describe, it, expect } from "vitest";
import { composeScreen, COLUMNS, WIDTH, HEIGHT } from "./screen.js";
import { C64Bus } from "./devices/index.js";
import { validateDecoded } from "../view/bitmap-view.js";

/**
 * A frame, out of the machine's own bytes.
 *
 * Nothing here is a new contract: the result is a `Bitmap`, which is what a
 * decoder already returns and what every consumer already draws.
 */

/** A machine with one glyph in the character generator and a screen to put it on. */
function machine(): { bus: C64Bus; memory: Uint8Array } {
  const bus = new C64Bus();
  const memory = new Uint8Array(0x10000);
  // A solid 8x8 block as glyph 1, at the default character base of $1000 —
  // moved to $2000 so it is RAM the VIC reads rather than the shadowed ROM.
  bus.writeByte(0xd018, 0x18); // screen $0400, characters $2000
  for (let row = 0; row < 8; row++) memory[0x2000 + 8 + row] = 0xff;
  return { bus, memory };
}

describe("composing a frame", () => {
  it("returns something every consumer already knows how to draw", () => {
    const { bus, memory } = machine();
    const checked = validateDecoded({ kind: "bitmap", ...composeScreen(bus, memory) });
    expect(checked.ok).toBe(true);
  });

  it("is forty by twenty-five characters of eight by eight", () => {
    const { bus, memory } = machine();
    const frame = composeScreen(bus, memory);
    expect(frame.width).toBe(WIDTH);
    expect(frame.height).toBe(HEIGHT);
    expect(frame.pixels.length).toBe(WIDTH * HEIGHT);
  });

  it("draws a glyph in its cell's colour", () => {
    const { bus, memory } = machine();
    memory[0x0400] = 0x01; // the solid block, top left
    memory[0xd800] = 0x0e; // light blue
    bus.writeByte(0xd021, 0x06); // blue background

    const frame = composeScreen(bus, memory);
    expect(frame.pixels[0]).toBe(0x0e);
    expect(frame.pixels[7]).toBe(0x0e);
    // Just past the cell is background, because nothing was written there.
    expect(frame.pixels[8]).toBe(0x06);
  });

  it("masks colour RAM to four bits, which is how wide it is", () => {
    // The top nibble reads as whatever was last on the bus. Unmasked, a colour
    // becomes a number between 0 and 255 and indexes off the end of a palette.
    const { bus, memory } = machine();
    memory[0x0400] = 0x01;
    memory[0xd800] = 0xfe;

    const frame = composeScreen(bus, memory);
    expect(frame.pixels[0]).toBe(0x0e);
  });

  it("follows the screen pointer, so a game that moves its screen is not blank", () => {
    const { bus, memory } = machine();
    bus.writeByte(0xd018, 0x58); // screen $1400, characters $2000
    memory[0x1400] = 0x01;
    memory[0xd800] = 0x01;

    expect(composeScreen(bus, memory).pixels[0]).toBe(0x01);
  });

  it("follows the VIC bank, which is on the other chip entirely", () => {
    // $DD00 decides which 16K the VIC sees, and it is inverted. A frame
    // composed without it is right about everything except where to look.
    const { bus, memory } = machine();
    bus.writeByte(0xdd00, 0x02); // bank 1: $4000
    memory[0x4400] = 0x01;
    memory[0xd800] = 0x03;
    for (let row = 0; row < 8; row++) memory[0x6000 + 8 + row] = 0xff;

    expect(composeScreen(bus, memory).pixels[0]).toBe(0x03);
  });

  it("reads the character ROM where the VIC shadows it", () => {
    // The VIC sees character ROM at $1000 of its bank whatever RAM is there,
    // which is how a program gets the built-in font without copying it. A frame
    // composed without this rule shows garbage for every program that never
    // copied one — which is most of them.
    const { bus, memory } = machine();
    bus.writeByte(0xd018, 0x14); // screen $0400, characters $1000
    memory[0x0400] = 0x01;
    memory[0xd800] = 0x01;
    // RAM under the shadow says one thing...
    for (let row = 0; row < 8; row++) memory[0x1000 + 8 + row] = 0x00;
    // ...and the ROM says another. The ROM wins.
    const rom = new Uint8Array(0x1000);
    for (let row = 0; row < 8; row++) rom[8 + row] = 0xff;

    expect(composeScreen(bus, memory, rom).pixels[0]).toBe(0x01);
    // Without a ROM to consult it falls back to RAM rather than refusing.
    expect(composeScreen(bus, memory).pixels[0]).toBe(bus.vic.backgroundColour);
  });

  it("puts the second character beside the first", () => {
    const { bus, memory } = machine();
    memory[0x0401] = 0x01;
    memory[0xd801] = 0x05;

    const frame = composeScreen(bus, memory);
    expect(frame.pixels[8]).toBe(0x05);
    expect(frame.pixels[COLUMNS * 8]).toBe(bus.vic.backgroundColour);
  });
});
