import { describe, it, expect } from "vitest";
import { hexDump } from "./hex.js";
import { MemoryMap, ArrayLayer, ConstantLayer } from "../core/index.js";

describe("hexDump", () => {
  it("formats a simple memory range", () => {
    const map = new MemoryMap();
    map.addLayer(
      new ArrayLayer("data", 0x1000, new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]))
    );

    const output = hexDump(map, 0x1000, 5);
    expect(output).toContain("1000");
    expect(output).toContain("48 65 6C 6C 6F");
    expect(output).toContain("|Hello|");
  });

  it("shows unmapped bytes as dots", () => {
    const map = new MemoryMap();
    map.addLayer(new ArrayLayer("data", 0x1002, new Uint8Array([0xaa, 0xbb])));

    const output = hexDump(map, 0x1000, 6);
    expect(output).toContain(".. .. AA BB .. ..");
  });

  it("formats multiple lines", () => {
    const map = new MemoryMap();
    const data = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      data[i] = i;
    }
    map.addLayer(new ArrayLayer("data", 0x0000, data));

    const output = hexDump(map, 0x0000, 32);
    const lines = output.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^0000/);
    expect(lines[1]).toMatch(/^0010/);
  });

  it("respects bytesPerLine option", () => {
    const map = new MemoryMap();
    map.addLayer(new ConstantLayer("fill", 0x0000, 8, 0xff));

    const output = hexDump(map, 0x0000, 8, { bytesPerLine: 4 });
    const lines = output.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("FF FF FF FF");
  });

  it("can hide ASCII column", () => {
    const map = new MemoryMap();
    map.addLayer(new ArrayLayer("data", 0x1000, new Uint8Array([0x41])));

    const output = hexDump(map, 0x1000, 1, { showAscii: false });
    expect(output).toMatch(/^1000\s+41/);
    expect(output).not.toContain("|");
  });

  it("shows non-printable characters as dots in ASCII", () => {
    const map = new MemoryMap();
    map.addLayer(new ArrayLayer("data", 0x0000, new Uint8Array([0x00, 0x1f, 0x7f, 0x41])));

    const output = hexDump(map, 0x0000, 4);
    expect(output).toContain("|...A|");
  });
});
