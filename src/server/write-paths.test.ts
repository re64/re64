import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { copyFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebsocketProvider } from "y-websocket";
import { startServer, RunningServer } from "./index.js";
import { FileStorage, importProject, pathsFor } from "../store/index.js";
import {
  CrdtDoc,
  applyOpToDoc,
  applyUpdate,
  emptyDoc,
  encodeDoc,
  projectFromDoc,
} from "../core/crdt/index.js";
import { parseProject } from "../core/index.js";

/**
 * Two front doors, one write path.
 *
 * A socket client merges through the CRDT. An agent that would rather send
 * JSON goes through `PUT /api/project`, which is routed through the same
 * shared document as a synthetic client. If that routing were skipped, a PUT
 * would be a blind overwrite and would silently discard whatever a connected
 * session had merged in the meantime — which is the thing these tests exist to
 * prevent.
 */

const PROJECT = `{
  "layers": [
    {
      "id": "lay_a",
      "type": "bytes",
      "address": "$8000",
      "bytes": "ea",
      "length": 32,
      "labels": [
        { "id": "lbl_1", "address": "$8000", "name": "Start" },
        { "id": "lbl_2", "address": "$8004", "name": "Loop" }
      ]
    }
  ]
}
`;

let dir: string;
let projectPath: string;

/**
 * What is stored, read the way the store reads it.
 *
 * Not `readFileSync`: these assertions are about behaviour, not about the
 * project living in a file, and the backing store is being replaced.
 */
const currentText = () => new FileStorage(pathsFor(projectPath)).readText();
let server: RunningServer;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "re64-write-"));
  projectPath = join(dir, "test.re64");
  writeFileSync(projectPath, PROJECT, "utf-8");
  server = startServer({ projectPath, port: 0, host: "127.0.0.1", quiet: true });
  await server.ready;
});

afterEach(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

const base = () => `http://127.0.0.1:${server.port}`;
const settle = () => new Promise((r) => setTimeout(r, 80));

/** GET the project, typed. */
async function fetchProject(): Promise<{ raw: string; version: string }> {
  return (await fetch(`${base()}/api/project`)).json() as Promise<{ raw: string; version: string }>;
}

/** PUT a whole document, typed. */
async function putProject(raw: string, baseVersion?: string) {
  const response = await fetch(`${base()}/api/project`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raw, baseVersion }),
  });
  return { response, body: (await response.json()) as { ok?: boolean; error?: string; applied?: number; version?: string } };
}

/**
 * A participant, using the client the browser will use.
 *
 * Empty document plus the standard handshake — the same shape a real client
 * has, so these tests exercise the protocol rather than a stand-in for it.
 */
async function connect(author: string): Promise<{ doc: CrdtDoc; close(): Promise<void> }> {
  const doc = emptyDoc();
  const provider = new WebsocketProvider(`ws://127.0.0.1:${server.port}/sync`, "test", doc, {
    params: { author },
    disableBc: true,
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out syncing")), 5_000);
    provider.once("sync", () => {
      clearTimeout(timer);
      resolve();
    });
  });

  return {
    doc,
    close: async () => {
      provider.disconnect();
      provider.destroy();
    },
  };
}

