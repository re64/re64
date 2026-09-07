import { describe, it, expect } from "vitest";
import { C64 } from "./c64.js";
import { REG } from "../il/pcode.js";
import { CYCLES_PER_LINE } from "../c64/devices/index.js";

/**
 * The assembly: CPU, chips and the wire between them.
 *
 * The piece that was missing. `runProgram` could execute a decruncher — a
 * million and a half instructions of it — and still not run a game, because a
 * game's main loop is an interrupt and nothing raised one.
 */

/** Load a handwritten program at $1000 and point the machine at it. */
function running(bytes: number[]): C64 {
  const machine = new C64();
  machine.cpu.memory.set(new Uint8Array(bytes), 0x1000);
  machine.start(0x1000);
  return machine;
}

describe("running with chips attached", () => {
  it("spends an instruction's cycles on the chips", () => {
    // The clock and the beam advance together, so they can never disagree about
    // what time it is.
    const machine = running([0xea, 0xea, 0xea]); // NOP NOP NOP
    machine.run({ cycles: 6 });
    expect(machine.cycles).toBe(6);
    expect(machine.bus.vic.raster).toBe(0);
  });

  it("takes a raster interrupt, which is what a game's main loop is", () => {
    // The whole point. A handler at $9000 counts how many times it ran.
    const machine = running([0x4c, 0x00, 0x10]); // JMP $1000 — spin
    machine.cpu.memory.set(new Uint8Array([0xee, 0x00, 0x20, 0x40]), 0x9000); // INC $2000 / RTI
    machine.cpu.memory[0xfffe] = 0x00;
    machine.cpu.memory[0xffff] = 0x90;
    machine.bus.writeByte(0xd012, 100);
    machine.bus.writeByte(0xd01a, 0x01);
    machine.cpu.set({ space: "register", offset: REG.I, size: 1 }, 0);

    machine.run({ frames: 3 });
    // Fired once per frame: the latch is never acknowledged, so it stays
    // asserted — which is exactly the runaway a real handler clears $D019 to
    // avoid, and it means the count is at least the frame count.
    expect(machine.cpu.memory[0x2000]).toBeGreaterThan(0);
  });

  it("does not interrupt a program that has masked them", () => {
    const machine = running([0x78, 0x4c, 0x01, 0x10]); // SEI / JMP $1001
    machine.cpu.memory.set(new Uint8Array([0xee, 0x00, 0x20, 0x40]), 0x9000);
    machine.cpu.memory[0xfffe] = 0x00;
    machine.cpu.memory[0xffff] = 0x90;
    machine.bus.writeByte(0xd012, 10);
    machine.bus.writeByte(0xd01a, 0x01);

    machine.run({ frames: 2 });
    expect(machine.cpu.memory[0x2000]).toBe(0);
  });

  it("stops on a breakpoint before running it", () => {
    const machine = running([0xea, 0xea, 0xea, 0xea]);
    const outcome = machine.run({ breakpoints: [0x1002], cycles: 1000 });
    expect(outcome.reason).toBe("breakpoint");
    expect(outcome.at).toBe(0x1002);
  });

  it("stops on a watchpoint, including an address reached by indexing", () => {
    // Through the machine's own watcher rather than by re-reading memory, so it
    // sees an address the instruction never names — which is the whole reason
    // the bus reports the access rather than the intent.
    const machine = running([0xa2, 0x05, 0x9d, 0x00, 0x20]); // LDX #$05 / STA $2000,X
    const outcome = machine.run({ watchpoints: [{ from: 0x2005, to: 0x2005 }], cycles: 1000 });
    expect(outcome.reason).toBe("watchpoint");
  });

  it("counts frames, so a run can be as long as somebody can watch", () => {
    const machine = running([0x4c, 0x00, 0x10]);
    const outcome = machine.run({ frames: 5 });
    expect(outcome.reason).toBe("frames");
    expect(outcome.frames).toBe(5);
  });

  it("says when it ran out of budget rather than finishing", () => {
    const machine = running([0x4c, 0x00, 0x10]);
    const outcome = machine.run({ frames: 10_000, maxInstructions: 100 });
    expect(outcome.reason).toBe("budget");
  });

  it("stops on an instruction it cannot model rather than guessing", () => {
    const machine = running([0x02]); // JAM
    const outcome = machine.run({ cycles: 100 });
    expect(outcome.reason).toBe("unmodelled");
    expect(outcome.detail).toContain("$1000");
  });

  it("samples the line after the instruction, never inside one", () => {
    // Checking before would let an interrupt land mid-instruction, which no
    // 6502 does and which would corrupt anything doing a read-modify-write.
    const machine = running([0x4c, 0x00, 0x10]);
    machine.cpu.memory.set(new Uint8Array([0x40]), 0x9000); // RTI
    machine.cpu.memory[0xfffe] = 0x00;
    machine.cpu.memory[0xffff] = 0x90;
    machine.bus.writeByte(0xd012, 0);
    machine.bus.writeByte(0xd01a, 0x01);

    machine.run({ cycles: CYCLES_PER_LINE });
    // Whatever happened, the program counter is at an instruction boundary.
    expect([0x1000, 0x9000]).toContain(machine.cpu.pc);
  });
});
