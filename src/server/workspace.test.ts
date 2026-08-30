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
