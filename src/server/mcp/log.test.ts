import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunningServer, startServer } from "../index.js";
import { importProject } from "../../store/index.js";
import { McpLogEntry, defaultMcpLogPath, replyOf } from "./log.js";

let dir: string;
let server: RunningServer;
let endpoint: string;
let logPath: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "re64-mcplog-"));
  const projectPath = join(dir, "gridrunner.re64");
  copyFileSync("assets/gridrunner.re64", projectPath);
  copyFileSync("assets/gridrunner.prg", join(dir, "gridrunner.prg"));
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
    await call("add_comment", { address: "$8870", text: "wait for raster" });

    const [entry] = transcript().filter((e) => e.tool === "add_comment");
    expect(entry).toBeDefined();
    expect(entry.ok).toBe(false);
    expect(entry.error).toMatch(/add_comment/);
    expect(entry.args).toEqual({ address: "$8870", text: "wait for raster" });
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
