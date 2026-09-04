/**
 * Write the generated KERNAL effects module.
 *
 * `npm run gen:kernal`. The ROM is not in this repository and never will be; see
 * `3party/roms/README.md` for which file to supply. The generation itself lives
 * in `kernal-effects-source.ts` so a test can regenerate and compare without
 * writing anything.
 */

import { writeFileSync } from "node:fs";
import { generateKernalEffects } from "./kernal-effects-source.js";

const ROM = process.argv[2] ?? "3party/roms/kernal.901227-03.bin";
const OUT = "src/core/c64/kernal-effects.ts";

const result = generateKernalEffects(ROM);
writeFileSync(OUT, result.source);
console.log(
  `${OUT}: ${result.entries} entry points (${result.vectored} vectored) and ` +
    `${result.clobbers} routines' clobber sets, ` +
    `from ${result.instructions} instructions in ${result.routines} routines`
);
