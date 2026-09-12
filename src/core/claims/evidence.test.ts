import { describe, it, expect } from "vitest";
import { checkEvidenceRequest, explains } from "./evidence.js";
import { Project, ProjectEvidence } from "../project/project.js";
import { buildMemoryMap } from "../project/loader.js";
import { makeFileLoader } from "../project/file-source.js";
import { analyzeProgram } from "../analysis/program.js";
import { applyOpToDoc, applyUpdate, docFromProject, encodeDoc, projectFromDoc } from "../crdt/index.js";

/**
 * **One rule for adding and revising evidence**, and it is a rule about the
 * request. `addEvidence` refused a refutation pointing at nothing while
 * `editEvidence` checked nothing, so a record that could not have been added
 * in a shape could be edited into it. What is refused is a request that does
 * not say what it is; what two valid requests merge into is reported, never
 * rejected or repaired.
 */
const project: Project = {
  name: "evidence",
  layers: [{ id: "lay_a", type: "bytes", address: "$8000", bytes: "a9016000" }],
  claims: [
    { id: "clm_a", at: "$8000", name: "A", origin: "user" },
    { id: "clm_b", at: "$8002", name: "B", origin: "user" },
  ],
  scenarios: [{ id: "scn_1", name: "run", steps: [{ kind: "start", at: "$8000" }] }],
};
const refutes: ProjectEvidence = { id: "evd_1", claim: "clm_a", kind: "refutes", other: "clm_b", note: "B is right" };

describe("what a piece of evidence must say", () => {
  it("refuses an add and the edit into the same shape with one message", () => {
    const bare = /needs something to point at/;
    expect(() => checkEvidenceRequest(project, undefined, { claim: "clm_a", kind: "refutes" })).toThrow(bare);
    const support: ProjectEvidence = { id: "evd_2", claim: "clm_a", kind: "supports", note: "" };
    expect(() => checkEvidenceRequest(project, support, { kind: "refutes" })).toThrow(bare);
    // Clearing the last explanation is the same request in two steps.
    expect(() => checkEvidenceRequest(project, refutes, { other: null, note: null })).toThrow(bare);
    expect(() => checkEvidenceRequest(project, { ...refutes, note: undefined }, { other: null })).toThrow(bare);
    // A retirement is held to the same rule.
    expect(() => checkEvidenceRequest(project, undefined, { claim: "clm_a", kind: "retires" })).toThrow(bare);
  });

  it("takes a nonblank note as the explanation, and not a blank one", () => {
    expect(explains({ note: "   " })).toBe(false);
    expect(explains({ note: "because" })).toBe(true);
    expect(explains({ other: "clm_b" })).toBe(true);
    expect(() => checkEvidenceRequest(project, undefined, { claim: "clm_a", kind: "refutes", note: " " })).toThrow(
      /point at/
    );
    expect(() => checkEvidenceRequest(project, undefined, { claim: "clm_a", kind: "refutes", note: "why" })).not.toThrow();
  });

  it("checks the shape only where the request reaches it", () => {
    // Clearing one handle while the other stays is fine; so is turning a
    // refutation into a support and dropping its note in one request.
    expect(() => checkEvidenceRequest(project, refutes, { other: null })).not.toThrow();
    expect(() => checkEvidenceRequest(project, refutes, { kind: "supports", note: null, other: null })).not.toThrow();
    // A record two edits merged into an incomplete state is not repaired by
    // force on an unrelated edit: the method is not the request's subject.
    const merged: ProjectEvidence = { id: "evd_3", claim: "clm_a", kind: "refutes" };
    expect(() => checkEvidenceRequest(project, merged, { scenario: "scn_1" })).not.toThrow();
  });

  it("checks a reference only when the request supplies one", () => {
    const named: ProjectEvidence = { ...refutes, scenario: "scn_gone" };
    // The scenario it names has gone: an edit to the note is not the request
    // that named it, and clearing it must be possible.
    expect(() => checkEvidenceRequest(project, named, { note: "still wrong" })).not.toThrow();
    expect(() => checkEvidenceRequest(project, named, { scenario: null })).not.toThrow();
    // Naming it again is a new request to point at it.
    expect(() => checkEvidenceRequest(project, named, { scenario: "scn_gone" })).toThrow(/No scenario scn_gone/);
    expect(() => checkEvidenceRequest(project, undefined, { claim: "clm_a", kind: "supports", scenario: "scn_gone" })).toThrow(
      /No scenario scn_gone/
    );
    expect(() => checkEvidenceRequest(project, refutes, { other: "clm_none" })).toThrow(/No claim clm_none to point at/);
    // The subject is checked on an add and never again: it is immutable.
    expect(() => checkEvidenceRequest(project, undefined, { claim: "clm_none", kind: "supports" })).toThrow(/No claim clm_none\./);
    const retired: Project = {
      ...project,
      evidence: [{ id: "evd_r", claim: "clm_b", kind: "retires", note: "done" }],
    };
    expect(() => checkEvidenceRequest(retired, undefined, { claim: "clm_b", kind: "supports" })).toThrow(/retired/);
    // A retired claim can still be pointed at: that is what retiring records.
    expect(() => checkEvidenceRequest(retired, undefined, { claim: "clm_a", kind: "refutes", other: "clm_b" })).not.toThrow();
  });
});

describe("what two valid edits can merge into", () => {
  it("keeps both contributions and reports the result, rather than refusing either", () => {
    const base = docFromProject({ ...project, evidence: [refutes] });
    const alice = docFromProject({ ...project, evidence: [refutes] });
    alice.clientID = 1;
    const bob = docFromProject({ ...project, evidence: [refutes] });
    bob.clientID = 2;
    // Each request is valid where it is written: one handle stays on each side.
    checkEvidenceRequest(projectFromDoc(alice), refutes, { other: null });
    applyOpToDoc(alice, { op: "evidence.set", id: "evd_1", fields: { other: null } });
    checkEvidenceRequest(projectFromDoc(bob), refutes, { note: null });
    applyOpToDoc(bob, { op: "evidence.set", id: "evd_1", fields: { note: null } });
    for (const doc of [alice, bob]) applyUpdate(base, encodeDoc(doc));

    const merged = projectFromDoc(base);
    expect(merged.evidence).toEqual([{ id: "evd_1", claim: "clm_a", kind: "refutes" }]);
    // Nobody was wrong, so nothing is repaired; the untidy result is reported.
    const loaded = buildMemoryMap(merged, makeFileLoader(() => new Uint8Array()));
    const findings = analyzeProgram(loaded).hygiene.filter((f) => f.kind === "evidence.unexplained");
    expect(findings).toHaveLength(1);
    expect(findings[0].subjects).toEqual([{ id: "evd_1" }, { id: "clm_a" }]);
    expect(findings[0].message).toMatch(/points at nothing/);
  });
});
