/**
 * The chips, on one bus.
 *
 * Installed on a `Machine`, this turns flat 64K into something a game can run
 * on: a raster line that advances, timers that fire, joysticks that read, and a
 * SID that records what it was told. Left off, the machine is exactly what it
 * was — which is what a decruncher needs and what every existing measurement
 * was taken against.
 *
 * **Colour RAM is deliberately not claimed.** `$D800-$DBFF` is a kilobyte of
 * static RAM rather than a chip, so letting it fall through to memory is not a
 * shortcut — it is what the hardware does, and it means a frame can be composed
 * out of the machine's own bytes with nothing special-cased.
 *
 * **Banking is not modelled.** These answer whenever they are installed, where a
 * real machine shows them only while I/O is banked in through `$01`. A program
 * that banks the character ROM in over `$D000` to read glyph data sees the VIC
 * here and would see the ROM there. That is the known half of the banking gap;
 * `docs/decisions/machine.md` has the rest.
 */

import { Device } from "../../il/interpret.js";
import { Cia, Joystick } from "./cia.js";
import { KEY_MATRIX, keyCode } from "./keyboard.js";
import { Sid } from "./sid.js";
import { Vic } from "./vic.js";

export { Vic, CYCLES_PER_FRAME, CYCLES_PER_LINE, LINES_PER_FRAME, PALETTE } from "./vic.js";
export { Cia } from "./cia.js";
export { KEY_MATRIX, KEY_NAMES, keyCode } from "./keyboard.js";
export { Sid } from "./sid.js";
export type { Joystick } from "./cia.js";
export type { SidWrite } from "./sid.js";

export class C64Bus implements Device {
  readonly vic = new Vic();
  readonly sid = new Sid();
  /** Input and the system clock. */
  readonly cia1 = new Cia(0xdc00);
  /** Here for the VIC bank bits, which decide where the screen is. */
  readonly cia2 = new Cia(0xdd00);

  private readonly chips = [this.vic, this.sid, this.cia1, this.cia2];

  /** Where the joysticks are pointed. Set by an input step, read by the ports. */
  get joystick1(): Joystick {
    return this.cia1.port1;
  }
  set joystick1(stick: Joystick) {
    this.cia1.port1 = stick;
  }
  get joystick2(): Joystick {
    return this.cia1.port2;
  }
  set joystick2(stick: Joystick) {
    this.cia1.port2 = stick;
  }

  /**
   * Which keys are held, by name.
   *
   * Setting replaces the whole set, the way pointing a joystick replaces where
   * it points — so `[]` releases everything and there is no separate release
   * call to forget. An unknown name is refused rather than dropped: a typo that
   * silently pressed nothing would look exactly like a program that ignores the
   * keyboard, which is a whole afternoon of looking in the wrong place.
   */
  get keys(): string[] {
    const names = new Map(Object.entries(KEY_MATRIX).map(([name, code]) => [code, name]));
    return [...this.cia1.keys].map((code) => names.get(code) ?? String(code));
  }
  set keys(held: readonly (string | number)[]) {
    const codes = held.map((key) => {
      const code = keyCode(key);
      if (code === undefined) throw new Error(`no such key: ${String(key)}`);
      return code;
    });
    this.cia1.keys.clear();
    for (const code of codes) this.cia1.keys.add(code);
  }

  /** Frames completed since the machine started. */
  get frames(): number {
    return this.vic.frames;
  }

  /** True while any chip is pulling the IRQ line low. */
  get irq(): boolean {
    return this.vic.irq || this.cia1.irq;
  }

  /**
   * CIA 2 pulls NMI rather than IRQ, which is a wiring fact rather than a
   * choice — it is why the RESTORE key and a timer on CIA 2 cannot be masked.
   */
  get nmi(): boolean {
    return this.cia2.irq;
  }

  tick(cycles: number): void {
    for (const chip of this.chips) chip.tick(cycles);
  }

  readByte(address: number): number | undefined {
    // Ordered by how often a running game touches each, and colour RAM is not
    // in the list on purpose.
    if (address < 0xd000 || address > 0xdfff) return undefined;
    for (const chip of this.chips) {
      const value = chip.readByte(address);
      if (value !== undefined) return value;
    }
    return undefined;
  }

  writeByte(address: number, value: number): boolean {
    if (address < 0xd000 || address > 0xdfff) return false;
    for (const chip of this.chips) {
      if (chip.writeByte(address, value)) return true;
    }
    return false;
  }

  /** Everything a checkpoint needs, so a resumed machine is the same machine. */
  snapshot(): Uint8Array {
    const parts = this.chips.map((chip) => chip.snapshot());
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const state = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
      state.set(part, at);
      at += part.length;
    }
    return state;
  }

  restore(state: Uint8Array): void {
    let at = 0;
    for (const chip of this.chips) {
      const size = chip.snapshot().length;
      chip.restore(state.subarray(at, at + size));
      at += size;
    }
  }
}
