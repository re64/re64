import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { listDirectory, extractFile, findFile } from "./d64.js";

const d64Path = "assets/mutant-camels/revenge-of-the-mutant-camels.d64";

describe("d64", () => {
  const image = new Uint8Array(readFileSync(d64Path));

  describe("listDirectory", () => {
    it("lists files on disk", () => {
      const entries = listDirectory(image);
      expect(entries.length).toBeGreaterThan(0);
    });

    it("finds expected files", () => {
      const entries = listDirectory(image);
      const filenames = entries.map((e) => e.filename.toLowerCase());

      // Should have two files based on our earlier inspection
      expect(entries.length).toBe(2);
      expect(filenames).toContain("revenge fixed");
      expect(filenames).toContain("attack mutant.hi");
    });

    it("identifies PRG files", () => {
      const entries = listDirectory(image);
      const prgs = entries.filter((e) => e.type === "prg");
      expect(prgs.length).toBeGreaterThan(0);
    });
  });

  describe("findFile", () => {
    it("finds file by name (case insensitive)", () => {
      const entry = findFile(image, "REVENGE FIXED");
      expect(entry).toBeDefined();
      expect(entry?.type).toBe("prg");
    });

    it("returns undefined for non-existent file", () => {
      const entry = findFile(image, "NONEXISTENT");
      expect(entry).toBeUndefined();
    });
  });

  describe("extractFile", () => {
    it("extracts PRG file with correct load address", () => {
      const entry = findFile(image, "REVENGE FIXED");
      expect(entry).toBeDefined();

      const data = extractFile(image, entry!);
      expect(data.length).toBeGreaterThan(2);

      // PRG files start with 2-byte load address
      const loadAddress = data[0] | (data[1] << 8);
      expect(loadAddress).toBeGreaterThan(0);
      expect(loadAddress).toBeLessThan(0x10000);
    });

    it("extracts file with expected size from directory", () => {
      const entry = findFile(image, "REVENGE FIXED");
      expect(entry).toBeDefined();

      const data = extractFile(image, entry!);

      // Size should be roughly sizeInSectors * 254 bytes (some slack for last sector)
      const minSize = (entry!.sizeInSectors - 1) * 254;
      const maxSize = entry!.sizeInSectors * 254;
      expect(data.length).toBeGreaterThanOrEqual(minSize);
      expect(data.length).toBeLessThanOrEqual(maxSize);
    });
  });
});
