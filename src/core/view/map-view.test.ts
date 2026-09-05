import { describe, it, expect } from "vitest";
import { buildRegionTree } from "./map-view.js";
import { Claim, Interpretation } from "../claims/model.js";

/** A span somebody declared, as the tree takes them. */
const span = (
  id: string,
  start: number,
  end: number,
  is: Interpretation["is"],
  name?: string
): Claim => ({
  id,
  at: start,
  extent: end - start,
  says: { is } as Interpretation,
  ...(name ? { name } : {}),
  by: { author: "test", source: "user" },
});

describe("buildRegionTree", () => {
  it("nests a region inside the one containing it", () => {
    const tree = buildRegionTree([
      span("rgn_8000", 0x8000, 0x9000, "data", "outer"),
      span("rgn_8100", 0x8100, 0x8200, "text", "inner"),
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("outer");
    expect(tree[0].children.map((c) => c.name)).toEqual(["inner"]);
  });

  it("nests several levels deep", () => {
    const tree = buildRegionTree([
      span("rgn_8000", 0x8000, 0x9000, "data", "a"),
      span("rgn_8100", 0x8100, 0x8800, "data", "b"),
      span("rgn_8200", 0x8200, 0x8300, "text", "c"),
    ]);

    expect(tree[0].name).toBe("a");
    expect(tree[0].children[0].name).toBe("b");
    expect(tree[0].children[0].children[0].name).toBe("c");
  });

  it("keeps adjacent same-kind regions as distinct siblings", () => {
    // The case that ruled out a flat per-address type array: these must not
    // merge into one run, because the user drew the boundary deliberately.
    const tree = buildRegionTree([
      span("rgn_8cb5", 0x8cb5, 0x8cd5, "data", "noOfDroidSquads"),
      span("rgn_8cd5", 0x8cd5, 0x8cf6, "data", "sizeOfDroidSquads"),
      span("rgn_8cf6", 0x8cf6, 0x8d18, "data", "laserFrameRate"),
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
      span("rgn_8800", 0x8800, 0x8900, "data", "later"),
      span("rgn_8000", 0x8000, 0x8100, "data", "earlier"),
    ]);

    expect(tree.map((n) => n.name)).toEqual(["earlier", "later"]);
  });

  it("leaves merely-overlapping regions as siblings", () => {
    // Neither contains the other, so neither can honestly be the parent.
    const tree = buildRegionTree([
      span("rgn_8000", 0x8000, 0x8200, "data", "left"),
      span("rgn_8100", 0x8100, 0x8300, "text", "right"),
    ]);

    expect(tree).toHaveLength(2);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });

  it("looks the comment up rather than carrying it on the span", () => {
    // A comment is its own object now, not a field on whatever it describes,
    // so the sidebar reads the same one the listing renders above that address
    // — two answers to one question being exactly what this avoids.
    const tree = buildRegionTree(
      [span("rgn_8000", 0x8000, 0x8100, "data", "table")],
      (address) => (address === 0x8000 ? "sprite frames" : undefined)
    );

    expect(tree[0].comment).toBe("sprite frames");
  });

  it("carries the id, so a node names the claim it came from", () => {
    // An address cannot identify a claim — several cover any interesting one —
    // so a sidebar row that could only report an address could not be clicked
    // through to the thing it is showing.
    const tree = buildRegionTree([span("rgn_8000", 0x8000, 0x8100, "data", "table")]);
    expect(tree[0].id).toBe("rgn_8000");
  });

  it("returns nothing for a layer with no declared regions", () => {
    expect(buildRegionTree([])).toEqual([]);
  });
});
