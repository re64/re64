import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectSessionStore, pathsFor } from "./session-store.js";
import { applyOpToDoc, encodeDoc } from "../core/crdt/index.js";

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
  dir = mkdtempSync(join(tmpdir(), "re64-session-"));
  projectPath = join(dir, "test.re64");
  writeFileSync(projectPath, PROJECT, "utf-8");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const store = () => new ProjectSessionStore(pathsFor(projectPath));

describe("flattening a session", () => {
  it("writes the file and records one entry, not one per edit", () => {
    const s = store();
    s.addAuthor("alice");
    applyOpToDoc(s.document(), {
      op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "MainLoop",
    });
    applyOpToDoc(s.document(), {
      op: "label.set", id: "lbl_1", layerId: "lay_a", address: 0x8000, name: "Begin",
    });

    const entry = s.flatten(1000);

    expect(entry?.authors).toEqual(["alice"]);
    expect(entry?.summary).toHaveLength(2);
    expect(s.history()).toHaveLength(1);
    expect(readFileSync(projectPath, "utf-8")).toContain(`"name": "MainLoop"`);
  });

  it("touches only the lines that changed, keeping the grouping blank", () => {
    // The reason flatten diffs rather than writing the document out: the
    // document knows the content, not how the file was laid out.
    const s = store();
    applyOpToDoc(s.document(), {
      op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "MainLoop",
    });
    s.flatten(1000);

    const after = readFileSync(projectPath, "utf-8");
    const before = PROJECT.split("\n");
    const now = after.split("\n");

    expect(before.filter((l, i) => l !== now[i])).toHaveLength(1);
    // Compared against the original rather than a literal: splitting on "\n"
    // also yields the empty string after the trailing newline.
    expect(now.filter((l) => !l.trim())).toHaveLength(before.filter((l) => !l.trim()).length);
  });

  it("leaves no trace when nothing changed", () => {
    const s = store();
    s.document();

    expect(s.flatten(1000)).toBeUndefined();
    expect(readFileSync(projectPath, "utf-8")).toBe(PROJECT);
    expect(s.history()).toEqual([]);
  });

  it("names everyone who contributed", () => {
    const s = store();
    s.addAuthor("bob");
    s.addAuthor("agent-1");
    s.addAuthor("bob");
    applyOpToDoc(s.document(), {
      op: "label.delete", id: "lbl_2", layerId: "lay_a",
    });

    expect(s.flatten(1000)?.authors).toEqual(["agent-1", "bob"]);
  });

  it("accumulates history across sessions", () => {
    for (const name of ["A", "B"]) {
      const s = store();
      applyOpToDoc(s.document(), {
        op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name,
      });
      s.flatten(1000);
    }

    expect(store().history()).toHaveLength(2);
  });
});

describe("crash safety", () => {
  it("recovers edits from the update log", () => {
    // A killed browser or server must not lose work that was never flattened.
    const first = store();
    applyOpToDoc(first.document(), {
      op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "Survived",
    });
    // No flatten: simulate the process dying here.

    expect(existsSync(pathsFor(projectPath).log)).toBe(true);

    const recovered = store();
    const entry = recovered.flatten(2000);

    expect(entry?.summary).toHaveLength(1);
    expect(readFileSync(projectPath, "utf-8")).toContain(`"name": "Survived"`);
  });

  it("discards the log once the work is in the file", () => {
    const s = store();
    applyOpToDoc(s.document(), {
      op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "Done",
    });
    s.flatten(1000);

    expect(existsSync(pathsFor(projectPath).log)).toBe(false);
  });
});

describe("joining", () => {
  it("hands a newcomer the state it is missing", () => {
    const s = store();
    applyOpToDoc(s.document(), {
      op: "label.set", id: "lbl_new", layerId: "lay_a", address: 0x8008, name: "Added",
    });

    expect(s.snapshot().length).toBeGreaterThan(0);
    expect(Buffer.from(s.snapshot())).toEqual(Buffer.from(encodeDoc(s.document())));
  });
});
