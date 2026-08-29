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

export const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- One row, always. The project text verbatim, never regenerated.
CREATE TABLE IF NOT EXISTS project (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  doc        TEXT NOT NULL,
  rev        TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- CRDT updates awaiting a flatten. base_rev is not bookkeeping: an update only
-- means anything replayed onto the exact text its document was built from.
CREATE TABLE IF NOT EXISTS session_updates (
  seq      INTEGER PRIMARY KEY AUTOINCREMENT,
  base_rev TEXT NOT NULL,
  payload  BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS history (
  seq     INTEGER PRIMARY KEY AUTOINCREMENT,
  at      INTEGER NOT NULL,
  authors TEXT NOT NULL,
  summary TEXT NOT NULL
);

-- Every operation with its inverse. Durable rather than per-session, because
-- 're64 undo' runs in a fresh process with nothing else to remember.
CREATE TABLE IF NOT EXISTS ops (
  seq     INTEGER PRIMARY KEY AUTOINCREMENT,
  op      TEXT NOT NULL,
  inverse TEXT NOT NULL,
  author  TEXT,
  at      INTEGER,
  undone  INTEGER NOT NULL DEFAULT 0
);

-- Binaries, by content. Deduplicated, and a hash is what lets a project say
-- which bytes its addresses were named against.
CREATE TABLE IF NOT EXISTS blobs (
  hash TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  bytes BLOB NOT NULL
);

-- What the project calls them. A name is project-local; the bytes are not.
CREATE TABLE IF NOT EXISTS files (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  hash TEXT NOT NULL REFERENCES blobs(hash)
);
`;

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
