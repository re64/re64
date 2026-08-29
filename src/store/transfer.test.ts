import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { databasePathFor, exportProject, importProject } from "./transfer.js";
import { SqliteStorage } from "./sqlite-storage.js";

/**
 * The property that matters here is that nothing is regenerated.
 *
 * The project text carries decisions its content does not: which labels a blank
 * line groups, what order regions were declared in. A round trip that reparsed
 * and re-serialized would lose them and turn every later one-line edit into a
 * whole-file diff.
 */

const PROJECT = `{
  "name": "Test",
  "layers": [
    {
      "id": "lay_a",
      "type": "symbols",
      "labels": [
        { "id": "lbl_1", "address": "$02", "name": "Start" },


        { "id": "lbl_2", "address": "$04", "name": "Loop" }
      ]
    }
  ]
}
`;

let dir: string;
let projectPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "re64-transfer-"));
  projectPath = join(dir, "test.re64");
  writeFileSync(projectPath, PROJECT, "utf-8");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("importing a project file", () => {
  it("stores the text exactly, blank lines and all", () => {
    const { databasePath } = importProject(projectPath);
    const storage = new SqliteStorage(databasePath);
    expect(storage.readText()).toBe(PROJECT);
    storage.close();
  });

  it("puts the database beside the project by default", () => {
    expect(importProject(projectPath).databasePath).toBe(`${projectPath}db`);
    expect(databasePathFor("a/b.re64")).toBe("a/b.re64db");
  });

  it("brings the history along rather than dropping it", () => {
    writeFileSync(
      `${projectPath}.history`,
      `{"at":1,"authors":["alice"],"summary":["one"]}\n` +
        `{"at":2,"authors":["bob"],"summary":["two"]}\n`,
      "utf-8"
    );

    const { databasePath, historyEntries } = importProject(projectPath);
    expect(historyEntries).toBe(2);

    const storage = new SqliteStorage(databasePath);
    expect(storage.history().map((e) => e.authors[0])).toEqual(["alice", "bob"]);
    storage.close();
  });

  it("refuses a file that is not a project, before creating anything", () => {
    const bad = join(dir, "bad.re64");
    writeFileSync(bad, "{ not json", "utf-8");
    expect(() => importProject(bad)).toThrow();
    expect(existsSync(`${bad}db`)).toBe(false);
  });
});

describe("exporting", () => {
  it("round-trips byte for byte", () => {
    const { databasePath } = importProject(projectPath);
    const out = join(dir, "out.re64");

    expect(exportProject(databasePath, out).changed).toBe(true);
    expect(readFileSync(out, "utf-8")).toBe(PROJECT);
  });

  it("reports nothing to do when the file already matches", () => {
    const { databasePath } = importProject(projectPath);
    const out = join(dir, "out.re64");
    exportProject(databasePath, out);

    expect(exportProject(databasePath, out).changed).toBe(false);
  });

  it("notices a stale export without writing one", () => {
    const { databasePath } = importProject(projectPath);
    const out = join(dir, "out.re64");
    exportProject(databasePath, out);

    const storage = new SqliteStorage(databasePath);
    storage.writeText(PROJECT.replace("Loop", "Renamed"));
    storage.close();

    const dryRun = exportProject(databasePath, out, true);
    expect(dryRun.changed).toBe(true);
    // The point of --check: it reports, it does not fix.
    expect(readFileSync(out, "utf-8")).toBe(PROJECT);
  });

  it("writes the history beside the project", () => {
    const { databasePath } = importProject(projectPath);
    const storage = new SqliteStorage(databasePath);
    storage.appendHistory({ at: 7, authors: ["alice"], summary: ["did a thing"] });
    storage.close();

    const out = join(dir, "out.re64");
    exportProject(databasePath, out);

    expect(readFileSync(`${out}.history`, "utf-8")).toBe(
      `{"at":7,"authors":["alice"],"summary":["did a thing"]}\n`
    );
  });
});
