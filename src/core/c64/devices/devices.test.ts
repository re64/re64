import { describe, it, expect } from "vitest";
import { C64Bus, CYCLES_PER_FRAME, CYCLES_PER_LINE } from "./index.js";
import { Machine } from "../../il/interpret.js";

/**
 * The chips, and the things about them that a program depends on.
 *
 * Each of these is a case where getting it wrong produces a machine that looks
 * like it is working: an interrupt that fires for ever, a joystick that reads as
 * pushed in every direction, a screen pointer that means nothing.
 */

describe("the VIC's raster", () => {
  it("advances with cycles rather than instructions", () => {
    // The whole reason the opcode table grew a `cycles` column. An instruction
    // count drifts by a factor of three or four depending on what the code is
    // doing, so a raster interrupt would land in a different scanline every
    // frame.
    const bus = new C64Bus();
    expect(bus.vic.raster).toBe(0);
    bus.tick(CYCLES_PER_LINE);
    expect(bus.vic.raster).toBe(1);
    bus.tick(CYCLES_PER_LINE * 9);
    expect(bus.vic.raster).toBe(10);
  });

  it("wraps at the bottom of the frame and counts one", () => {
    const bus = new C64Bus();
    bus.tick(CYCLES_PER_FRAME - 1);
    expect(bus.frames).toBe(0);
    bus.tick(1);
    expect(bus.frames).toBe(1);
    expect(bus.vic.raster).toBe(0);
  });

  it("reads back the line the beam is on, which no observer could supply", () => {
    const bus = new C64Bus();
    bus.tick(CYCLES_PER_LINE * 100);
    expect(bus.readByte(0xd012)).toBe(100);
    // Line 300 needs the ninth bit, which lives in $D011.
    bus.tick(CYCLES_PER_LINE * 200);
    expect(bus.readByte(0xd012)).toBe(300 & 0xff);
    expect(bus.readByte(0xd011)! & 0x80).toBe(0x80);
  });

  it("fires the compare once, on the line asked for", () => {
    const bus = new C64Bus();
    bus.writeByte(0xd012, 100);
    bus.writeByte(0xd01a, 0x01); // raster interrupt enabled

    bus.tick(CYCLES_PER_LINE * 99);
    expect(bus.irq).toBe(false);
    bus.tick(CYCLES_PER_LINE);
    expect(bus.irq).toBe(true);
  });

  it("clears the latch by writing a one to it, not a zero", () => {
    // The opposite of what it looks like, and the usual reason a raster handler
    // fires for ever: a program that writes $00 to $D019 clears nothing.
    const bus = new C64Bus();
    bus.writeByte(0xd012, 0);
    bus.writeByte(0xd01a, 0x01);
    bus.tick(CYCLES_PER_LINE);
    bus.tick(CYCLES_PER_FRAME);
    expect(bus.irq).toBe(true);

    bus.writeByte(0xd019, 0x00);
    expect(bus.irq).toBe(true);
    bus.writeByte(0xd019, 0x01);
    expect(bus.irq).toBe(false);
  });

  it("says where the screen and the characters are", () => {
    // $D018 packs both pointers into one byte, and reading it wrong is how a
    // reader spends half an hour on a blank screen — which experiment-0's agent
    // B did, and said so.
    const bus = new C64Bus();
    bus.writeByte(0xd018, 0x18); // Gridrunner's own value
    expect(bus.vic.screenBase).toBe(0x0400);
    expect(bus.vic.characterBase).toBe(0x2000);
  });
});

