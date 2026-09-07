/**
 * The keyboard, as an eight-by-eight matrix.
 *
 * There is no key *code* on this machine — the KERNAL scans a grid by driving
 * one row of CIA 1's port A low and reading which columns come back low on port
 * B, and what it stores in `$C5` and `$CB` is the position it found: `row * 8 +
 * column`. So a name here maps to a place on the grid rather than to a
 * character, which is why `A` is 10 and `Q` is 62 with nothing alphabetical
 * about either.
 *
 * Names rather than numbers on the API, because a matrix code is exactly the
 * sort of shortcut this project sweeps out of the write surface: a caller
 * writing `26` has to know the grid, and a caller writing `"g"` does not. The
 * numbers are still reachable, for the one case that needs them — reproducing
 * something a program does with a code it computed.
 */

/**
 * Where each key sits, as `row * 8 + column`.
 *
 * Checked against a real program rather than transcribed hopefully: Revenge of
 * the Mutant Camels compares its cheat keys against `1A 26 0A 16 0D`, which is
 * G, O, A, T and S — and that table is the reason this one is trustworthy.
 */
export const KEY_MATRIX: Readonly<Record<string, number>> = {
  // Row 0 — the function keys and the two cursor directions.
  delete: 0, return: 1, "cursor-right": 2, f7: 3, f1: 4, f3: 5, f5: 6, "cursor-down": 7,
  // Row 1
  "3": 8, w: 9, a: 10, "4": 11, z: 12, s: 13, e: 14, "shift-left": 15,
  // Row 2
  "5": 16, r: 17, d: 18, "6": 19, c: 20, f: 21, t: 22, x: 23,
  // Row 3
  "7": 24, y: 25, g: 26, "8": 27, b: 28, h: 29, u: 30, v: 31,
  // Row 4
  "9": 32, i: 33, j: 34, "0": 35, m: 36, k: 37, o: 38, n: 39,
  // Row 5
  "+": 40, p: 41, l: 42, "-": 43, ".": 44, ":": 45, "@": 46, ",": 47,
  // Row 6
  "pound": 48, "*": 49, ";": 50, home: 51, "shift-right": 52, "=": 53, "arrow-up": 54, "/": 55,
  // Row 7
  "1": 56, "arrow-left": 57, ctrl: 58, "2": 59, space: 60, commodore: 61, q: 62, "run-stop": 63,
};

/**
 * A name or a bare matrix code, as a code.
 *
 * Case-insensitive, because `"A"` and `"a"` are the same key — the machine has
 * no lower case in this sense, and shift is its own position on the grid.
 */
export function keyCode(key: string | number): number | undefined {
  if (typeof key === "number") return Number.isInteger(key) && key >= 0 && key <= 63 ? key : undefined;
  const name = key.trim().toLowerCase();
  if (name in KEY_MATRIX) return KEY_MATRIX[name];
  // A caller may write the code itself, for a key this table does not name.
  const code = Number(name);
  return Number.isInteger(code) && code >= 0 && code <= 63 ? code : undefined;
}

/** Every name a caller may use, for a tool description or an error. */
export const KEY_NAMES: readonly string[] = Object.keys(KEY_MATRIX);
