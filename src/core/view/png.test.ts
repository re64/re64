import { describe, it, expect } from "vitest";
import { inflateSync } from "node:zlib";
import { encodePng, encodeApng } from "./png.js";
import { Bitmap } from "./bitmap-view.js";

/**
 * The encoder, checked by taking the file apart again.
 *
 * `node:zlib` is the point of this test rather than an awkwardness: it is an
 * implementation nobody here wrote, so a stream it inflates is a stream every
 * other decoder will too. Asserting the bytes we meant to write would only
 * prove the function is the function.
 */

const bitmap = (width: number, height: number, fill: (x: number, y: number) => number): Bitmap => {
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels[y * width + x] = fill(x, y);
  return { width, height, pixels, palette: ["#000000", "#ffffff", "#ff0000"] };
};

/** Walk the chunks, checking every CRC on the way past. */
function chunks(png: Uint8Array): { type: string; data: Uint8Array }[] {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: { type: string; data: Uint8Array }[] = [];
  let at = 8;
  while (at < png.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    out.push({ type, data: png.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  return out;
}

const find = (png: Uint8Array, type: string) => chunks(png).find((c) => c.type === type)!;

describe("PNG", () => {
  it("inflates back to the pixels it was given", () => {
    const source = bitmap(7, 3, (x, y) => (x + y) % 3);
    const png = encodePng(source);

    const raw = new Uint8Array(inflateSync(Buffer.from(find(png, "IDAT").data)));
    // Each scanline is a filter byte then the row, so the length is exact.
    expect(raw.length).toBe((7 + 1) * 3);
    for (let y = 0; y < 3; y++) {
      expect(raw[y * 8]).toBe(0); // filter: none
      expect([...raw.subarray(y * 8 + 1, y * 8 + 8)]).toEqual(
        [...source.pixels.subarray(y * 7, y * 7 + 7)]
      );
    }
  });

  it("declares an eight-bit palette image of the right size", () => {
    const png = encodePng(bitmap(320, 200, () => 1));
    const header = find(png, "IHDR").data;
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    expect(view.getUint32(0)).toBe(320);
    expect(view.getUint32(4)).toBe(200);
    expect(header[8]).toBe(8); // bit depth
    expect(header[9]).toBe(3); // colour type: palette
  });

  it("writes the palette as three bytes an entry", () => {
    const png = encodePng(bitmap(1, 1, () => 0));
    expect([...find(png, "PLTE").data]).toEqual([0, 0, 0, 255, 255, 255, 255, 0, 0]);
  });

  it("ends where it says it does", () => {
    const all = chunks(encodePng(bitmap(4, 4, () => 0)));
    expect(all.map((c) => c.type)).toEqual(["IHDR", "PLTE", "IDAT", "IEND"]);
  });

  it("survives an image bigger than one stored block", () => {
    // A stored DEFLATE block holds 65535 bytes, and a full screen is more than
    // that — so the multi-block path is the ordinary case here, not an edge.
    const source = bitmap(320, 300, (x, y) => (x ^ y) % 3);
    const raw = new Uint8Array(inflateSync(Buffer.from(find(encodePng(source), "IDAT").data)));
    expect(raw.length).toBe(321 * 300);
    expect(raw.length).toBeGreaterThan(0xffff);
    expect([...raw.subarray(1, 6)]).toEqual([...source.pixels.subarray(0, 5)]);
  });
});

describe("animated PNG", () => {
  const frames = [bitmap(4, 2, () => 0), bitmap(4, 2, () => 1), bitmap(4, 2, () => 2)];

  it("declares its frame count before the first image", () => {
    const png = encodeApng(frames, 20);
    const types = chunks(png).map((c) => c.type);
    expect(types.indexOf("acTL")).toBeLessThan(types.indexOf("IDAT"));

    const actl = find(png, "acTL").data;
    const view = new DataView(actl.buffer, actl.byteOffset, actl.byteLength);
    expect(view.getUint32(0)).toBe(3);
    expect(view.getUint32(4)).toBe(0); // loop for ever
  });

  it("puts the first frame in IDAT, so a still viewer shows something", () => {
    const types = chunks(encodeApng(frames, 20)).map((c) => c.type);
    expect(types.filter((t) => t === "IDAT")).toHaveLength(1);
    expect(types.filter((t) => t === "fdAT")).toHaveLength(2);
    expect(types.filter((t) => t === "fcTL")).toHaveLength(3);
  });

  it("expresses the delay as a fraction of a second", () => {
    const fctl = find(encodeApng(frames, 20), "fcTL").data;
    // 20/1000 of a second, which is one PAL frame exactly.
    expect((fctl[20] << 8) | fctl[21]).toBe(20);
    expect((fctl[22] << 8) | fctl[23]).toBe(1000);
  });

  it("is an ordinary PNG when there is only one frame", () => {
    const types = chunks(encodeApng([frames[0]], 20)).map((c) => c.type);
    expect(types).toEqual(["IHDR", "PLTE", "IDAT", "IEND"]);
  });

  it("refuses frames that are not all the same size", () => {
    expect(() => encodeApng([bitmap(4, 2, () => 0), bitmap(5, 2, () => 0)], 20)).toThrow(/same size/);
    expect(() => encodeApng([], 20)).toThrow(/at least one frame/);
  });
});
