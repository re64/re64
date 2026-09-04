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
  /**
   * Where each bit came from, for bits that are still whatever they started as.
   *
   * A **relational** fact, which the rest of this domain cannot express: "known"
   * and "unknown" can never say that two values are the same one. `D_out ==
   * D_in` is exactly that shape, and it is what "this routine preserves the
   * decimal flag" means — worth having because on this machine *every* write to
   * `D` in the entire KERNAL is a `PLP` putting back a byte the routine pushed
   * itself, so a summary of what a routine writes says a caller loses a flag
   * that in fact survives.
   *
   * Establishing it by running with sample inputs and seeing what comes back
   * matching is a check and not a proof: `if C then D := 0` passes complementary
   * seeds while preserving nothing. An identifier is a proof, because it only
   * survives operations that provably *move* a bit rather than compute one.
   *
   * Per bit rather than per value, and `PHP` is why — the same reason the domain
   * itself is per bit. `PHP` assembles seven flags into one byte and `PLP` takes
   * them apart; a whole-value identifier is destroyed by the assembly, while a
   * per-bit one rides through the shift and the `OR` and comes back out.
   *
   * Index 0 is bit 0. `0` means "no identity" — either the bit is known, or it
   * was computed from something. Absent entirely when no bit carries one, which
   * is nearly always, so nothing is allocated for the common case.
   */
  origin?: Uint8Array;
}

/** Whether any bit still carries the identity it started with. */
const hasOrigin = (bits: Bits): boolean => bits.origin !== undefined;

/**
 * Bit `i` of a value's identity, or 0 for none.
 *
 * A bit that is *known* has no identity by construction: it is that value, not
 * whatever it started as, so nothing is preserved by carrying a tag on it.
 */
export const originOf = (bits: Bits, i: number): number =>
  (bits.known >>> i) & 1 ? 0 : (bits.origin?.[i] ?? 0);

/**
 * A one-bit value: bit zero opaque and identified, the rest known zero.
 *
 * What a flag register actually holds. Modelling it as a whole opaque byte
 * breaks `PHP`, which assembles the seven flags by shifting each into place and
 * OR-ing them together — an OR only carries an identity through where the other
 * side is a known zero, and a byte of unknown offers none.
 */
export function taggedBit(tag: number): Bits {
  const origin = new Uint8Array(8);
  origin[0] = tag;
  return { known: 0xfe, value: 0, origin };
}

/** An opaque value of this width, every bit tagged from `first` upwards. */
export function tagged(first: number, size: number): Bits {
  const origin = new Uint8Array(8 * size);
  for (let i = 0; i < origin.length; i++) origin[i] = first + i;
  return { known: 0, value: 0, origin };
}

