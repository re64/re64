import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectSessionStore, pathsFor } from "./session-store.js";
import { applyOpToDoc, projectFromDoc } from "../core/crdt/index.js";
import { Op, applyOps } from "../core/ops/index.js";
import { writeFileAtomic } from "../fsutil.js";

/**
 * The server is not the only writer. `re64 label set` edits the file directly,
 * as does anyone with an editor open. Without the store noticing, its next
 * write computes the difference between its document and the file in the wrong
 * direction and silently reverts them.
 */

const PROJECT = `{
  "name": "Test",
  "layers": [
    {
      "id": "lay_a",
      "type": "bytes",
      "address": "$8000",
      "bytes": "ea",
      "length": 16,
      "labels": [
        { "id": "lbl_1", "address": "$8000", "name": "Start", "type": "function" },

        { "id": "lbl_2", "address": "$8004", "name": "Loop" }
      ]
    }
  ]
}
`;

let dir: string;
let projectPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "re64-external-"));
  projectPath = join(dir, "test.re64");
  writeFileSync(projectPath, PROJECT, "utf-8");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const labelNames = (s: ProjectSessionStore) =>
  (projectFromDoc(s.document()).layers[0].labels ?? []).map((l) => l.name);

/** Wait past the watcher's debounce, which absorbs a burst of save events. */
const settle = () => new Promise((r) => setTimeout(r, 400));

function watching(s: ProjectSessionStore): void {
  s.watchFile((ops: Op[]) => {
    for (const op of ops) s.applyExternalOp(op);
  });
}

describe("edits made to the file by someone else", () => {
  it("survives the server's next write rather than being reverted", async () => {
    const s = store();
    watching(s);

    // A session edit, which writes the file.
    applyOpToDoc(s.document(), {
      op: "label.set", id: "lbl_1", layerId: "lay_a", address: 0x8000,
      name: "FromWeb", type: "function",
    });
    s.writeFile();

    // Someone edits the file directly, the way the CLI does.
    writeFileAtomic(projectPath, readFileSync(projectPath, "utf-8").replace('"Loop"', '"FromCli"'));
    await settle();

    // A second session edit, whose write is where the revert used to happen.
    applyOpToDoc(s.document(), {
      op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "FromCli",
      comment: "touched again",
    });
    s.writeFile();

    const text = readFileSync(projectPath, "utf-8");
    expect(text).toContain("FromWeb");
    expect(text).toContain("FromCli");
    s.stopWatching();
  });

  it("reaches the shared document, so connected sessions see it", async () => {
    const s = store();
    watching(s);
    s.document();

    writeFileAtomic(projectPath, readFileSync(projectPath, "utf-8").replace('"Loop"', '"Renamed"'));
    await settle();

    expect(labelNames(s)).toContain("Renamed");
    s.stopWatching();
  });

  it("carries a deletion across, not only a rename", async () => {
    const s = store();
    watching(s);
    s.document();

    // Deleted the way the CLI deletes, so the file stays well-formed.
    writeFileAtomic(
      projectPath,
      applyOps(readFileSync(projectPath, "utf-8"), [{ op: "label.delete", id: "lbl_2", layerId: "lay_a" }])
    );
    await settle();

    expect(labelNames(s)).not.toContain("Loop");
    s.stopWatching();
  });

  it("ignores its own writes", async () => {
    const s = store();
    watching(s);

    applyOpToDoc(s.document(), {
      op: "label.set", id: "lbl_1", layerId: "lay_a", address: 0x8000, name: "Renamed",
      type: "function",
    });
    s.writeFile();
    const after = readFileSync(projectPath, "utf-8");
    await settle();

    // Nothing to absorb, so the file is untouched and the document unchanged.
    expect(readFileSync(projectPath, "utf-8")).toBe(after);
    expect(labelNames(s)).toEqual(["Renamed", "Loop"]);
    s.stopWatching();
  });

  it("waits out a file that is not valid JSON yet", async () => {
    const s = store();
    watching(s);
    s.document();

    writeFileAtomic(projectPath, '{ "layers": [ {');
    await settle();
    expect(labelNames(s)).toEqual(["Start", "Loop"]);

    writeFileAtomic(projectPath, PROJECT.replace('"Loop"', '"Recovered"'));
    await settle();
    expect(labelNames(s)).toContain("Recovered");
    s.stopWatching();
  });
});

describe("history", () => {
  it("records an external edit rather than claiming the session ended without it", async () => {
    const s = store();
    watching(s);
    s.addAuthor("alice");
    s.document();

    writeFileAtomic(projectPath, readFileSync(projectPath, "utf-8").replace('"Loop"', '"FromCli"'));
    await settle();

    const entry = s.flatten(1_000);
    expect(entry?.summary.join(" ")).toContain("FromCli");
    expect(entry?.authors).toContain("file");
    s.stopWatching();
  });
});

function store(): ProjectSessionStore {
  return new ProjectSessionStore(pathsFor(projectPath));
}
