import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, RunningServer } from "./index.js";
import { importProject } from "../store/index.js";

/**
 * Serving a project that carries its own binaries.
 *
 * The client is unchanged by this: it still asks for a file by the name the
 * project uses. What changes is that the server no longer needs the file to
 * exist on disk, which is what makes a database a thing you can hand to someone.
 */

let dir: string;
let server: RunningServer;
let base: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "re64-dbmode-"));
  const projectPath = join(dir, "gridrunner.re64");
  copyFileSync("assets/gridrunner.re64", projectPath);
  copyFileSync("assets/gridrunner.prg", join(dir, "gridrunner.prg"));

  const { databasePath } = importProject(projectPath);
  // Nothing left on disk but the database.
  rmSync(projectPath);
  rmSync(join(dir, "gridrunner.prg"));

  server = startServer({ projectPath: databasePath, port: 0, host: "127.0.0.1", quiet: true });
  await server.ready;
  base = `http://127.0.0.1:${server.port}`;
});

afterEach(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("a server given a database", () => {
  it("serves the project text", async () => {
    const body = (await (await fetch(`${base}/api/project`)).json()) as { raw: string };
    expect(body.raw).toContain('"name": "Gridrunner"');
  });

  it("serves a binary that is not on disk", async () => {
    const res = await fetch(`${base}/api/blob?path=gridrunner.prg`);
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(4098);
  });

  it("labels it immutable, because the name maps to bytes that cannot change", async () => {
    const res = await fetch(`${base}/api/blob?path=gridrunner.prg`);
    expect(res.headers.get("cache-control")).toContain("immutable");
    // The tag is the content hash, so it is right by construction rather than
    // by remembering to update it.
    expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]{64}"$/);
  });

  it("reports a file it does not hold", async () => {
    const res = await fetch(`${base}/api/blob?path=absent.prg`);
    expect(res.status).toBe(404);
  });

  it("accepts an edit and keeps it", async () => {
    const before = (await (await fetch(`${base}/api/project`)).json()) as {
      raw: string;
      version: string;
    };
    const res = await fetch(`${base}/api/project`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        raw: before.raw.replace('"DrawGrid"', '"RenamedOverHttp"'),
        baseVersion: before.version,
      }),
    });
    expect(res.status).toBe(200);

    const after = (await (await fetch(`${base}/api/project`)).json()) as { raw: string };
    expect(after.raw).toContain("RenamedOverHttp");
  });
});
