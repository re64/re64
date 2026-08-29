import { describe, it, expect } from "vitest";
import { blobPaths, makeFileLoader, splitD64Path } from "./file-source.js";
import { Project } from "./project.js";

/**
 * This module decides which bytes a layer gets. It grew a test suite late,
 * when three separate copies of its rules were collapsed into it — the D64 form
 * was previously detected by a suffix check here, a bare `includes(":")` in the
 * CLI, and a substring `.d64:` in the map view.
 */

describe("splitD64Path", () => {
  it("splits an image and an entry", () => {
    expect(splitD64Path("disk.d64:LOADER")).toEqual({ image: "disk.d64", entry: "LOADER" });
  });

  it("accepts the extension in any case", () => {
    expect(splitD64Path("DISK.D64:loader")?.image).toBe("DISK.D64");
  });

  it("keeps spaces in an entry name", () => {
    // C64 filenames routinely contain them.
    expect(splitD64Path("game.d64:revenge fixed")?.entry).toBe("revenge fixed");
  });

  it("is not fooled by a plain path", () => {
    expect(splitD64Path("game.prg")).toBeNull();
    expect(splitD64Path("some/dir/game.prg")).toBeNull();
  });

  it("ignores a colon that does not follow a .d64", () => {
    // A Windows drive letter, or a directory with a colon in its name.
    expect(splitD64Path("C:/games/game.prg")).toBeNull();
    expect(splitD64Path("odd:dir/game.prg")).toBeNull();
  });

  it("refuses a leading colon rather than reading an empty image name", () => {
    expect(splitD64Path(":LOADER")).toBeNull();
  });

  it("splits on the last colon, which an entry name therefore cannot contain", () => {
    // The cost of using the last colon rather than the first, and worth it:
    // the first would break "C:/games/disk.d64:LOADER" on Windows, while a
    // colon inside a C64 filename is vanishingly rare.
    expect(splitD64Path("disk.d64:odd:name")).toBeNull();
    expect(splitD64Path("C:/games/disk.d64:LOADER")).toEqual({
      image: "C:/games/disk.d64",
      entry: "LOADER",
    });
  });
});

describe("blobPaths", () => {
  const project = (paths: (string | undefined)[]): Project => ({
    layers: paths.map((path) => ({ type: "prg" as const, path })),
  });

  it("collapses a d64 entry to the image that holds it", () => {
    expect(blobPaths(project(["disk.d64:ONE", "disk.d64:TWO"]))).toEqual(["disk.d64"]);
  });

  it("reports each distinct file once", () => {
    expect(blobPaths(project(["a.prg", "a.prg", "b.prg"]))).toEqual(["a.prg", "b.prg"]);
  });

  it("skips layers that name no file", () => {
    expect(blobPaths(project(["a.prg", undefined]))).toEqual(["a.prg"]);
  });
});

describe("makeFileLoader", () => {
  const PRG = new Uint8Array([0x00, 0x10, 0xaa, 0xbb, 0xcc]);
  const load = (bytes: Record<string, Uint8Array>) =>
    makeFileLoader((path) => {
      const found = bytes[path];
      if (!found) throw new Error(`no bytes for ${path}`);
      return found;
    });

  it("takes the load address from the first two bytes, little-endian", () => {
    const { start, data, isPrg } = load({ "g.prg": PRG })("g.prg");
    expect(start).toBe(0x1000);
    expect([...data]).toEqual([0xaa, 0xbb, 0xcc]);
    expect(isPrg).toBe(true);
  });

  it("keeps every byte when an explicit address says it is not a PRG", () => {
    const { start, data, isPrg } = load({ "g.bin": PRG })("g.bin", 0x2000);
    expect(start).toBe(0x2000);
    expect([...data]).toEqual([...PRG]);
    expect(isPrg).toBe(false);
  });

  it("reads the image, not the composite path, for a d64 entry", () => {
    const asked: string[] = [];
    const loader = makeFileLoader((path) => {
      asked.push(path);
      throw new Error("stop");
    });
    expect(() => loader("disk.d64:LOADER")).toThrow();
    expect(asked).toEqual(["disk.d64"]);
  });

  it("names a file too short to carry a load address", () => {
    expect(() => load({ "t.prg": new Uint8Array([1, 2]) })("t.prg")).toThrow(
      /too small to be a PRG: t\.prg/
    );
  });
});
