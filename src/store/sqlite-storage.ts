/**
 * A project in SQLite.
 *
 * The reason to be here is not size — a heavily annotated game is a couple of
 * thousand tiny records. It is that a JSON file has no transactions, and three
 * writers share this project: the CLI, the server, and whoever has it open in
 * an editor. Every workaround the filesystem needed — atomic rename, a
 * directory watcher, comparing content to recognise one's own writes — exists
 * because a file could not offer what BEGIN IMMEDIATE offers for free.
 */

import { Change } from "../core/index.js";
import { DatabaseSync, openDatabase } from "./db.js";
import { HistoryEntry, ProjectStorage, StoredUpdate, revOf } from "./storage.js";

/** How often to notice another connection's commit. */
const POLL_MS = 150;

export class SqliteStorage implements ProjectStorage {
  private readonly db: DatabaseSync;
  private inTransaction = false;

  constructor(path: string) {
    this.db = openDatabase(path);
  }

  /** Create the single project row, for `re64 import`. */
  initialize(text: string, now: number): void {
    this.db
      .prepare("INSERT OR REPLACE INTO project (id, doc, rev, updated_at) VALUES (1, ?, ?, ?)")
      .run(text, revOf(text), now);
  }

  exists(): boolean {
    return this.db.prepare("SELECT 1 FROM project WHERE id = 1").get() !== undefined;
  }

  readText(): string {
    const row = this.db.prepare("SELECT doc FROM project WHERE id = 1").get() as
      | { doc: string }
      | undefined;
    if (row === undefined) throw new Error("This database holds no project");
    return row.doc;
  }

  writeText(text: string): void {
    this.db
      .prepare("UPDATE project SET doc = ?, rev = ?, updated_at = ? WHERE id = 1")
      .run(text, revOf(text), Date.now());
  }

  rev(): string {
    const row = this.db.prepare("SELECT rev FROM project WHERE id = 1").get() as
      | { rev: string }
      | undefined;
    return row?.rev ?? "";
  }

  appendUpdate(update: Uint8Array, baseRev: string): void {
    this.db
      .prepare("INSERT INTO session_updates (base_rev, payload) VALUES (?, ?)")
      .run(baseRev, update);
  }

  readUpdates(): StoredUpdate[] {
    const rows = this.db
      .prepare("SELECT base_rev, payload FROM session_updates ORDER BY seq")
      .all() as { base_rev: string; payload: Uint8Array }[];
    return rows.map((r) => ({ baseRev: r.base_rev, update: new Uint8Array(r.payload) }));
  }

  clearUpdates(): void {
    this.db.exec("DELETE FROM session_updates");
  }

  hasUpdates(): boolean {
    return this.db.prepare("SELECT 1 FROM session_updates LIMIT 1").get() !== undefined;
  }

  appendHistory(entry: HistoryEntry): void {
    this.db
      .prepare("INSERT INTO history (at, authors, summary) VALUES (?, ?, ?)")
      .run(entry.at, JSON.stringify(entry.authors), JSON.stringify(entry.summary));
  }

  history(): HistoryEntry[] {
    const rows = this.db
      .prepare("SELECT at, authors, summary FROM history ORDER BY seq")
      .all() as { at: number; authors: string; summary: string }[];
    return rows.map((r) => ({
      at: r.at,
      authors: JSON.parse(r.authors) as string[],
      summary: JSON.parse(r.summary) as string[],
    }));
  }

  readOps(): Change[] {
    const rows = this.db
      .prepare("SELECT op, inverse, author, at, undone FROM ops ORDER BY seq")
      .all() as { op: string; inverse: string; author: string | null; at: number | null; undone: number }[];
    return rows.map((r) => ({
      op: JSON.parse(r.op),
      inverse: JSON.parse(r.inverse),
      ...(r.author === null ? {} : { author: r.author }),
      ...(r.at === null ? {} : { at: r.at }),
      ...(r.undone ? { undone: true } : {}),
    }));
  }

  writeOps(changes: readonly Change[]): void {
    // Rewritten whole to match the interface a file could offer. A table could
    // do better — an insert plus a flag update — but the caller does not know
    // which entries changed, and inventing that distinction here would put the
    // two implementations out of step.
    this.db.exec("DELETE FROM ops");
    const insert = this.db.prepare(
      "INSERT INTO ops (op, inverse, author, at, undone) VALUES (?, ?, ?, ?, ?)"
    );
    for (const c of changes) {
      insert.run(
        JSON.stringify(c.op),
        JSON.stringify(c.inverse),
        c.author ?? null,
        c.at ?? null,
        c.undone ? 1 : 0
      );
    }
  }

  /**
   * IMMEDIATE rather than DEFERRED: take the write lock up front.
   *
   * A deferred transaction that reads and then tries to write can find another
   * connection has committed in between, and SQLite can only answer SQLITE_BUSY
   * — it cannot retry, because the read that informed the write is already
   * stale. Taking the lock at the start turns that into a short wait.
   */
  transaction<T>(work: () => T): T {
    if (this.inTransaction) return work();
    this.db.exec("BEGIN IMMEDIATE");
    this.inTransaction = true;
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  /**
   * Notice another connection's commit.
   *
   * `data_version` changes only when a *different* connection writes, so this
   * needs no debounce, reports no spurious events, and behaves the same on
   * every platform — none of which was true of watching a directory.
   */
  watch(onChange: () => void): () => void {
    const read = () =>
      (this.db.prepare("PRAGMA data_version").get() as { data_version: number }).data_version;

    let seen = read();
    const timer = setInterval(() => {
      const now = read();
      if (now === seen) return;
      seen = now;
      onChange();
    }, POLL_MS);
    timer.unref?.();

    return () => clearInterval(timer);
  }

  close(): void {
    this.db.close();
  }
}
