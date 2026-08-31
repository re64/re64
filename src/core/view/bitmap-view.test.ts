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
