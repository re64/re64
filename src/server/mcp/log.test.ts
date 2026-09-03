import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunningServer, startServer } from "../index.js";
import { importProject } from "../../store/index.js";
import { McpLogEntry, defaultMcpLogPath, replyOf } from "./log.js";
import { ProjectSession } from "../../client/session.js";

let dir: string;
let server: RunningServer;
let endpoint: string;
let logPath: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "re64-mcplog-"));
  const projectPath = join(dir, "gridrunner.re64");
  copyFileSync("assets/gridrunner/gridrunner.re64", projectPath);
  copyFileSync("assets/gridrunner/gridrunner.prg", join(dir, "gridrunner.prg"));
  const { databasePath } = importProject(projectPath);
  logPath = defaultMcpLogPath(databasePath);

  server = startServer({ projectPath: databasePath, port: 0, host: "127.0.0.1", quiet: true });
  await server.ready;
  endpoint = `http://127.0.0.1:${server.port}/mcp`;
});

afterEach(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

async function rpc(method: string, params?: unknown, headers: Record<string, string> = {}) {
  await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-re64-user": "usr_agent",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

const call = (name: string, args: Record<string, unknown> = {}) =>
  rpc("tools/call", { name, arguments: args });

const transcript = (): McpLogEntry[] =>
  readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as McpLogEntry);

describe("the transcript", () => {
  it("writes itself beside the database without being asked", async () => {
    await call("list_projects");
    expect(existsSync(logPath)).toBe(true);
  });

  it("records what was asked for, not just that something happened", async () => {
    await call("set_label", { address: "$8870", name: "Named" });

    const [entry] = transcript().filter((e) => e.tool === "set_label");
    expect(entry.method).toBe("tools/call");
    expect(entry.args).toEqual({ address: "$8870", name: "Named" });
    expect(entry.caller).toBe("usr_agent");
    expect(entry.ok).toBe(true);
    expect(entry.ms).toBeGreaterThanOrEqual(0);
  });

  it("records a call to a tool that does not exist", async () => {
    // The most informative line in the file: an agent reaching for something
    // that isn't there is a gap in the API, and it never reaches a handler,
    // so nothing below this layer could see it.
    //
    // The example used to be `add_comment`, which an agent invented and which
    // now exists. `run_routine` is a real one from the same run: running a
    // whole routine rather than one block, deliberately not built because it
    // means following jumps whose targets depend on state nobody supplied.
    await call("run_routine", { address: "$8870" });

    const [entry] = transcript().filter((e) => e.tool === "run_routine");
    expect(entry).toBeDefined();
    expect(entry.ok).toBe(false);
    expect(entry.error).toMatch(/run_routine/);
    expect(entry.args).toEqual({ address: "$8870" });
  });

  it("separates a refusal from a failure", async () => {
    await call("remove_label", { address: "$8F80" });

    const [entry] = transcript().filter((e) => e.tool === "remove_label");
    expect(entry.ok).toBe(false);
    expect(entry.error).toMatch(/no label at/i);
  });

  it("counts a large read without keeping a copy of it", async () => {
    await call("read_disassembly", { start: "$8011", lines: 200 });

    const [entry] = transcript().filter((e) => e.tool === "read_disassembly");
    expect(entry.ok).toBe(true);
    expect(entry.bytes).toBeGreaterThan(5_000);
    // The entry itself stays small: the size is recorded, the payload is not.
    expect(JSON.stringify(entry).length).toBeLessThan(1_000);
  });

  it("keeps what identifies the client, which is the open question", async () => {
    // Whether N spawned agents are N MCP clients or one shared client decides
    // how agent sessions have to be keyed. Counting these answers it.
    await rpc(
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "some-host", version: "1.2.3" },
      },
      { "mcp-session-id": "sess-abc" }
    );

    const [entry] = transcript().filter((e) => e.method === "initialize");
    expect(entry.client).toEqual({ name: "some-host", version: "1.2.3" });
    expect(entry.protocol).toBe("2025-06-18");
    expect(entry.session).toBe("sess-abc");
  });

  it("names the session a call worked under", async () => {
    await call("list_projects");

    const [entry] = transcript();
    expect(entry.sessionId).toMatch(/^ses_/);
    expect(entry.codename).toMatch(/^[a-z]+$/);
  });

  it("separates two agents sharing one credential", async () => {
    // One identity, many sessions — the property that stops two agents
    // undoing each other's work. Distinct MCP session ids, one user.
    await rpc(
      "tools/call",
      { name: "list_projects", arguments: {} },
      { "mcp-session-id": "agent-one" }
    );
    await rpc(
      "tools/call",
      { name: "list_projects", arguments: {} },
      { "mcp-session-id": "agent-two" }
    );

    const entries = transcript().filter((e) => e.tool === "list_projects");
    expect(entries).toHaveLength(2);
    expect(entries[0].caller).toBe(entries[1].caller);
    expect(entries[0].sessionId).not.toBe(entries[1].sessionId);
    expect(entries[0].codename).not.toBe(entries[1].codename);
  });

  it("keeps one agent on one session across calls", async () => {
    for (let i = 0; i < 3; i++) {
      await rpc(
        "tools/call",
        { name: "list_projects", arguments: {} },
        { "mcp-session-id": "steady" }
      );
    }

    const ids = new Set(transcript().map((e) => e.sessionId));
    expect(ids.size).toBe(1);
  });

  it("can be turned off", async () => {
    await server.close();
    server = startServer({
      projectPath: join(dir, "gridrunner.re64db"),
      port: 0,
      host: "127.0.0.1",
      quiet: true,
      mcpLog: false,
    });
    await server.ready;
    endpoint = `http://127.0.0.1:${server.port}/mcp`;

    await call("list_projects");
    expect(existsSync(logPath)).toBe(false);
  });
});

