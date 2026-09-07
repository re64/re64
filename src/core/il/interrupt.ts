/**
 * Entering an interrupt, which is a thing the hardware does rather than an
 * instruction the program runs.
 *
 * This was the actual missing capability. `runProgram` could execute a whole
 * decruncher and still not run a *game*, because a C64 game's main loop is a
 * raster interrupt: experiment 8 reached the Gridrunner title screen — which is
 * the initialisation path — and stopped, and reported the screen as an inference
 * rather than a photograph.
 *
 * Deliberately not lifted to P-Code. Every operation in `lift.ts` describes what
 * an *instruction* means, and nothing fetched this one; modelling it there would
 * invent an instruction the machine does not have. `RTI` is a real instruction
 * and stays lifted, which is why only the entry lives here.
 */

import { Machine } from "./interpret.js";
import { REG } from "./pcode.js";

/** Which line was raised. */
export type InterruptLine = "irq" | "nmi";

/**
 * Where the processor looks, and how each may be refused.
 *
 * `NMI` is non-maskable, which is the whole of the difference: `I` stops an IRQ
 * and has no bearing on an NMI. Gridrunner's warm start is reached through NMI,
 * which `core/c64/entry-vectors.ts` already derives from the cartridge header.
 */
const VECTOR: Record<InterruptLine, number> = { irq: 0xfffe, nmi: 0xfffa };

/** What entering one costs. The processor spends these before the handler runs. */
export const INTERRUPT_CYCLES = 7;

/**
 * Take the interrupt, or say it was masked.
 *
 * Returns false only for an IRQ arriving with `I` set — a caller raising a line
 * every frame needs to know whether the machine actually went, or a program that
 * disables interrupts for a critical section looks like one whose handler does
 * nothing.
 */
export function deliverInterrupt(machine: Machine, line: InterruptLine): boolean {
  if (line === "irq" && machine.register(REG.I)) return false;

  const returnTo = machine.pc;
  push(machine, (returnTo >> 8) & 0xff);
  push(machine, returnTo & 0xff);

  // **B clear, bit 5 set.** `B` is not stored anywhere on this machine: it
  // exists only as bit four of the byte a push produces, and it is what a
  // handler tests to tell a `BRK` from an interrupt. `statusByte` in `lift.ts`
  // ORs `0x30` for `PHP` and `BRK`; this is the same byte with bit four left
  // out, which is the one thing that distinguishes the two entries.
  push(machine, status(machine) | 0x20);

  // Set *after* the push, so the handler's own `PLP`/`RTI` restores the flag as
  // the interrupted code had it rather than as this entry left it.
  machine.set({ space: "register", offset: REG.I, size: 1 }, 1);

  // Read through the machine, so a device answering in `$FFxx` is honoured —
  // and so a project that loads no ROM reads whatever its layers supply, which
  // is the honest answer rather than a hardcoded address.
  machine.pc = machine.read(VECTOR[line], 2);
  return true;
}

/** The flags gathered as `PHP` gathers them, minus what the push decides. */
function status(machine: Machine): number {
  return (
    (machine.register(REG.C) ? 0x01 : 0) |
    (machine.register(REG.Z) ? 0x02 : 0) |
    (machine.register(REG.I) ? 0x04 : 0) |
    (machine.register(REG.D) ? 0x08 : 0) |
    (machine.register(REG.V) ? 0x40 : 0) |
    (machine.register(REG.N) ? 0x80 : 0)
  );
}

/** Write at the pointer, then step it down — the order the lifter's `push` uses. */
function push(machine: Machine, value: number): void {
  const sp = machine.register(REG.SP) & 0xff;
  machine.write(0x0100 + sp, value & 0xff, 1);
  machine.set({ space: "register", offset: REG.SP, size: 1 }, (sp - 1) & 0xff);
}
