/**
 * Which of a program's origins are re-entered by the machine rather than by it.
 *
 * A dataflow pass has to know the difference. An origin reached from outside can
 * assume nothing; an interrupt handler is entered from *somewhere in this
 * program*, with everything the interrupted code had. Getting that wrong is not
 * merely imprecise — seeding a handler with "nothing is known" joins back into
 * the code it shares and destroys what the program's start had proved.
 *
 * Derived from the bytes rather than declared, which is the same stance taken
 * with the KERNAL's default vectors: the answer is in the project, so ask it.
 * Three sources, and a project may supply any, all or none of them.
 */

import { MemoryMap } from "../memory/memory-map.js";
import { OriginKind } from "../analysis/values.js";
import { REGISTER_NAMES } from "../il/run.js";
import { KERNAL_CLOBBERS } from "./kernal-effects.js";

/** The 6502's own vectors, at the top of memory. */
const NMI = 0xfffa;
const IRQ_BRK = 0xfffe;

/** The C64's, in RAM, which is where they are actually hooked. */
const CINV = 0x0314;
const CBINV = 0x0316;
const NMINV = 0x0318;

/** An autostart cartridge: two vectors then a signature. */
const CARTRIDGE_WARM = 0x8002;
const CARTRIDGE_SIGNATURE = 0x8004;
const CBM80 = [0xc3, 0xc2, 0xcd, 0x38, 0x30];

function wordAt(map: MemoryMap, address: number): number | undefined {
  const low = map.readByte(address);
  const high = map.readByte(address + 1);
  if (low === undefined || high === undefined) return undefined;
  return low | (high << 8);
}

/** Whether the cartridge autostart signature is present. */
export function hasCartridgeHeader(map: MemoryMap): boolean {
  return CBM80.every((byte, i) => map.readByte(CARTRIDGE_SIGNATURE + i) === byte);
}

export function classifyOrigins(map: MemoryMap): Map<number, OriginKind> {
  const kinds = new Map<number, OriginKind>();
  const claim = (address: number | undefined, kind: OriginKind) => {
    if (address === undefined) return;
    const held = kinds.get(address);
    // One routine serving two ways in is the ordinary case on this machine —
    // `BRK` and `IRQ` share `$FFFE` — and `B` is then undecidable, which is
    // precisely why a handler tests it.
    if (held && held !== kind) kinds.set(address, "interruptOrBrk");
    else kinds.set(address, kind);
  };

  // The hardware vectors, if a ROM is loaded. On a 6502 `$FFFE` serves both.
  claim(wordAt(map, NMI), "interrupt");
  claim(wordAt(map, IRQ_BRK), "interruptOrBrk");

  // The RAM vectors, which is where a C64 program actually hooks. Here the two
  // are separate, because the KERNAL's own handler reads `B` and dispatches.
  claim(wordAt(map, CINV), "interrupt");
  claim(wordAt(map, CBINV), "brk");
  claim(wordAt(map, NMINV), "interrupt");

  // A cartridge's warm start, which the NMI path reaches when RESTORE is
  // pressed. Its cold start is a genuine external entry and stays one.
  if (hasCartridgeHeader(map)) claim(wordAt(map, CARTRIDGE_WARM), "interrupt");

  return kinds;
}

/**
 * What calling an address in the ROM writes, for a project that has no ROM.
 *
 * Consulted only where the project supplies no bytes at all: if it loads its own
 * ROM, the real analysis is better, and it is right about *that* ROM rather than
 * about the one this table came from. `undefined` means the table cannot say,
 * which a caller must read as "assume anything" — an under-approximation here
 * would be believed.
 */
export function kernalClobbers(map: MemoryMap): (address: number) => readonly number[] | undefined {
  const byAddress = new Map(
    KERNAL_CLOBBERS.map((c) => {
      const offsets = c.writes
        .map((name) => REGISTER_OFFSETS[name])
        .filter((offset): offset is number => offset !== undefined);
      return [c.address, offsets] as const;
    })
  );
  return (address) => (map.readByte(address) === undefined ? byAddress.get(address) : undefined);
}

/** Register names as the generated table spells them, back to IL offsets. */
const REGISTER_OFFSETS: Record<string, number> = Object.fromEntries(
  REGISTER_NAMES.map((name, offset) => [name, offset])
);
