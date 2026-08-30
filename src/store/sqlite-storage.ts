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
  StoredChange,
  StoredSnapshot,
  StoredUpdate,
  revOf,
} from "./storage.js";
import { newId } from "../core/index.js";

/** How often to notice another connection's commit. */
const POLL_MS = 150;

/** The project every store opens unless told otherwise. */
export const DEFAULT_PROJECT = "default";

export class SqliteStorage implements ProjectStorage {
  private readonly db: DatabaseSync;
  private inTransaction = false;

  /**
   * One project inside one database.
   *
   * The database holds many; this is a handle on one of them. Everything below
   * is scoped by `projectId`, and the blobs table deliberately is not — the
   * bytes of a game are the same bytes whoever is annotating them.
   */
  constructor(
    path: string,
    readonly projectId: string = DEFAULT_PROJECT
  ) {
    this.db = openDatabase(path);
  }

  /** Every project this database holds. */
  projects(): { id: string; name: string }[] {
    return this.db.prepare("SELECT id, name FROM projects ORDER BY name").all() as {
      id: string;
      name: string;
    }[];
  }

  /** Create the project row, for `re64 import`. */
  initialize(text: string, now: number, name = this.projectId): void {
    this.db
      .prepare(
        "INSERT INTO projects (id, name, doc, rev, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET " +
          "doc = excluded.doc, rev = excluded.rev, updated_at = excluded.updated_at"
      )
      .run(this.projectId, name, text, revOf(text), now, now);
  }

  exists(): boolean {
    return (
      this.db.prepare("SELECT 1 FROM projects WHERE id = ?").get(this.projectId) !== undefined
    );
  }

  readText(): string {
    const row = this.db.prepare("SELECT doc FROM projects WHERE id = ?").get(this.projectId) as
      | { doc: string }
      | undefined;
    if (row === undefined) throw new Error(`No project called "${this.projectId}"`);
    return row.doc;
  }

  writeText(text: string): void {
    this.db
      .prepare("UPDATE projects SET doc = ?, rev = ?, updated_at = ? WHERE id = ?")
      .run(text, revOf(text), Date.now(), this.projectId);
  }

  rev(): string {
    const row = this.db.prepare("SELECT rev FROM projects WHERE id = ?").get(this.projectId) as
      | { rev: string }
      | undefined;
    return row?.rev ?? "";
  }

  appendUpdate(update: Uint8Array): void {
    this.db.prepare("INSERT INTO updates (project_id, payload) VALUES (?, ?)")
      .run(this.projectId, update);
  }

  readUpdates(afterSeq = 0): StoredUpdate[] {
    const rows = this.db
      .prepare("SELECT seq, payload FROM updates WHERE project_id = ? AND seq > ? ORDER BY seq")
      .all(this.projectId, afterSeq) as { seq: number; payload: Uint8Array }[];
    return rows.map((r) => ({ seq: r.seq, update: new Uint8Array(r.payload) }));
  }

  hasUpdates(): boolean {
    return this.db.prepare("SELECT 1 FROM updates WHERE project_id = ? LIMIT 1").get(this.projectId) !== undefined;
  }

  readSnapshot(): StoredSnapshot | undefined {
    const row = this.db
      .prepare(
        "SELECT seq_upto, payload FROM snapshots WHERE project_id = ? " +
          "ORDER BY seq_upto DESC LIMIT 1"
      )
      .get(this.projectId) as { seq_upto: number; payload: Uint8Array } | undefined;
    return row ? { seqUpto: row.seq_upto, update: new Uint8Array(row.payload) } : undefined;
  }

  writeSnapshot(snapshot: StoredSnapshot): void {
    this.db
      .prepare("INSERT OR REPLACE INTO snapshots (project_id, seq_upto, payload) VALUES (?, ?, ?)")
      .run(this.projectId, snapshot.seqUpto, snapshot.update);
  }

  appendHistory(entry: HistoryEntry): void {
    this.db
      .prepare("INSERT INTO history (project_id, at, authors, summary) VALUES (?, ?, ?, ?)")
      .run(this.projectId, entry.at, JSON.stringify(entry.authors), JSON.stringify(entry.summary));
  }

  history(): HistoryEntry[] {
    const rows = this.db
      .prepare("SELECT at, authors, summary FROM history WHERE project_id = ? ORDER BY seq")
      .all(this.projectId) as { at: number; authors: string; summary: string }[];
    return rows.map((r) => ({
      at: r.at,
      authors: JSON.parse(r.authors) as string[],
      summary: JSON.parse(r.summary) as string[],
    }));
  }

