import { describe, it, expect } from "vitest";
import { diffProjects } from "./diff.js";
import { applyOps } from "./apply.js";
import { parseProject } from "../project/project.js";

/**
 * Written with claims, because a document never holds layer labels or regions —
 * `docFromProject` migrates on the way in, so there is nothing of that shape for
 * a diff to see. `label.set` and `region.set` are gone from the vocabulary and a
 * claim expresses both.
 */
const TEXT = `{
  "layers": [
    { "id": "lay_a", "type": "prg", "path": "game.prg" }
  ],
  "claims": [
    { "id": "clm_1", "at": "$8000", "name": "Start", "root": "routine", "author": "marcus", "source": "user" },
    { "id": "clm_2", "at": "$8080", "extent": 32, "name": "copyright", "is": "text", "author": "marcus", "source": "user" },

    { "id": "clm_3", "at": "$8100", "name": "Loop", "author": "marcus", "source": "user" }
  ]
}
`;

const edited = (mutate: (p: ReturnType<typeof parseProject>) => void) => {
  const project = parseProject(TEXT);
  mutate(project);
  return project;
};

describe("diffProjects", () => {
  it("is empty when nothing changed", () => {
    expect(diffProjects(parseProject(TEXT), parseProject(TEXT))).toEqual([]);
  });

  it("emits one operation for a rename", () => {
    const after = edited((p) => {
      p.claims![2].name = "MainLoop";
    });

    const ops = diffProjects(parseProject(TEXT), after);
    expect(ops).toHaveLength(1);
    // A revision names only what changed, so two peers editing different fields
    // of one claim do not clobber each other.
    expect(ops[0]).toMatchObject({ op: "claim.set", id: "clm_3", fields: { name: "MainLoop" } });
  });

  it("is unmoved by reordering, since identity is the id", () => {
    const after = edited((p) => {
      p.claims!.reverse();
    });
    expect(diffProjects(parseProject(TEXT), after)).toEqual([]);
  });

  it("deletes before it re-adds, so a moved entry never exists twice", () => {
    const after = edited((p) => {
      p.claims!.splice(0, 1);
      p.claims!.push({ id: "clm_4", at: "$8200", name: "New", author: "marcus", source: "user" });
    });

    const ops = diffProjects(parseProject(TEXT), after);
    expect(ops[0].op).toBe("claim.remove");
    expect(ops.some((o) => o.op === "claim.add" && o.claim.id === "clm_4")).toBe(true);
  });

  it("covers interpretations and the primary index", () => {
    const after = edited((p) => {
      p.claims![1].is = "data";
      p.primaryLabels = { $8000: "clm_1" };
    });

    const ops = diffProjects(parseProject(TEXT), after);
    expect(
      ops.some((o) => o.op === "claim.set" && o.fields.says?.is === "data")
    ).toBe(true);
    expect(ops.some((o) => o.op === "primary.bind" && o.labelId === "clm_1")).toBe(true);
  });

  it("round-trips: applying the diff reaches the target content", () => {
    const after = edited((p) => {
      p.claims![0].name = "Begin";
      p.claims![0].root = "location";
      p.claims![1].extent = 128;
    });

    const out = applyOps(TEXT, diffProjects(parseProject(TEXT), after));
    const reparsed = parseProject(out);

    const byId = new Map((reparsed.claims ?? []).map((c) => [c.id, c]));
    expect(byId.get("clm_1")).toMatchObject({ name: "Begin", root: "location" });
    expect(byId.get("clm_2")).toMatchObject({ extent: 128 });
  });
});
