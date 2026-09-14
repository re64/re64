import { describe, it, expect } from "vitest";
import { checkProjectShape, parseProject, Project } from "./project.js";

/**
 * The line a file and a peer's update are both held to: what makes a project
 * unreadable, and nothing that merely makes it untidy. See contract S7.
 */
describe("what makes a project unreadable", () => {
  const withLayer = (extra: Record<string, unknown>): string =>
    JSON.stringify({
      layers: [{ id: "lay_a", type: "bytes", address: "$8000", bytes: "eaeaeaeaeaeaeaeaeaeaeaeaeaeaeaea", ...extra }],
    });

  it("reads a region end spelled as a length, the way the region reader does", () => {
    // `+$10` is sixteen bytes from the start; passing it to the absolute
    // parser refused a file that had always loaded.
    const text = withLayer({ regions: [{ id: "rgn_a", start: "$8000", end: "+$10", kind: "data" }] });
    expect(() => parseProject(text)).not.toThrow();
    expect(() => parseProject(withLayer({ regions: [{ id: "rgn_a", start: "$8000", end: "$8010", kind: "data" }] }))).not.toThrow();
    expect(() => parseProject(withLayer({ regions: [{ id: "rgn_a", start: "$8000", end: "+zz", kind: "data" }] }))).toThrow(
      /Unreadable address "zz" on region/
    );
  });

  it("refuses a coordinate nothing can read, wherever it sits", () => {
    const project = JSON.parse(withLayer({})) as Project;
    expect(() => checkProjectShape({ ...project, claims: [{ id: "clm_1", at: null as never, name: "x", origin: "user" }] })).toThrow(
      /Unreadable address null on claim clm_1/
    );
    expect(() => checkProjectShape({ ...project, constants: [{ id: "cst_1", name: "ONE", value: "one" }] })).toThrow(
      /Unreadable address "one" on constant cst_1/
    );
    expect(() => checkProjectShape({ ...project, primaryLabels: { nope: "clm_1" } })).toThrow(/primaryLabels/);
    expect(() => checkProjectShape({ ...project, targets: [{ id: "tgt_1", name: "t", layers: [{ id: "lnk", layer: "lay_a", at: "$9000" }], entryPoints: ["$8000", 4096] }] })).not.toThrow();
  });

  it("does not refuse what is merely untidy", () => {
    // A dangling reference, a claim on a layer nothing declares: hygiene's, not this.
    const project = JSON.parse(withLayer({})) as Project;
    expect(() =>
      checkProjectShape({
        ...project,
        claims: [{ id: "clm_1", at: "$0010", layer: "lay_gone", name: "x", origin: "user", is: "record", typeId: "typ_gone" }],
        constantUses: [{ id: "cst_u1", at: "$8000", constant: "cst_gone" }],
        evidence: [{ id: "evd_1", claim: "clm_none", kind: "refutes" }],
      })
    ).not.toThrow();
  });
});
