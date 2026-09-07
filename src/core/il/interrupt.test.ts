import { describe, it, expect } from "vitest";
import { Machine } from "./interpret.js";
import { stepMachine } from "./run.js";
import { deliverInterrupt } from "./interrupt.js";
import { REG } from "./pcode.js";

/**
 * Entering an interrupt, and coming back out.
 *
 * Handwritten programs rather than a real binary, because this has to be right
 * before any device exists to raise a line — a device with nothing to interrupt
 * is untestable, and an interrupt nothing verifies is worse.
 */

const set = (machine: Machine, register: number, value: number) =>
  machine.set({ space: "register", offset: register, size: 1 }, value);

/** A machine with a stack pointer where a real one boots it, and a vector. */
function machineWith(vector: number, at: number, handler: number[]): Machine {
  const machine = new Machine();
  set(machine, REG.SP, 0xff);
  machine.memory[vector] = at & 0xff;
  machine.memory[vector + 1] = (at >> 8) & 0xff;
  machine.memory.set(new Uint8Array(handler), at);
  return machine;
}

describe("taking an interrupt", () => {
  it("vectors through $FFFE and pushes where to come back to", () => {
    const machine = machineWith(0xfffe, 0x9000, [0x40]); // RTI
    machine.pc = 0x1234;

    expect(deliverInterrupt(machine, "irq")).toBe(true);
    expect(machine.pc).toBe(0x9000);
    // High byte first, so the low byte is on top — which is what `RTI` expects.
    expect(machine.memory[0x01ff]).toBe(0x12);
    expect(machine.memory[0x01fe]).toBe(0x34);
    expect(machine.register(REG.SP)).toBe(0xfc);
  });

  it("is refused when the program has disabled them", () => {
    // The masking that makes a critical section a critical section. A caller
    // raising a line every frame has to know whether the machine went.
    const machine = machineWith(0xfffe, 0x9000, [0x40]);
    machine.pc = 0x1234;
    set(machine, REG.I, 1);

    expect(deliverInterrupt(machine, "irq")).toBe(false);
    expect(machine.pc).toBe(0x1234);
  });

  it("takes an NMI whatever the program has disabled", () => {
    // Non-maskable is the whole of the difference, and Gridrunner's warm start
    // is reached this way.
    const machine = machineWith(0xfffa, 0x9000, [0x40]);
    machine.pc = 0x1234;
    set(machine, REG.I, 1);

    expect(deliverInterrupt(machine, "nmi")).toBe(true);
    expect(machine.pc).toBe(0x9000);
  });

  it("pushes with B clear, which is how a handler tells it from BRK", () => {
    // `B` is not stored anywhere on this machine — it exists only as bit four
    // of the pushed byte. `PHP` and `BRK` set it; an interrupt does not, and a
    // handler that dispatches on it would send every interrupt down the BRK
    // path if this were wrong.
    const machine = machineWith(0xfffe, 0x9000, [0x40]);
    machine.pc = 0x1234;

    deliverInterrupt(machine, "irq");
    const pushed = machine.memory[0x01fd];
    expect(pushed & 0x10).toBe(0);
    expect(pushed & 0x20).toBe(0x20);
  });

  it("pushes the flags the interrupted code had, not the ones it leaves", () => {
    // `I` is set *after* the push, so the handler's own RTI restores what the
    // interrupted code was running with.
    const machine = machineWith(0xfffe, 0x9000, [0x40]);
    machine.pc = 0x1234;
    set(machine, REG.C, 1);
    set(machine, REG.N, 1);

    deliverInterrupt(machine, "irq");
    expect(machine.memory[0x01fd] & 0x04).toBe(0); // I was clear when pushed
    expect(machine.memory[0x01fd] & 0x01).toBe(0x01); // C
    expect(machine.memory[0x01fd] & 0x80).toBe(0x80); // N
    // And the machine is now masked, so a second line does not re-enter.
    expect(machine.register(REG.I)).toBe(1);
  });

  it("comes back with RTI to the instruction that was next", () => {
    // The round trip, which is what makes a handler a handler rather than a
    // one-way jump. `RTI` is a real instruction and stays lifted; only the
    // entry is modelled here.
    const machine = machineWith(0xfffe, 0x9000, [0xe8, 0x40]); // INX / RTI
    machine.memory.set(new Uint8Array([0xea, 0xea]), 0x1234); // NOP NOP
    machine.pc = 0x1234;

    deliverInterrupt(machine, "irq");
    let step = stepMachine(machine, machine.pc)!; // INX
    machine.pc = step.next;
    step = stepMachine(machine, machine.pc)!; // RTI
    machine.pc = step.next;

    expect(machine.pc).toBe(0x1234);
    expect(machine.register(REG.X)).toBe(1);
    // The flags came back as they were: `I` clear, so the next line is taken.
    expect(machine.register(REG.I)).toBe(0);
    expect(machine.register(REG.SP)).toBe(0xff);
  });

  it("nests, because a handler that re-enables them can be interrupted", () => {
    // CLI inside the handler, then a second line. Real programs do this to let
    // a raster interrupt pre-empt a long one.
    const machine = machineWith(0xfffe, 0x9000, [0x58, 0xea]); // CLI / NOP
    machine.pc = 0x1234;

    deliverInterrupt(machine, "irq");
    const step = stepMachine(machine, machine.pc)!; // CLI
    machine.pc = step.next;

    expect(deliverInterrupt(machine, "irq")).toBe(true);
    expect(machine.register(REG.SP)).toBe(0xf9); // six bytes, two entries deep
  });
});
