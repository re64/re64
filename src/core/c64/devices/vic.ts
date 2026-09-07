/**
 * The VIC-II, as far as running a game needs it.
 *
 * **A raster counter and an interrupt, not a renderer.** What a program needs
 * from the VIC to *run* is: a raster line that advances, a compare register that
 * fires when it matches, and the two pointers saying where the screen and the
 * character set are. What it needs to be *drawn* correctly is a different and
 * much larger thing — badlines, sprite DMA stealing cycles, the pixel pipeline —
 * and none of that changes what the program does, only what a photograph of it
 * looks like at the edges.
 *
 * So the cut is: enough to put a raster interrupt in the right scanline and to
 * find the screen. `docs/decisions/machine.md` records what is left out.
 */

import { Device } from "../../il/interpret.js";

/**
 * PAL timing, which is what a European C64 game was written against.
 *
 * 63 cycles a line and 312 lines, so a frame is 19,656 cycles and the machine
 * runs at 50.125Hz. An NTSC machine is 65×263, and a game written for one and
 * run on the other is the classic reason a demo runs at the wrong speed — worth
 * knowing before this grows a switch.
 */
export const CYCLES_PER_LINE = 63;
export const LINES_PER_FRAME = 312;
export const CYCLES_PER_FRAME = CYCLES_PER_LINE * LINES_PER_FRAME;

/** Where the VIC answers. */
const FIRST = 0xd000;
const LAST = 0xd3ff;

/** The sixteen colours, as the machine mixes them. */
export const PALETTE: readonly string[] = [
  "#000000", "#ffffff", "#813338", "#75cec8", "#8e3c97", "#56ac4d", "#2e2c9b", "#edf171",
  "#8e5029", "#553800", "#c46c71", "#4a4a4a", "#7b7b7b", "#a9ff9f", "#706deb", "#b2b2b2",
];

/**
 * One sprite's registers, gathered.
 *
 * `x` and `y` are the chip's own coordinates, not the screen's: the top-left of
 * the 40x25 display is (24, 50), because a sprite may sit in the border and the
 * counter has to reach there.
 */
export interface Sprite {
  index: number;
  enabled: boolean;
  x: number;
  y: number;
  colour: number;
  multicolour: boolean;
  expandX: boolean;
  expandY: boolean;
  /** True when foreground graphics cover the sprite rather than the other way round. */
  behind: boolean;
}

export class Vic implements Device {
  /** Registers as written, so a read of one nothing models gives it back. */
  private readonly registers = new Uint8Array(0x40);

  /** Cycles into the current frame, which is what the raster line is made of. */
  private cycle = 0;

  /** Frames completed, so a caller can run "for 300 frames" without counting. */
  frames = 0;

  /** `$D019` — what has fired and not yet been acknowledged. */
  private latch = 0;

  /** The raster line the compare last fired on, so it fires once per frame. */
  private firedOn = -1;

  /** Where in the frame the beam is. */
  get raster(): number {
    return Math.floor(this.cycle / CYCLES_PER_LINE);
  }

  /** The line `$D012` and `$D011` bit 7 together ask for. */
  get compare(): number {
    return this.registers[0x12] | ((this.registers[0x11] & 0x80) << 1);
  }

  /** Screen memory, relative to the VIC's 16K bank. */
  get screenBase(): number {
    return ((this.registers[0x18] >> 4) & 0x0f) * 0x400;
  }

  /** Character generator base, relative to the same bank. */
  get characterBase(): number {
    return ((this.registers[0x18] >> 1) & 0x07) * 0x800;
  }

  get borderColour(): number {
    return this.registers[0x20] & 0x0f;
  }

  get backgroundColour(): number {
    return this.registers[0x21] & 0x0f;
  }

