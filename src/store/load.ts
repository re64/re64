/** Build a memory map using the document's immutable file records. */
import { ProjectStore } from "./project-store.js";
import { projectFromDoc } from "../core/crdt/index.js";
import { FileBytes, LoadedProject, buildMemoryMap, makeFileLoader } from "../core/index.js";
import type { ProjectFile } from "../core/project/project.js";
import { resolveFile } from "../core/project/files.js";
import { SqliteStorage } from "./sqlite-storage.js";

/** No mutable name-table fallback: missing recorded content stays missing. */
export function databaseFileBytes(
  storage: SqliteStorage,
  files: readonly ProjectFile[] = []
): FileBytes {
  return (name, source) => {
    const file = source ?? resolveFile(files, name);
    if (!file.hash) {
      throw new Error(`File ${file.id} (${file.name}) has no recorded content hash. Import its bytes first.`);
    }
    const bytes = storage.blobByHash(file.hash);
    if (!bytes) {
      throw new Error(
        `This project records "${name}" as ${file.hash.slice(0, 12)}… and does not hold ` +
          `those bytes. The recorded content must be uploaded again.`
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
    const project = projectFromDoc(new ProjectStore(storage).document());
    return buildMemoryMap(
      project,
      makeFileLoader(databaseFileBytes(storage, project.files))
    );
  } finally {
    storage.close();
  }
}
