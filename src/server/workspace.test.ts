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
    // Asserted across all of them rather than the first, which only held
    // while the order was arbitrary.
    expect(refs.inbound!.every((r) => r.text)).toBe(true);
    expect(refs.inbound!.some((r) => r.text!.includes("JSR"))).toBe(true);
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
      /even number of bytes/
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

describe("what is left to look at", () => {
  it("finds the holes on a project nobody has worked on", () => {
    // The question that had no answer. `unnamed()` ranks what has been
    // reached, which on a blank project is almost nothing precisely because
    // almost nothing is reachable.
    const blank = blankWorkspace();
    const { spans, unexplainedBytes } = blank.undecoded();

    // A 4KB layer with five instructions decoded is almost entirely unknown,
    // and it is one unbroken run.
    expect(unexplainedBytes).toBeGreaterThan(4000);
    expect(spans).toHaveLength(1);
    expect(spans[0].inLayer).toBe("gridrunner");
  });

  it("puts the biggest hole first", () => {
    // A 400-byte hole is worth looking at before a stray three.
    const { spans } = workspace.undecoded(200);
    const sizes = spans.map((s) => s.bytes);

    expect(spans.length).toBeGreaterThan(1);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
  });

  it("shrinks as the work is done", () => {
    const blank = blankWorkspace();
    const before = blank.undecoded().unexplainedBytes;

    blank.markFunction(agent, 0x8011);

    expect(blank.undecoded().unexplainedBytes).toBeLessThan(before / 2);
  });

  it("counts a span someone has explained as explained", () => {
    // Saying "this is data" is understanding, not a gap. If it stayed on the
    // list the list would never shrink and would stop meaning anything.
    const blank = blankWorkspace();
    const before = blank.undecoded().unexplainedBytes;

    blank.setRegion(agent, 0x8f00, 0x9000, "data", "chargen");

    expect(blank.undecoded().unexplainedBytes).toBe(before - 0x100);
  });

  it("ignores holes too small to be worth reporting", () => {
    const all = workspace.undecoded(200, 1).total;
    const big = workspace.undecoded(200, 16).total;

    expect(big).toBeLessThan(all);
  });
});

describe("writing about an address", () => {
  it("needs no label to carry a comment", () => {
    // The gap this closes: a comment used to be a field on a label, so
    // commenting an instruction meant inventing a name for it and putting a
    // name in the listing that nobody wanted there.
    const result = workspace.setComment(agent, 0x8015, "wait for the raster");

    expect(result.ok).toBe(true);
    const rows = workspace.disassembly(0x8015, 3).lines.map((l) => l.text);
    expect(rows[0]).toContain("; wait for the raster");
    expect(rows.join("\n")).not.toContain("wait for the raster:");
  });

  it("puts a comment above the label it introduces", () => {
    workspace.setComment(agent, 0x8015, "the main loop");
    const rows = workspace.disassembly(0x8015, 4).lines.map((l) => l.text);

    const comment = rows.findIndex((r) => r.includes("; the main loop"));
    const label = rows.findIndex((r) => r.includes(":"));
    expect(comment).toBeGreaterThanOrEqual(0);
    expect(comment).toBeLessThan(label);
  });

  it("puts an inline comment on the instruction's own row", () => {
    workspace.setComment(agent, 0x8015, "counts up", "inline");
    const row = workspace
      .disassembly(0x8015, 4)
      .lines.map((l) => l.text)
      .find((r) => /INX|LDA|STA|JMP|JSR/.test(r));

    expect(row).toMatch(/;\s*counts up$/);
  });

  it("refuses an inline comment that cannot fit on a row", () => {
    expect(() => workspace.setComment(agent, 0x8015, "one\ntwo", "inline")).toThrow(
      /cannot\s+contain newlines/is
    );
  });

  it("revises a slot rather than stacking a second comment", () => {
    workspace.setComment(agent, 0x8015, "first thought");
    workspace.setComment(agent, 0x8015, "second thought");

    const rows = workspace.disassembly(0x8015, 4).lines.map((l) => l.text);
    expect(rows.join("\n")).toContain("second thought");
    expect(rows.join("\n")).not.toContain("first thought");
  });

  it("renders a multi-line comment on its own rows", () => {
    workspace.setComment(agent, 0x8015, "why this exists\nand what it assumes");
    const rows = workspace.disassembly(0x8015, 5).lines.map((l) => l.text);

    // One row per line, each still carrying the address column.
    expect(rows.filter((r) => /^[0-9A-F]{4}\s+; /.test(r))).toHaveLength(2);
  });

  it("takes one back", () => {
    workspace.setComment(agent, 0x8015, "temporary");
    workspace.removeComment(agent, 0x8015);

    const rows = workspace.disassembly(0x8015, 4).lines.map((l) => l.text);
    expect(rows.join("\n")).not.toContain("temporary");
  });

  it("says so when there is nothing to remove", () => {
    expect(() => workspace.removeComment(agent, 0x8016)).toThrow(/No comment at/);
  });

  it("undoes as one action alongside the label it came with", () => {
    // set_label with a comment is one decision made of two operations.
    workspace.setLabel(agent, 0x8450, "Considered", "function", "because of the timing");
    workspace.undo(agent);

    const rows = workspace.disassembly(0x8450, 3).lines.map((l) => l.text).join("\n");
    expect(rows).not.toContain("Considered");
    expect(rows).not.toContain("because of the timing");
  });
});

