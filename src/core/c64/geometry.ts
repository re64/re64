/**
 * Where a thing is, in the units the machine actually uses.
 *
 * Three programs' worth of transcripts say this is the most repeated hand
 * arithmetic there is. Experiment 8's readers converted `$0592` to row 10,
 * column 2 over and over on a game whose whole state lives in screen memory,
 * and asked for `screen_address` by name three times; experiment 9's editor
 * converted sprite numbers to addresses for every picture in its article. It is
 * exact arithmetic with one right answer, which is the kind of thing a tool
 * should do and a person should not.
 *
 * **Both conversions depend on runtime state, and that is the whole risk.**
 * Where the screen is depends on `$D018` and the VIC bank; where sprite data is
 * depends on the bank alone. Neither is a property of the project — a program
 * moves its screen whenever it likes — so the bases are arguments with
 * power-on defaults, and anything answering with them says which it used.
 */

/** Where the VIC finds the screen at power-on, and where most programs leave it. */
export const DEFAULT_SCREEN_BASE = 0x0400;
/** Colour RAM is not banked and not movable: it is always here. */
export const COLOUR_RAM = 0xd800;

export const COLUMNS = 40;
export const ROWS = 25;
export const CELLS = COLUMNS * ROWS;

/** A sprite's data is a 64-byte block indexed by its pointer, within a bank. */
export const SPRITE_BLOCK = 64;

/** The address of one character cell. */
export function screenAddress(
  row: number,
  column: number,
  base = DEFAULT_SCREEN_BASE
): number {
  if (!Number.isInteger(row) || row < 0 || row >= ROWS) {
    throw new Error(`Row ${row} is not on the screen; there are ${ROWS}, numbered from 0.`);
  }
  if (!Number.isInteger(column) || column < 0 || column >= COLUMNS) {
    throw new Error(
      `Column ${column} is not on the screen; there are ${COLUMNS}, numbered from 0.`
    );
  }
  return (base + row * COLUMNS + column) & 0xffff;
}

/** Which cell an address is, if it is on the screen at all. */
export function screenCell(
  address: number,
  base = DEFAULT_SCREEN_BASE
): { row: number; column: number; cell: number; colourRam: number } | undefined {
  const offset = address - base;
  if (offset < 0 || offset >= CELLS) return undefined;
  return {
    row: Math.floor(offset / COLUMNS),
    column: offset % COLUMNS,
    cell: offset,
    // The colour of a cell is at the same offset into a kilobyte that never
    // moves, which is the pair a reader actually wants: change one and the
    // other is where the colour is.
    colourRam: COLOUR_RAM + offset,
  };
}

/** Where the bytes of a sprite pointer live. */
export function spriteAddress(pointer: number, bank = 0): number {
  if (!Number.isInteger(pointer) || pointer < 0 || pointer > 0xff) {
    throw new Error(`Sprite ${pointer} is not a pointer; a pointer is one byte, 0 to 255.`);
  }
  return (bank + pointer * SPRITE_BLOCK) & 0xffff;
}

/**
 * Which sprite pointer reaches an address.
 *
 * `offset` is how far into the block the address sits, and it matters: only an
 * offset of zero is a sprite's *start*, and a pointer that reaches the middle
 * of one is somebody reading the fourth row of a picture rather than the
 * picture.
 */
export function spriteAt(
  address: number,
  bank = 0
): { pointer: number; offset: number } | undefined {
  const offset = address - bank;
  if (offset < 0 || offset >= 0x4000) return undefined;
  return { pointer: Math.floor(offset / SPRITE_BLOCK), offset: offset % SPRITE_BLOCK };
}

/**
 * `screen(...)` and `sprite(...)` written out, as an address.
 *
 * **Sugar at the parser, and deliberately not a language.** It reaches every
 * tool at once because they share one address schema, and it stops there: a
 * call with integer arguments is a lookup with parentheses, where `sprite($9D)
 * + 3` would be a grammar — with precedence to define, four consumers to
 * implement it identically, and a version to carry in the file format. The
 * moment somebody wants arithmetic, they want an expression language, and that
 * is a different decision taken deliberately rather than arrived at.
 *
 * Resolved here and never stored: what a claim records is the address this
 * returns, because the bases are runtime state and a stored expression would
 * mean different bytes at different moments of the program.
 */
export function parseGeometry(text: string): number | undefined {
  const match = /^(screen|sprite)\s*\(([^)]*)\)$/i.exec(text.trim());
  if (!match) return undefined;

  const [, name, inside] = match;
  const args = inside
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const value = part.startsWith("$")
        ? parseInt(part.slice(1), 16)
        : part.startsWith("0x")
          ? parseInt(part.slice(2), 16)
          : parseInt(part, 10);
      if (!Number.isFinite(value)) throw new Error(`${part} is not a number`);
      return value;
    });

  if (name.toLowerCase() === "screen") {
    // `screen(cell)` as well as `screen(row, column)`, because a program's own
    // arithmetic is usually a single offset and translating it to a row and a
    // column first would be the work this exists to remove.
    if (args.length === 1) {
      const [cell] = args;
      if (cell < 0 || cell >= CELLS) throw new Error(`Cell ${cell} is not on the screen`);
      return (DEFAULT_SCREEN_BASE + cell) & 0xffff;
    }
    if (args.length === 2 || args.length === 3) {
      return screenAddress(args[0], args[1], args[2] ?? DEFAULT_SCREEN_BASE);
    }
    throw new Error("screen() takes a cell, a row and a column, or those and a base");
  }

  if (args.length === 1 || args.length === 2) return spriteAddress(args[0], args[1] ?? 0);
  throw new Error("sprite() takes a pointer, and optionally the VIC bank");
}
