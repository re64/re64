import { describe, it, expect } from "vitest";
import { DecodeGraph } from "./graph.js";
import { reachFrom, Root, predecessorsOf } from "./reach.js";
import { analyzeProgram } from "../analysis/program.js";
import { loadProjectFile } from "../../node-files.js";

/**
 * Does separating the decode from the walk cost anything, and does the walk
 * still find what it used to?
 *
 * These are measurements rather than assertions about behaviour: the redesign
 * stands or falls on the exhaustive decode being cheap enough that reachability
 * can be asked repeatedly, and on the difference between the two decodes being
 * explainable rather than merely small.
 */

const load = (path: string, target?: string) => {
  const loaded = loadProjectFile(path, target);
  return { loaded, program: analyzeProgram(loaded) };
};

const GRIDRUNNER = "assets/gridrunner/gridrunner.re64";

describe("the decode graph", () => {
  it("decodes the whole address space cheaply", () => {
    const { loaded } = load(GRIDRUNNER);
    const graph = DecodeGraph.build(loaded.map);

    // eslint-disable-next-line no-console
    console.log("graph:", JSON.stringify(graph.stats));
    expect(graph.stats.decodable).toBeGreaterThan(0);
    expect(graph.stats.decodable + graph.stats.unmapped + graph.stats.undefinedOpcode + graph.stats.truncated)
      .toBe(0x10000);
  });

  it("reproduces the walk's reachable set from the same roots", () => {
    const { loaded, program } = load(GRIDRUNNER);
    const graph = DecodeGraph.build(loaded.map);

    const roots: Root[] = program.entryPoints.map((address) => ({
      address,
      kind: "code" as const,
      why: "entryPoint",
    }));
    const reach = reachFrom(graph, roots);

    const walked = new Set<number>();
    for (const instr of program.instructions.all()) walked.add(instr.address);

    const onlyGraph = [...reach.code].filter((a) => !walked.has(a)).sort((a, b) => a - b);
    const onlyWalk = [...walked].filter((a) => !reach.code.has(a)).sort((a, b) => a - b);

    // eslint-disable-next-line no-console
    console.log(
      "walk:", walked.size,
      "graph:", reach.code.size,
      "onlyGraph:", onlyGraph.length,
      "onlyWalk:", onlyWalk.length,
      "reachMs:", reach.ms.toFixed(2)
    );
    // eslint-disable-next-line no-console
    console.log("first onlyGraph:", onlyGraph.slice(0, 12).map((a) => a.toString(16)));
    // eslint-disable-next-line no-console
    console.log("first onlyWalk:", onlyWalk.slice(0, 12).map((a) => a.toString(16)));

    // The walk refuses non-code regions; this does not. Everything the walk
    // found must still be here, or the graph is losing edges.
    expect(onlyWalk).toEqual([]);
  });

  it("collects a data closure from operands", () => {
    const { loaded, program } = load(GRIDRUNNER);
    const graph = DecodeGraph.build(loaded.map);
    const roots: Root[] = program.entryPoints.map((address) => ({
      address, kind: "code" as const, why: "entryPoint",
    }));

    const reach = reachFrom(graph, roots, { operands: true });
    const inMap = [...reach.data].filter((a) => loaded.map.readByte(a) !== undefined);

    // eslint-disable-next-line no-console
    console.log(
      "data addresses:", reach.data.size,
      "of which mapped:", inMap.length,
      "hottest:", [...reach.dataFrom.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 5)
        .map(([addr, sites]) => `$${addr.toString(16)}x${sites.length}`)
        .join(" ")
    );
    expect(reach.data.size).toBeGreaterThan(0);
  });

  it("answers what reaches an address, which the walk cannot", () => {
    const { loaded, program } = load(GRIDRUNNER);
    const graph = DecodeGraph.build(loaded.map);
    const roots: Root[] = program.entryPoints.map((address) => ({
      address, kind: "code" as const, why: "entryPoint",
    }));
    const reach = reachFrom(graph, roots);

    const target = [...reach.code].sort((a, b) => a - b)[20];
    const preds = predecessorsOf(graph, reach, target);
    // eslint-disable-next-line no-console
    console.log(`predecessors of $${target.toString(16)}:`, preds.map((p) => p.toString(16)));
    expect(Array.isArray(preds)).toBe(true);
  });
});
