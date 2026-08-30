import { describe, it, expect } from "vitest";
import { decodeText, fromAscii, fromPetscii, fromScreenCode } from "./text.js";

const bytes = (text: string) => [...text].map((c) => c.charCodeAt(0));

describe("screen codes", () => {
  it("starts the alphabet at one, not at sixty-five", () => {
    // The whole reason this exists: $01 is `A` on the screen and a control
    // code in PETSCII, so reading one as the other is confident nonsense.
    expect(decodeText([0x08, 0x05, 0x0c, 0x0c, 0x0f], "screen")).toBe("HELLO");
    expect(decodeText([0x00], "screen")).toBe("@");
  });

  it("keeps digits and punctuation where ASCII has them", () => {
    expect(decodeText([0x31, 0x39, 0x38, 0x32], "screen")).toBe("1982");
    expect(decodeText([0x20, 0x21, 0x3f], "screen")).toBe(" !?");
  });

  it("reads reverse video as the same glyph", () => {
    // The high bit is the reverse-video flag, not a different character.
    expect(fromScreenCode(0x81)).toBe(fromScreenCode(0x01));
  });

  it("has the C64's own characters where ASCII has none", () => {
    expect(fromScreenCode(0x1c)).toBe("£");
    expect(fromScreenCode(0x1e)).toBe("↑");
    expect(fromScreenCode(0x1f)).toBe("←");
  });

  it("draws the graphics it is sure of and admits the rest", () => {
    expect(fromScreenCode(0x41)).toBe("♠");
    expect(fromScreenCode(0x53)).toBe("♥");
    expect(fromScreenCode(0x5a)).toBe("♣");
    // Partial on purpose: a wrong glyph is worse than an obvious gap.
    expect(fromScreenCode(0x4f)).toBe("·");
  });
});

describe("PETSCII", () => {
  it("reads the printable range as ASCII does", () => {
    expect(decodeText(bytes("HELLO 1982"), "petscii")).toBe("HELLO 1982");
  });

  it("puts the C64's characters where ASCII has backslash and caret", () => {
    expect(fromPetscii(0x5c)).toBe("£");
    expect(fromPetscii(0x5e)).toBe("↑");
    expect(fromPetscii(0x5f)).toBe("←");
  });

  it("reads shifted letters as the letters they are", () => {
    expect(decodeText([0xc8, 0xc5, 0xcc, 0xcc, 0xcf], "petscii")).toBe("HELLO");
  });

  it("gives a control code no glyph rather than inventing one", () => {
    expect(fromPetscii(0x0d)).toBe("·"); // carriage return
    expect(fromPetscii(0x93)).toBe("·"); // clear screen
  });
});

describe("ASCII, which is what this always did", () => {
  it("prints what it can and dots the rest", () => {
    expect(decodeText([0x48, 0x69, 0x00, 0xff], "ascii")).toBe("Hi..");
    expect(fromAscii(0x41)).toBe("A");
  });
});

describe("choosing wrongly is visible", () => {
  it("gives different answers for the same bytes", () => {
    // The point of saying which encoding: these are not interchangeable, and a
    // reader who sees nonsense knows to say something rather than believing it.
    const same = [0x08, 0x05, 0x0c, 0x0c, 0x0f];
    expect(decodeText(same, "screen")).toBe("HELLO");
    expect(decodeText(same, "ascii")).not.toBe("HELLO");
    expect(decodeText(same, "petscii")).not.toBe("HELLO");
  });
});
