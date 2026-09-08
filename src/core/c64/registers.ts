/**
 * What the bits of a hardware register mean.
 *
 * **The workaround this replaces is in this repository.** `symbols.ts` carries
 * bit meanings as English inside comment strings — "Bit 7 control messages, bit
 * 6 errors" — and `devices/vic.ts` hand-writes the mask and the shift ten times
 * over: `$D011 & $80` is the ninth raster bit, `$D018 >> 4 & $0F` is the screen
 * base, `$D018 >> 1 & $07` the character base. Every reader of a C64 program
 * does that arithmetic too, and it is exact arithmetic with one right answer,
 * which is the kind of thing a tool should do and a person should not.
 *
 * A register layout is a **record whose offsets count bits**, which is the same
 * noun the rest of the model already uses: named things at offsets, holes
 * legal. Nothing here is a special case except the fact that the machine
 * declares these rather than a person.
 *
 * **Platform-owned, so they are not in anybody's project.** These belong to the
 * machine the way `PLATFORM_SYMBOLS` does, and a reader who wants a register
 * named differently names it — the built-in is a fact about the hardware, not a
 * claim somebody made. Ids are fixed and prefixed `plat_`, so nothing can
 * collide with a declared type or be revised by an operation.
 *
 * Deliberately partial. These are the registers a program touches on every
 * frame, and the ones three runs of readers actually reached for; adding the
 * rest is data entry, and an empty entry is better than a guessed one.
 */

import { RecordType } from "../memory/type.js";

/** One register's bits, keyed by the address the hardware decodes it at. */
export interface RegisterLayout {
  readonly address: number;
  readonly type: RecordType;
}

const flag = (name: string, description?: string) => ({
  name,
  type: { is: "bits", width: 1 } as const,
  ...(description === undefined ? {} : { description }),
});

const run = (name: string, width: number, description?: string) => ({
  name,
  type: { is: "bits", width } as const,
  ...(description === undefined ? {} : { description }),
});

const register = (
  address: number,
  name: string,
  fields: RecordType["fields"],
  size = 1
): RegisterLayout => ({
  address,
  type: { id: `plat_${address.toString(16)}`, name, size, unit: "bits", fields },
});

/**
 * The registers with bit layouts worth having.
 *
 * Bit *n* is the one worth 2^*n*, which is how every datasheet numbers them —
 * so `rasterBit8` is at offset 7 and is the `$80` one.
 */
export const REGISTER_LAYOUTS: readonly RegisterLayout[] = [
  register(0xd011, "SCROLY", {
    0: run("yScroll", 3, "Vertical scroll, 0-7"),
    3: flag("rows25", "Set for 25 rows, clear for 24"),
    4: flag("displayEnable", "Clear blanks the display entirely"),
    5: flag("bitmapMode"),
    6: flag("extendedColour"),
    7: flag("rasterBit8", "The ninth bit of the raster compare in $D012"),
  }),
  register(0xd016, "SCROLX", {
    0: run("xScroll", 3, "Horizontal scroll, 0-7"),
    3: flag("columns40", "Set for 40 columns, clear for 38"),
    4: flag("multicolour"),
    5: flag("reset", "Stops the video counters"),
  }),
  register(0xd018, "VMCSB", {
    // Both are counted in the units the hardware fetches in, which is exactly
    // the arithmetic `vic.ts` writes out by hand: the screen base is this
    // field times $400, the character base is its field times $800.
    1: run("charBase", 3, "Character base, in units of $800 within the VIC bank"),
    4: run("screenBase", 4, "Screen base, in units of $400 within the VIC bank"),
  }),
  register(0xd019, "VICIRQ", {
    0: flag("raster", "The raster compare in $D012 was reached"),
    1: flag("spriteBackground"),
    2: flag("spriteSprite"),
    3: flag("lightPen"),
    7: flag("any", "Set while any enabled source is asserting"),
  }),
  register(0xd01a, "IRQMASK", {
    0: flag("raster"),
    1: flag("spriteBackground"),
    2: flag("spriteSprite"),
    3: flag("lightPen"),
  }),
  // The sprite registers are eight of the same thing, which is what an array
  // field is for — one bit per sprite, and the sprite number indexes it.
  register(0xd015, "SPENA", { 0: run("enabled", 8, "One bit per sprite, 0 to 7") }),
  register(0xd017, "YXPAND", { 0: run("doubleHeight", 8, "One bit per sprite") }),
  register(0xd01b, "SPBGPR", { 0: run("behindBackground", 8, "One bit per sprite") }),
  register(0xd01c, "SPMC", { 0: run("multicolour", 8, "One bit per sprite") }),
  register(0xd01d, "XXPAND", { 0: run("doubleWidth", 8, "One bit per sprite") }),
  register(0xd010, "MSIGX", { 0: run("xBit8", 8, "The ninth X bit of each sprite") }),
  register(0xd01e, "SPSPCL", { 0: run("hit", 8, "One bit per sprite; reading clears it") }),
  register(0xd01f, "SPBGCL", { 0: run("hit", 8, "One bit per sprite; reading clears it") }),
  // $DD00 is why a screen at $0400 is not always at $0400: the VIC sees a 16K
  // window chosen here, and the two bits are *inverted*.
  register(0xdd00, "CI2PRA", {
    0: run("vicBank", 2, "Inverted: 0 selects $C000, 3 selects $0000"),
    2: flag("rs232Txd"),
    3: flag("serialAtnOut"),
    4: flag("serialClockOut"),
    5: flag("serialDataOut"),
    6: flag("serialClockIn"),
    7: flag("serialDataIn"),
  }),
  register(0x0001, "R6510", {
    0: run("banking", 3, "LORAM, HIRAM, CHAREN"),
    3: flag("cassetteWrite"),
    4: flag("cassetteSense"),
    5: flag("cassetteMotor"),
  }),
];

const byAddress = new Map(REGISTER_LAYOUTS.map((r) => [r.address, r]));

/** The layout the machine declares for this address, if it declares one. */
export function registerAt(address: number): RegisterLayout | undefined {
  return byAddress.get(address & 0xffff);
}

/**
 * Which fields of a register a mask touches, named.
 *
 * The question `AND #$80` asks, and the answer a reader writes into a comment
 * by hand: `$D011 AND $80` is `SCROLY.rasterBit8`. Every field the mask reaches
 * *any* bit of, because a mask that takes half a field has still touched it and
 * saying "none" would be worse than saying which.
 */
export function fieldsInMask(address: number, mask: number): string[] {
  const found = registerAt(address);
  if (!found) return [];
  const out: { offset: number; name: string }[] = [];
  for (const [key, field] of Object.entries(found.type.fields)) {
    const offset = Number(key);
    const width = field.type.is === "bits" ? field.type.width : 8;
    let touched = 0;
    for (let b = offset; b < offset + width; b++) touched |= (mask >>> b) & 1;
    if (touched) out.push({ offset, name: `${found.type.name}.${field.name}` });
  }
  // High bit first, which is the order the mask is written in.
  return out.sort((a, b) => b.offset - a.offset).map((f) => f.name);
}
