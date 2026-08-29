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
import { HistoryEntry, ProjectStorage, revOf } from "../store/index.js";
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
  applyOpToDoc,
  applyUpdate,
  docFromProject,
  encodeDoc,
  projectFromDoc,
} from "../core/crdt/index.js";

export type { HistoryEntry } from "../store/index.js";
export { pathsFor } from "../store/index.js";

export class ProjectSessionStore {
  private doc: CrdtDoc | undefined;
  private readonly authors = new Set<string>();
  private readonly listeners: ((update: Uint8Array, origin: unknown) => void)[] = [];
  /**
   * What this session has changed so far.
   *
   * Accumulated as the file is written rather than derived at the end: the file
   * is kept current during a session, so a diff taken at flatten time would be
   * empty and the history entry would be lost.
   */
  private sessionOps: Op[] = [];
  private dirty = false;
  /**
   * The text this store last wrote.
   *
   * Used to tell its own writes apart from someone else's. Comparing content
   * rather than trusting watch events, which fire spuriously, coalesce, and
   * differ between platforms.
   */
  private lastWritten: string | undefined;
  private unwatch: (() => void) | undefined;
  /** The revision the document was built from; see `StoredUpdate`. */
  private baseRev = "";

  constructor(private readonly storage: ProjectStorage) {}

  /**
   * The shared document, built on first use.
   *
   * Recovers from the update log if one survived a crash, so an interrupted
   * session resumes rather than silently losing its edits.
   */
  document(): CrdtDoc {
    if (this.doc) return this.doc;

    const text = this.storage.readText();
    this.baseRev = revOf(text);
    this.doc = docFromProject(parseProject(text));

    // Replay only what was built against this exact text. An update recorded
    // against an older revision would merge without complaint and resurrect
    // entries the current text deleted, so it is dropped instead.
    const recovered = this.storage
      .readUpdates()
      .filter((stored) => stored.baseRev === this.baseRev);
    for (const stored of recovered) applyUpdate(this.doc, stored.update, "recovery");
    if (recovered.length > 0) this.dirty = true;

    // Every subsequent change is appended, so nothing depends on a clean exit.
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === "recovery") return;
      this.storage.appendUpdate(update, this.baseRev);
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

  /**
   * Apply an operation to the shared document.
   *
   * Tagged as coming from the file so it is not mistaken for a participant's
   * edit — an undo stack should not offer to revert someone's use of the CLI.
   */
  applyExternalOp(op: Op): void {
    applyOpToDoc(this.document(), op, "file");
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
    // The file can disappear under a live session — moved, deleted, or on a
    // volume that went away. There is nothing to diff against, and recreating
    // it would resurrect something the user removed on purpose. The session's
    // work stays in the sidecar log, which is what it is for.
    if (!this.storage.exists()) return [];
    const text = this.storage.readText();
    const ops = diffProjects(parseProject(text), projectFromDoc(doc));
    if (ops.length > 0) {
      const updated = applyOps(text, ops);
      this.storage.writeText(updated);
      this.lastWritten = updated;
      this.baseRev = revOf(updated);
      this.sessionOps.push(...ops);
    }
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

    // Catch anything the debounce had not yet written, then record everything
    // the session did — not just what was still outstanding at the end.
    this.writeFile();
    if (this.sessionOps.length === 0) {
      this.discardLog();
      return undefined;
    }

    const entry: HistoryEntry = {
      at: now,
      authors: [...this.authors].sort(),
      summary: this.sessionOps.map(describeOp),
    };
    this.storage.appendHistory(entry);

    this.discardLog();
    return entry;
  }

  /** Crash-safety log has served its purpose once the file is written. */
  private discardLog(): void {
    this.storage.clearUpdates();
    this.dirty = false;
    this.authors.clear();
    this.sessionOps = [];
  }

  /**
   * Merge changes made to the file by someone else.
   *
   * The CLI writes the project directly, as does any editor. Without this the
   * document would never learn of those edits, and the next write — which
   * applies the difference between the document and the file — would compute
   * that difference in the wrong direction and silently revert them.
   *
   * The change is applied as operations, so it merges like any other edit and
   * reaches connected sessions rather than only landing on disk.
   */
  watchFile(applyExternal: (ops: Op[]) => void): void {
    if (this.unwatch) return;
    this.lastWritten ??= this.storage.readText();
    this.unwatch = this.storage.watch(() => this.absorbExternalChange(applyExternal));
  }

  private absorbExternalChange(applyExternal: (ops: Op[]) => void): void {
    let text: string;
    try {
      text = this.storage.readText();
    } catch {
      return; // Being replaced; the next event will bring the new content.
    }
    if (text === this.lastWritten) return; // Our own write coming back.

    let ops: Op[];
    try {
      ops = diffProjects(projectFromDoc(this.document()), parseProject(text));
    } catch {
      return; // Mid-save or hand-broken; wait for it to become valid again.
    }

    this.lastWritten = text;
    this.baseRev = revOf(text);
    if (ops.length === 0) return;

    applyExternal(ops);

    // Record it as part of the session. The store cannot tell who wrote the
    // file, so it is attributed to the filesystem rather than to a participant
    // — but leaving it out entirely would make the history claim a session
    // ended in a state it did not.
    this.sessionOps.push(...ops);
    this.authors.add("file");
    this.dirty = true;
  }

  stopWatching(): void {
    this.unwatch?.();
    this.unwatch = undefined;
  }

  /** Past sessions, oldest first. */
  history(): HistoryEntry[] {
    return this.storage.history();
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
