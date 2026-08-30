/**
 * What a transcript says about the API.
 *
 * The experiments produce a lot of lines, and the useful signal is narrow: what
 * an agent reached for and could not find, what it was refused and kept
 * retrying, and how much it had to read to get anywhere. This turns the raw
 * JSONL into those answers.
 *
 * It reports rather than judges. Nothing here decides whether a gap is worth
 * closing; the point is to make the list short enough that a person can.
 */

import { McpLogEntry } from "./log.js";

export interface ToolUse {
  tool: string;
  calls: number;
  failed: number;
  /** Total bytes returned, which is what a large read actually costs a reader. */
  bytes: number;
  medianMs: number;
}

export interface Refusal {
  /** The message with addresses and names removed, so instances group. */
  shape: string;
  count: number;
  tool?: string;
  /** One real message, since the shape alone can be hard to place. */
  example: string;
}

export interface SessionUse {
  sessionId: string;
  codename?: string;
  caller?: string;
  calls: number;
}

export interface TranscriptSummary {
  entries: number;
  span?: { from: string; to: string };
  tools: ToolUse[];
  /**
   * Tools that were called and do not exist.
   *
   * The most informative thing in the file: an agent reaching for
   * `add_comment` is saying what the API is missing, in its own words, without
   * being asked.
   */
  absent: { tool: string; calls: number; example?: unknown }[];
  refusals: Refusal[];
  sessions: SessionUse[];
  /**
   * Who connected, and how many distinct MCP sessions they presented.
   *
   * This is the measurement the session design is waiting on: whether several
   * agents spawned together are several MCP clients or one shared client.
   */
  hosts: { name: string; version?: string; protocol?: string; initializes: number }[];
  distinctMcpSessions: number;
  /** Calls that arrived with no session handle at all. */
  unkeyed: number;
}

/** Parse a transcript, skipping anything unreadable rather than failing. */
export function readTranscript(text: string): McpLogEntry[] {
  const entries: McpLogEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as McpLogEntry);
    } catch {
      // A half-written final line is normal for a log tailing a live server.
    }
  }
  return entries;
}

/**
 * Strip the particulars out of a message so repetitions group.
 *
 * "no label at $8F80" and "no label at $9000" are one gap seen twice, and a
 * list showing them separately buries the shape under its instances.
 */
