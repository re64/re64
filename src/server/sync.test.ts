import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, Server } from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebsocketProvider } from "y-websocket";
import { WebSocket } from "ws";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
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
      "length": 16
    }
  ],
  "claims": [
    { "id": "lbl_1", "at": "$8000", "name": "Start", "origin": "user" },
    { "id": "lbl_2", "at": "$8004", "name": "Loop", "origin": "user" }
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
let refused: { user: string; session?: string; reason: string }[];

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
  refused = [];
  sync = new SyncServer({ store, idleMs: 50, writeMs: 20, onRefused: (r) => refused.push(r) });
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

    applyOpToDoc(alice.doc, { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "MainLoop", origin: "user" } });
    await settle();

    const seen = projectFromDoc(bob.doc).claims!.find((l) => l.id === "lbl_2");
    expect(seen?.name).toBe("MainLoop");

    await alice.close();
    await bob.close();
  });

  it("merges edits made at the same time", async () => {
    const alice = await Client.connect(url(), "alice");
    const bob = await Client.connect(url(), "bob");
    await settle();

    applyOpToDoc(alice.doc, { op: "claim.add", claim: { id: "lbl_1", at: 0x8000, name: "Begin", origin: "user" } });
    applyOpToDoc(bob.doc, { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Repeat", origin: "user" } });
    await settle();

    for (const doc of [alice.doc, bob.doc]) {
      const names = projectFromDoc(doc).claims!.map((l) => l.name);
      expect(names).toEqual(["Begin", "Repeat"]);
    }

    await alice.close();
    await bob.close();
  });

  it("records one history entry naming everyone who took part", async () => {
    const alice = await Client.connect(url(), "alice");
    const bob = await Client.connect(url(), "bob");
    await settle();

    applyOpToDoc(alice.doc, { op: "claim.add", claim: { id: "lbl_1", at: 0x8000, name: "Begin", origin: "user" } });
    applyOpToDoc(bob.doc, { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Repeat", origin: "user" } });
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

    applyOpToDoc(alice.doc, { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Rescued", origin: "user" } });
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

    applyOpToDoc(alice.doc, { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Live", origin: "user" } });
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
      applyOpToDoc(alice.doc, { op: "claim.set", id: "lbl_2", fields: { name } });
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
      applyOpToDoc(alice.doc, { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: `Rapid${i}`, origin: "user" } });
    }
    await new Promise((r) => setTimeout(r, 120));

    expect(currentText()).toContain(`"name": "Rapid9"`);

    await alice.close();
  });
});

/**
 * A peer speaking raw frames — the thing a stock client never sends, which is
 * exactly what the receiver has to survive.
 */
async function rawPeer(author: string): Promise<{
  send(frame: Uint8Array): void;
  closed: Promise<{ code: number; reason: string }>;
}> {
  const socket = new WebSocket(`${url()}?author=${author}`);
  socket.binaryType = "arraybuffer";
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() }))
  );
  return { send: (frame) => socket.send(frame), closed };
}

/** A sync-update frame carrying these bytes as the update. */
function updateFrame(update: Uint8Array): Uint8Array {
  const frame = encoding.createEncoder();
  encoding.writeVarUint(frame, 0); // MESSAGE_SYNC
  syncProtocol.writeUpdate(frame, update);
  return encoding.toUint8Array(frame);
}

describe("what a peer sends is checked before it becomes the document", () => {
  /**
   * Who may connect is deliberately unsettled; what a connected peer may send
   * is a different question. The decode ran with no boundary and a well-formed
   * update went into the shared document unread, so one peer could throw the
   * process or leave the project unopenable for every other. Three failure
   * paths, none of which had a test: the process survives each, the document
   * does not move, the sender is told, and the other peer is unaffected.
   */
  const layersHeld = () => projectFromDoc(store.document()).layers.map((l) => l.id);

  const stillServing = async (bob: Client) => {
    applyOpToDoc(bob.doc, { op: "claim.add", claim: { id: "lbl_9", at: 0x8008, name: "After", origin: "user" } });
    await settle();
    expect(projectFromDoc(store.document()).claims!.some((c) => c.id === "lbl_9")).toBe(true);
  };

  it("refuses a truncated update, and says so", async () => {
    const bob = await Client.connect(url(), "bob");
    const mallory = await rawPeer("mallory");
    const whole = updateFrame(encodeDoc(docFromProject(parseProject(PROJECT))));
    mallory.send(whole.slice(0, Math.floor(whole.length / 2)));

    const closed = await mallory.closed;
    expect(closed.code).toBe(1008);
    expect(closed.reason).toMatch(/could not be decoded/);
    expect(refused).toEqual([{ user: "mallory", reason: expect.stringMatching(/could not be decoded/) }]);
    expect(layersHeld()).toEqual(["lay_a"]);
    await stillServing(bob);
    await bob.close();
  });

  it("refuses an envelope it cannot read past, rather than throwing out of the socket", async () => {
    const bob = await Client.connect(url(), "bob");
    const mallory = await rawPeer("mallory");
    // A sync step 1 whose state vector is cut off: `readSyncMessage` had no
    // boundary around this one at all.
    mallory.send(new Uint8Array([0, 0, 200, 200]));
    const closed = await mallory.closed;
    expect(closed.code).toBe(1008);
    expect(refused[0]?.reason).toMatch(/could not be decoded/);
    await stillServing(bob);
    await bob.close();
  });

  it("refuses an update from an incompatible schema", async () => {
    const bob = await Client.connect(url(), "bob");
    const mallory = await rawPeer("mallory");
    // A document whose `layers` holds a string where this schema reads a map:
    // it decodes, and it would leave the shared document with a root nothing
    // here can project.
    const other = emptyDoc();
    other.getArray("layers").push(["not a layer"]);
    mallory.send(updateFrame(encodeDoc(other)));

    const closed = await mallory.closed;
    expect(closed.code).toBe(1008);
    expect(closed.reason).toMatch(/unreadable/);
    expect(layersHeld()).toEqual(["lay_a"]);
    // And the document is still readable by the store itself.
    expect(() => projectFromDoc(store.document())).not.toThrow();
    await stillServing(bob);
    await bob.close();
  });

  it("refuses a well-formed update that projects to what the loader refuses", async () => {
    const bob = await Client.connect(url(), "bob");
    const alice = await Client.connect(url(), "alice");
    await settle();
    // A bytes layer with no bytes and no address: `parseProject` refuses the
    // file, and the document used to take it and become unopenable everywhere.
    applyOpToDoc(alice.doc, { op: "layer.add", id: "lay_bad", layerType: "bytes", name: "bad", index: 1 });
    await settle();

    expect(refused.map((r) => r.user)).toEqual(["alice"]);
    expect(refused[0].reason).toMatch(/unreadable.*requires a 'bytes' field/);
    expect(layersHeld()).toEqual(["lay_a"]);
    expect(currentText()).not.toContain("lay_bad");
    await stillServing(bob);
    // Alice still holds it, and no document here ever will.
    expect(projectFromDoc(alice.doc).layers.map((l) => l.id)).toContain("lay_bad");
    await alice.close();
    await bob.close();
  });
});
