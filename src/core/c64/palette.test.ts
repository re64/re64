import { describe, it, expect } from "vitest";
import { C64_PALETTE } from "./palette.js";
import { PALETTE } from "./devices/vic.js";
import { C64_PALETTE as fromView } from "../view/bitmap-view.js";

/**
 * One palette, asserted to be one.
 *
 * There were two definitions with different values — Pepto in `view/` and
 * Colodore in `vic.ts` — so a captured screenshot and a sprite plate of the
 * same program were drawn in different colours. Nothing failed; they simply
 * disagreed, which is the shape that survives a green suite indefinitely and
 * is only visible when somebody puts both pictures on one page.
 */
describe("the C64 palette", () => {
  it("is the same object wherever it is reached from", () => {
    expect(PALETTE).toBe(C64_PALETTE);
    expect(fromView).toBe(C64_PALETTE);
  });

  it("has sixteen colours, each a six-digit hex", () => {
    expect(C64_PALETTE).toHaveLength(16);
    for (const colour of C64_PALETTE) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("starts at black and ends at light grey, which is the chip's own order", () => {
    // The order is the index a program writes to a colour register, so it is
    // not a presentation choice: colour 0 is what $D021 = 0 shows.
    expect(C64_PALETTE[0]).toBe("#000000");
    expect(C64_PALETTE[1]).toBe("#ffffff");
    expect(C64_PALETTE[15]).toBe("#b2b2b2");
  });
});
