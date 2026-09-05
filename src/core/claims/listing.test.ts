import { describe, it, expect } from "vitest";
import { DecodeGraph } from "./graph.js";
import { reachFrom, Root } from "./reach.js";
import { claimsFromProject } from "./adapt.js";
import { ClaimSet } from "./set.js";
import { collectListing, describeItem } from "./listing.js";
import { analyzeProgram } from "../analysis/program.js";
import { loadProjectFile } from "../../node-files.js";

function build(path: string) {
  const loaded = loadProjectFile(path);
  const program = analyzeProgram(loaded);
  const graph = DecodeGraph.build(loaded.map);
  const { claims } = claimsFromProject(loaded);
  const set = new ClaimSet(claims);
  const roots: Root[] = [
    ...program.entryPoints.map((address) => ({ address, kind: "code" as const, why: "entryPoint" })),
    // Every interpretation claim is rooted, which is what the migration does so
    // that an existing project loses nothing: under operand reachability a claim
    // is surfaced because something reaches it, and 24 of Camels' would not be.
    ...claims
      .filter((c) => c.says !== undefined)
      .map((c) => ({ address: c.at, kind: "data" as const, why: "migrated root" })),
  ];
  const reach = reachFrom(graph, roots, { operands: true });
  return { loaded, graph, set, roots, reach };
}

describe("one address-sorted listing", () => {
  it("shows the contested routine and the claim that covers its entry", () => {
    const { graph, set, roots, reach } = build("assets/gridrunner/gridrunner.re64");
    const items = collectListing(graph, reach, set, roots, { from: 0x8cf0, to: 0x8d30 });
    // eslint-disable-next-line no-console
    for (const item of items) console.log("  " + describeItem(item));

    // The claim renders as data and the routine renders after it, marked. Both
    // stand; neither is "primary" except in the sense of starting first.
    const shadow = items.filter((i) => i.kind !== "gap" && i.shadow);
    expect(shadow).toHaveLength(1);
    expect(shadow[0].start).toBe(0x8d16);
    expect(shadow[0].kind !== "gap" && shadow[0].sharesWith?.start).toBe(0x8cf6);

    // Nothing that merely extends into the window from before it is marked: the
    // listing must not read differently depending on where you started reading.
    const fromBefore = items.find((i) => i.start < 0x8cf0);
    expect(fromBefore && fromBefore.kind !== "gap" && fromBefore.shadow).toBe(false);
  });

  it("covers the whole address space with items and gaps, exactly once", () => {
    const { graph, set, roots, reach } = build("assets/gridrunner/gridrunner.re64");
    const items = collectListing(graph, reach, set, roots, { from: 0x8000, to: 0x9000 });

    // Every byte is either covered by something or in a gap, and the gaps do not
    // overlap anything — which is what makes "nothing explains these" true.
    const gaps = items.filter((i) => i.kind === "gap");
    const covered = new Set<number>();
    for (const item of items) {
      if (item.kind === "gap") continue;
      for (let a = item.start; a < item.end; a++) covered.add(a);
    }
    for (const gap of gaps) {
      for (let a = gap.start; a < gap.end; a++) expect(covered.has(a)).toBe(false);
    }
    const gapBytes = gaps.reduce((n, g) => n + (g.end - g.start), 0);
    // eslint-disable-next-line no-console
    console.log(
      `$8000-$9000: ${items.length} items ` +
      `(${items.filter((i) => i.kind === "block").length} blocks, ` +
      `${items.filter((i) => i.kind === "claim").length} claims, ${gaps.length} gaps), ` +
      `${covered.size} bytes covered, ${gapBytes} bytes unexplained`
    );
    expect(covered.size + gapBytes).toBe(0x1000);
  });

  it("splits a container around what is declared inside it, unmarked", () => {
    // The reading order, not merely the emission order. Unsplit, an 8,400-byte
    // zone table dumps to completion and its own forty strings appear after all
    // of it — at addresses the reader passed thousands of bytes ago.
    const { graph, set, roots, reach } = build("experiments/07-scale/run/final.re64");
    const items = collectListing(graph, reach, set, roots, { from: 0x6700, to: 0x6900 });

    expect(items.map(describeItem)).toEqual([
      "$6700-$67A0  data zoneDataTable",
      "$67A0-$67C8  text",
      "$67C8-$6868  data zoneDataTable",
      "$6868-$6890  text",
      "$6890-$87D0  data zoneDataTable",
    ]);
  });

  it("marks a real conflict and nothing else, across a whole project", () => {
    // Splitting must happen *before* marking, or a nested item is marked as
    // sharing bytes with the container that just yielded them to it. Getting the
    // order wrong is invisible — the listing looks right and reports 45 conflicts
    // where there are 2.
    const { graph, set, roots, reach } = build("experiments/07-scale/run/final.re64");
    const items = collectListing(graph, reach, set, roots, { from: 0x0800, to: 0xd000 });
    const marked = items.filter((i) => i.kind !== "gap" && i.shadow);

    // eslint-disable-next-line no-console
    console.log(`${items.length} items across the project, ${marked.length} marked`);
    for (const m of marked) console.log("  " + describeItem(m));
    expect(marked).toHaveLength(1);
  });

  it("is stable whatever order claims arrive in", () => {
    const { graph, set, roots, reach } = build("assets/gridrunner/gridrunner.re64");
    const reversed = new ClaimSet([...set.all()].reverse());
    const a = collectListing(graph, reach, set, roots, { from: 0x8000, to: 0x9000 });
    const b = collectListing(graph, reach, reversed, roots, { from: 0x8000, to: 0x9000 });
    expect(a.map(describeItem)).toEqual(b.map(describeItem));
  });
});
