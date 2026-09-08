import { describe, it, expect } from "vitest";
import {
  formatProject,
  setPrimaryLabel,
  upsertClaim,
  deleteClaim,
  upsertConstant,
  deleteConstant,
  setProjectMeta,
} from "./serialize.js";
import { parseProject } from "./project.js";

/**
 * Writing a project back out.
 *
 * Every writer here now **reserialises**: parse, change, `formatProject`. The
 * line-editing machinery this file used to test — splicing an entry into the
 * right place, keeping the blank lines that grouped labels, adding an id to one
 * line and leaving the rest — is gone.
 *
 * It existed so a one-label rename was a one-line diff in git. That stopped
 * being true well before it was removed: `ProjectStore.runOps` regenerates its
 * text from the document on every single write, with a comment saying "the
 * layout does not matter here". Several hundred lines were maintaining a
 * property nothing read, and one of them — `setPrimaryLabel` — was corrupting
 * files that happened to write `primaryLabels` on one line.
 *
 * What is left is the shape of the output and the correctness of each writer.
 */

const TEXT = `{
  "name": "harness",
  "layers": [{ "id": "lay_a", "type": "prg", "path": "game.prg" }],
  "claims": [
    { "id": "clm_1", "at": "$8000", "name": "Start", "root": "routine", "origin": "user" }
  ],
  "constants": [{ "id": "cst_1", "name": "WHITE", "value": "$01" }]
}
`;

describe("formatProject", () => {
  it("round-trips through parse unchanged", () => {
    const once = formatProject(parseProject(TEXT));
    expect(formatProject(parseProject(once))).toBe(once);
  });

  it("writes one claim per line, so a diff stays readable", () => {
    const out = formatProject(parseProject(TEXT));
    const claimLines = out.split("\n").filter((l) => l.includes('"clm_'));
    expect(claimLines).toHaveLength(1);
  });

  it("orders claims by address, then id, so two peers produce the same text", () => {
    const project = parseProject(TEXT);
    project.claims!.push(
      { id: "clm_3", at: "$8100", name: "Later", origin: "user" },
      { id: "clm_2", at: "$8100", name: "Also", origin: "user" }
    );
    const order = formatProject(project)
      .split("\n")
      .filter((l) => l.includes('"clm_'))
      .map((l) => /"(clm_\d)"/.exec(l)![1]);
    expect(order).toEqual(["clm_1", "clm_2", "clm_3"]);
  });

  it("drops an empty block rather than writing it out", () => {
    const project = parseProject(TEXT);
    project.claims = [];
    expect(formatProject(project)).not.toContain('"claims"');
  });
});

describe("claim writers", () => {
  it("adds one, and revising the same id replaces rather than stacking", () => {
    const added = upsertClaim(TEXT, {
      id: "clm_2",
      at: "$8080",
      extent: 32,
      is: "text",
      origin: "user",
    });
    expect(parseProject(added).claims).toHaveLength(2);

    const revised = upsertClaim(added, {
      id: "clm_2",
      at: "$8080",
      extent: 64,
      is: "text",
      origin: "user",
    });
    const claims = parseProject(revised).claims!;
    expect(claims).toHaveLength(2);
    expect(claims.find((c) => c.id === "clm_2")!.extent).toBe(64);
  });

  it("is idempotent, or undo could not replay it forward to check", () => {
    const claim = { id: "clm_1", at: "$8000", name: "Start", root: "routine" as const, origin: "user" as const };
    expect(upsertClaim(TEXT, claim)).toBe(TEXT);
  });

  it("removes one, and drops the block when the last goes", () => {
    const out = deleteClaim(TEXT, "clm_1");
    expect(out).not.toContain('"claims"');
    expect(deleteClaim(out, "clm_1")).toBe(out);
  });
});

describe("setPrimaryLabel", () => {
  it("adds, replaces and clears", () => {
    const set = setPrimaryLabel(TEXT, 0x8000, "clm_1");
    expect(parseProject(set).primaryLabels).toEqual({ $8000: "clm_1" });

    const again = setPrimaryLabel(set, 0x8000, "clm_2");
    expect(parseProject(again).primaryLabels).toEqual({ $8000: "clm_2" });

    const cleared = setPrimaryLabel(again, 0x8000, undefined);
    expect(parseProject(cleared).primaryLabels).toBeUndefined();
  });

  it("handles a block written on one line, which used to corrupt the file", () => {
    // The bug the round-trip harness found: `formatProject` writes this block
    // one key per line, the old splicer assumed that, and given the equally
    // valid one-line form it wrote outside the block and produced invalid JSON.
    const inline = `{
  "layers": [{ "id": "lay_a", "type": "prg", "path": "g.prg" }],
  "primaryLabels": { "$8000": "clm_1" }
}
`;
    const out = setPrimaryLabel(inline, 0x8100, "clm_2");
    expect(() => parseProject(out)).not.toThrow();
    expect(parseProject(out).primaryLabels).toEqual({ $8000: "clm_1", $8100: "clm_2" });
  });

  it("changes nothing when the value is already there", () => {
    const set = setPrimaryLabel(TEXT, 0x8000, "clm_1");
    expect(setPrimaryLabel(set, 0x8000, "clm_1")).toBe(set);
  });
});

describe("constants and meta", () => {
  it("writes a byte value as two digits, not four", () => {
    const out = upsertConstant(TEXT, { id: "cst_2", name: "RED", value: "$02" });
    expect(out).toContain('"value": "$02"');
  });

  it("removes a constant and drops the block when the last goes", () => {
    expect(deleteConstant(TEXT, "cst_1")).not.toContain('"constants"');
  });

  it("sets and clears a meta field", () => {
    const described = setProjectMeta(TEXT, "description", "a test project");
    expect(parseProject(described).description).toBe("a test project");
    expect(parseProject(setProjectMeta(described, "description", undefined)).description)
      .toBeUndefined();
  });
});

describe("validation", () => {
  it("names what it expected rather than rendering nonsense", () => {
    // `encoding: "petsci"` was accepted, written back and rendered as ASCII for
    // as long as nothing checked it.
    expect(() =>
      parseProject(`{
        "layers": [{ "id": "lay_a", "type": "prg", "path": "g.prg" }],
        "claims": [{ "id": "clm_1", "at": "$8080", "is": "text", "encoding": "petsci" }]
      }`)
    ).toThrow(/Unknown text encoding "petsci"/);
  });

  it("refuses an interpretation of code, which is not one", () => {
    expect(() =>
      parseProject(`{
        "layers": [{ "id": "lay_a", "type": "prg", "path": "g.prg" }],
        "claims": [{ "id": "clm_1", "at": "$8080", "is": "code" }]
      }`)
    ).toThrow(/no "code"/);
  });
});
