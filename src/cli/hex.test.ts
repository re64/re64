import { describe, it, expect } from "vitest";
import { hexDump } from "./hex.js";
import { MemoryMap, BytesLayer, FileLayer } from "../core/index.js";

describe("hexDump", () => {
  it("formats a simple memory range", () => {
    const map = new MemoryMap();
    map.addLayer(
      new BytesLayer("data", 0x1000, new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]))
    );

    const output = hexDump(map, 0x1000, 5, { showLabels: false });
    expect(output).toContain("1000");
    expect(output).toContain("48 65 6C 6C 6F");
    expect(output).toContain("|Hello|");
  });

  it("shows unmapped bytes as dots", () => {
    const map = new MemoryMap();
    map.addLayer(new BytesLayer("data", 0x1002, new Uint8Array([0xaa, 0xbb])));

    const output = hexDump(map, 0x1000, 6, { showLabels: false });
    expect(output).toContain(".. .. AA BB .. ..");
  });

  it("formats multiple lines", () => {
    const map = new MemoryMap();
    const data = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      data[i] = i;
    }
    map.addLayer(new BytesLayer("data", 0x0000, data));

    const output = hexDump(map, 0x0000, 32, { showLabels: false });
    const lines = output.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^0000/);
    expect(lines[1]).toMatch(/^0010/);
  });

  it("respects bytesPerLine option", () => {
    const map = new MemoryMap();
    map.addLayer(new BytesLayer("fill", 0x0000, new Uint8Array([0xff]), 8));

    const output = hexDump(map, 0x0000, 8, { bytesPerLine: 4, showLabels: false });
    const lines = output.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("FF FF FF FF");
  });

  it("can hide ASCII column", () => {
    const map = new MemoryMap();
    map.addLayer(new BytesLayer("data", 0x1000, new Uint8Array([0x41])));

    const output = hexDump(map, 0x1000, 1, { showAscii: false, showLabels: false });
    expect(output).toMatch(/^1000\s+41/);
    expect(output).not.toContain("|");
  });

  it("shows non-printable characters as dots in ASCII", () => {
    const map = new MemoryMap();
    map.addLayer(new BytesLayer("data", 0x0000, new Uint8Array([0x00, 0x1f, 0x7f, 0x41])));

    const output = hexDump(map, 0x0000, 4, { showLabels: false });
    expect(output).toContain("|...A|");
  });
});

describe("hexDump with labels", () => {
  it("shows span labels for layer boundaries", () => {
    const map = new MemoryMap();
    map.addLayer(new BytesLayer("fill", 0x1000, new Uint8Array([0xff]), 16));

    const output = hexDump(map, 0x1000, 16);
    expect(output).toContain("1000 fill+$0000:");
  });

  it("shows entry labels for PRG files", () => {
    const map = new MemoryMap();
    map.addLayer(
      new FileLayer("file1", "game.prg", 0x0801, new Uint8Array([0x00, 0x0c]), undefined, true)
    );

    const output = hexDump(map, 0x0801, 2);
    expect(output).toContain("game:"); // Entry label should use file basename
  });

  it("interrupts lines at labels", () => {
    const map = new MemoryMap();
    // Two adjacent layers - should show labels at boundary
    map.addLayer(new BytesLayer("first", 0x1000, new Uint8Array([0xaa]), 4));
    map.addLayer(new BytesLayer("second", 0x1004, new Uint8Array([0xbb]), 4));

    const output = hexDump(map, 0x1000, 8, { bytesPerLine: 16 });
    const lines = output.split("\n");

    // Should have multiple lines due to label interruption
    expect(lines.length).toBeGreaterThan(1);
    expect(output).toContain("first+$0000:");
    expect(output).toContain("second+$0000:");
  });

  it("formats labels with address and trailing colon", () => {
    const map = new MemoryMap();
    map.addLayer(
      new FileLayer("file1", "test.prg", 0x1000, new Uint8Array([0x00]), undefined, true)
    );

    const output = hexDump(map, 0x1000, 1);
    expect(output).toContain("1000 test:"); // Label format: "ADDR name:"
  });
});
