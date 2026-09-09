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

  it("puts a rom layer in the export too", () => {
    // The same hole as the test above, one layer kind along: when `diffProjects`
    // was widened from symbols to prg and raw, `rom` stayed outside the list.
    // So a project could declare the ROMs, run against them, report them from
    // describe_project — and export a file that had never heard of them, which
    // is exactly the machine view that two experiments had to invent by hand.
    ws.createProject("camels");
    const camels = upload("camels", "tiny.prg", new Uint8Array([0x00, 0x80, 0xa9, 0x01, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "tiny.prg" });
    camels.addRomLayer(builder, "kernal");

    const exported = JSON.parse(camels.exportProject().text);
    expect(exported.layers).toContainEqual(
      expect.objectContaining({ type: "rom", rom: "kernal" })
    );
  });

  it("lays bytes given inline over the build they patch", () => {
    // The layer kind whose content is in the project rather than beside it. The
    // file format has always had it and no operation could make one, so a patch
    // meant uploading a file of three bytes and losing what it changed.
    ws.createProject("camels");
    const camels = upload("camels", "p.prg", new Uint8Array([0x00, 0x80, 0xa9, 0x01, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "p.prg", name: "build" });
    camels.addByteLayer(builder, {
      type: "bytes",
      address: 0x8000,
      bytes: "A9 02",
      name: "patch",
    });

    const ids = Object.fromEntries(camels.targets().layers.map((l) => [l.name, l.id]));
    camels.addTarget(builder, "stock", [{ layer: ids.build }]);
    camels.addTarget(builder, "patched", [{ layer: ids.build }, { layer: ids.patch }]);

    expect(camels.view("stock").bytes(0x8000, 3).hex.toUpperCase()).toBe("A9 01 60");
    expect(camels.view("patched").bytes(0x8000, 3).hex.toUpperCase()).toBe("A9 02 60");

    // And it survives the export, bytes and all — there is no file to fall back
    // on, so a layer.add that dropped them would lose the patch itself.
    const exported = JSON.parse(camels.exportProject().text);
    expect(exported.layers).toContainEqual(
      expect.objectContaining({ type: "bytes", address: "$8000", bytes: "A902" })
    );
  });

  it("refuses bytes that are not whole bytes of hex", () => {
    // A fact about the request, which is the one thing a write may refuse over.
    // `parseHexBytes` would have taken "A9 1" and stored a NaN.
    ws.createProject("camels");
    const camels = upload("camels", "p.prg", new Uint8Array([0x00, 0x80, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "p.prg" });

    expect(() =>
      camels.addByteLayer(builder, { type: "bytes", address: 0x8000, bytes: "A9 1" })
    ).toThrow(/not whole bytes of hex/);
    expect(() =>
      camels.addByteLayer(builder, { type: "bytes", address: 0x8000, bytes: "" })
    ).toThrow(/needs its bytes/);
    expect(() =>
      camels.addByteLayer(builder, { type: "bytes", bytes: "EA" })
    ).toThrow(/no load address of its own/);
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
    camels.addTarget(builder, "loader", [{ layer: ids.packed }]);
    camels.addTarget(builder, "runtime", [{ layer: ids.unpacked }]);

    // Everything, as before: the unpacked layer is on top and shadows the other.
    expect(camels.targets().total).toBe(2);
    expect(camels.targets().active).toBeUndefined();

    const loader = camels.view("loader").describe();
    expect(loader.layers).toHaveLength(1);
    expect(loader.layers[0].name).toBe("packed");

    expect(camels.view("runtime").describe().layers[0].name).toBe("unpacked");

    // Clearing the selection falls back to the first phase, not to "everything".
    // There is no everything: a stack is always a target's link list, and the
    // union of every layer was a stack the project never declared — packed and
    // unpacked shadowing each other in declaration order, which is exactly what
    // targets exist to replace.
    // Naming no view falls back to the project's declared default, and with
    // none declared that is the first phase. There is no "everything" stack.
    expect(camels.describe().layers).toHaveLength(1);
    expect(camels.describe().layers[0].name).toBe("packed");
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
    camels.addTarget(builder, "elsewhere", [{ layer: other }]);

    // Read through that view, without it becoming everybody's view: a workspace
    // *is* a view, so asking for another hands you another object rather than
    // moving anything. Experiment 7 left a whole target unread because reading
    // one meant changing it for everyone.
    expect(() => camels.view("elsewhere").runProgram(builder, 0x0801)).toThrow(
      /hiding the layer|no instruction to start/
    );
  });

  it("takes a layer back out, and a name does not hold it hostage", () => {
    // `layer.remove` used to refuse while the layer still held annotations, on
    // the grounds that removing it would destroy them. A layer holds none now —
    // it is a byte resource — so there is nothing to destroy and nothing to
    // refuse.
    //
    // What the name does is stop *resolving*, not stop existing. It is framed
    // on that layer, so with the layer gone there is no address to add its
    // offset to and it appears in no view. It is still in the project, and the
    // export proves it: the same rule as a dangling type, a dangling constant
    // and a dangling primaryLabels entry, where the reference outlives what it
    // points at and heals if that comes back.
    ws.createProject("camels");
    const camels = upload("camels", "p.prg", new Uint8Array([0x01, 0x08, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "p.prg", name: "scratch" });
    const id = camels.targets().layers.find((l) => l.name === "scratch")!.id;

    camels.addLabel(builder, 0x0801, "keepMe");
    camels.removeLayer(builder, id);

    expect(camels.targets().layers.map((l) => l.name)).not.toContain("scratch");
    expect(camels.labels({ namePattern: "keepMe" }).total).toBe(0);
    // Not destroyed — which is the half that matters, because destroying
    // somebody's work as a side effect of removing a layer is what this project
    // refuses everywhere.
    expect(camels.exportProject().text).toContain("keepMe");
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
    expect(over.warnings?.join(" ")).toMatch(/edit_claim/);

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

  it("orders and describes a target without restating its layers", () => {
    // A target list is a history — loader, then the image it expands into — so
    // order and description are what say that. Every field but the name is
    // optional and an omitted one is left alone: describing a target must not
    // restate its layers, or two people revising one revert each other, which
    // is the same edit working alone and failing together.
    ws.createProject("camels");
    const camels = upload("camels", "packed.prg", new Uint8Array([0x00, 0x08, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "packed.prg", name: "packed" });
    const packed = camels.targets().layers.find((l) => l.name === "packed")!.id;

    const { target } = camels.addTarget(builder, "loader", [{ layer: packed }]);
    // Revised by id and without restating the layers, which is the point of a
    // partial write: describing a target must not revert somebody's stack.
    camels.editTarget(builder, target, {
      order: 1,
      description: "The file as the disk loads it",
    });

    const [loader] = camels.targets().targets;
    // Links now, in z-order, rather than a bare list of ids: what a target
    // holds is a memory map, and the last entry shadows the ones before it.
    expect(loader.layers).toEqual([
      { id: expect.any(String), layer: packed, name: "packed" },
    ]);
    expect(loader.order).toBe(1);
    expect(loader.description).toBe("The file as the disk loads it");
  });

  it("lists targets in the order the program lives them", () => {
    ws.createProject("camels");
    const camels = upload("camels", "packed.prg", new Uint8Array([0x00, 0x08, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "packed.prg", name: "packed" });
    const packed = camels.targets().layers.find((l) => l.name === "packed")!.id;

    camels.addTarget(builder, "runtime", [{ layer: packed }], undefined, 2);
    camels.addTarget(builder, "loader", [{ layer: packed }], undefined, 1);

    expect(camels.targets().targets.map((t) => t.name)).toEqual(["loader", "runtime"]);
  });

  it("revises nothing it cannot find, rather than creating it", () => {
    // `add` and `set` used to be one call keyed by name, so revising a target
    // nobody had declared quietly made one — the upsert this vocabulary exists
    // to remove. An id nothing holds is not found.
    ws.createProject("camels");
    const camels = upload("camels", "packed.prg", new Uint8Array([0x00, 0x08, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "packed.prg" });

    expect(() => camels.editTarget(builder, "tgt_nope", { order: 1 })).toThrow(
      /No target tgt_nope/
    );
  });

  it("says a comment is already there, without refusing", () => {
    // All three readers in experiment 7 independently wrote a long comment at
    // $6700 about the same 200-byte stride. Nothing was lost — every comment at
    // an address is kept and rendered — but the third spent the effort twice
    // over for want of a sentence.
    ws.createProject("camels");
    const camels = upload("camels", "p.prg", new Uint8Array([0x01, 0x08, 0xa9, 0x01, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "p.prg" });

    const first = camels.addComment(builder, 0x0801, "The zone table strides 200 bytes");
    expect((first as { warnings?: string[] }).warnings ?? []).toEqual([]);

    const second = camels.addComment(builder, 0x0801, "Stride is 200; ADC #$C8 confirms it");
    expect((second as { warnings?: string[] }).warnings?.join(" ")).toMatch(
      /already had 1 comment/
    );
    // Kept beside, not instead of.
    expect(camels.comments(0x0801).comments).toHaveLength(2);
  });

  it("makes a routine of an entry point declared on a target", () => {
    // Routine roots came from labels typed function or entry, so a project that
    // says where execution begins structurally — on a target, with no label —
    // had no routine there, and call_graph refused its own first entry point.
    ws.createProject("camels");
    const camels = upload("camels", "p.prg", new Uint8Array([0x00, 0x80, 0xa9, 0x01, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "p.prg", name: "p" });
    const id = camels.targets().layers.find((l) => l.name === "p")!.id;
    camels.addTarget(builder, "runtime", [{ layer: id }], [0x8002]);
    
    const runtimeView = camels.view("runtime");

    expect(() => camels.callGraph(0x8002)).not.toThrow();
  });

  it("reads another view without selecting it for everybody", () => {
    // What experiment 7 measured was not contention over the shared selection
    // but *avoidance*: changing what two other people are reading so you can
    // glance at the packed loader is a cost nobody would pay, so the loader
    // went unread for the whole run. There is no selection now — a view is a
    // parameter of the request — so looking cannot cost anybody anything.
    ws.createProject("camels");
    const camels = upload("camels", "packed.prg", new Uint8Array([0x00, 0x80, 0xaa]));
    camels.addByteLayer(builder, { type: "prg", path: "packed.prg", name: "packed" });
    upload("camels", "runtime.prg", new Uint8Array([0x00, 0x80, 0xbb]));
    camels.addByteLayer(builder, { type: "prg", path: "runtime.prg", name: "runtime" });

    const ids = Object.fromEntries(camels.targets().layers.map((l) => [l.name, l.id]));
    camels.addTarget(builder, "loader", [{ layer: ids.packed }]);
    camels.addTarget(builder, "runtime", [{ layer: ids.runtime }]);
    expect(camels.view("runtime").bytes(0x8000, 1).hex.toLowerCase()).toBe("bb");
    expect(camels.view("loader").bytes(0x8000, 1).hex.toLowerCase()).toBe("aa");
    // Two views of one project are two objects, so neither can move the other
    // out from under it — which is also what a split-screen UI needs.
    expect(camels.view("runtime").bytes(0x8000, 1).hex.toLowerCase()).toBe("bb");
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
    camels.addTarget(builder, "runtime", [{ layer: packed }]);
    
    const runtimeView = camels.view("runtime");

    // $00FB is zero page: nothing supplies it, so this mints a symbols layer.
    camels.addLabel(builder, 0x00fb, "decrunchPointer");

    const named = camels
      .labels({ range: { start: 0x00fb, end: 0x00fc } })
      .labels.map((l) => l.name);
    expect(named, "the name is written but the target hides its layer").toContain(
      "decrunchPointer"
    );
  });

  // This was `it.fails` for exactly as long as claims were project-level and
  // unscoped: a name declared against the loader showed in the runtime target
  // too, because nothing tied it to the bytes it was about. Framing a claim on
  // its layer is what fixed it — the claim follows the layer into whichever
  // targets link it, and out of those that do not, which is the same rule that
  // makes annotations follow the stack said once and in one place.
  it("keeps a layer's annotations with the target that shows it", () => {
    ws.createProject("camels");
    const camels = upload("camels", "a.prg", new Uint8Array([0x00, 0x08, 0xa9, 0x01, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "a.prg", name: "first" });
    camels.addLabel(builder, 0x0800, "inTheLoader");

    const other = upload("camels", "b.prg", new Uint8Array([0x00, 0x08, 0xe8, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "b.prg", name: "second" });

    const ids = Object.fromEntries(camels.targets().layers.map((l) => [l.name, l.id]));
    camels.addTarget(builder, "loader", [{ layer: ids.first }]);
    camels.addTarget(builder, "runtime", [{ layer: ids.second }]);

    expect(camels.view("runtime").labels({ namePattern: "inTheLoader" }).total).toBe(0);
    expect(camels.view("loader").labels({ namePattern: "inTheLoader" }).total).toBe(1);
  });

  it("refuses a target naming a layer that is not there, and one with none", () => {
    ws.createProject("camels");
    const camels = upload("camels", "a.prg", new Uint8Array([0x00, 0x08, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "a.prg" });
    expect(() => camels.addTarget(builder, "bad", [{ layer: "lay_nope" }])).toThrow(/No layer/);
    expect(() => camels.addTarget(builder, "empty", [])).toThrow(/shows nothing/);
    // A view nothing declares is refused rather than silently answered for.
    expect(() => camels.view("missing").describe()).toThrow(/No target|missing/);
  });

  it("refuses to answer for a target that has been removed", () => {
    // There is no selection to drop any more — a view is a parameter of the
    // request, so removing a target cannot leave anything pointing at nothing.
    // What it does mean is that naming it afterwards is refused rather than
    // quietly answered for with a different stack.
    ws.createProject("camels");
    const camels = upload("camels", "a.prg", new Uint8Array([0x00, 0x08, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "a.prg" });
    const id = camels.targets().layers[0].id;
    const { target } = camels.addTarget(builder, "only", [{ layer: id }]);
    expect(camels.view("only").describe().layers).toHaveLength(1);

    // Removed by id. A view is *selected* by name — that is a read and may
    // resolve one — but a write names the thing it changes.
    camels.removeTarget(builder, target);
    expect(() => camels.view("only").describe()).toThrow(/No target/);
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

    // **Exact, not a lower bound.** This is the tripwire for the device bus: a
    // machine with no device installed must be flat 64K and must execute this
    // decruncher instruction for instruction as it always did. A range would
    // let a bus that quietly changed a read slip through.
    //
    // 1,768,854 — one more than `docs/decisions/machine.md` records. The prose
    // number was off by one and nothing pinned it, which is why it survived:
    // checked here by running the pre-change interpreter against the same
    // fixture and getting the same figure, so the bus is a genuine no-op and
    // the discrepancy is older than it.
    expect(run.instructions).toBe(1_768_854);
    expect(run.reason).toBe("left the program");
    // A KERNAL call, which is how this loader signals it has finished.
    expect(run.stoppedAt).toBe("$FFBA");
    expect(run.captured.bytes).toBe(2 + (0xc11f - 0x0800));

    // And the capture is an ordinary file, so the rest of the flow is unchanged.
    camels.addByteLayer(builder, { type: "prg", path: "decrunched.prg", name: "runtime" });
    const marked = camels.markFunction(builder, 0xc065, "Start");
    expect(marked.instructions.after).toBeGreaterThan(2000);
  });

  it("reports the address the caller passed, not the offset it was stored at", () => {
    // **The bug that hid a systematic displacement through three sessions.**
    // A claim is stored as an offset into the layer supplying its bytes, and a
    // write's `did` is the one place a writer looks to confirm what happened.
    // It resolved that offset back to an address by rebuilding the memory map
    // with a loader that refuses to read files — and a .prg layer's load
    // address is in the first two bytes of its file, so on every real project
    // it threw, the layer starts stayed empty, and every receipt reported the
    // offset instead: `name +$87FF` for a claim written at `$9000`.
    //
    // Eighty claims imported one load address low went unnoticed because the
    // receipt agreed with the mistake. Experiment 11's reviewer found the
    // displacement from the bytes, and named this as the reason nobody had.
    ws.createProject("camels");
    const camels = upload("camels", "p.prg", new Uint8Array([0x00, 0x80, 0xa9, 0x01, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "p.prg" });

    const named = camels.addClaim(builder, { at: 0x8002, name: "afterTheLoadAddress" });
    expect(named.did.join(" ")).toContain("$8002");
    expect(named.did.join(" ")).not.toContain("+$");

    // And the claim really is layer-framed, so this is the resolution working
    // rather than the frame having quietly stopped being used.
    const here = camels.claimsAt(0x8002);
    expect(here.claims[0].scope).toMatch(/^layer:/);
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