  /**
   * The eight sprites, as the chip would draw them.
   *
   * Every one of these registers was already being written and none was ever
   * read, which is the shape this project keeps getting caught by: the state was
   * complete and no consumer reached it. The cost was a picture that was
   * *almost* faithful — a camel drawn at half its size because nothing looked at
   * `$D017` and `$D01D`.
   */
  get sprites(): readonly Sprite[] {
    const enabled = this.registers[0x15];
    const expandY = this.registers[0x17];
    const behind = this.registers[0x1b];
    const multicolour = this.registers[0x1c];
    const expandX = this.registers[0x1d];
    const high = this.registers[0x10];

    return Array.from({ length: 8 }, (_unused, index) => ({
      index,
      enabled: (enabled & (1 << index)) !== 0,
      // Nine bits: the low eight in the sprite's own register, the ninth shared
      // across all of them in `$D010`, which is what lets a sprite reach $1FF.
      x: this.registers[index * 2] | (high & (1 << index) ? 0x100 : 0),
      y: this.registers[index * 2 + 1],
      colour: this.registers[0x27 + index] & 0x0f,
      multicolour: (multicolour & (1 << index)) !== 0,
      expandX: (expandX & (1 << index)) !== 0,
      expandY: (expandY & (1 << index)) !== 0,
      behind: (behind & (1 << index)) !== 0,
    }));
  }

  /** The two colours every multicolour sprite shares, `$D025` and `$D026`. */
  get spriteMulticolour(): readonly [number, number] {
    return [this.registers[0x25] & 0x0f, this.registers[0x26] & 0x0f];
  }

  /** True while the VIC is pulling the IRQ line low. */
  get irq(): boolean {
    return (this.latch & this.registers[0x1a] & 0x0f) !== 0;
  }

  /**
   * Advance the beam, firing the raster compare as it passes.
   *
   * Cycles rather than instructions, which is the whole reason the opcode table
   * grew a `cycles` column: a raster interrupt has to land in the scanline the
   * program asked for, and an instruction count drifts by a factor of three or
   * four depending on what the code happens to be doing.
   */
  tick(cycles: number): void {
    for (let spent = 0; spent < cycles; spent++) {
      this.cycle += 1;
      if (this.cycle >= CYCLES_PER_FRAME) {
        this.cycle = 0;
        this.frames += 1;
        this.firedOn = -1;
      }
      const line = this.raster;
      if (line === this.compare && line !== this.firedOn) {
        this.firedOn = line;
        this.latch |= 0x01;
      }
    }
  }

  readByte(address: number): number | undefined {
    if (address < FIRST || address > LAST) return undefined;
    // $D000-$D3FF is the 47 registers repeating every 64 bytes.
    const at = (address - FIRST) & 0x3f;

    // The raster line, which is the register no observer could ever supply and
    // the reason a device bus exists at all.
    if (at === 0x12) return this.raster & 0xff;
    if (at === 0x11) return (this.registers[0x11] & 0x7f) | ((this.raster >> 1) & 0x80);
    // Bits nothing drives read as set, which is what a program testing for a
    // VIC finds on real hardware.
    if (at === 0x19) return this.latch | 0x70;
    if (at === 0x1a) return this.registers[0x1a] | 0xf0;
    if (at >= 0x2f) return 0xff;
    return this.registers[at];
  }

  writeByte(address: number, value: number): boolean {
    if (address < FIRST || address > LAST) return false;
    const at = (address - FIRST) & 0x3f;

    // `$D019` acknowledges by writing a one to the bit being cleared, which is
    // the opposite of what it looks like and the usual reason a handler fires
    // for ever: a program that writes `$00` here clears nothing.
    if (at === 0x19) {
      this.latch &= ~value & 0x0f;
      return true;
    }
    this.registers[at] = value & 0xff;
    return true;
  }

  /** Everything a checkpoint has to carry, so a resumed machine is the same one. */
  snapshot(): Uint8Array {
    const state = new Uint8Array(this.registers.length + 12);
    state.set(this.registers, 0);
    const view = new DataView(state.buffer, this.registers.length);
    view.setUint32(0, this.cycle);
    view.setUint32(4, this.frames);
    view.setUint16(8, this.latch);
    view.setInt16(10, this.firedOn);
    return state;
  }

  restore(state: Uint8Array): void {
    this.registers.set(state.subarray(0, this.registers.length));
    const view = new DataView(
      state.buffer,
      state.byteOffset + this.registers.length,
      12
    );
    this.cycle = view.getUint32(0);
    this.frames = view.getUint32(4);
    this.latch = view.getUint16(8);
    this.firedOn = view.getInt16(10);
  }
}
