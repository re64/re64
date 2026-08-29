/**
 * The project as a file, with its two sidecars.
 *
 * This is the arrangement re64 has always used: `<name>.re64` beside
 * `<name>.re64.session` and `<name>.re64.history`. It is being replaced by
 * SQLite, but it stays as the reference implementation the same test suite runs
 * against.
 */

import { appendFileSync, existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { writeFileAtomic } from "../fsutil.js";
import { Change, decodeChanges, encodeChanges } from "../core/index.js";
import {
  HistoryEntry,
  ProjectStorage,
  REV_LENGTH,
  StoredUpdate,
  revOf,
} from "./storage.js";

export interface SessionPaths {
  project: string;
  /** CRDT updates as they arrive; exists only while a session is open. */
  log: string;
  /** Flattened sessions, one JSON object per line. */
  history: string;
  /** Operations with their inverses, for undo across invocations. */
  ops: string;
}

export function pathsFor(projectPath: string): SessionPaths {
  return {
    project: projectPath,
    ops: `${projectPath}.log`,
    log: `${projectPath}.session`,
    history: `${projectPath}.history`,
  };
}

/**
 * Updates are framed because they are not concatenative — appending two and
 * applying the result as one blob does not work. The revision each was built
 * against rides along in the frame, fixed-width so a reader needs no lookahead.
 */
function frame(update: Uint8Array, baseRev: string): Buffer {
  const framed = Buffer.allocUnsafe(4 + REV_LENGTH + update.length);
  framed.writeUInt32BE(update.length, 0);
  framed.write(baseRev.padEnd(REV_LENGTH, "0").slice(0, REV_LENGTH), 4, "ascii");
  Buffer.from(update).copy(framed, 4 + REV_LENGTH);
  return framed;
}

/** Read framed updates, stopping at a partial one left by a crash. */
function unframe(buffer: Buffer): StoredUpdate[] {
  const updates: StoredUpdate[] = [];
  let offset = 0;

  while (offset + 4 + REV_LENGTH <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const start = offset + 4 + REV_LENGTH;
    if (start + length > buffer.length) break;
    updates.push({
      baseRev: buffer.toString("ascii", offset + 4, start),
      update: new Uint8Array(buffer.subarray(start, start + length)),
    });
    offset = start + length;
  }

  return updates;
}

/** Frequent enough to feel immediate, rare enough to cost nothing. */
const POLL_MS = 150;

export class FileStorage implements ProjectStorage {
  constructor(readonly paths: SessionPaths) {}

  exists(): boolean {
    return existsSync(this.paths.project);
  }

  readText(): string {
    return readFileSync(this.paths.project, "utf-8");
  }

  writeText(text: string): void {
    writeFileAtomic(this.paths.project, text);
  }

  rev(): string {
    return revOf(this.readText());
  }

  appendUpdate(update: Uint8Array, baseRev: string): void {
    appendFileSync(this.paths.log, frame(update, baseRev));
  }

  readUpdates(): StoredUpdate[] {
    if (!existsSync(this.paths.log)) return [];
    return unframe(readFileSync(this.paths.log));
  }

  clearUpdates(): void {
    if (existsSync(this.paths.log)) unlinkSync(this.paths.log);
  }

  hasUpdates(): boolean {
    return existsSync(this.paths.log);
  }

  /**
   * A file offers no transaction, so this is a promise not kept.
   *
   * Left visible rather than hidden: the two writes it wraps really can come
   * apart here, which is one of the reasons for moving off the filesystem.
   */
  transaction<T>(work: () => T): T {
    return work();
  }

  /**
   * Poll, rather than subscribe to filesystem events.
   *
   * `fs.watch` was the obvious choice and the wrong one. A watch on a path
   * follows the inode, and every writer here replaces it by renaming a
   * temporary file over the target, so the watch goes deaf after the first
   * write — including its own. Watching the directory instead fixes that but
   * inherits the rest: a single save reports several times, needing a debounce
   * tuned by guess; the event name is null on some platforms; and how long any
   * of it takes depends on machine load, which made the tests flaky rather than
   * wrong.
   *
   * Polling has none of that, costs one `stat` every 150ms, and is what the
   * SQLite store does with `data_version` — so both answer "did someone else
   * write?" the same way.
   */
  watch(onChange: () => void): () => void {
    const stamp = () => {
      try {
        const { mtimeMs, size } = statSync(this.paths.project);
        return `${mtimeMs}:${size}`;
      } catch {
        return ""; // Mid-rename, or gone; the next poll settles it.
      }
    };

    let seen = stamp();
    const timer = setInterval(() => {
      const now = stamp();
      if (now === seen || now === "") return;
      seen = now;
      onChange();
    }, POLL_MS);
    timer.unref?.();

    return () => clearInterval(timer);
  }

  readOps(): Change[] {
    return existsSync(this.paths.ops)
      ? decodeChanges(readFileSync(this.paths.ops, "utf-8"))
      : [];
  }

  writeOps(changes: readonly Change[]): void {
    // Rewritten whole rather than appended: undo flips a flag on an existing
    // entry, which an append-only file cannot express. A table can, and this
    // becomes an insert plus an update once one is behind it.
    writeFileAtomic(this.paths.ops, encodeChanges(changes));
  }

  appendHistory(entry: HistoryEntry): void {
    appendFileSync(this.paths.history, JSON.stringify(entry) + "\n", "utf-8");
  }

  history(): HistoryEntry[] {
    if (!existsSync(this.paths.history)) return [];
    return readFileSync(this.paths.history, "utf-8")
      .split("\n")
      .filter((line) => line.trim())
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as HistoryEntry];
        } catch {
          return [];
        }
      });
  }
}
