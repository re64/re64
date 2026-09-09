import { describe, it, expect } from "vitest";
import { buildMemoryMap, projectForTarget, withSyntheticTarget } from "./loader.js";
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

const project = (targets: Project["targets"], active: string): Project & { active: string } => ({
  layers: [bytes("lay_low", "$1000", "aa aa aa aa"), bytes("lay_high", "$1000", "bb bb bb bb")],
  targets,
  active,
});

// Narrowed by `buildMemoryMap` itself, which is the one path to a stack — the
// test used to pre-narrow and hand the result back in, which worked only
// because the selected view rode along on the project as `defaultTarget`.
const load = (p: Project & { active?: string }) =>
  buildMemoryMap(p, makeFileLoader(() => {
      throw new Error('these layers hold inline bytes, so nothing loads a file');
    }), { platform: false, ...(p.active === undefined ? {} : { target: p.active }) });

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

    const running = load({ ...p, active: "asRun" });
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
    const withOne = withSyntheticTarget(bare());
    expect(withOne.targets).toHaveLength(1);
    expect(withOne.targets![0].name).toBe("gridrunner");
    expect(withOne.targets![0].layers).toEqual(["lay_a", "lay_b"]);
  });

  it("carries the project's entry points onto it, rather than dropping them", () => {
    // A target's list *replaces* the project's, so leaving them behind would
    // silently lose every entry point the moment a default target existed —
    // which on the reference project is the one address the walk starts from.
    expect(withSyntheticTarget(bare()).targets![0].entryPoints).toEqual(["$1000"]);
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

  it("refuses to choose when a file has several targets and names none", () => {
    // **It used to choose, and choosing was the bug.** `defaultTarget` picked the
    // first by `order`, so every call that named no view was answered through
    // `loader` — one layer — and the Camels silver image, which declares five,
    // reported that claims framed on the runtime layer did not exist. Which view
    // you look through is a property of the looker.
    const p: Project = {
      ...bare(),
      targets: [
        { name: "runtime", layers: ["lay_b"], order: 2 },
        { name: "loader", layers: ["lay_a"], order: 1 },
      ],
    };
    expect(() => projectForTarget(withSyntheticTarget(p))).toThrow(/named none/);
    // Named, it answers; and a name nothing declares is refused rather than
    // quietly replaced by one that is.
    expect(projectForTarget(p, "runtime").layers.map((l) => l.id)).toEqual(["lay_b"]);
    expect(() => projectForTarget(p, "nope")).toThrow(/No target/);
  });

  it("does not make a project with one target say which", () => {
    // There is no choice to make, so making the caller state one would be
    // ceremony. The refusal above is about ambiguity, not about targets.
    const one = withSyntheticTarget(bare());
    expect(projectForTarget(one).layers).toHaveLength(2);
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

describe("a target frame names a target by id", () => {
  /**
   * **Two findings, one cause: a reference in the document that was not an id.**
   *
   * A target frame stored the target's *name*. So renaming a target orphaned
   * every claim framed on it, silently — and nothing ever asked whether a
   * target-framed claim belonged to the target being read, so a claim saying
   * "in the runtime arrangement, `$02` is the border colour" appeared in every
   * other arrangement of the same program too.
   *
   * The rule this project already had — "an address, a name, a span or a slot
   * never identifies anything; only an id does" — was written about *write
   * keying*. It is really about references, and the document was breaking it.
   */
  const twoTargets = (): Project => ({
    name: "phases",
    layers: [bytes("lay_a", "$1000", "aa"), bytes("lay_b", "$2000", "bb")],
    targets: [
      { id: "tgt_a", name: "loader", layers: ["lay_a"] },
      { id: "tgt_b", name: "runtime", layers: ["lay_b"] },
    ],
    claims: [
      { id: "clm_zp", at: "$0002", target: "tgt_a", name: "borderColour", origin: "user" },
    ],
  });

  const inView = (p: Project, target: string) =>
    buildMemoryMap(p, makeFileLoader(() => {
      throw new Error("these layers hold inline bytes");
    }), { platform: false, target });

  it("shows a target-framed claim in its own target and in no other", () => {
    expect(inView(twoTargets(), "loader").claims.map((c) => c.id)).toContain("clm_zp");
    expect(inView(twoTargets(), "runtime").claims.map((c) => c.id)).not.toContain("clm_zp");
  });

  it("keeps the claim when the target is renamed, because the frame holds an id", () => {
    const renamed = twoTargets();
    renamed.targets![0] = { ...renamed.targets![0], name: "packed" };
    // The reader names the new name; the claim is still framed on the same id.
    expect(inView(renamed, "packed").claims.map((c) => c.id)).toContain("clm_zp");
    // And by id, which is what the document itself holds.
    expect(inView(renamed, "tgt_a").claims.map((c) => c.id)).toContain("clm_zp");
  });

  it("still loads a file that framed on a name, so nothing written earlier is lost", () => {
    // Read as a legacy alias rather than dropped — the same latitude ids get
    // everywhere here: files without them stay loadable and the next write
    // persists a real one.
    const legacy = twoTargets();
    legacy.claims![0] = { ...legacy.claims![0], target: "loader" };
    expect(inView(legacy, "loader").claims.map((c) => c.id)).toContain("clm_zp");
    expect(inView(legacy, "runtime").claims.map((c) => c.id)).not.toContain("clm_zp");
  });

  it("takes an id or a unique name for the view itself, and refuses an ambiguous name", () => {
    const p = twoTargets();
    expect(inView(p, "tgt_b").map.readByte(0x2000)).toBe(0xbb);
    expect(inView(p, "runtime").map.readByte(0x2000)).toBe(0xbb);

    const twins = twoTargets();
    twins.targets![1] = { ...twins.targets![1], name: "loader" };
    expect(() => inView(twins, "loader")).toThrow(/Two targets/);
    // The ids still say which, which is the point of having them.
    expect(inView(twins, "tgt_b").map.readByte(0x2000)).toBe(0xbb);
  });
});
