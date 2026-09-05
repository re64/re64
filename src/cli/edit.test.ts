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
  copyFileSync("assets/gridrunner/gridrunner.re64", projectPath);
  copyFileSync("assets/gridrunner/gridrunner.prg", join(dir, "gridrunner.prg"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("editing a plain project file", () => {
  it("names an address and puts it back exactly", () => {
    const editor = openProject(projectPath);
    const layerId = editor.owningLayerId(0x8100);

    // Compared against the file *after* one write, not against the hand-authored
    // original: every writer reserialises now, so the first edit normalises the
    // layout and no undo can bring back formatting nobody records. What undo
    // must restore is the content, byte for byte in canonical form.
    editor.run(editor.labelSetOp(layerId, 0x8100, "First"), "cli", 1);
    const canonical = readFileSync(projectPath, "utf-8");

    editor.run(editor.labelSetOp(layerId, 0x8100, "Renamed"), "cli", 2);
    expect(readFileSync(projectPath, "utf-8")).toContain("Renamed");

    editor.undo("cli");
    expect(readFileSync(projectPath, "utf-8")).toBe(canonical);
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
      .toEqual([expect.stringMatching(/^rename .+ to NamedByAgent$/)]);

    const out = join(dir, "out.re64");
    exportProject(databasePath, out);
    expect(readFileSync(out, "utf-8")).toContain("NamedByAgent");
  });

});
