import { createHash } from "node:crypto";
import type { RomLoader } from "./core/project/loader.js";
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

import { existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
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
  return (path, file) => {
    const bytes = new Uint8Array(readFileSync(baseDir === undefined ? path : resolve(baseDir, path)));
    if (file?.hash && createHash("sha256").update(bytes).digest("hex") !== file.hash) {
      throw new Error(`File ${file.id} (${file.name}) does not match its recorded content hash.`);
    }
    return bytes;
  };
}

/**
 * Load a project file and build its memory map, through one of its views.
 *
 * `target` is required in practice for any project declaring more than one:
 * there is no default view any more, because which one you are reading is a
 * property of the reader and not of the file. A project with a single target —
 * or none, which implies one — needs no name.
 */
export function loadProjectFile(projectPath: string, target?: string): LoadedProject {
  const project = parseProject(readFileSync(projectPath, "utf-8"));
  return buildMemoryMap(project, makeFileLoader(nodeFileBytes(dirname(projectPath))), {
    loadRom: nodeRomBytes(),
    ...(target === undefined ? {} : { target }),
  });
}

/**
 * Machine ROMs, from where this repository asks for them to be put.
 *
 * Not in the repository and never will be: they are Commodore's, and
 * `3party/roms/README.md` says which files to supply and gives their hashes.
 * A host without them returns nothing and the project loads with the layer
 * empty and a report, which is what keeps a project that wants BASIC banked in
 * openable by somebody who has no ROMs.
 *
 * Deliberately *not* automatic. Loading these into every project would add
 * twelve kilobytes to its address space and change what the analysis says
 * depending on whether a developer happens to have gitignored files on disk —
 * so a project asks for one by declaring a `rom` layer, and the request is
 * committed even though the bytes are not.
 */
export function nodeRomBytes(directory = "3party/roms"): RomLoader {
  const FILES: Record<string, string> = {
    basic: "basic.901226-01.bin",
    kernal: "kernal.901227-03.bin",
    characters: "characters.901225-01.bin",
  };
  return (rom) => {
    const path = join(directory, FILES[rom]);
    return existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined;
  };
}
