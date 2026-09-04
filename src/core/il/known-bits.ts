/**
 * A value whose bits are individually known or not.
 *
 * Byte-granularity "known or unknown" is too coarse for this machine, and `PHP`
 * is the reason. It assembles one byte out of seven separate flags, any of which
 * may be determined while the others are not — and an interrupt handler then
 * does `PLA / AND #$10` to ask about exactly one of them. Under a whole-byte
 * lattice that byte is simply unknown and the question cannot be answered; under
 * this one, `B` survives the round trip through the stack and the `AND` extracts
 * it.
 *
 * `known` says which bits are determined; `value` holds them, and is always zero
 * in the bits that are not — so two `Bits` describing the same thing compare
 * equal, which a fixpoint depends on.
 *
 * This is the standard known-bits domain, and its rules are the ones that make
 * it sound: a bit is known only where *every* way of arriving at it agrees.
 */
export interface Bits {
  known: number;
  value: number;
}

/** All ones for a value of this many bytes. */
export const widthMask = (size: number): number =>
  size >= 4 ? 0xffffffff : ((1 << (8 * size)) - 1) >>> 0;

/** A value known completely. */
export const exact = (value: number, size: number): Bits => {
  const mask = widthMask(size);
  return { known: mask, value: (value & mask) >>> 0 };
};

/** A value known not at all. */
export const unknown = (): Bits => ({ known: 0, value: 0 });

/** Whether every bit is determined, so a concrete answer exists. */
export const isExact = (bits: Bits, size: number): boolean =>
  (bits.known >>> 0) === widthMask(size);

/** Force the invariant that undetermined bits read as zero. */
const normalise = (known: number, value: number, size: number): Bits => {
  const mask = widthMask(size);
  const k = (known & mask) >>> 0;
  return { known: k, value: (value & k) >>> 0 };
};

/** Narrow or widen to a width, keeping what is known and zeroing above. */
export const truncate = (bits: Bits, size: number): Bits =>
  normalise(bits.known, bits.value, size);

export function and(a: Bits, b: Bits, size: number): Bits {
  // A zero anywhere forces the result bit to zero, even if the other side is a
  // mystery — which is the whole reason `AND #$10` can answer about one flag.
  const zeroA = (a.known & ~a.value) >>> 0;
  const zeroB = (b.known & ~b.value) >>> 0;
  return normalise((a.known & b.known) | zeroA | zeroB, a.value & b.value, size);
}

export function or(a: Bits, b: Bits, size: number): Bits {
  const oneA = (a.known & a.value) >>> 0;
  const oneB = (b.known & b.value) >>> 0;
  return normalise((a.known & b.known) | oneA | oneB, a.value | b.value, size);
}

export function xor(a: Bits, b: Bits, size: number): Bits {
  return normalise(a.known & b.known, a.value ^ b.value, size);
}

export function not(a: Bits, size: number): Bits {
  return normalise(a.known, ~a.value, size);
}

export function shiftLeft(a: Bits, by: Bits, size: number): Bits {
  if (!isExact(by, by.known === 0 ? 1 : 4) && by.known !== widthMask(1)) {
    // The amount itself has to be known; a shift by an unknown amount tells us
    // nothing about any bit.
    if ((by.known >>> 0) !== widthMask(1) && (by.known >>> 0) !== widthMask(4)) return unknown();
  }
  const n = by.value;
  if (n >= 8 * size) return exact(0, size);
  // Bits shifted in at the bottom are known zeros.
  const low = ((1 << n) - 1) >>> 0;
  return normalise(((a.known << n) | low) >>> 0, a.value << n, size);
}

export function shiftRight(a: Bits, by: Bits, size: number): Bits {
  if ((by.known >>> 0) !== widthMask(1) && (by.known >>> 0) !== widthMask(4)) return unknown();
  const n = by.value;
  const width = 8 * size;
  if (n >= width) return exact(0, size);
  const mask = widthMask(size);
  // Bits shifted in at the top are known zeros.
  const high = (mask & ~(mask >>> n)) >>> 0;
  return normalise((((a.known & mask) >>> n) | high) >>> 0, (a.value & mask) >>> n, size);
}

