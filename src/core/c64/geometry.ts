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
 * A place written out, as an address.
 *
 * **Brackets, because that is what these are.** `sprite[13]` and `screen[10,2]`
 * are array references into an array whose base is implicit — the sprite blocks
 * from the VIC bank, the character cells from the screen base — and writing them
 * with parentheses said "call" or, on a machine where `($FB),Y` is the
 * indirection syntax, said something worse. The observation is not cosmetic: it
 * makes a place the same shape as `zones[2]`, so one notation covers a program's
 * own tables and the machine's.
 *
 * The base is not an index, so it does not go inside the brackets. It goes where
 * it belongs — on the array: `screen($8400)[10,2]` is the cell in a screen
 * somebody moved, and `sprite($4000)[13]` the block in a different VIC bank.
 *
 * The parenthesised forms are still read, because three runs' worth of notes and
 * every previous tool description use them, and a place resolves to an address
 * and is never stored — so there is nothing to migrate and no reason to break
 * anybody's fingers.
 *
 * **Sugar at the parser, and deliberately not a language.** An index list is a
 * lookup; `sprite[$9D] + 3` would be a grammar — with precedence to define, four
 * consumers to implement it identically, and a version to carry in the file
 * format. The moment somebody wants arithmetic, they want an expression
 * language, and that is a different decision taken deliberately rather than
 * arrived at.
 *
 * Resolved here and never stored: what a claim records is the address this
 * returns, because the bases are runtime state and a stored expression would
 * mean different bytes at different moments of the program.
 */
export function parseGeometry(text: string): number | undefined {
  const match = /^(screen|sprite)\s*(?:\(([^)]*)\))?\s*(?:\[([^\]]*)\])?$/i.exec(text.trim());
  if (!match) return undefined;

  const [, word, parens, brackets] = match;
  // Neither is a place: bare `screen` says a thing, not a thing's address.
  if (parens === undefined && brackets === undefined) return undefined;
  const name = word.toLowerCase() as "screen" | "sprite";

  if (brackets !== undefined) {
    const where = numbers(parens ?? "");
    if (where.length > 1) {
      throw new Error(
        `${name}(...) locates the array and takes one address; the indices go in ` +
          "the brackets."
      );
    }
    return at(name, numbers(brackets), where[0]);
  }

  // The parenthesised form, where the base rides along as a last argument —
  // which is exactly the ambiguity the brackets remove.
  const args = numbers(parens!);
  if (name === "screen") {
    if (args.length === 1) return at("screen", args, undefined);
    if (args.length === 2 || args.length === 3) return at("screen", args.slice(0, 2), args[2]);
    throw new Error("screen[] takes a cell, or a row and a column");
  }
  if (args.length === 1 || args.length === 2) return at("sprite", args.slice(0, 1), args[1]);
  throw new Error("sprite[] takes a pointer");
}

/** An index list, in the spellings addresses are written in. */
function numbers(inside: string): number[] {
  return inside
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
}

/** One place, from its indices and the base of the array they index. */
function at(name: "screen" | "sprite", index: number[], base: number | undefined): number {
  if (name === "sprite") {
    if (index.length !== 1) throw new Error("sprite[] takes a pointer, and nothing else");
    return spriteAddress(index[0], base ?? 0);
  }
  // `screen[cell]` as well as `screen[row,column]`, because a program's own
  // arithmetic is usually a single offset and translating it to a row and a
  // column first would be the work this exists to remove.
  if (index.length === 1) {
    const [cell] = index;
    if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) {
      throw new Error(`Cell ${cell} is not on the screen; there are ${CELLS}, numbered from 0.`);
    }
    return ((base ?? DEFAULT_SCREEN_BASE) + cell) & 0xffff;
  }
  if (index.length === 2) return screenAddress(index[0], index[1], base ?? DEFAULT_SCREEN_BASE);
  throw new Error("screen[] takes a cell, or a row and a column");
}

/**
 * An address written back as the place it is — the direction `where` answers.
 *
 * Names the base only when it is not the one at power-on, so the common case
 * stays short and the uncommon one cannot be mistaken for it.
 */
export function placeText(
  name: "screen" | "sprite",
  index: readonly number[],
  base: number,
  fallback: number
): string {
  const located = base === fallback ? name : `${name}($${hex(base)})`;
  return `${located}[${index.join(",")}]`;
}

const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");
