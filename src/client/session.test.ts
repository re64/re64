import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, RunningServer } from "../server/index.js";
import { SqliteStorage, importProject } from "../store/index.js";
import { describeOp } from "../core/index.js";
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
let databaseUnderTest: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "re64-ui-"));
  const projectPath = join(dir, "gridrunner.re64");
  copyFileSync("assets/gridrunner/gridrunner.re64", projectPath);
  copyFileSync("assets/gridrunner/gridrunner.prg", join(dir, "gridrunner.prg"));
  const { databasePath, projectId } = importProject(projectPath);

  server = startServer({ projectPath: databasePath, port: 0, host: "127.0.0.1", quiet: true });
  await server.ready;
  origin = `http://127.0.0.1:${server.port}`;
  project = projectId;
  databaseUnderTest = databasePath;
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
    expect(session.debug().blobs.map((b) => b.path)).toEqual([session.loaded.project.files?.find(f => f.id === session.loaded.project.layers.find(l => l.file)?.file)?.hash]);
    session.close();
  });

  it("reports itself connected", async () => {
    const session = await open();
    expect(session.debug().status).toBe("connected");
    session.close();
  });
});

describe("choosing which target to read", () => {
  /**
   * The last surface to learn targets exist. On a project built by running a
   * loader — which is every packed game — the disassembly worth reading is in
   * the runtime target, so without this a person watching agents work could not
   * see what they were working on.
   *
   * Its own server on its own fixture, because the shared one is Gridrunner:
   * one file, no targets, which is the case the control hides itself for and is
   * asserted as such below.
   */
  let two: RunningServer;
  let twoOrigin: string;
  let twoProject: string;
  let twoDir: string;

  beforeEach(async () => {
    twoDir = mkdtempSync(join(tmpdir(), "re64-targets-"));
    const path = join(twoDir, "two.re64");
    copyFileSync("assets/gridrunner/gridrunner.prg", join(twoDir, "gridrunner.prg"));

    const project = JSON.parse(readFileSync("assets/gridrunner/gridrunner.re64", "utf8"));
    // Linked by layer **id**, which is the only handle a target has — a path or
    // a name reaches nothing, and a target that links nothing supplies nothing.
    const prg = project.layers.find((l: { type: string }) => l.type === "prg");
    project.targets = [
      { name: "program", order: 1, description: "The game", layers: [prg.id] },
      { name: "empty", order: 2, description: "Nothing at all", layers: [] },
    ];
    project.defaultTarget = "program";
    writeFileSync(path, JSON.stringify(project, null, 2));

    const { databasePath, projectId } = importProject(path);
    two = startServer({ projectPath: databasePath, port: 0, host: "127.0.0.1", quiet: true });
    await two.ready;
    twoOrigin = `http://127.0.0.1:${two.port}`;
    twoProject = projectId;
  });

  afterEach(async () => {
    await two.close();
    rmSync(twoDir, { recursive: true, force: true });
  });

  const openTwo = () =>
    ProjectSession.open({ origin: twoOrigin, project: twoProject, author: "tester" });

  it("offers no choice on a project that declares one", async () => {
    // Gridrunner declares exactly one target — the one its entry-point list
    // was migrated into — which is the ordinary small project, and the case
    // the control hides itself for: one arrangement is not a choice.
    const session = await open();
    expect(session.targets().map((t) => t.name)).toEqual(["Gridrunner"]);
    session.close();
  });

  it("opens on the project's declared default", async () => {
    const session = await openTwo();
    expect(session.targets().map((t) => t.name)).toEqual(["program", "empty"]);
    expect(session.target).toBe("program");
    expect(session.targets().find((t) => t.isDefault)?.name).toBe("program");
    session.close();
  });

  it("narrows the model to the chosen target, and back", async () => {
    // Asserted on the bytes rather than on the layer list, because that is what
    // a target is *for*: which bytes you are reading. A target linking nothing
    // supplies nothing, and the cartridge at $8000 disappears.
    const session = await openTwo();
    expect(session.loaded.map.readByte(0x8000)).toBeDefined();

    session.selectTarget("empty");
    expect(session.target).toBe("empty");
    expect(session.loaded.map.readByte(0x8000)).toBeUndefined();

    session.selectTarget(undefined);
    expect(session.target).toBe("program");
    expect(session.loaded.map.readByte(0x8000)).toBeDefined();
    session.close();
  });

  it("writes nothing, because which view I am reading is a cursor", async () => {
    // The property that makes a split view possible and a shared selection
    // wrong: two panes over one document, neither moving the other.
    //
    // **`defaultTarget` used to be in the export**, described as what the
    // project opens with rather than what anybody is looking at. It is gone: the
    // field was read as a cursor by every call that named no view, so a document
    // property answered a question about the reader — and on a project declaring
    // five targets and no default, every such call was answered through
    // whichever one sorted first.
    const session = await openTwo();
    const before = session.exportedText();

    session.selectTarget("empty");
    expect(session.exportedText()).toBe(before);
    expect(JSON.parse(before).defaultTarget).toBeUndefined();
    session.close();
  });

  it("refuses a target that does not exist rather than falling back", async () => {
    const session = await openTwo();
    expect(() => session.selectTarget("nonesuch")).toThrow(/no target/);
    expect(session.target).toBe("program");
    session.close();
  });
});

