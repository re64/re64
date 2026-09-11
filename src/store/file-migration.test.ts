import { fileId } from "../core/project/files.js";
import { applyOpToDoc } from "../core/crdt/ops.js";
import { describe, it, expect } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMemoryMap, makeFileLoader, parseProject, parseProjectAddress, type Project } from "../core/index.js";
import { runProgram } from "../core/il/program.js";
import { docFromProject, projectFromDoc, encodeDoc } from "../core/crdt/index.js";
import { importProject } from "./transfer.js";
import { ProjectStore } from "./project-store.js";
import { SqliteStorage } from "./sqlite-storage.js";
import { databaseFileBytes } from "./load.js";
import { hashBytes } from "./blobs.js";
describe("the Camels silver image through file migration", () => {
  it("preserves every target byte and capture hash across import and snapshot restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "re64-silver-files-"));
    let storage: SqliteStorage | undefined;
    try {
      const legacy = JSON.parse(readFileSync("assets/mutant-camels/camels.re64", "utf-8")) as Project;
      const disk = new Uint8Array(readFileSync("assets/mutant-camels/revenge-of-the-mutant-camels.d64"));
      const standalone = new Uint8Array(readFileSync("assets/mutant-camels/revenge-of-the-mutant-camels.prg"));
      const packed = buildMemoryMap({ layers: [{ type: "prg", path: "revenge.d64:revenge fixed" }] }, makeFileLoader(() => disk));
      const run = runProgram(packed.map, { from: 0x080d, maxInstructions: 20000000 });
      const runtime = new Uint8Array(2 + 0xc11f - 0x0801);
      runtime.set([1, 8]);
      runtime.set(run.memory.slice(0x0801, 0xc11f), 2);
      const resources: Record<string, Uint8Array> = { "revenge.d64": disk, "standalone.prg": standalone, "runtime.prg": runtime };
      for (const file of legacy.files!) {
        expect(hashBytes(resources[file.name]), file.name).toBe(file.hash);
        writeFileSync(join(dir, file.name), resources[file.name]);
      }
      const path = join(dir, "silver.re64");
      copyFileSync("assets/mutant-camels/camels.re64", path);
      const imported = importProject(path);
      storage = new SqliteStorage(imported.databasePath, imported.projectId);
      const store = new ProjectStore(storage);
      const migrated = projectFromDoc(store.document());
      expect(migrated.layers.map(l => l.id)).toEqual(legacy.layers.map(l => l.id));
      expect(migrated.layers.find(l => l.member)?.member).toBe("revenge fixed");
      for (const capture of migrated.captures ?? []) {
        const original = legacy.captures!.find(c => c.id === capture.id)!;
        expect(migrated.files!.find(f => f.id === capture.file)?.hash).toBe(legacy.files!.find(f => f.name === original.file)?.hash);
      }
      storage.writeSnapshot({ seqUpto: storage.readUpdates().at(-1)?.seq ?? 0, update: encodeDoc(docFromProject(migrated)) });
      storage.close();
      storage = new SqliteStorage(imported.databasePath, imported.projectId);
      const restarted = projectFromDoc(new ProjectStore(storage).document());
      // Construct the original memory directly from its path-based target recipe.
      // ROM availability is deliberately excluded: this checks project file bytes.
      const oldLoader = makeFileLoader(name => resources[name]);
      for (const target of legacy.targets!) {
        const expected: (number | undefined)[] = Array(65536).fill(undefined);
        for (const link of target.layers!) {
          const layer = legacy.layers.find(l => l.id === (typeof link === "string" ? link : link.layer))!;
          let start: number, data: Uint8Array;
          if (layer.path)
            ({ start, data } = oldLoader(layer.path));
          else if (layer.type === "bytes") {
            start = parseProjectAddress(layer.address!);
            data = new Uint8Array(Buffer.from(layer.bytes!.replace(/\s/g, ""), "hex"));
          }
          else
            continue;
          for (let i = 0; i < data.length; i++)
            expected[start + i] = data[i];
        }
        const loaded = buildMemoryMap(restarted, makeFileLoader(databaseFileBytes(storage, restarted.files)), { target: target.id });
        expect(loaded.map.readBytes(0, 65536), target.name).toEqual(expected);
      }
      expect(parseProject(storage.readText()).files!.every(f => f.id)).toBe(true);
    }
    finally {
      storage?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("persists old snapshot identities before later edits reference them", () => {
    const dir = mkdtempSync(join(tmpdir(), "re64-old-files-"));
    const path = join(dir, "old.re64db");
    let storage = new SqliteStorage(path, "old");
    try {
      storage.initialize(JSON.stringify({ layers: [] }), 0, "old");
      const original = new Uint8Array([0, 128, 96]);
      const hash = storage.putBlob("game.prg", original);
      storage.putBlob("game.prg", new Uint8Array([0, 128, 234]));
      // Frozen pre-identity snapshot: name-keyed file and path-based layer.
      const snapshot = "AQgbACcBBWZpbGVzCGdhbWUucHJnASgAGwAEbmFtZQF3CGdhbWUucHJnKAAbAARoYXNoAXdANDdkY2Q5ZWQxZDZjMjlmZTEzYWY0ZmY1YTM1ZDUzZjFmM2EwODQwMDAzZTJkYzg3N2JkYTVkZDQ1YjM0Y2RmMCgAGwAEc2l6ZQF9AwcBBmxheWVycwEoABsEAmlkAXcHbGF5X29sZCgAGwQEdHlwZQF3A3ByZygAGwQEcGF0aAF3CGdhbWUucHJnAA==";
      storage.writeSnapshot({seqUpto:0,update:new Uint8Array(Buffer.from(snapshot,"base64"))});
      const store = new ProjectStore(storage);
      applyOpToDoc(store.document(), { op: "file.set", id: fileId("game.prg"), fields: { name: "earlier.prg" } }, "reader");
      store.writeFile();
      storage.close();
      storage = new SqliteStorage(path, "old");
      const again = projectFromDoc(new ProjectStore(storage).document());
      expect(again.files).toEqual([{ id: fileId("game.prg"), name: "earlier.prg", hash, size: original.length }]);
      expect(again.layers[0]).toMatchObject({ id: "lay_old", file: fileId("game.prg") });
      expect(databaseFileBytes(storage, again.files)(fileId("game.prg"))).toEqual(original);
    }
    finally {
      storage.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
