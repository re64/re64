import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, Server } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { ProjectSessionStore, pathsFor } from "./session-store.js";
import { SyncServer } from "./sync.js";
import {
  CrdtDoc,
  applyOpToDoc,
  applyUpdate,
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
let http: Server;
let sync: SyncServer;
let store: ProjectSessionStore;
let port: number;

/** A client that mirrors the server's document over a socket. */
class Client {
  readonly doc: CrdtDoc;
  private constructor(private readonly socket: WebSocket, doc: CrdtDoc) {
    this.doc = doc;
  }

  static connect(url: string): Promise<Client> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const doc = docFromProject(parseProject(PROJECT));
      const client = new Client(socket, doc);

      socket.on("message", (data: Buffer) => {
        applyUpdate(doc, new Uint8Array(data.subarray(1)), "remote");
      });
      socket.on("open", () => {
        doc.clientID = Math.floor(Math.random() * 1e6) + 1;
        // Announce what we have; anything the server lacks flows from here.
        socket.send(Buffer.concat([Buffer.from([0]), Buffer.from(encodeDoc(doc))]));
        doc.on("update", (update: Uint8Array, origin: unknown) => {
          if (origin === "remote") return;
          socket.send(Buffer.concat([Buffer.from([1]), Buffer.from(update)]));
        });
        resolve(client);
      });
      socket.on("error", reject);
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.socket.on("close", () => resolve());
      this.socket.close();
    });
  }
}

const settle = () => new Promise((r) => setTimeout(r, 60));

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "re64-sync-"));
  projectPath = join(dir, "test.re64");
  writeFileSync(projectPath, PROJECT, "utf-8");

  store = new ProjectSessionStore(pathsFor(projectPath));
  sync = new SyncServer({ store, idleMs: 50 });
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

const url = (author: string) => `ws://127.0.0.1:${port}/sync?author=${author}`;

describe("two participants on one project", () => {
  it("carries an edit from one to the other", async () => {
    const alice = await Client.connect(url("alice"));
    const bob = await Client.connect(url("bob"));
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
    const alice = await Client.connect(url("alice"));
    const bob = await Client.connect(url("bob"));
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
    const alice = await Client.connect(url("alice"));
    const bob = await Client.connect(url("bob"));
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

    const file = readFileSync(projectPath, "utf-8");
    expect(file).toContain(`"name": "Begin"`);
    expect(file).toContain(`"name": "Repeat"`);
  });

  it("loses nothing when a participant vanishes without warning", async () => {
    // A closed tab or a killed agent: the update log has already recorded it.
    const alice = await Client.connect(url("alice"));
    await settle();

    applyOpToDoc(alice.doc, {
      op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "Rescued",
    });
    await settle();

    await alice.close();
    await new Promise((r) => setTimeout(r, 150));

    expect(readFileSync(projectPath, "utf-8")).toContain(`"name": "Rescued"`);
  });

  it("leaves the file untouched when nobody edits", async () => {
    const alice = await Client.connect(url("alice"));
    await settle();
    await alice.close();
    await new Promise((r) => setTimeout(r, 150));

    expect(readFileSync(projectPath, "utf-8")).toBe(PROJECT);
    expect(store.history()).toEqual([]);
  });
});
