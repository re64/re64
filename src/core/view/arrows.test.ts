import { describe, it, expect } from "vitest";
import { Reference } from "../index.js";
import { allocateArrowLanes, renderArrowGutter, ArrowSpan } from "./arrows.js";

/**
 * Build the reference/line maps `allocateArrowLanes` expects from a list of
 * (sourceLine → targetLine) control-flow edges. Addresses are stand-ins; only
 * the line geometry matters to lane allocation.
 */
function lanesFor(edges: [from: number, to: number][], type: Reference["type"] = "branch") {
  const references = new Map<number, Reference[]>();
  const targetLine: Record<number, number> = {};
  const instructionLine: Record<number, number> = {};

  for (const [from, to] of edges) {
    instructionLine[from] = from;
    targetLine[to] = to;
    const refs = references.get(to) ?? [];
    refs.push({ type, from });
    references.set(to, refs);
  }

  return allocateArrowLanes(references, targetLine, instructionLine);
}

const laneOf = (arrows: ArrowSpan[], from: number) =>
  arrows.find((a) => a.fromLine === from)!.lane;

describe("allocateArrowLanes", () => {
  it("gives the inner lane to the shorter of two nested arrows", () => {
    // The regression that motivated shortest-first ordering: a long loop
    // starting earlier used to steal lane 0 from the short arrow inside it.
    const { arrows } = lanesFor([
      [30, 10], // long: spans rows 10..30
      [20, 25], // short: nested wholly inside it
    ]);

    expect(laneOf(arrows, 20)).toBeLessThan(laneOf(arrows, 30));
    expect(laneOf(arrows, 20)).toBe(0);
  });

  it("nests three levels deep in span order", () => {
    const { arrows } = lanesFor([
      [100, 10],
      [80, 20],
      [60, 40],
    ]);

    expect(laneOf(arrows, 60)).toBe(0);
    expect(laneOf(arrows, 80)).toBe(1);
    expect(laneOf(arrows, 100)).toBe(2);
  });

  it("reuses a lane for arrows that do not overlap", () => {
    const { arrows } = lanesFor([
      [10, 5],
      [40, 30],
    ]);

    expect(arrows.every((a) => a.lane === 0)).toBe(true);
  });

  it("treats touching endpoints as overlap", () => {
    // An arrow ending where the next begins would put two corners in one cell.
    const { arrows } = lanesFor([
      [5, 10],
      [10, 15],
    ]);

    expect(laneOf(arrows, 5)).not.toBe(laneOf(arrows, 10));
  });

  it("demotes arrows past the lane cap instead of widening the gutter", () => {
    // Six mutually overlapping arrows, one more than the five available lanes.
    const edges: [number, number][] = [];
    for (let i = 0; i < 6; i++) edges.push([100 + i, 50 - i]);

    const { arrows, demoted } = lanesFor(edges);

    expect(arrows).toHaveLength(5);
    expect(demoted).toBe(1);
    expect(Math.max(...arrows.map((a) => a.lane))).toBe(4);
  });

  it("demotes arrows spanning more rows than the distance threshold", () => {
    const { arrows, demoted } = lanesFor([[500, 10]]);

    expect(arrows).toHaveLength(0);
    expect(demoted).toBe(1);
  });

  it("ignores data references", () => {
    const { arrows } = lanesFor([[20, 10]], "data");
    expect(arrows).toHaveLength(0);
  });
});

describe("renderArrowGutter", () => {
  it("draws a corner, a run, and an arrowhead at the target", () => {
    const gutter = renderArrowGutter(
      [{ fromLine: 0, toLine: 3, top: 0, bottom: 3, lane: 0 }],
      5
    );

    expect(gutter).toEqual(["┌─", "│ ", "│ ", "└►", "  "]);
  });

  it("marks crossings so a horizontal run does not erase a vertical", () => {
    // Outer arrow spans 0..4; its endpoints must cross the inner arrow's lane.
    const gutter = renderArrowGutter(
      [
        { fromLine: 1, toLine: 3, top: 1, bottom: 3, lane: 0 },
        { fromLine: 0, toLine: 4, top: 0, bottom: 4, lane: 1 },
      ],
      5
    );

    expect(gutter[0]).toBe("┌──");
    expect(gutter[1]).toBe("│┌─");
    expect(gutter[3]).toBe("│└►");
    expect(gutter[4]).toBe("└─►");
  });

  it("returns nothing when there are no arrows", () => {
    expect(renderArrowGutter([], 10)).toEqual([]);
  });
});
