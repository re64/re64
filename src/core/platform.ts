/**
 * The seam where a machine's own knowledge enters otherwise neutral code.
 *
 * Most of what re64 is made of has nothing to do with the Commodore 64. The
 * claims model, the operation algebra, the CRDT, the row model, the P-Code
 * lifter, the abstract domain, the block and effect analyses and the scenario
 * runner are all facts about programs, or at most about a 6502. What is
 * genuinely C64 is a comparatively thin shell: where the screen is, what a
 * sprite is, which chips answer at which addresses, what a byte means as text.
 *
 * That shell has been reached for directly from neutral code in several places
 * — `claims/model.ts` imports the platform's text encodings, `project/loader.ts`
 * its symbol table, `analysis/program.ts` its interrupt vectors — and each was
 * the shortest path at the time. This file is not a retrofit of all of them; it
 * is the place the *next* one goes, so the count stops growing while nobody is
 * looking, and so a second machine has somewhere to arrive.
 *
 * **One implementation today, and saying so is the point.** A seam with one
 * implementation is honest scaffolding; a seam pretending to be an abstraction
 * is worse than the direct import it replaced.
 */

import { parseGeometry } from "./c64/geometry.js";

/**
 * A place written the way the machine talks about it, as an address.
 *
 * Every tool shares one address schema, so this reaches all of them at once —
 * which is exactly why it must not reach into a platform directly. The C64's
 * forms are `screen(row,column)`, `screen(cell)` and `sprite(pointer)`; another
 * machine's would be different words about different hardware, and the point of
 * routing through here is that the address parser never learns which machine it
 * is talking about.
 *
 * Returns `undefined` for anything that is not a place, so an ordinary `$8100`
 * falls through untouched. Throws when the text *is* a place and the place does
 * not exist — `screen(99,0)` — because that is a fact about the request.
 */
export function parsePlace(text: string): number | undefined {
  return parseGeometry(text);
}