/**
 * Addition, carrying what is known bit by bit.
 *
 * A carry can be settled even where the operands are not: two known zeros
 * produce no carry whatever the third input does. That is worth having, because
 * it is how the high bits of an address survive an offset nobody knows.
 */
export function add(a: Bits, b: Bits, size: number): Bits {
  return addWithCarry(a, b, exact(0, 1), size).sum;
}

/**
 * Addition, reporting the carry out and the signed overflow as well as the sum.
 *
 * Both are single bits and both are often knowable when the sum is not, which is
 * the argument for computing them here rather than letting the fallback answer
 * "unknown" for anything with one undetermined operand. `INT_CARRY` and
 * `INT_SCARRY` are separate operations in the IL, and this is what they read.
 */
export function addWithCarry(
  a: Bits,
  b: Bits,
  carryIn: Bits,
  size: number
): { sum: Bits; carry: Bits; overflow: Bits } {
  let known = 0;
  let value = 0;
  let carryKnown = (carryIn.known & 1) !== 0;
  let carry = carryIn.value & 1;
  // The carry into the top bit, which is what signed overflow compares against.
  let intoTopKnown = false;
  let intoTop = 0;

  for (let i = 0; i < 8 * size; i++) {
    if (i === 8 * size - 1) {
      intoTopKnown = carryKnown;
      intoTop = carry;
    }
    const bit = i >= 31 ? 0 : 1 << i;
    const aKnown = (a.known >>> i) & 1;
    const bKnown = (b.known >>> i) & 1;
    const aBit = (a.value >>> i) & 1;
    const bBit = (b.value >>> i) & 1;

    if (aKnown && bKnown && carryKnown) {
      const sum = aBit + bBit + carry;
      if (sum & 1) value = (value | bit) >>> 0;
      known = (known | bit) >>> 0;
      carry = sum >= 2 ? 1 : 0;
      continue;
    }

    // The sum bit is lost, but the carry out may not be: it is the majority of
    // three inputs, and two agreeing zeros or two agreeing ones decide it.
    const zeros = (aKnown && !aBit ? 1 : 0) + (bKnown && !bBit ? 1 : 0) + (carryKnown && !carry ? 1 : 0);
    const ones = (aKnown && aBit ? 1 : 0) + (bKnown && bBit ? 1 : 0) + (carryKnown && carry ? 1 : 0);
    if (zeros >= 2) {
      carryKnown = true;
      carry = 0;
    } else if (ones >= 2) {
      carryKnown = true;
      carry = 1;
    } else {
      carryKnown = false;
      carry = 0;
    }
  }

  // Signed overflow is the carry into the top bit disagreeing with the carry out
  // of it — the one definition both published 6502 references get wrong, so it
  // is written here as the rule rather than as a shortcut.
  const overflow =
    intoTopKnown && carryKnown ? exact(intoTop === carry ? 0 : 1, 1) : unknown();

  return {
    sum: normalise(known, value, size),
    carry: carryKnown ? exact(carry, 1) : unknown(),
    overflow,
  };
}

/** Two's complement negation, as `0 - a`. */
export const negate = (a: Bits, size: number): Bits =>
  add(not(a, size), exact(1, size), size);

/** Subtraction, as `a + ~b + 1`. */
export const subtract = (a: Bits, b: Bits, size: number): Bits =>
  add(a, negate(b, size), size);

/** Zero extension: the bits above are known zeros. */
export const zeroExtend = (a: Bits, from: number, to: number): Bits => {
  const inner = truncate(a, from);
  const added = (widthMask(to) & ~widthMask(from)) >>> 0;
  return normalise((inner.known | added) >>> 0, inner.value, to);
};

