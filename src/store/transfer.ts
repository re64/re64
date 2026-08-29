/**
 * Moving a project between a database and a `.re64` file.
 *
 * The file is the exported form: what goes in git, what gets handed to someone
 * else, what a `disasm` reads directly. The database is where editing happens.
 *
 * Both directions move the text **verbatim**. Nothing here may reparse and
 * re-serialize — `formatProject` regenerates layout from content and would
 * silently drop the blank lines that group labels and reorder hand-declared
 * regions, turning a one-line change into a whole-file diff.
 */

import { existsSync, readFileSync } from "node:fs";
import { writeFileAtomic } from "../fsutil.js";
import { parseProject } from "../core/index.js";
import { HistoryEntry } from "./storage.js";
import { SqliteStorage } from "./sqlite-storage.js";

/** Where a project file's database lives by default. */
export function databasePathFor(projectPath: string): string {
  return `${projectPath}db`;
}

export interface ImportResult {
  databasePath: string;
  historyEntries: number;
}

/**
 * Read a `.re64` into a fresh database.
 *
 * Any history sitting beside the file comes too, so importing does not quietly
 * discard the record of who did what.
 */
export function importProject(
  projectPath: string,
  databasePath = databasePathFor(projectPath)
): ImportResult {
  const text = readFileSync(projectPath, "utf-8");
  parseProject(text); // Refuse a file that is not a project, before creating anything.

  const storage = new SqliteStorage(databasePath);
  storage.initialize(text, Date.now());

  const historyPath = `${projectPath}.history`;
  let historyEntries = 0;
  if (existsSync(historyPath)) {
    for (const line of readFileSync(historyPath, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        storage.appendHistory(JSON.parse(line) as HistoryEntry);
        historyEntries++;
      } catch {
        // A truncated or hand-mangled line is not worth failing an import over.
      }
    }
  }

  storage.close();
  return { databasePath, historyEntries };
}

export interface ExportResult {
  /** False when the files on disk already match — the check `--check` reports. */
  changed: boolean;
  projectPath: string;
  historyPath: string;
}

/**
 * Write a database back out as a `.re64` and its history sidecar.
 *
 * `dryRun` reports whether anything would change without writing, so a
 * pre-commit hook can refuse a stale export rather than committing one.
 */
export function exportProject(
  databasePath: string,
  projectPath: string,
  dryRun = false
): ExportResult {
  const storage = new SqliteStorage(databasePath);
  const text = storage.readText();
  const history = storage.history();
  storage.close();

  const historyPath = `${projectPath}.history`;
  const historyText = history.map((e) => JSON.stringify(e) + "\n").join("");

  const current = existsSync(projectPath) ? readFileSync(projectPath, "utf-8") : null;
  const currentHistory = existsSync(historyPath) ? readFileSync(historyPath, "utf-8") : "";
  const changed = current !== text || currentHistory !== historyText;

  if (!dryRun && changed) {
    writeFileAtomic(projectPath, text);
    if (historyText) writeFileAtomic(historyPath, historyText);
  }

  return { changed, projectPath, historyPath };
}
