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
afterEach(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });

/** What the HTTP route does once the bytes land, without a socket. */
function upload(projectId: string, name: string, bytes: Uint8Array): Workspace {
  const store = new SqliteStorage(databasePath, projectId);
  const space = new Workspace({
    store: new ProjectStore(store),
    storage: store,
    projectId,
    projectPath: databasePath,
  });
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
