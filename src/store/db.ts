/**
 * Opening a project database.
 *
 * One database per project, sitting beside the binaries it describes. The
 * schema is deliberately dull: the project is a single column of text, not
 * normalized tables. Nothing queries below project granularity — analysis runs
 * in the browser over the whole thing — and normalizing would destroy the one
 * property the serializer exists to protect, that a one-label rename is a
 * one-line diff.
 */

import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";

export type { DatabaseSync };

/**
 * Loaded on first use, not imported.
 *
 * Two reasons, both awkward, both about `node:sqlite` still being experimental:
 *
 * - It is left out of `builtinModules`, so bundlers cannot tell it is one —
 *   Vite strips the prefix and then looks for a package called "sqlite". A
 *   require the bundler never sees sidesteps that, and the `import type` above
 *   still gives full typing because it erases.
 * - Loading it emits an ExperimentalWarning. Deferring means `re64 version` and
 *   `re64 disasm`, which never open a database, stay quiet; suppressing the one
 *   warning below means the commands that do are not noisy either. Only that
 *   exact warning is dropped, so a real one still gets through.
 */
let cached: typeof import("node:sqlite") | undefined;

function sqlite(): typeof import("node:sqlite") {
  if (cached) return cached;

  const emit = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const text = typeof warning === "string" ? warning : warning.message;
    if (text.includes("SQLite is an experimental feature")) return;
    return (emit as (...args: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;

  try {
    cached = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  } finally {
    process.emitWarning = emit;
  }
  return cached;
}

export const SCHEMA_VERSION = 5;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- One row per project. The doc column is the exported form, derived from the
-- document and kept so disasm and git have something to read without one.
CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  doc        TEXT NOT NULL,
  rev        TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- The project, as the CRDT records it. This is the truth; everything else in
-- this file is derived from it and can be rebuilt.
CREATE TABLE IF NOT EXISTS updates (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  payload    BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS updates_by_project ON updates (project_id, seq);

-- A merged update covering everything up to seq_upto. NOT compaction: the rows
-- it covers are still there. It exists so loading is not proportional to every
-- edit ever made, which matters because the CLI runs in a fresh process.
CREATE TABLE IF NOT EXISTS snapshots (
  project_id TEXT NOT NULL,
  seq_upto   INTEGER NOT NULL,
  payload    BLOB NOT NULL,
  PRIMARY KEY (project_id, seq_upto)
);

CREATE TABLE IF NOT EXISTS history (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  at         INTEGER NOT NULL,
  authors    TEXT NOT NULL,
  summary    TEXT NOT NULL
);

-- Every operation with its inverse. Durable rather than per-session, because
-- 're64 undo' runs in a fresh process with nothing else to remember.
CREATE TABLE IF NOT EXISTS ops (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  op         TEXT NOT NULL,
  inverse    TEXT NOT NULL,
  author     TEXT,
  -- The session that made it, so undo is scoped the way the browser scopes it.
  session    TEXT,
  -- Which action it belonged to. One call or one click is one changeset,
  -- however many ops it took; a record of intent, never a promise of atomicity.
  changeset  TEXT,
  at         INTEGER,
  undone     INTEGER NOT NULL DEFAULT 0
);

-- Binaries, by content. Deduplicated, and a hash is what lets a project say
-- which bytes its addresses were named against.
-- Who can be selected in the interface. No authentication yet: choosing a name
-- is all it takes, and real accounts will replace how a session is issued
-- rather than what a session is.
CREATE TABLE IF NOT EXISTS users (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  colour TEXT NOT NULL
);

-- One connection, one document, one undo stack. NOT one person: two tabs are
-- two sessions and two client ids, genuinely concurrent peers who can conflict
-- with each other.
--
-- client_id is the Yjs client id, learned from the traffic rather than trusted
-- from the claim. Recording it is what makes an edit attributable later: a
-- struct carries a client id, and this maps it to a person.
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT,
  project_id    TEXT,
  client_id     INTEGER,
  -- The handle a person reads. Kept after the lease lapses: a transcript is
  -- read long afterwards, and "basalt renamed this" has to still resolve.
  codename      TEXT,
  started_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blobs (
  hash TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  bytes BLOB NOT NULL
);

-- What each project calls them. A name is project-local; the bytes are not, so
-- two projects annotating the same game share one row in blobs.
CREATE TABLE IF NOT EXISTS files (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name       TEXT NOT NULL,
  hash       TEXT NOT NULL REFERENCES blobs(hash),
  UNIQUE (project_id, name)
);
`;

/**
 * Bring an older database up to the current shape.
 *
 * `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists, so
 * a column added later never reaches a database made before it. Additive only:
 * every migration here must be a column an older build simply ignores, which
 * keeps a database readable by both and means this never has to run backwards.
 */
function addMissingColumns(db: DatabaseSync): void {
  const wanted: [table: string, column: string, type: string][] = [
    ["sessions", "codename", "TEXT"],
    ["ops", "session", "TEXT"],
    ["ops", "changeset", "TEXT"],
  ];

  for (const [table, column, type] of wanted) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (columns.some((c) => c.name === column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

export function openDatabase(path: string): DatabaseSync {
  const db = new (sqlite().DatabaseSync)(path);

  // WAL so a reader is never blocked by the writer, which is the whole point
  // of moving here: the CLI and the server touch this at the same time.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  // Wait rather than failing outright when the other process holds the write
  // lock; the writes here are milliseconds long.
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA);
  addMissingColumns(db);

  const found = db
    .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
    .get() as { value: string } | undefined;

  if (found === undefined) {
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(
      String(SCHEMA_VERSION)
    );
  } else if (Number(found.value) > SCHEMA_VERSION) {
    throw new Error(
      `${path} was written by a newer re64 (schema ${found.value}, this build understands ${SCHEMA_VERSION})`
    );
  }

  return db;
}
