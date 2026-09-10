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
import { normalizeBlobName } from "./blobs.js";

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
  return (name) => {
    const hash = recordedHash(files, name);
    const bytes = hash !== undefined ? storage.blobByHash(hash) : storage.blob(name);
    if (!bytes) {
      // Two different absences. A name the document records whose bytes are not
      // held is content this project promised and cannot produce — saying "no
      // file called" would send somebody looking for a typo.
      if (hash !== undefined) {
        throw new Error(
          `This project records "${name}" as ${hash.slice(0, 12)}… and does not hold ` +
            `those bytes. The recorded content must be uploaded again, or the record ` +
            `pointed at what is held.`
        );
      }
      const held = storage.blobNames();
      throw new Error(
        `This project holds no file called "${name}".` +
          (held.length ? ` It has: ${held.join(", ")}` : " It has no files at all.")
      );
    }
    return bytes;
  };
}

/**
 * The hash the document records for a name, however the name is spelled.
 *
 * `storage.blob` normalises the name it is given and the document lookup did
 * not, so `./game.prg` walked past the recorded entry for `game.prg` and read
 * the mutable name table instead — the bypass this whole change closes, open
 * again under a different spelling. Both sides are normalised here, and this is
 * the one place that decides whether a document entry exists.
 */
export function recordedHash(
  files: readonly { name: string; hash: string }[] | undefined,
  name: string
): string | undefined {
  const want = normalizeBlobName(name);
  return files?.find((f) => normalizedOrRaw(f.name) === want)?.hash;
}

/** A recorded name that will not normalise is matched as written rather than refused. */
function normalizedOrRaw(name: string): string {
  try {
    return normalizeBlobName(name);
  } catch {
    return name;
  }
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