  readOps(afterSeq = 0): StoredChange[] {
    const rows = this.db
      .prepare(
        "SELECT seq, op, inverse, author, at, undone FROM ops " +
          "WHERE project_id = ? AND seq > ? ORDER BY seq"
      )
      .all(this.projectId, afterSeq) as {
      seq: number;
      op: string;
      inverse: string;
      author: string | null;
      at: number | null;
      undone: number;
    }[];

    return rows.map((r) => ({
      seq: r.seq,
      op: JSON.parse(r.op) as Change["op"],
      inverse: JSON.parse(r.inverse) as Change["inverse"],
      ...(r.author === null ? {} : { author: r.author }),
      ...(r.at === null ? {} : { at: r.at }),
      ...(r.undone ? { undone: true } : {}),
    }));
  }

  appendOps(changes: readonly Change[]): void {
    const insert = this.db.prepare(
      "INSERT INTO ops (project_id, op, inverse, author, at, undone) VALUES (?, ?, ?, ?, ?, ?)"
    );
    for (const c of changes) {
      insert.run(
        this.projectId,
        JSON.stringify(c.op),
        JSON.stringify(c.inverse),
        c.author ?? null,
        c.at ?? null,
        c.undone ? 1 : 0
      );
    }
  }

  markUndone(seq: number, undone: boolean): void {
    this.db
      .prepare("UPDATE ops SET undone = ? WHERE project_id = ? AND seq = ?")
      .run(undone ? 1 : 0, this.projectId, seq);
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
  startSession(id: string, userId: string | undefined, now: number, codename?: string): void {
    this.db
      .prepare(
        "INSERT INTO sessions (id, user_id, project_id, codename, started_at, last_seen_at) " +
          "VALUES (?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at, " +
          "codename = COALESCE(excluded.codename, sessions.codename)"
      )
      .run(id, userId ?? null, this.projectId, codename ?? null, now, now);
  }

  /** Bind the Yjs client id, once the traffic reveals it. */
  noteSessionClient(id: string, clientId: number, now: number): void {
    this.db
      .prepare("UPDATE sessions SET client_id = ?, last_seen_at = ? WHERE id = ?")
      .run(clientId, now, id);
  }

  /**
   * Who was editing under a Yjs client id.
   *
   * The whole point of recording client ids: a struct in the document carries
   * one, so this turns "who wrote this label" from unanswerable into a lookup.
   */
  authorOf(clientId: number): { sessionId: string; userId: string | null } | undefined {
    const row = this.db
      .prepare("SELECT id, user_id FROM sessions WHERE client_id = ? ORDER BY started_at DESC")
      .get(clientId) as { id: string; user_id: string | null } | undefined;
    return row ? { sessionId: row.id, userId: row.user_id } : undefined;
  }

  sessions(): {
    id: string;
    userId: string | null;
    clientId: number | null;
    codename: string | null;
  }[] {
    return (
      this.db
        .prepare("SELECT id, user_id, client_id, codename FROM sessions ORDER BY started_at")
        .all() as {
        id: string;
        user_id: string | null;
        client_id: number | null;
        codename: string | null;
      }[]
    ).map((r) => ({
      id: r.id,
      userId: r.user_id,
      clientId: r.client_id,
      codename: r.codename,
    }));
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
        "INSERT INTO files (id, project_id, name, hash) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(project_id, name) DO UPDATE SET hash = excluded.hash"
      )
      .run(newId("fil"), this.projectId, normalizeBlobName(name), hash);
    return hash;
  }

  /** The bytes a project name stands for, or undefined if it holds none. */
  blob(name: string): Uint8Array | undefined {
    const row = this.db
      .prepare(
        "SELECT b.bytes AS bytes FROM files f JOIN blobs b ON b.hash = f.hash " +
          "WHERE f.project_id = ? AND f.name = ?"
      )
      .get(this.projectId, normalizeBlobName(name)) as { bytes: Uint8Array } | undefined;
    return row ? new Uint8Array(row.bytes) : undefined;
  }

  /** What the project calls each file it holds bytes for. */
  blobNames(): string[] {
    return (this.db
      .prepare("SELECT name FROM files WHERE project_id = ? ORDER BY name")
      .all(this.projectId) as {
      name: string;
    }[]).map((r) => r.name);
  }

  /** The content hash recorded for a name, for integrity checks. */
  blobHash(name: string): string | undefined {
    const row = this.db
      .prepare("SELECT hash FROM files WHERE project_id = ? AND name = ?")
      .get(this.projectId, normalizeBlobName(name)) as { hash: string } | undefined;
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
