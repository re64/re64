import { describe, it, expect } from "vitest";
import { buildMemoryMap, projectForTarget, withDefaultTarget } from "./loader.js";
import { Project } from "./project.js";
import { makeFileLoader } from "./file-source.js";

/**
 * A target is a memory map, not an allowlist.
 *
 * It says which layers are linked in, **in what order**, and where each one
 * lands. That is what makes a layer a dumb byte resource: it holds bytes and
 * knows nothing about where it sits.
 *
 * Two things follow that nothing could do before. Reordering the stack is a
 * target edit — the operation this project documented the *behaviour* of for a
 * long time with nothing able to perform it. And one layer can be linked into
 * two targets at two addresses, which is not hypothetical on this machine:
 * Revenge of the Mutant Camels moves its decruncher onto the stack page and
 * runs the same bytes from somewhere else.
 */
const bytes = (id: string, address: string, hex: string) => ({
  id,
  type: "bytes" as const,
  address,
  bytes: hex,
});

const project = (targets: Project["targets"], active: string): Project => ({
  layers: [bytes("lay_low", "$1000", "aa aa aa aa"), bytes("lay_high", "$1000", "bb bb bb bb")],
  targets,
  activeTarget: active,
});

const load = (p: Project) =>
  buildMemoryMap(projectForTarget(p), makeFileLoader(() => {
      throw new Error('these layers hold inline bytes, so nothing loads a file');
    }), { platform: false });

describe("the order of a target's links is the z-order", () => {
  it("gives the last-linked layer the address, not the first", () => {
    const first = load(project([{ name: "t", layers: ["lay_low", "lay_high"] }], "t"));
    expect(first.map.readByte(0x1000)).toBe(0xbb);
  });

  it("reorders the stack when the list is reordered, and nothing else changes", () => {
    // The whole of "reordering the layer stack moves annotations with the bytes
    // they describe" rests on this being performable. It never was: there is no
    // `layer.set`, and z-order lived on the project's own array.
    const swapped = load(project([{ name: "t", layers: ["lay_high", "lay_low"] }], "t"));
    expect(swapped.map.readByte(0x1000)).toBe(0xaa);
  });
});

describe("where a layer lands is a property of the link", () => {
  it("puts the same bytes at a different address in a different target", () => {
    // Not hypothetical: a decruncher that relocates itself onto the stack page
    // is the same resource read at two addresses, one per phase.
    const p = project(
      [
        { name: "asLoaded", layers: ["lay_low"] },
        { name: "asRun", layers: [{ layer: "lay_low", at: "$0100" }] },
      ],
      "asLoaded"
    );

    expect(load(p).map.readByte(0x1000)).toBe(0xaa);
    expect(load(p).map.readByte(0x0100)).toBeUndefined();

    const running = load({ ...p, activeTarget: "asRun" });
    expect(running.map.readByte(0x0100)).toBe(0xaa);
    // And it is no longer where it was: a link says where, not also where not.
    expect(running.map.readByte(0x1000)).toBeUndefined();
  });

  it("leaves the layer's own address alone when the link says nothing", () => {
    const p = project([{ name: "t", layers: ["lay_low"] }], "t");
    expect(load(p).map.readByte(0x1000)).toBe(0xaa);
  });
});

describe("what a target does with a link it cannot honour", () => {
  it("skips a layer the project no longer declares rather than refusing to load", () => {
    // Same rule as a dangling constant and a dangling type: a delete racing a
    // link heals itself, and nothing has to sweep.
    const p = project([{ name: "t", layers: ["lay_low", "lay_gone"] }], "t");
    expect(load(p).map.readByte(0x1000)).toBe(0xaa);
  });
});

describe("every project has a target, so there is one way to get a stack", () => {
  const bare = (): Project => ({
    name: "gridrunner",
    layers: [bytes("lay_a", "$1000", "aa"), bytes("lay_b", "$2000", "bb")],
    entryPoints: ["$1000"],
  });

  it("derives one for a file that declares none", () => {
    // Not synthesised-and-forgotten: this is what the *next write* persists, so
    // the derived target becomes a real object a reader can see and reorder.
    // Deriving it on every load and never persisting would be worse than the
    // seam it replaces — the thing deciding z-order would be invisible in the
    // file, absent from list_targets and unreachable by set_target.
    const withOne = withDefaultTarget(bare());
    expect(withOne.activeTarget).toBe("gridrunner");
    expect(withOne.targets).toHaveLength(1);
    expect(withOne.targets![0].layers).toEqual(["lay_a", "lay_b"]);
  });

  it("carries the project's entry points onto it, rather than dropping them", () => {
    // A target's list *replaces* the project's, so leaving them behind would
    // silently lose every entry point the moment a default target existed —
    // which on the reference project is the one address the walk starts from.
    expect(withDefaultTarget(bare()).targets![0].entryPoints).toEqual(["$1000"]);
  });

  it("changes nothing about what the stack is", () => {
    // The derivation is declaration order, so an un-migrated file loads exactly
    // as it did. That is the whole reason this can be done to 22 existing files
    // without moving a hash.
    const before = load({ ...bare(), targets: undefined });
    expect(before.map.readByte(0x1000)).toBe(0xaa);
    expect(before.map.readByte(0x2000)).toBe(0xbb);
    expect(before.prgEntries).toEqual([]);
  });

  it("selects the first phase when a file has targets but names none", () => {
    const p: Project = {
      ...bare(),
      targets: [
        { name: "runtime", layers: ["lay_b"], order: 2 },
        { name: "loader", layers: ["lay_a"], order: 1 },
      ],
      activeTarget: undefined,
    };
    // Ordered the way `list_targets` orders them, so a reader gets the one they
    // were shown first — a program starts at its loader.
    expect(withDefaultTarget(p).activeTarget).toBe("loader");
  });

  it("links a layer that has no id yet, by the id the loader will derive", () => {
    // Files without ids stay loadable. A target links *by id*, so a derivation
    // that drifted from the one layers get would drop every un-migrated layer
    // out of its own stack — which is what happened first.
    const noIds: Project = {
      layers: [{ type: "bytes", address: "$1000", bytes: "aa" }],
    };
    expect(load(noIds).map.readByte(0x1000)).toBe(0xaa);
  });
});
