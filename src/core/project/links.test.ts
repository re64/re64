import { describe, it, expect } from "vitest";
import { buildMemoryMap, projectForTarget } from "./loader.js";
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
