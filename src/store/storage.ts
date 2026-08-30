/**
 * Where a project's bytes live.
 *
 * Four things are kept, and they want different treatment:
 *
 * | | holds | lifetime |
 * |---|---|---|
 * | the text | the project itself | canonical |
 * | updates | CRDT updates awaiting a flatten | dropped after flatten |
 * | history | one entry per flattened session | durable |
 *
 * This interface exists so the store can be swapped without the session logic
 * moving. It is deliberately narrow: a method with one caller and one
 * implementation does not belong here yet.
 */

import { createHash } from "node:crypto";
import { Change } from "../core/index.js";

/** One flattened session, as recorded in the project's history. */
export interface HistoryEntry {
  at: number;
  /** Everyone who contributed to the session. */
  authors: string[];
  /** What changed, in the vocabulary the UI and CLI use. */
  summary: string[];
}

/**
 * A stored CRDT update.
 *
 * Order is not part of the contract: updates are commutative and idempotent, so
 * a replay may deliver them in any order and may include duplicates. `seq` is
 * only a cursor for reading the tail after a snapshot.
 */
export interface StoredUpdate {
  seq: number;
  update: Uint8Array;
}

/**
 * A merged update covering everything up to `seqUpto`.
 *
 * **Not compaction** — nothing is deleted, and the updates it covers stay
 * exactly where they were. It exists so that loading a project is not O(every
 * edit ever made), which matters because `re64 label set` runs in a fresh
 * process that would otherwise replay the entire history to rename one thing.
 */
export interface StoredSnapshot {
  seqUpto: number;
  update: Uint8Array;
}

export interface ProjectStorage {
  /** Whether the project still exists; it can be removed mid-session. */
  exists(): boolean;
  /**
   * The exported project text.
   *
   * A derived view, not the truth — kept so `disasm` and `git` have something
   * to read without building a document.
   */
  readText(): string;
  writeText(text: string): void;
  /** Identifies the current text. See {@link StoredUpdate}. */
  rev(): string;

  /** Record an edit. This is the write that matters; everything else is derived. */
  appendUpdate(update: Uint8Array): void;
  /** Everything after `afterSeq`, or everything when it is omitted. */
  readUpdates(afterSeq?: number): StoredUpdate[];
  hasUpdates(): boolean;

  /** The newest snapshot, if one has been taken. */
  readSnapshot(): StoredSnapshot | undefined;
  writeSnapshot(snapshot: StoredSnapshot): void;

  appendHistory(entry: HistoryEntry): void;
  history(): HistoryEntry[];

  /**
   * The undo record: every operation with its inverse, oldest first.
   *
   * Durable rather than per-session, because `re64 undo` runs in a new process
   * each time and has nothing else to remember. Undone entries stay as
   * tombstones so redo has something to aim at.
   */
  readOps(): Change[];
  writeOps(changes: readonly Change[]): void;

  /**
   * Run related writes as one, so a crash cannot land halfway.
   *
   * Applying an operation and recording how to undo it are two writes that
   * must not come apart: a crash between them leaves the project edited with
   * no way back. A filesystem cannot promise this and says so by doing nothing.
   */
  transaction<T>(work: () => T): T;

  /**
   * Call back when another writer commits a change.
   *
   * The project is not owned exclusively: `re64 label set` writes it directly,
   * and so does anyone with an editor open. Returns a function that stops
   * watching.
   *
   * Coalescing is the implementation's business — a filesystem reports a single
   * save more than once, and differently per platform.
   */
  watch(onChange: () => void): () => void;
}

/** Content-derived, so two writers naming the same text agree on its name. */
export function revOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, REV_LENGTH);
}

export const REV_LENGTH = 12;
