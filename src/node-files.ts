/**
 * Reading project bytes under Node.
 *
 * The *policy* for turning bytes into layer content — `disk.d64:name`
 * extraction, the two-byte PRG load header — lives in `core/project/file-source`
 * so the browser shares it. This is the other half: how Node gets the bytes.
 *
 * There is deliberately one implementation. Three grew up independently (here,
 * the server's loader, and the CLI's own copy) and drifted: they detected the
 * D64 form by three different rules.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  FileBytes,
  LoadedProject,
  buildMemoryMap,
  makeFileLoader,
  parseProject,
} from "./core/index.js";

/**
 * Read whole files from disk.
 *
 * Paths resolve against `baseDir` when given, and against the working directory
 * otherwise. That difference is deliberate and load-bearing: a project's layer
 * paths are relative to the project file, while `--layer` on the command line is
 * relative to wherever the user is standing.
 */
export function nodeFileBytes(baseDir?: string): FileBytes {
  return (path) =>
    new Uint8Array(readFileSync(baseDir === undefined ? path : resolve(baseDir, path)));
}

/** Load a project file and build its memory map. */
export function loadProjectFile(projectPath: string): LoadedProject {
  const project = parseProject(readFileSync(projectPath, "utf-8"));
  return buildMemoryMap(project, makeFileLoader(nodeFileBytes(dirname(projectPath))));
}
