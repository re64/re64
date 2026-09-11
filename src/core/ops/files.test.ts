import { fileId } from "../project/files.js";
import { describe, it, expect } from "vitest";
import { diffProjects, type FileContentRejection } from "./diff.js";
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
    expect(project.files).toEqual([{ id: fileId("revenge.d64"), name: "revenge.d64", hash: "abc123", size: 174848 }]);
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
    expect(parseProject(out).files).toEqual([{ id: fileId("x.prg"), name: "x.prg", hash: "h", size: 10 }]);
  });

  it("inverts to a removal, and a replacement inverts to the old entry", () => {
    const raw = JSON.stringify({ ...base(), files: [{ name: "x.prg", hash: "old", size: 1 }] });
    expect(invertOp(raw, { op: "file.add", name: "y.prg", hash: "h", size: 2 }))
      .toEqual({ op: "file.remove", id: fileId("y.prg") });
    // Re-adding under a name in use is undone to what was there before, not
    // removed — otherwise replacing a binary would delete the record of it.
    expect(invertOp(raw, { op: "file.add", name: "x.prg", hash: "new", size: 3 }))
      .toEqual({ op: "file.add", name: "x.prg", hash: "old", size: 1 });
  });
  it("cannot replace a modern id's bytes, but can rename it without changing references", () => {
    const raw = JSON.stringify({ ...base(), files: [{ id: "fil_first", name: "x.prg", hash: "old", size: 1 }] });
    const replace = { op: "file.add" as const, id: "fil_first", name: "new.prg", hash: "new", size: 2 };
    const doc = docFromProject(parseProject(raw));
    applyOpToDoc(doc, replace);
    expect(projectFromDoc(doc).files).toEqual(parseProject(raw).files);
    expect(parseProject(applyOps(raw, [replace])).files).toEqual(parseProject(raw).files);
    const renamed = parseProject(applyOps(raw, [{ op: "file.set", id: "fil_first", fields: { name: "renamed.prg" } }]));
    expect(renamed.files).toEqual([{ id: "fil_first", name: "renamed.prg", hash: "old", size: 1 }]);
    expect(diffProjects(parseProject(raw), renamed)).toEqual([{op:"file.set", id:"fil_first", fields:{name:"renamed.prg"}}]);
  });

});

for (const changed of [{hash:"new"}, {size:99}, {hash:undefined}]) {
  it(`rejects immutable content changes without losing independent metadata: ${JSON.stringify(changed)}`, () => {
    const before = { ...base(), files: [{id:"fil_modern",name:"game.prg",hash:"old",size:3}] };
    const after = {...before,name:"Renamed project",files:[{...before.files[0],...changed,name:"renamed.prg"}]};
    const rejected: FileContentRejection[] = [];
    const ops = diffProjects(before,after,rejected);
    expect(ops).toEqual([
      {op:"meta.set",key:"name",value:"Renamed project"},
      {op:"file.set",id:"fil_modern",fields:{name:"renamed.prg"}},
    ]);
    expect(rejected).toEqual([{file:"fil_modern",retained:{hash:"old",size:3},rejected:{hash:"old",size:3,...changed}}]);
    expect(parseProject(applyOps(JSON.stringify(before),ops)).files).toEqual([{...before.files[0],name:"renamed.prg"}]);
  });
}