describe("the CIAs", () => {
  it("reads a joystick as active low", () => {
    // A pushed direction pulls its bit *down*. Getting this inverted reads as
    // every direction at once, which a game happily acts on.
    const bus = new C64Bus();
    expect(bus.readByte(0xdc00)).toBe(0xff);

    bus.joystick2 = { fire: true, left: true };
    const port = bus.readByte(0xdc00)!;
    expect(port & 0x10).toBe(0); // fire
    expect(port & 0x04).toBe(0); // left
    expect(port & 0x01).toBe(0x01); // up, not pushed
  });

  it("runs Timer A down and flags it, which is the KERNAL's clock", () => {
    // Sixty times a second, to advance the jiffy clock and scan the keyboard.
    // A program that waits on $A2 never finishes without it.
    const bus = new C64Bus();
    bus.writeByte(0xdc04, 10);
    bus.writeByte(0xdc05, 0);
    bus.writeByte(0xdc0d, 0x81); // enable Timer A
    bus.writeByte(0xdc0e, 0x01); // start

    bus.tick(9);
    expect(bus.irq).toBe(false);
    bus.tick(2);
    expect(bus.irq).toBe(true);
  });

  it("acknowledges by being read, which is what stops it re-firing", () => {
    const bus = new C64Bus();
    bus.writeByte(0xdc04, 1);
    bus.writeByte(0xdc05, 0);
    bus.writeByte(0xdc0d, 0x81);
    bus.writeByte(0xdc0e, 0x01);
    bus.tick(3);

    expect(bus.irq).toBe(true);
    expect(bus.readByte(0xdc0d)! & 0x80).toBe(0x80);
    expect(bus.irq).toBe(false);
  });

  it("takes the interrupt mask as set-or-clear, not as a value", () => {
    // Bit 7 says which. `$7F` turns everything off, which is the first thing
    // any interrupt setup does, and reading it as a mask enables nothing.
    const bus = new C64Bus();
    bus.writeByte(0xdc04, 1);
    bus.writeByte(0xdc05, 0);
    bus.writeByte(0xdc0e, 0x01);

    bus.writeByte(0xdc0d, 0x7f); // clear all
    bus.tick(3);
    expect(bus.irq).toBe(false);

    bus.writeByte(0xdc0d, 0x81); // set Timer A
    bus.tick(3);
    expect(bus.irq).toBe(true);
  });

  it("says which 16K bank the VIC sees", () => {
    // Inverted, as the wiring is. Without this a game that moves its screen to
    // $4000 composes as a blank frame.
    const bus = new C64Bus();
    // Undriven reads high, which inverts to bank 0 — where a C64 boots.
    expect(bus.cia2.vicBank).toBe(0x0000);
    bus.writeByte(0xdd00, 0x02);
    expect(bus.cia2.vicBank).toBe(0x4000);
    bus.writeByte(0xdd00, 0x00);
    expect(bus.cia2.vicBank).toBe(0xc000);
  });
});

describe("the SID", () => {
  it("records what it was told, with when", () => {
    // Not a synthesiser. The question anybody asks is which routine makes that
    // noise, and a timestamped trace answers it better than audio would —
    // because you can diff two runs.
    const bus = new C64Bus();
    bus.tick(100);
    bus.writeByte(0xd400, 0x25);
    bus.tick(50);
    bus.writeByte(0xd404, 0x11);

    expect(bus.sid.writes).toEqual([
      { cycle: 100, register: 0x00, value: 0x25 },
      { cycle: 150, register: 0x04, value: 0x11 },
    ]);
  });

  it("says when a program leaned on a register it does not model", () => {
    // $D41B is a real random source on hardware, and a game built on it would
    // quietly lose its randomness against a silent zero.
    const bus = new C64Bus();
    bus.readByte(0xd41b);
    expect([...bus.sid.unmodelledReads]).toEqual([0xd41b]);
  });
});

describe("the bus as a whole", () => {
  it("leaves colour RAM to memory, because that is what it is", () => {
    // A kilobyte of static RAM rather than a chip. Letting it fall through is
    // not a shortcut — it means a frame composes out of the machine's own bytes
    // with nothing special-cased.
    const bus = new C64Bus();
    expect(bus.readByte(0xd800)).toBeUndefined();
    expect(bus.writeByte(0xd800, 0x0e)).toBe(false);

    const machine = new Machine();
    machine.bus = bus;
    machine.write(0xd800, 0x0e, 1);
    expect(machine.memory[0xd800]).toBe(0x0e);
  });

  it("answers nothing outside the I/O page", () => {
    const bus = new C64Bus();
    expect(bus.readByte(0xcfff)).toBeUndefined();
    expect(bus.readByte(0xe000)).toBeUndefined();
  });

  it("restores to the machine it snapshotted, raster and all", () => {
    // What makes a checkpoint safe to resume from. A snapshot missing the
    // raster position comes back in a different scanline, and a raster handler
    // then fires on the wrong line for the rest of the run.
    const bus = new C64Bus();
    bus.writeByte(0xd012, 100);
    bus.writeByte(0xd01a, 0x01);
    bus.tick(CYCLES_PER_LINE * 50 + 7);
    bus.writeByte(0xd400, 0x25);
    const state = bus.snapshot();
    const raster = bus.vic.raster;

    const resumed = new C64Bus();
    resumed.restore(state);

    expect(resumed.vic.raster).toBe(raster);
    expect(resumed.vic.compare).toBe(100);
    expect(resumed.readByte(0xd01a)).toBe(bus.readByte(0xd01a));
    // Both now advance identically, which is the property that matters.
    bus.tick(CYCLES_PER_LINE * 60);
    resumed.tick(CYCLES_PER_LINE * 60);
    expect(resumed.vic.raster).toBe(bus.vic.raster);
    expect(resumed.irq).toBe(bus.irq);
  });
});
