/**
 * The two CIAs, as far as running a game needs them.
 *
 * CIA 1 at `$DC00` is input and the system clock: the keyboard matrix, the two
 * joystick ports, and Timer A, which the KERNAL programs to fire sixty times a
 * second to advance the jiffy clock and scan the keyboard. A program that calls
 * the KERNAL at all needs it, and a program that reads a joystick needs the
 * ports whether it calls the KERNAL or not.
 *
 * CIA 2 at `$DD00` is here for two bits. `$DD00` bits 0-1 select which 16K bank
 * the VIC sees, and without them the screen pointer means nothing — a game that
 * moves its screen to `$4000` looks blank. The serial bus and RS-232 halves are
 * not modelled.
 */

import { Device } from "../../il/interpret.js";

/** Which way a joystick is pushed. Active *low*, as the hardware reads it. */
export interface Joystick {
  up?: boolean;
  down?: boolean;
  left?: boolean;
  right?: boolean;
  fire?: boolean;
}

const BITS: (keyof Joystick)[] = ["up", "down", "left", "right", "fire"];

/** A joystick as the port reads it: a pushed direction pulls its bit low. */
function portBits(stick: Joystick): number {
  let value = 0xff;
  BITS.forEach((direction, bit) => {
    if (stick[direction]) value &= ~(1 << bit);
  });
  return value & 0xff;
}

export class Cia implements Device {
  /**
   * Ones, not zeros.
   *
   * A port bit nothing drives reads **high**: the lines are pulled up, and a
   * joystick works by pulling one down. Starting these at zero reads as every
   * direction pushed at once, which a game acts on happily — and it inverts
   * CIA 2's bank bits, so the VIC looks at `$C000` and the screen composes
   * blank.
   */
  private readonly registers = new Uint8Array(0x10).fill(0xff);

  /** Timer A, which the KERNAL runs at 60Hz to drive everything periodic. */
  private timerA = 0;
  private latchA = 0;
  private runningA = false;

  /** `$DC0D` — what has fired, and what is allowed to. */
  private latch = 0;
  private mask = 0;

  /** Port 2 is `$DC00`, port 1 is `$DC01`. Games differ about which they read. */
  port2: Joystick = {};
  port1: Joystick = {};

  /**
   * Which keys are held, as matrix positions.
   *
   * Held rather than typed, exactly as a joystick is held: the machine has no
   * notion of a keystroke, only of a grid that is being scanned sixty times a
   * second. Pressing and releasing is therefore two changes with a run between
   * them — which is not a limitation to work around but the thing a program's
   * own debounce is written against, and the reason Camels' cheat needs four
   * separate presses rather than four codes in a row.
   *
   * CIA 2 has no keyboard and needs no special case: nothing puts anything in
   * its set, so the scan below finds nothing there.
   */
  readonly keys = new Set<number>();

  constructor(private readonly first: number) {}

  /**
   * Columns pulled low by the keys in the rows this select drives.
   *
   * Active low throughout: a row is *selected* by writing a zero to its bit,
   * and a key that is down pulls its column's bit to zero. Reading this as
   * active high gives a machine where holding nothing types everything, which
   * is the same mistake the pull-ups above exist to prevent.
   */
  private keyColumns(select: number): number {
    let value = 0xff;
    for (const code of this.keys) {
      if (!(select & (1 << (code >> 3)))) value &= ~(1 << (code & 7));
    }
    return value & 0xff;
  }

  /**
   * The same scan the other way round, which real programs do use.
   *
   * Driving port B and reading port A is how a program asks "is *any* key in
   * this column down" — the KERNAL does it to find shift, and a game does it to
   * avoid a full scan. Modelling only the usual direction would make those
   * read as no key at all, which is indistinguishable from a keyboard that
   * does not work.
   */
  private keyRows(select: number): number {
    let value = 0xff;
    for (const code of this.keys) {
      if (!(select & (1 << (code & 7)))) value &= ~(1 << (code >> 3));
    }
    return value & 0xff;
  }

  /** The 16K bank the VIC sees, from CIA 2's port A. Inverted, as the wiring is. */
  get vicBank(): number {
    return (~this.registers[0x00] & 0x03) * 0x4000;
  }

  get irq(): boolean {
    return (this.latch & this.mask & 0x1f) !== 0;
  }

