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
  copyFileSync("assets/gridrunner/gridrunner.re64", projectPath);
  copyFileSync("assets/gridrunner/gridrunner.prg", join(dir, "gridrunner.prg"));
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
        "add_claim",
        "add_claims",
        "claims_at",
        "list_roots",
        "add_type",
        "edit_type",
        "remove_type",
        "list_types",
        "disagreements",
        "set_claim",
        "remove_claim",
        "list_claims",
        "mark_function",
        "unmark_function",
        "undo",
      ])
    );

    // Gone, not aliased. An agent rediscovers this surface from the schema
    // every session and has no persisted callers, so a deprecated name is a
    // second vocabulary to learn for nothing — and the whole point of the
    // claims redesign is that there is one noun.
    for (const retired of [
      "add_label",
      "add_labels",
      "rename_label",
      "remove_label",
      "list_labels",
      "set_region",
      "set_regions",
      "remove_region",
      "set_primary_label",
      "bind_label",
      "unbind_label",
      "add_root",
      "remove_root",
    ]) {
      expect(names).not.toContain(retired);
    }
  });

});

describe("declaring constants over the wire", () => {
  /**
   * The schema in front of `addConstant` is tested by nothing else.
   *
   * Both `run_block` bugs got through a green suite for exactly this reason:
   * `Workspace` is tested thoroughly and the schema in front of it was not, so
   * everything the tests exercised worked and the tool could not be called. This
   * grew a tool and changed two schemas, so it grows a transport test.
   */
  it("adds rather than replaces, and hands back the id", async () => {
    const first = await callTool("add_constant", { name: "SHIELD_FLAG", value: "$04" });
    const second = await callTool("add_constant", { name: "SHIELD_FLAG", value: "$08" });
    expect(first.isError).toBe(false);
    expect(second.isError).toBe(false);

    const a = (first.value as { constant: string }).constant;
    const b = (second.value as { constant: string }).constant;
    expect(a).not.toBe(b);

    const listed = (await callTool("list_constants")).value as {
      constants: { id: string; name: string; value: string }[];
    };
    const held = listed.constants.filter((c) => c.name === "SHIELD_FLAG");
    expect(held.map((c) => c.value).sort()).toEqual(["$04", "$08"]);
    // Ids are returned, or nothing downstream can say which one it means.
    expect(held.every((c) => typeof c.id === "string" && c.id.length > 0)).toBe(true);
  });

  it("revises by id and refuses an ambiguous name", async () => {
    const first = await callTool("add_constant", { name: "SHIELD_FLAG", value: "$04" });
    await callTool("add_constant", { name: "SHIELD_FLAG", value: "$08" });

    const edited = await callTool("edit_constant", {
      id: (first.value as { constant: string }).constant,
      name: "SHIELD_BIT",
    });
    expect(edited.isError).toBe(false);

    const refused = await callTool("remove_constant", { name: "SHIELD_FLAG" });
    expect(refused.isError).toBe(false);

    await callTool("add_constant", { name: "SHIELD_BIT", value: "$10" });
    const ambiguous = await callTool("remove_constant", { name: "SHIELD_BIT" });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.text).toContain("Say which by id");
  });

  it("takes a hex string or a number for the value, like every other address", async () => {
    // The `run_block` lesson: byte values had to be numbers while addresses could
    // be `$8100`, so the API was inconsistent with itself and every caller found
    // out by being rejected.
    const hex = await callTool("add_constant", { name: "AS_HEX", value: "$0F" });
    const dec = await callTool("add_constant", { name: "AS_NUMBER", value: 15 });
    expect(hex.isError).toBe(false);
    expect(dec.isError).toBe(false);
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
    const { value } = await callTool("effects", { address: "$8015", follow: "block" });
    const effects = value as { reads: string[]; writes: string[]; unmodelled: unknown[] };
    expect(effects.reads).toContain("X");
    expect(effects.writes).toContain("Z");
    expect(effects.unmodelled).toEqual([]);
  });

  it("declares several regions at once, and reports the ones it declined", async () => {
    // The last write with no batch form, and the most used of all of them: 129
    // of 648 calls in one collaborative run, a round trip each. Partial, like
    // every other batch here — one bad span must not lose the rest.
    const { isError, value } = await callTool("add_claims", {
      claims: [
        { at: "$8E00", extent: 0x40, is: "data", name: "batchOne" },
        { at: "$8E40", extent: 0x40, is: "data", name: "batchTwo" },
        // Says nothing at all: rejected, and the others still land.
        { at: "$8F00" },
      ],
    });
    expect(isError).toBeFalsy();
    const result = value as { rejected?: { address: string }[]; did: string[] };
    expect(result.rejected?.map((r) => r.address)).toEqual(["$8F00"]);
    expect(result.did.length).toBeGreaterThanOrEqual(2);
  });

  it("takes an inclusive address range on list_labels", async () => {
    // Every other range on this surface has an inclusive end — `set_region`,
    // `export_listing` — and this one was half-open with `to` carrying no
    // description at all, so asking about a single address came back empty.
    const { value } = await callTool("list_claims", { from: "$8000", to: "$8000" });
    expect((value as { total: number }).total).toBeGreaterThan(0);
  });

  it("takes every value of follow, and defaults to calls", async () => {
    // The schema in front of a tool is the one layer neither the Workspace
    // tests nor the analysis tests can reach — both run_block bugs got through
    // a green suite exactly here.
    const sizes: Record<string, number> = {};
    for (const follow of ["block", "routine", "calls", "returning"]) {
      const { isError, value } = await callTool("effects", { address: "$8172", follow });
      expect(isError).toBeFalsy();
      const answer = value as { scope: string; reads: string[]; writes: string[] };
      expect(answer.scope).toBe(follow);
      sizes[follow] = answer.reads.length + answer.writes.length;
    }
    expect(sizes.block).toBeLessThanOrEqual(sizes.routine);
    expect(sizes.returning).toBeLessThanOrEqual(sizes.calls);

    const { value } = await callTool("effects", { address: "$8172" });
    expect((value as { scope: string }).scope).toBe("calls");
  });

  it("points somewhere useful when no block covers the address", async () => {
    // "No decoded block covers $8000" is true and a dead end. The nearest block
    // start is the next call.
    const { isError, text } = await callTool("effects", { address: "$8000", follow: "block" });
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
    const { value } = await callTool("add_claim", {
      at: "$8870",
      name: "NamedByAnAgent",
      root: "routine",
    });

    expect((value as { did: string[] }).did[0]).toContain("NamedByAnAgent");

    const listed = await callTool("list_claims", { namePattern: "NamedByAnAgent" });
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

    await callTool("add_claim", { at: "$8870", name: "Meanwhile" });
    const conflicted = await callTool("add_claim", {
      at: "$8450",
      name: "TooLate",
      expectVersion: stale,
    });

    expect(conflicted.isError).toBe(true);
    expect(conflicted.text).toMatch(/changed since you read it/);
  });

  it("records the change, attributed to the caller", async () => {
    await callTool("add_claim", { at: "$8870", name: "Attributed" });
    const { value } = await callTool("changes_since", { cursor: 0 });
    const { changes } = value as { changes: { did: string; by: string }[] };

    expect(changes).toHaveLength(1);
    expect(changes[0].by).toBe("usr_agent");
    expect(changes[0].did).toContain("Attributed");
  });

  it("lets a caller catch up on what it missed", async () => {
    await callTool("add_claim", { at: "$8870", name: "First" });
    const { value: first } = await callTool("changes_since", { cursor: 0 });
    const cursor = (first as { cursor: number }).cursor;

    await callTool("add_claim", { at: "$8450", name: "Second" });
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
    await callTool("add_claim", { at: "$8870", name: "Regretted" });
    const { value } = await callTool("undo");

    expect((value as { undone: string }).undone).toContain("Regretted");
    const listed = await callTool("list_claims", { namePattern: "Regretted" });
    expect((listed.value as { total: number }).total).toBe(0);
  });

  it("sets a region, which the browser cannot", async () => {
    const { value } = await callTool("add_claim", {
      at: "$8F00",
      extent: 0x20,
      is: "text",
      name: "blurb",
    });
    expect((value as { ok: boolean }).ok).toBe(true);
  });

  it("takes back a region and a function declaration", async () => {
    const made = await callTool("add_claim", { at: "$8F00", extent: 0x20, is: "text" });
    const dropped = await callTool("remove_claim", {
      id: (made.value as { claims: string[] }).claims[0],
    });
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
    const result = await callTool("add_claim", {
      at: "$8F00",
      extent: 0x20,
      is: "text",
      encoding: "petscii",
      charset: "$2000",
    });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/encoding|charset|unrecognized/i);
  });

  it("says how far a claim reaches in one spelling, not two", async () => {
    // `set_region` took `end` *or* `length` and had to refuse both and neither.
    // A claim has `extent`, which is the length, so the pair — and the two ways
    // of getting it wrong — are gone rather than validated.
    const { value } = await callTool("add_claim", {
      at: "$8F00",
      extent: 32,
      is: "text",
    });

    expect((value as { covers: string }).covers).toBe("$8F00-$8F1F (32 bytes)");
  });

  it("says what is wrong rather than failing silently", async () => {
    const missing = await callTool("remove_claim", { id: "clm_nothere" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/no claim/i);
  });

  // Every argument below reached a caller only as a rejection until it was
  // added, and none of it was visible from inside: `Workspace` took a range and
  // an end address all along, and the schema in front of it did not. That is
  // the class of bug this file exists for.
  it("narrows labels to an address range, which the description always promised", async () => {
    const zeroPage = await callTool("list_claims", { from: "$00", to: "$FF" });
    expect(zeroPage.isError).toBe(false);
    const { labels } = zeroPage.value as { labels: { address: string }[] };
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(parseInt(label.address.slice(1), 16)).toBeLessThanOrEqual(0xff);
  });

  it("takes an end address on a listing, the way set_region does", async () => {
    const page = await callTool("export_listing", { start: "$8100", end: "$8110" });
    expect(page.isError).toBe(false);
    expect((page.value as { text: string }).text.length).toBeGreaterThan(0);
  });

  it("adds comments without clobbering, then edits and reorders by id", async () => {
    // The defect three of four readers hit across two runs: set_comment upserted
    // by (address, placement), so a second writer silently replaced the first.
    // The model always rendered several comments per address; only the write
    // path could not reach it.
    const first = await callTool("add_comment", { address: "$8240", text: "first voice" });
    const second = await callTool("add_comment", { address: "$8240", text: "second voice" });
    expect(first.isError).toBe(false);
    expect(second.isError).toBe(false);

    const a = (first.value as { comment: string }).comment;
    const b = (second.value as { comment: string }).comment;
    expect(a).not.toBe(b);

    const listed = await callTool("list_comments");
    const texts = (listed.value as { comments: { id: string; text: string }[] }).comments;
    expect(texts.filter((c) => /voice$/.test(c.text))).toHaveLength(2);
    // Without ids on the listing, editing and removing are unreachable.
    expect(texts.every((c) => typeof c.id === "string")).toBe(true);

    expect((await callTool("edit_comment", { id: a, text: "revised" })).isError).toBe(false);
    expect((await callTool("reorder_comments", { address: "$8240", ids: [b, a] })).isError).toBe(
      false
    );
    expect((await callTool("remove_comment", { id: b })).isError).toBe(false);
  });

  it("hands out an upload URL rather than taking bytes as an argument", async () => {
    // A D64 is 175KB, which is ~233KB of base64 and tens of thousands of tokens
    // through a transcript for a file nothing needs to read.
    const prepared = await callTool("prepare_upload", { name: "disk.d64" });
    expect(prepared.isError).toBe(false);
    const { url, method, maxBytes } = prepared.value as {
      url: string;
      method: string;
      maxBytes: number;
    };
    expect(method).toBe("PUT");
    expect(url).toMatch(/\/api\/upload\/[0-9a-f]{48}$/);
    expect(maxBytes).toBeGreaterThan(174848);
  });

  it("refuses a byte layer over a file the project has not been given", async () => {
    const refused = await callTool("add_byte_layer", { type: "prg", path: "nothere.prg" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/holds no file/i);
  });

  it("says several things at once and reports what it declined", async () => {
    const { isError, value } = await callTool("add_claims", {
      claims: [
        { at: "$8E00", extent: 0x40, is: "data", name: "batchA" },
        { at: "$8250", name: "batchB" },
        { at: "$801B", root: "routine", name: "batchC" },
      ],
    });

    expect(isError).toBeFalsy();
    const result = value as { claims: string[]; rejected?: unknown[] };
    expect(result.rejected).toBeUndefined();
    // One id per claim, so the batch is as correctable as three single calls.
    expect(result.claims).toHaveLength(3);
  });

  it("reports every claim covering an address, resolving nothing", async () => {
    await callTool("add_claim", { at: "$8250", name: "oneReading" });
    await callTool("add_claim", { at: "$8250", name: "another" });

    const { isError, value } = await callTool("claims_at", { at: "$8250" });
    expect(isError).toBeFalsy();

    // Both stand. Which of them an operand shows is a separate question, and
    // this tool deliberately does not answer it.
    const names = (value as { claims: { name?: string }[] }).claims.map((c) => c.name);
    expect(names).toContain("oneReading");
    expect(names).toContain("another");
  });

  it("corrects one field of a claim and leaves the rest alone", async () => {
    const made = await callTool("add_claim", {
      at: "$8250",
      name: "beforeCorrection",
      extent: 16,
    });
    const id = (made.value as { claims: string[] }).claims[0];

    const revised = await callTool("set_claim", { id, name: "afterCorrection" });
    expect(revised.isError).toBeFalsy();

    const { value } = await callTool("claims_at", { at: "$8250" });
    const claim = (value as { claims: { id?: string; name?: string; extent?: number }[] }).claims.find(
      (c) => c.id === id
    );
    expect(claim?.name).toBe("afterCorrection");
    // Omitted means "leave alone", which is the whole reason a revise is
    // partial: two people correcting different fields must both survive.
    expect(claim?.extent).toBe(16);
  });

  it("clears a field with null, which omitting it cannot say", async () => {
    const made = await callTool("add_claim", { at: "$8250", name: "hasAnExtent", extent: 16 });
    const id = (made.value as { claims: string[] }).claims[0];

    const cleared = await callTool("set_claim", { id, extent: null });
    expect(cleared.isError).toBeFalsy();

    const { value } = await callTool("claims_at", { at: "$8250" });
    const claim = (value as { claims: { id?: string; extent?: number }[] }).claims.find(
      (c) => c.id === id
    );
    expect(claim?.extent).toBeUndefined();
  });

  it("refuses a revise that names no field, rather than reporting success", async () => {
    const made = await callTool("add_claim", { at: "$8250", name: "untouched" });
    const id = (made.value as { claims: string[] }).claims[0];

    const nothing = await callTool("set_claim", { id });
    expect(nothing.isError).toBe(true);
    expect(nothing.text).toMatch(/at least one field/i);
  });

  it("declares a record layout with a hole in it, and binds a claim to it", async () => {
    // The layout is the one a reader actually established in Revenge of the
    // Mutant Camels: 200-byte records with a 40-character name at +$A0, in
    // screen codes. The hole between the fields is the point — declaring what
    // you have proved without inventing padding for the rest.
    const made = await callTool("add_type", {
      name: "Zone",
      size: 200,
      fields: {
        "0": { name: "kind", type: "u8" },
        "$A0": { name: "label", type: "char(40,screen)" },
      },
    });
    expect(made.isError).toBeFalsy();
    const typeId = (made.value as { type: string }).type;
    expect(typeId).toMatch(/^typ_/);

    const listed = (await callTool("list_types", {})).value as {
      types: {
        id: string;
        fields: { offset: string; name: string; type: string }[];
        unexplainedBytes: number;
        usedAt: string[];
      }[];
    };
    const zone = listed.types.find((t) => t.id === typeId)!;
    // Memory order, derived from the offsets, which is why fields need no ids.
    expect(zone.fields.map((f) => f.name)).toEqual(["kind", "label"]);
    expect(zone.fields[1].offset).toBe("+$A0");
    // The type came back the way it was written, byte order and encoding kept.
    expect(zone.fields[1].type).toBe("char(40,screen)");
    // 200 bytes, 41 accounted for: the rest is a work queue, not a fault.
    expect(zone.unexplainedBytes).toBe(159);
    expect(zone.usedAt).toEqual([]);

    const bound = await callTool("add_claim", {
      at: "$8E00",
      is: "record",
      typeId,
      extent: 400,
      name: "zones",
    });
    expect(bound.isError).toBeFalsy();

    const after = (await callTool("list_types", {})).value as {
      types: { id: string; usedAt: string[] }[];
    };
    expect(after.types.find((t) => t.id === typeId)!.usedAt).toEqual(["$8E00"]);
  });

  it("declines a field it cannot read and keeps the rest", async () => {
    // Partial, like every batch here: one bad field must not lose the ones
    // somebody proved from a copy routine.
    const made = await callTool("add_type", {
      name: "Partial",
      size: 8,
      fields: {
        "0": { name: "good", type: "u8" },
        "1": { name: "bogus", type: "widget" },
        "9": { name: "outside", type: "u8" },
      },
    });

    expect(made.isError).toBeFalsy();
    const result = made.value as {
      type: string;
      rejected: { address: string; reason: string }[];
    };
    expect(result.rejected.map((r) => r.address).sort()).toEqual(["1", "9"]);
    expect(result.rejected.find((r) => r.address === "9")!.reason).toMatch(/outside/);

    const listed = (await callTool("list_types", {})).value as {
      types: { id: string; fields: { name: string }[] }[];
    };
    expect(listed.types.find((t) => t.id === result.type)!.fields.map((f) => f.name)).toEqual([
      "good",
    ]);
  });

  it("refuses a record claim with no layout and no extent, rather than guessing", async () => {
    const made = await callTool("add_type", { name: "Tiny", size: 2, fields: {} });
    const typeId = (made.value as { type: string }).type;

    const noType = await callTool("add_claim", { at: "$8E00", is: "record", extent: 8 });
    expect(noType.isError).toBe(true);
    expect(noType.text).toMatch(/typeId/);

    // How many records is derived from extent / size, so an extent-less record
    // claim is one record and almost certainly not what anybody meant.
    const noExtent = await callTool("add_claim", { at: "$8E00", is: "record", typeId });
    expect(noExtent.isError).toBe(true);
    expect(noExtent.text).toMatch(/extent/);
  });

  it("leaves a claim readable when the layout it names is taken away", async () => {
    // Same rule as a dangling constant: the bytes render, so a delete racing
    // somebody else's binding heals itself rather than needing a sweep.
    const made = await callTool("add_type", { name: "Doomed", size: 4, fields: {} });
    const typeId = (made.value as { type: string }).type;
    await callTool("add_claim", { at: "$8E00", is: "record", typeId, extent: 8 });

    expect((await callTool("remove_type", { id: typeId })).isError).toBeFalsy();
    // Still there, still readable, still saying what it said.
    const covering = (await callTool("claims_at", { at: "$8E00" })).value as {
      claims: { name?: string }[];
    };
    expect(covering.claims.length).toBeGreaterThan(0);
  });

  it("links a layer into a target at a chosen address, and reports the link", async () => {
    // The schema in front of `setTarget` is the only layer that catches this:
    // `layers` used to be a plain array of ids, and a caller passing the object
    // form would have been rejected with the logic underneath working fine.
    const targets = (await callTool("list_targets", {})).value as {
      layers: { id: string; name: string }[];
    };
    const layer = targets.layers[0].id;

    const made = await callTool("set_target", {
      name: "relocated",
      layers: [{ layer, at: "$0100" }],
    });
    expect(made.isError).toBeFalsy();

    const after = (await callTool("list_targets", {})).value as {
      targets: { name: string; layers: { layer: string; at?: string }[] }[];
    };
    const relocated = after.targets.find((t) => t.name === "relocated")!;
    // Reported, because it is what decides shadowing — and because a
    // layer-scoped claim's absolute address is this plus its offset.
    expect(relocated.layers).toEqual([{ layer, name: expect.any(String), at: "$0100" }]);
  });

  it("keeps the short spelling for a layer at its own address", async () => {
    const targets = (await callTool("list_targets", {})).value as {
      layers: { id: string }[];
    };
    const layer = targets.layers[0].id;

    await callTool("set_target", { name: "plain", layers: [layer] });
    const after = (await callTool("list_targets", {})).value as {
      targets: { name: string; layers: { layer: string; at?: string }[] }[];
    };
    // No `at`: the layer sits where its own header puts it, and saying so
    // would be inventing a fact the target does not hold.
    expect(after.targets.find((t) => t.name === "plain")!.layers[0].at).toBeUndefined();
  });

  it("refuses to link one layer twice, which would shadow itself", async () => {
    const targets = (await callTool("list_targets", {})).value as { layers: { id: string }[] };
    const layer = targets.layers[0].id;

    const refused = await callTool("set_target", { name: "doubled", layers: [layer, layer] });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/once/i);
  });

  it("says where decoding starts, and which of those it can take back", async () => {
    const before = await callTool("list_roots", {});
    const listed = before.value as {
      total: number;
      roots: { address: string; id?: string; writable: boolean }[];
    };
    expect(listed.total).toBeGreaterThan(0);

    // A PRG's load address is inherent to the file: reported, and with no id,
    // because handing one back invites a write against an identity nobody owns.
    expect(listed.roots.some((r) => !r.writable && r.id === undefined)).toBe(true);

    // A root somebody declared is correctable, by the id the write returned.
    const made = await callTool("add_claim", { at: "$801B", root: "routine", name: "aRoot" });
    const id = (made.value as { claims: string[] }).claims[0];

    const after = (await callTool("list_roots", {})).value as {
      roots: { address: string; id?: string; writable: boolean }[];
    };
    const mine = after.roots.find((r) => r.address === "$801B");
    expect(mine?.writable).toBe(true);
    expect(mine?.id).toBe(id);
  });

  it("reports where the project contradicts itself", async () => {
    // One name reaching two addresses: `levelTable-1` means a different byte
    // against each, so an operand rendered bare would be a wrong answer that
    // looks right — which is what both neutral readers in experiment 3 hit.
    await callTool("add_claim", { at: "$8250", name: "sharedName" });
    await callTool("add_claim", { at: "$8450", name: "sharedName" });

    const { isError, value } = await callTool("disagreements", {});
    expect(isError).toBeFalsy();
    const found = value as { total: number; findings: { kind: string; what: string }[] };
    expect(found.total).toBeGreaterThan(0);
    expect(found.findings.some((f) => f.what.includes("sharedName"))).toBe(true);
  });

  it("removes a claim by id, which is the only thing that can name one", async () => {
    // Two names at one address is ordinary — the reference disassembly calls
    // $08 two things — so "remove the claim at $8250" has no single answer and
    // there is no longer a spelling that asks it. The write returns the id, and
    // claims_at reports every id covering an address.
    const first = await callTool("add_claim", { at: "$8250", name: "firstName" });
    const second = await callTool("add_claim", { at: "$8250", name: "secondName" });

    const covering = await callTool("claims_at", { at: "$8250" });
    const ids = (covering.value as { claims: { id?: string }[] }).claims.map((c) => c.id);
    expect(ids).toContain((first.value as { claims: string[] }).claims[0]);
    expect(ids).toContain((second.value as { claims: string[] }).claims[0]);

    const id = (second.value as { claims: string[] }).claims[0];
    expect((await callTool("remove_claim", { id })).isError).toBe(false);
  });

  it("runs a program over the wire and reports where it stopped", async () => {
    const run = await callTool("run_program", { from: "$8100", maxInstructions: 5000 });
    expect(run.isError).toBe(false);
    const { instructions, reason, stoppedAt } = run.value as {
      instructions: number;
      reason: string;
      stoppedAt: string;
    };
    expect(instructions).toBeGreaterThan(0);
    expect(typeof reason).toBe("string");
    expect(stoppedAt).toMatch(/^\$[0-9A-F]{4}$/);
  });

  it("refuses a capture of no bytes", async () => {
    const refused = await callTool("run_program", {
      from: "$8100",
      maxInstructions: 100,
      capture: { name: "nothing.prg", from: "$8000", to: "$8000" },
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/at least one byte/i);
  });

  it("declares a view over the layer stack and selects it", async () => {
    const listed = await callTool("list_targets");
    expect(listed.isError).toBe(false);
    const { layers } = listed.value as { layers: { id: string; name: string }[] };
    expect(layers.length).toBeGreaterThan(0);

    const made = await callTool("set_target", { name: "just-the-prg", layers: [layers[0].id] });
    expect(made.isError).toBe(false);

    const chosen = await callTool("select_target", { name: "just-the-prg" });
    expect(chosen.isError).toBe(false);
    expect((await callTool("list_targets")).text).toContain("just-the-prg");

    // Back to everything, then tidy up so later cases see the whole project.
    expect((await callTool("select_target", {})).isError).toBe(false);
    expect((await callTool("remove_target", { name: "just-the-prg" })).isError).toBe(false);
  });

  it("refuses a target over a layer that is not there", async () => {
    const refused = await callTool("set_target", { name: "bad", layers: ["lay_nope"] });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/No layer/);
  });

  it("lists who is in the project, including itself", async () => {
    // An agent has no socket and so no awareness; membership is in the document
    // precisely so both consumers can read the same list.
    const here = await callTool("list_participants");
    expect(here.isError).toBe(false);
    const { participants, online } = here.value as {
      online: number;
      participants: { kind: string; online: boolean; codename?: string }[];
    };
    expect(participants.length).toBeGreaterThan(0);
    expect(online).toBeGreaterThan(0);
    expect(participants.some((p) => p.kind === "agent" && p.online)).toBe(true);
  });

  it("tags a point over the wire, and takes the tag back as a cursor", async () => {
    const tagged = await callTool("tag_project", { name: "wire-test", note: "over MCP" });
    expect(tagged.isError).toBe(false);

    await callTool("add_claim", { at: "$8210", name: "afterWireTag" });

    const since = await callTool("changes_since", { tag: "wire-test" });
    expect(since.isError).toBe(false);
    expect(since.text).toContain("afterWireTag");

    const listed = await callTool("list_tags");
    const { tags } = listed.value as { tags: { name: string; changesSince: number }[] };
    expect(tags.some((t) => t.name === "wire-test")).toBe(true);

    const gone = await callTool("remove_tag", { name: "wire-test" });
    expect(gone.isError).toBe(false);
    expect((await callTool("changes_since", { tag: "wire-test" })).isError).toBe(true);
  });

  it("returns the project as text an agent can read back", async () => {
    // There was no tool for this at all: an agent had to reach past the surface
    // to an HTTP route it could only find by reading the server.
    const written = await callTool("export_project");
    expect(written.isError).toBe(false);
    const { text, bytes } = written.value as { text: string; bytes: number };
    expect(bytes).toBeGreaterThan(0);
    expect(() => JSON.parse(text)).not.toThrow();
  });
});
