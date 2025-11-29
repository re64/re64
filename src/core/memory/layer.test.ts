import { describe, it, expect } from "vitest";
import { BytesLayer } from "./layer.js";

describe("BytesLayer", () => {
  it("returns bytes from data for addresses in range", () => {
    const data = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const layer = new BytesLayer("data", 0x2000, data);

    expect(layer.readByte(0x2000)).toBe(0x01);
    expect(layer.readByte(0x2001)).toBe(0x02);
    expect(layer.readByte(0x2002)).toBe(0x03);
    expect(layer.readByte(0x2003)).toBe(0x04);
  });

  it("returns undefined for addresses outside range", () => {
    const data = new Uint8Array([0x01, 0x02]);
    const layer = new BytesLayer("data", 0x2000, data);

    expect(layer.readByte(0x1fff)).toBeUndefined();
    expect(layer.readByte(0x2002)).toBeUndefined();
  });

  it("computes length from data when not specified", () => {
    const data = new Uint8Array(256);
    const layer = new BytesLayer("data", 0x0800, data);

    expect(layer.length).toBe(256);
    expect(layer.end).toBe(0x0900);
  });

  it("repeats data to fill specified length", () => {
    const data = new Uint8Array([0xaa, 0xbb]);
    const layer = new BytesLayer("pattern", 0x1000, data, 6);

    expect(layer.length).toBe(6);
    expect(layer.readByte(0x1000)).toBe(0xaa);
    expect(layer.readByte(0x1001)).toBe(0xbb);
    expect(layer.readByte(0x1002)).toBe(0xaa);
    expect(layer.readByte(0x1003)).toBe(0xbb);
    expect(layer.readByte(0x1004)).toBe(0xaa);
    expect(layer.readByte(0x1005)).toBe(0xbb);
    expect(layer.readByte(0x1006)).toBeUndefined();
  });

  it("can fill with a single byte (constant fill)", () => {
    const data = new Uint8Array([0xff]);
    const layer = new BytesLayer("fill", 0x1000, data, 0x100);

    expect(layer.length).toBe(0x100);
    expect(layer.readByte(0x1000)).toBe(0xff);
    expect(layer.readByte(0x1050)).toBe(0xff);
    expect(layer.readByte(0x10ff)).toBe(0xff);
    expect(layer.readByte(0x1100)).toBeUndefined();
  });

  it("truncates data if length is shorter than data", () => {
    const data = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const layer = new BytesLayer("short", 0x1000, data, 2);

    expect(layer.length).toBe(2);
    expect(layer.readByte(0x1000)).toBe(0x01);
    expect(layer.readByte(0x1001)).toBe(0x02);
    expect(layer.readByte(0x1002)).toBeUndefined();
  });

  it("validates empty data", () => {
    expect(() => new BytesLayer("bad", 0, new Uint8Array([]))).toThrow(
      "Data must not be empty"
    );
  });

  it("validates address range", () => {
    expect(() => new BytesLayer("bad", -1, new Uint8Array([0]))).toThrow();
    expect(() => new BytesLayer("bad", 0x10000, new Uint8Array([0]))).toThrow();
  });

  it("validates length", () => {
    expect(() => new BytesLayer("bad", 0, new Uint8Array([0]), 0)).toThrow();
    expect(() => new BytesLayer("bad", 0, new Uint8Array([0]), -1)).toThrow();
  });

  it("prevents exceeding address space", () => {
    expect(
      () => new BytesLayer("bad", 0xff00, new Uint8Array([0]), 0x101)
    ).toThrow();
  });
});
