import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunningServer, startServer } from "../index.js";
import { importProject } from "../../store/index.js";

/**
 * The agent-facing endpoint, spoken to as an agent would.
 *
 * Raw JSON-RPC rather than an SDK client: what matters is that a stock client
 * can talk to this, and a test using the same library on both ends would only
 * prove the library agrees with itself.
 */

let dir: string;
let server: RunningServer;
let endpoint: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "re64-mcp-"));
  const projectPath = join(dir, "gridrunner.re64");
  copyFileSync("assets/gridrunner.re64", projectPath);
  copyFileSync("assets/gridrunner.prg", join(dir, "gridrunner.prg"));
  const { databasePath } = importProject(projectPath);

  server = startServer({ projectPath: databasePath, port: 0, host: "127.0.0.1", quiet: true });
  await server.ready;
  endpoint = `http://127.0.0.1:${server.port}/mcp`;
});

afterEach(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

/** The transport answers as an event stream, so the payload needs unwrapping. */
async function rpc(method: string, params?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-re64-user": "usr_agent",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  return JSON.parse((line ?? text).replace(/^data: /, "")) as Record<string, unknown>;
}

const callTool = async (name: string, args: Record<string, unknown> = {}) => {
  const reply = (await rpc("tools/call", { name, arguments: args })) as {
    result?: { content: { text: string }[]; isError?: boolean };
    error?: { message: string };
  };
  if (reply.error) throw new Error(reply.error.message);
  const text = reply.result!.content[0].text;
  const isError = reply.result!.isError === true;
  // A refusal is prose for the model to read, not a payload to destructure.
  return { isError, text, value: (isError ? undefined : JSON.parse(text)) as never };
};

describe("speaking the protocol", () => {
  it("introduces itself", async () => {
    const reply = (await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    })) as { result: { serverInfo: { name: string }; capabilities: { tools?: unknown } } };

    expect(reply.result.serverInfo.name).toBe("re64");
    expect(reply.result.capabilities.tools).toBeDefined();
  });

  it("answers more than one request, which a shared transport would not", async () => {
    // A transport carries the state of one request-response cycle. Reusing one
    // silently answers nothing after the first.
    await rpc("tools/list");
    const second = (await rpc("tools/list")) as { result: { tools: unknown[] } };
    expect(second.result.tools.length).toBeGreaterThan(0);
  });

  it("offers the tools an agent needs to decide and to act", async () => {
    const reply = (await rpc("tools/list")) as { result: { tools: { name: string }[] } };
    const names = reply.result.tools.map((t) => t.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "list_projects",
        "describe_project",
        "read_disassembly",
        "find_references",
        "find_unnamed",
        "changes_since",
        "set_label",
        "mark_function",
        "set_region",
        "remove_region",
        "mark_function",
        "unmark_function",
        "undo",
      ])
    );
  });

});

describe("working on a project", () => {
  it("orients from nothing", async () => {
    const { value } = await callTool("list_projects");
    expect((value as { projects: { id: string }[] }).projects[0].id).toBe("gridrunner");
  });

  it("reports what has been understood and what has not", async () => {
    const { value } = await callTool("describe_project");
    const counts = (value as { counts: { namedByHand: number; namedAutomatically: number } })
      .counts;

    expect(counts.namedByHand).toBeGreaterThan(0);
    expect(counts.namedAutomatically).toBeGreaterThan(0);
  });

  it("ranks what to work on", async () => {
    const { value } = await callTool("find_unnamed", { kind: "calls", limit: 3 });
    const { targets } = value as { targets: { name: string; references: number }[] };

    expect(targets).toHaveLength(3);
    expect(targets[0].references).toBeGreaterThanOrEqual(targets[2].references);
    expect(targets[0].name).toMatch(/^sub_/);
  });

  it("shows callers with the line that calls them", async () => {
    const { value } = await callTool("find_references", { address: "$8870", direction: "in" });
    const { inbound, incomplete } = value as {
      inbound: { from: string; text: string; inRoutine?: string }[];
      incomplete: string;
    };

    expect(inbound.length).toBeGreaterThan(0);
    expect(inbound.some((r) => r.text.includes("JSR"))).toBe(true);
    // Which routine the call sits in: "who calls this" is a question about
    // names, and the answer used to be a bag of addresses.
    expect(inbound.some((r) => r.inRoutine !== undefined)).toBe(true);
    // Stated on every answer, because a reader that trusts it would otherwise
    // conclude a routine has no callers when it has several.
    expect(incomplete).toMatch(/zero-page/i);
  });

  it("returns disassembly that can be acted on, not only printed", async () => {
    const { value } = await callTool("read_disassembly", { start: "$8011", lines: 5 });
    const { lines, truncated, nextStart } = value as {
      lines: { text: string; mnemonic?: string }[];
      truncated: boolean;
      nextStart?: string;
    };

    expect(lines).toHaveLength(5);
    expect(lines.some((l) => l.mnemonic)).toBe(true);
    expect(truncated).toBe(true);
    expect(nextStart).toMatch(/^\$[0-9A-F]{4}$/);
  });

  it("accepts an address however it is written", async () => {
    for (const start of ["$8011", "0x8011", "32785"]) {
      const { value } = await callTool("read_disassembly", { start, lines: 1 });
      expect((value as { start: string }).start).toBe("$8011");
    }
  });
});

