/**
 * Write `src/core/c64/basic-effects.ts` from the ROMs.
 *
 * The generation itself is in `basic-effects-source.ts`, split out so a test can
 * regenerate and compare rather than trusting a committed file to have stayed in
 * step with the ROM it came from — the same arrangement `gen:kernal` has, and
 * for the same reason: a generated file that is committed goes stale in silence.
 */

import { writeFileSync } from "node:fs";
import { generateBasicEffects } from "./basic-effects-source.js";

const BASIC = process.argv[2] ?? "3party/roms/basic.901226-01.bin";
const KERNAL = process.argv[3] ?? "3party/roms/kernal.901227-03.bin";
const OUT = "src/core/c64/basic-effects.ts";

const { source, rows, routines, instructions, clobbers } = generateBasicEffects(BASIC, KERNAL);
writeFileSync(OUT, source, "utf-8");

// eslint-disable-next-line no-console
console.log(
  `${OUT}: ${rows} keyword routines, from ${routines} routines and ` +
    `${instructions} instructions across both ROMs; ${clobbers} routines with a clobber set`
);
