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
import { basename, dirname, resolve } from "node:path";
import { blobPaths, formatProject, parseProject, withIds } from "../core/index.js";
import { hashBytes, normalizeBlobName } from "./blobs.js";
import { HistoryEntry } from "./storage.js";
import { SqliteStorage } from "./sqlite-storage.js";

/** Where a project file's database lives by default. */
export function databasePathFor(projectPath: string): string {
  return `${projectPath}db`;
}

/**
 * Something for the picker to show before there is any way to add people.
 *
 * Not a security boundary — there is no authentication yet, and picking a name
 * is all it takes. They exist so an edit can be attributed to *someone*, which
 * is what makes the history worth keeping.
 */
const STARTER_USERS = [
  { id: "usr_you", name: "you", colour: "#7fb2f0" },
  { id: "usr_agent", name: "agent", colour: "#c8a2f0" },
  { id: "usr_guest", name: "guest", colour: "#7fd3a1" },
];

export interface ImportResult {
  databasePath: string;
  projectId: string;
  historyEntries: number;
  /** The binaries brought in, by the name the project uses for them. */
  files: string[];
}

/**
 * Read a `.re64` into a fresh database.
 *
 * Any history sitting beside the file comes too, so importing does not quietly
 * discard the record of who did what.
 */
/** A recorded name that will not normalise is matched as written rather than refused. */
function normalizedOrRaw(name: string): string {
  try {
    return normalizeBlobName(name);
  } catch {
    return name;
  }
}

export function importProject(
  projectPath: string,
  databasePath = databasePathFor(projectPath),
  projectId = basename(projectPath).replace(/\.re64$/, "")
): ImportResult {
  const raw = readFileSync(projectPath, "utf-8");
  const parsed = parseProject(raw); // Refuse a non-project before creating anything.

  // Mint ids the file does not carry, before anything is stored.
  //
  // Every operation targets an object by id, so a project written without them
  // loads and disassembles perfectly and then refuses every write — and nobody
  // hand-writes an id, so that is the shape a new project arrives in. Doing it
  // at import means the document carries them from its first snapshot.
  //
  // Reserialised only when something was actually missing: an import must not
  // rewrite a file that was already complete, and layout is not worth
  // preserving here because the export is regenerated anyway.
  const project = withIds(parsed);

  // Read the binaries before the database exists, so a missing one fails the
  // import rather than leaving a database that cannot be disassembled.
  const baseDir = dirname(projectPath);
  const wanted = blobPaths(project).map((name) => ({
    name: normalizeBlobName(name),
    bytes: new Uint8Array(readFileSync(resolve(baseDir, name))),
  }));

  // **And record them, so the document knows which bytes each name means.**
  // The blobs were stored and nothing said so, which left every imported project
  // resolving names through the mutable SQL table for ever — the fallback that
  // exists for the window between an upload and its `file.add`, standing open
  // permanently instead. Recorded here for the same reason ids are minted here:
  // the document carries it from its first snapshot.
  //
  // **Added to the registry, never replacing it.** `wanted` is the layer
  // sources only — a capture or anything else the project recorded is not among
  // them — and assigning the registry from it threw those records away on
  // import. A record the file already carries is kept as written, its hash
  // included: the file is the authority on what it recorded, and a hash that
  // no longer matches the bytes beside it is a fact to surface, not to repair
  // silently here.
  const existing = project.files ?? [];
  const known = new Set(existing.map((f) => normalizedOrRaw(f.name)));
  const added = wanted
    .filter((file) => !known.has(file.name))
    .map((file) => ({ name: file.name, hash: hashBytes(file.bytes), size: file.bytes.length }));
  if (added.length) project.files = [...existing, ...added];

  const text = project === parsed && !added.length ? raw : formatProject(project);

  const storage = new SqliteStorage(databasePath, projectId);
  storage.initialize(text, Date.now(), projectId);
  for (const file of wanted) storage.putBlob(file.name, file.bytes);
  for (const user of STARTER_USERS) storage.addUser(user);

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
  return { databasePath, projectId, historyEntries, files: wanted.map((f) => f.name) };
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
  dryRun = false,
  projectId?: string
): ExportResult {
  const storage = new SqliteStorage(
    databasePath,
    projectId ?? new SqliteStorage(databasePath).projects()[0]?.id
  );
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