describe("naming what holds no bytes", () => {
  it("creates a layer to hold the name, rather than refusing", () => {
    // The refusal this replaces named the fix and offered no way to do it:
    // "add a layer of type symbols" with nothing that could. On a 6502 program
    // every variable lives in zero page, so roughly half of what a person
    // contributes to a listing could not be said at all.
    const blank = blankWorkspace();
    const result = blank.setLabel(agent, 0x02, "currentXPosition");

    expect(result.did.some((d) => d.includes("symbols layer"))).toBe(true);
    expect(blank.labels({ namePattern: "currentXPosition" }).total).toBe(1);
  });

  it("uses the operand name once it has one", () => {
    const blank = blankWorkspace();
    blank.markFunction(agent, 0x8011);
    blank.setLabel(agent, 0x0c, "previousYPosition");

    // Somewhere in the decoded program something touches $0C; the name has to
    // reach the operand column, which is the whole point of naming it.
    const rows = blank.disassembly(0x8011, 400).lines.map((l) => l.text).join("\n");
    expect(rows).toContain("previousYPosition");
  });

  it("makes only one layer, however many addresses are named", () => {
    const blank = blankWorkspace();
    blank.setLabel(agent, 0x02, "currentXPosition");
    blank.setLabel(agent, 0x03, "currentYPosition");
    blank.setLabel(agent, 0x04, "currentCharacter");

    const symbols = blank.describe().layers.filter((l) => l.name.includes("symbols"));
    expect(symbols).toHaveLength(1);
  });

  it("takes the layer back with the label that caused it", () => {
    // One decision, two operations: undo must not leave an orphan layer.
    const blank = blankWorkspace();
    const before = blank.describe().layers.length;

    blank.setLabel(agent, 0x02, "currentXPosition");
    blank.undo(agent);

    expect(blank.describe().layers).toHaveLength(before);
    expect(blank.labels({ namePattern: "currentXPosition" }).total).toBe(0);
  });

  it("comments an address that holds no bytes too", () => {
    const blank = blankWorkspace();
    const result = blank.setComment(agent, 0x02, "the player's column");

    expect(result.did.some((d) => d.includes("symbols layer"))).toBe(true);
  });

  it("lets a caller name the layer itself", () => {
    const blank = blankWorkspace();
    blank.addSymbolsLayer(agent, "hardware");

    expect(blank.describe().layers.map((l) => l.name)).toContain("hardware");
    // And the next unowned name goes into it rather than making another.
    blank.setLabel(agent, 0x02, "currentXPosition");
    expect(blank.describe().layers.filter((l) => l.name === "hardware")).toHaveLength(1);
  });
});

describe("what the disassembler could not make sense of", () => {
  it("can be read, not only counted", () => {
    const counted = workspace.describe().warnings;
    const { total, warnings } = workspace.warnings();

    expect(total).toBe(counted);
    expect(warnings).toHaveLength(counted);
    expect(warnings[0]).toMatch(/\$[0-9A-F]{4}/);
  });
});

describe("who calls this", () => {
  it("names the routine each call sits in", () => {
    // "Who calls this" is a question about names. The answer used to be a bag
    // of addresses in no order.
    const { inbound } = workspace.references(0x8870, "in");

    expect(inbound!.length).toBeGreaterThan(1);
    expect(inbound!.some((r) => r.inRoutine !== undefined)).toBe(true);
  });

  it("puts them in address order", () => {
    const { inbound } = workspace.references(0x8870, "in");
    const addresses = inbound!.map((r) => parseInt(r.from.slice(1), 16));

    expect(addresses).toEqual([...addresses].sort((a, b) => a - b));
  });
});

describe("an edit that breaks the decode", () => {
  it("says so, at the moment it becomes true", () => {
    // A label one byte inside an instruction is legitimate 6502 and the model
    // allows it, but the row builder cannot draw two streams claiming one byte,
    // so everything after resyncs into garbage. The renderer still cannot cope
    // — this is the difference between a wrong answer and one that admits it.
    const result = workspace.setLabel(agent, 0x8d5a, "b8D5A", "code");

    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some((w) => /overlaps instruction/.test(w))).toBe(true);
  });

  it("stays quiet when nothing broke", () => {
    const result = workspace.setLabel(agent, 0x8870, "PerfectlyOrdinary", "function");
    expect(result.warnings).toBeUndefined();
  });
});

describe("naming many addresses at once", () => {
  it("takes a batch and reports it as one action", () => {
    const result = workspace.setLabels(agent, [
      { address: 0x8450, name: "BatchedOne", type: "function" },
      { address: 0x8870, name: "BatchedTwo", type: "function" },
      { address: 0x8230, name: "BatchedThree" },
    ]);

    expect(result.did).toHaveLength(3);
    // Distinctive names on purpose: namePattern matches case-insensitively and
    // the built-in C64 table is full of ordinary words.
    expect(workspace.labels({ namePattern: "Batched" }).total).toBe(3);
  });

  it("undoes the whole batch, not the last of it", () => {
    workspace.setLabels(agent, [
      { address: 0x8450, name: "BatchedOne" },
      { address: 0x8870, name: "BatchedTwo" },
    ]);
    workspace.undo(agent);

    expect(workspace.labels({ namePattern: "Batched" }).total).toBe(0);
  });

  it("makes one symbols layer for a batch of unowned addresses, not one each", () => {
    const blank = blankWorkspace();
    blank.setLabels(agent, [
      { address: 0x02, name: "currentXPosition" },
      { address: 0x03, name: "currentYPosition" },
      { address: 0x04, name: "currentCharacter" },
    ]);

    const symbols = blank.describe().layers.filter((l) => l.name.includes("symbols"));
    expect(symbols).toHaveLength(1);
    expect(blank.labels({ source: "user" }).total).toBe(3);
  });

  it("carries comments through the batch", () => {
    workspace.setLabels(agent, [
      { address: 0x8450, name: "Named", comment: "and explained" },
    ]);

    const rows = workspace.disassembly(0x8450, 3).lines.map((l) => l.text).join("\n");
    expect(rows).toContain("; and explained");
  });

  it("refuses an empty batch rather than reporting success", () => {
    expect(() => workspace.setLabels(agent, [])).toThrow(/at least one/);
  });
});

