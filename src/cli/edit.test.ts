import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProject } from "./edit.js";
import { exportProject, importProject } from "../store/index.js";

/**
 * The write commands work against a database or a plain project file.
 *
 * Both matter: an agent edits the database, and someone with only a `.re64`
 * should not have to import it first to rename one label.
 */

let dir: string;
let projectPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "re64-edit-"));
  projectPath = join(dir, "gridrunner.re64");
  copyFileSync("assets/gridrunner.re64", projectPath);
  copyFileSync("assets/gridrunner.prg", join(dir, "gridrunner.prg"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("editing a plain project file", () => {
  it("names an address and puts it back exactly", () => {
    const original = readFileSync(projectPath, "utf-8");
    const editor = openProject(projectPath);
    const layerId = editor.owningLayerId(0x8100);

    editor.run(editor.labelSetOp(layerId, 0x8100, "Renamed"), "cli", 1);
    expect(readFileSync(projectPath, "utf-8")).toContain("Renamed");

    editor.undo("cli");
    expect(readFileSync(projectPath, "utf-8")).toBe(original);
  });
});

describe("editing a database", () => {
  it("works with no project file and no binary on disk", () => {
    const { databasePath } = importProject(projectPath);
    rmSync(projectPath);
    rmSync(join(dir, "gridrunner.prg"));

    const editor = openProject(databasePath);
    // Resolving the owning layer needs the PRG's load header, so this only
    // works because the binary came into the database too.
    const layerId = editor.owningLayerId(0x8100);
    expect(editor.run(editor.labelSetOp(layerId, 0x8100, "NamedByAgent"), "agent-1", 1))
      .toEqual(["set $8100 to NamedByAgent"]);

    const out = join(dir, "out.re64");
    exportProject(databasePath, out);
    expect(readFileSync(out, "utf-8")).toContain("NamedByAgent");
  });

  it("keeps the export a one-line diff", () => {
    const original = readFileSync(projectPath, "utf-8");
    const { databasePath } = importProject(projectPath);

    const editor = openProject(databasePath);
    editor.run(
      editor.labelSetOp(editor.owningLayerId(0x8100), 0x8100, "NamedByAgent"),
      "agent-1",
      1
    );

    const out = join(dir, "out.re64");
    exportProject(databasePath, out);

    const before = original.split("\n");
    const after = readFileSync(out, "utf-8").split("\n");
    const differing = before.filter((line, i) => line !== after[i]);
    expect(differing).toHaveLength(1);
    expect(before.length).toBe(after.length);
  });
});
