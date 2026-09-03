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

  it("keeps a layer's annotations with the target that shows it", () => {
    // Annotations belong to layers, so they follow activation. That is the rule
    // working rather than data going missing — which is what it looked like
    // when there was no way to name the other view.
    ws.createProject("camels");
    const camels = upload("camels", "a.prg", new Uint8Array([0x00, 0x08, 0xa9, 0x01, 0x60]));
    camels.addByteLayer(builder, { type: "prg", path: "a.prg", name: "first" });
    camels.setLabel(builder, 0x0800, "inTheLoader");

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
