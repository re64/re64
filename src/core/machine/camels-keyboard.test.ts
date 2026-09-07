import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { C64 } from "./c64.js";

/**
 * Typing into a running game, which is what experiment 9 could not do.
 *
 * The `input` step drove a joystick only, so the two most cinematic shots in
 * that run's article — typing the cheat and watching the banner appear — could
 * not be taken, and both readers lost work to it. The editor got the banner by
 * forcing the flag byte instead and captioned it honestly as a re-enactment.
 *
 * This is the photograph. Four keys, through the matrix, into the game's own
 * check, out onto the screen.
 *
 * It also settles OATS against GOATS by running it rather than reading it. The
 * table at `$96F7` is `G O A T S`, but the routine treats `table[X]` as the key
 * already accepted and `table[X+1]` as the one it wants next — so the counter
 * begins life as though the G had been typed, only four keys are ever accepted,
 * and the terminator is `CMP #$04` rather than `#$05`. Typing GOATS works
 * because the G matches the "already accepted" slot and is swallowed.
 */

const KERNAL = "3party/roms/kernal.901227-03.bin";
const BASIC = "3party/roms/basic.901226-01.bin";
const GAME = "assets/mutant-camels/revenge-of-the-mutant-camels.prg";

const ready = existsSync(KERNAL) && existsSync(BASIC) && existsSync(GAME);

/**
 * Frames to let the machine boot itself before loading the game.
 *
 * **Through the reset vector, not straight into the game**, and that is the
 * whole lesson of getting this working. `$EADD` is `JMP (KEYLOG)` — the KERNAL
 * decodes a keypress through a RAM vector, and RAM vectors are set up by the
 * reset that a real machine performs before anything is loaded. Starting at the
 * game's own entry point leaves that vector zero: the matrix scans correctly,
 * `$CB` holds the right key, and `$C5` is never written, so the game sees
 * nothing and looks as though the keyboard is not modelled.
 *
 * Measured: `KEYLOG` is filled between frames 130 and 140, most of which is
 * `RAMTAS` sizing memory by writing all of it.
 */
const RESET_FRAMES = 160;

/** Frames for the game's own initialisation, after which its IRQ is installed. */
const GAME_FRAMES = 240;

function booted(): C64 {
  const machine = new C64();
  machine.cpu.memory.set(new Uint8Array(readFileSync(KERNAL)), 0xe000);
  machine.cpu.memory.set(new Uint8Array(readFileSync(BASIC)), 0xa000);
  machine.start(machine.vector(0xfffc));
  machine.run({ frames: RESET_FRAMES });

  // Then the game, and `SYS 34800` as its own BASIC stub would.
  const prg = new Uint8Array(readFileSync(GAME));
  machine.cpu.memory.set(prg.subarray(2), prg[0] | (prg[1] << 8));
  machine.start(0x87f0);
  machine.run({ frames: GAME_FRAMES });
  return machine;
}

/**
 * Press a key, hold it, let go.
 *
 * Held rather than typed, because that is what the hardware has — and the gaps
 * are not padding: the routine at `$96D9` ignores a key that matches the one it
 * already accepted, which is a debounce against exactly this, so four presses
 * with no releases between them advance the counter once.
 */
function type(machine: C64, key: string): void {
  machine.bus.keys = [key];
  machine.run({ frames: 4 });
  machine.bus.keys = [];
  machine.run({ frames: 4 });
}

/** The one screen row the banner is drawn into, as readable text. */
function row(machine: C64, line: number): string {
  const screen = machine.cpu.memory.subarray(0x0400 + line * 40, 0x0400 + line * 40 + 40);
  return [...screen]
    .map((code) => (code >= 1 && code <= 26 ? String.fromCharCode(64 + code) : code === 32 ? " " : "."))
    .join("")
    .trim();
}

describe.skipIf(!ready)("typing into Revenge of the Mutant Camels", () => {
  it("boots itself first, which is what fills the KERNAL's RAM vectors", () => {
    const machine = booted();
    // `JMP (KEYLOG)` is why this matters: with the vector unset the scan works
    // and the decode goes nowhere.
    expect(machine.cpu.memory[0x28f] | (machine.cpu.memory[0x290] << 8)).toBe(0xeb48);
    // And the game has taken the interrupt over, which is where its cheat check
    // lives — nothing static reaches it.
    expect(machine.cpu.memory[0x314] | (machine.cpu.memory[0x315] << 8)).toBe(0x88d5);
  }, 60_000);

  it("fires the cheat on OATS, and shows it", () => {
    const machine = booted();
    expect(machine.cpu.memory[0x5e]).toBe(0);

    const counted: number[] = [];
    for (const key of ["o", "a", "t", "s"]) {
      type(machine, key);
      counted.push(machine.cpu.memory[0x5f]);
    }

    // One key accepted per press, and the fourth is the last one.
    expect(counted).toEqual([1, 2, 3, 4]);
    expect(machine.cpu.memory[0x5e]).not.toBe(0);

    // The banner the game draws for itself, read back off the screen.
    machine.run({ frames: 120 });
    expect(row(machine, 10)).toBe("CHEAT  MODE   OPERATIVE");
  }, 60_000);

  it("also fires on GOATS, because the G is swallowed", () => {
    // The folklore is not wrong, it is one key longer than it needs to be: at
    // counter 0 the G matches `table[0]`, the "already accepted" slot, and
    // branches to the RTS without changing anything.
    const machine = booted();

    type(machine, "g");
    expect(machine.cpu.memory[0x5f]).toBe(0);

    for (const key of ["o", "a", "t", "s"]) type(machine, key);
    expect(machine.cpu.memory[0x5e]).not.toBe(0);
  }, 60_000);

  it("starts over when a wrong key is pressed", () => {
    const machine = booted();
    for (const key of ["o", "a"]) type(machine, key);
    expect(machine.cpu.memory[0x5f]).toBe(2);

    type(machine, "z");
    expect(machine.cpu.memory[0x5f]).toBe(0);
    expect(machine.cpu.memory[0x5e]).toBe(0);
  }, 60_000);
});

describe.skipIf(ready)("typing into Revenge of the Mutant Camels", () => {
  it("needs the ROMs, which this repository does not carry", () => {
    expect(existsSync(GAME)).toBe(true);
  });
});