/** Sign extension: the bits above copy the top bit, when that bit is known. */
export function signExtend(a: Bits, from: number, to: number): Bits {
  const inner = truncate(a, from);
  const top = 1 << (8 * from - 1);
  if ((inner.known & top) === 0) return normalise(inner.known, inner.value, to);
  const added = (widthMask(to) & ~widthMask(from)) >>> 0;
  const sign = (inner.value & top) !== 0;
  return normalise((inner.known | added) >>> 0, sign ? (inner.value | added) >>> 0 : inner.value, to);
}

/** The high `size` bytes of `a` after dropping `offset` low bytes. */
export const subpiece = (a: Bits, offset: number, size: number): Bits =>
  normalise(a.known >>> (8 * offset), a.value >>> (8 * offset), size);

/** `high` above `low`, where `low` is `lowSize` bytes wide. */
export const concat = (high: Bits, low: Bits, lowSize: number, size: number): Bits =>
  normalise(
    ((high.known << (8 * lowSize)) | truncate(low, lowSize).known) >>> 0,
    ((high.value << (8 * lowSize)) | truncate(low, lowSize).value) >>> 0,
    size
  );

/**
 * Equality, which one differing known bit is enough to settle.
 *
 * `LDA #$01 / CMP #$02` needs no more than that, and it is what lets a
 * comparison against a constant decide a branch without the other side being
 * fully determined.
 */
export function equal(a: Bits, b: Bits, size: number): Bits {
  const both = (a.known & b.known & widthMask(size)) >>> 0;
  if (((a.value ^ b.value) & both) !== 0) return exact(0, 1);
  if (isExact(a, size) && isExact(b, size)) return exact(1, 1);
  return unknown();
}

/**
 * The range a value could take: unknown bits all zero, then all one.
 *
 * Comparing ranges beats scanning bits from the top, and the difference is not
 * cosmetic. `AND #$7F` leaves the low seven bits a mystery, so a scan stops at
 * the first of them and answers nothing — while the range says 0 to 127, and
 * nothing in it is negative. That is `N` proven clear, which is the case this
 * whole domain was extended for.
 */
const range = (x: Bits, size: number): [min: number, max: number] => {
  const mask = widthMask(size);
  return [(x.value & mask) >>> 0, ((x.value | (~x.known & mask)) & mask) >>> 0];
};

/** Unsigned comparison, decided whenever the two ranges do not overlap. */
export function lessThan(a: Bits, b: Bits, size: number): Bits {
  const [aMin, aMax] = range(a, size);
  const [bMin, bMax] = range(b, size);
  if (aMax < bMin) return exact(1, 1);
  if (aMin >= bMax) return exact(0, 1);
  return unknown();
}

/**
 * Signed comparison, which is how the lifter computes `N`: `value s< 0`.
 *
 * With the sign bit known the range does not wrap, so the same interval test
 * works after reading both ends as signed. With it unknown the value could be
 * either side of zero and only a disagreement between the two sign bits settles
 * anything.
 */
export function signedLessThan(a: Bits, b: Bits, size: number): Bits {
  const top = (1 << (8 * size - 1)) >>> 0;
  const signOf = (x: Bits) => ((x.known & top) !== 0 ? (x.value & top) !== 0 : undefined);
  const aSign = signOf(a);
  const bSign = signOf(b);
  if (aSign === undefined || bSign === undefined) return unknown();
  if (aSign !== bSign) return exact(aSign ? 1 : 0, 1);

  const asSigned = (v: number) => (v & top ? v - top * 2 : v);
  const [aMin, aMax] = range(a, size).map(asSigned);
  const [bMin, bMax] = range(b, size).map(asSigned);
  if (aMax < bMin) return exact(1, 1);
  if (aMin >= bMax) return exact(0, 1);
  return unknown();
}

/** What two paths agree on: a bit survives only where both know it and agree. */
export function join(a: Bits, b: Bits, size: number): Bits {
  const both = (a.known & b.known) >>> 0;
  const agree = (both & ~(a.value ^ b.value)) >>> 0;
  return normalise(agree, a.value, size);
}

export const same = (a: Bits, b: Bits): boolean =>
  a.known >>> 0 === b.known >>> 0 && a.value >>> 0 === b.value >>> 0;
