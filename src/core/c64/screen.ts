/**
 * What the screen looks like, as a `Bitmap`.
 *
 * **No new contract.** `Decoded` already carries `{kind: "frames", delayMs,
 * frames: Bitmap[]}`, already validated by `validateDecoded`, already DOM-free,
 * already drawn by every consumer — it was added for animated decoder output and
 * happens to be exactly the shape a captured screen wants. So this is one
 * function into an existing type rather than a new kind of thing, and a captured
 * frame renders wherever a decoded one does.
 *
 * Character mode plus sprites. Bitmap mode is the next honest step; a program
 * using it gets a frame that is right about the sprites and silent about the
 * rest, which is stated rather than discovered.
 */

import { Bitmap } from "../view/bitmap-view.js";
import { C64Bus, PALETTE } from "./devices/index.js";
import { Sprite } from "./devices/vic.js";

/** Forty by twenty-five characters of eight by eight pixels. */
export const COLUMNS = 40;
export const ROWS = 25;
export const CELL = 8;
export const WIDTH = COLUMNS * CELL;
export const HEIGHT = ROWS * CELL;

/** A sprite is twenty-four by twenty-one, three bytes to a row, 63 bytes used of 64. */
const SPRITE_BITS = 24;
const SPRITE_ROWS = 21;
const SPRITE_BYTES = 64;

/**
 * Where the display sits in the chip's own coordinates.
 *
 * A sprite may be positioned in the border, so the counter starts outside the
 * visible 320x200 — the first displayed pixel is (24, 50). Getting this wrong
 * puts everything a few characters off and looks like a game bug rather than a
 * rendering one.
 */
const ORIGIN_X = 24;
const ORIGIN_Y = 50;

/**
 * Where the character generator really is.
 *
 * The VIC sees character ROM at `$1000` and `$9000` of its bank whatever RAM is
 * there, which is how a program gets the built-in font without copying it — and
 * it is why a game that wants its *own* font puts it somewhere else. A frame
 * composed without this rule shows garbage for every program that never copied a
 * font, which is most of them.
 */
function characterBytes(
  bank: number,
  characterBase: number,
  memory: Uint8Array,
  characterRom?: Uint8Array
): (glyph: number, row: number) => number {
  const shadowed = characterBase === 0x1000 || characterBase === 0x1800;
  if (shadowed && characterRom) {
    const offset = characterBase - 0x1000;
    return (glyph, row) => characterRom[(offset + glyph * 8 + row) & (characterRom.length - 1)];
  }
  const base = bank + characterBase;
  return (glyph, row) => memory[(base + glyph * 8 + row) & 0xffff];
}

/**
 * Compose one frame from the machine as it stands.
 *
 * Everything comes out of the machine's own bytes: screen RAM and the character
 * generator through the VIC's bank, colour RAM straight from memory because that
 * is what colour RAM is. Nothing here is special-cased, which is the payoff for
 * the bus leaving `$D800-$DBFF` alone.
 */
export function composeScreen(
  bus: C64Bus,
  memory: Uint8Array,
  characterRom?: Uint8Array
): Bitmap {
  const bank = bus.cia2.vicBank;
  const screen = bank + bus.vic.screenBase;
  const glyphAt = characterBytes(bank, bus.vic.characterBase, memory, characterRom);
  const background = bus.vic.backgroundColour;

  const pixels = new Uint8Array(WIDTH * HEIGHT);
  // Which pixels the characters lit, so a sprite declared "behind" can be
  // covered by them. It is a property of the character layer rather than of the
  // colour, since a foreground pixel in the background colour still occludes.
  const foreground = new Uint8Array(WIDTH * HEIGHT);

  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      const cell = row * COLUMNS + column;
      const glyph = memory[(screen + cell) & 0xffff];
      // Colour RAM is four bits wide; the top nibble reads as whatever was last
      // on the bus, so masking is not tidiness — it is the difference between a
      // colour and a number between 0 and 255.
      const ink = memory[(0xd800 + cell) & 0xffff] & 0x0f;

      for (let line = 0; line < CELL; line++) {
        const bits = glyphAt(glyph, line);
        const at = (row * CELL + line) * WIDTH + column * CELL;
        for (let bit = 0; bit < CELL; bit++) {
          const lit = bits & (0x80 >> bit);
          pixels[at + bit] = lit ? ink : background;
          foreground[at + bit] = lit ? 1 : 0;
        }
      }
    }
  }

  // Sprite 0 is in front of sprite 1, and so on down — so the highest number is
  // drawn first and the lowest last, which lets a plain overwrite express the
  // priority without comparing anything.
  const multi = bus.vic.spriteMulticolour;
  for (const sprite of [...bus.vic.sprites].reverse()) {
    if (!sprite.enabled) continue;
    drawSprite(pixels, foreground, memory, bank, screen, sprite, multi);
  }

  return { width: WIDTH, height: HEIGHT, pixels, palette: PALETTE };
}

/**
 * Draw one sprite over the character layer.
 *
 * The expansion bits are the reason this exists rather than a reconstruction
 * from the game's own object table: `$D01D` and `$D017` double a sprite's width
 * and height, and a picture drawn without them is *almost* right — which is
 * worse than one that is visibly wrong, because nobody checks it.
 */
function drawSprite(
  pixels: Uint8Array,
  foreground: Uint8Array,
  memory: Uint8Array,
  bank: number,
  screen: number,
  sprite: Sprite,
  multi: readonly [number, number]
): void {
  // The pointer lives in the last eight bytes of screen memory, and indexes
  // 64-byte blocks from the base of the VIC's own bank — not from anywhere the
  // CPU thinks it is.
  const pointer = memory[(screen + 0x3f8 + sprite.index) & 0xffff];
  const data = bank + pointer * SPRITE_BYTES;

  const scaleX = sprite.expandX ? 2 : 1;
  const scaleY = sprite.expandY ? 2 : 1;
  // A multicolour sprite trades half its horizontal resolution for a third
  // colour: bits go in pairs and each pair is two pixels wide.
  const step = sprite.multicolour ? 2 : 1;

  const left = sprite.x - ORIGIN_X;
  const top = sprite.y - ORIGIN_Y;

  for (let row = 0; row < SPRITE_ROWS; row++) {
    for (let bit = 0; bit < SPRITE_BITS; bit += step) {
      const byte = memory[(data + row * 3 + (bit >> 3)) & 0xffff];

      let colour: number;
      if (sprite.multicolour) {
        const pair = (byte >> (6 - (bit & 7))) & 0x03;
        if (pair === 0) continue;
        colour = pair === 1 ? multi[0] : pair === 2 ? sprite.colour : multi[1];
      } else {
        if (!(byte & (0x80 >> (bit & 7)))) continue;
        colour = sprite.colour;
      }

      const x0 = left + bit * scaleX;
      const y0 = top + row * scaleY;
      for (let dy = 0; dy < scaleY; dy++) {
        const y = y0 + dy;
        if (y < 0 || y >= HEIGHT) continue;
        for (let dx = 0; dx < step * scaleX; dx++) {
          const x = x0 + dx;
          if (x < 0 || x >= WIDTH) continue;
          const at = y * WIDTH + x;
          // "Behind" is behind the *characters*, not behind the background —
          // which is why the mask is needed and the colour cannot stand in for
          // it.
          if (sprite.behind && foreground[at]) continue;
          pixels[at] = colour;
        }
      }
    }
  }
}

/** PAL, so fifty frames a second — near enough for anything that watches one. */
export const FRAME_MS = 20;
