import { describe, it, expect } from "vitest";
import { KERNAL_EFFECTS } from "./kernal-effects.js";
import { C64_SYMBOLS } from "./symbols.js";

/**
 * The generated table, checked for shape rather than content.
 *
 * The content is derived from a ROM this repository does not carry, so nothing
 * here can re-derive it — `npm run gen:kernal` does that, and
 * `kernal-vectors.test.ts` is what checks the derivation against published
 * facts. What these hold is that the committed file still agrees with the rest
 * of the codebase, which is the thing a later edit can break silently.
 */
describe("the shipped KERNAL effects", () => {
  it("covers the documented jump table and nothing else", () => {
    const addresses = KERNAL_EFFECTS.map((e) => e.address);
    expect(addresses).toEqual([...addresses].sort((a, b) => a - b));
    for (const at of addresses) {
      expect(at).toBeGreaterThanOrEqual(0xff81);
      expect(at).toBeLessThanOrEqual(0xfff3);
      expect((at - 0xff81) % 3).toBe(0);
    }
  });

  it("names every entry the way the symbol table does", () => {
    const named = new Map(C64_SYMBOLS.map((s) => [s.address, s.name]));
    for (const entry of KERNAL_EFFECTS) expect(entry.name).toBe(named.get(entry.address));
  });

  it("records the vector for an entry point that jumps through RAM", () => {
    const chrout = KERNAL_EFFECTS.find((e) => e.name === "CHROUT");
    expect(chrout?.vector).toEqual({ pointer: 0x0326, defaultImpl: 0xf1ca });
  });

  it("keeps the narrow scope narrower than the wide one", () => {
    // Both are shipped because neither answers alone: CHROUT dispatches on the
    // output device, so the wide union covers screen, serial, tape and RS-232
    // at once. A reader has to be able to see the difference.
    for (const entry of KERNAL_EFFECTS) {
      expect(entry.ownMemory.length).toBeLessThanOrEqual(entry.memory.length);
      expect(entry.ownRegisters.length).toBeLessThanOrEqual(entry.registers.length);
    }
  });
});
