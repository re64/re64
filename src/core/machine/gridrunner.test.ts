import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { C64 } from "./c64.js";
import { composeScreen } from "../c64/screen.js";

/**
 * Gridrunner, running.
 *
 * The acceptance test for the whole machine model, and the standard is the one
 * experiment-0's two agents met in an afternoon with nothing but the binary:
 * boot the cartridge, reach the title screen, push the stick, and watch the game
 * play. Experiment 8 got as far as the title screen *by inference* — it read the
 * code and worked out what would be drawn — because nothing here could raise an
 * interrupt, and a C64 game's main loop is an interrupt.
 *
 * Opt-in on the ROMs, which are not in this repository and never will be. See
 * `3party/roms/README.md` for what to put there.
 */

const KERNAL = "3party/roms/kernal.901227-03.bin";
const CHARACTERS = "3party/roms/characters.901225-01.bin";
const CARTRIDGE = "assets/gridrunner/gridrunner.prg";

const ready = existsSync(KERNAL) && existsSync(CHARACTERS) && existsSync(CARTRIDGE);

/** The cartridge at $8000, the KERNAL at $E000, and nothing else. */
function booted(): { machine: C64; characters: Uint8Array } {
  const machine = new C64();

  // A `.prg` carries its load address in the first two bytes.
  const prg = new Uint8Array(readFileSync(CARTRIDGE));
  const origin = prg[0] | (prg[1] << 8);
  machine.cpu.memory.set(prg.subarray(2), origin);

  machine.cpu.memory.set(new Uint8Array(readFileSync(KERNAL)), 0xe000);

  // `$8000` and `$8002` are the cold and warm vectors, and `CBM80` at `$8004`
  // is what says this is a cartridge at all — which is how re64 worked out that
  // this dump was one rather than a program.
  machine.start(machine.vector(0x8000));
  return { machine, characters: new Uint8Array(readFileSync(CHARACTERS)) };
}

/** How much of a frame is not the background — a blank screen scores zero. */
function inked(frame: { pixels: Uint8Array }, background: number): number {
  let count = 0;
  for (const pixel of frame.pixels) if (pixel !== background) count += 1;
  return count;
}

/** How many pixels differ between two frames. Zero means nothing moved. */
function moved(a: { pixels: Uint8Array }, b: { pixels: Uint8Array }): number {
  let count = 0;
  for (let i = 0; i < a.pixels.length; i++) if (a.pixels[i] !== b.pixels[i]) count += 1;
  return count;
}

/**
 * Frames to boot before the game's own code runs.
 *
 * Measured rather than guessed, and larger than it looks: the cartridge's cold
 * start calls the KERNAL's `RAMTAS`, which sizes memory by writing all of it —
 * about 900,000 instructions, or two and a half seconds of machine time. The
 * game's own `$D018` write lands around frame 150.
 */
const BOOT_FRAMES = 220;