describe("editing", () => {
  it("shows a rename without waiting for anything", async () => {
    const session = await open();
    session.addLabel(0x8100, "Renamed", undefined);
    await session.refresh();
    expect(labelAt(session, 0x8100)).toBe("Renamed");
    session.close();
  });

  it("removes a claim by id, which is the only thing that names one", async () => {
    const session = await open();
    const claim = session.claimsAt(0x8100).find((c) => c.origin === "user")!;
    expect(claim).toBeDefined();

    session.removeClaim(claim.id);
    await session.refresh();
    expect(labelAt(session, 0x8100)).not.toBe("InitializeGame");
    session.close();
  });
});

describe("undo", () => {
  it("takes back the last edit and says what it took", async () => {
    const session = await open();
    session.addLabel(0x8100, "Renamed", undefined);
    await session.refresh();

    expect(session.undo()).toContain("Renamed");
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
    session.addLabel(0x8100, "Renamed", undefined);
    await session.refresh();
    session.undo();
    await session.refresh();

    expect(session.redo()).toContain("Renamed");
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

    a.addLabel(0x8100, "FromA", undefined);
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

    a.addLabel(0x8100, "FromA", undefined);
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

    a.addLabel(0x8100, "FromA", undefined);
    b.addLabel(0x81a2, "FromB", undefined);
    await settle();
    await a.refresh();

    expect(labelAt(a, 0x8100)).toBe("FromA");
    expect(labelAt(a, 0x81a2)).toBe("FromB");
    a.close();
    b.close();
  });
});

describe("what the record says afterwards", () => {
  it("attributes an edit made over the socket, which used to leave no trace", async () => {
    // Only server-side edits were ever recorded. A browser could name a hundred
    // labels and the history would know a session happened and nothing else.
    const session = await open();
    session.addLabel(0x8100, "ByAParticipant", undefined);
    await settle();

    const storage = new SqliteStorage(databaseUnderTest, project);
    const recorded = storage.readOps();
    storage.close();

    expect(recorded.length).toBeGreaterThan(0);
    expect(recorded.at(-1)).toMatchObject({ author: "tester" });
    expect(describeOp(recorded.at(-1)!.op)).toContain("ByAParticipant");
    session.close();
  });

  it("records an inverse, so the edit can be taken back", async () => {
    const session = await open();
    session.addLabel(0x8100, "Reversible", undefined);
    await settle();

    const storage = new SqliteStorage(databaseUnderTest, project);
    const recorded = storage.readOps().at(-1)!;
    storage.close();

    // `claim.remove`, and the kind is worth asserting rather than merely
    // checking an inverse exists: it was `claim.set` while the browser named an
    // address by upsert, which meant naming $8100 — where a label already sits —
    // silently *renamed* somebody's claim. Naming adds now, so taking it back is
    // a removal. If this ever reads `claim.set` again the upsert is back.
    expect(recorded.inverse).toMatchObject({ op: "claim.remove" });
    session.close();
  });

  it("hands out stable positions, so a reader can ask what it has missed", async () => {
    const session = await open();
    session.addLabel(0x8100, "First", undefined);
    await settle();

    const storage = new SqliteStorage(databaseUnderTest, project);
    const cursor = storage.readOps().at(-1)!.seq;

    session.addLabel(0x81a2, "Second", "function");
    await settle();

    const since = storage.readOps(cursor);
    storage.close();

    expect(since).toHaveLength(1);
    expect(describeOp(since[0].op)).toContain("Second");
    session.close();
  });
});

