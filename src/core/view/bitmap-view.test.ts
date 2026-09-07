import { describe, it, expect } from "vitest";
import { bitmapToText, cellCount, decodeBitmap } from "./bitmap-view.js";

/** The picture as a grid of bit values, which is what the assertions are about. */
const grid = (bytes: number[], options = {}) => {
  const bm = decodeBitmap(bytes, options);
  const rows: string[] = [];
  for (let y = 0; y < bm.height; y++) {
    let row = "";
    for (let x = 0; x < bm.width; x++) row += bm.pixels[y * bm.width + x] === 0 ? "." : "#";
    rows.push(row);
  }
  return rows;
};

describe("reading bytes as bits", () => {
  it("puts the high bit on the left, the way the VIC shifts them out", () => {
    expect(grid([0b10000001])).toEqual(["#......#"]);
  });

  it("lays out one byte per row by default", () => {
    expect(grid([0xff, 0x00, 0xff])).toEqual(["########", "........", "########"]);
  });

  it("takes a stride, which is the whole point of exploring", () => {
    // Sliding this until an image appears is how anyone finds graphics in a
    // dump. Three bytes is a sprite's width.
    expect(grid([0xff, 0x00, 0xff, 0x00, 0xff, 0x00], { stride: 3 })).toEqual([
      "########........########",
      "........########........",
    ]);
  });

  it("pads a short final row rather than dropping it", () => {
    expect(grid([0xff], { stride: 2 })).toEqual(["########........"]);
  });
});

describe("reading bytes as characters", () => {
  it("is eight by eight", () => {
    const bm = decodeBitmap(new Array(8).fill(0xff), { format: "char" });
    expect([bm.width, bm.height]).toEqual([8, 8]);
  });

  it("lays glyphs out in columns", () => {
    // Two glyphs, one solid and one empty, side by side.
    const bytes = [...new Array(8).fill(0xff), ...new Array(8).fill(0x00)];
    expect(grid(bytes, { format: "char", columns: 2 })[0]).toBe("########........");
  });

  it("wraps to a second row when there are more glyphs than columns", () => {
    const bytes = new Array(8 * 3).fill(0xff);
    const bm = decodeBitmap(bytes, { format: "char", columns: 2 });
    expect([bm.width, bm.height]).toEqual([16, 16]);
  });

  it("counts whole cells only", () => {
    expect(cellCount("char", 20)).toBe(2);
    expect(cellCount("sprite", 63)).toBe(1);
    expect(cellCount("sprite", 62)).toBe(0);
  });
});

describe("reading bytes as sprites", () => {
  it("is twenty-four by twenty-one", () => {
    const bm = decodeBitmap(new Array(63).fill(0xff), { format: "sprite" });
    expect([bm.width, bm.height]).toEqual([24, 21]);
  });

  it("halves the width in multicolour, because a pixel is two bits", () => {
    const bm = decodeBitmap(new Array(63).fill(0xff), { format: "sprite-multi" });
    expect([bm.width, bm.height]).toEqual([12, 21]);
  });

  it("reads multicolour pairs from the high bits down", () => {
    // 0b00_01_10_11 is four pixels of increasing bit pattern.
    const bm = decodeBitmap([0b00011011, 0, 0], { format: "sprite-multi" });
    // Distinct patterns give distinct palette entries; only the last is background.
    const first = [0, 1, 2, 3].map((x) => bm.pixels[x]);
    expect(new Set(first).size).toBe(4);
  });
});

describe("looking at the edge of memory", () => {
  it("reads a byte that is not there as zero rather than failing", () => {
    // An explorer pointed past the end of a layer should show the edge, not an
    // error. `readBytes` hands back undefined for an unmapped address.
    expect(grid([0xff, undefined as unknown as number])).toEqual([
      "########",
      "........",
    ]);
  });
});

describe("as text, for a terminal", () => {
  it("shades by brightness, so it reads as a picture", () => {
    const text = bitmapToText(decodeBitmap([0b11000000]), { pixelWidth: 1 });
    // White foreground is the lightest shade, black background the emptiest.
    expect(text).toBe("@@      ");
  });

  it("doubles pixels sideways by default, because a terminal cell is tall", () => {
    // Drawn one-for-one a sprite comes out squashed to half its height, which
    // is exactly the shape that makes a glyph unreadable.
    expect(bitmapToText(decodeBitmap([0b10000000]))).toBe("@@" + " ".repeat(14));
  });

  it("draws one line per pixel row", () => {
    expect(bitmapToText(decodeBitmap([0xff, 0xff, 0xff])).split("\n")).toHaveLength(3);
  });
});

describe("a bank of sprites", () => {
  /**
   * The VIC addresses sprite data in 64-byte blocks, not 63, so a contact sheet
   * of consecutive sprites has to step by the pitch. Stepping by the 63 bytes a
   * sprite *uses* slips one byte per cell and the sheet is unreadable by the
   * third picture — which is the bug that would have made re64's own renderer
   * useless for the job experiment 9's editor did by hand.
   */
  const bank = (count: number): number[] => {
    const bytes = new Array(count * 64).fill(0);
    // Each sprite is solid with its own index in the padding byte, so a
    // misaligned read shows up as the padding leaking into the picture.
    for (let sprite = 0; sprite < count; sprite++) {
      for (let i = 0; i < 63; i++) bytes[sprite * 64 + i] = 0xff;
      bytes[sprite * 64 + 63] = 0x00;
    }
    return bytes;
  };

  it("counts one sprite per 64 bytes, and one for a bare 63", () => {
    expect(cellCount("sprite", 63)).toBe(1);
    expect(cellCount("sprite", 64)).toBe(1);
    expect(cellCount("sprite", 127)).toBe(2);
    expect(cellCount("sprite", 128)).toBe(2);
    expect(cellCount("sprite", 62)).toBe(0);
  });

  it("draws every sprite in a bank solid, rather than drifting", () => {
    const sheet = decodeBitmap(bank(4), { format: "sprite", columns: 4 });
    expect(sheet.width).toBe(4 * 24);
    expect(sheet.height).toBe(21);
    // Every pixel is set. Stepping by 63 would put the padding byte inside the
    // later sprites and leave gaps.
    const lit = [...sheet.pixels].filter((p) => p === 1).length;
    expect(lit).toBe(4 * 24 * 21);
  });
});