describe.skipIf(!ready)("Gridrunner, running", () => {
  it("boots from its cartridge vector and draws its title screen", () => {
    const { machine, characters } = booted();
    expect(machine.cpu.pc).toBe(0x83c1);

    machine.run({ frames: BOOT_FRAMES });

    const frame = composeScreen(machine.bus, machine.cpu.memory, characters);
    // Not a blank screen. Experiment 8 reached this point by *reading the code*
    // and saying what would be drawn; this is the photograph.
    expect(inked(frame, machine.bus.vic.backgroundColour)).toBeGreaterThan(2000);
  }, 60_000);

  it("sets the character base to its own font rather than the ROM's", () => {
    // `$D018 = $18` puts characters at $2000, which is the chain re64 already
    // documents: the one indirect write to $D018 says $18, and a copy loop
    // reads $8E00. Here it is happening rather than being deduced.
    const { machine } = booted();
    machine.run({ frames: BOOT_FRAMES });

    expect(machine.bus.vic.characterBase).toBe(0x2000);
    expect(machine.bus.vic.screenBase).toBe(0x0400);
  }, 60_000);

  it("waits on the title screen, which is a machine that is running", () => {
    // Sitting still is the *right* answer here and worth asserting: the game
    // has drawn its title and is spinning on the joystick. A machine that had
    // crashed would also sit still, so the next test is the one that matters —
    // but a screen that churned here would mean something else was wrong.
    const { machine, characters } = booted();
    machine.run({ frames: BOOT_FRAMES });

    const first = composeScreen(machine.bus, machine.cpu.memory, characters);
    machine.run({ frames: 50 });
    const second = composeScreen(machine.bus, machine.cpu.memory, characters);

    expect(moved(first, second)).toBe(0);
  }, 60_000);

  it("plays when the stick is pushed", () => {
    // The finish line. Boot, reach the title, press fire, run three hundred
    // frames, and capture — and the screen has to keep changing, because a game
    // that is running is a game whose screen moves.
    const { machine, characters } = booted();
    machine.run({ frames: BOOT_FRAMES });

    // **Port 1**, which is `$DC01`. Found by pushing both and watching where
    // the program counter went: port 2 left it spinning on the title at $8DBC,
    // and port 1 moved it to the game loop at $838E.
    machine.bus.joystick1 = { fire: true };
    machine.run({ frames: 30 });
    machine.bus.joystick1 = {};

    const frames: { pixels: Uint8Array }[] = [];
    for (let taken = 0; taken < 5; taken++) {
      machine.run({ frames: 40 });
      frames.push(composeScreen(machine.bus, machine.cpu.memory, characters));
    }

    // The playfield fills in: the title screen is about two thousand inked
    // pixels and the running game is closer to eighteen.
    const background = machine.bus.vic.backgroundColour;
    expect(inked(frames.at(-1)!, background)).toBeGreaterThan(8000);

    // And it is *moving*. A still title screen passes every other assertion in
    // this file, so this is the one that says the game is being played:
    // thousands of pixels differ between consecutive captures.
    const churn = frames.slice(1).map((frame, i) => moved(frames[i], frame));
    expect(Math.max(...churn)).toBeGreaterThan(1000);
  }, 120_000);

  it("uses no sprites at all, so this file is not sprite coverage", () => {
    // Worth asserting rather than assuming, because these tests pass unchanged
    // whether or not `composeScreen` draws sprites — and somebody will
    // eventually read that as evidence the sprite path works. It is not: this
    // game draws its ship, its droids and its laser out of its own 64-glyph
    // font at $8E00, and never enables a sprite. `src/core/c64/sprite.test.ts`
    // is where that path is exercised.
    const { machine } = booted();
    machine.run({ frames: BOOT_FRAMES });
    expect(machine.bus.vic.sprites.filter((s) => s.enabled)).toEqual([]);

    machine.bus.joystick1 = { fire: true };
    machine.run({ frames: 30 });
    machine.bus.joystick1 = {};
    machine.run({ frames: 120 });
    expect(machine.bus.vic.sprites.filter((s) => s.enabled)).toEqual([]);
  }, 120_000);

  it("is deterministic, which is what makes a checkpoint safe to resume", () => {
    // The enabling invariant for prefix caching: the same steps over the same
    // bytes produce the same machine, byte for byte. It is also why input is
    // scheduled rather than delivered live.
    const runOnce = () => {
      const { machine } = booted();
      machine.run({ frames: BOOT_FRAMES });
      machine.bus.joystick1 = { fire: true };
      machine.run({ frames: 30 });
      return {
        screen: machine.cpu.memory.slice(0x0400, 0x07e8),
        cycles: machine.cycles,
        instructions: machine.instructions,
      };
    };

    const first = runOnce();
    const second = runOnce();
    expect(second.cycles).toBe(first.cycles);
    expect(second.instructions).toBe(first.instructions);
    expect(Array.from(second.screen)).toEqual(Array.from(first.screen));
  }, 180_000);
});

describe.skipIf(ready)("Gridrunner, running", () => {
  it("needs the ROMs, which this repository does not carry", () => {
    // Said rather than silently skipped, so a run that proves nothing is
    // visible as one. `3party/roms/README.md` lists the files and their hashes.
    expect(existsSync(CARTRIDGE)).toBe(true);
  });
});
