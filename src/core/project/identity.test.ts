import { describe, it, expect } from "vitest";
import { newId, derivedId, isId } from "./identity.js";

describe("newId", () => {
  it("mints distinct ids", () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newId("lbl")));
    expect(ids.size).toBe(2000);
  });

  it("marks what an id refers to", () => {
    expect(newId("lbl")).toMatch(/^lbl_/);
    expect(newId("rgn")).toMatch(/^rgn_/);
    expect(newId("lay")).toMatch(/^lay_/);
  });
});

describe("derivedId", () => {
  it("gives every client the same id for the same content", () => {
    // The whole point: two clients loading an un-migrated file must agree, or
    // merge would see two labels where there is one.
    expect(derivedId("lbl", "lay_a", 0x8100, "Start")).toBe(
      derivedId("lbl", "lay_a", 0x8100, "Start")
    );
  });

  it("separates its parts, so different splits do not collide", () => {
    expect(derivedId("lbl", "ab", "c")).not.toBe(derivedId("lbl", "a", "bc"));
  });

  it("distinguishes labels that differ in any field", () => {
    const base = derivedId("lbl", "lay_a", 0x8100, "Start");
    expect(derivedId("lbl", "lay_b", 0x8100, "Start")).not.toBe(base);
    expect(derivedId("lbl", "lay_a", 0x8101, "Start")).not.toBe(base);
    expect(derivedId("lbl", "lay_a", 0x8100, "Stop")).not.toBe(base);
  });

  it("spreads across the id space rather than clustering", () => {
    // Consecutive addresses are the common case; a weak hash would collide.
    const ids = new Set(
      Array.from({ length: 4096 }, (_, i) => derivedId("lbl", "lay_a", 0x8000 + i, "x"))
    );
    expect(ids.size).toBe(4096);
  });
});

describe("isId", () => {
  it("recognises ids this module produces", () => {
    expect(isId(newId("lbl"))).toBe(true);
    expect(isId(derivedId("rgn", "a", 1))).toBe(true);
  });

  it("rejects anything else", () => {
    for (const bad of ["", "lbl", "xyz_abc", "$8100", 42, null, undefined]) {
      expect(isId(bad)).toBe(false);
    }
  });
});
