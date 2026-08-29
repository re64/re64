/**
 * The edit log that sits beside a project file.
 *
 * Undo needs somewhere durable to remember what was done — a CLI invocation
 * exits, and a browser tab closes. The log is that memory: one JSON line per
 * change, carrying the op, its inverse, and who made it.
 *
 * It is also the raw material for history. When a session ends, its entries are
 * squashed into one project-level entry rather than replayed one at a time.
 *
 * JSON Lines rather than a JSON array so appending is a write, not a rewrite,
 * and a truncated final line costs one entry instead of the whole file.
 */

import { Change, Op } from "./types.js";

/** Serialize changes for appending. */
export function encodeChanges(changes: readonly Change[]): string {
  return changes.map((c) => JSON.stringify(c)).join("\n") + (changes.length ? "\n" : "");
}

/**
 * Parse a log, skipping anything unreadable.
 *
 * A partially-written final line is expected after a crash — which is the
 * situation the log exists for — so it is dropped rather than treated as
 * corruption of the whole file.
 */
export function decodeChanges(text: string): Change[] {
  const out: Change[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Change;
      if (parsed?.op && parsed?.inverse) out.push(parsed);
    } catch {
      // Truncated or hand-mangled line; the rest of the log is still good.
    }
  }
  return out;
}

/** Changes not yet undone, most recent last. */
export function undoable(changes: readonly Change[]): Change[] {
  return changes.filter((c) => !c.undone);
}

/** Changes that have been undone and could be redone, most recent last. */
export function redoable(changes: readonly Change[]): Change[] {
  return changes.filter((c) => c.undone);
}

/** Build a change record, computing nothing — the caller supplies the inverse. */
export function change(op: Op, inverse: Op, author?: string, at?: number): Change {
  return { op, inverse, author, at };
}
