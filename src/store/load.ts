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

/**
 * The bytes a project's files hold, with the **document** deciding which.
 *
 * A blob is stored by content hash, but the read went through a separate,
 * mutable SQL name-to-hash mapping that `putBlob` rewrites whenever a name is
 * reused. The document records its own hash per file and `file.add` is
 * undoable — so undoing a replacement restored the hash in the document and left
 * the read serving the replacement's bytes. A capture recorded earlier then
 * fetched somebody else's output under its own name.
 *
 * So the document's hash is authoritative and the name table is a fallback, for
 * a file uploaded but not yet recorded — which is a real window, since the
 * upload and the `file.add` are two steps.
 */
export function databaseFileBytes(
  storage: SqliteStorage,
  files: readonly { name: string; hash: string }[] = []
): FileBytes {
  const hashOf = new Map(files.map((f) => [f.name, f.hash]));
  return (name) => {
    const hash = hashOf.get(name);
    const bytes = hash ? storage.blobByHash(hash) : storage.blob(name);
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

export function loadProjectFromDatabase(
  databasePath: string,
  projectId?: string
): LoadedProject {
  const storage = new SqliteStorage(
    databasePath,
    projectId ?? new SqliteStorage(databasePath).projects()[0]?.id
  );
  try {
    return buildMemoryMap(
      parseProject(storage.readText()),
      makeFileLoader(databaseFileBytes(storage))
    );
  } finally {
    storage.close();
  }
}