describe("reading a reply", () => {
  it("tells a protocol error from a tool error from success", () => {
    expect(replyOf('data: {"result":{"content":[{"text":"{}"}]}}').ok).toBe(true);
    expect(replyOf('data: {"error":{"message":"nope"}}')).toEqual({ ok: false, error: "nope" });
    expect(
      replyOf('data: {"result":{"isError":true,"content":[{"text":"no label at $8F80"}]}}')
    ).toEqual({ ok: false, error: "no label at $8F80" });
  });

  it("does not throw on a body it cannot parse", () => {
    expect(replyOf("").ok).toBe(false);
    expect(replyOf("<html>502</html>").ok).toBe(false);
  });

  it("reads a head cut off mid-payload as the bulk read it is", () => {
    // Every failure here is a sentence, so anything long enough to be cut off
    // succeeded. Without this a large read is transcribed as its own opposite.
    const cut = 'data: {"result":{"content":[{"type":"text","text":"{ \\"lines\\": [';
    expect(replyOf(cut, { truncated: true })).toEqual({ ok: true });
    expect(replyOf(cut, { truncated: false }).ok).toBe(false);
  });
});

describe("being visible while working", () => {
  it("shows an agent to a browser, under its codename", async () => {
    // A person watching names change must not see nobody there. An agent holds
    // no socket of its own, so the server announces presence on its behalf.
    const watcher = await ProjectSession.open({
      origin: `http://127.0.0.1:${server.port}`,
      project: "gridrunner",
      author: "marcus",
    });
    watcher.announce({ name: "marcus", colour: "#f00" });

    await call("list_projects");
    await new Promise((r) => setTimeout(r, 300));

    const here = watcher.participants();
    const agent = here.find((p) => p.name !== "marcus");
    expect(agent?.name).toMatch(/^[a-z]+$/);
    expect(here.filter((p) => p.name === "marcus")).toHaveLength(1);

    watcher.close();
  });

  it("keeps one agent as one participant across calls", async () => {
    const watcher = await ProjectSession.open({
      origin: `http://127.0.0.1:${server.port}`,
      project: "gridrunner",
      author: "marcus",
    });
    watcher.announce({ name: "marcus", colour: "#f00" });

    for (let i = 0; i < 3; i++) {
      await rpc(
        "tools/call",
        { name: "list_projects", arguments: {} },
        { "mcp-session-id": "steady" }
      );
    }
    await new Promise((r) => setTimeout(r, 300));

    // A new dot per request would make a working agent look like a crowd.
    expect(watcher.participants().filter((p) => p.name !== "marcus")).toHaveLength(1);

    watcher.close();
  });
});
