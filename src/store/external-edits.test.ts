import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStorage, ProjectStorage, ProjectStore, SqliteStorage, pathsFor } from "./index.js";
import { projectFromDoc } from "../core/crdt/index.js";
import { applyOps } from "../core/ops/index.js";

/**
 * A second writer, and how the first finds out.
 *
 * `re64 label set` opens the project in its own process; so does a server
 * holding a live session. Neither owns it. Without noticing each other, the one
 * that writes second computes its change against a state the other has already
 * moved on from, and quietly undoes their work.
 *
 * Both backing stores are exercised because they answer "someone else wrote"
 * completely differently: a filesystem reports directory events, and SQLite
 * reports `PRAGMA data_version`.
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

interface Backend {
  name: string;
  create(dir: string): void;
  open(dir: string): ProjectStorage;
}

const BACKENDS: Backend[] = [
  {
    name: "a file being watched",
    create: (dir) => writeFileSync(join(dir, "test.re64"), PROJECT, "utf-8"),
    open: (dir) => new FileStorage(pathsFor(join(dir, "test.re64"))),
  },
  {
    name: "a second database connection",
    create: (dir) => new SqliteStorage(join(dir, "test.re64db")).initialize(PROJECT, 0),
    open: (dir) => new SqliteStorage(join(dir, "test.re64db")),
  },
];

/** Long enough for a directory event to coalesce, or a data_version poll. */
const settle = () => new Promise((r) => setTimeout(r, 400));

describe.each(BACKENDS)("$name", (b) => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "re64-external-"));
    b.create(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const store = () => new ProjectStore(b.open(dir));
  const currentText = () => b.open(dir).readText();
  const labelNames = (s: ProjectStore) =>
    (projectFromDoc(s.document()).layers[0].labels ?? []).map((l) => l.name);

  const asSomeoneElse = (edit: (text: string) => string) => {
    const other = b.open(dir);
    other.writeText(edit(other.readText()));
  };

  it("notices a change it did not make", async () => {
    const s = store();
    s.document();
    s.watchFile();

    asSomeoneElse((text) => text.replace('"Loop"', '"Renamed"'));
    await settle();

    expect(labelNames(s)).toContain("Renamed");
    s.stopWatching();
  });

  it("carries a deletion across, not only a rename", async () => {
    const s = store();
    s.document();
    s.watchFile();

    asSomeoneElse((text) =>
      applyOps(text, [{ op: "label.delete", id: "lbl_2", layerId: "lay_a" }])
    );
    await settle();

    expect(labelNames(s)).not.toContain("Loop");
    s.stopWatching();
  });

  it("does not react to its own writes", async () => {
    const s = store();
    s.runOps(
      [{ op: "label.set", id: "lbl_1", layerId: "lay_a", address: 0x8000, name: "Mine",
         type: "function" }],
      "me",
      1
    );
    s.watchFile();
    const after = currentText();
    await settle();

    expect(currentText()).toBe(after);
    expect(labelNames(s)).toEqual(["Mine", "Loop"]);
    s.stopWatching();
  });

  it("records what someone else did, rather than claiming it did not happen", async () => {
    const s = store();
    s.addAuthor("alice");
    s.document();
    s.watchFile();

    asSomeoneElse((text) => text.replace('"Loop"', '"FromElsewhere"'));
    await settle();

    const entry = s.flatten(1_000);
    expect(entry?.summary.join(" ")).toContain("FromElsewhere");
    expect(entry?.authors).toContain("file");
    s.stopWatching();
  });

  it("stops reporting once it has been told to stop", async () => {
    const s = store();
    s.document();
    s.watchFile();
    s.stopWatching();

    asSomeoneElse((text) => text.replace('"Loop"', '"Ignored"'));
    await settle();

    expect(labelNames(s)).not.toContain("Ignored");
  });
});

describe("a project caught mid-write", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "re64-external-"));
    writeFileSync(join(dir, "test.re64"), PROJECT, "utf-8");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("waits for valid JSON rather than reading a deletion into it", async () => {
    // Only a file can be caught like this; a transaction cannot be half seen.
    const storage = new FileStorage(pathsFor(join(dir, "test.re64")));
    const s = new ProjectStore(storage);
    s.document();
    s.watchFile();

    storage.writeText('{ "layers": [ {');
    await settle();
    expect((projectFromDoc(s.document()).layers[0].labels ?? []).length).toBe(2);

    storage.writeText(PROJECT.replace('"Loop"', '"Recovered"'));
    await settle();
    expect(
      (projectFromDoc(s.document()).layers[0].labels ?? []).map((l) => l.name)
    ).toContain("Recovered");
    s.stopWatching();
  });
});
