import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, Server } from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebsocketProvider } from "y-websocket";
import { FileStorage, ProjectStore, pathsFor } from "../store/index.js";
import { SyncServer } from "./sync.js";
import {
  CrdtDoc,
  applyOpToDoc,
  emptyDoc,
  docFromProject,
  encodeDoc,
  projectFromDoc,
} from "../core/crdt/index.js";
import { parseProject } from "../core/index.js";

const PROJECT = `{
  "layers": [
    {
      "id": "lay_a",
      "type": "bytes",
      "address": "$8000",
      "bytes": "ea",
      "length": 16,
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
let http: Server;
let sync: SyncServer;
let store: ProjectStore;
let port: number;

/**
 * A participant, using the client the browser will use.
 *
 * A real `WebsocketProvider` rather than a hand-written stand-in: a stand-in
 * would only prove the server agrees with itself, and the thing worth knowing
 * is that a stock Yjs client interoperates. It also starts from an **empty**
 * document, which is how a participant is supposed to join — building a base
 * locally from text both sides are assumed to share is the hazard, not the
 * baseline.
 */
class Client {
  private constructor(
    readonly doc: CrdtDoc,
    private readonly provider: WebsocketProvider
  ) {}

  static async connect(url: string, author = "anonymous"): Promise<Client> {
    const doc = emptyDoc();
    const provider = new WebsocketProvider(url, "test", doc, {
      params: { author },
      // BroadcastChannel would sync two clients in one process directly,
      // bypassing the server — which would make a broken server look fine.
      disableBc: true,
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out syncing")), 5_000);
      provider.once("sync", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    return new Client(doc, provider);
  }

  async close(): Promise<void> {
    this.provider.disconnect();
    this.provider.destroy();
  }
}

const settle = () => new Promise((r) => setTimeout(r, 120));

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "re64-sync-"));
  projectPath = join(dir, "test.re64");
  writeFileSync(projectPath, PROJECT, "utf-8");

  store = new ProjectStore(new FileStorage(pathsFor(projectPath)));
  sync = new SyncServer({ store, idleMs: 50, writeMs: 20 });
  http = createServer();
  http.on("upgrade", (req, socket, head) => sync.handleUpgrade(req, socket, head));

  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  port = (http.address() as { port: number }).port;
});

afterEach(async () => {
  sync.close();
  await new Promise<void>((resolve) => http.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

const url = () => `ws://127.0.0.1:${port}/sync`;

describe("two participants on one project", () => {
  it("carries an edit from one to the other", async () => {
    const alice = await Client.connect(url(), "alice");
    const bob = await Client.connect(url(), "bob");
    await settle();

    applyOpToDoc(alice.doc, {
      op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "MainLoop",
    });
    await settle();

    const seen = projectFromDoc(bob.doc).layers[0].labels!.find((l) => l.id === "lbl_2");
    expect(seen?.name).toBe("MainLoop");

    await alice.close();
    await bob.close();
  });

  it("merges edits made at the same time", async () => {
    const alice = await Client.connect(url(), "alice");
    const bob = await Client.connect(url(), "bob");
    await settle();

    applyOpToDoc(alice.doc, {
      op: "label.set", id: "lbl_1", layerId: "lay_a", address: 0x8000, name: "Begin",
    });
    applyOpToDoc(bob.doc, {
      op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "Repeat",
    });
    await settle();

    for (const doc of [alice.doc, bob.doc]) {
      const names = projectFromDoc(doc).layers[0].labels!.map((l) => l.name);
      expect(names).toEqual(["Begin", "Repeat"]);
    }

    await alice.close();
    await bob.close();
  });

  it("records one history entry naming everyone who took part", async () => {
    const alice = await Client.connect(url(), "alice");
    const bob = await Client.connect(url(), "bob");
    await settle();

    applyOpToDoc(alice.doc, {
      op: "label.set", id: "lbl_1", layerId: "lay_a", address: 0x8000, name: "Begin",
    });
    applyOpToDoc(bob.doc, {
      op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "Repeat",
    });
    await settle();

    await alice.close();
    await bob.close();
    // Both gone: the idle timer flattens what they agreed on.
    await new Promise((r) => setTimeout(r, 150));

    const history = store.history();
    expect(history).toHaveLength(1);
    expect(history[0].authors).toEqual(["alice", "bob"]);
    expect(history[0].summary).toHaveLength(2);

    const file = currentText();
    expect(file).toContain(`"name": "Begin"`);
    expect(file).toContain(`"name": "Repeat"`);
  });

  it("loses nothing when a participant vanishes without warning", async () => {
    // A closed tab or a killed agent: the update log has already recorded it.
    const alice = await Client.connect(url(), "alice");
    await settle();

    applyOpToDoc(alice.doc, {
      op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "Rescued",
    });
    await settle();

    await alice.close();
    await new Promise((r) => setTimeout(r, 150));

    expect(currentText()).toContain(`"name": "Rescued"`);
  });

  it("leaves the file untouched when nobody edits", async () => {
    const alice = await Client.connect(url(), "alice");
    await settle();
    await alice.close();
    await new Promise((r) => setTimeout(r, 150));

    expect(currentText()).toBe(PROJECT);
    expect(store.history()).toEqual([]);
  });
});

describe("keeping the file current during a session", () => {
  it("writes edits to disk without waiting for the session to end", async () => {
    // Without this the file sits stale for as long as anyone stays connected:
    // git shows nothing, the CLI reads old content, and an editor open on the
    // same file never sees the work.
    const alice = await Client.connect(url(), "alice");
    await settle();

    applyOpToDoc(alice.doc, {
      op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "Live",
    });
    await new Promise((r) => setTimeout(r, 120));

    expect(currentText()).toContain(`"name": "Live"`);
    // Still mid-session, so nothing has been recorded as history yet.
    expect(store.history()).toEqual([]);

    await alice.close();
  });

  it("records history only when the session ends, not on every write", async () => {
    const alice = await Client.connect(url(), "alice");
    await settle();

    for (const name of ["One", "Two", "Three"]) {
      applyOpToDoc(alice.doc, {
        op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name,
      });
      await new Promise((r) => setTimeout(r, 60));
    }

    expect(currentText()).toContain(`"name": "Three"`);
    expect(store.history()).toEqual([]);

    await alice.close();
    await new Promise((r) => setTimeout(r, 150));

    expect(store.history()).toHaveLength(1);
  });

  it("coalesces a burst of edits into one write", async () => {
    const alice = await Client.connect(url(), "alice");
    await settle();

    for (let i = 0; i < 10; i++) {
      applyOpToDoc(alice.doc, {
        op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: `Rapid${i}`,
      });
    }
    await new Promise((r) => setTimeout(r, 120));

    expect(currentText()).toContain(`"name": "Rapid9"`);

    await alice.close();
  });
});
