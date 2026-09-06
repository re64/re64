/**
 * How often one agent's conclusion silently replaced another's.
 *
 * Reads the MCP request logs the experiment runs leave behind and reports every
 * write where a second agent's call landed on the same object as a first
 * agent's, changing what it said. The label vocabulary was rewritten on exactly
 * this evidence — 123 names destroyed across 74 addresses in experiment 7 — and
 * the region write had never been counted.
 *
 * **Group by project, or the number is nonsense.** Experiments 2 and 5 put agents
 * on *independent clones*, which is the whole design of the convergence run: five
 * readers who cannot see each other, so that agreement is not measured by
 * contagion. The log is written per server rather than per project, so a pass
 * that ignores the `project` argument reads three separate projects as one and
 * counts every agent's independent naming of `$8000` as a collision. That mistake
 * inflates the answer by 15x — 90 against the true 6 — and it is easy to make
 * because the inflated number is the more persuasive one.
 *
 * Run with `npm run experiments:collisions`.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

interface Call {
  tool?: string;
  args?: Record<string, unknown>;
  codename?: string;
  at?: string;
}

/** One thing an agent said about a span. */
interface Declaration {
  project: string;
  start: number;
  end: number;
  kind?: string;
  name?: string;
  agent: string;
  at: string;
}

function parseAddress(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  const parsed = text.startsWith("$")
    ? parseInt(text.slice(1), 16)
    : text.startsWith("0x")
      ? parseInt(text.slice(2), 16)
      : parseInt(text, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function declarationsIn(path: string): Declaration[] {
  const out: Declaration[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let call: Call;
    try {
      call = JSON.parse(line) as Call;
    } catch {
      continue;
    }
    // Both vocabularies, deliberately. The runs that produced the number this
    // tool exists for used `set_region`, which no longer exists — reading only
    // the new names would quietly stop measuring the very evidence the claims
    // redesign was built on, and reading only the old ones would report zero
    // for every run since. A tool that silently measures nothing is worse than
    // one that is missing.
    const legacy = call.tool === "set_region" || call.tool === "set_regions";
    const current = call.tool === "add_claim" || call.tool === "add_claims";
    if (!legacy && !current) continue;

    const args = call.args ?? {};
    const project = String(args.project ?? "?");
    const batch =
      (args.regions as Record<string, unknown>[] | undefined) ??
      (args.claims as Record<string, unknown>[] | undefined) ??
      [args];
    for (const item of batch) {
      // `at` + `extent` is the claim spelling; `start` + `end`/`length` the
      // region one. The two ways of getting a span wrong went with the pair.
      const start = parseAddress(item.start ?? item.at);
      if (start === undefined) continue;
      const extent = parseAddress(item.extent);
      const end =
        parseAddress(item.end) ??
        (parseAddress(item.length) !== undefined ? start + parseAddress(item.length)! : undefined) ??
        (extent !== undefined ? start + extent : undefined);
      if (end === undefined) continue;
      out.push({
        project,
        start,
        end,
        kind: (item.kind ?? item.is) as string | undefined,
        name: item.name as string | undefined,
        agent: call.codename ?? "?",
        at: call.at ?? "",
      });
    }
  }
  return out;
}

/**
 * Declarations of the *exact same span* by different agents that changed what it
 * said.
 *
 * The exact span is the condition because that is when `regionSetOp` reuses the
 * existing id — a strictly inner span nests instead, which is the model working.
 */
function collisions(declarations: Declaration[]): [Declaration, Declaration][] {
  const bySpan = new Map<string, Declaration[]>();
  for (const d of declarations) {
    const key = `${d.project}:${d.start}:${d.end}`;
    const list = bySpan.get(key);
    if (list) list.push(d);
    else bySpan.set(key, [d]);
  }

  const found: [Declaration, Declaration][] = [];
  for (const list of bySpan.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.at.localeCompare(b.at));
    for (let i = 1; i < list.length; i++) {
      const previous = list[i - 1];
      const current = list[i];
      if (previous.agent === current.agent) continue;
      if (previous.kind === current.kind && previous.name === current.name) continue;
      found.push([previous, current]);
    }
  }
  return found;
}

function logsUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) logsUnder(path, out);
    else if (entry.endsWith(".mcp.jsonl")) out.push(path);
  }
  return out;
}

const hex = (n: number) => "$" + n.toString(16).toUpperCase().padStart(4, "0");

function main(): void {
  const root = process.argv[2] ?? "experiments";
  let totalDeclarations = 0;
  let totalCollisions = 0;

  for (const path of logsUnder(root).sort()) {
    const declarations = declarationsIn(path);
    if (declarations.length === 0) continue;
    const found = collisions(declarations);
    const projects = new Set(declarations.map((d) => d.project)).size;
    totalDeclarations += declarations.length;
    totalCollisions += found.length;

    // eslint-disable-next-line no-console
    console.log(
      `${path}\n  ${declarations.length} declarations across ${projects} project(s), ` +
        `${found.length} cross-agent overwrite(s)`
    );
    for (const [previous, current] of found) {
      // eslint-disable-next-line no-console
      console.log(
        `    ${hex(previous.start)}-${hex(previous.end)}  ` +
          `${previous.agent} said ${previous.kind}/${previous.name} -> ` +
          `${current.agent} made it ${current.kind}/${current.name}`
      );
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `\n${totalCollisions} cross-agent region overwrites in ${totalDeclarations} declarations`
  );
}

main();
