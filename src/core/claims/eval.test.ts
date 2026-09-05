import { describe, it, expect } from "vitest";
import { DecodeGraph } from "./graph.js";
import { reachFrom, Root } from "./reach.js";
import { ClaimSet, disagreements, describeDisagreement, LayerPlacement } from "./set.js";
import { codeInsideClaims, unreachedClaims, describeFinding } from "./review.js";
import { Claim } from "./model.js";
import { analyzeProgram } from "../analysis/program.js";
import { loadProjectFile } from "../../node-files.js";

/**
 * What the redesign can say that the current model cannot.
 *
 * Measured against real projects rather than fixtures, because the claims being
 * tested are about whether the old shape lost information, and a fixture would
 * only demonstrate the new shape holding what it was built to hold.
 */

const build = (path: string) => {
  const loaded = loadProjectFile(path);
  const program = analyzeProgram(loaded);
  const graph = DecodeGraph.build(loaded.map);
  const claims = loaded.claims;

  const roots: Root[] = [
    ...program.entryPoints.map((address) => ({ address, kind: "code" as const, why: "entryPoint" })),
    ...claims
      .filter((c) => c.root !== undefined && c.root !== "data")
      .map((c) => ({ address: c.at, kind: "code" as const, why: `root:${c.root}` })),
  ];
  const reach = reachFrom(graph, roots, { operands: true });
  const set = new ClaimSet(claims);
  return { loaded, program, graph, reach, set, claims };
};

describe("what the claim model recovers", () => {
  it("Gridrunner: a data claim was deleting a routine an explicit JMP targets", () => {
    const { graph, reach, set, program } = build("assets/gridrunner/gridrunner.re64");

    const findings = codeInsideClaims(graph, reach, set);
    const at8d16 = findings.find((f) => f.kind === "codeInClaim" && f.address === 0x8d16);

    // eslint-disable-next-line no-console
    console.log("code inside claims:");
    for (const f of findings) console.log("  ", describeFinding(f));

    expect(at8d16).toBeDefined();
    // The old model produced one warning and 32 missing instructions. Both the
    // claim and the code now stand, and the report says which is suspect.
    expect(at8d16!.kind === "codeInClaim" && at8d16!.targeted).toBe(true);

    // This used to be 32: the graph found `PlayNewLevelSounds` and the walk did
    // not. The walk now refuses a claim's veto over an explicit transfer, so the
    // two agree — which is the check that the fix landed in the shipping path and
    // not only in the prototype.
    const walked = new Set(program.instructions.all().map((i) => i.address));
    const recovered = [...reach.code].filter((a) => !walked.has(a));
    // eslint-disable-next-line no-console
    console.log(`instructions the graph finds and the walk does not: ${recovered.length}`);
    expect(recovered.length).toBe(0);
  });

  it("reduces the vocabulary: no code claims, and nothing says `unknown`", () => {
    // The counts this used to print came from a measurement adapter that ran
    // beside the real conversion. The adapter is gone because the conversion is
    // the only path now, so the property is asserted rather than reported: a
    // claim never says `code`, because code is what bytes are when nobody has
    // said otherwise, and it never says `unknown`, because that was the absence
    // of a claim wearing the name of a kind.
    for (const path of [
      "assets/gridrunner/gridrunner.re64",
      "experiments/07-scale/run/final.re64",
    ]) {
      const { claims } = build(path);
      const said = new Set(claims.map((c) => c.says?.is).filter(Boolean));
      expect([...said].sort()).not.toContain("code");
      expect([...said].sort()).not.toContain("unknown");
      // And every claim says *something*: a name, a reading, or a root.
      for (const claim of claims) {
        expect(
          claim.name !== undefined || claim.says !== undefined || claim.root !== undefined
        ).toBe(true);
      }
    }
  });

  it("reports the disagreements the old model resolved silently", () => {
    for (const path of [
      "assets/gridrunner/gridrunner.re64",
      "experiments/07-scale/run/final.re64",
    ]) {
      const { set, graph, reach } = build(path);
      const ds = disagreements(set);
      const unreached = unreachedClaims(reach, set);
      // eslint-disable-next-line no-console
      console.log(`\n${path.split("/").pop()}: ${ds.length} disagreements, ${unreached.length} unreached claims`);
      for (const d of ds.slice(0, 8)) console.log("  ", describeDisagreement(d));
      for (const f of unreached.slice(0, 5)) console.log("  ", describeFinding(f));
      void graph;
    }
  });
});

