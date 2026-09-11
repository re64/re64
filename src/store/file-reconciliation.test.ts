import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStorage, ProjectStore, SqliteStorage, pathsFor, hashBytes } from "./index.js";
import { projectFromDoc } from "../core/crdt/index.js";
import { parseProject } from "../core/index.js";
import { Workspace } from "../server/workspace.js";

const bytes = new Uint8Array([0, 128, 96]);
const original = () => ({
  name: "Original",
  layers: [{ id: "lay_a", type: "bytes", address: "$8000", bytes: "60" }],
  files: [{ id: "fil_modern", name: "game.prg", hash: hashBytes(bytes), size: 3 }],
});

for (const database of [false, true]) {
  describe(database ? "SQLite reconciliation" : "file reconciliation", () => {
    function open() {
      const dir = mkdtempSync(join(tmpdir(), "re64-reconcile-files-"));
      const path = join(dir, database ? "p.re64db" : "p.re64");
      const storage = database ? new SqliteStorage(path, "p") : new FileStorage(pathsFor(path));
      if (storage instanceof SqliteStorage) {
        storage.initialize(JSON.stringify(original()), 0, "p");
        storage.putBlob("game.prg", bytes);
      }
      else writeFileSync(path, JSON.stringify(original()));
      const store = new ProjectStore(storage);
      store.document();
      return { path, storage, store, close() {
        if (storage instanceof SqliteStorage) storage.close();
        rmSync(dir, { recursive: true, force: true });
      }};
    }

    it("keeps the content, accepts renames and unrelated edits, and survives retry/reopen", () => {
      const f = open();
      try {
        const incoming = original();
        incoming.files[0] = { ...incoming.files[0], name: "renamed.prg", hash: "b".repeat(64), size: 99 };
        f.storage.writeText(JSON.stringify(incoming));
        f.store.runOps([{ op: "meta.set", key: "name", value: "First" }], "reader", 1);
        expect(projectFromDoc(f.store.document()).files).toEqual([{ ...original().files[0], name: "renamed.prg" }]);
        expect(f.store.rejectedFileChanges()).toMatchObject([{ file: "fil_modern", retained: { size: 3 }, rejected: { size: 99 } }]);
        f.store.runOps([{ op: "meta.set", key: "name", value: "Second" }], "reader", 2);
        const reopened = new ProjectStore(f.storage);
        expect(projectFromDoc(reopened.document()).name).toBe("Second");
        expect(projectFromDoc(reopened.document()).files![0].hash).toBe(original().files[0].hash);
        expect(parseProject(f.storage.readText()).files![0].hash).toBe(original().files[0].hash);
        // Export regeneration must not erase the process-local diagnostic.
        const workspace = new Workspace({ store: f.store, storage: f.storage, projectPath: f.path, projectId: "p" });
        expect(workspace.describe().hygiene).toEqual(expect.arrayContaining([
          expect.objectContaining({ kind: "rejected-file-content", subjects: [{ id: "fil_modern" }] }),
        ]));
      } finally { f.close(); }
    });

    it("repairs an export containing only a rejected size change and reports it until new input", () => {
      const f = open();
      try {
        const incoming = original();
        incoming.files[0].size = 99;
        f.storage.writeText(JSON.stringify(incoming));
        expect(f.store.writeFile()).toEqual([]);
        expect(parseProject(f.storage.readText()).files![0].size).toBe(3);
        expect(f.store.rejectedFileChanges()).toHaveLength(1);
        f.store.writeFile();
        expect(f.store.rejectedFileChanges()).toHaveLength(1);
        const valid = parseProject(f.storage.readText());
        valid.name = "Accepted";
        f.storage.writeText(JSON.stringify(valid));
        f.store.writeFile();
        expect(f.store.rejectedFileChanges()).toEqual([]);
        expect(projectFromDoc(f.store.document()).name).toBe("Accepted");
      } finally { f.close(); }
    });
  });
}
