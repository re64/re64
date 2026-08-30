import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashBytes, normalizeBlobName } from "./blobs.js";
import { SqliteStorage } from "./sqlite-storage.js";
import { importProject } from "./transfer.js";
import { loadProjectFromDatabase } from "./load.js";
import { analyze } from "../core/index.js";

describe("normalizeBlobName", () => {
  it("leaves a plain name alone", () => {
    expect(normalizeBlobName("game.prg")).toBe("game.prg");
    expect(normalizeBlobName("sub/game.prg")).toBe("sub/game.prg");
  });

  it("spells one file one way", () => {
    // On disk these are the same file; as table keys they would be three rows,
    // and two of them would never be found again.
    expect(normalizeBlobName("./game.prg")).toBe("game.prg");
    expect(normalizeBlobName("sub//game.prg")).toBe("sub/game.prg");
    expect(normalizeBlobName("sub\\game.prg")).toBe("sub/game.prg");
  });

  it("refuses to reach outside the project", () => {
    // There is no outside once the bytes are in the database, so resolving it
    // would only invent a name nobody can look up.
    expect(() => normalizeBlobName("../shared/kernal.rom")).toThrow(/outside the project/);
  });

  it("refuses a name with nothing in it", () => {
    expect(() => normalizeBlobName("./")).toThrow(/not a file name/);
  });
});

describe("storing binaries", () => {
  let dir: string;
  let storage: SqliteStorage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "re64-blobs-"));
    storage = new SqliteStorage(join(dir, "t.re64db"));
  });
  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("gives back exactly what went in", () => {
    const bytes = new Uint8Array([0x01, 0x08, 0xff, 0x00]);
    storage.putBlob("game.prg", bytes);
    expect([...storage.blob("game.prg")!]).toEqual([...bytes]);
  });

  it("keeps one copy when two names hold the same bytes", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const first = storage.putBlob("a.prg", bytes);
    const second = storage.putBlob("b.prg", bytes);

    expect(first).toBe(second);
    expect(storage.blobNames()).toEqual(["a.prg", "b.prg"]);
    expect(storage.blobHash("a.prg")).toBe(hashBytes(bytes));
  });

  it("finds a file however its name is spelled", () => {
    storage.putBlob("./sub/game.prg", new Uint8Array([9]));
    expect(storage.blob("sub/game.prg")).toBeDefined();
    expect(storage.blobNames()).toEqual(["sub/game.prg"]);
  });

  it("replaces the bytes when a name is reused", () => {
    storage.putBlob("game.prg", new Uint8Array([1]));
    storage.putBlob("game.prg", new Uint8Array([2]));
    expect([...storage.blob("game.prg")!]).toEqual([2]);
  });

  it("holds nothing under a name it was never given", () => {
    expect(storage.blob("absent.prg")).toBeUndefined();
  });
});

describe("a project that carries its own binaries", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "re64-selfcontained-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("disassembles with the binary deleted from disk", () => {
    const projectPath = join(dir, "gridrunner.re64");
    copyFileSync("assets/gridrunner.re64", projectPath);
    copyFileSync("assets/gridrunner.prg", join(dir, "gridrunner.prg"));

    const { databasePath, files } = importProject(projectPath);
    expect(files).toEqual(["gridrunner.prg"]);

    rmSync(join(dir, "gridrunner.prg"));
    const loaded = loadProjectFromDatabase(databasePath);
    expect(analyze(loaded, { annotations: false }).stats.instructions).toBe(1480);
  });

  it("brings a whole disk image across, not the file inside it", () => {
    // A layer sourced from "disk.d64:name" needs the image, since extracting
    // the entry happens above the byte layer.
    const projectPath = join(dir, "camels.re64");
    copyFileSync(
      "assets/revenge-of-the-mutant-camels.d64",
      join(dir, "revenge-of-the-mutant-camels.d64")
    );
    writeFileSync(
      projectPath,
      JSON.stringify({
        layers: [
          {
            id: "lay_a",
            type: "prg",
            path: "revenge-of-the-mutant-camels.d64:revenge fixed",
          },
        ],
      }),
      "utf-8"
    );

    const { databasePath, files } = importProject(projectPath);
    expect(files).toEqual(["revenge-of-the-mutant-camels.d64"]);

    rmSync(join(dir, "revenge-of-the-mutant-camels.d64"));
    const loaded = loadProjectFromDatabase(databasePath);
    expect(loaded.prgEntries).toEqual([0x0801]);
  });

  it("fails the import rather than leaving a database it cannot read", () => {
    const projectPath = join(dir, "missing.re64");
    writeFileSync(
      projectPath,
      JSON.stringify({ layers: [{ type: "prg", path: "nowhere.prg" }] }),
      "utf-8"
    );
    expect(() => importProject(projectPath)).toThrow();
  });

  it("says what it holds when asked for something else", () => {
    const projectPath = join(dir, "gridrunner.re64");
    copyFileSync("assets/gridrunner.re64", projectPath);
    copyFileSync("assets/gridrunner.prg", join(dir, "gridrunner.prg"));
    const { databasePath, projectId } = importProject(projectPath);

    const storage = new SqliteStorage(databasePath, projectId);
    storage.writeText(storage.readText().replace("gridrunner.prg", "renamed.prg"));
    storage.close();

    expect(() => loadProjectFromDatabase(databasePath)).toThrow(
      /holds no file called "renamed\.prg".*It has: gridrunner\.prg/s
    );
  });
});
