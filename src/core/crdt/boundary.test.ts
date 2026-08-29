import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The CRDT library stays behind one door.
 *
 * Yjs is the merge layer, not the data model. Operations are the interface, and
 * everything above them — the disassembler, the view model, the CLI, the UI —
 * works with plain project objects. That is what keeps the choice reversible:
 * swapping Yjs for Automerge or Loro should touch one directory.
 *
 * A `Y.Map` reaching `analyze()` would end that quietly, so it is asserted
 * rather than trusted.
 */

const ADAPTER = join("src", "core", "crdt");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("the CRDT boundary", () => {
  it("is the only place that imports yjs", () => {
    const offenders = sourceFiles("src")
      .filter((path) => !path.startsWith(ADAPTER))
      .filter((path) => /from\s+["']yjs["']|require\(["']yjs["']\)/.test(readFileSync(path, "utf-8")));

    expect(offenders).toEqual([]);
  });

  it("is not re-exported from the core barrel", () => {
    // Re-exporting would pull Yjs into every consumer's bundle and make the
    // boundary meaningless even while no file imported it directly.
    expect(readFileSync(join("src", "core", "index.ts"), "utf-8")).not.toContain("crdt");
  });

  it("keeps operations free of Yjs types", () => {
    for (const path of sourceFiles(join("src", "core", "ops"))) {
      expect(readFileSync(path, "utf-8")).not.toContain("yjs");
    }
  });
});
