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
import { hashBytes, normalizeBlobName } from "./blobs.js";
import {
  HistoryEntry,
  ProjectStorage,
  StoredSnapshot,
  StoredUpdate,
  revOf,
} from "./storage.js";
import { newId } from "../core/index.js";

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

  appendUpdate(update: Uint8Array): void {
    this.db.prepare("INSERT INTO updates (payload) VALUES (?)").run(update);
  }

  readUpdates(afterSeq = 0): StoredUpdate[] {
    const rows = this.db
      .prepare("SELECT seq, payload FROM updates WHERE seq > ? ORDER BY seq")
      .all(afterSeq) as { seq: number; payload: Uint8Array }[];
    return rows.map((r) => ({ seq: r.seq, update: new Uint8Array(r.payload) }));
  }

  hasUpdates(): boolean {
    return this.db.prepare("SELECT 1 FROM updates LIMIT 1").get() !== undefined;
  }

  readSnapshot(): StoredSnapshot | undefined {
    const row = this.db
      .prepare("SELECT seq_upto, payload FROM snapshots ORDER BY seq_upto DESC LIMIT 1")
      .get() as { seq_upto: number; payload: Uint8Array } | undefined;
    return row ? { seqUpto: row.seq_upto, update: new Uint8Array(row.payload) } : undefined;
  }

  writeSnapshot(snapshot: StoredSnapshot): void {
    this.db
      .prepare("INSERT OR REPLACE INTO snapshots (seq_upto, payload) VALUES (?, ?)")
      .run(snapshot.seqUpto, snapshot.update);
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

  /** Everyone who can be picked in the interface. */
  users(): { id: string; name: string; colour: string }[] {
    return this.db.prepare("SELECT id, name, colour FROM users ORDER BY name").all() as {
      id: string;
      name: string;
      colour: string;
    }[];
  }

  addUser(user: { id: string; name: string; colour: string }): void {
    this.db
      .prepare("INSERT OR REPLACE INTO users (id, name, colour) VALUES (?, ?, ?)")
      .run(user.id, user.name, user.colour);
  }

  /**
   * Note that a session exists, and who claims to be behind it.
   *
   * Idempotent: a reconnect keeps the same row and only moves `last_seen_at`.
   */
  startSession(id: string, userId: string | undefined, now: number): void {
    this.db
      .prepare(
        "INSERT INTO sessions (id, user_id, started_at, last_seen_at) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at"
      )
      .run(id, userId ?? null, now, now);
  }

  /** Bind the Yjs client id, once the traffic reveals it. */
  noteSessionClient(id: string, clientId: number, now: number): void {
    this.db
      .prepare("UPDATE sessions SET client_id = ?, last_seen_at = ? WHERE id = ?")
      .run(clientId, now, id);
  }

  sessions(): { id: string; userId: string | null; clientId: number | null }[] {
    return (
      this.db
        .prepare("SELECT id, user_id, client_id FROM sessions ORDER BY started_at")
        .all() as { id: string; user_id: string | null; client_id: number | null }[]
    ).map((r) => ({ id: r.id, userId: r.user_id, clientId: r.client_id }));
  }

  /**
   * Store bytes under the name the project uses for them.
   *
   * The same bytes arriving under a second name cost nothing but a row: the
   * blob is shared, the name is not.
   */
  putBlob(name: string, bytes: Uint8Array): string {
    const hash = hashBytes(bytes);
    this.db
      .prepare("INSERT OR IGNORE INTO blobs (hash, size, bytes) VALUES (?, ?, ?)")
      .run(hash, bytes.length, bytes);
    this.db
      .prepare(
        "INSERT INTO files (id, name, hash) VALUES (?, ?, ?) " +
          "ON CONFLICT(name) DO UPDATE SET hash = excluded.hash"
      )
      .run(newId("fil"), normalizeBlobName(name), hash);
    return hash;
  }

  /** The bytes a project name stands for, or undefined if it holds none. */
  blob(name: string): Uint8Array | undefined {
    const row = this.db
      .prepare(
        "SELECT b.bytes AS bytes FROM files f JOIN blobs b ON b.hash = f.hash WHERE f.name = ?"
      )
      .get(normalizeBlobName(name)) as { bytes: Uint8Array } | undefined;
    return row ? new Uint8Array(row.bytes) : undefined;
  }

  /** What the project calls each file it holds bytes for. */
  blobNames(): string[] {
    return (this.db.prepare("SELECT name FROM files ORDER BY name").all() as {
      name: string;
    }[]).map((r) => r.name);
  }

  /** The content hash recorded for a name, for integrity checks. */
  blobHash(name: string): string | undefined {
    const row = this.db
      .prepare("SELECT hash FROM files WHERE name = ?")
      .get(normalizeBlobName(name)) as { hash: string } | undefined;
    return row?.hash;
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
