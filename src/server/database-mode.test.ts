import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  copyFileSync("assets/gridrunner/gridrunner.re64", projectPath);
  copyFileSync("assets/gridrunner/gridrunner.prg", join(dir, "gridrunner.prg"));

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

  it("makes a client revalidate, because a name can be pointed at other bytes", async () => {
    // **This asserted `immutable`**, on the ground that a name maps to bytes
    // that cannot change under it. They can: uploading over a name repoints it,
    // and undoing the record of one repoints it back. A year-long `immutable`
    // on a mutable URL leaves every browser that fetched it holding the old
    // content with no reason to ask again.
    const res = await fetch(`${base}/api/blob?path=gridrunner.prg&project=${project}`);
    expect(res.headers.get("cache-control")).toContain("must-revalidate");
    expect(res.headers.get("cache-control")).not.toContain("immutable");
    // The tag is the content hash, so revalidating is cheap when nothing moved
    // and correct when something did — right by construction rather than by
    // remembering to update it.
    expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]{64}"$/);
  });

  it("answers a matching If-None-Match with 304, which is what the tag promises", async () => {
    // Advertising revalidation and never honouring it is worse than not offering
    // it: the client pays the round trip and gets the whole body back anyway.
    // A disk image is 174KB and the browser fetches it on every load.
    const first = await fetch(`${base}/api/blob?path=gridrunner.prg&project=${project}`);
    const etag = first.headers.get("etag")!;

    const again = await fetch(`${base}/api/blob?path=gridrunner.prg&project=${project}`, {
      headers: { "if-none-match": etag },
    });
    expect(again.status).toBe(304);
    expect((await again.arrayBuffer()).byteLength).toBe(0);

    // A tag that does not match still gets the bytes.
    const stale = await fetch(`${base}/api/blob?path=gridrunner.prg&project=${project}`, {
      headers: { "if-none-match": '"not-this-one"' },
    });
    expect(stale.status).toBe(200);
    expect((await stale.arrayBuffer()).byteLength).toBe(4098);
  });

  it("resolves a recorded name however the URL spells it", async () => {
    // `storage.blob` normalises the name and the document lookup did not, so
    // `./gridrunner.prg` walked past the record and read the name table — the
    // bypass this change closes, open again under a different spelling.
    const storage = new SqliteStorage(databaseUnderTest, project);
    try {
      const before = await fetch(`${base}/api/blob?path=gridrunner.prg&project=${project}`);
      storage.putBlob("gridrunner.prg", new Uint8Array([1, 2, 3, 4]));
      const spelled = await fetch(`${base}/api/blob?path=${encodeURIComponent("./gridrunner.prg")}&project=${project}`);
      expect(spelled.status).toBe(200);
      expect((await spelled.arrayBuffer()).byteLength).toBe(4098);
      expect(spelled.headers.get("etag")).toBe(before.headers.get("etag"));
    } finally {
      storage.close();
    }
  });

  it("serves the bytes the document names, not the ones a name was last pointed at", async () => {
    // **The route read the mutable name table directly.** So an upload over an
    // existing name served the replacement immediately, while the document still
    // named the old hash and every other reader still got the old bytes — the
    // defect this change is about, left in the one place a browser fetches from.
    //
    // The window is real rather than theoretical: storing the blob and recording
    // `file.add` are two steps, and this is between them.
    const storage = new SqliteStorage(databaseUnderTest, project);
    try {
      const before = await fetch(`${base}/api/blob?path=gridrunner.prg&project=${project}`);
      const original = new Uint8Array(await before.arrayBuffer());

      // Stored under the same name, and not recorded in the document.
      storage.putBlob("gridrunner.prg", new Uint8Array([1, 2, 3, 4]));

      const after = await fetch(`${base}/api/blob?path=gridrunner.prg&project=${project}`);
      const served = new Uint8Array(await after.arrayBuffer());
      expect(served.length).toBe(original.length);
      expect(after.headers.get("etag")).toBe(before.headers.get("etag"));
    } finally {
      storage.close();
    }
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
        { op: "claim.add", claim: { id: prg.labels[0].id, at: 0x8100, name: "AttributedToMe", origin: "user" } },
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

describe("a recorded file whose bytes are not held", () => {
  /**
   * The route fell past the record to the name table, served whatever sat
   * there, and labelled it with the recorded hash — so a client got a 304 for
   * bytes nobody ever recorded. The loader had refused the same read. A
   * recorded name with no bytes is missing content and is said as such.
   */
  it("is a missing-content error, not the name table's bytes under a false tag", async () => {
    const own = mkdtempSync(join(tmpdir(), "re64-stale-record-"));
    const projectPath = join(own, "gridrunner.re64");
    const text = JSON.parse(readFileSync("assets/gridrunner/gridrunner.re64", "utf-8")) as {
      files?: unknown[];
    };
    // Recorded as an earlier version of the file than the one on disk.
    text.files = [{ name: "gridrunner.prg", hash: "0".repeat(64), size: 4098 }];
    writeFileSync(projectPath, JSON.stringify(text), "utf-8");
    copyFileSync("assets/gridrunner/gridrunner.prg", join(own, "gridrunner.prg"));
    const { databasePath, projectId } = importProject(projectPath);

    const stale = startServer({ projectPath: databasePath, port: 0, host: "127.0.0.1", quiet: true });
    await stale.ready;
    try {
      const res = await fetch(`http://127.0.0.1:${stale.port}/api/blob?path=gridrunner.prg&project=${projectId}`);
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: string }).error).toMatch(/recorded as 0{64}/);
    } finally {
      await stale.close();
      rmSync(own, { recursive: true, force: true });
    }
  });
});
