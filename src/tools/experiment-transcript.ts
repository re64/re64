/**
 * What a run actually did, as opposed to what its readers say they did.
 *
 * The rule these experiments are read by: take the reports and the request log
 * together, and where they disagree the log wins. An agent is an unreliable
 * narrator of its own difficulty — it invents a tool name and then describes the
 * invention as a gap, and works silently around whatever actually hurt. This
 * reads the log.
 *
 * Four things it counts, and the first is the highest-signal one this project
 * has found:
 *
 * - **Tools that do not exist.** Inventing a name is an unguarded statement
 *   about what the API should have had. Experiment 2's list of seven is worth
 *   more than any of its prose, and all seven were built or answered.
 * - **Refusals**, by tool and reason. A write that refuses has taken a decision
 *   it was not entitled to, so a run full of them is a design finding.
 * - **Whether `target` was ever passed.** A view is a parameter of the request
 *   now, and the answer reports which one it used rather than requiring it —
 *   so whether that teaches the habit is a question only the log can answer.
 * - **Two readers writing at one address**, which under the claims model should
 *   produce two claims that both survive rather than one that replaced the
 *   other. That is the property the redesign exists for, so it is worth
 *   counting rather than assuming.
 *
 * Run with `npm run experiments:transcript -- <file.mcp.jsonl>`.
 */

import { readFileSync } from "node:fs";

interface Call {
  method?: string;
  tool?: string;
  args?: Record<string, unknown>;
  caller?: string;
  codename?: string;
  ok?: boolean;
  error?: string;
  at?: string;
  ms?: number;
}

/** Everything a caller sent, minus the setup that stood the project up. */
function readCalls(path: string): Call[] {
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Call)
    .filter((call) => call.caller !== "setup");
}

const parseAddress = (value: unknown): number | undefined => {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (text.startsWith("$")) return parseInt(text.slice(1), 16);
  if (text.startsWith("0x")) return parseInt(text.slice(2), 16);
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
};

const hex4 = (n: number) => `$${n.toString(16).toUpperCase().padStart(4, "0")}`;

function report(path: string): void {
  const calls = readCalls(path);
  const readers = [...new Set(calls.map((c) => c.caller ?? "?"))].sort();

  // eslint-disable-next-line no-console
  const say = (line: string) => console.log(line);

  say(`\n=== ${path}`);
  say(`${calls.length} calls from ${readers.length} reader(s): ${readers.join(", ")}`);

  const byTool = new Map<string, { total: number; refused: number }>();
  for (const call of calls) {
    const name = call.tool ?? "?";
    const seen = byTool.get(name) ?? { total: 0, refused: 0 };
    seen.total++;
    if (call.ok === false) seen.refused++;
    byTool.set(name, seen);
  }

  say(`\n-- where the effort went`);
  for (const [name, n] of [...byTool].sort((a, b) => b[1].total - a[1].total).slice(0, 12)) {
    say(`  ${String(n.total).padStart(4)}  ${name}${n.refused ? `  (${n.refused} refused)` : ""}`);
  }

  // A tool that is not there never reaches a handler, so the server records the
  // call and an error naming it. This is the list worth more than any prose.
  const invented = calls.filter(
    (c) => c.ok === false && typeof c.error === "string" && /tool/i.test(c.error)
  );
  say(`\n-- tools reached for that do not exist: ${invented.length}`);
  for (const [name, n] of [...new Map(
    invented.map((c) => [c.tool ?? "?", 0])
  )].map(([name]) => [name, invented.filter((c) => c.tool === name).length] as const)) {
    say(`  ${String(n).padStart(4)}  ${name}`);
  }

  const refusals = calls.filter((c) => c.ok === false && !invented.includes(c));
  say(`\n-- refusals from tools that do exist: ${refusals.length}`);
  const reasons = new Map<string, number>();
  for (const call of refusals) {
    const key = `${call.tool}: ${(call.error ?? "").slice(0, 90)}`;
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  for (const [reason, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    say(`  ${String(n).padStart(4)}  ${reason}`);
  }

  // A view is a parameter of the request, and omitting it is allowed. Whether
  // the habit takes is a question only this can answer.
  const named = calls.filter((c) => c.args && "target" in c.args).length;
  say(`\n-- calls naming a target: ${named} of ${calls.length}`);

  // Two readers saying something about one address. Under the claims model both
  // should survive, which is the whole point; this counts the opportunities.
  const writes = calls.filter(
    (c) => c.ok !== false && /^(add_claim|add_claims|set_claim|add_comment|mark_function)$/.test(c.tool ?? "")
  );
  const byAddress = new Map<number, Set<string>>();
  for (const call of writes) {
    const at = parseAddress(call.args?.at ?? call.args?.address);
    if (at === undefined) continue;
    const held = byAddress.get(at) ?? new Set<string>();
    held.add(call.caller ?? "?");
    byAddress.set(at, held);
  }
  const shared = [...byAddress].filter(([, who]) => who.size > 1);
  say(`\n-- addresses two readers both wrote about: ${shared.length}`);
  for (const [at, who] of shared.slice(0, 15)) say(`  ${hex4(at)}  ${[...who].join(", ")}`);
}

for (const path of process.argv.slice(2)) report(path);
