import { describe, it, expect } from "vitest";
import { buildRegionTree } from "./map-view.js";
import { createUserRegion } from "../index.js";

describe("buildRegionTree", () => {
  it("nests a region inside the one containing it", () => {
    const tree = buildRegionTree([
      createUserRegion({ id: "rgn_8000", start: 0x8000, end: 0x9000, kind: "data", name: "outer" }),
      createUserRegion({ id: "rgn_8100", start: 0x8100, end: 0x8200, kind: "text", name: "inner" }),
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("outer");
    expect(tree[0].children.map((c) => c.name)).toEqual(["inner"]);
  });

  it("nests several levels deep", () => {
    const tree = buildRegionTree([
      createUserRegion({ id: "rgn_8000", start: 0x8000, end: 0x9000, kind: "data", name: "a" }),
      createUserRegion({ id: "rgn_8100", start: 0x8100, end: 0x8800, kind: "data", name: "b" }),
      createUserRegion({ id: "rgn_8200", start: 0x8200, end: 0x8300, kind: "text", name: "c" }),
    ]);

    expect(tree[0].name).toBe("a");
    expect(tree[0].children[0].name).toBe("b");
    expect(tree[0].children[0].children[0].name).toBe("c");
  });

  it("keeps adjacent same-kind regions as distinct siblings", () => {
    // The case that ruled out a flat per-address type array: these must not
    // merge into one run, because the user drew the boundary deliberately.
    const tree = buildRegionTree([
      createUserRegion({ id: "rgn_8cb5", start: 0x8cb5, end: 0x8cd5, kind: "data", name: "noOfDroidSquads" }),
      createUserRegion({ id: "rgn_8cd5", start: 0x8cd5, end: 0x8cf6, kind: "data", name: "sizeOfDroidSquads" }),
      createUserRegion({ id: "rgn_8cf6", start: 0x8cf6, end: 0x8d18, kind: "data", name: "laserFrameRate" }),
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
      createUserRegion({ id: "rgn_8800", start: 0x8800, end: 0x8900, kind: "data", name: "later" }),
      createUserRegion({ id: "rgn_8000", start: 0x8000, end: 0x8100, kind: "data", name: "earlier" }),
    ]);

    expect(tree.map((n) => n.name)).toEqual(["earlier", "later"]);
  });

  it("leaves merely-overlapping regions as siblings", () => {
    // Neither contains the other, so neither can honestly be the parent.
    const tree = buildRegionTree([
      createUserRegion({ id: "rgn_8000", start: 0x8000, end: 0x8200, kind: "data", name: "left" }),
      createUserRegion({ id: "rgn_8100", start: 0x8100, end: 0x8300, kind: "text", name: "right" }),
    ]);

    expect(tree).toHaveLength(2);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });

  it("carries the comment through for display", () => {
    const tree = buildRegionTree([
      createUserRegion({ id: "rgn_8000", start: 0x8000, end: 0x8100, kind: "data", name: "table", comment: "sprite frames" }),
    ]);

    expect(tree[0].comment).toBe("sprite frames");
  });

  it("returns nothing for a layer with no declared regions", () => {
    expect(buildRegionTree([])).toEqual([]);
  });
});