describe("what the claim model can express that the old one could not", () => {
  const person = (author: string) => ({ author, source: "user" as const });

  it("two readers disagreeing about one span both stand", () => {
    // Experiment 7: two readers concluded different things about one byte and one
    // silently won. Here neither wins and the disagreement is the output.
    const claims: Claim[] = [
      { id: "c1", at: 0x1800, extent: 0x800, name: "spriteBank", says: { is: "bitmap", view: "sprite" }, by: person("gfx") },
      { id: "c2", at: 0x1800, extent: 0x800, name: "levelData", says: { is: "data" }, by: person("lead") },
    ];
    const set = new ClaimSet(claims);
    const ds = disagreements(set);

    expect(ds.some((d) => d.kind === "interpretation")).toBe(true);
    // eslint-disable-next-line no-console
    console.log(describeDisagreement(ds.find((d) => d.kind === "interpretation")!));
    // Both are still readable, by whoever asks.
    expect(set.interpretationsAt(0x1900)).toHaveLength(2);
  });

  it("a routine root inside somebody's data claim is a reported conflict, not a deletion", () => {
    const claims: Claim[] = [
      { id: "r1", at: 0x8cf6, extent: 0x22, name: "laserFrameRateForLevel", says: { is: "data" }, by: person("marcus") },
      { id: "r2", at: 0x8d16, name: "PlayNewLevelSounds", root: "routine", by: person("agate") },
    ];
    const ds = disagreements(new ClaimSet(claims));
    const conflict = ds.find((d) => d.kind === "rootInData");
    expect(conflict).toBeDefined();
    // eslint-disable-next-line no-console
    console.log(describeDisagreement(conflict!));
  });

  it("one annotation of a self-relocating routine appears at both addresses", () => {
    // Revenge of the Mutant Camels moves its decruncher onto the stack page and
    // jumps to the copy. Address-keyed annotations cannot connect the two.
    const claims: Claim[] = [
      {
        id: "d1",
        at: 0x10,
        frame: { space: "layer", layer: "decruncher" },
        name: "fetchBit",
        root: "routine",
        by: person("stone"),
      },
    ];
    const placements: LayerPlacement[] = [
      { layer: "decruncher", base: 0x0800, length: 0x100 },
      { layer: "decruncher", base: 0x0100, length: 0x100 },
    ];
    const set = ClaimSet.place(claims, placements);

    const addresses = set.all().map((c) => c.at).sort((a, b) => a - b);
    expect(addresses).toEqual([0x0110, 0x0810]);
    // eslint-disable-next-line no-console
    console.log("one claim, resolved at:", addresses.map((a) => `$${a.toString(16)}`).join(" "));
    // Each keeps a distinct id, so an id-keyed map holds both.
    expect(new Set(set.all().map((c) => c.id)).size).toBe(2);
    // And each remembers what it was authored against.
    expect(set.all()[0].relativeTo).toEqual({ layer: "decruncher", offset: 0x10 });
  });

  it("a claim can be a weak commitment", () => {
    const claims: Claim[] = [
      { id: "g1", at: 0x2000, extent: 0x800, says: { is: "bitmap", view: "char:8" },
        by: { author: "amber", source: "user", confidence: "guess" } },
    ];
    const set = new ClaimSet(claims);
    expect(set.covering(0x2100)[0].by.confidence).toBe("guess");
  });
});
