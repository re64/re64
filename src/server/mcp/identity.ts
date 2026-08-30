/**
 * Who is calling.
 *
 * Resolved once when a connection is made, never taken as a tool argument. A
 * parameter can be omitted, hallucinated, or simply lied about by whatever is
 * driving the tools, and removing it later would break every schema. On the
 * connection it is the same claim the socket already accepts — and the slot it
 * occupies is the one a bearer token will fill, with no tool changes at all.
 */

import type { IncomingMessage } from "node:http";
import { FileStorage, SqliteStorage } from "../../store/index.js";

export interface Caller {
  userId: string;
  label: string;
  /** The lease this call is working under; what the ops log records. */
  sessionId?: string;
  /** Its readable handle, for a transcript and for presence. */
  codename?: string;
  /**
   * True when no session handle was presented and the lease had to be keyed by
   * identity alone, so every caller claiming this user shares one session and
   * one undo scope. Surfaced rather than silently tolerated.
   */
  sharedSession?: boolean;
}

/**
 * There is no authentication yet: the connection says who it is and is
 * believed, exactly as `?author=` is believed on the sync socket.
 */
export function resolveCaller(
  request: IncomingMessage,
  url: URL,
  storage: SqliteStorage | FileStorage
): Caller {
  const claimed =
    (Array.isArray(request.headers["x-re64-user"])
      ? request.headers["x-re64-user"][0]
      : request.headers["x-re64-user"]) ?? url.searchParams.get("user") ?? undefined;

  const known = storage instanceof SqliteStorage ? storage.users() : [];
  const matched = known.find((u) => u.id === claimed || u.name === claimed) ?? known[0];

  return {
    userId: matched?.id ?? claimed ?? "agent",
    label: matched?.name ?? claimed ?? "agent",
  };
}
