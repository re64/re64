/**
 * Turning C64 bytes into something readable.
 *
 * Three encodings, because a byte in a text region means different things
 * depending on where it was going:
 *
 * - **PETSCII** is what the KERNAL's CHROUT takes, and what a string in a BASIC
 *   program holds.
 * - **Screen codes** are what sits in screen RAM. Not the same numbering:
 *   `$01` is `A` on the screen and `Ctrl-A` in PETSCII.
 * - **ASCII** is the fallback, and is what this always did.
 *
 * Neither C64 encoding is ASCII, so reading either as ASCII produces confident
 * nonsense — the copyright line in Gridrunner reads `<= 1982` that way.
 *
 * Most of both maps to plain ASCII. The graphics characters map to Unicode that
 * already existed for other reasons — box drawing, block elements, card suits —
 * plus the Symbols for Legacy Computing block added in Unicode 13 for exactly
 * this purpose.
 *
 * **The graphics coverage here is partial and deliberately so.** Every code that
 * carries text is exact; the glyph codes cover the common ones and fall back to
 * `·` rather than guessing. A wrong glyph is worse than an obvious gap, and
 * text is what a disassembly reader is looking for.
 */

import { KEY_MATRIX } from "./devices/keyboard.js";

export type TextEncoding = "ascii" | "petscii" | "screen" | "keycode";

/** Shown where a byte has no glyph in this encoding, or none worth claiming. */
const UNKNOWN = "·";

/**
 * Graphics glyphs shared by both encodings, keyed by their screen code.
 *
 * PETSCII reaches the same glyphs at a different offset, handled below.
 */
const SCREEN_GRAPHICS: Record<number, string> = {
  0x40: "─", // ─
  0x41: "♠", // ♠
  0x42: "│", // │
  0x50: "┼", // ┼
  0x53: "♥", // ♥
  0x56: "╭", // ╭
  0x57: "╰", // ╰
  0x58: "╰", // ╰
  0x59: "♦", // ♦  (card suit)
  0x5a: "♣", // ♣
  0x5b: "│", // │
  0x5d: "│", // │
  0x60: " ", // non-breaking space, the reversed-space cell
  0x61: "▌", // ▌
  0x62: "▄", // ▄
  0x63: "▔", // ▔
  0x64: "▁", // ▁
  0x65: "▏", // ▏
  0x66: "▒", // ▒
  0x67: "▕", // ▕
  0x69: "◤", // ◤
  0x6a: "▕", // ▕
  0x6b: "┤", // ┤
  0x6c: "▗", // ▗
  0x6d: "└", // └
  0x6e: "┐", // ┐
  0x6f: "▂", // ▂
  0x70: "┌", // ┌
  0x71: "┴", // ┴
  0x72: "┬", // ┬
  0x73: "├", // ├
  0x74: "▎", // ▎
  0x75: "▍", // ▍
  0x79: "▃", // ▃
  0x7b: "▖", // ▖
  0x7c: "▝", // ▝
  0x7d: "┘", // ┘
  0x7e: "▘", // ▘
  0x7f: "▚", // ▚
};

/**
 * One screen-code byte as a character.
 *
 * Screen codes run `@ A-Z [ £ ] ↑ ←` from zero, then the ASCII punctuation and
 * digit range at its familiar place, then graphics. The high half is the same
 * set reversed, which reads the same.
 */
export function fromScreenCode(byte: number): string {
  const code = byte & 0x7f; // reverse video is the same glyph

  if (code === 0x00) return "@";
  if (code >= 0x01 && code <= 0x1a) return String.fromCharCode(0x40 + code); // A-Z
  if (code === 0x1b) return "[";
  if (code === 0x1c) return "£"; // £
  if (code === 0x1d) return "]";
  if (code === 0x1e) return "↑"; // ↑
  if (code === 0x1f) return "←"; // ←
  if (code >= 0x20 && code <= 0x3f) return String.fromCharCode(code); // space..?

  return SCREEN_GRAPHICS[code] ?? UNKNOWN;
}

