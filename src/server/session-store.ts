/**
 * The live document for a project, shared by everyone editing it.
 *
 * The server holds one `Y.Doc` per project. Clients merge into it over a
 * socket; it merges back. Periodically — and whenever the last participant
 * leaves — the accumulated changes are flattened into the project file as a
 * single history entry.
 *
 * Two jobs that look alike but are not:
 *
 * - **Crash safety.** Updates are appended to a log as they arrive, so a lost
 *   browser or a killed server costs nothing. Transient; dropped after flatten.
 * - **History hygiene.** A flatten writes the file and records one entry per
 *   session, not one per keystroke.
 *
 * The flatten diffs the document against the file and applies the resulting
 * operations through the line-editing serializer. Writing the document out
 * directly would discard the blank lines that group labels and reorder
 * hand-declared regions — a whole-file diff standing in for a one-line edit.
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import {
  Change,
  Op,
  applyOps,
  diffProjects,
  describeOp,
  parseProject,
} from "../core/index.js";
import {
  CrdtDoc,
  applyUpdate,
  docFromProject,
  encodeDoc,
  projectFromDoc,
} from "../core/crdt/index.js";

/** One flattened session, as recorded in the project's history. */
export interface HistoryEntry {
  at: number;
  /** Everyone who contributed to the session. */
  authors: string[];
  /** What changed, in the vocabulary the UI and CLI use. */
  summary: string[];
}

export interface SessionPaths {
  project: string;
  /** Yjs updates as they arrive; exists only while a session is open. */
  log: string;
  /** Flattened sessions, one JSON object per line. */
  history: string;
}

/**
 * Updates are length-prefixed in the log.
 *
 * Yjs updates are not concatenative: appending two and applying the result as
 * one fails. Each is framed so the log can be replayed update by update.
 */
function frameUpdate(update: Uint8Array): Buffer {
  const framed = Buffer.allocUnsafe(4 + update.length);
  framed.writeUInt32BE(update.length, 0);
  Buffer.from(update).copy(framed, 4);
  return framed;
}

/** Read framed updates, stopping at a partial one left by a crash. */
function readLog(buffer: Buffer): Uint8Array[] {
  const updates: Uint8Array[] = [];
  let offset = 0;
  while (offset + 4 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    if (offset + 4 + length > buffer.length) break; // truncated tail
    updates.push(new Uint8Array(buffer.subarray(offset + 4, offset + 4 + length)));
    offset += 4 + length;
  }
  return updates;
}

export function pathsFor(projectPath: string): SessionPaths {
  return {
    project: projectPath,
    log: `${projectPath}.session`,
    history: `${projectPath}.history`,
  };
}

export class ProjectSessionStore {
  private doc: CrdtDoc | undefined;
  private readonly authors = new Set<string>();
  private readonly listeners: ((update: Uint8Array, origin: unknown) => void)[] = [];
  private dirty = false;

  constructor(private readonly paths: SessionPaths) {}

  /**
   * The shared document, built on first use.
   *
   * Recovers from the update log if one survived a crash, so an interrupted
   * session resumes rather than silently losing its edits.
   */
  document(): CrdtDoc {
    if (this.doc) return this.doc;

    const project = parseProject(readFileSync(this.paths.project, "utf-8"));
    this.doc = docFromProject(project);

    if (existsSync(this.paths.log)) {
      const recovered = readLog(readFileSync(this.paths.log));
      for (const update of recovered) applyUpdate(this.doc, update, "recovery");
      if (recovered.length > 0) this.dirty = true;
    }

    // Every subsequent change is appended, so nothing depends on a clean exit.
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === "recovery") return;
      appendFileSync(this.paths.log, frameUpdate(update));
      this.dirty = true;
      for (const listener of this.listeners) listener(update, origin);
    });

    return this.doc;
  }

  /**
   * Watch every change to the shared document.
   *
   * Registered before the document exists, so a listener added at construction
   * still sees the first edit.
   */
  onUpdate(listener: (update: Uint8Array, origin: unknown) => void): void {
    this.listeners.push(listener);
  }

  /**
   * Identifies the content the document currently holds.
   *
   * Not the file: during a live session the file is stale by design, so a
   * caller checking it would think nothing had changed and overwrite work that
   * had merged in the meantime.
   */
  version(): string {
    return createHash("sha256")
      .update(JSON.stringify(projectFromDoc(this.document())))
      .digest("hex")
      .slice(0, 12);
  }

  /** Note who is editing, for the history entry. */
  addAuthor(author: string): void {
    this.authors.add(author);
  }

  get hasChanges(): boolean {
    return this.dirty;
  }

  /** Everything a joining client is missing. */
  snapshot(): Uint8Array {
    return encodeDoc(this.document());
  }

  merge(update: Uint8Array, origin: unknown): void {
    applyUpdate(this.document(), update, origin);
  }

  /**
   * Bring the project file up to date with the document.
   *
   * The file is written from the *whole* document rather than from any one
   * caller's changes, so it never lands in a mixed state where an HTTP write
   * is on disk but a socket edit merged a moment earlier is not.
   *
   * The operations are applied line by line rather than the document being
   * written out: the document knows the content, not which labels a blank line
   * grouped or what order regions were declared in.
   *
   * Returns what changed, so a caller can decide whether it is worth recording.
   */
  writeFile(): Op[] {
    const doc = this.document();
    const text = readFileSync(this.paths.project, "utf-8");
    const ops = diffProjects(parseProject(text), projectFromDoc(doc));
    if (ops.length > 0) writeFileSync(this.paths.project, applyOps(text, ops), "utf-8");
    return ops;
  }

  /**
   * End the session: write the file and record one history entry.
   *
   * Returns the entry, or undefined when nothing changed — an idle session
   * should leave no trace.
   *
   * Building the document rather than assuming it exists matters: a process
   * that starts only to flatten a crashed session has never touched it, and
   * returning early would discard the very work the log was keeping safe.
   */
  flatten(now: number): HistoryEntry | undefined {
    this.document();
    if (!this.dirty) return undefined;

    const ops = this.writeFile();
    if (ops.length === 0) {
      this.discardLog();
      return undefined;
    }

    const entry: HistoryEntry = {
      at: now,
      authors: [...this.authors].sort(),
      summary: ops.map(describeOp),
    };
    appendFileSync(this.paths.history, JSON.stringify(entry) + "\n", "utf-8");

    this.discardLog();
    return entry;
  }

  /** Crash-safety log has served its purpose once the file is written. */
  private discardLog(): void {
    if (existsSync(this.paths.log)) unlinkSync(this.paths.log);
    this.dirty = false;
    this.authors.clear();
  }

  /** Past sessions, oldest first. */
  history(): HistoryEntry[] {
    if (!existsSync(this.paths.history)) return [];
    return readFileSync(this.paths.history, "utf-8")
      .split("\n")
      .filter((line) => line.trim())
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as HistoryEntry];
        } catch {
          // A partially written final line costs one entry, not the file.
          return [];
        }
      });
  }
}

/** Convert a change log into a history entry, for edits that bypassed a session. */
export function entryFromChanges(changes: readonly Change[], now: number): HistoryEntry {
  return {
    at: now,
    authors: [...new Set(changes.map((c) => c.author ?? "unknown"))].sort(),
    summary: changes.map((c) => describeOp(c.op)),
  };
}
