import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ProjectSession } from "./session.js";

/**
 * The browser's copy of the project, and its undo stack.
 *
 * These edits are not text the user typed — they are model operations, each
 * carrying the one that reverses it. Nothing here had a test, which for undo is
 * the wrong thing to leave unproven: a wrong inverse silently corrupts a
 * project rather than failing loudly.
 *
 * The network is stubbed rather than mocked away entirely, so `open` runs the
 * real fetch-and-build path the browser runs.
 */

const PROJECT = readFileSync("assets/gridrunner.re64", "utf-8");
const PRG = readFileSync("assets/gridrunner.prg");

let saved: { raw: string; baseVersion: string } | undefined;

beforeEach(() => {
  saved = undefined;
  let stored = PROJECT;

  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://localhost");

    if (url.pathname === "/api/project" && init?.method === "PUT") {
      saved = JSON.parse(String(init.body));
      stored = saved!.raw;
      return new Response(JSON.stringify({ ok: true, version: "v2", applied: 1 }));
    }
    if (url.pathname === "/api/project") {
      return new Response(JSON.stringify({ raw: stored, version: "v1" }));
    }
    if (url.pathname === "/api/blob") {
      return new Response(new Uint8Array(PRG));
    }
    return new Response("not found", { status: 404 });
  });
});

afterEach(() => vi.unstubAllGlobals());

const labelAt = (s: ProjectSession, address: number) =>
  s.loaded.map.getLabels().getLabelsAt(address)[0]?.name;

describe("undo", () => {
  it("puts the text back exactly, byte for byte", async () => {
    const session = await ProjectSession.open();
    await session.setLabel(0x8100, "Renamed", undefined);
    expect(session.raw).not.toBe(PROJECT);

    expect(await session.undo()).toBe("set $8100 to Renamed");
    expect(session.raw).toBe(PROJECT);
  });

  it("rebuilds the model, not just the text", async () => {
    // The whole point of undo here: the disassembly has to follow.
    const session = await ProjectSession.open();
    const before = labelAt(session, 0x8100);

    await session.setLabel(0x8100, "Renamed", undefined);
    expect(labelAt(session, 0x8100)).toBe("Renamed");

    await session.undo();
    expect(labelAt(session, 0x8100)).toBe(before);
  });

  it("walks back through a series of edits, most recent first", async () => {
    const session = await ProjectSession.open();
    await session.setLabel(0x8100, "One", undefined);
    await session.setLabel(0x81a2, "Two", undefined);

    expect(await session.undo()).toBe("set $81A2 to Two");
    expect(await session.undo()).toBe("set $8100 to One");
    expect(session.raw).toBe(PROJECT);
  });

  it("reports there is nothing left rather than throwing", async () => {
    const session = await ProjectSession.open();
    expect(await session.undo()).toBeUndefined();
  });

  it("restores a label it deleted, with its type and position", async () => {
    const session = await ProjectSession.open();
    await session.removeLabel(0x8100);
    expect(labelAt(session, 0x8100)).not.toBe("InitializeGame");

    await session.undo();
    expect(session.raw).toBe(PROJECT);
  });

  it("names what it would revert before doing it", async () => {
    const session = await ProjectSession.open();
    expect(session.undoDescription()).toBeUndefined();

    await session.setLabel(0x8100, "Renamed", undefined);
    expect(session.undoDescription()).toBe("set $8100 to Renamed");
  });
});

describe("redo", () => {
  it("reapplies what was undone", async () => {
    const session = await ProjectSession.open();
    await session.setLabel(0x8100, "Renamed", undefined);
    const edited = session.raw;

    await session.undo();
    expect(await session.redo()).toBe("set $8100 to Renamed");
    expect(session.raw).toBe(edited);
  });

  it("has nothing to reapply until something is undone", async () => {
    const session = await ProjectSession.open();
    await session.setLabel(0x8100, "Renamed", undefined);
    expect(session.redoDescription()).toBeUndefined();
    expect(await session.redo()).toBeUndefined();
  });

  it("is discarded by a fresh edit, as every editor does", async () => {
    const session = await ProjectSession.open();
    await session.setLabel(0x8100, "One", undefined);
    await session.undo();

    await session.setLabel(0x81a2, "Two", undefined);
    expect(session.redoDescription()).toBeUndefined();
  });
});

describe("saving", () => {
  it("sends the text it holds, against the version it loaded", async () => {
    const session = await ProjectSession.open();
    await session.setLabel(0x8100, "Renamed", undefined);
    await session.save();

    expect(saved?.baseVersion).toBe("v1");
    expect(saved?.raw).toContain("Renamed");
  });

  it("keeps an undo to a one-line diff", async () => {
    // The property the whole serializer exists for, checked from the browser's
    // side: an edit and its undo must not reflow the file.
    const session = await ProjectSession.open();
    await session.setLabel(0x8100, "Renamed", undefined);

    const before = PROJECT.split("\n");
    const after = session.raw.split("\n");
    expect(after.length).toBe(before.length);
    expect(before.filter((l, i) => l !== after[i])).toHaveLength(1);
  });
});
