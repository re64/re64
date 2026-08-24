/**
 * Node-side project loading.
 *
 * All that remains here is file I/O. Analysis and view-model construction live
 * in `src/core/` so they run in the browser too — the client owns the model,
 * so it analyses locally rather than round-tripping to the server.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  findFile,
  extractFile,
  listDirectory,
  LoadedProject,
  buildMemoryMap,
  parseProject,
} from "../core/index.js";


/** Read a file's bytes, supporting the `disk.d64:filename` form. */
function loadFile(
  path: string,
  explicitStart?: number
): { start: number; data: Uint8Array; isPrg: boolean } {
  let fullData: Uint8Array;

  const colonIndex = path.lastIndexOf(":");
  const possibleD64 = colonIndex > 0 ? path.substring(0, colonIndex) : "";
  if (possibleD64.toLowerCase().endsWith(".d64")) {
    const innerFilename = path.substring(colonIndex + 1);
    const diskImage = new Uint8Array(readFileSync(possibleD64));
    const entry = findFile(diskImage, innerFilename);
    if (!entry) {
      const available = listDirectory(diskImage)
        .map((e) => e.filename)
        .join(", ");
      throw new Error(
        `File "${innerFilename}" not found in ${possibleD64}. Available: ${available}`
      );
    }
    fullData = extractFile(diskImage, entry);
  } else {
    fullData = new Uint8Array(readFileSync(path));
  }

  if (explicitStart !== undefined) {
    return { start: explicitStart, data: fullData, isPrg: false };
  }
  if (fullData.length < 3) {
    throw new Error(`File too small to be a PRG: ${path}`);
  }
  return {
    start: fullData[0] | (fullData[1] << 8),
    data: fullData.slice(2),
    isPrg: true,
  };
}

/** Load a project file and build its memory map. */
export function loadProject(projectPath: string): LoadedProject {
  const project = parseProject(readFileSync(projectPath, "utf-8"));
  const baseDir = dirname(projectPath);

  return buildMemoryMap(project, (path, explicitStart) =>
    loadFile(resolve(baseDir, path), explicitStart)
  );
}
