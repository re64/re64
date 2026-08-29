import { describe, it, expect } from "vitest";
import { buildRegionTree } from "./map-view.js";
import { createUserRegion } from "../index.js";

describe("buildRegionTree", () => {
  it("nests a region inside the one containing it", () => {
    const tree = buildRegionTree([
      createUserRegion("rgn_8000", 0x8000, 0x9000, "data", "outer"),
      createUserRegion("rgn_8100", 0x8100, 0x8200, "text", "inner"),
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("outer");
    expect(tree[0].children.map((c) => c.name)).toEqual(["inner"]);
  });

  it("nests several levels deep", () => {
    const tree = buildRegionTree([
      createUserRegion("rgn_8000", 0x8000, 0x9000, "data", "a"),
      createUserRegion("rgn_8100", 0x8100, 0x8800, "data", "b"),
      createUserRegion("rgn_8200", 0x8200, 0x8300, "text", "c"),
    ]);

    expect(tree[0].name).toBe("a");
    expect(tree[0].children[0].name).toBe("b");
    expect(tree[0].children[0].children[0].name).toBe("c");
  });

  it("keeps adjacent same-kind regions as distinct siblings", () => {
    // The case that ruled out a flat per-address type array: these must not
    // merge into one run, because the user drew the boundary deliberately.
    const tree = buildRegionTree([
      createUserRegion("rgn_8cb5", 0x8cb5, 0x8cd5, "data", "noOfDroidSquads"),
      createUserRegion("rgn_8cd5", 0x8cd5, 0x8cf6, "data", "sizeOfDroidSquads"),
      createUserRegion("rgn_8cf6", 0x8cf6, 0x8d18, "data", "laserFrameRate"),
    ]);

    expect(tree.map((n) => n.name)).toEqual([
      "noOfDroidSquads",
      "sizeOfDroidSquads",
      "laserFrameRate",
    ]);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });

  it("sorts siblings by address regardless of declaration order", () => {
    const tree = buildRegionTree([
      createUserRegion("rgn_8800", 0x8800, 0x8900, "data", "later"),
      createUserRegion("rgn_8000", 0x8000, 0x8100, "data", "earlier"),
    ]);

    expect(tree.map((n) => n.name)).toEqual(["earlier", "later"]);
  });

  it("leaves merely-overlapping regions as siblings", () => {
    // Neither contains the other, so neither can honestly be the parent.
    const tree = buildRegionTree([
      createUserRegion("rgn_8000", 0x8000, 0x8200, "data", "left"),
      createUserRegion("rgn_8100", 0x8100, 0x8300, "text", "right"),
    ]);

    expect(tree).toHaveLength(2);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });

  it("carries the comment through for display", () => {
    const tree = buildRegionTree([
      createUserRegion("rgn_8000", 0x8000, 0x8100, "data", "table", "sprite frames"),
    ]);

    expect(tree[0].comment).toBe("sprite frames");
  });

  it("returns nothing for a layer with no declared regions", () => {
    expect(buildRegionTree([])).toEqual([]);
  });
});
