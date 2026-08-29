/**
 * Binaries, by content.
 *
 * A project names its files — `gridrunner.prg`, `disk.d64` — and those names are
 * local to it. The bytes are not: two projects annotating the same game hold one
 * copy. Names map to hashes, hashes map to bytes.
 *
 * Dedup is the smaller reason. The larger one is that nothing currently checks
 * that the bytes behind a layer are the ones its addresses were named against.
 * Re-dump a game, and every label silently points at nonsense. A hash makes that
 * answerable.
 */

import { createHash } from "node:crypto";

/**
 * The name a project uses for a file, in the one spelling that gets stored.
 *
 * On a filesystem `game.prg`, `./game.prg` and `sub/../game.prg` are one file.
 * As table keys they would be three rows and two of them would never be found,
 * so the same rule has to run on the way in and on the way out.
 *
 * `..` is refused rather than resolved: it only ever meant "outside the project
 * directory", and there is no outside once the bytes are in the database.
 */
export function normalizeBlobName(name: string): string {
  const posix = name.replace(/\\/g, "/");
  const parts: string[] = [];

  for (const part of posix.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      throw new Error(
        `"${name}" points outside the project. Copy the file in beside it and ` +
          `name it relative to the project.`
      );
    }
    parts.push(part);
  }

  if (parts.length === 0) throw new Error(`"${name}" is not a file name`);
  return parts.join("/");
}

export function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
