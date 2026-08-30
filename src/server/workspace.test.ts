import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
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
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("orienting in a project never seen before", () => {
  it("says what is here and how far along it is", () => {
    const described = workspace.describe();

    expect(described.entryPoints).toContain("$8011");
    expect(described.layers.map((l) => l.name)).toContain("gridrunner");
    expect(described.counts.instructions).toBe(1449);
    // The distinction that matters: chosen names mean something was understood.
    expect(described.counts.namedByHand).toBeGreaterThan(0);
    expect(described.counts.namedAutomatically).toBeGreaterThan(0);
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
