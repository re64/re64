import { describe, it, expect } from "vitest";
import { ConstantLayer, ArrayLayer } from "./layer.js";

describe("ConstantLayer", () => {
  it("returns constant value for addresses in range", () => {
    const layer = new ConstantLayer("zeros", 0x1000, 0x100, 0x00);
    expect(layer.readByte(0x1000)).toBe(0x00);
    expect(layer.readByte(0x1050)).toBe(0x00);
    expect(layer.readByte(0x10ff)).toBe(0x00);
  });

  it("returns undefined for addresses outside range", () => {
    const layer = new ConstantLayer("fill", 0x1000, 0x100, 0xff);
    expect(layer.readByte(0x0fff)).toBeUndefined();
    expect(layer.readByte(0x1100)).toBeUndefined();
  });

  it("validates value range", () => {
    expect(() => new ConstantLayer("bad", 0, 1, -1)).toThrow();
    expect(() => new ConstantLayer("bad", 0, 1, 0x100)).toThrow();
  });

  it("validates address range", () => {
    expect(() => new ConstantLayer("bad", -1, 1, 0)).toThrow();
    expect(() => new ConstantLayer("bad", 0x10000, 1, 0)).toThrow();
  });

  it("validates length", () => {
    expect(() => new ConstantLayer("bad", 0, 0, 0)).toThrow();
    expect(() => new ConstantLayer("bad", 0, -1, 0)).toThrow();
  });

  it("prevents exceeding address space", () => {
    expect(() => new ConstantLayer("bad", 0xff00, 0x101, 0)).toThrow();
  });

  it("computes end address correctly", () => {
    const layer = new ConstantLayer("test", 0x1000, 0x100, 0);
    expect(layer.start).toBe(0x1000);
    expect(layer.end).toBe(0x1100);
    expect(layer.length).toBe(0x100);
  });
});

describe("ArrayLayer", () => {
  it("returns bytes from array for addresses in range", () => {
    const data = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const layer = new ArrayLayer("data", 0x2000, data);

    expect(layer.readByte(0x2000)).toBe(0x01);
    expect(layer.readByte(0x2001)).toBe(0x02);
    expect(layer.readByte(0x2002)).toBe(0x03);
    expect(layer.readByte(0x2003)).toBe(0x04);
  });

  it("returns undefined for addresses outside range", () => {
    const data = new Uint8Array([0x01, 0x02]);
    const layer = new ArrayLayer("data", 0x2000, data);

    expect(layer.readByte(0x1fff)).toBeUndefined();
    expect(layer.readByte(0x2002)).toBeUndefined();
  });

  it("computes length from array", () => {
    const data = new Uint8Array(256);
    const layer = new ArrayLayer("data", 0x0800, data);

    expect(layer.length).toBe(256);
    expect(layer.end).toBe(0x0900);
  });
});
