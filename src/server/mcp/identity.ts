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

// One definition, in the module whose methods take one. Two structurally
// compatible copies drifted apart the moment sessions were added to one.
export type { Caller } from "../workspace.js";
import type { Caller } from "../workspace.js";

/**
 * What an edit is attributed to when nobody said who they were.
 *
 * The same word the sync socket already defaults `?author=` to, so the two
 * surfaces agree about what an unknown identity is instead of each inventing
 * one.
 */
export const ANONYMOUS = "anonymous";

/**
 * There is no authentication yet: the connection says who it is and is
 * believed, exactly as `?author=` is believed on the sync socket.
 *
 * Three outcomes, kept distinct, because collapsing them is what made
 * attribution silently wrong:
 *
 * | claim | resolves to |
 * |---|---|
 * | matches a user by id or name | that user |
 * | present, matches nothing | the claim itself |
 * | absent | `anonymous` |
 *
 * The middle case used to fall through to `known[0]` — the *first row of the
 * users table*. Three agents in experiment 2 announced themselves as
 * `reader-1`, `reader-2` and `reader-3` and every edit they made was recorded
 * as `usr_agent`, with nothing said. That database happens to list `agent`
 * first; had it listed `you` first, every agent edit would have been
 * attributed to the person watching.
 *
 * Accepting an unmatched claim rather than rejecting it is deliberate, and is
 * not a weakening: the socket already believes any `?author=` it is handed, so
 * this makes the surfaces agree. Nothing downstream requires a caller to exist
 * in the users table — `sessions.user_id` and `ops.author` are unconstrained
 * text, and `changes_since` echoes the author and resolves display names from
 * the sessions table instead.
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
  const matched = known.find((u) => u.id === claimed || u.name === claimed);
  if (matched) return { userId: matched.id, label: matched.name, identity: "user" };

  const trimmed = claimed?.trim();
  return trimmed
    ? { userId: trimmed, label: trimmed, identity: "claimed" }
    : { userId: ANONYMOUS, label: ANONYMOUS, identity: "anonymous" };
}