/** Build an identity array from a function of bit position, or nothing. */
function origins(size: number, at: (i: number) => number): Uint8Array | undefined {
  let any = false;
  const out = new Uint8Array(8 * size);
  for (let i = 0; i < out.length; i++) {
    const tag = at(i);
    if (tag !== 0) {
      out[i] = tag;
      any = true;
    }
  }
  return any ? out : undefined;
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
const normalise = (
  known: number,
  value: number,
  size: number,
  origin?: Uint8Array | undefined
): Bits => {
  const mask = widthMask(size);
  const k = (known & mask) >>> 0;
  const result: Bits = { known: k, value: (value & k) >>> 0 };
  // A bit that ended up known has no identity: it is that value now, whatever
  // it used to be.
  const kept = origin && origins(size, (i) => ((k >>> i) & 1 ? 0 : (origin[i] ?? 0)));
  if (kept) result.origin = kept;
  return result;
};

/** Narrow or widen to a width, keeping what is known and zeroing above. */
export const truncate = (bits: Bits, size: number): Bits =>
  normalise(bits.known, bits.value, size, bits.origin);

export function and(a: Bits, b: Bits, size: number): Bits {
  // A zero anywhere forces the result bit to zero, even if the other side is a
  // mystery — which is the whole reason `AND #$10` can answer about one flag.
  const zeroA = (a.known & ~a.value) >>> 0;
  const zeroB = (b.known & ~b.value) >>> 0;
  // Where one side is a known one, the result bit *is* the other side's bit —
  // which is how `AND #$10` pulls `B` out of a status byte with its identity
  // still attached.
  const one = (x: Bits, i: number) => ((x.known >>> i) & 1) === 1 && ((x.value >>> i) & 1) === 1;
  return normalise(
    (a.known & b.known) | zeroA | zeroB,
    a.value & b.value,
    size,
    origins(size, (i) => (one(b, i) ? originOf(a, i) : one(a, i) ? originOf(b, i) : 0))
  );
}

export function or(a: Bits, b: Bits, size: number): Bits {
  const oneA = (a.known & a.value) >>> 0;
  const oneB = (b.known & b.value) >>> 0;
  // Where one side is a known zero the result is the other side's bit, which is
  // how `PHP` assembles seven flags into a byte without losing any of them.
  const zero = (x: Bits, i: number) => ((x.known >>> i) & 1) === 1 && ((x.value >>> i) & 1) === 0;
  return normalise(
    (a.known & b.known) | oneA | oneB,
    a.value | b.value,
    size,
    origins(size, (i) => (zero(b, i) ? originOf(a, i) : zero(a, i) ? originOf(b, i) : 0))
  );
}

export function xor(a: Bits, b: Bits, size: number): Bits {
  // Only against a known zero: against a known one the bit is inverted, which is
  // a different bit even though it is derived from this one.
  const zero = (x: Bits, i: number) => ((x.known >>> i) & 1) === 1 && ((x.value >>> i) & 1) === 0;
  return normalise(
    a.known & b.known,
    a.value ^ b.value,
    size,
    origins(size, (i) => (zero(b, i) ? originOf(a, i) : zero(a, i) ? originOf(b, i) : 0))
  );
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
  return normalise(
    ((a.known << n) | low) >>> 0,
    a.value << n,
    size,
    origins(size, (i) => (i >= n ? originOf(a, i - n) : 0))
  );
}

export function shiftRight(a: Bits, by: Bits, size: number): Bits {
  if ((by.known >>> 0) !== widthMask(1) && (by.known >>> 0) !== widthMask(4)) return unknown();
  const n = by.value;
  const width = 8 * size;
  if (n >= width) return exact(0, size);
  const mask = widthMask(size);
  // Bits shifted in at the top are known zeros.
  const high = (mask & ~(mask >>> n)) >>> 0;
  return normalise(
    (((a.known & mask) >>> n) | high) >>> 0,
    (a.value & mask) >>> n,
    size,
    origins(size, (i) => originOf(a, i + n))
  );
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
  return normalise((inner.known | added) >>> 0, inner.value, to, inner.origin);
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
  normalise(
    a.known >>> (8 * offset),
    a.value >>> (8 * offset),
    size,
    origins(size, (i) => originOf(a, i + 8 * offset))
  );

/** `high` above `low`, where `low` is `lowSize` bytes wide. */
export const concat = (high: Bits, low: Bits, lowSize: number, size: number): Bits =>
  normalise(
    ((high.known << (8 * lowSize)) | truncate(low, lowSize).known) >>> 0,
    ((high.value << (8 * lowSize)) | truncate(low, lowSize).value) >>> 0,
    size,
    origins(size, (i) =>
      i < 8 * lowSize ? originOf(low, i) : originOf(high, i - 8 * lowSize)
    )
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
  // An identity survives a join only where both paths carry the *same* one —
  // "still whatever it was" has to hold however you arrived.
  return normalise(
    agree,
    a.value,
    size,
    origins(size, (i) => {
      const tag = originOf(a, i);
      return tag !== 0 && tag === originOf(b, i) ? tag : 0;
    })
  );
}

export function same(a: Bits, b: Bits): boolean {
  if (a.known >>> 0 !== b.known >>> 0 || a.value >>> 0 !== b.value >>> 0) return false;
  if (a.origin === undefined && b.origin === undefined) return true;
  const length = Math.max(a.origin?.length ?? 0, b.origin?.length ?? 0);
  for (let i = 0; i < length; i++) if (originOf(a, i) !== originOf(b, i)) return false;
  return true;
}
