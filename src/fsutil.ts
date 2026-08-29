/**
 * File writes that a concurrent reader cannot catch half-finished.
 *
 * The project file is written by the server and by the CLI, and read by both
 * plus whatever editor happens to be open. A plain `writeFileSync` truncates
 * first, so a reader arriving mid-write sees a partial document — which for
 * JSON means a parse error at best.
 *
 * Writing to a sibling and renaming is atomic on POSIX: a reader sees either
 * the old file or the new one, never a mixture. The sibling shares a directory
 * so the rename stays within one filesystem.
 */

import { renameSync, writeFileSync } from "node:fs";

export function writeFileAtomic(path: string, contents: string): void {
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, contents, "utf-8");
  renameSync(temp, path);
}
