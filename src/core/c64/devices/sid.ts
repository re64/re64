/**
 * The SID, as a log of what was written to it.
 *
 * **Deliberately not a synthesiser.** Producing sound is a large piece of work
 * with a great deal to be right about — filters, the combined waveforms, the
 * ADSR bug — and none of it answers the question anybody reverse engineering a
 * game actually asks, which is *which routine makes that noise*. A timestamped
 * register-write trace answers exactly that, and it answers it better than audio
 * would: you can diff two runs.
 *
 * **Superseded in one direction, and the original still holds.** A capture is
 * still a log, for every reason above — it is what answers "which routine makes
 * that noise", and you can diff two runs of it. What changed is that a second
 * question turned up which a log does not answer: experiment 9's deliverable
 * was an article, and there the question is also *what did it sound like*.
 * `src/core/c64/sid-audio.ts` renders one, and is careful to say what it
 * transcribes and what it invents. Nothing about this file moved.
 *
 * Read-back is the honest gap. Three registers on a real SID return something
 * useful — the oscillator and envelope of voice 3, and the two paddle inputs —
 * and a program that reads `$D41B` for a random number gets a real value on
 * hardware. That one is common enough to be worth saying out loud rather than
 * returning zero and letting a game's randomness quietly die.
 */

import { Device } from "../../il/interpret.js";

const FIRST = 0xd400;
const LAST = 0xd7ff;

/** One write, with the cycle it happened on. */
export interface SidWrite {
  /** Cycles since the run began, so two runs can be lined up. */
  cycle: number;
  /** The register, `$00`-`$1C`, rather than the absolute address. */
  register: number;
  value: number;
}

export class Sid implements Device {
  private readonly registers = new Uint8Array(0x20);
  private cycle = 0;

  /** Every write, in order. This is the capture. */
  readonly writes: SidWrite[] = [];

  /** Addresses read that this does not model, so a run can say it leaned on one. */
  readonly unmodelledReads = new Set<number>();

  tick(cycles: number): void {
    this.cycle += cycles;
  }

  /** The SID never pulls the interrupt line. */
  get irq(): boolean {
    return false;
  }

  readByte(address: number): number | undefined {
    if (address < FIRST || address > LAST) return undefined;
    const at = (address - FIRST) & 0x1f;
    // The three that mean something on hardware. Returning zero is a lie a
    // program built on `$D41B` for entropy would act on, so it is recorded.
    if (at === 0x19 || at === 0x1a || at === 0x1b || at === 0x1c) {
      this.unmodelledReads.add(address);
      return 0x00;
    }
    // Write-only registers read as the last thing on the bus; zero is as good
    // an answer as any and no program should depend on it.
    return 0x00;
  }

  writeByte(address: number, value: number): boolean {
    if (address < FIRST || address > LAST) return false;
    const register = (address - FIRST) & 0x1f;
    this.registers[register] = value & 0xff;
    this.writes.push({ cycle: this.cycle, register, value: value & 0xff });
    return true;
  }

  snapshot(): Uint8Array {
    // The write log is a *capture*, not machine state: resuming from a
    // checkpoint continues the program, and the log of what it played before
    // the checkpoint belongs to the run that produced it.
    const state = new Uint8Array(this.registers.length + 4);
    state.set(this.registers, 0);
    new DataView(state.buffer, this.registers.length).setUint32(0, this.cycle);
    return state;
  }

  restore(state: Uint8Array): void {
    this.registers.set(state.subarray(0, this.registers.length));
    this.cycle = new DataView(
      state.buffer,
      state.byteOffset + this.registers.length,
      4
    ).getUint32(0);
  }
}
