import { describe, it, expect } from "vitest";
import { diffProjects } from "./diff.js";
import { applyOps, invertOp } from "./apply.js";
import { parseProject } from "../project/project.js";
import { docFromProject, projectFromDoc } from "../crdt/doc.js";
import { applyOpToDoc } from "../crdt/ops.js";

const base = () => parseProject(JSON.stringify({
  name: "t", layers: [{ id: "lay_a", type: "bytes", address: "$8000", bytes: "A9 01 60" }],
}));

describe("a file in the document", () => {
  it("round-trips through the document and the export", () => {
    const doc = docFromProject(base());
    applyOpToDoc(doc, { op: "file.add", name: "revenge.d64", hash: "abc123", size: 174848 }, "me");
    const project = projectFromDoc(doc);
    expect(project.files).toEqual([{ name: "revenge.d64", hash: "abc123", size: 174848 }]);
  });

  it("is emitted by diffProjects, so it reaches the export", () => {
    const before = base();
    const after = { ...base(), files: [{ name: "x.prg", hash: "h", size: 10 }] };
    const ops = diffProjects(before, after);
    expect(ops.some((o) => o.op === "file.add")).toBe(true);
  });

  it("survives applyOps into the text", () => {
    const raw = JSON.stringify(base(), null, 2);
    const out = applyOps(raw, [{ op: "file.add", name: "x.prg", hash: "h", size: 10 }]);
    expect(parseProject(out).files).toEqual([{ name: "x.prg", hash: "h", size: 10 }]);
  });

  it("inverts to a removal, and a replacement inverts to the old entry", () => {
    const raw = JSON.stringify({ ...base(), files: [{ name: "x.prg", hash: "old", size: 1 }] });
    expect(invertOp(raw, { op: "file.add", name: "y.prg", hash: "h", size: 2 }))
      .toEqual({ op: "file.remove", name: "y.prg" });
    // Re-adding under a name in use is undone to what was there before, not
    // removed — otherwise replacing a binary would delete the record of it.
    expect(invertOp(raw, { op: "file.add", name: "x.prg", hash: "new", size: 3 }))
      .toEqual({ op: "file.add", name: "x.prg", hash: "old", size: 1 });
  });
});
