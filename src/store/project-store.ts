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
import { HistoryEntry, ProjectStorage, revOf } from "./storage.js";
import {
  Change,
  Op,
  applyOp,
  applyOps,
  diffProjects,
  describeOp,
  invertOp,
  parseProject,
} from "../core/index.js";
import {
  CrdtDoc,
  applyOpToDoc,
  applyUpdate,
  docFromProject,
  docFromUpdates,
  encodeDoc,
  projectFromDoc,
} from "../core/crdt/index.js";

export class ProjectStore {
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

  constructor(private readonly storage: ProjectStorage) {}

  /**
   * The shared document, built on first use.
   *
   * Recovers from the update log if one survived a crash, so an interrupted
   * session resumes rather than silently losing its edits.
   */
  document(): CrdtDoc {
    if (this.doc) return this.doc;

    this.doc = this.load();
    this.lastWritten = this.storage.readText();

    // Every change is appended as it happens. This is the write that matters —
    // the exported text is derived from it, not the other way round — so a
    // process that dies here has lost nothing.
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === "load") return;
      this.storage.appendUpdate(update);
      this.dirty = true;
      for (const listener of this.listeners) listener(update, origin);
    });

    return this.doc;
  }

  /**
   * Rebuild the document from what was stored.
   *
   * A snapshot, if there is one, plus every update recorded after it. The
   * snapshot is only a shortcut: replaying the whole log reaches the same
   * state, because updates are commutative and idempotent.
   *
   * A project written before the document was canonical has text but no
   * updates. It is converted once, here, and the result kept as the first
   * snapshot — which is the only place `docFromProject` is still reached from,
   * and why its determinism no longer has to hold across clients.
   */
  private load(): CrdtDoc {
    const snapshot = this.storage.readSnapshot();
    const tail = this.storage.readUpdates(snapshot?.seqUpto ?? 0);

    if (!snapshot && tail.length === 0) {
      const converted = docFromProject(parseProject(this.storage.readText()));
      this.storage.writeSnapshot({ seqUpto: 0, update: encodeDoc(converted) });
      return converted;
    }

    // Updates past the snapshot are work that has not been recorded in the
    // history yet — a session that ended without one, usually because the
    // process died. Marking it lets the next flatten account for it.
    if (tail.length > 0) this.dirty = true;

    return docFromUpdates([
      ...(snapshot ? [snapshot.update] : []),
      ...tail.map((stored) => stored.update),
    ]);
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

  /**
   * What the server knows about this project, for the debug view.
   *
   * Nothing here is load-bearing; it exists because the interesting state — the
   * CRDT document, the crash log, the undo record — lives on this side and is
   * otherwise invisible from a browser.
   */
  debug(): {
    version: string;
    storedRev: string;
    dirty: boolean;
    authors: string[];
    pendingOps: number;
    updates: { count: number; snapshotAt: number };
    ops: { total: number; undone: number };
    history: number;
  } {
    const updates = this.storage.readUpdates();
    const ops = this.storage.readOps();
    return {
      version: this.version(),
      storedRev: this.storage.rev(),
      dirty: this.dirty,
      authors: [...this.authors].sort(),
      pendingOps: this.sessionOps.length,
      updates: { count: updates.length, snapshotAt: this.storage.readSnapshot()?.seqUpto ?? 0 },
      ops: { total: ops.length, undone: ops.filter((c) => c.undone).length },
      history: this.storage.history().length,
    };
  }

  /** The project as stored, without going through the document. */
  text(): string {
    return this.storage.readText();
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
    this.absorb(text);
    const ops = diffProjects(parseProject(text), projectFromDoc(doc));
    if (ops.length > 0) {
      const updated = applyOps(text, ops);
      this.storage.writeText(updated);
      this.lastWritten = updated;
      this.sessionOps.push(...ops);
    }
    // Note what is *not* here: the update log is not cleared. It was, when the
    // text was canonical and a write meant the log had served its purpose. Now
    // the log is the project and the text is the export, so clearing it here
    // would delete the project on every debounce tick.
    return ops;
  }

  /**
   * Fold in what another writer changed, before deciding what to write.
   *
   * Without this a write is a claim that the document is the whole truth, and
   * anything a second writer put in the text since gets diffed straight back
   * out — the silent revert this store exists to prevent. A watcher normally
   * absorbs first, but correctness cannot depend on one running.
   *
   * Three-way, not two: the diff is taken from the text as we last knew it, so
   * it describes what *they* did. Diffing our document against theirs has no
   * common ancestor and cannot tell "they added this" from "we deleted it".
   */
  private absorb(text: string): void {
    if (this.lastWritten === undefined || text === this.lastWritten) {
      this.lastWritten = text;
      return;
    }

    const external = diffProjects(parseProject(this.lastWritten), parseProject(text));
    for (const op of external) applyOpToDoc(this.document(), op, "external");
    this.lastWritten = text;
    if (external.length > 0) {
      this.sessionOps.push(...external);
      this.authors.add("file");
      this.dirty = true;
    }
  }

  /**
   * Apply operations and record them so they can be undone.
   *
   * This is the only way anything mutates a project. Both the CLI and the
   * server's own writes come through here, which is what makes the hazard it
   * replaces structurally impossible rather than merely guarded against: when a
   * second writer edited the text directly, the next write diffed the document
   * against it and emitted operations reverting that edit.
   *
   * Inverses are computed as the batch runs. Each has to see the state its own
   * operation saw, so computing them up front would invert against the wrong
   * document.
   */
  runOps(
    ops: readonly Op[],
    author: string,
    now: number
  ): { applied: number; descriptions: string[] } {
    if (ops.length === 0) return { applied: 0, descriptions: [] };

    return this.storage.transaction(() => {
      // Learn what anyone else did *before* applying ours, not after. Applying
      // first and reconciling second lets their change land on top of the edit
      // being made, because reconciliation cannot tell it from anything else
      // the document is missing. It also means inverses are computed against
      // the state the operation is actually applied to.
      this.absorb(this.storage.readText());

      let text = this.storage.readText();
      const changes: Change[] = [];
      for (const op of ops) {
        changes.push({ op, inverse: invertOp(text, op), author, at: now });
        text = applyOp(text, op);
      }

      this.addAuthor(author);
      this.applyThroughDocument(ops, author);
      this.storage.writeOps([...this.storage.readOps(), ...changes]);

      return { applied: ops.length, descriptions: ops.map(describeOp) };
    });
  }

  /**
   * Undo the most recent change, by default one of the caller's own.
   *
   * Scoped to the author because the record is shared: a person at the CLI
   * pressing undo should not silently revert what someone in a browser just
   * did. `author` omitted means anyone's.
   */
  undo(author?: string): string | null {
    return this.step(
      (c) => !c.undone && (author === undefined || c.author === author),
      (c) => c.inverse,
      true
    );
  }

  /** Redo the most recently undone change, by the same scoping rule. */
  redo(author?: string): string | null {
    return this.step(
      (c) => c.undone === true && (author === undefined || c.author === author),
      (c) => c.op,
      false
    );
  }

  private step(
    wanted: (change: Change) => boolean,
    direction: (change: Change) => Op,
    undone: boolean
  ): string | null {
    return this.storage.transaction(() => {
      const log = this.storage.readOps();
      for (let i = log.length - 1; i >= 0; i--) {
        if (!wanted(log[i])) continue;
        this.applyThroughDocument([direction(log[i])], log[i].author ?? "unknown");
        log[i].undone = undone;
        this.storage.writeOps(log);
        return describeOp(log[i].op);
      }
      return null;
    });
  }

  /**
   * Route operations into the document, then let the document produce the text.
   *
   * Never applied to the text directly. The document is what merges, so a write
   * that skipped it would be invisible to everyone else holding one.
   */
  private applyThroughDocument(ops: readonly Op[], author: string): void {
    const doc = this.document();
    this.absorb(this.storage.readText());
    for (const op of ops) applyOpToDoc(doc, op, author);
    this.writeFile();
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
  watchFile(): void {
    if (this.unwatch) return;
    this.unwatch = this.storage.watch(() => this.absorbExternalChange());
  }

  private absorbExternalChange(): void {
    this.document();
    try {
      this.absorb(this.storage.readText());
    } catch {
      // The project is being replaced, or is mid-save and not valid JSON yet.
      // The next event brings the finished content.
    }
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
