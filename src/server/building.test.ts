import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workspace, Caller } from "./workspace.js";
import { ProjectStore, SqliteStorage, importProject } from "../store/index.js";

/**
 * Building a project from nothing but a disk image.
 *
 * Every experiment before this one handed agents a project that already
 * existed, so this path — upload a binary, look inside it, make a layer over
 * what is in there — had never been exercised end to end by anything but the
 * CLI.
 */
let dir: string, ws: Workspace, storage: SqliteStorage, databasePath: string;
const builder: Caller = { userId: "builder", label: "builder" };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "re64-build-"));
  const seed = join(dir, "seed.re64");
  writeFileSync(seed, JSON.stringify({ name: "seed", layers: [] }));
  const imported = importProject(seed);
  databasePath = imported.databasePath;
  storage = new SqliteStorage(databasePath, imported.projectId);
  ws = new Workspace({
    store: new ProjectStore(storage),
    storage,
    projectId: imported.projectId,
    projectPath: databasePath,
    baseUrl: "http://127.0.0.1:5164",
  });
});
afterEach(() => {
  for (const { storage: held } of opened.values()) held.close();
  opened.clear();
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * What the HTTP route does once the bytes land, without a socket.
 *
 * One Workspace per project, reused: two Workspaces over one database hold two
 * separate documents that do not see each other in-process, which is a property
 * of the design and not something a test should route around.
 */
const opened = new Map<string, { space: Workspace; storage: SqliteStorage }>();
function workspaceFor(projectId: string): { space: Workspace; storage: SqliteStorage } {
  const existing = opened.get(projectId);
  if (existing) return existing;
  const store = new SqliteStorage(databasePath, projectId);
  const made = {
    space: new Workspace({
      store: new ProjectStore(store),
      storage: store,
      projectId,
      projectPath: databasePath,
    }),
    storage: store,
  };
  opened.set(projectId, made);
  return made;
}

function upload(projectId: string, name: string, bytes: Uint8Array): Workspace {
  const { space, storage: store } = workspaceFor(projectId);
  const hash = store.putBlob(name, bytes);
  space.noteUploadedFile(builder, name, hash, bytes.length);
  return space;
}

describe("building a project from a disk image", () => {
  it("goes from nothing to a decoding program", () => {
    const made = ws.createProject("camels");
    expect(made.project).toBe("camels");

    const prepared = ws.prepareUpload(builder, "revenge.d64");
    expect(prepared.url).toContain("/api/upload/");
    expect(prepared.maxBytes).toBeGreaterThan(174848);

    const image = readFileSync("assets/mutant-camels/revenge-of-the-mutant-camels.d64");
    const camels = upload("camels", "revenge.d64", new Uint8Array(image));

    // The disk holds a crunched build: SYS 2061 into a decruncher, which is a
    // different binary from the standalone .prg the oracle disassembles.
    const disk = camels.diskFiles("revenge.d64");
    expect(disk.files.map((f) => f.name)).toContain("revenge fixed");
    expect(disk.files[0].path).toBe("revenge.d64:revenge fixed");

    camels.addByteLayer(builder, { type: "prg", path: "revenge.d64:revenge fixed" });

    // A BASIC stub decodes to almost nothing until somebody says where the
    // program really starts — which is the whole point of the exercise.
    const before = camels.describe();
    expect(before.entryPoints).toEqual(["$0801"]);
    expect(before.counts.instructions).toBeLessThan(10);

    const marked = camels.markFunction(builder, 0x080d, "Decrunch");
    expect(marked.instructions.delta).toBeGreaterThan(30);
  });

  it("puts the file and the byte layer in the export", () => {
    // diffProjects emitted `layer.add` only for symbols layers, from when that
    // was the only kind an operation could make. A byte layer reached the
    // document and never the file, so the next write naming it failed against a
    // text project that had never heard of it.
    ws.createProject("camels");
    const camels = upload("camels", "tiny.prg", new Uint8Array([0x00, 0x80, 0xa9, 0x01, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "tiny.prg" });

    const exported = JSON.parse(camels.exportProject().text);
    expect(exported.files).toEqual([
      { name: "tiny.prg", hash: expect.any(String), size: 5 },
    ]);
    expect(exported.layers[0]).toMatchObject({ type: "prg", path: "tiny.prg" });
  });

  it("reads one project as the bytes load, or as the program runs", () => {
    // The problem both builders hit on roughly their fifth call: the decrunched
    // image must shadow the packed file, so the project could show one or the
    // other and their loader annotations vanished into the shadow.
    ws.createProject("camels");
    const camels = upload("camels", "packed.prg", new Uint8Array([0x00, 0x08, 0xa9, 0x01, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "packed.prg", name: "packed" });

    const unpacked = upload("camels", "unpacked.prg", new Uint8Array([0x00, 0x08, 0xa2, 0x00, 0xe8, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "unpacked.prg", name: "unpacked" });

    const ids = Object.fromEntries(camels.targets().layers.map((l) => [l.name, l.id]));
    camels.setTarget(builder, "loader", [ids.packed]);
    camels.setTarget(builder, "runtime", [ids.unpacked]);

    // Everything, as before: the unpacked layer is on top and shadows the other.
    expect(camels.targets().total).toBe(2);
    expect(camels.targets().active).toBeUndefined();

    camels.selectTarget(builder, "loader");
    const loader = camels.describe();
    expect(loader.layers).toHaveLength(1);
    expect(loader.layers[0].name).toBe("packed");

    camels.selectTarget(builder, "runtime");
    expect(camels.describe().layers[0].name).toBe("unpacked");

    // And back to everything.
    camels.selectTarget(builder);
    expect(camels.describe().layers.length).toBeGreaterThan(1);
  });

  it("reports what a run wrote, including over bytes the project already had", () => {
    // The report was "ranges no layer supplied", described as usually the
    // output — and for a decruncher, which expands over the packed data in
    // place, that is precisely the ranges left out. Both builders in experiment
    // 5 built a memory model on it and both had to rebuild.
    ws.createProject("camels");
    // LDA #$AA / STA $0805 / RTS, overwriting its own last byte's neighbour.
    const camels = upload("camels", "p.prg", new Uint8Array([0x01, 0x08, 0xa9, 0xaa, 0x8d, 0x05, 0x08, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "p.prg", name: "p" });

    const run = camels.runProgram(builder, 0x0801) as {
      wrote: { start: string }[];
      wroteBeyondTheProject: { start: string }[];
    };
    // $0805 is inside the layer, so it used to appear nowhere at all.
    expect(run.wrote.map((r) => r.start)).toContain("$0805");
    expect(run.wroteBeyondTheProject.map((r) => r.start)).not.toContain("$0805");
  });

  it("refuses a run that never started, rather than calling it a run that left", () => {
    // run_program runs over the selected target, so a start address in a hidden
    // layer supplies no first instruction — and the stop rule is then true
    // immediately. It returned instructions: 0, "left the program", and a
    // cheerful capture hash.
    ws.createProject("camels");
    const camels = upload("camels", "p.prg", new Uint8Array([0x01, 0x08, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "p.prg", name: "p" });
    upload("camels", "other.prg", new Uint8Array([0x00, 0x90, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "other.prg", name: "other" });

    // A target holding only the *other* layer, so $0801 is supplied by nothing.
    const other = camels.targets().layers.find((l) => l.name === "other")!.id;
    camels.setTarget(builder, "elsewhere", [other]);
    camels.selectTarget(builder, "elsewhere");

    expect(() => camels.runProgram(builder, 0x0801)).toThrow(/hiding the layer|no instruction to start/);
  });

  it("takes a layer back out, and refuses while it still holds anything", () => {
    // layer.remove existed all along and no tool reached it, so a project kept
    // every scratch layer anybody made.
    ws.createProject("camels");
    const camels = upload("camels", "p.prg", new Uint8Array([0x01, 0x08, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "p.prg", name: "scratch" });
    const id = camels.targets().layers.find((l) => l.name === "scratch")!.id;

    camels.addLabel(builder, 0x0801, "keepMe");
    expect(() => camels.removeLayer(builder, id)).toThrow(/still holds 1 annotation/);

    camels.removeLabel(builder, camels.labels().labels.find((l) => l.name === "keepMe")!.id!);
    camels.removeLayer(builder, id);
    expect(camels.targets().layers.map((l) => l.name)).not.toContain("scratch");
  });

  it("adds beside a name somebody chose, and says so", () => {
    // It used to reuse the id already there, so it renamed rather than added:
    // 74 addresses had a name replaced by another reader in experiment 7, 123
    // names lost, nobody told. The document could always hold both.
    ws.createProject("camels");
    const camels = upload("camels", "p.prg", new Uint8Array([0x01, 0x08, 0xa9, 0x01, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "p.prg" });

    camels.addLabel(builder, 0x0801, "waveTable");
    const over = camels.addLabel(builder, 0x0801, "zoneTable") as { warnings?: string[] };
    expect(over.warnings?.join(" ")).toMatch(/already had "waveTable"/);
    expect(over.warnings?.join(" ")).toMatch(/rename_label/);

    // Both survive, and the one that was there still renders.
    const here = camels.labels({ range: { start: 0x0801, end: 0x0802 } }).labels.map((l) => l.name);
    expect(here).toContain("waveTable");
    expect(here).toContain("zoneTable");
  });

  it("stays quiet when the name it replaced was invented", () => {
    // Renaming an auto `dat_XXXX` is the ordinary act and must not warn, or the
    // signal is noise on the first day of any project.
    ws.createProject("camels");
    const camels = upload("camels", "p.prg", new Uint8Array([0x01, 0x08, 0xa9, 0x01, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "p.prg" });

    const first = camels.addLabel(builder, 0x0803, "loadOne") as { warnings?: string[] };
    expect(first.warnings ?? []).toEqual([]);
  });

  it("reports a label's extent, which any writer can set", () => {
    ws.createProject("camels");
    const camels = upload("camels", "p.prg", new Uint8Array([0x01, 0x08, 0xa9, 0x01, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "p.prg" });
    camels.addLabel(builder, 0x0801, "table", "address", undefined, 4);

    const found = camels.labels().labels.find((l) => l.name === "table");
    expect(found?.extent).toBe(4);
  });

  it("does not hide the symbols layer a name had to create", () => {
    // A target is an allowlist of layer ids, so a layer made *after* one exists
    // falls outside it — and naming a byteless address makes exactly that layer,
    // as part of the write that needed it. In experiment 5 a builder named zero
    // page under a selected target, was told the writes succeeded, and found
    // `list_labels` still returning the auto name.
    ws.createProject("camels");
    const camels = upload("camels", "packed.prg", new Uint8Array([0x00, 0x08, 0xa9, 0x01, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "packed.prg", name: "packed" });

    const packed = camels.targets().layers.find((l) => l.name === "packed")!.id;
    camels.setTarget(builder, "runtime", [packed]);
    camels.selectTarget(builder, "runtime");

    // $00FB is zero page: nothing supplies it, so this mints a symbols layer.
    camels.addLabel(builder, 0x00fb, "decrunchPointer");

    const named = camels
      .labels({ range: { start: 0x00fb, end: 0x00fc } })
      .labels.map((l) => l.name);
    expect(named, "the name is written but the target hides its layer").toContain(
      "decrunchPointer"
    );
  });

  it("keeps a layer's annotations with the target that shows it", () => {
    // Annotations belong to layers, so they follow activation. That is the rule
    // working rather than data going missing — which is what it looked like
    // when there was no way to name the other view.
    ws.createProject("camels");
    const camels = upload("camels", "a.prg", new Uint8Array([0x00, 0x08, 0xa9, 0x01, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "a.prg", name: "first" });
    camels.addLabel(builder, 0x0800, "inTheLoader");

    const other = upload("camels", "b.prg", new Uint8Array([0x00, 0x08, 0xe8, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "b.prg", name: "second" });

    const ids = Object.fromEntries(camels.targets().layers.map((l) => [l.name, l.id]));
    camels.setTarget(builder, "loader", [ids.first]);
    camels.setTarget(builder, "runtime", [ids.second]);

    camels.selectTarget(builder, "runtime");
    expect(camels.labels({ namePattern: "inTheLoader" }).total).toBe(0);

    camels.selectTarget(builder, "loader");
    expect(camels.labels({ namePattern: "inTheLoader" }).total).toBe(1);
  });

  it("refuses a target naming a layer that is not there, and one with none", () => {
    ws.createProject("camels");
    const camels = upload("camels", "a.prg", new Uint8Array([0x00, 0x08, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "a.prg" });
    expect(() => camels.setTarget(builder, "bad", ["lay_nope"])).toThrow(/No layer/);
    expect(() => camels.setTarget(builder, "empty", [])).toThrow(/shows nothing/);
    expect(() => camels.selectTarget(builder, "missing")).toThrow(/No target/);
  });

  it("drops the selection when the selected target is removed", () => {
    // A selection pointing at nothing reads as a filter that silently does
    // nothing, which is worse than no selection at all.
    ws.createProject("camels");
    const camels = upload("camels", "a.prg", new Uint8Array([0x00, 0x08, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "a.prg" });
    const id = camels.targets().layers[0].id;
    camels.setTarget(builder, "only", [id]);
    camels.selectTarget(builder, "only");
    expect(camels.targets().active).toBe("only");

    camels.removeTarget(builder, "only");
    expect(camels.targets().active).toBeUndefined();
  });

  it("runs the real decruncher and captures what it produced", () => {
    // The whole point: both builders in experiment 5 wrote their own 6502
    // interpreter to get past this, because static analysis of a crunched disk
    // stops at 141 instructions. re64 already owned a CPU that passes the
    // functional suite; it lacked a driver.
    ws.createProject("camels");
    const image = readFileSync("assets/mutant-camels/revenge-of-the-mutant-camels.d64");
    const camels = upload("camels", "revenge.d64", new Uint8Array(image));
    camels.addByteLayer(builder, { type: "prg", path: "revenge.d64:revenge fixed" });

    const run = camels.runProgram(builder, 0x080d, {
      capture: { name: "decrunched.prg", from: 0x0800, to: 0xc11f },
    }) as {
      instructions: number;
      reason: string;
      stoppedAt: string;
      captured: { file: string; bytes: number };
    };

    expect(run.instructions).toBeGreaterThan(1_700_000);
    expect(run.reason).toBe("left the program");
    // A KERNAL call, which is how this loader signals it has finished.
    expect(run.stoppedAt).toBe("$FFBA");
    expect(run.captured.bytes).toBe(2 + (0xc11f - 0x0800));

    // And the capture is an ordinary file, so the rest of the flow is unchanged.
    camels.addByteLayer(builder, { type: "prg", path: "decrunched.prg", name: "runtime" });
    const marked = camels.markFunction(builder, 0xc065, "Start");
    expect(marked.instructions.after).toBeGreaterThan(2000);
  });

  it("refuses a layer over a file the project does not hold", () => {
    ws.createProject("camels");
    const camels = upload("camels", "there.prg", new Uint8Array([0x00, 0x80, 0x60]));
    expect(() => camels.addByteLayer(builder, { type: "prg", path: "missing.prg" })).toThrow(
      /holds no file/i
    );
  });

  it("refuses a raw layer with no address, since it carries none of its own", () => {
    ws.createProject("camels");
    const camels = upload("camels", "bytes.bin", new Uint8Array([1, 2, 3]));
    expect(() => camels.addByteLayer(builder, { type: "raw", path: "bytes.bin" })).toThrow(
      /needs one/i
    );
  });
});
