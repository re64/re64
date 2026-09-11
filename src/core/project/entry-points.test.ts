import { describe, it, expect } from "vitest";
import { entryPointsIntoTarget, parseProject, Project } from "./project.js";
import { formatProject } from "./serialize.js";
import { derivedId, layerIdOf } from "./identity.js";

/**
 * **A root `entryPoints` list was a target's field stored in the wrong place.**
 *
 * It predates targets. The loader copied it into the implied target on every
 * load, `describe_project` read it, and no operation could write it — data with
 * readers and no verb. Giving it a verb would have put one setting in two homes,
 * which is how "entryPoints said 2 while decodeStartsFrom said 19" happened
 * once already. So it is moved into the place it belongs, at every boundary a
 * project enters, and never written back out.
 */
describe("a root entry-point list becomes a target", () => {
  const legacy = (): Project => ({
    name: "Old",
    layers: [
      { id: "lay_s", type: "symbols" },
      { id: "lay_p", type: "prg", path: "game.prg" },
      { type: "raw", path: "extra.bin", address: "$C000" },
    ],
    entryPoints: ["$8011", 0x9000],
  });

  it("gives a project with no targets one that holds the list", () => {
    const out = entryPointsIntoTarget(legacy());
    expect(out.entryPoints).toBeUndefined();
    expect(out.targets).toHaveLength(1);
    const [target] = out.targets!;
    expect(target.entryPoints).toEqual(["$8011", 0x9000]);
    expect(target.name).toBe("Old");
    // Byte layers only, in declaration order, under the ids the loader derives
    // — so a layer without one is linked by the same id it will be loaded as.
    expect(target.layers).toEqual(["lay_p", layerIdOf(legacy().layers[2], 2)]);
    // Derived, so every client that opens the same old file agrees on it.
    expect(target.id).toBe(derivedId("tgt", "entryPoints", "Old"));
  });

  it("drops the list where explicit targets already own theirs", () => {
    const out = entryPointsIntoTarget({
      ...legacy(),
      targets: [{ id: "tgt_a", name: "runtime", layers: ["lay_p"], entryPoints: ["$0801"] }],
    });
    expect(out.entryPoints).toBeUndefined();
    expect(out.targets).toEqual([
      { id: "tgt_a", name: "runtime", layers: ["lay_p"], entryPoints: ["$0801"] },
    ]);
  });

  it("leaves a project without one exactly as it was", () => {
    const plain: Project = { layers: [{ id: "lay_p", type: "prg", path: "g.prg" }] };
    expect(entryPointsIntoTarget(plain)).toBe(plain);
  });

  it("is applied at the file boundary, and the file is never written with one", () => {
    const parsed = parseProject(JSON.stringify(legacy()));
    expect(parsed.entryPoints).toBeUndefined();
    expect(parsed.targets![0].entryPoints).toEqual(["$8011", 0x9000]);

    const text = formatProject(legacy());
    expect(text).not.toMatch(/^  "entryPoints"/m);
    expect(parseProject(text).targets![0].entryPoints).toEqual(["$8011", 0x9000]);
  });
});