describe("an HTTP write racing a live session", () => {
  it("refuses a stale whole-document write rather than overwriting", async () => {
    const { version } = await fetchProject();

    const alice = await connect("alice");
    await settle();
    applyOpToDoc(alice.doc, {
      op: "label.set", id: "lbl_1", layerId: "lay_a", address: 0x8000, name: "FromSocket",
    });
    await settle();

    // An agent sends the document as it looked before Alice's edit. It cannot
    // be merged: a whole document says "make it look like this", which would
    // revert lbl_1 without ever knowing it had changed. So it conflicts.
    const stale = PROJECT.replace(`"name": "Loop"`, `"name": "FromHttp"`);
    const { response, body } = await putProject(stale, version);

    expect(response.status).toBe(409);
    expect(body.error).toMatch(/someone else edited it/);
    // Alice's edit is intact in the shared document.
    expect(
      projectFromDoc(alice.doc).layers[0].labels!.find((l) => l.id === "lbl_1")!.name
    ).toBe("FromSocket");

    await alice.close();
  });

  it("accepts a write based on the current state and merges it in", async () => {
    const alice = await connect("alice");
    await settle();
    applyOpToDoc(alice.doc, {
      op: "label.set", id: "lbl_1", layerId: "lay_a", address: 0x8000, name: "FromSocket",
    });
    await settle();

    // Re-read: the version now reflects Alice's edit, not the file on disk.
    const { version } = await fetchProject();
    const current = PROJECT
      .replace(`"name": "Start"`, `"name": "FromSocket"`)
      .replace(`"name": "Loop"`, `"name": "FromHttp"`);

    const { response } = await putProject(current, version);
    expect(response.status).toBe(200);
    await settle();

    const onDisk = currentText();
    expect(onDisk).toContain(`"name": "FromSocket"`);
    expect(onDisk).toContain(`"name": "FromHttp"`);

    await alice.close();
  });

  it("versions the document, not the file, so a live session is visible", async () => {
    // The file does not change until a flatten, so a file hash would report
    // "unchanged" throughout a session and defeat the check entirely.
    const before = (await fetchProject()).version;

    const alice = await connect("alice");
    await settle();
    applyOpToDoc(alice.doc, {
      op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "Changed",
    });
    await settle();

    const after = (await fetchProject()).version;
    expect(after).not.toBe(before);
    expect(currentText()).toBe(PROJECT); // not flattened yet

    await alice.close();
  });

  it("reaches the connected session, so it is not left stale", async () => {
    const alice = await connect("alice");
    await settle();

    await fetch(`${base()}/api/project`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ raw: PROJECT.replace(`"name": "Loop"`, `"name": "PushedIn"`) }),
    });
    await settle();

    const seen = projectFromDoc(alice.doc).layers[0].labels!.find((l) => l.id === "lbl_2");
    expect(seen?.name).toBe("PushedIn");

    await alice.close();
  });

  it("reports how many operations a write turned into", async () => {
    const { body } = await putProject(PROJECT.replace(`"name": "Loop"`, `"name": "One"`));
    expect(body).toMatchObject({ ok: true, applied: 1 });
  });

  it("is a no-op when the content is unchanged", async () => {
    const { body } = await putProject(PROJECT);
    expect(body).toMatchObject({ applied: 0 });
    expect(currentText()).toBe(PROJECT);
  });
});

describe("three clients over sockets", () => {
  it("converges and records every author", async () => {
    const [a, b, c] = await Promise.all([connect("alice"), connect("bob"), connect("agent-1")]);
    await settle();

    applyOpToDoc(a.doc, {
      op: "label.set", id: "lbl_1", layerId: "lay_a", address: 0x8000, name: "A",
    });
    applyOpToDoc(b.doc, {
      op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "B",
    });
    applyOpToDoc(c.doc, {
      op: "label.set", id: "lbl_3", layerId: "lay_a", address: 0x8008, name: "C",
    });
    await settle();

    for (const client of [a, b, c]) {
      const names = projectFromDoc(client.doc).layers[0].labels!.map((l) => l.name);
      expect(names).toEqual(["A", "B", "C"]);
    }

    await Promise.all([a.close(), b.close(), c.close()]);
  });
});

describe("a socket asking for something that is not here", () => {
  it("closes that socket instead of the server", async () => {
    // A browser tab left open on a previous project reconnects to the next
    // server started on that port. The unknown room threw out of the upgrade
    // handler, which is not inside any request, so it took the process down
    // before anyone connected on purpose.
    const dir = mkdtempSync(join(tmpdir(), "re64-unknown-room-"));
    copyFileSync("assets/gridrunner/gridrunner.re64", join(dir, "gridrunner.re64"));
    copyFileSync("assets/gridrunner/gridrunner.prg", join(dir, "gridrunner.prg"));
    const { databasePath } = importProject(join(dir, "gridrunner.re64"));

    const server = startServer({
      projectPath: databasePath,
      port: 0,
      host: "127.0.0.1",
      quiet: true,
    });
    await server.ready;

    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/sync/no-such-project`);
    await new Promise((resolve) => {
      socket.addEventListener("close", resolve);
      socket.addEventListener("error", resolve);
    });

    // Still serving.
    const res = await fetch(`http://127.0.0.1:${server.port}/api/projects`);
    expect(res.ok).toBe(true);

    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
