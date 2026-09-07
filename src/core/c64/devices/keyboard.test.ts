import { describe, it, expect } from "vitest";
import { C64Bus, KEY_MATRIX, keyCode } from "./index.js";

/**
 * The keyboard matrix, scanned the way the KERNAL scans it.
 *
 * Experiment 9 wanted this and could not have it: `input` drove a joystick
 * only, so the two most cinematic shots in the article — typing the cheat and
 * watching the banner appear — could not be taken, and both readers lost work
 * to it. Everything here is active *low*, which is the trap: read the other way
 * round and holding nothing types everything.
 */

/** Drive one row low on port A and read the columns back off port B. */
function scan(bus: C64Bus, row: number): number {
  bus.writeByte(0xdc00, ~(1 << row) & 0xff);
  return bus.readByte(0xdc01)!;
}

describe("the keyboard matrix", () => {
  it("agrees with the table a real program compares against", () => {
    // Revenge of the Mutant Camels holds `1A 26 0A 16 0D` at $96F7 and compares
    // `$C5` against it. That is the check on this table, and it is why these
    // five are named rather than the whole grid being asserted.
    expect([KEY_MATRIX.g, KEY_MATRIX.o, KEY_MATRIX.a, KEY_MATRIX.t, KEY_MATRIX.s]).toEqual([
      0x1a, 0x26, 0x0a, 0x16, 0x0d,
    ]);
  });

  it("pulls one column low in the row the key sits in, and nowhere else", () => {
    const bus = new C64Bus();
    bus.keys = ["g"]; // row 3, column 2

    expect(scan(bus, 3)).toBe(0xff & ~(1 << 2));
    for (const row of [0, 1, 2, 4, 5, 6, 7]) expect(scan(bus, row)).toBe(0xff);
  });

  it("reads nothing when nothing is held", () => {
    const bus = new C64Bus();
    for (let row = 0; row < 8; row++) expect(scan(bus, row)).toBe(0xff);
  });

  it("answers the reverse scan, which real programs use to find shift", () => {
    const bus = new C64Bus();
    bus.keys = ["shift-left"]; // row 1, column 7
    bus.writeByte(0xdc01, ~(1 << 7) & 0xff); // drive that column from port B
    expect(bus.readByte(0xdc00)! & (1 << 1)).toBe(0);
  });

  it("shares port B with joystick 1, exactly as the hardware does", () => {
    // Not a defect to engineer out: this is why C64 games ask you to unplug the
    // stick in port 2 before typing.
    const bus = new C64Bus();
    bus.joystick1 = { fire: true }; // bit 4 low
    bus.writeByte(0xdc00, 0xff); // no row selected at all
    expect(bus.readByte(0xdc01)! & 0x10).toBe(0);
  });

  it("replaces the whole set, so releasing needs no second call", () => {
    const bus = new C64Bus();
    bus.keys = ["o", "a"];
    expect(bus.keys.sort()).toEqual(["a", "o"]);
    bus.keys = [];
    expect(bus.keys).toEqual([]);
    for (let row = 0; row < 8; row++) expect(scan(bus, row)).toBe(0xff);
  });

  it("refuses a name it does not know rather than pressing nothing", () => {
    const bus = new C64Bus();
    expect(() => {
      bus.keys = ["escape"];
    }).toThrow(/no such key/);
    expect(keyCode("escape")).toBeUndefined();
    expect(keyCode("G")).toBe(0x1a);
    expect(keyCode(26)).toBe(26);
    expect(keyCode(64)).toBeUndefined();
  });

  it("survives a checkpoint, because a held key is state", () => {
    const bus = new C64Bus();
    bus.keys = ["o", "run-stop"];
    const state = bus.snapshot();

    const resumed = new C64Bus();
    resumed.restore(state);
    expect(resumed.keys.sort()).toEqual(["o", "run-stop"]);
  });
});
