import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { generateBasicEffects, basicKeywords } from "../../tools/basic-effects-source.js";
import { BASIC_EFFECTS, basicEffectsAt } from "./basic-effects.js";

/**
 * The shipped table, checked for shape rather than content.
 *
 * The content comes from ROMs this repository does not carry, so nothing here
 * can re-derive it without them. What these hold is that the committed file
 * still agrees with itself and with the rest of the codebase, which is what a
 * later edit can break silently.
 */
describe("the shipped BASIC effects", () => {
  it("covers the dispatched keywords and nothing else", () => {
    // 35 statements plus 23 functions. The seven keywords between them and the
    // ten operators are syntax rather than routines and dispatch through
    // neither table.
    expect(BASIC_EFFECTS).toHaveLength(58);
    expect(BASIC_EFFECTS.filter((e) => e.kind === "statement")).toHaveLength(35);
    expect(BASIC_EFFECTS.filter((e) => e.kind === "function")).toHaveLength(23);
  });

  it("finds the eleven BASIC routines that live in the KERNAL ROM", () => {
    // BASIC's *code* and the BASIC *ROM* are not the same set of addresses:
    // RND, SYS, SAVE, VERIFY, LOAD, OPEN, CLOSE and the four trig functions sit
    // at $E000-$E4FF, in the KERNAL chip. That is documented C64 layout and it
    // is also why the generator has to load both ROMs — without the second,
    // eleven entry points would decode as nothing and report touching nothing,
    // which reads exactly like a routine with no effects.
    const outside = BASIC_EFFECTS.filter((e) => e.vector === undefined && e.address >= 0xc000);
    expect(outside.map((e) => e.keyword).sort()).toEqual(
      ["ATN", "CLOSE", "COS", "LOAD", "OPEN", "RND", "SAVE", "SIN", "SYS", "TAN", "VERIFY"].sort()
    );
    for (const entry of outside) {
      expect(entry.address).toBeGreaterThanOrEqual(0xe000);
      expect(entry.address).toBeLessThanOrEqual(0xe4ff);
    }
  });

  it("is in address order, and every routine is in one ROM or the other", () => {
    const addresses = BASIC_EFFECTS.map((e) => e.address);
    expect(addresses).toEqual([...addresses].sort((a, b) => a - b));
    for (const entry of BASIC_EFFECTS) {
      if (entry.vector !== undefined) continue;
      const inBasic = entry.address >= 0xa000 && entry.address <= 0xbfff;
      const inKernal = entry.address >= 0xe000 && entry.address <= 0xffff;
      expect(inBasic || inKernal).toBe(true);
    }
  });

  it("gives every routine a name that identifies exactly one address", () => {
    // The rule this project applies to every other name. `PRINT#` and `PRINT`
    // collapsed into one name in the first version, which is precisely the
    // ambiguity that makes `name+4` mean nothing.
    const names = BASIC_EFFECTS.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^BASIC_[A-Za-z0-9]+$/);
  });

  it("says when a routine is reached through RAM rather than reporting nothing", () => {
    // `USR` dispatches through $0310, which BASIC's own initialisation fills.
    // An absent row would be indistinguishable from a routine that touches
    // nothing, which is the confident wrong answer this refuses.
    const usr = BASIC_EFFECTS.find((e) => e.keyword === "USR")!;
    expect(usr.vector).toBe(0x0310);
    expect(usr.incomplete?.join(" ")).toMatch(/RAM/);
  });

  it("knows the RTS-dispatch idiom, so END is where END is", () => {
    // The statement table holds target − 1, because BASIC pushes the address
    // and executes RTS. Getting that wrong would put every statement one byte
    // early and decode garbage — and it would still produce a plausible table.
    expect(basicEffectsAt(0xa831)?.keyword).toBe("END");
    expect(basicEffectsAt(0xa742)?.keyword).toBe("FOR");
  });
});

const BASIC = "3party/roms/basic.901226-01.bin";
const KERNAL = "3party/roms/kernal.901227-03.bin";
const GENERATED = "src/core/c64/basic-effects.ts";

/**
 * A committed generated file goes stale in silence, so this regenerates and
 * compares whenever the ROMs are present.
 */
describe.runIf(existsSync(BASIC) && existsSync(KERNAL))(
  "the committed table against the ROMs",
  () => {
    it("is what the generator produces today", () => {
      expect(generateBasicEffects(BASIC, KERNAL).source).toBe(readFileSync(GENERATED, "utf8"));
    });

    it("reads the keyword table the machine carries", () => {
      // The names are not transcribed from anywhere: BASIC's tokeniser reads
      // this list, and so does the generator.
      const words = basicKeywords(new Uint8Array(readFileSync(BASIC)));
      expect(words).toHaveLength(76);
      expect(words.slice(0, 4)).toEqual(["END", "FOR", "NEXT", "DATA"]);
      expect(words[34]).toBe("NEW");
      expect(words[52]).toBe("SGN");
      expect(words[74]).toBe("MID$");
    });
  }
);
