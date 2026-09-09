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
 *
 * The SID's three voices are the same seven registers three times over, so they
 * are generated from the voice number rather than typed out — and the names
 * carry it, because `SIDCTRL2.gate` should not be ambiguous about which voice.
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
  // **The SID, and its three voices are the same seven registers three times.**
  // `sid-audio.ts` is the oracle for these the way `vic.ts` is for the VIC: it
  // decodes them to render a tune, so a layout that disagreed with it would be
  // wrong about a chip this repository can already play.
  //
  // Voice *n* sits at `$D400 + 7n`, which is why these are generated rather than
  // typed out three times — and why the names carry the voice number: a claim
  // naming `SIDVOICE1.gate` should not be ambiguous about which voice.
  ...[1, 2, 3].flatMap((voice) => {
    const base = 0xd400 + (voice - 1) * 7;
    return [
      register(base + 4, `SIDCTRL${voice}`, {
        0: flag("gate", "Starts the attack; clearing it starts the release"),
        1: flag("sync", "Hard-sync this voice's oscillator to the previous one"),
        2: flag("ringMod", "Ring-modulate the triangle with the previous voice"),
        3: flag("test", "Silences and resets the oscillator"),
        4: flag("triangle"),
        5: flag("sawtooth"),
        6: flag("pulse", "Width from the two registers at +2 and +3"),
        7: flag("noise"),
      }),
      register(base + 5, `SIDAD${voice}`, {
        0: run("decay", 4, "0-15, a table not a scale: $0 is 6ms and $F is 24s"),
        4: run("attack", 4, "0-15, likewise: $0 is 2ms and $F is 8s"),
      }),
      register(base + 6, `SIDSR${voice}`, {
        0: run("release", 4, "0-15, the same table as decay"),
        4: run("sustain", 4, "0-15 as a *level*, not a time"),
      }),
      register(base + 3, `SIDPWHI${voice}`, {
        0: run("pulseWidthHigh", 4, "The top four bits of a twelve-bit width"),
      }),
    ];
  }),
  register(0xd415, "SIDFCLO", { 0: run("cutoffLow", 3, "Only three bits; the rest read as 0") }),
  register(0xd417, "SIDRESFILT", {
    0: flag("filterVoice1"),
    1: flag("filterVoice2"),
    2: flag("filterVoice3"),
    3: flag("filterExternal"),
    4: run("resonance", 4),
  }),
  register(0xd418, "SIDVOLFILT", {
    0: run("volume", 4, "0-15, master"),
    4: flag("lowPass"),
    5: flag("bandPass"),
    6: flag("highPass"),
    7: flag("voice3Off", "Silences voice 3 so it can drive something else"),
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
