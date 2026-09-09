import { describe, it, expect } from "vitest";
import { DecodeGraph } from "./graph.js";
import { reachFrom, Root } from "./reach.js";
import { ClaimSet } from "./set.js";
import { collectListing, describeItem } from "./listing.js";
import { Claim, arrayExtent } from "./model.js";
import { analyzeProgram } from "../analysis/program.js";
import { loadProjectFile } from "../../node-files.js";

function build(path: string, target?: string) {
  const loaded = loadProjectFile(path, target);
  const program = analyzeProgram(loaded);
  const graph = DecodeGraph.build(loaded.map);
  const claims = loaded.claims;
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

  it("renders a claim declared inside another after it, marked", () => {
    // Nothing splits. The marker is accurate — those bytes *are* shared — and on
    // this project it is the visible symptom of a placeholder: `zoneDataTable`
    // spans 8,400 bytes and explains 1,680 of them, so forty strings sit inside
    // a claim that does not account for the runs between them.
    const { graph, set, roots, reach } = build("experiments/07-scale/run/final.re64", "runtime");
    const items = collectListing(graph, reach, set, roots, { from: 0x6700, to: 0x6900 });

    expect(items.map(describeItem)).toEqual([
      "$6700-$87D0  data zoneDataTable",
      "$67A0-$67C8  text  [also reads these bytes, shared above]",
      "$6868-$6890  text  [also reads these bytes, shared above]",
    ]);
  });

  it("a placeholder claim hides the work it does not explain", () => {
    // The reason not to compensate for this in the renderer. Removing one 8,400
    // byte `data` claim that accounts for 20% of its own span takes the project
    // from 5 gaps to 47, and from 3,823 unexplained bytes to 10,543 — 42 entries
    // the placeholder was keeping out of the list whose job is to show them.
    //
    // The counts moved by one when `loadProjectFile` started honouring the
    // target a file declares. This project says `defaultTarget: runtime`, so it
    // is now read as the program runs rather than as every layer at once — the
    // packed file is shadowed out, which is what a target is for and what the
    // file was already asking for.
    const { graph, set, roots, reach } = build("experiments/07-scale/run/final.re64", "runtime");
    const range = { from: 0x0800, to: 0xd000 };

    const gaps = (s: ClaimSet) => {
      const found = collectListing(graph, reach, s, roots, range).filter((i) => i.kind === "gap");
      return { count: found.length, bytes: found.reduce((n, g) => n + (g.end - g.start), 0) };
    };
    const without = new ClaimSet(set.all().filter((c) => c.name !== "zoneDataTable"));

    expect(gaps(set)).toEqual({ count: 5, bytes: 3823 });
    expect(gaps(without)).toEqual({ count: 47, bytes: 10543 });
  });

  it("is stable whatever order claims arrive in", () => {
    const { graph, set, roots, reach } = build("assets/gridrunner/gridrunner.re64");
    const reversed = new ClaimSet([...set.all()].reverse());
    const a = collectListing(graph, reach, set, roots, { from: 0x8000, to: 0x9000 });
    const b = collectListing(graph, reach, reversed, roots, { from: 0x8000, to: 0x9000 });
    expect(a.map(describeItem)).toEqual(b.map(describeItem));
  });
});

const by = (author: string) => ({ author, origin: "user" as const });

describe("the extent bug this design must not be able to restate", () => {
  it("a code root offers no offsets to operand rendering", () => {
    // `mark_function` once declared a routine's extent, sharing the field with
    // the one that makes `LDA SCREEN_RAM + $000F,X` render. Declaring a routine
    // therefore turned `BPL loc_8050` into `BPL UpdateExplosion + $0010`.
    //
    // Root and extent are orthogonal fields here, so the shape permits the
    // combination and the constraint has to be stated instead.
    const routine: Claim = {
      id: "r", at: 0x8040, extent: 0x40, name: "UpdateExplosion",
      root: "routine", origin: "user",
    };
    const array: Claim = {
      id: "a", at: 0x0400, extent: 0x3e8, name: "SCREEN_RAM",
      says: { is: "data" }, origin: "user",
    };
    const sprites: Claim = {
      id: "s", at: 0x2000, extent: 0x800, name: "spriteBank",
      says: { is: "bitmap" }, root: "data", origin: "user",
    };

    expect(arrayExtent(routine)).toBeUndefined();
    expect(arrayExtent(array)).toBe(0x3e8);
    // A *data* root is still an array: it is rooted so it renders at all, which
    // says nothing about whether operands may index it.
    expect(arrayExtent(sprites)).toBe(0x800);
  });
});