describe("talking to whoever else is here", () => {
  it("says something and reads it back", async () => {
    await callTool("post_message", { text: "$8000 is a cartridge header, not code" });
    const { value } = await callTool("read_messages", {});
    const chat = value as { total: number; messages: { from: string; text: string }[] };
    expect(chat.total).toBe(1);
    expect(chat.messages[0].text).toBe("$8000 is a cartridge header, not code");
  });

  it("is attributed to the session codename, so two agents are distinguishable", async () => {
    // The user id would be the same string for two agents sharing a credential.
    await callTool("post_message", { text: "working on the zapper routines" });
    const { value } = await callTool("read_messages", {});
    const chat = value as { messages: { from: string }[] };
    expect(chat.messages.at(-1)!.from).toMatch(/^[a-z]+$/);
  });

  it("leaves no history entry, because a conversation is not an edit", async () => {
    const before = (await callTool("changes_since", {})).value as { cursor: number };
    await callTool("post_message", { text: "not an annotation" });
    const after = (await callTool("changes_since", { cursor: before.cursor })).value as {
      changes: unknown[];
    };
    expect(after.changes).toEqual([]);
  });

  it("does not reach the exported project", async () => {
    // The load-bearing property. Chat lives at a root `projectFromDoc` never
    // looks at, so it cannot end up in the file somebody hands to someone else.
    await callTool("post_message", { text: "keep-this-out-of-the-file" });
    const { value } = await callTool("export_listing", {});
    expect(JSON.stringify(value)).not.toContain("keep-this-out-of-the-file");

    const { value: described } = await callTool("describe_project", {});
    expect(JSON.stringify(described)).not.toContain("keep-this-out-of-the-file");
  });

  it("refuses an empty message rather than posting a blank row", async () => {
    const { isError } = await callTool("post_message", { text: "   " });
    const { value } = await callTool("read_messages", {});
    const chat = value as { messages: { text: string }[] };
    expect(isError || chat.messages.every((m) => m.text.trim().length > 0)).toBe(true);
  });
});

describe("asking what a routine does", () => {
  it("says what a block touches without running it", async () => {
    const { value } = await callTool("block_effects", { address: "$8015" });
    const effects = value as { reads: string[]; writes: string[]; unmodelled: unknown[] };
    expect(effects.reads).toContain("X");
    expect(effects.writes).toContain("Z");
    expect(effects.unmodelled).toEqual([]);
  });

  it("points somewhere useful when no block covers the address", async () => {
    // "No decoded block covers $8000" is true and a dead end. The nearest block
    // start is the next call.
    const { isError, text } = await callTool("block_effects", { address: "$8000" });
    expect(isError).toBe(true);
    expect(text).toMatch(/nearest starts at \$[0-9A-F]{4}/);
  });

  it("runs a block with only the registers the caller cares about", async () => {
    // Every reader in experiment 2 passed one register and was rejected for
    // omitting the other ten. The schema demanded a complete set and nothing
    // said so.
    const { value } = await callTool("run_block", { address: "$8015", registers: { X: 5 } });
    expect((value as { registers: Record<string, string> }).registers.X).toBe("$06");
  });

  it("takes a byte the way it takes an address", async () => {
    // This API accepts $8100 for an address, so refusing $05 for a value is
    // inconsistent with itself — which is exactly how every caller found out.
    for (const x of [5, "5", "$05", "0x05"]) {
      const { value } = await callTool("run_block", { address: "$8015", registers: { X: x } });
      expect((value as { registers: Record<string, string> }).registers.X).toBe("$06");
    }
  });

  it("reports which way the branch went, which is the point of running it", async () => {
    // INX / CPX #$07 / BNE. At 6 the counter reaches 7 and falls through; below
    // that it branches. The same block, two decisions.
    const branched = await callTool("run_block", { address: "$8015", registers: { X: "$01" } });
    expect((branched.value as { exit: { kind: string } }).exit.kind).toBe("goto");

    const fell = await callTool("run_block", { address: "$8015", registers: { X: "$06" } });
    expect((fell.value as { exit: { kind: string } }).exit.kind).toBe("fallthrough");
  });

  it("says which values it had to assume", async () => {
    const { value } = await callTool("run_block", { address: "$8040", registers: { X: 2 } });
    const run = value as { warnings: string[]; memoryRead: { address: string }[] };
    expect(run.memoryRead.map((m) => m.address)).toContain("$1502");
    // Nothing supplied $1502 and the PRG does not cover it, so it read as zero.
    // Reporting the result without saying so would look identical to knowing.
    expect(run.warnings.join(" ")).toMatch(/read as zero/);
  });
});

