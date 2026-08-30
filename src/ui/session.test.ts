import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, RunningServer } from "../server/index.js";
import { importProject } from "../store/index.js";
import { ProjectSession } from "./session.js";

/**
 * The browser's half of the system, against a real server.
 *
 * Previously this stubbed the network and drove a text buffer. It cannot any
 * more, and should not: the document arrives over a socket and the thing worth
 * testing is that it does. These are the tests that would have caught the
 * browser never being wired to the sync endpoint at all.
 */

let dir: string;
let server: RunningServer;
let origin: string;
let project: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "re64-ui-"));
  const projectPath = join(dir, "gridrunner.re64");
  copyFileSync("assets/gridrunner.re64", projectPath);
  copyFileSync("assets/gridrunner.prg", join(dir, "gridrunner.prg"));
  const { databasePath, projectId } = importProject(projectPath);

  server = startServer({ projectPath: databasePath, port: 0, host: "127.0.0.1", quiet: true });
  await server.ready;
  origin = `http://127.0.0.1:${server.port}`;
  project = projectId;
});

afterEach(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

const open = () => ProjectSession.open({ origin, project, author: "tester" });
const labelAt = (s: ProjectSession, address: number) =>
  s.loaded.map.getLabels().getLabelsAt(address)[0]?.name;

describe("joining a project", () => {
  it("arrives with the document and analyses it", async () => {
    const session = await open();
    expect(session.loaded.project.layers.length).toBeGreaterThan(0);
    expect(labelAt(session, 0x8100)).toBe("InitializeGame");
    session.close();
  });

  it("fetches the binaries the document turned out to need", async () => {
    // The order is the opposite of what it was: the browser cannot know which
    // files a project references until the document has arrived.
    const session = await open();
    expect(session.debug().blobs.map((b) => b.path)).toEqual(["gridrunner.prg"]);
    session.close();
  });

  it("reports itself connected", async () => {
    const session = await open();
    expect(session.debug().status).toBe("connected");
    session.close();
  });
});

describe("editing", () => {
  it("shows a rename without waiting for anything", async () => {
    const session = await open();
    session.setLabel(0x8100, "Renamed", undefined);
    await session.refresh();
    expect(labelAt(session, 0x8100)).toBe("Renamed");
    session.close();
  });

  it("removes a label", async () => {
    const session = await open();
    session.removeLabel(0x8100);
    await session.refresh();
    expect(labelAt(session, 0x8100)).not.toBe("InitializeGame");
    session.close();
  });
});

describe("undo", () => {
  it("takes back the last edit and says what it took", async () => {
    const session = await open();
    session.setLabel(0x8100, "Renamed", undefined);
    await session.refresh();

    expect(session.undo()).toContain("$8100");
    await session.refresh();
    expect(labelAt(session, 0x8100)).toBe("InitializeGame");
    session.close();
  });

  it("reports there is nothing to take back", async () => {
    const session = await open();
    expect(session.undoDescription()).toBeUndefined();
    expect(session.undo()).toBeUndefined();
    session.close();
  });

  it("redoes what it undid, and stops", async () => {
    const session = await open();
    session.setLabel(0x8100, "Renamed", undefined);
    await session.refresh();
    session.undo();
    await session.refresh();

    expect(session.redo()).toContain("$8100");
    await session.refresh();
    expect(labelAt(session, 0x8100)).toBe("Renamed");
    expect(session.redo()).toBeUndefined();
    session.close();
  });
});

describe("two sessions, as two tabs would be", () => {
  it("each sees the other's edits", async () => {
    const a = await open();
    const b = await open();

    a.setLabel(0x8100, "FromA", undefined);
    await settle();
    await b.refresh();

    expect(labelAt(b, 0x8100)).toBe("FromA");
    a.close();
    b.close();
  });

  it("are separate peers with separate undo, even as the same person", async () => {
    // Two tabs are two client ids. Neither may take back the other's work,
    // which is why undo is scoped to the session and not to whoever is there.
    const a = await open();
    const b = await open();

    a.setLabel(0x8100, "FromA", undefined);
    await settle();
    await b.refresh();

    expect(b.undoDescription()).toBeUndefined();
    expect(b.undo()).toBeUndefined();

    await settle();
    await b.refresh();
    expect(labelAt(b, 0x8100)).toBe("FromA");
    a.close();
    b.close();
  });

  it("merges edits made at the same time", async () => {
    const a = await open();
    const b = await open();

    a.setLabel(0x8100, "FromA", undefined);
    b.setLabel(0x81a2, "FromB", undefined);
    await settle();
    await a.refresh();

    expect(labelAt(a, 0x8100)).toBe("FromA");
    expect(labelAt(a, 0x81a2)).toBe("FromB");
    a.close();
    b.close();
  });
});

describe("presence", () => {
  it("shows nobody until someone says who they are", async () => {
    const session = await open();
    expect(session.participants()).toEqual([]);
    session.close();
  });

  it("shows the other participants, and marks which one is you", async () => {
    const a = await open();
    const b = await open();
    a.announce({ name: "alice", colour: "#f00" });
    b.announce({ name: "bob", colour: "#0f0" });
    await settle();

    const seenByA = a.participants();
    expect(seenByA.map((p) => p.name).sort()).toEqual(["alice", "bob"]);
    expect(seenByA.filter((p) => p.isMe).map((p) => p.name)).toEqual(["alice"]);
    a.close();
    b.close();
  });

  it("forgets someone who leaves", async () => {
    const a = await open();
    const b = await open();
    a.announce({ name: "alice", colour: "#f00" });
    b.announce({ name: "bob", colour: "#0f0" });
    await settle();
    expect(a.participants()).toHaveLength(2);

    b.close();
    await settle();
    expect(a.participants().map((p) => p.name)).toEqual(["alice"]);
    a.close();
  });
});

describe("the exported view", () => {
  it("shows what would be written out", async () => {
    const session = await open();
    const text = session.exportedText();
    expect(JSON.parse(text).layers).toBeInstanceOf(Array);
    expect(text).toContain("InitializeGame");
    session.close();
  });

  it("follows an edit", async () => {
    const session = await open();
    session.setLabel(0x8100, "Renamed", undefined);
    await session.refresh();
    expect(session.exportedText()).toContain("Renamed");
    session.close();
  });
});

const settle = () => new Promise((r) => setTimeout(r, 250));