export function shapeOf(message: string): string {
  return message
    .replace(/\$[0-9A-Fa-f]{1,6}\b/g, "$_")
    .replace(/\b0x[0-9A-Fa-f]+\b/g, "$_")
    .replace(/"[^"]*"/g, '"_"')
    .replace(/\b\d{2,}\b/g, "_")
    .trim();
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** A tool error naming a tool that does not exist. */
function absentToolIn(entry: McpLogEntry): boolean {
  return entry.error !== undefined && /tool\s+\S+\s+not found/i.test(entry.error);
}

export function summarise(entries: McpLogEntry[]): TranscriptSummary {
  const calls = entries.filter((e) => e.method === "tools/call" && e.tool);

  const byTool = new Map<string, McpLogEntry[]>();
  for (const call of calls) {
    const list = byTool.get(call.tool as string) ?? [];
    list.push(call);
    byTool.set(call.tool as string, list);
  }

  const absent: TranscriptSummary["absent"] = [];
  const tools: ToolUse[] = [];
  for (const [tool, list] of byTool) {
    // Every call to it failed as unknown, so the tool is not there at all —
    // as opposed to a real tool that happened to refuse once.
    if (list.every(absentToolIn)) {
      absent.push({ tool, calls: list.length, example: list[0].args });
      continue;
    }
    tools.push({
      tool,
      calls: list.length,
      failed: list.filter((e) => !e.ok).length,
      bytes: list.reduce((sum, e) => sum + (e.bytes ?? 0), 0),
      medianMs: median(list.map((e) => e.ms ?? 0)),
    });
  }

  const refusals = new Map<string, Refusal>();
  for (const call of calls) {
    if (call.ok || !call.error || absentToolIn(call)) continue;
    const shape = shapeOf(call.error);
    const key = `${call.tool} ${shape}`;
    const found = refusals.get(key);
    if (found) found.count += 1;
    else refusals.set(key, { shape, count: 1, tool: call.tool, example: call.error });
  }

  const sessions = new Map<string, SessionUse>();
  for (const entry of entries) {
    if (!entry.sessionId) continue;
    const found = sessions.get(entry.sessionId);
    if (found) found.calls += 1;
    else
      sessions.set(entry.sessionId, {
        sessionId: entry.sessionId,
        codename: entry.codename,
        caller: entry.caller,
        calls: 1,
      });
  }

  const hosts = new Map<string, TranscriptSummary["hosts"][number]>();
  for (const entry of entries) {
    if (entry.method !== "initialize") continue;
    const name = entry.client?.name ?? "unnamed";
    const key = `${name} ${entry.client?.version ?? ""}`;
    const found = hosts.get(key);
    if (found) found.initializes += 1;
    else
      hosts.set(key, {
        name,
        version: entry.client?.version,
        protocol: entry.protocol,
        initializes: 1,
      });
  }

  const times = entries
    .map((e) => e.at)
    .filter((a): a is string => Boolean(a))
    .sort();

  return {
    entries: entries.length,
    ...(times.length ? { span: { from: times[0], to: times[times.length - 1] } } : {}),
    tools: tools.sort((a, b) => b.calls - a.calls),
    absent: absent.sort((a, b) => b.calls - a.calls),
    refusals: [...refusals.values()].sort((a, b) => b.count - a.count),
    sessions: [...sessions.values()].sort((a, b) => b.calls - a.calls),
    hosts: [...hosts.values()],
    distinctMcpSessions: new Set(entries.map((e) => e.session).filter(Boolean)).size,
    unkeyed: entries.filter((e) => e.method === "tools/call" && !e.session).length,
  };
}

const pad = (text: string, width: number): string => text.padEnd(width);

/** The summary as something to read, ordered by what to look at first. */
export function formatSummary(summary: TranscriptSummary): string {
  const out: string[] = [];

  out.push(`${summary.entries} requests`);
  if (summary.span) out.push(`  ${summary.span.from} to ${summary.span.to}`);

  if (summary.absent.length > 0) {
    out.push("", "Reached for and not there:");
    for (const gap of summary.absent) {
      out.push(`  ${pad(gap.tool, 24)} ${gap.calls}x`);
      if (gap.example !== undefined) {
        out.push(`    e.g. ${JSON.stringify(gap.example).slice(0, 120)}`);
      }
    }
  }

  if (summary.refusals.length > 0) {
    out.push("", "Refused:");
    for (const refusal of summary.refusals) {
      out.push(`  ${pad(refusal.tool ?? "?", 24)} ${refusal.count}x  ${refusal.shape}`);
    }
  }

  if (summary.tools.length > 0) {
    out.push("", "Used:");
    out.push(`  ${pad("tool", 24)} ${pad("calls", 7)}${pad("failed", 8)}${pad("median", 8)}read`);
    for (const use of summary.tools) {
      out.push(
        `  ${pad(use.tool, 24)} ${pad(String(use.calls), 7)}${pad(String(use.failed), 8)}` +
          `${pad(`${use.medianMs}ms`, 8)}${(use.bytes / 1024).toFixed(1)}KB`
      );
    }
  }

  if (summary.sessions.length > 0) {
    out.push("", "Sessions:");
    for (const session of summary.sessions) {
      out.push(
        `  ${pad(session.codename ?? session.sessionId, 16)} ` +
          `${pad(session.caller ?? "?", 16)} ${session.calls} calls`
      );
    }
  }

  out.push("", "Clients:");
  if (summary.hosts.length === 0) out.push("  none announced themselves");
  for (const host of summary.hosts) {
    out.push(
      `  ${pad(`${host.name}${host.version ? ` ${host.version}` : ""}`, 32)} ` +
        `${host.initializes}x initialize${host.protocol ? `, protocol ${host.protocol}` : ""}`
    );
  }
  out.push(`  distinct MCP session ids: ${summary.distinctMcpSessions}`);
  if (summary.unkeyed > 0) {
    // The weak case made visible: these all shared one lease and one undo scope.
    out.push(`  calls with no session handle: ${summary.unkeyed}`);
  }

  return out.join("\n");
}
