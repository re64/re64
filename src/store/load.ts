/**
 * Building a memory map from a database.
 *
 * The byte source stays keyed by the name the project uses, exactly as the
 * filesystem one is. That is what keeps content addressing invisible to
 * everything above: the loader, the D64 handling, `FileLayer`, and the browser
 * client all work unchanged, because a project still says `gridrunner.prg` and
 * something below resolves it.
 *
 * Rewriting layer paths into hashes would not be a storage detail. A path also
 * derives the layer's id, its display name, and the name of its entry label, so
 * the disassembly itself would change.
 */

import {
  FileBytes,
  LoadedProject,
  buildMemoryMap,
  makeFileLoader,
  parseProject,
} from "../core/index.js";
import { SqliteStorage } from "./sqlite-storage.js";

export function databaseFileBytes(storage: SqliteStorage): FileBytes {
  return (name) => {
    const bytes = storage.blob(name);
    if (!bytes) {
      const held = storage.blobNames();
      throw new Error(
        `This project holds no file called "${name}".` +
          (held.length ? ` It has: ${held.join(", ")}` : " It has no files at all.")
      );
    }
    return bytes;
  };
}

export function loadProjectFromDatabase(databasePath: string): LoadedProject {
  const storage = new SqliteStorage(databasePath);
  try {
    return buildMemoryMap(
      parseProject(storage.readText()),
      makeFileLoader(databaseFileBytes(storage))
    );
  } finally {
    storage.close();
  }
}
