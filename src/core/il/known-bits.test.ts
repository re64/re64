import { describe, it, expect } from "vitest";
import {
  Bits,
  add,
  addWithCarry,
  and,
  concat,
  equal,
  exact,
  isExact,
  join,
  not,
  lessThan,
  or,
  shiftLeft,
  shiftRight,
  signExtend,
  signedLessThan,
  subpiece,
  subtract,
  unknown,
  xor,
  zeroExtend,
} from "./known-bits.js";

/** A byte written as a pattern: `1`, `0`, or `?` per bit, high bit first. */
function bits(pattern: string): Bits {
  let known = 0;
  let value = 0;
  for (const [i, c] of [...pattern].reverse().entries()) {
    if (c === "?") continue;
    known |= 1 << i;
    if (c === "1") value |= 1 << i;
  }
  return { known: known >>> 0, value: value >>> 0 };
}
const show = (b: Bits, size = 1) =>
  [...Array(8 * size).keys()]
    .reverse()
    .map((i) => ((b.known >>> i) & 1 ? ((b.value >>> i) & 1 ? "1" : "0") : "?"))
    .join("");

describe("the known-bits lattice", () => {
  it("is exhaustively sound for the bitwise operations", () => {
    // Every pair of one-bit-wide patterns against every concrete pair they
    // could stand for: a bit the lattice claims to know must be that bit in
    // every concretisation. This is the property the whole analysis rests on,
    // and it is cheap enough to check completely at this width.
    const patterns = ["000", "001", "01?", "0?0", "???", "1?1", "11?", "111"].map(bits);
    const cases: [string, (a: Bits, b: Bits) => Bits, (a: number, b: number) => number][] = [
      ["and", (a, b) => and(a, b, 1), (a, b) => a & b],
      ["or", (a, b) => or(a, b, 1), (a, b) => a | b],
      ["xor", (a, b) => xor(a, b, 1), (a, b) => a ^ b],
      ["add", (a, b) => add(a, b, 1), (a, b) => (a + b) & 0xff],
      ["subtract", (a, b) => subtract(a, b, 1), (a, b) => (a - b) & 0xff],
      ["lessThan", (a, b) => lessThan(a, b, 1), (a, b) => (a < b ? 1 : 0)],
      [
        "signedLessThan",
        (a, b) => signedLessThan(a, b, 1),
        (a, b) => {
          const s = (v: number) => (v & 0x80 ? v - 256 : v);
          return s(a) < s(b) ? 1 : 0;
        },
      ],
      ["equal", (a, b) => equal(a, b, 1), (a, b) => (a === b ? 1 : 0)],
    ];

    const concretisations = (b: Bits): number[] => {
      const out: number[] = [];
      for (let v = 0; v < 256; v++) if ((v & b.known) === b.value) out.push(v);
      return out;
    };

    for (const [name, abstract_, concrete] of cases) {
      for (const a of patterns) {
        for (const b of patterns) {
          const result = abstract_(a, b);
          for (const av of concretisations(a)) {
            for (const bv of concretisations(b)) {
              const actual = concrete(av, bv);
              expect(
                (actual & result.known) >>> 0,
                `${name}(${show(a)}, ${show(b)}) claimed ${show(result)} but ` +
                  `${av.toString(2)} ${name} ${bv.toString(2)} = ${actual.toString(2)}`
              ).toBe(result.value >>> 0);
            }
          }
        }
      }
    }
  });

  it("extracts one flag from a byte nobody otherwise knows", () => {
    // The case the whole domain exists for: PHP builds a byte out of seven
    // flags, and an interrupt handler asks about exactly one of them with
    // `AND #$10`. Under a whole-byte lattice that byte is simply unknown.
    const status = bits("???1????"); // B is bit 4; everything else a mystery
    expect(show(and(status, exact(0x10, 1), 1))).toBe("00010000");
    expect(isExact(and(status, exact(0x10, 1), 1), 1)).toBe(true);
  });

  it("proves N from bit seven alone", () => {
    // AND #$7F clears the top bit whatever the value was, so N is decided
    // without a single other bit being known.
    const anything = unknown();
    expect(show(and(anything, exact(0x7f, 1), 1))).toBe("0???????");
    expect(show(or(anything, exact(0x80, 1), 1))).toBe("1???????");
  });

  it("settles a carry that the sum does not settle", () => {
    // Two known zeros in the top bits carry nothing, whatever the low bits do.
    const low = bits("00??????");
    const result = addWithCarry(low, low, exact(0, 1), 1);
    expect(isExact(result.sum, 1)).toBe(false);
    expect(result.carry).toEqual(exact(0, 1));
  });

  it("gets signed overflow right where both references get it wrong", () => {
    // $FF + $80 + 1 is -128, which is representable, so V is clear — both
    // halves of the add overflow and they cancel. This is the case that broke
    // the concrete interpreter until the carry chain was written properly.
    const r = addWithCarry(exact(0xff, 1), exact(0x80, 1), exact(1, 1), 1);
    expect(r.sum).toEqual(exact(0x80, 1));
    expect(r.overflow).toEqual(exact(0, 1));
  });

  it("shifts known zeros in, and loses nothing else", () => {
    expect(show(shiftLeft(unknown(), exact(1, 1), 1))).toBe("???????0");
    expect(show(shiftRight(unknown(), exact(1, 1), 1))).toBe("0???????");
    expect(show(shiftRight(bits("?????1??"), exact(2, 1), 1))).toBe("00?????1");
  });

  it("decides equality from one differing bit", () => {
    expect(equal(bits("1???????"), bits("0???????"), 1)).toEqual(exact(0, 1));
    expect(equal(exact(3, 1), exact(3, 1), 1)).toEqual(exact(1, 1));
    // Agreeing on what is known is not enough to say they are equal.
    expect(equal(bits("1???????"), bits("1???????"), 1)).toEqual(unknown());
  });

  it("keeps only what both paths agree on", () => {
    expect(show(join(bits("1010????"), bits("1001????"), 1))).toBe("10??????");
    expect(join(exact(5, 1), exact(5, 1), 1)).toEqual(exact(5, 1));
  });

  it("widens and narrows without inventing bits", () => {
    expect(show(zeroExtend(unknown(), 1, 2), 2)).toBe("00000000????????");
    expect(show(signExtend(bits("1???????"), 1, 2), 2)).toBe("111111111???????");
    // An unknown top bit means the extension is unknown too.
    expect(show(signExtend(bits("????????"), 1, 2), 2)).toBe("????????????????");
    expect(show(subpiece(concat(exact(0xab, 1), bits("????1111"), 1, 2), 1, 1))).toBe("10101011");
  });

  it("never claims a bit it does not hold", () => {
    // The invariant a fixpoint depends on: undetermined bits read as zero, so
    // two Bits describing the same thing compare equal.
    for (const b of [unknown(), bits("1?0?1?0?"), exact(0xff, 1), not(bits("??11??00"), 1)]) {
      expect((b.value & ~b.known) >>> 0).toBe(0);
    }
  });
});
