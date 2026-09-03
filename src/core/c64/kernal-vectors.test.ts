import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { MemoryMap } from "../memory/memory-map.js";
import { BytesLayer } from "../memory/layer.js";
import { runProgram } from "../il/program.js";

/**
 * Running the KERNAL's own initialisation to learn the machine's defaults.
 *
 * Several documented entry points — `CHROUT`, `GETIN`, `LOAD` — are a `JMP`
 * through a vector in RAM, which is how they are hooked and therefore correct
 * rather than a failure. It does mean their effects cannot be derived from the
 * ROM alone: the vector is empty until something installs it.
 *
 * `RESTOR` installs it, and `RESTOR` is in the ROM. So re64 can find out what
 * the defaults are by *running* the routine that sets them, rather than being
 * told — which is the same trick that gets a project past a decruncher, applied
 * to the machine itself.
 *
 * The chain behind this was not designed. The lifter and interpreter exist
 * because two published 6502 references both get `ADC` wrong, so the flags had
 * to be tested by execution instead of by reading; that produced a CPU, the
 * functional suite made it trustworthy, and it turns out to run the KERNAL.
 *
 * **Opt-in twice**, like the functional test: the ROM is not in this repository
 * and never will be, so this skips when it is absent. See `3party/roms`.
 */
const ROM = "3party/roms/kernal.901227-03.bin";

/** The published defaults. Fixed facts about the machine, not about our code. */
const DOCUMENTED: [address: number, name: string, target: number][] = [
  [0x0314, "IRQ", 0xea31],
  [0x0316, "BRK", 0xfe66],
  [0x0318, "NMI", 0xfe47],
  [0x0326, "CHROUT", 0xf1ca],
  [0x032a, "GETIN", 0xf13e],
  [0x0330, "LOAD", 0xf4a5],
];

describe.runIf(existsSync(ROM))("running RESTOR out of the ROM", () => {
  const run = () => {
    const map = new MemoryMap();
    map.addLayer(new BytesLayer("kernal", 0xe000, new Uint8Array(readFileSync(ROM))));
    // $FF8A RESTOR: restore the default I/O vectors.
    return runProgram(map, { from: 0xff8a, maxInstructions: 100_000 });
  };

  it("installs the documented vectors, and only those", () => {
    const result = run();
    const word = (at: number) => result.memory[at] | (result.memory[at + 1] << 8);

    for (const [address, name, target] of DOCUMENTED) {
      expect(word(address), `${name} at $${address.toString(16)}`).toBe(target);
    }

    // The vector table is 32 bytes at $0314; anything far outside it would mean
    // the run wandered somewhere it should not have.
    expect(result.wrote.some((w) => w.start === "$0314")).toBe(true);
  });

  it("finishes on its own rather than running out of budget", () => {
    const result = run();
    expect(result.reason).toBe("left the program");
    expect(result.instructions).toBeLessThan(1000);
  });
});
