/**
 * Bytes as pictures.
 *
 * A C64 program's data is mostly images — character sets, sprites, screens —
 * and a hex column is the worst possible way to look at one. Every reader in
 * experiment 2 ended up scraping the hex out of a listing and writing their own
 * bitmap printer, which is the clearest statement available that this belongs
 * in the tool.
 *
 * DOM-free on purpose, like `map-view.ts`. A decoder returns **pixels**, not
 * pictures: the browser paints them to a canvas, the CLI paints them with
 * shading characters, and a tool can report their size. One decoder, four
 * consumers, and nothing here can touch a screen — which is also the contract a
 * user-supplied decoder will have to satisfy, so it is worth getting right
 * while the only implementations are ours.
 */

/**
 * The C64's sixteen colours.
 *
 * Pepto's measurements, which is what VICE and every modern emulator use. The
 * machine has no palette register — these are fixed in the VIC-II — so this is
 * a constant rather than something a project configures.
 */
export const C64_PALETTE: readonly string[] = [
  "#000000", // 0  black
  "#ffffff", // 1  white
  "#68372b", // 2  red
  "#70a4b2", // 3  cyan
  "#6f3d86", // 4  purple
  "#588d43", // 5  green
  "#352879", // 6  blue
  "#b8c76f", // 7  yellow
  "#6f4f25", // 8  orange
  "#433900", // 9  brown
  "#9a6759", // 10 light red
  "#444444", // 11 dark grey
  "#6c6c6c", // 12 grey
  "#9ad284", // 13 light green
  "#6c5eb5", // 14 light blue
  "#959595", // 15 light grey
];

/**
 * A decoded picture: one palette index per pixel, row-major.
 *
 * Indices rather than colours because that is what the hardware stores, and it
 * keeps recolouring — which on this machine is a separate byte somewhere else —
 * a question about presentation rather than a re-decode.
 */
export interface Bitmap {
  readonly width: number;
  readonly height: number;
  /** `width * height` palette indices. */
  readonly pixels: Uint8Array;
  readonly palette: readonly string[];
}

/**
 * How to read the bytes.
 *
 * `bits` is the one that matters for exploring: a plain 1-bit-per-pixel run at
 * whatever byte width you choose. Sliding that width until an image snaps into
 * focus is how anyone has ever found graphics in a memory dump, and it is
 * deliberately the default.
 *
 * The others are the C64's actual layouts, worth having because guessing the
 * stride for a sprite every time is tedious when the hardware only allows one.
 */
export type BitmapFormat = "bits" | "char" | "sprite" | "sprite-multi";

export interface BitmapOptions {
  format?: BitmapFormat;
  /**
   * Bytes per row for `bits`. Each byte is eight pixels, so a stride of 1 is a
   * character column and 3 is a sprite's width.
   */
  stride?: number;
  /** How many cells sit side by side for `char` and the sprite formats. */
  columns?: number;
  /** Palette indices to use, low bit-pattern first. Defaults to black on white. */
  colours?: readonly number[];
}

/**
 * Default colours, by bit pattern.
 *
 * Black, white, grey, dark grey — chosen for *contrast*, not for authenticity.
 * The machine's own default is light blue on blue, which is what a C64 looks
 * like and is nearly illegible both as terminal shading and as a thumbnail. The
 * real colours live in screen and colour RAM somewhere else entirely, so any
 * choice here is a viewing default rather than a claim about the program.
 */
const DEFAULT_COLOURS = [0, 1, 12, 11];

const cellSize = (format: BitmapFormat): { width: number; height: number; bytes: number } => {
  switch (format) {
    case "char":
      return { width: 8, height: 8, bytes: 8 };
    case "sprite":
      return { width: 24, height: 21, bytes: 63 };
    case "sprite-multi":
      // Half the horizontal resolution, because each pixel is two bits and two
      // pixels wide on screen. The bytes are the same 63.
      return { width: 12, height: 21, bytes: 63 };
    case "bits":
      return { width: 8, height: 1, bytes: 1 };
  }
};

/** Number of cells a run of bytes contains, in the given format. */
export function cellCount(format: BitmapFormat, byteCount: number): number {
  return Math.floor(byteCount / cellSize(format).bytes);
}

/**
 * Decode a run of bytes into a picture.
 *
 * Bytes that are not there — a span running off the end of the loaded map —
 * read as zero rather than throwing, because an explorer pointed at the edge of
 * memory should show you the edge, not an error.
 */
