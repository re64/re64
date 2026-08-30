/**
 * A transcript of what agents actually tried.
 *
 * The point is evaluation, not debugging. It stands beside what the agents say
 * about their own run rather than replacing it: a report carries intent and
 * expectation, which no log holds. But an agent is an unreliable narrator of
 * its own difficulty — it invents a tool name and then describes the invention
 * as a gap, and it works silently around whatever really hurt. What it *tried*
 * exists only here, and that is what settles a disagreement between the two.
 *
 * So this records at the transport, below tool dispatch, where a call to a tool
 * that does not exist is still a recorded attempt rather than nothing at all.
 * That case is the most informative one in the file.
 *
 * JSONL rather than a table: this is written constantly, read in bulk and
 * rarely, and its consumers are `jq`, a diff between two runs, and an agent
 * asked to summarise a session. A log file is what that shape wants, and it
 * keeps diagnostics out of the project store, which holds the project.
 */

import { appendFileSync } from "node:fs";

export interface McpLogEntry {
  /** When the request arrived, ISO 8601. */
  at: string;
  /** How long it took, milliseconds. */
  ms: number;
  /** Who claimed to be calling. */
  caller?: string;
  /** JSON-RPC method: `tools/call`, `initialize`, `tools/list`. */
  method?: string;
  /** For `tools/call`, the tool asked for — which may not exist. */
  tool?: string;
  /** Arguments as sent. Small, and the interesting half of the record. */
  args?: unknown;
  ok: boolean;
  /** Why not, trimmed. A tool error and a protocol error both land here. */
  error?: string;
  /** Response size, so a bulk read is visible without storing it. */
  bytes: number;
  /**
   * The MCP session id, when one is presented.
   *
   * Recorded because of an unanswered question: whether several agents spawned
   * together are several MCP clients or one shared client. Counting distinct
   * ids across a run answers it, and the answer decides how agent sessions have
   * to be keyed.
   */
  session?: string;
  /** From `initialize`: which host is connecting, and on which protocol. */
  client?: { name?: string; version?: string };
  protocol?: string;
}

export interface McpLog {
  record(entry: McpLogEntry): void;
  /** Where it is being written, for the banner and the debug panel. */
  readonly path: string | undefined;
}

const NOWHERE: McpLog = { record: () => {}, path: undefined };

/** How much of an error message is worth keeping. */
const ERROR_LIMIT = 500;

/**
 * Open a log, or a sink that discards.
 *
 * Written synchronously. A line is a few hundred bytes and costs tens of
 * microseconds, against the 10–20ms an analysis already takes on the same
 * thread — and a transcript that loses its tail in a crash is worthless
 * precisely when the crash is the thing being investigated.
 */
export function openMcpLog(path: string | undefined | false): McpLog {
  if (!path) return NOWHERE;

  return {
    path,
    record(entry) {
      const trimmed: McpLogEntry = {
        ...entry,
        error: entry.error?.slice(0, ERROR_LIMIT),
      };
      try {
        appendFileSync(path, JSON.stringify(trimmed) + "\n");
      } catch {
        // A transcript is diagnostics. Losing it must never take the request
        // with it, so a full disk or a read-only path is not an error here.
      }
    },
  };
}

/** Where the transcript goes when nobody says: beside the database. */
export function defaultMcpLogPath(projectPath: string): string {
  return projectPath.replace(/\.(re64db|re64)$/, "") + ".mcp.jsonl";
}

/**
 * Read a JSON-RPC reply out of a response body.
 *
 * The transport answers as an event stream, so the payload arrives behind a
 * `data:` prefix; a plain JSON body is also accepted since the mode is the
 * SDK's choice and not ours to depend on.
 *
 * `truncated` says the body was longer than what is kept. That distinction
 * decides how to read an unparseable head, and getting it wrong is not
 * harmless: without it a 47KB successful disassembly read parses as nothing,
 * gets recorded as a failure, and pastes half a kilobyte of payload into the
 * error field — so the transcript reports the opposite of what happened on
 * exactly the calls that return the most.
 *
 * The rule: a reply that overflowed is a bulk read that succeeded, because
 * every failure here is a sentence.
 */
export function replyOf(
  body: string,
  options: { truncated?: boolean } = {}
): { ok: boolean; error?: string } {
  const line = body.split("\n").find((l) => l.startsWith("data: ")) ?? body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.replace(/^data: /, ""));
  } catch {
    if (options.truncated) return { ok: true };
    // An unparseable reply that is all there is says something went wrong
    // below this layer, and it is not a tool error.
    return { ok: false, error: body.slice(0, ERROR_LIMIT) || "no reply" };
  }

  const reply = parsed as {
    error?: { message?: string };
    result?: { isError?: boolean; content?: { text?: string }[] };
  };

  if (reply.error) return { ok: false, error: reply.error.message ?? "protocol error" };
  if (reply.result?.isError) {
    return { ok: false, error: reply.result.content?.[0]?.text ?? "tool error" };
  }
  return { ok: true };
}