  tick(cycles: number): void {
    if (!this.runningA) return;
    for (let spent = 0; spent < cycles; spent++) {
      this.timerA -= 1;
      if (this.timerA >= 0) continue;
      // Underflow reloads from the latch and flags the interrupt. This is what
      // makes the KERNAL's jiffy clock advance, so a program that waits on
      // `$A2` never finishes without it.
      this.timerA = this.latchA;
      this.latch |= 0x01;
    }
  }

  readByte(address: number): number | undefined {
    if (address < this.first || address > this.first + 0xff) return undefined;
    const at = (address - this.first) & 0x0f;

    switch (at) {
      case 0x00:
        // Port A: joystick 2, and the keyboard read backwards — port B selects,
        // port A answers. Everything on these lines is wired together and pulls
        // the same bits down, so an AND is the wiring rather than a convention.
        return this.registers[0x00] & portBits(this.port2) & this.keyRows(this.registers[0x01]);
      case 0x01:
        // Port B: joystick 1, and the ordinary keyboard scan. This is the one
        // that shares a register with a joystick, which is why a game read
        // while a stick is pushed sees keys that are not down — true of the
        // hardware, and the reason C64 games ask you to unplug port 2.
        return this.registers[0x01] & portBits(this.port1) & this.keyColumns(this.registers[0x00]);
      case 0x04:
        return this.timerA & 0xff;
      case 0x05:
        return (this.timerA >> 8) & 0xff;
      case 0x0d: {
        // **Reading acknowledges**, which is the part that catches people: the
        // KERNAL's handler reads `$DC0D` and that is what stops the interrupt
        // re-firing for ever. Bit 7 says whether any enabled source fired.
        const value = this.latch | (this.irq ? 0x80 : 0);
        this.latch = 0;
        return value;
      }
      default:
        return this.registers[at];
    }
  }

  writeByte(address: number, value: number): boolean {
    if (address < this.first || address > this.first + 0xff) return false;
    const at = (address - this.first) & 0x0f;
    const byte = value & 0xff;

    switch (at) {
      case 0x04:
        this.latchA = (this.latchA & 0xff00) | byte;
        return true;
      case 0x05:
        this.latchA = (this.latchA & 0x00ff) | (byte << 8);
        // Writing the high byte loads the timer when it is stopped, which is
        // how a program sets a period before starting it.
        if (!this.runningA) this.timerA = this.latchA;
        return true;
      case 0x0d:
        // Bit 7 says whether the other bits set or clear the mask, rather than
        // the byte being the mask — so `$81` enables Timer A and `$01` disables
        // it, and a program that writes `$7F` first is turning everything off.
        if (byte & 0x80) this.mask |= byte & 0x1f;
        else this.mask &= ~byte & 0x1f;
        return true;
      case 0x0e:
        this.runningA = (byte & 0x01) !== 0;
        if (byte & 0x10) this.timerA = this.latchA;
        this.registers[at] = byte;
        return true;
      default:
        this.registers[at] = byte;
        return true;
    }
  }

  snapshot(): Uint8Array {
    const state = new Uint8Array(this.registers.length + 24);
    state.set(this.registers, 0);
    const view = new DataView(state.buffer, this.registers.length);
    view.setInt32(0, this.timerA);
    view.setUint32(4, this.latchA);
    view.setUint16(8, this.latch);
    view.setUint16(10, this.mask);
    view.setUint8(12, this.runningA ? 1 : 0);
    // Held keys are input state, like a joystick, so a checkpoint has to carry
    // them: sixty-four positions as eight bytes. Leaving them out would make a
    // resumed run release every key at the moment it resumed, which is a
    // difference the caller never asked for and could not see.
    for (const code of this.keys) {
      const byte = 16 + (code >> 3);
      view.setUint8(byte, view.getUint8(byte) | (1 << (code & 7)));
    }
    return state;
  }

  restore(state: Uint8Array): void {
    this.registers.set(state.subarray(0, this.registers.length));
    const view = new DataView(state.buffer, state.byteOffset + this.registers.length, 24);
    this.timerA = view.getInt32(0);
    this.latchA = view.getUint32(4);
    this.latch = view.getUint16(8);
    this.mask = view.getUint16(10);
    this.runningA = view.getUint8(12) === 1;
    this.keys.clear();
    for (let row = 0; row < 8; row++) {
      const bits = view.getUint8(16 + row);
      for (let column = 0; column < 8; column++) {
        if (bits & (1 << column)) this.keys.add(row * 8 + column);
      }
    }
  }
}