export function decodeBitmap(
  bytes: readonly (number | undefined)[],
  options: BitmapOptions = {}
): Bitmap {
  const format = options.format ?? "bits";
  const colours = options.colours ?? DEFAULT_COLOURS;
  const at = (index: number): number => bytes[index] ?? 0;

  if (format === "bits") {
    const stride = Math.max(1, Math.floor(options.stride ?? 1));
    const width = stride * 8;
    const height = Math.max(1, Math.ceil(bytes.length / stride));
    const pixels = new Uint8Array(width * height);

    for (let index = 0; index < stride * height; index++) {
      const byte = at(index);
      const x = (index % stride) * 8;
      const y = Math.floor(index / stride);
      for (let bit = 0; bit < 8; bit++) {
        // Most significant bit leftmost, which is how the VIC-II shifts them out.
        const on = (byte >> (7 - bit)) & 1;
        pixels[y * width + x + bit] = colours[on] ?? on;
      }
    }
    return { width, height, pixels, palette: C64_PALETTE };
  }

  const cell = cellSize(format);
  const total = Math.max(1, cellCount(format, bytes.length));
  const columns = Math.max(1, Math.min(options.columns ?? total, total));
  const rows = Math.ceil(total / columns);

  const width = columns * cell.width;
  const height = rows * cell.height;
  const pixels = new Uint8Array(width * height);

  for (let index = 0; index < total; index++) {
    const originX = (index % columns) * cell.width;
    const originY = Math.floor(index / columns) * cell.height;
    const base = index * cell.bytes;
    const bytesPerRow = format === "char" ? 1 : 3;

    for (let y = 0; y < cell.height; y++) {
      for (let b = 0; b < bytesPerRow; b++) {
        const byte = at(base + y * bytesPerRow + b);

        if (format === "sprite-multi") {
          // Two bits per pixel, four pixels to a byte, high pair leftmost.
          for (let pair = 0; pair < 4; pair++) {
            const value = (byte >> (6 - pair * 2)) & 0b11;
            const x = originX + b * 4 + pair;
            pixels[(originY + y) * width + x] = colours[value] ?? value;
          }
        } else {
          for (let bit = 0; bit < 8; bit++) {
            const on = (byte >> (7 - bit)) & 1;
            const x = originX + b * 8 + bit;
            pixels[(originY + y) * width + x] = colours[on] ?? on;
          }
        }
      }
    }
  }

  return { width, height, pixels, palette: C64_PALETTE };
}

/**
 * Perceived brightness of a `#rrggbb`, for choosing a shading character.
 *
 * Rec. 601 weights: the eye is far more sensitive to green than to blue, and
 * averaging the channels instead puts C64 blue and C64 brown at the same
 * darkness when one is plainly lighter.
 */
function luminance(colour: string): number {
  const value = parseInt(colour.slice(1), 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Darkest to lightest. Reads as an image at a glance, which a 0/1 grid does not. */
const SHADES = " .:-=+*#%@";

/**
 * A picture as text, for a terminal.
 *
 * Two characters per pixel by default, because a terminal cell is about twice
 * as tall as it is wide and a sprite drawn one-for-one comes out squashed to
 * half its height — which is exactly the shape that makes a glyph unreadable.
 */
export function bitmapToText(bitmap: Bitmap, options: { pixelWidth?: number } = {}): string {
  const pixelWidth = Math.max(1, Math.floor(options.pixelWidth ?? 2));
  const shadeOf = bitmap.palette.map((colour) => {
    const index = Math.round(luminance(colour) * (SHADES.length - 1));
    return SHADES[Math.min(SHADES.length - 1, Math.max(0, index))];
  });

  const lines: string[] = [];
  for (let y = 0; y < bitmap.height; y++) {
    let line = "";
    for (let x = 0; x < bitmap.width; x++) {
      const index = bitmap.pixels[y * bitmap.width + x];
      line += (shadeOf[index] ?? "?").repeat(pixelWidth);
    }
    lines.push(line);
  }
  return lines.join("\n");
}

/**
 * A region's `view` string, as decoder options.
 *
 * One short field rather than three — `format`, `stride`, `columns` — because
 * every one of those would have to be threaded through the project schema, the
 * line serializer, the CRDT assignment, the op type, the diff, the inverse and
 * four call signatures. `char:8` says the same thing, diffs readably, and leaves
 * room for `snippet:<id>` later without another round of plumbing.
 *
 * Unparseable or unknown returns undefined rather than guessing a format, so a
 * caller can say the view is not understood instead of drawing the wrong thing.
 */
export function parseBitmapView(view: string | undefined): BitmapOptions | undefined {
  if (!view) return undefined;
  const [name, count] = view.trim().split(":");
  const format = name as BitmapFormat;
  if (!["bits", "char", "sprite", "sprite-multi"].includes(format)) return undefined;

  const n = count === undefined ? undefined : Number.parseInt(count, 10);
  if (count !== undefined && (!Number.isFinite(n) || (n as number) < 1)) return undefined;

  // The number means bytes-per-row for a raw bit run and cells-per-row for the
  // cell formats, because those are the knob each one actually has.
  return format === "bits"
    ? { format, stride: n ?? 1 }
    : { format, columns: n ?? 1 };
}

/** Whether a `view` string names something this can draw. */
export const isBitmapView = (view: string | undefined): boolean =>
  parseBitmapView(view) !== undefined;

/** How many bytes one cell of this view consumes. */
export function bytesPerCell(options: BitmapOptions): number {
  switch (options.format ?? "bits") {
    case "char":
      return 8;
    case "sprite":
    case "sprite-multi":
      return 63;
    case "bits":
      return Math.max(1, options.stride ?? 1);
  }
}
