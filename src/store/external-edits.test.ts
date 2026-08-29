import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStorage, ProjectStore, SqliteStorage, pathsFor } from "./index.js";
import { projectFromDoc } from "../core/crdt/index.js";
import { applyOps } from "../core/ops/index.js";

/**
 * A second writer, and how the first finds out.
 *
 * Two processes on one project is what a database is for: `re64 label set`
 * opens the store in its own process while a server holds a live session. A
 * project *file* has one writer — watching one was how the pre-database
 * arrangement approximated this, and it is not approximated any more.
 *
 * What both still guarantee is that nothing is lost. A write folds in whatever
 * changed underneath it, so a database learns immediately and a file learns at
 * the next write. Only the latency differs; that is the whole difference, and
 * the tests below say which is which.
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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "re64-external-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const labelNames = (s: ProjectStore) =>
  (projectFromDoc(s.document()).layers[0].labels ?? []).map((l) => l.name);

/**
 * Wait for something to become true rather than for a fixed time.
 *
 * How long a poll takes depends on what else the machine is doing, and a sleep
 * tuned on an idle one fails a few percent of the time under a full suite —
 * which is worse than a slow test, because it teaches you to re-run.
 */
async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Only for asserting something does *not* happen; there is nothing to poll. */
const settle = () => new Promise((r) => setTimeout(r, 300));

describe("a database, which two processes may hold at once", () => {
  const open = () => new SqliteStorage(join(dir, "test.re64db"));
  const store = () => new ProjectStore(open());

  beforeEach(() => open().initialize(PROJECT, 0));

  const asSomeoneElse = (edit: (text: string) => string) => {
    const other = open();
    other.writeText(edit(other.readText()));
  };

  it("notices a change it did not make", async () => {
    const s = store();
    s.document();
    s.watchFile();

    asSomeoneElse((text) => text.replace('"Loop"', '"Renamed"'));
    await until(() => labelNames(s).includes("Renamed"), "the rename to arrive");
    s.stopWatching();
  });

  it("carries a deletion across, not only a rename", async () => {
    const s = store();
    s.document();
    s.watchFile();

    asSomeoneElse((text) =>
      applyOps(text, [{ op: "label.delete", id: "lbl_2", layerId: "lay_a" }])
    );
    await until(() => !labelNames(s).includes("Loop"), "the deletion to arrive");
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
    const after = open().readText();
    await settle();

    expect(open().readText()).toBe(after);
    expect(labelNames(s)).toEqual(["Mine", "Loop"]);
    s.stopWatching();
  });

  it("records what someone else did, rather than claiming it did not happen", async () => {
    const s = store();
    s.addAuthor("alice");
    s.document();
    s.watchFile();

    asSomeoneElse((text) => text.replace('"Loop"', '"FromElsewhere"'));
    await until(() => labelNames(s).includes("FromElsewhere"), "the edit to arrive");

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

describe("a project file, which has one writer", () => {
  const path = () => join(dir, "test.re64");
  const open = () => new FileStorage(pathsFor(path()));
  const store = () => new ProjectStore(open());

  beforeEach(() => writeFileSync(join(dir, "test.re64"), PROJECT, "utf-8"));

  it("is not watched", async () => {
    // Deliberate. A `.re64` is the exported form, so watching one would be a
    // timer in every server process looking for hand-edits to a generated file
    // that the next export overwrites. Concurrent editing is what a database
    // is for.
    const s = store();
    s.document();
    s.watchFile();

    open().writeText(PROJECT.replace('"Loop"', '"Elsewhere"'));
    await settle();

    expect(labelNames(s)).not.toContain("Elsewhere");
    s.stopWatching();
  });

  it("still loses nothing, because the next write folds the change in", async () => {
    // This is what makes not watching affordable: latency, not correctness.
    const s = store();
    s.runOps(
      [{ op: "label.set", id: "lbl_1", layerId: "lay_a", address: 0x8000, name: "Mine",
         type: "function" }],
      "me",
      1
    );

    open().writeText(open().readText().replace('"Loop"', '"Elsewhere"'));
    s.runOps(
      [{ op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "Later" }],
      "me",
      2
    );

    // The edit made elsewhere survived a write that never saw it happen.
    expect(labelNames(s)).toContain("Later");
    expect(open().readText()).toContain("Mine");
  });
});
