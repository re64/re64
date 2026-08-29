import { describe, it, expect } from "vitest";
import { diffProjects } from "./diff.js";
import { applyOps } from "./apply.js";
import { parseProject } from "../project/project.js";

const TEXT = `{
  "layers": [
    {
      "id": "lay_a",
      "type": "prg",
      "path": "game.prg",
      "regions": [
        { "id": "rgn_1", "start": "$8080", "end": "$80A0", "kind": "text", "name": "copyright" }
      ],
      "labels": [
        { "id": "lbl_1", "address": "$8000", "name": "Start", "type": "function" },

        { "id": "lbl_2", "address": "$8100", "name": "Loop" }
      ]
    }
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
      p.layers[0].labels![1].name = "MainLoop";
    });

    const ops = diffProjects(parseProject(TEXT), after);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: "label.set", id: "lbl_2", name: "MainLoop" });
  });

  it("applies back through the line editor, touching one line", () => {
    // The whole point of diffing rather than rewriting: the file keeps its
    // formatting, and the grouping blank line survives.
    const after = edited((p) => {
      p.layers[0].labels![1].name = "MainLoop";
    });

    const out = applyOps(TEXT, diffProjects(parseProject(TEXT), after));
    const before = TEXT.split("\n");
    const now = out.split("\n");

    expect(before.filter((l, i) => l !== now[i])).toHaveLength(1);
    expect(now.filter((l) => !l.trim())).toHaveLength(before.filter((l) => !l.trim()).length);
  });

  it("does not rewrite entries that only moved in the list", () => {
    // A merged document orders by address; the file may not. Reordering alone
    // must produce no operations, or every flatten would rewrite the file.
    const after = edited((p) => {
      p.layers[0].labels!.reverse();
    });

    expect(diffProjects(parseProject(TEXT), after)).toEqual([]);
  });

  it("deletes before it re-adds, so a moved entry never exists twice", () => {
    const after = edited((p) => {
      p.layers[0].labels!.splice(0, 1);
      p.layers[0].labels!.push({ id: "lbl_3", address: "$8200", name: "New" });
    });

    const ops = diffProjects(parseProject(TEXT), after);
    expect(ops[0].op).toBe("label.delete");
    expect(ops.some((o) => o.op === "label.set" && o.id === "lbl_3")).toBe(true);
  });

  it("covers regions and the primary index", () => {
    const after = edited((p) => {
      p.layers[0].regions![0].kind = "data";
      p.primaryLabels = { $8000: "lbl_1" };
    });

    const ops = diffProjects(parseProject(TEXT), after);
    expect(ops.some((o) => o.op === "region.set" && o.kind === "data")).toBe(true);
    expect(ops.some((o) => o.op === "primary.set" && o.labelId === "lbl_1")).toBe(true);
  });

  it("round-trips: applying the diff reaches the target content", () => {
    const after = edited((p) => {
      p.layers[0].labels![0].name = "Begin";
      p.layers[0].labels![0].type = "code";
      p.layers[0].regions![0].end = "$8100";
      p.primaryLabels = { $8100: "lbl_2" };
    });

    const out = parseProject(applyOps(TEXT, diffProjects(parseProject(TEXT), after)));
    expect(diffProjects(out, after)).toEqual([]);
  });
});
