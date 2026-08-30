import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, RunningServer } from "./index.js";
import { SqliteStorage, importProject } from "../store/index.js";
import { applyOpsToDoc, emptyDoc } from "../core/crdt/index.js";
import { WebsocketProvider } from "y-websocket";

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
let project: string;
let databaseUnderTest: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "re64-dbmode-"));
  const projectPath = join(dir, "gridrunner.re64");
  copyFileSync("assets/gridrunner.re64", projectPath);
  copyFileSync("assets/gridrunner.prg", join(dir, "gridrunner.prg"));

  const { databasePath, projectId } = importProject(projectPath);
  // Nothing left on disk but the database.
  rmSync(projectPath);
  rmSync(join(dir, "gridrunner.prg"));

  server = startServer({ projectPath: databasePath, port: 0, host: "127.0.0.1", quiet: true });
  await server.ready;
  base = `http://127.0.0.1:${server.port}`;
  project = projectId;
  databaseUnderTest = databasePath;
});

afterEach(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("a server given a database", () => {
  it("serves the project text", async () => {
    const body = (await (await fetch(`${base}/api/project?project=${project}`)).json()) as { raw: string };
    expect(body.raw).toContain('"name": "Gridrunner"');
  });

  it("serves a binary that is not on disk", async () => {
    const res = await fetch(`${base}/api/blob?path=gridrunner.prg&project=${project}`);
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(4098);
  });

  it("labels it immutable, because the name maps to bytes that cannot change", async () => {
    const res = await fetch(`${base}/api/blob?path=gridrunner.prg&project=${project}`);
    expect(res.headers.get("cache-control")).toContain("immutable");
    // The tag is the content hash, so it is right by construction rather than
    // by remembering to update it.
    expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]{64}"$/);
  });

  it("reports a file it does not hold", async () => {
    const res = await fetch(`${base}/api/blob?path=absent.prg&project=${project}`);
    expect(res.status).toBe(404);
  });

  it("reports its own state, which a browser cannot see otherwise", async () => {
    const body = (await (await fetch(`${base}/api/debug?project=${project}`)).json()) as Record<string, unknown>;
    expect(body.storage).toBe("sqlite");
    expect(body.clients).toBe(0);
    expect(body.version).toEqual(expect.any(String));
    expect(body.updates).toMatchObject({ count: expect.any(Number) });
    expect(body.ops).toEqual({ total: 0, undone: 0 });
  });

  it("offers the users a session can claim to be", async () => {
    const body = (await (await fetch(`${base}/api/users?project=${project}`)).json()) as {
      users: { id: string; name: string }[];
    };
    expect(body.users.map((u) => u.name)).toContain("you");
  });

  it("records a session, and who it says it is", async () => {
    const before = (await (await fetch(`${base}/api/debug?project=${project}`)).json()) as { sessions: number };
    expect(before.sessions).toBe(0);

    const doc = emptyDoc();
    const provider = new WebsocketProvider(base.replace("http", "ws") + "/sync", project, doc, {
      params: { author: "usr_you", session: "sess-under-test" },
      disableBc: true,
    });
    await new Promise<void>((resolve) => provider.once("sync", () => resolve()));

    const after = (await (await fetch(`${base}/api/debug?project=${project}`)).json()) as { sessions: number };
    expect(after.sessions).toBe(1);

    provider.disconnect();
    provider.destroy();
  });

  it("learns which client id a session edits under, so edits are attributable", async () => {
    // A Yjs struct carries a client id and nothing else. Without this binding
    // the history can say what changed but never who changed it.
    const doc = emptyDoc();
    const provider = new WebsocketProvider(base.replace("http", "ws") + "/sync", project, doc, {
      params: { author: "usr_you", session: "sess-attribution" },
      disableBc: true,
    });
    await new Promise<void>((resolve) => provider.once("sync", () => resolve()));

    const layer = (await (await fetch(`${base}/api/project?project=${project}`)).json()) as {
      raw: string;
    };
    const prg = JSON.parse(layer.raw).layers.find(
      (l: { type: string }) => l.type === "prg"
    ) as { id: string; labels: { id: string; address: string }[] };

    applyOpsToDoc(
      doc,
      [
        {
          op: "label.set",
          id: prg.labels[0].id,
          layerId: prg.id,
          address: 0x8100,
          name: "AttributedToMe",
        },
      ],
      "local"
    );
    await new Promise((r) => setTimeout(r, 400));

    const storage = new SqliteStorage(databaseUnderTest, project);
    expect(storage.authorOf(doc.clientID)).toEqual({
      sessionId: "sess-attribution",
      userId: "usr_you",
    });
    storage.close();

    provider.disconnect();
    provider.destroy();
  });

  it("exports the project asked for, not whichever sorts first", async () => {
    // The export button used to omit the project, so in a database holding
    // several it wrote out the wrong one.
    const res = await fetch(`${base}/api/export?project=${project}`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });

  it("answers about the database without opening it again each time", async () => {
    // Every open runs the schema DDL, and an agent asks far more often than a
    // browser does.
    for (let i = 0; i < 50; i++) {
      const listed = (await (await fetch(`${base}/api/projects`)).json()) as {
        projects: { id: string }[];
      };
      expect(listed.projects.map((p) => p.id)).toContain(project);
    }
  });

  it("accepts an edit and keeps it", async () => {
    const before = (await (await fetch(`${base}/api/project?project=${project}`)).json()) as {
      raw: string;
      version: string;
    };
    const res = await fetch(`${base}/api/project?project=${project}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        raw: before.raw.replace('"DrawGrid"', '"RenamedOverHttp"'),
        baseVersion: before.version,
      }),
    });
    expect(res.status).toBe(200);

    const after = (await (await fetch(`${base}/api/project?project=${project}`)).json()) as { raw: string };
    expect(after.raw).toContain("RenamedOverHttp");
  });
});