/**
 * One PETSCII byte as a character.
 *
 * The printable range is ASCII's, with `£ ↑ ←` where ASCII has `\ ^ _`. Letters
 * are upper case in the default character set. Control codes have no glyph and
 * are not guessed at.
 */
export function fromPetscii(byte: number): string {
  if (byte >= 0x20 && byte <= 0x5a) {
    if (byte === 0x5c) return "£";
    return String.fromCharCode(byte);
  }
  if (byte === 0x5b) return "[";
  if (byte === 0x5c) return "£"; // £
  if (byte === 0x5d) return "]";
  if (byte === 0x5e) return "↑"; // ↑
  if (byte === 0x5f) return "←"; // ←

  // Shifted letters: the same characters at a second address.
  if (byte >= 0xc1 && byte <= 0xda) return String.fromCharCode(byte - 0x80);

  // Graphics reach the screen-code glyphs at two offsets.
  if (byte >= 0x60 && byte <= 0x7f) return SCREEN_GRAPHICS[byte] ?? UNKNOWN;
  if (byte >= 0xa0 && byte <= 0xbf) return SCREEN_GRAPHICS[byte - 0x40] ?? UNKNOWN;

  return UNKNOWN;
}

/** One byte as printable ASCII, which is what this always did. */
export function fromAscii(byte: number): string {
  return byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".";
}

/**
 * A keyboard matrix code, as the key it names.
 *
 * **A coordinate rather than a character set**, and the odd one out here: a
 * matrix code is `row * 8 + column`, where a key physically sits on the grid
 * CIA 1 scans, so nothing ever *draws* one. It is in this union because it is
 * the same kind of thing every other member is — a fixed table of this machine,
 * true of the bytes wherever they sit and belonging to no program.
 *
 * It earns its place because programs store them. Revenge of the Mutant Camels
 * holds `1A 26 0A 16 0D` at `$96F7` and compares `$C5` against it; a reader
 * worked out by hand that those are G, O, A, T and S and wrote it in a comment,
 * which is the last place a finding should have to live. Under this encoding
 * the bytes say `GOATS`.
 *
 * One character per byte, so a key with no single character — `f1`, `run-stop`,
 * either shift — reads as `·` rather than as its name. That is the same rule
 * the graphics glyphs follow: a visible gap beats a wrong answer, and a name
 * spliced into a string would make the run unreadable exactly where it is
 * interesting.
 */
export function fromKeycode(byte: number): string {
  const name = KEY_NAME[byte & 0x3f];
  if (name === undefined) return UNKNOWN;
  if (name === "space") return " ";
  return name.length === 1 ? name.toUpperCase() : UNKNOWN;
}

/** Matrix code to key name, inverted from the table the scan uses. */
const KEY_NAME: Readonly<Record<number, string>> = Object.fromEntries(
  Object.entries(KEY_MATRIX).map(([name, code]) => [code, name])
);

/** Decode a run of bytes in the given encoding. */
export function decodeText(bytes: readonly number[], encoding: TextEncoding): string {
  return bytes.map(decoderFor(encoding)).join("");
}

/**
 * The decoder for an encoding, exhaustively.
 *
 * A `switch` with a `never` default rather than a ternary chain, so adding a
 * value to `TextEncoding` fails to compile here instead of silently falling
 * through to ASCII — which is what a chain ending in `: fromAscii` does, and it
 * would have rendered a whole new encoding as plausible nonsense with nothing
 * to indicate it.
 */
function decoderFor(encoding: TextEncoding): (byte: number) => string {
  switch (encoding) {
    case "keycode":
      return fromKeycode;
    case "petscii":
      return fromPetscii;
    case "screen":
      return fromScreenCode;
    case "ascii":
      return fromAscii;
    default: {
      const unhandled: never = encoding;
      throw new Error(`unhandled text encoding: ${String(unhandled)}`);
    }
  }
}

export const TEXT_ENCODINGS: readonly TextEncoding[] = ["ascii", "petscii", "screen"];
