/**
 * `Bitmap` to PNG, and a sequence of them to an animated PNG.
 *
 * **An encoder at the edge, not another decoder.** The rule that a decoder
 * returns *data* and never a picture is what lets one decoder serve the browser,
 * a terminal and an agent alike, and it stands. What was missing is the last
 * step for the one consumer that cannot draw: `Bitmap` is palette indices, and
 * an agent has no canvas to put them on. So this sits beside base64 in
 * `read_bytes` and beside `putBlob` for a capture — a serialiser, not a way of
 * reading bytes.
 *
 * The measurement behind it: every reader in experiment 2, all three in
 * experiment 7 and the editor in experiment 9 wrote their own bitmap printer.
 * Four independent implementations of one missing function.
 *
 * **No dependency, and no compression.** DEFLATE's stored block is a legal
 * DEFLATE stream, so a PNG written this way is an ordinary PNG that every
 * decoder reads — it is simply larger. On a sixteen-colour indexed image that
 * costs about 0.03%, which is not worth a compressor in `src/core/`, where the
 * rule is minimal dependencies and no Node APIs.
 */

import { Bitmap } from "./bitmap-view.js";

/** PNG's own signature, which is also how a reader detects a truncated file. */
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const be32 = (value: number): number[] => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];

/** One chunk: length, type, data, and the CRC over type and data together. */
function chunk(type: string, data: Uint8Array): number[] {
  const typed = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) typed[i] = type.charCodeAt(i);
  typed.set(data, 4);
  return [...be32(data.length), ...typed, ...be32(crc32(typed))];
}

/**
 * A zlib stream of stored DEFLATE blocks.
 *
 * `78 01` is the zlib header a decoder expects; each block carries its length
 * and that length's ones complement, which is what makes an uncompressed block
 * self-checking and is easy to get backwards.
 */
function zlib(raw: Uint8Array): Uint8Array {
  const out: number[] = [0x78, 0x01];
  const MAX = 0xffff;
  for (let at = 0; at < raw.length || at === 0; at += MAX) {
    const size = Math.min(MAX, raw.length - at);
    const last = at + size >= raw.length ? 1 : 0;
    out.push(last, size & 0xff, (size >> 8) & 0xff, ~size & 0xff, (~size >> 8) & 0xff);
    for (let i = 0; i < size; i++) out.push(raw[at + i]);
    if (last) break;
  }
  out.push(...be32(adler32(raw)));
  return new Uint8Array(out);
}

/** The palette, as PNG wants it: three bytes an entry, and at most 256. */
function plte(palette: readonly string[]): Uint8Array {
  const entries = palette.slice(0, 256);
  const bytes = new Uint8Array(entries.length * 3);
  entries.forEach((colour, index) => {
    const hex = colour.replace("#", "");
    bytes[index * 3] = parseInt(hex.slice(0, 2), 16) || 0;
    bytes[index * 3 + 1] = parseInt(hex.slice(2, 4), 16) || 0;
    bytes[index * 3 + 2] = parseInt(hex.slice(4, 6), 16) || 0;
  });
  return bytes;
}

/**
 * Scanlines, each preceded by its filter byte.
 *
 * Filter 0 — none — for every row: filtering exists to make the compressor's
 * job easier, and there is no compressor here.
 */
function scanlines(bitmap: Bitmap): Uint8Array {
  const raw = new Uint8Array((bitmap.width + 1) * bitmap.height);
  for (let y = 0; y < bitmap.height; y++) {
    const at = y * (bitmap.width + 1);
    raw[at] = 0;
    raw.set(bitmap.pixels.subarray(y * bitmap.width, (y + 1) * bitmap.width), at + 1);
  }
  return raw;
}

function ihdr(width: number, height: number): Uint8Array {
  // Bit depth 8, colour type 3 (palette), no compression method but deflate, no
  // filtering beyond per-scanline, not interlaced.
  return new Uint8Array([...be32(width), ...be32(height), 8, 3, 0, 0, 0]);
}

/** One `Bitmap`, as a PNG file. */
export function encodePng(bitmap: Bitmap): Uint8Array {
  const bytes = [
    ...SIGNATURE,
    ...chunk("IHDR", ihdr(bitmap.width, bitmap.height)),
    ...chunk("PLTE", plte(bitmap.palette)),
    ...chunk("IDAT", zlib(scanlines(bitmap))),
    ...chunk("IEND", new Uint8Array(0)),
  ];
  return new Uint8Array(bytes);
}

/**
 * Several `Bitmap`s, as one animated PNG.
 *
 * Chosen over GIF for two reasons that are both about not writing more code
 * than the job needs: the chunk machinery above is already what APNG is made
 * of, where GIF would mean implementing LZW; and APNG has no 256-colour ceiling,
 * which is irrelevant for this machine's sixteen and not for a decoder somebody
 * writes later.
 *
 * The first frame is the still image as well as frame one, so a reader that
 * knows nothing about APNG shows it rather than nothing.
 */
export function encodeApng(frames: readonly Bitmap[], delayMs: number): Uint8Array {
  if (frames.length === 0) throw new Error("an animation needs at least one frame");
  if (frames.length === 1) return encodePng(frames[0]);

  const { width, height, palette } = frames[0];
  const bytes: number[] = [
    ...SIGNATURE,
    ...chunk("IHDR", ihdr(width, height)),
    // `acTL` must precede the first `IDAT`, and says how many frames and how
    // many times round — zero plays meaning for ever.
    ...chunk("acTL", new Uint8Array([...be32(frames.length), ...be32(0)])),
    ...chunk("PLTE", plte(palette)),
  ];

  // Delays are a rational number of seconds, not milliseconds, so that a frame
  // rate the hardware actually has can be expressed exactly: this machine draws
  // fifty a second, and 1/50 is not 20ms by accident.
  const numerator = Math.max(1, Math.round(delayMs));
  let sequence = 0;

  frames.forEach((frame, index) => {
    if (frame.width !== width || frame.height !== height) {
      throw new Error("every frame of an animation must be the same size");
    }
    bytes.push(
      ...chunk(
        "fcTL",
        new Uint8Array([
          ...be32(sequence++),
          ...be32(width),
          ...be32(height),
          ...be32(0),
          ...be32(0),
          (numerator >> 8) & 0xff,
          numerator & 0xff,
          0x03,
          0xe8, // denominator 1000, so the numerator is milliseconds
          0, // dispose: leave this frame in place
          0, // blend: replace rather than composite
        ])
      )
    );
    const data = zlib(scanlines(frame));
    // Frame one is the IDAT — the still image — and the rest are fdAT, which is
    // the same payload behind a sequence number.
    if (index === 0) bytes.push(...chunk("IDAT", data));
    else bytes.push(...chunk("fdAT", new Uint8Array([...be32(sequence++), ...data])));
  });

  bytes.push(...chunk("IEND", new Uint8Array(0)));
  return new Uint8Array(bytes);
}
