import { describe, it, expect } from "vitest";
import { MemoryMap } from "./memory-map.js";
import { BytesLayer } from "./layer.js";
import { SymbolLayer } from "./symbol-layer.js";
import { createPlatformLabel, createUserLabel, LABEL_RANK } from "./label.js";
import { createC64PlatformLayer, C64_SYMBOLS } from "../c64/symbols.js";

describe("SymbolLayer", () => {
  it("supplies no bytes and never shadows", () => {
    const map = new MemoryMap();
    map.addLayer(new BytesLayer("data", 0x1000, new Uint8Array([0xaa]), 0x10));
    map.addLayer(new SymbolLayer("syms", [createPlatformLabel("lbl_platform1000", 0x1000, "SOMETHING")]));

    // Symbol layer was added last, so it is on top — and must still not shadow.
    expect(map.readByte(0x1000)).toBe(0xaa);
    expect(map.readByteWithSource(0x1000)?.layer.name).toBe("data");
  });

  it("contributes labels regardless of having no range", () => {
    const map = new MemoryMap();
    map.addLayer(new SymbolLayer("syms", [createPlatformLabel("lbl_platformd020", 0xd020, "EXTCOL")]));

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
    map.addLayer(new SymbolLayer("c64", [createPlatformLabel("lbl_platformffd2", 0xffd2, "CHROUT")]));
    map.addLayer(new SymbolLayer("project", [createUserLabel("lbl_userffd2", 0xffd2, "ROM_CHROUT", "address")]));

    expect(map.getLabels().resolve(0xffd2)?.label.name).toBe("ROM_CHROUT");
  });

  it("resolves by rank rather than insertion order", () => {
    // The platform label is added last; insertion order would have let it win.
    const map = new MemoryMap();
    map.addLayer(new SymbolLayer("project", [createUserLabel("lbl_userd016", 0xd016, "VIC_CTRL2", "address")]));
    map.addLayer(new SymbolLayer("c64", [createPlatformLabel("lbl_platformd016", 0xd016, "SCROLX")]));

    expect(map.getLabels().resolve(0xd016)?.label.name).toBe("VIC_CTRL2");
    expect(LABEL_RANK.user).toBeGreaterThan(LABEL_RANK.platform);
  });

  it("orders every source kind unambiguously", () => {
    const ranks = Object.values(LABEL_RANK);
    expect(new Set(ranks).size).toBe(ranks.length);
    expect(LABEL_RANK.user).toBeGreaterThan(LABEL_RANK.region);
    expect(LABEL_RANK.region).toBeGreaterThan(LABEL_RANK.layer);
    expect(LABEL_RANK.layer).toBeGreaterThan(LABEL_RANK.platform);
    expect(LABEL_RANK.platform).toBeGreaterThan(LABEL_RANK.auto);
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
    // Cross-checked against assets/gridrunner.asm, which was produced without
    // this table: a wrong entry here would silently mislabel operands.
    const layer = createC64PlatformLayer();
    const byAddress = new Map(layer.getLabels().map((l) => [l.address, l.name]));

    expect(byAddress.get(0xffd2)).toBe("CHROUT");
    expect(byAddress.get(0xfd15)).toBe("ROM_RESTOR");
    expect(byAddress.get(0xfd50)).toBe("ROM_RAMTAS");
    expect(byAddress.get(0xfda3)).toBe("ROM_IOINIT");
    expect(byAddress.get(0xd800)).toBe("COLOR_RAM");
    expect(byAddress.get(0x0400)).toBe("SCREEN_RAM");
  });

  it("lays out the three SID voices at seven-byte strides", () => {
    const byAddress = new Map(C64_SYMBOLS.map((s) => [s.address, s.name]));
    expect(byAddress.get(0xd400)).toBe("V1FREQLO");
    expect(byAddress.get(0xd407)).toBe("V2FREQLO");
    expect(byAddress.get(0xd40e)).toBe("V3FREQLO");
    expect(byAddress.get(0xd418)).toBe("SIGVOL");
  });
});
