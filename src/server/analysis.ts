/**
 * Node-side project loading.
 *
 * All that remains here is file I/O. Analysis and view-model construction live
 * in `src/core/` so they run in the browser too — the client owns the model, so
 * it analyses locally rather than round-tripping to the server.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  LoadedProject,
  buildMemoryMap,
  makeFileLoader,
  parseProject,
} from "../core/index.js";

/** Load a project file and build its memory map. */
export function loadProject(projectPath: string): LoadedProject {
  const project = parseProject(readFileSync(projectPath, "utf-8"));
  const baseDir = dirname(projectPath);

  return buildMemoryMap(
    project,
    makeFileLoader((path) => new Uint8Array(readFileSync(resolve(baseDir, path))))
  );
}