describe("as a headless participant", () => {
  it("keeps the model current without being asked", async () => {
    // What separates this from the CLI: an agent holding a session sees what
    // other people do, rather than re-reading on a hunch.
    const a = await open();
    const b = await open();

    a.addLabel(0x8100, "FromA", undefined);
    await b.settled();

    expect(labelAt(b, 0x8100)).toBe("FromA");
    a.close();
    b.close();
  });

  it("says when it has caught up", async () => {
    const a = await open();
    const b = await open();

    a.addLabel(0x8100, "One", undefined);
    a.addLabel(0x81a2, "Two", "function");
    await b.settled();

    expect(labelAt(b, 0x8100)).toBe("One");
    expect(labelAt(b, 0x81a2)).toBe("Two");
    a.close();
    b.close();
  });

  it("notifies after the model is rebuilt, not merely when the document moved", async () => {
    // A listener firing on the raw update would read the previous
    // disassembly, which is the whole reason to have this seam.
    const a = await open();
    const b = await open();

    const seen: (string | undefined)[] = [];
    b.onChange(() => seen.push(labelAt(b, 0x8100)));

    a.addLabel(0x8100, "Observed", undefined);
    await b.settled();

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)).toBe("Observed");
    a.close();
    b.close();
  });

  it("counts what it has seen", async () => {
    const a = await open();
    const b = await open();
    expect(b.debug().changes).toBe(0);

    a.addLabel(0x8100, "Counted", undefined);
    await b.settled();

    expect(b.debug().changes).toBeGreaterThan(0);
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
    session.addLabel(0x8100, "Renamed", undefined);
    await session.refresh();
    expect(session.exportedText()).toContain("Renamed");
    session.close();
  });
});

const settle = () => new Promise((r) => setTimeout(r, 250));

describe("talking about the work", () => {
  it("reaches the other session", async () => {
    const a = await open();
    const b = await open();

    a.postChat("usr_you", "marcus", "$8000 is a cartridge header, not code");
    await b.settled();

    expect(b.chat().map((m) => m.text)).toEqual(["$8000 is a cartridge header, not code"]);
    expect(b.chat()[0]).toMatchObject({ author: "usr_you", name: "marcus" });
  });

  it("does not rebuild the model, which would re-analyse the program per message", () => {
    // The whole reason chat lives at its own root. A message is a document
    // change the projection cannot see, so the session must not treat it as one
    // — unhandled, every line of conversation costs a full re-derivation and, in
    // the browser, a repaint.
    return (async () => {
      const a = await open();
      const b = await open();

      let rebuilds = 0;
      b.onChange(() => rebuilds++);

      for (let i = 0; i < 5; i++) a.postChat("usr_you", "marcus", `message ${i}`);
      await b.settled();

      expect(b.chat()).toHaveLength(5);
      expect(rebuilds).toBe(0);
    })();
  });

  it("is not undoable, because unsaying a thing is not an edit", async () => {
    const a = await open();
    a.postChat("usr_you", "marcus", "said out loud");
    await a.settled();

    expect(a.debug().undo.canUndo).toBe(false);
    expect(a.chat()).toHaveLength(1);
  });
});
