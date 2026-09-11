import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashBytes, normalizeBlobName } from "./blobs.js";
import { SqliteStorage } from "./sqlite-storage.js";
import { databaseFileBytes } from "./load.js";
import { parseProject } from "../core/index.js";
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
    copyFileSync("assets/gridrunner/gridrunner.re64", projectPath);
    copyFileSync("assets/gridrunner/gridrunner.prg", join(dir, "gridrunner.prg"));

    const { databasePath, files } = importProject(projectPath);
    expect(files).toEqual(["gridrunner.prg"]);

    rmSync(join(dir, "gridrunner.prg"));
    const loaded = loadProjectFromDatabase(databasePath);
    expect(analyze(loaded, { annotations: false }).stats.instructions).toBe(1481);
  });

  it("brings a whole disk image across, not the file inside it", () => {
    // A layer sourced from "disk.d64:name" needs the image, since extracting
    // the entry happens above the byte layer.
    const projectPath = join(dir, "camels.re64");
    copyFileSync(
      "assets/mutant-camels/revenge-of-the-mutant-camels.d64",
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

  it("keeps the file records an import did not put there", () => {
    // **`wanted` is the layer sources, and the registry is not.** A capture,
    // or anything else the project recorded, is not a layer source — and
    // assigning `files` from the layer sources threw those records away on
    // import, silently, with the file still beside the project.
    const projectPath = join(dir, "gridrunner.re64");
    const original = JSON.parse(
      readFileSync("assets/gridrunner/gridrunner.re64", "utf-8")
    ) as { files?: unknown[] };
    original.files = [{ name: "capture.png", hash: "ab".repeat(32), size: 3 }];
    writeFileSync(projectPath, JSON.stringify(original), "utf-8");
    copyFileSync("assets/gridrunner/gridrunner.prg", join(dir, "gridrunner.prg"));

    const { databasePath, projectId } = importProject(projectPath);
    const storage = new SqliteStorage(databasePath, projectId);
    try {
      const files = parseProject(storage.readText()).files ?? [];
      expect(files.map((f) => f.name)).toEqual(["capture.png", "gridrunner.prg"]);
      // The record it carried is as it carried it; the one it lacked is real.
      expect(files[0].hash).toBe("ab".repeat(32));
      expect(files[1].hash).toBe(storage.blobHash("gridrunner.prg"));
    } finally {
      storage.close();
    }
  });

  it("resolves a recorded name however it is spelled, and never past its record", () => {
    const projectPath = join(dir, "gridrunner.re64");
    copyFileSync("assets/gridrunner/gridrunner.re64", projectPath);
    copyFileSync("assets/gridrunner/gridrunner.prg", join(dir, "gridrunner.prg"));
    const { databasePath, projectId } = importProject(projectPath);
    const storage = new SqliteStorage(databasePath, projectId);
    try {
      const files = parseProject(storage.readText()).files ?? [];
      // Uploaded over the name and not recorded: the window the name table
      // exists for, and one a different spelling must not walk through.
      storage.putBlob("gridrunner.prg", new Uint8Array([1, 2, 3]));
      const read = databaseFileBytes(storage, files);
      expect(read("gridrunner.prg").length).toBe(4098);
      expect(read("./gridrunner.prg").length).toBe(4098);

      // Recorded, and the bytes gone: missing content, said as such — not the
      // name table's bytes, and not "no file called".
      storage.putBlob("gridrunner.prg", new Uint8Array([1, 2, 3]));
      const stale = [{ name: "gridrunner.prg", hash: "0".repeat(64) }];
      expect(() => databaseFileBytes(storage, stale)("gridrunner.prg")).toThrow(
        /records "gridrunner\.prg" as 000000000000/
      );
    } finally {
      storage.close();
    }
  });

  it("imports a file whose layers have no ids and whose entry points are at the root", () => {
    // The two legacy shapes together, which is how the oldest files look. The
    // migration links a target to derived layer ids and the import then mints
    // real ones; the links have to follow, or the selected target links nothing
    // and the stack loads empty — which is what a review reproduced.
    const projectPath = join(dir, "oldest.re64");
    copyFileSync("assets/gridrunner/gridrunner.prg", join(dir, "gridrunner.prg"));
    writeFileSync(
      projectPath,
      JSON.stringify({ name: "Oldest", layers: [{ type: "prg", path: "gridrunner.prg" }], entryPoints: ["$8011"] }),
      "utf-8"
    );
    const { databasePath } = importProject(projectPath);
    const loaded = loadProjectFromDatabase(databasePath);
    expect(loaded.map.getLayers().filter((l) => l.hasBytes)).toHaveLength(1);
    expect(loaded.project.entryPoints).toEqual(["$8011"]);
    expect(loaded.project.targets![0].layers.map((l) => (typeof l === "string" ? l : l.layer))).toEqual([
      loaded.project.layers[0].id,
    ]);
  });

  it("says what it holds when asked for something else", () => {
    const projectPath = join(dir, "gridrunner.re64");
    copyFileSync("assets/gridrunner/gridrunner.re64", projectPath);
    copyFileSync("assets/gridrunner/gridrunner.prg", join(dir, "gridrunner.prg"));
    const { databasePath, projectId } = importProject(projectPath);

    const storage = new SqliteStorage(databasePath, projectId);
    storage.writeText(storage.readText().replace("gridrunner.prg", "renamed.prg"));
    storage.close();

    expect(() => loadProjectFromDatabase(databasePath)).toThrow(
      /holds no file called "renamed\.prg".*It has: gridrunner\.prg/s
    );
  });
});