describe("editing as an agent", () => {
  it("names an address and says what it did", async () => {
    const { value } = await callTool("set_label", {
      address: "$8870",
      name: "NamedByAnAgent",
      type: "function",
    });

    expect((value as { did: string[] }).did[0]).toContain("NamedByAnAgent");

    const listed = await callTool("list_labels", { namePattern: "NamedByAnAgent" });
    expect((listed.value as { total: number }).total).toBe(1);
  });

  it("reports the code a decision unlocked", async () => {
    // $801B sits in a code region that nothing reaches, so declaring it a
    // function is what gets it decoded at all.
    const { value } = await callTool("mark_function", { address: "$801B" });
    expect((value as { instructions: { delta: number } }).instructions.delta).toBeGreaterThan(0);
  });

  it("refuses a write built on a project that has moved", async () => {
    const { value: described } = await callTool("describe_project");
    const stale = (described as { version: string }).version;

    await callTool("set_label", { address: "$8870", name: "Meanwhile" });
    const conflicted = await callTool("set_label", {
      address: "$8450",
      name: "TooLate",
      expectVersion: stale,
    });

    expect(conflicted.isError).toBe(true);
    expect(conflicted.text).toMatch(/changed since you read it/);
  });

  it("records the change, attributed to the caller", async () => {
    await callTool("set_label", { address: "$8870", name: "Attributed" });
    const { value } = await callTool("changes_since", { cursor: 0 });
    const { changes } = value as { changes: { did: string; by: string }[] };

    expect(changes).toHaveLength(1);
    expect(changes[0].by).toBe("usr_agent");
    expect(changes[0].did).toContain("Attributed");
  });

  it("lets a caller catch up on what it missed", async () => {
    await callTool("set_label", { address: "$8870", name: "First" });
    const { value: first } = await callTool("changes_since", { cursor: 0 });
    const cursor = (first as { cursor: number }).cursor;

    await callTool("set_label", { address: "$8450", name: "Second" });
    const { value: next } = await callTool("changes_since", { cursor });

    const { changes } = next as { changes: { did: string }[] };
    expect(changes).toHaveLength(1);
    expect(changes[0].did).toContain("Second");
  });

  it("reports an action as one entry that several changes share", async () => {
    await callTool("mark_function", { address: "$801B" });
    const { value } = await callTool("changes_since", { cursor: 0 });
    const { changes } = value as { changes: { action?: string; as?: string }[] };

    // However many ops it took, it was one decision, and the feed says so.
    const actions = new Set(changes.map((c) => c.action));
    expect(actions.size).toBe(1);
    // And it says who, by a name a person can read.
    expect(changes[0].as).toMatch(/^[a-z]+$/);
  });

  it("takes an edit back", async () => {
    await callTool("set_label", { address: "$8870", name: "Regretted" });
    const { value } = await callTool("undo");

    expect((value as { undone: string }).undone).toContain("Regretted");
    const listed = await callTool("list_labels", { namePattern: "Regretted" });
    expect((listed.value as { total: number }).total).toBe(0);
  });

  it("sets a region, which the browser cannot", async () => {
    const { value } = await callTool("set_region", {
      start: "$8F00",
      end: "$8F20",
      kind: "text",
      name: "blurb",
    });
    expect((value as { ok: boolean }).ok).toBe(true);
  });

  it("takes back a region and a function declaration", async () => {
    await callTool("set_region", { start: "$8F00", end: "$8F20", kind: "text" });
    const dropped = await callTool("remove_region", { start: "$8F00" });
    expect(dropped.isError).toBe(false);

    // $801B is reached by nothing, so the declaration is what decodes it —
    // and withdrawing it puts those instructions back out of reach.
    const marked = await callTool("mark_function", { address: "$801B" });
    const gained = (marked.value as { instructions: { delta: number } }).instructions.delta;
    const unmarked = await callTool("unmark_function", { address: "$801B" });
    const lost = (unmarked.value as { instructions: { delta: number } }).instructions.delta;

    expect(gained).toBeGreaterThan(0);
    expect(lost).toBe(-gained);
  });

  it("refuses an argument it never declared", async () => {
    // A bare shape becomes a zod object that strips unknown keys, so this
    // returned ok having quietly ignored both. For something probing what an
    // API can do, "ok, did nothing" reads as a feature that exists and works.
    const result = await callTool("set_region", {
      start: "$8F00",
      end: "$8F20",
      kind: "text",
      encoding: "petscii",
      charset: "$2000",
    });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/encoding|charset|unrecognized/i);
  });

  it("takes a length instead of an exclusive end", async () => {
    const { value } = await callTool("set_region", {
      start: "$8F00",
      length: 32,
      kind: "text",
    });

    expect((value as { covers: string }).covers).toBe("$8F00-$8F1F (32 bytes)");
  });

  it("insists on exactly one of end and length", async () => {
    const neither = await callTool("set_region", { start: "$8F00", kind: "text" });
    const both = await callTool("set_region", {
      start: "$8F00",
      end: "$8F20",
      length: 32,
      kind: "text",
    });

    expect(neither.isError).toBe(true);
    expect(both.isError).toBe(true);
  });

  it("says what is wrong rather than failing silently", async () => {
    const missing = await callTool("remove_label", { address: "$8F80" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/no label at/i);
  });
});
