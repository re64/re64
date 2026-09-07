/**
 * The tool list, from a server that is actually running.
 *
 * Asking the transport rather than reading `tools.ts` is the whole point: the
 * schema in front of a tool is the layer neither the type checker nor the
 * workspace tests can see, which is why both `run_block` bugs shipped through a
 * green suite. A document derived from the source would have the same blind
 * spot as the tests.
 */

import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../server/index.js";
import { importProject } from "../store/index.js";
import { ToolInfo } from "./api-doc-source.js";

/** Start a throwaway server on the reference project and ask what it offers. */
export async function liveTools(): Promise<ToolInfo[]> {
  const dir = mkdtempSync(join(tmpdir(), "re64-api-doc-"));
  try {
    const projectPath = join(dir, "gridrunner.re64");
    copyFileSync("assets/gridrunner/gridrunner.re64", projectPath);
    copyFileSync("assets/gridrunner/gridrunner.prg", join(dir, "gridrunner.prg"));
    const { databasePath } = importProject(projectPath);

    const server = startServer({
      projectPath: databasePath,
      port: 0,
      host: "127.0.0.1",
      quiet: true,
    });
    await server.ready;
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "x-re64-user": "usr_agent",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      // The transport answers as an event stream, so the payload needs unwrapping.
      const text = await res.text();
      const line = text.split("\n").find((l) => l.startsWith("data: "));
      const reply = JSON.parse((line ?? text).replace(/^data: /, "")) as {
        result?: { tools: ToolInfo[] };
        error?: { message: string };
      };
      if (reply.error) throw new Error(reply.error.message);
      return reply.result!.tools;
    } finally {
      await server.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
