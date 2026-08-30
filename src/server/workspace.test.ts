import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Caller, Workspace } from "./workspace.js";
import { ProjectStore, SqliteStorage, importProject } from "../store/index.js";

/**
 * Everything an agent can ask or do, without a protocol in the way.
 *
 * The transport above this should be schemas and shapes only, so this is where
 * the behaviour is pinned.
 */

let dir: string;
let workspace: Workspace;
let storage: SqliteStorage;

const agent: Caller = { userId: "usr_agent", label: "agent" };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "re64-workspace-"));
  const projectPath = join(dir, "gridrunner.re64");
  copyFileSync("assets/gridrunner.re64", projectPath);
  copyFileSync("assets/gridrunner.prg", join(dir, "gridrunner.prg"));
  const { databasePath, projectId } = importProject(projectPath);

  storage = new SqliteStorage(databasePath, projectId);
  workspace = new Workspace({
    store: new ProjectStore(storage),
    storage,
    projectId,
    projectPath: databasePath,
  });
});

afterEach(() => {
  for (const extra of extras) extra.close();
  extras.length = 0;
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

const extras: SqliteStorage[] = [];

/** A project holding the bytes and nothing else, as experiment 1 starts. */
function blankWorkspace(): Workspace {
  const path = join(dir, "blank.re64");
  writeFileSync(
    path,
    JSON.stringify({ name: "blank", layers: [{ type: "prg", path: "gridrunner.prg" }] })
  );
  const { databasePath, projectId } = importProject(path);
  const blankStorage = new SqliteStorage(databasePath, projectId);
  extras.push(blankStorage);

  return new Workspace({
    store: new ProjectStore(blankStorage),
    storage: blankStorage,
    projectId,
    projectPath: databasePath,
  });
}

describe("orienting in a project never seen before", () => {
  it("says what is here and how far along it is", () => {
    const described = workspace.describe();

    expect(described.entryPoints).toContain("$8011");
    expect(described.layers.map((l) => l.name)).toContain("gridrunner");
    expect(described.counts.instructions).toBe(1449);
    // The distinction that matters: chosen names mean something was understood.
    expect(described.counts.namedByHand).toBeGreaterThan(0);
    expect(described.counts.namedAutomatically).toBeGreaterThan(0);
    // The built-in C64 symbols are supplied, not decided by anyone.
    expect(described.counts.namedByPlatform).toBeGreaterThan(100);
  });

  it("does not credit anyone for names re64 supplied itself", () => {
    // A project holding only bytes reported 161 names chosen by hand, which is
    // the built-in C64 table plus a PRG entry point. That is the number a
    // reader uses to judge how far along a project is, so it has to be zero
    // when nothing has been understood yet.
    const blank = blankWorkspace();
    const counts = blank.describe().counts;

    expect(counts.namedByHand).toBe(0);
    expect(counts.namedByPlatform).toBeGreaterThan(100);
  });
});

describe("finding what to work on", () => {
  it("ranks unexplained addresses by how often they are referenced", () => {
    const { total, targets } = workspace.unnamed();

    expect(total).toBeGreaterThan(100);
    expect(targets[0].references).toBeGreaterThanOrEqual(targets.at(-1)!.references);
    expect(targets.every((t) => /^(sub|loc|dat)_/.test(t.name))).toBe(true);
  });

  it("narrows to the kind of thing being looked for", () => {
    const calls = workspace.unnamed("calls");
    expect(calls.targets.every((t) => t.name.startsWith("sub_"))).toBe(true);
  });

  it("marks invented names unwritable and withholds their ids", () => {
    // An auto id is derived from the fact that nothing named it. Handing it out
    // invites an edit claiming an identity that means nothing.
    const target = workspace.unnamed().targets[0];
    expect(target.writable).toBe(false);
    expect(target).not.toHaveProperty("id");
  });

  it("marks labels somebody chose as writable", () => {
    const chosen = workspace.labels({ source: "user" }).labels;
    expect(chosen.length).toBeGreaterThan(0);
    expect(chosen.every((l) => l.writable)).toBe(true);
  });
});

describe("reading code", () => {
  it("returns lines that can be acted on, not just printed", () => {
    const { lines } = workspace.disassembly(0x8011, 10);
    const jump = lines.find((l) => l.mnemonic === "JMP");

    expect(jump?.target).toMatch(/^\$[0-9A-F]{4}$/);
    expect(jump?.flow).toBe("jump");
    expect(jump?.text).toContain("JMP");
  });

  it("caps what it returns and says where to continue", () => {
    const page = workspace.disassembly(0x8011, 5);
    expect(page.lines).toHaveLength(5);
    expect(page.truncated).toBe(true);
    expect(page.nextStart).toMatch(/^\$[0-9A-F]{4}$/);
  });

  it("falls back to the nearest preceding line mid-instruction", () => {
    expect(() => workspace.disassembly(0x8012, 3)).not.toThrow();
  });

  it("says plainly when an address is not in the map", () => {
    expect(() => workspace.disassembly(0x0001, 3)).toThrow(/outside the loaded memory map/);
  });
});

describe("cross-references", () => {
  it("shows callers with the line that calls, not just an address", () => {
    const called = workspace.unnamed("calls").targets[0];
    const address = parseInt(called.address.slice(1), 16);
    const refs = workspace.references(address, "in");

    expect(refs.inbound!.length).toBeGreaterThan(0);
    // Without the text every entry costs another round trip to understand.
    expect(refs.inbound![0].text).toContain("JSR");
  });

  it("admits what it cannot see", () => {
    // Zero-page and indirect targets are not in the reference map at all, so a
    // routine reached that way looks uncalled.
    expect(workspace.references(0x8011).incomplete).toMatch(/zero-page/i);
  });
});

describe("editing", () => {
  it("names an address and reports what it did", () => {
    const result = workspace.setLabel(agent, 0x8f00, "FoundByAgent");

    expect(result.ok).toBe(true);
    expect(result.did[0]).toContain("FoundByAgent");
    expect(workspace.labels({ namePattern: "FoundByAgent" }).total).toBe(1);
  });

  it("reports the instructions a decision unlocked", () => {
    // Marking a function is how code nothing references gets decoded at all,
    // so the delta is how a caller tells a good guess from a wasted one.
    // $801B is in a code region, undecoded, and reached by nothing.
    const result = workspace.markFunction(agent, 0x801b);
    expect(result.instructions.delta).toBeGreaterThan(0);
  });

  it("reports no gain where the guess was wasted", () => {
    // $8F00 is inside a data region, so marking it decodes nothing — which is
    // exactly what a caller needs to be told rather than left to infer.
    expect(workspace.markFunction(agent, 0x8f00).instructions.delta).toBe(0);
  });

  it("records the edit durably, attributed", () => {
    workspace.setLabel(agent, 0x8f00, "Recorded");
    const recorded = storage.readOps();

    expect(recorded).toHaveLength(1);
    expect(recorded[0].author).toBe("usr_agent");
    expect(recorded[0].inverse).toBeDefined();
  });

  it("can take an edit back", () => {
    workspace.setLabel(agent, 0x8f00, "Regretted");
    expect(workspace.undo(agent).undone).toContain("Regretted");
    expect(workspace.labels({ namePattern: "Regretted" }).total).toBe(0);
  });

  it("sets a region, which the browser cannot", () => {
    const result = workspace.setRegion(agent, 0x8f00, 0x8f20, "text", "blurb");
    expect(result.ok).toBe(true);

    const regions = workspace.describe().regions;
    expect(regions.some((r) => r.name === "blurb" && r.kind === "text")).toBe(true);
  });

  it("refuses to write against a project that has moved", () => {
    const stale = workspace.version();
    workspace.setLabel(agent, 0x8f00, "Meanwhile");

    expect(() => workspace.expect(stale)).toThrow(/changed since you read it/);
    expect(() => workspace.expect(workspace.version())).not.toThrow();
  });

  it("says what is missing rather than failing silently", () => {
    expect(() => workspace.removeLabel(agent, 0x8f00)).toThrow(/no label at/i);
    expect(() => workspace.removeRegion(agent, 0x8f00)).toThrow(/no region/i);
  });
});

describe("catching up after being away", () => {
  it("reports what happened since a position", () => {
    workspace.setLabel(agent, 0x8f00, "First");
    const { cursor } = workspace.changesSince();

    workspace.setLabel(agent, 0x8f10, "Second");
    const since = workspace.changesSince(cursor);

    expect(since.changes).toHaveLength(1);
    expect(since.changes[0].did).toContain("Second");
    expect(since.changes[0].by).toBe("usr_agent");
  });

  it("returns nothing when nothing has happened", () => {
    workspace.setLabel(agent, 0x8f00, "Only");
    const { cursor } = workspace.changesSince();
    expect(workspace.changesSince(cursor).changes).toEqual([]);
  });

  it("keeps positions stable across an undo", () => {
    // The reason the log is append-only. It used to be rewritten wholesale on
    // every undo, renumbering everything, so a held cursor silently came to
    // mean something else.
    workspace.setLabel(agent, 0x8f00, "First");
    const { cursor } = workspace.changesSince();
    workspace.setLabel(agent, 0x8f10, "Second");

    workspace.undo(agent);

    const since = workspace.changesSince(cursor);
    expect(since.changes[0].did).toContain("Second");
    expect(since.changes[0].undone).toBe(true);
  });

  it("resumes from the last entry it returned, not the last that exists", () => {
    for (let i = 0; i < 5; i++) workspace.setLabel(agent, 0x8f00 + i * 0x10, `L${i}`);

    const page = workspace.changesSince(0, 2);
    expect(page.truncated).toBe(true);
    expect(page.changes).toHaveLength(2);

    const next = workspace.changesSince(page.cursor, 2);
    expect(next.changes[0].did).toContain("L2");
  });
});

describe("the cache", () => {
  it("does not re-analyse when nothing changed", () => {
    const first = workspace.program();
    expect(workspace.program()).toBe(first);
  });

  it("re-analyses after an edit, so a reader never sees stale code", () => {
    const before = workspace.program();
    workspace.setLabel(agent, 0x8f00, "Changed", "function");
    expect(workspace.program()).not.toBe(before);
    expect(workspace.labels({ namePattern: "Changed" }).total).toBe(1);
  });

  it("answers repeated reads without repeating the work", () => {
    const started = Date.now();
    for (let i = 0; i < 50; i++) workspace.disassembly(0x8011, 20);
    // Uncached this is ~50 × 12ms of disassembly plus rendering.
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("a project written by hand", () => {
  it("can be edited, not only read", () => {
    // A file without ids loads and disassembles perfectly and then refused
    // every write, because operations target objects by id. That is the shape
    // a new project actually arrives in — nobody hand-writes an id — so the
    // first thing anyone would try was the thing that did not work.
    const blank = blankWorkspace();

    const result = blank.setLabel(agent, 0x8011, "GameEntry", "function");
    expect(result.did[0]).toContain("GameEntry");

    const labels = blank.labels({ namePattern: "GameEntry" });
    expect(labels.total).toBe(1);
  });

  it("opens up code that nothing reaches", () => {
    // The workflow the first experiment is built around: a blank project
    // decodes almost nothing until someone declares an entry point.
    const blank = blankWorkspace();
    const before = blank.describe().counts.instructions;

    const marked = blank.markFunction(agent, 0x8011);

    expect(marked.instructions.delta).toBeGreaterThan(100);
    expect(blank.describe().counts.instructions).toBeGreaterThan(before);
  });
});

describe("saying what a span holds", () => {
  it("starts decoding at a code region, named or not", () => {
    // It used to seed only when the region carried a name, because only a
    // named region generated the entry label that seeds the queue. So the
    // declaration was inert exactly where it was needed — on a span nothing
    // reaches — and the way through was to call it a subroutine and accept a
    // fabricated name onto an address nobody wanted to name.
    const blank = blankWorkspace();
    expect(blank.describe().counts.instructions).toBe(5);

    const result = blank.setRegion(agent, 0x8011, 0x8014, "code");

    expect(result.instructions.delta).toBeGreaterThan(1000);
    // And nothing appeared in the listing that nobody put there.
    expect(blank.labels({ namePattern: "rgn_" }).total).toBe(0);
  });

  it("says which bytes it took, because end is exclusive", () => {
    const result = workspace.setRegion(agent, 0x8f00, 0x8f20, "text");
    expect(result.covers).toBe("$8F00-$8F1F (32 bytes)");
  });

  it("refuses a jumptable too small to hold an address", () => {
    // $8000-$8001 is one byte. It contains no address, decodes nothing, and
    // used to return ok — which on a project with nothing else reachable is
    // the difference between the whole program and five instructions.
    expect(() => workspace.setRegion(agent, 0x8000, 0x8001, "jumptable")).toThrow(
      /at least two bytes.*end is\s+exclusive/is
    );
  });

  it("refuses a region covering nothing", () => {
    expect(() => workspace.setRegion(agent, 0x8000, 0x8000, "data")).toThrow(
      /at least one byte/
    );
  });

  it("follows a jumptable that covers a whole address", () => {
    const blank = blankWorkspace();
    const result = blank.setRegion(agent, 0x8000, 0x8002, "jumptable", "initVector");
    expect(result.instructions.delta).toBeGreaterThan(1000);
  });
});

describe("what a reader is told it may edit", () => {
  it("does not claim a built-in symbol is writable", () => {
    // The field a reader uses to decide what to edit. Platform labels belong
    // to the built-in layer that no project owns, so a write is refused a
    // layer down — after it has already been planned against.
    const platform = workspace.labels({ source: "platform" }).labels[0];

    expect(platform.source).toBe("platform");
    expect(platform.writable).toBe(false);
  });

  it("still marks a project's own label writable", () => {
    const own = workspace.labels({ source: "user" }).labels[0];
    expect(own.writable).toBe(true);
  });
});