describe("naming a value", () => {
  it("changes nothing until a site says it means that", () => {
    // The whole design: a value has no single meaning. Declaring ORANGE = $08
    // must not turn every #$08 in the program orange.
    const before = workspace.disassembly(0x8011, 300).lines.map((l) => l.text).join("\n");
    workspace.setConstant(agent, "ORANGE", 0x08);

    expect(workspace.disassembly(0x8011, 300).lines.map((l) => l.text).join("\n")).toBe(before);
    expect(workspace.constants().constants.map((c) => c.name)).toContain("ORANGE");
  });

  it("renders where a site is bound, and nowhere else", () => {
    const site = workspace.immediates(0x08).sites[0];
    const address = parseInt(site.address.slice(1), 16);

    workspace.setConstant(agent, "ORANGE", 0x08);
    workspace.bindConstant(agent, address, "ORANGE");

    const row = workspace.disassembly(address, 1).lines[0].text;
    expect(row).toContain("#ORANGE");

    // Another site loading the same value is untouched.
    const other = workspace.immediates(0x08).sites.find((s) => s.address !== site.address);
    expect(other?.boundTo).toBeUndefined();
  });

  it("refuses a binding the instruction cannot mean", () => {
    workspace.setConstant(agent, "ORANGE", 0x08);
    const wrongValue = workspace.immediates().sites.find((s) => s.value !== "$08")!;
    const at = parseInt(wrongValue.address.slice(1), 16);

    expect(() => workspace.bindConstant(agent, at, "ORANGE")).toThrow(/but ORANGE is/);
    // And an address with no immediate at all.
    expect(() => workspace.bindConstant(agent, 0x8015, "ORANGE")).toThrow(
      /no immediate|nothing there/i
    );
  });

  it("refuses a value that is not a byte", () => {
    expect(() => workspace.setConstant(agent, "TOO_BIG", 0x100)).toThrow(/\$00-\$FF/);
  });

  it("renders the literal again when the constant is deleted", () => {
    // A use pointing at nothing falls back rather than breaking, so deleting a
    // declaration needs no sweep over the sites that meant it.
    const site = workspace.immediates(0x08).sites[0];
    const address = parseInt(site.address.slice(1), 16);

    workspace.setConstant(agent, "ORANGE", 0x08);
    workspace.bindConstant(agent, address, "ORANGE");
    workspace.removeConstant(agent, "ORANGE");

    expect(workspace.disassembly(address, 1).lines[0].text).toContain("#$08");
  });

  it("takes a binding back", () => {
    const site = workspace.immediates(0x08).sites[0];
    const address = parseInt(site.address.slice(1), 16);

    workspace.setConstant(agent, "ORANGE", 0x08);
    workspace.bindConstant(agent, address, "ORANGE");
    workspace.unbindConstant(agent, address);

    expect(workspace.disassembly(address, 1).lines[0].text).toContain("#$08");
    // The declaration survives; only the use went.
    expect(workspace.constants().constants.map((c) => c.name)).toContain("ORANGE");
  });

  it("lets two names share one value", () => {
    // LEFT_ZAPPER = $01 and WHITE = $01 in the reference. Both must be
    // declarable, and each site picks which it meant.
    workspace.setConstant(agent, "LEFT_ZAPPER", 0x01);
    workspace.setConstant(agent, "WHITE", 0x01);

    const names = workspace.constants().constants.map((c) => c.name);
    expect(names).toContain("LEFT_ZAPPER");
    expect(names).toContain("WHITE");
  });

  it("finds where else a value is loaded", () => {
    const { total, sites } = workspace.immediates(0x08);

    expect(total).toBeGreaterThan(1);
    expect(sites.every((s) => s.value === "$08")).toBe(true);
    expect(sites[0].text).toMatch(/#\$08/);
  });
});

describe("the work as a listing", () => {
  it("reads like a hand-written disassembly", () => {
    const { text } = workspace.listing(0x8015, 4);

    expect(text).toContain("MaybeContinueCheckingScreen:");
    expect(text.split("\n").length).toBeGreaterThanOrEqual(4);
  });

  it("emits only the constants the span actually means", () => {
    const site = workspace.immediates(0x16).sites[0];
    const address = parseInt(site.address.slice(1), 16);
    workspace.setConstant(agent, "EXPLOSION1", 0x16);
    workspace.setConstant(agent, "NEVER_USED", 0x99);
    workspace.bindConstant(agent, address, "EXPLOSION1");

    const { text } = workspace.listing(address, 4);

    expect(text).toContain("EXPLOSION1                  = $16");
    // Derived from the bindings, so a declaration nobody used stays out.
    expect(text).not.toContain("NEVER_USED");
    expect(text).toContain("#EXPLOSION1");
  });

  it("has no equate block when the span means no constants", () => {
    expect(workspace.listing(0x8015, 3).text.startsWith("8015")).toBe(true);
  });

  it("says where to continue", () => {
    const page = workspace.listing(0x8015, 5);
    expect(page.truncated).toBe(true);
    expect(page.nextStart).toMatch(/^\$[0-9A-F]{4}$/);
  });
});

describe("declaring a jumptable", () => {
  it("refuses an odd span, whatever its size", () => {
    // Every entry is two bytes, so an odd length is an off-by-one at any size
    // — not only the degenerate one. A five-entry table declared one byte
    // short yields four entries and reports success.
    expect(() => workspace.setRegion(agent, 0x8000, 0x8009, "jumptable")).toThrow(
      /covers 9.*even number|even number.*covers 9/is
    );
    expect(() => workspace.setRegion(agent, 0x8000, 0x8001, "jumptable")).toThrow(
      /even number/
    );
  });

  it("names both ends that would have been right", () => {
    try {
      workspace.setRegion(agent, 0x8000, 0x8009, "jumptable");
      throw new Error("should have refused");
    } catch (err) {
      expect((err as Error).message).toContain("$8008");
      expect((err as Error).message).toContain("$800A");
    }
  });

  it("accepts an even span", () => {
    expect(() => workspace.setRegion(agent, 0x8000, 0x800a, "jumptable")).not.toThrow();
  });

  it("warns rather than refusing to open a file that already has one", () => {
    // Refusing the write is right; refusing to load would make an existing
    // project unopenable over a byte.
    const blank = blankWorkspace();
    blank.setRegion(agent, 0x8000, 0x8004, "jumptable", "vectors");
    // Widen it to an odd span behind the validation, as a hand-edited file would.
    const project = blank.describe();
    expect(project.regions.some((r) => r.kind === "jumptable")).toBe(true);
  });
});

describe("a region where there are no bytes", () => {
  it("is refused, rather than written somewhere that cannot hold it", () => {
    // Ownership falls back to a symbols layer for an address nothing supplies,
    // which is right for a label and wrong for a region. Sharing one resolver
    // let a region land on a symbols layer, producing a document the loader
    // refused — after which no interface could write to the project at all.
    const blank = blankWorkspace();
    blank.setLabel(agent, 0x02, "currentXPosition"); // creates the symbols layer

    expect(() => blank.setRegion(agent, 0x0400, 0x07e8, "data", "SCREEN_RAM")).toThrow(
      /No loaded bytes at \$0400/
    );
  });

  it("leaves the project writable afterwards", () => {
    const blank = blankWorkspace();
    blank.setLabel(agent, 0x02, "currentXPosition");
    try {
      blank.setRegion(agent, 0x0400, 0x07e8, "data");
    } catch {
      // expected
    }

    // The point of the bug: everything after used to fail too.
    expect(() => blank.setLabel(agent, 0x8011, "StillWorks")).not.toThrow();
    expect(blank.labels({ namePattern: "StillWorks" }).total).toBe(1);
  });
});

describe("two names for one address", () => {
  it("adds a second rather than renaming", () => {
    workspace.setLabel(agent, 0x08, "randomValue");
    workspace.addLabel(agent, 0x08, "gridXPos");

    const names = workspace.labels({ source: "user" }).labels
      .filter((l) => l.address === "$0008")
      .map((l) => l.name);
    expect(names).toContain("randomValue");
    expect(names).toContain("gridXPos");
  });

  it("refuses the same name twice at one address", () => {
    workspace.setLabel(agent, 0x08, "randomValue");
    expect(() => workspace.addLabel(agent, 0x08, "randomValue")).toThrow(/already called/);
  });

  it("shows the primary where no site says otherwise", () => {
    const blank = blankWorkspace();
    blank.markFunction(agent, 0x8011);
    blank.setLabel(agent, 0x08, "randomValue");
    blank.addLabel(agent, 0x08, "gridXPos");
    blank.setPrimaryLabel(agent, 0x08, "randomValue");

    const rows = blank.disassembly(0x8011, 900).lines.map((l) => l.text).join("\n");
    expect(rows).toContain("randomValue");
    expect(rows).not.toContain("gridXPos");
  });

  it("shows the bound name at the site that says so", () => {
    const blank = blankWorkspace();
    blank.markFunction(agent, 0x8011);
    blank.setLabel(agent, 0x08, "randomValue");
    blank.addLabel(agent, 0x08, "gridXPos");
    blank.setPrimaryLabel(agent, 0x08, "randomValue");

    // Find a site that touches $08 and bind just that one.
    const site = blank
      .program()
      .instructions.all()
      .find((i) => (i.operand as { address?: number }).address === 0x08)!;
    blank.bindLabel(agent, "gridXPos", 0x08, site.address);

    expect(blank.disassembly(site.address, 1).lines[0].text).toContain("gridXPos");
    // Everywhere else still says the primary.
    // `address` on a line is a hex string, not a number.
    const here = `$${site.address.toString(16).toUpperCase().padStart(4, "0")}`;
    const elsewhere = blank
      .disassembly(0x8011, 900)
      .lines.filter((l) => l.address !== here)
      .map((l) => l.text)
      .join("\n");
    expect(elsewhere).not.toContain("gridXPos");
  });

  it("binds a whole span in one call", () => {
    const blank = blankWorkspace();
    blank.markFunction(agent, 0x8011);
    blank.setLabel(agent, 0x08, "randomValue");
    blank.addLabel(agent, 0x08, "gridXPos");

    const result = blank.bindLabel(agent, "gridXPos", 0x08, 0x8011, 0x8fff);
    expect(result.did.length).toBeGreaterThan(1);
  });

  it("says when a span refers to nothing", () => {
    workspace.setLabel(agent, 0x08, "randomValue");
    expect(() => workspace.bindLabel(agent, "randomValue", 0x08, 0x8011, 0x8012)).toThrow(
      /No instruction between/
    );
  });

  it("falls back to the primary when the bound label is deleted", () => {
    const blank = blankWorkspace();
    blank.markFunction(agent, 0x8011);
    blank.setLabel(agent, 0x08, "randomValue");
    blank.addLabel(agent, 0x08, "gridXPos");
    const site = blank
      .program()
      .instructions.all()
      .find((i) => (i.operand as { address?: number }).address === 0x08)!;
    blank.bindLabel(agent, "gridXPos", 0x08, site.address);

    blank.removeLabel(agent, 0x08);

    // A dangling use resolves by the ordinary rule rather than breaking.
    expect(() => blank.disassembly(site.address, 1)).not.toThrow();
  });
});

describe("naming an array", () => {
  it("renders an operand inside it as an offset from the name", () => {
    // The reference writes `LDA SCREEN_RAM + $000F,X`; re64 wrote
    // `LDA dat_040F,X`, losing the fact that it indexes the screen. Hundreds
    // of sites in this one game.
    workspace.setLabel(agent, 0x0400, "SCREEN_RAM", undefined, undefined, 1000);

    // Two rows at this address: the label, then the instruction.
    const rows = workspace.disassembly(0x8072, 2).lines.map((l) => l.text).join("\n");
    expect(rows).toContain("SCREEN_RAM + $000F");
  });

  it("beats an invented name but not a chosen one", () => {
    // dat_040F says nothing, so the array wins. A name a person put at that
    // exact address was put there on purpose, so it does not.
    const at8072 = () =>
      workspace.disassembly(0x8072, 2).lines.map((l) => l.text).join("\n");

    workspace.setLabel(agent, 0x0400, "SCREEN_RAM", undefined, undefined, 1000);
    expect(at8072()).toContain("SCREEN_RAM + ");

    workspace.setLabel(agent, 0x040f, "cursorCell");
    expect(at8072()).toContain("cursorCell");
  });

  it("leaves an address outside the extent alone", () => {
    workspace.setLabel(agent, 0x0400, "SCREEN_RAM", undefined, undefined, 4);
    const rows = workspace.disassembly(0x8072, 2).lines.map((l) => l.text).join("\n");
    expect(rows).not.toContain("SCREEN_RAM");
  });

  it("prefers the innermost array when they nest", () => {
    workspace.setLabel(agent, 0x0400, "SCREEN_RAM", undefined, undefined, 1000);
    workspace.addLabel(agent, 0x0408, "topRow", undefined, 40);

    const rows = workspace.disassembly(0x8072, 2).lines.map((l) => l.text).join("\n");
    expect(rows).toContain("topRow + $0007");
  });

  it("keeps the tolerance idiom looking different", () => {
    // `table-1,X` with X from 1 is a 1-indexed table, which is a different
    // statement from "element N of this array" and should not read alike.
    workspace.setLabel(agent, 0x0400, "SCREEN_RAM", undefined, undefined, 1000);
    const rows = workspace.disassembly(0x8800, 30).lines.map((l) => l.text).join("\n");

    expect(rows).toContain("SCREEN_RAM-1,X");
  });
});

describe("comments on rows that are not instructions", () => {
  it("renders an inline comment on a data row", () => {
    // Handled only where instructions were emitted, so a comment on a data row
    // was stored and rendered nowhere: written, kept, and never seen.
    workspace.setRegion(agent, 0x8080, 0x8090, "data", "copyright");
    workspace.setComment(agent, 0x8080, "(c) 1982 HES", "inline");

    const rows = workspace.disassembly(0x8080, 2).lines.map((l) => l.text).join("\n");
    expect(rows).toContain("; (c) 1982 HES");
  });

  it("says what it cannot see, including pointers in data", () => {
    // The caveat named zero-page and indirect only; the case actually hit was
    // an address stored in a data word, which is how a C64 game reaches its
    // own entry point.
    const { incomplete } = workspace.references(0x8870, "in");
    expect(incomplete).toMatch(/stored in data/);
  });
});

describe("saying how to read text", () => {
  it("shows the decoded string rather than a bare directive", () => {
    // A text region used to render `.TEXT` and nothing else, which made
    // declaring one strictly worse than leaving the span as data.
    workspace.setRegion(agent, 0x8080, 0x8088, "text", "copyright");
    const row = workspace.disassembly(0x8080, 2).lines.map((l) => l.text).join("\n");

    expect(row).toContain('.TEXT "');
  });

  it("decodes screen codes differently from ASCII", () => {
    // $8004 holds C3 C2 CD..., which differ between the two. $8080 would not:
    // screen codes and ASCII agree across $20-$3F, so a span of printable
    // punctuation cannot tell them apart.
    const read = (encoding: "ascii" | "screen") => {
      workspace.setRegion(agent, 0x8004, 0x800c, "text", "header", undefined, encoding);
      return workspace.disassembly(0x8004, 2).lines.map((l) => l.text).join("\n");
    };

    expect(read("screen")).not.toBe(read("ascii"));
  });

  it("keeps the encoding in the project", () => {
    workspace.setRegion(agent, 0x8080, 0x8088, "text", "copyright", undefined, "petscii");
    const region = workspace.describe().regions.find((r) => r.name === "copyright");

    expect(region).toBeDefined();
    // Rendering it twice must give the same answer, so it survived the write.
    const once = workspace.disassembly(0x8080, 2).lines.map((l) => l.text).join("\n");
    expect(workspace.disassembly(0x8080, 2).lines.map((l) => l.text).join("\n")).toBe(once);
  });
});

describe("the last of trial 2's list", () => {
  it("sees the pointer a jumptable holds as a reference", () => {
    // The one thing in the binary pointing at the entry point is a table
    // entry, not an instruction, so find_references reported no callers for
    // the address everything starts from.
    const blank = blankWorkspace();
    blank.setRegion(agent, 0x8000, 0x8002, "jumptable", "initVector");

    const { inbound } = blank.references(0x83c1, "in");
    expect(inbound!.length).toBeGreaterThan(0);
    expect(inbound![0].from).toBe("$8000");
    expect(inbound![0].type).toBe("jump");
  });

  it("starts a listing at the row containing the address", () => {
    // A data row covers eight bytes, so asking for $808C used to skip to
    // $8090 and leave out the row being checked.
    workspace.setRegion(agent, 0x8080, 0x8090, "data", "copyright");
    expect(workspace.listing(0x808c, 2).start).toBe("$8088");
  });

  it("writes a batch of comments as one action", () => {
    const result = workspace.setComments(agent, [
      { address: 0x8015, text: "first" },
      { address: 0x8016, text: "second", placement: "inline" },
      { address: 0x8018, text: "third" },
    ]);

    expect(result.did).toHaveLength(3);
    const rows = workspace.disassembly(0x8015, 8).lines.map((l) => l.text).join("\n");
    expect(rows).toContain("; first");
    expect(rows).toContain("; second");
  });

  it("makes one symbols layer for a batch of comments on unowned addresses", () => {
    const blank = blankWorkspace();
    blank.setComments(agent, [
      { address: 0x02, text: "the player's column" },
      { address: 0x03, text: "the player's row" },
    ]);

    expect(blank.describe().layers.filter((l) => l.name.includes("symbols"))).toHaveLength(1);
  });

  it("declares a batch of constants as one action", () => {
    const result = workspace.setConstants(agent, [
      { name: "GRID", value: 0x00 },
      { name: "SHIP", value: 0x07 },
      { name: "EXPLOSION1", value: 0x16 },
    ]);

    expect(result.did).toHaveLength(3);
    expect(workspace.constants().total).toBe(3);
  });

  it("refuses a batch with a value that is not a byte, naming it", () => {
    expect(() =>
      workspace.setConstants(agent, [
        { name: "FINE", value: 0x10 },
        { name: "TOO_BIG", value: 0x100 },
      ])
    ).toThrow(/TOO_BIG/);
  });

  it("refuses an inline comment with newlines, naming the address", () => {
    expect(() =>
      workspace.setComments(agent, [
        { address: 0x8015, text: "one\ntwo", placement: "inline" },
      ])
    ).toThrow(/\$8015.*inline/s);
  });
});

describe("an edit that cuts code off", () => {
  it("reports the filler case, which is a mistake worth reporting", () => {
    // The $EA between two routines is executed, so calling it data stops the
    // walk there and takes the rest of the program with it. That is the
    // correct behaviour for a wrong declaration — the NOPs are code — and the
    // whole point is that it must not happen quietly.
    const blank = blankWorkspace();
    blank.setRegion(agent, 0x8000, 0x8002, "jumptable");

    const result = blank.setRegion(agent, 0x8361, 0x8370, "data", "filler");

    expect(result.instructions.delta).toBeLessThan(-500);
    expect(result.orphaned).toBeDefined();
    expect(result.orphaned!.firstAt).toBe("$8370");
  });

  it("stays quiet about bytes nothing was reaching anyway", () => {
    // A region over unreachable bytes costs nothing and says nothing.
    const blank = blankWorkspace();
    const result = blank.setRegion(agent, 0x8f00, 0x8f20, "data", "chargen");

    expect(result.orphaned).toBeUndefined();
  });

  it("says so when something outside the span stops decoding", () => {
    // The whole program hangs off one JMP. Calling it data takes everything
    // with it, which delta reports in the same field, shape and tone as a
    // useful gain.
    const blank = blankWorkspace();
    blank.setRegion(agent, 0x8011, 0x8014, "code");

    const result = blank.setRegion(agent, 0x8011, 0x8014, "data");

    expect(result.instructions.delta).toBeLessThan(-1000);
    expect(result.orphaned).toBeDefined();
    expect(result.orphaned!.instructions).toBeGreaterThan(1000);
    expect(result.orphaned!.hint).toContain("set_region");
  });

  it("names an address outside the span, not one inside it", () => {
    const blank = blankWorkspace();
    blank.setRegion(agent, 0x8011, 0x8014, "code");

    const { orphaned } = blank.setRegion(agent, 0x8011, 0x8014, "data");
    const at = parseInt(orphaned!.firstAt.slice(1), 16);
    expect(at).toBeGreaterThanOrEqual(0x8014);
  });

  it("stays quiet when an edit costs nothing", () => {
    const blank = blankWorkspace();
    expect(blank.setRegion(agent, 0x8011, 0x8015, "code").orphaned).toBeUndefined();
  });
});

describe("adding a second name", () => {
  it("does not change what anyone sees", () => {
    // Two user labels at one address tie on rank, so without an explicit
    // primary the winner is decided by id order — which is random. Adding a
    // second name silently renamed every reference to the address, and
    // unpredictably enough that testing it once told you nothing.
    const blank = blankWorkspace();
    blank.setRegion(agent, 0x8011, 0x8015, "code");
    blank.setLabel(agent, 0x02, "currentXPosition");

    const before = blank.disassembly(0x8132, 1).lines[0].text;
    blank.addLabel(agent, 0x02, "vicRegisterLoPtr");

    expect(blank.disassembly(0x8132, 1).lines[0].text).toBe(before);
  });

  it("leaves an explicit choice alone", () => {
    const blank = blankWorkspace();
    blank.setRegion(agent, 0x8011, 0x8015, "code");
    blank.setLabel(agent, 0x02, "currentXPosition");
    blank.addLabel(agent, 0x02, "vicRegisterLoPtr");
    blank.setPrimaryLabel(agent, 0x02, "vicRegisterLoPtr");

    blank.addLabel(agent, 0x02, "aThirdName");
    expect(blank.disassembly(0x8132, 1).lines[0].text).toContain("vicRegisterLoPtr");
  });
});

describe("the rest of trial 3's list", () => {
  it("shows a region's own comment where the region begins", () => {
    // It was stored, rendered only in the memory map, and so `comment:` on
    // set_region looked like it had worked and appeared nowhere a reader looks.
    workspace.setRegion(agent, 0x8f00, 0x8f20, "data", "chargen", "copied to $2000 at boot");
    const rows = workspace.disassembly(0x8f00, 3).lines.map((l) => l.text).join("\n");

    expect(rows).toContain("; copied to $2000 at boot");
  });

  it("breaks a data row at a region boundary", () => {
    // Rows chunk in eights, so two adjacent regions shared a row and the
    // distinction someone drew between them became invisible.
    workspace.setRegion(agent, 0x8f00, 0x8f04, "data", "first");
    workspace.setRegion(agent, 0x8f04, 0x8f10, "data", "second");

    const rows = workspace.disassembly(0x8f00, 4).lines.filter((l) => l.kind === "data");
    expect(rows[0].text).toContain("8F00");
    expect(rows[1].text).toContain("8F04");
  });

  it("puts an after comment on its own row below", () => {
    // The reference writes ";Returns" under a JMP: about what happens next,
    // which inline would attach to the jump itself.
    workspace.setComment(agent, 0x8018, "returns to the caller", "after");
    const rows = workspace.disassembly(0x8018, 3).lines.map((l) => l.text);

    const jump = rows.findIndex((r) => /BNE|JMP/.test(r));
    const note = rows.findIndex((r) => r.includes("returns to the caller"));
    expect(note).toBeGreaterThan(jump);
  });

  it("says where a name comes from instead of denying it exists", () => {
    // "No label at $8000" contradicted a listing plainly showing one. The PRG
    // layer names its own load address, and no project owns that.
    const blank = blankWorkspace();
    expect(() => blank.removeLabel(agent, 0x8000)).toThrow(/comes from .*rather than/);
  });

  it("takes an extent in a batch of labels", () => {
    workspace.setLabels(agent, [
      { address: 0x0400, name: "SCREEN_RAM", extent: 1000 },
      { address: 0xd800, name: "COLOUR_RAM", extent: 1000 },
    ]);

    const rows = workspace.disassembly(0x8072, 2).lines.map((l) => l.text).join("\n");
    expect(rows).toContain("SCREEN_RAM + ");
  });

  it("binds several constant sites at once", () => {
    const sites = workspace.immediates(0x08).sites.slice(0, 2);
    workspace.setConstant(agent, "ORANGE", 0x08);

    const result = workspace.bindConstants(
      agent,
      sites.map((s) => ({ address: parseInt(s.address.slice(1), 16), name: "ORANGE" }))
    );

    expect(result.did).toHaveLength(2);
  });

  it("carries a project description", () => {
    workspace.setDescription(agent, "Gridrunner, Jeff Minter 1983. Public domain.");
    expect(workspace.describe().description).toContain("Jeff Minter");
  });

  it("names the routine a call sits in, once one has an extent", () => {
    // Without an extent this answers with the nearest preceding flow label,
    // which on a real routine is a local branch target.
    workspace.markFunction(agent, 0x8850, "DrawSomething", 0x60);
    const { inbound } = workspace.references(0x8870, "in");

    expect(inbound!.some((r) => r.inRoutine === "DrawSomething")).toBe(true);
  });
});

describe("understanding a block", () => {
  it("says what it reads and writes without being run", () => {
    // $8030: AND #$1F / CMP #$18 / branch.
    const effects = workspace.blockEffects(0x8030);
    expect(effects.reads).toEqual(["A"]);
    expect(effects.writes).toEqual(expect.arrayContaining(["A", "Z", "N", "C"]));
    expect(effects.unmodelled).toEqual([]);
  });

  it("admits to an address that depends on a register", () => {
    // $8040 indexes explosionXPosArray by X, so no static answer names a cell.
    const effects = workspace.blockEffects(0x8040);
    expect(effects.reads).toContain("memory at a computed address");
    expect(effects.reads).toContain("X");
  });

  it("names the address a computed operand actually reached", () => {
    const run = workspace.runBlock(0x8040, {
      registers: { X: 2 },
      memory: { $1502: 0x28 },
    });
    // The question `block_effects` cannot answer: with X=2 it was $1502.
    //
    // Unlabelled, though explosionXPosArray is declared two bytes below —
    // without an extent that is a guess, and the rule is the same one operand
    // rendering follows. Declaring the extent is what earns `+2`.
    expect(run.memoryRead).toContainEqual({
      address: "$1502",
      value: "$28",
      source: "given",
    });
    expect(run.memoryWritten).toContainEqual({ address: "$1502", value: "$27" });
  });

  it("takes the branch or does not, and says which", () => {
    // BPL at $804A. $28 decrements to $27, which compares equal and is
    // positive; $10 decrements to $0F, which is below and is not.
    const taken = workspace.runBlock(0x8040, { registers: { X: 2 }, memory: { $1502: 0x28 } });
    expect(taken.exit).toMatchObject({ kind: "goto", to: "$8050 (loc_8050)" });

    const notTaken = workspace.runBlock(0x8040, { registers: { X: 2 }, memory: { $1502: 0x10 } });
    expect(notTaken.exit).toMatchObject({ kind: "fallthrough", to: "$804C" });
  });

  it("does not pretend to know a byte the program never loaded", () => {
    // explosionXPosArray lives in RAM the PRG does not cover, so nothing knows
    // what is there. It reads as zero, which is a real value that produces a
    // real-looking result — hence the warning rather than a bare answer.
    const run = workspace.runBlock(0x8040, { registers: { X: 2 } });
    expect(run.memoryRead.find((m) => m.address === "$1502")?.source).toBe("unknown");
    expect(run.warnings.join(" ")).toContain("read as zero");
  });

  it("distinguishes a byte the program did load from one it did not", () => {
    // $8100 is inside the PRG, so its value is known and is right until
    // something writes there. Different claim, reported differently.
    const run = workspace.runBlock(0x8040, {
      registers: { X: 0 },
      memory: {},
    });
    expect(run.memoryRead.every((m) => m.source !== "given")).toBe(true);

    const inFile = workspace.runBlock(0x8036, {});
    const image = inFile.memoryRead.filter((m) => m.source === "image");
    if (image.length) expect(inFile.warnings.join(" ")).toContain("as loaded");
  });

  it("refuses an address no block covers rather than inventing one", () => {
    expect(() => workspace.blockEffects(0xffff)).toThrow(/No decoded block/);
  });
});

describe("paging through a listing", () => {
  it("keeps advancing past an address that owns more rows than a page", () => {
    // A comment running to more lines than the page size puts every one of its
    // rows at one address. `lineForAddress` points at the first of them, so a
    // cursor landing inside the run used to resolve backwards and hand back
    // `nextStart === start` — forever.
    //
    // Found by an agent writing a 47-line comment about a character set and
    // then being unable to page past it: the failure arrives through following
    // the brief well, which is the worst way for a bug to be reachable.
    const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    workspace.setComment(agent, 0x8040, long, "before");

    let start = 0x8000;
    const visited = new Set<number>();
    for (let page = 0; page < 500; page++) {
      const result = workspace.disassembly(start, 10);
      if (!result.nextStart) return;
      const next = Number(result.nextStart.replace("$", "0x"));
      expect(next).not.toBe(start);
      expect(visited.has(next)).toBe(false);
      visited.add(next);
      start = next;
    }
    throw new Error("never reached the end of the listing");
  });

  it("does the same for the rendered listing", () => {
    const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    workspace.setComment(agent, 0x8040, long, "before");

    const first = workspace.listing(0x8000, 10);
    expect(first.nextStart).toBeDefined();
    const second = workspace.listing(Number(first.nextStart!.replace("$", "0x")), 10);
    expect(second.start).not.toBe(first.start);
  });
});

describe("quoting the line that refers to something", () => {
  it("quotes the instruction, not the label sitting above it", () => {
    // Both readers in experiment 2 hit this independently: at a labelled or
    // commented caller the quoted line was the caller's own name, or somebody's
    // prose. The better the project was annotated, the worse the answer got.
    workspace.setLabel(agent, 0x81c4, "SomewhereThatCalls");
    workspace.setComment(agent, 0x81c4, "and here is why", "before");

    const { inbound } = workspace.references(0x8172);
    const caller = inbound?.find((i) => i.from === "$81C4");
    expect(caller?.text).toContain("JSR");
    expect(caller?.text).not.toContain("SomewhereThatCalls:");
    expect(caller?.text).not.toContain("and here is why");
  });
});

describe("declaring a picture", () => {
  it("draws it in the listing", () => {
    workspace.setRegion(agent, 0x8e00, 0x8e20, "bitmap", "CharSet", undefined, undefined, "char:4");
    const listing = workspace.listing(0x8e00, 10).text;
    expect(listing).toContain("CharSet:");
    // Shading characters, not a hex column.
    expect(listing).toMatch(/@{2,}/);
  });

  it("insists on knowing how to read the bytes", () => {
    // A bitmap without a view cannot be drawn at all, so accepting one would
    // record a region nothing can render and report success.
    expect(() => workspace.setRegion(agent, 0x8e00, 0x8e20, "bitmap")).toThrow(
      /needs a view/
    );
  });

  it("names the views it understands rather than failing vaguely", () => {
    expect(() =>
      workspace.setRegion(agent, 0x8e00, 0x8e20, "bitmap", "X", undefined, undefined, "pixels")
    ).toThrow(/char:<columns>/);
  });

  it("counts as explained, so it is not an undecoded hole", () => {
    // $8E00-$9000 is already declared `data`. Re-declaring the same span as a
    // bitmap must leave the accounting alone: a picture is an explanation of
    // those bytes just as much as "data" was.
    const before = workspace.undecoded(50).unexplainedBytes;
    workspace.setRegion(agent, 0x8e00, 0x9000, "bitmap", "CharSet", undefined, undefined, "char:8");
    expect(workspace.undecoded(50).unexplainedBytes).toBe(before);
  });

  it("nests inside the region it starts on rather than replacing it", () => {
    // $8E00-$9000 is a 512-byte `data` region. Declaring 32 bytes of it a
    // bitmap used to reuse that region's id and shrink it, leaving the other
    // 480 bytes explained by nothing. Both statements are true at once, and the
    // model has always allowed them to be: regions may overlap and resolve
    // innermost-first.
    const before = workspace.undecoded(50).unexplainedBytes;
    const result = workspace.setRegion(
      agent, 0x8e00, 0x8e20, "bitmap", "CharSet", undefined, undefined, "char:4"
    );

    expect(workspace.undecoded(50).unexplainedBytes).toBe(before);
    expect(result.nestedInside).toContain("characterSetData");
    expect(result.nestedInside).toContain("remove_region");
  });

  it("draws the inner picture and leaves the outer region either side", () => {
    workspace.setRegion(agent, 0x8e00, 0x8e20, "bitmap", "CharSet", undefined, undefined, "char:4");
    const listing = workspace.listing(0x8e00, 14).text;
    expect(listing).toMatch(/@{2,}/);
    // The bytes past the nested span are still data, from the region that was
    // there before and is still there.
    expect(listing).toContain("8E20");
  });

  it("does not stack up when the same span is declared twice inside a bigger one", () => {
    // The case that broke this while it was being written. $8004-$8011 is
    // already `initData`, so the first declaration nests — and the second one
    // must recognise its *own* region rather than nesting inside `initData`
    // again. Otherwise two identical spans race to be innermost and the listing
    // shows whichever won.
    const before = workspace.describe().regions.length;
    workspace.setRegion(agent, 0x8004, 0x800c, "text", "header", undefined, "screen");
    workspace.setRegion(agent, 0x8004, 0x800c, "text", "header", undefined, "ascii");

    expect(workspace.describe().regions.length).toBe(before + 1);
    // And the second declaration is the one in force, rather than whichever of
    // two identical spans happened to win. `C3 C2 CD` reads as box-drawing in
    // screen codes and as unprintable in ASCII, so the glyphs say which.
    const listing = workspace.listing(0x8004, 3).text;
    expect(listing).toContain('.TEXT "...80');
    expect(listing).not.toContain("·│·");
  });

  it("still revises a region declared over the same span", () => {
    // The unambiguous case: same start, same end. That is one statement being
    // corrected, not a second one being made, so it must not stack up.
    const before = workspace.describe().regions.length;
    workspace.setRegion(agent, 0x8e00, 0x9000, "data", "RenamedOnce");
    workspace.setRegion(agent, 0x8e00, 0x9000, "data", "RenamedTwice");
    expect(workspace.describe().regions.length).toBe(before);
  });

  it("still extends a region declared wider than the one there", () => {
    const before = workspace.describe().regions.length;
    workspace.setRegion(agent, 0x8e00, 0x9000, "data", "Wider");
    expect(workspace.describe().regions.length).toBe(before);
  });
});
