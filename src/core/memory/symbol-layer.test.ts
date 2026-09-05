import { describe, it, expect } from "vitest";
import { MemoryMap } from "./memory-map.js";
import { BytesLayer } from "./layer.js";
import { SymbolLayer } from "./symbol-layer.js";
import { platformClaim, CLAIM_RANK } from "../claims/names.js";
import { Claim } from "../claims/model.js";
import { LabelType } from "./label-type.js";

/** A name somebody chose: a claim, with the root its type asks for. */
const userClaim = (id: string, at: number, name: string, type: LabelType = "address", extent?: number): Claim => ({
  id,
  at,
  name,
  ...(type === "entry" ? { root: "entry" as const } : {}),
  ...(type === "function" ? { root: "routine" as const } : {}),
  ...(type === "code" ? { root: "location" as const } : {}),
  ...(extent === undefined ? {} : { extent }),
  by: { author: "test", source: "user" },
});

import { createC64PlatformLayer, C64_SYMBOLS } from "../c64/symbols.js";

describe("SymbolLayer", () => {
  it("supplies no bytes and never shadows", () => {
    const map = new MemoryMap();
    map.addLayer(new BytesLayer("data", 0x1000, new Uint8Array([0xaa]), 0x10));
    map.addLayer(new SymbolLayer("syms", [platformClaim("lbl_platform1000", 0x1000, "SOMETHING")]));

    // Symbol layer was added last, so it is on top — and must still not shadow.
    expect(map.readByte(0x1000)).toBe(0xaa);
    expect(map.readByteWithSource(0x1000)?.layer.name).toBe("data");
  });

  it("contributes labels regardless of having no range", () => {
    const map = new MemoryMap();
    map.addLayer(new SymbolLayer("syms", [platformClaim("lbl_platformd020", 0xd020, "EXTCOL")]));

    expect(map.getLabels().resolve(0xd020)?.label.name).toBe("EXTCOL");
  });

  it("is excluded from the byte-supplying layers", () => {
    const map = new MemoryMap();
    map.addLayer(new BytesLayer("data", 0x1000, new Uint8Array([0xaa]), 0x10));
    map.addLayer(new SymbolLayer("syms", []));

    const byteLayers = map.getLayers().filter((l) => l.hasBytes);
    expect(byteLayers).toHaveLength(1);
    expect(byteLayers[0].name).toBe("data");
  });
});

describe("label priority", () => {
  it("ranks a user label above a platform one at the same address", () => {
    const map = new MemoryMap();
    map.addLayer(new SymbolLayer("c64", [platformClaim("lbl_platformffd2", 0xffd2, "CHROUT")]));
    map.addLayer(new SymbolLayer("project", [userClaim("lbl_userffd2", 0xffd2, "ROM_CHROUT", "address")]));

    expect(map.getLabels().resolve(0xffd2)?.label.name).toBe("ROM_CHROUT");
  });

  it("resolves by rank rather than insertion order", () => {
    // The platform label is added last; insertion order would have let it win.
    const map = new MemoryMap();
    map.addLayer(new SymbolLayer("project", [userClaim("lbl_userd016", 0xd016, "VIC_CTRL2", "address")]));
    map.addLayer(new SymbolLayer("c64", [platformClaim("lbl_platformd016", 0xd016, "SCROLX")]));

    expect(map.getLabels().resolve(0xd016)?.label.name).toBe("VIC_CTRL2");
    expect(CLAIM_RANK.user).toBeGreaterThan(CLAIM_RANK.platform);
  });

  it("orders every source unambiguously", () => {
    const ranks = Object.values(CLAIM_RANK);
    expect(new Set(ranks).size).toBe(ranks.length);
    expect(CLAIM_RANK.user).toBeGreaterThan(CLAIM_RANK.analysis);
    expect(CLAIM_RANK.analysis).toBeGreaterThan(CLAIM_RANK.layer);
    expect(CLAIM_RANK.layer).toBeGreaterThan(CLAIM_RANK.platform);
    expect(CLAIM_RANK.platform).toBeGreaterThan(CLAIM_RANK.auto);
  });

  it("has no rank for a named span, because the span is the name", () => {
    // `region` sat between `layer` and `user` and generated a second name of
    // its own, which is where the rank collision came from: a person's name for
    // an address and their name for the table containing it were two objects
    // competing at one rank. One claim now carries both, and the narrower of
    // two user claims wins on specificity rather than on a rank nobody could
    // see.
    expect(CLAIM_RANK).not.toHaveProperty("region");
  });
});

describe("C64 symbol table", () => {
  it("names one symbol per address", () => {
    const addresses = C64_SYMBOLS.map((s) => s.address);
    expect(new Set(addresses).size).toBe(addresses.length);
  });

  it("keeps every address inside the 16-bit space", () => {
    for (const s of C64_SYMBOLS) {
      expect(s.address).toBeGreaterThanOrEqual(0);
      expect(s.address).toBeLessThanOrEqual(0xffff);
    }
  });

  it("uses distinct names", () => {
    const names = C64_SYMBOLS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("matches the addresses the reference disassembly names independently", () => {
    // Cross-checked against assets/gridrunner/gridrunner.asm, which was produced without
    // this table: a wrong entry here would silently mislabel operands.
    const layer = createC64PlatformLayer();
    const byAddress = new Map(layer.getLabels().map((l) => [l.at, l.name]));

    expect(byAddress.get(0xffd2)).toBe("CHROUT");
    expect(byAddress.get(0xfd15)).toBe("ROM_RESTOR");
    expect(byAddress.get(0xfd50)).toBe("ROM_RAMTAS");
    expect(byAddress.get(0xfda3)).toBe("ROM_IOINIT");
    expect(byAddress.get(0xd800)).toBe("COLOR_RAM");
    expect(byAddress.get(0x0400)).toBe("SCREEN_RAM");
  });

  it("carries every description onto its label", () => {
    // The table held 382 descriptions and platformClaim dropped the
    // argument, so none of them reached any consumer — the fourth instance of
    // this project's "a field nothing reads" shape.
    const layer = createC64PlatformLayer();
    expect(layer.labels).toHaveLength(C64_SYMBOLS.length);
    expect(layer.labels.every((l) => l.description !== undefined)).toBe(true);
    expect(layer.labels.find((l) => l.name === "CHROUT")?.description).toBe(
      "Write byte to output channel"
    );
  });

  it("lays out the three SID voices at seven-byte strides", () => {
    const byAddress = new Map(C64_SYMBOLS.map((s) => [s.address, s.name]));
    expect(byAddress.get(0xd400)).toBe("V1FREQLO");
    expect(byAddress.get(0xd407)).toBe("V2FREQLO");
    expect(byAddress.get(0xd40e)).toBe("V3FREQLO");
    expect(byAddress.get(0xd418)).toBe("SIGVOL");
  });
});
