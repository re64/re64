import { describe, it, expect } from "vitest";
import { layoutClaims, describeAlternate } from "./layout.js";
import { ClaimSet } from "./set.js";
import { Claim } from "./model.js";
import { claimsFromProject } from "./adapt.js";
import { loadProjectFile } from "../../node-files.js";

const by = (author: string) => ({ author, source: "user" as const });

describe("laying out claims that disagree", () => {
  it("renders a nested claim in place, not as a second reading", () => {
    // The ordinary way of working: an 8K table with strings inside it. Marking
    // this as a disagreement would fire 43 times on one real project.
    const set = new ClaimSet([
      { id: "outer", at: 0x1000, extent: 0x100, name: "zoneTable", says: { is: "data" }, by: by("amber") },
      { id: "inner", at: 0x1040, extent: 0x20, name: "zoneName", says: { is: "text" }, by: by("basalt") },
    ]);
    const segments = layoutClaims(set, 0x1000, 0x1100);

    expect(segments.map((s) => [s.start, s.end, s.claim.id, s.alternate])).toEqual([
      [0x1000, 0x1040, "outer", false],
      [0x1040, 0x1060, "inner", false],
      [0x1060, 0x1100, "outer", false],
    ]);
  });

  it("emits both readings of an identically claimed span, marking the second", () => {
    const set = new ClaimSet([
      { id: "a", at: 0x1800, extent: 0x800, name: "spriteBank", says: { is: "bitmap", view: "sprite" }, by: by("gfx") },
      { id: "b", at: 0x1800, extent: 0x800, name: "levelData", says: { is: "data" }, by: by("lead") },
    ]);
    const segments = layoutClaims(set, 0x1800, 0x2000);

    expect(segments).toHaveLength(2);
    expect(segments[0].alternate).toBe(false);
    expect(segments[1].alternate).toBe(true);
    // Neither writer is privileged by arriving first: the tie goes to the lower
    // id, so every peer lays it out identically without coordinating.
    expect(segments[0].claim.id).toBe("a");
    expect(segments[1].sharesWith?.id).toBe("a");
    // eslint-disable-next-line no-console
    console.log(describeAlternate(segments[1]));
  });

  it("handles the real six-byte overlap three agents produced", () => {
    // $5870-$5906 text "srcResidueSpriteSet" against $5900-$594C data
    // "tuneVoice1": a partial overlap neither claim contains, which is the one
    // genuine interpretation conflict in experiment 7's project.
    const { claims } = claimsFromProject(loadProjectFile("experiments/07-scale/run/final.re64"));
    const set = new ClaimSet(claims);
    const segments = layoutClaims(set, 0x5870, 0x5950);

    const alternates = segments.filter((s) => s.alternate);
    // eslint-disable-next-line no-console
    for (const s of segments) {
      // eslint-disable-next-line no-console
      console.log(
        `$${s.start.toString(16)}-$${s.end.toString(16)} ${s.claim.name ?? "-"} ` +
        `(${s.claim.says!.is})${s.alternate ? "  [second reading]" : ""}`
      );
    }
    expect(alternates.length).toBeGreaterThan(0);
    // Both readings survive the layout — the whole point.
    const names = new Set(segments.map((s) => s.claim.name));
    expect(names.has("srcResidueSpriteSet")).toBe(true);
    expect(names.has("tuneVoice1")).toBe(true);
  });

  it("does not call a fully refined claim a second reading of itself", () => {
    // An outer span every byte of which was taken by claims *inside* it. It
    // renders nowhere and nothing disagrees with it — which is different from
    // being contradicted, and looks identical in the layout pass.
    const set = new ClaimSet([
      { id: "outer", at: 0x1000, extent: 0x40, name: "zoneTable", says: { is: "data" }, by: by("amber") },
      { id: "first", at: 0x1000, extent: 0x20, name: "zoneA", says: { is: "text" }, by: by("amber") },
      { id: "second", at: 0x1020, extent: 0x20, name: "zoneB", says: { is: "text" }, by: by("amber") },
    ]);
    const segments = layoutClaims(set, 0x1000, 0x1040);

    expect(segments.filter((s) => s.alternate)).toEqual([]);
    expect(segments.map((s) => s.claim.id)).toEqual(["first", "second"]);
  });

  it("is stable regardless of the order claims arrive in", () => {
    const claims: Claim[] = [
      { id: "c", at: 0x1000, extent: 0x40, says: { is: "data" }, by: by("one") },
      { id: "a", at: 0x1000, extent: 0x40, says: { is: "text" }, by: by("two") },
      { id: "b", at: 0x1020, extent: 0x10, says: { is: "bitmap" }, by: by("three") },
    ];
    const forward = layoutClaims(new ClaimSet(claims), 0x1000, 0x1040);
    const backward = layoutClaims(new ClaimSet([...claims].reverse()), 0x1000, 0x1040);
    expect(forward).toEqual(backward);
  });
});
