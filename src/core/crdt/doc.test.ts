import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  applyUpdate,
  diffSince,
  docFromProject,
  encodeDoc,
  projectFromDoc,
  squashUpdates,
  stateVector,
} from "./doc.js";
import { applyOpToDoc, undoManagerFor } from "./ops.js";
import { Project } from "../project/project.js";
import { Op } from "../ops/types.js";

const PROJECT: Project = {
  name: "Test",
  layers: [
    {
      id: "lay_s",
      type: "symbols",
      name: "syms",
      labels: [{ id: "lbl_a", address: "$02", name: "playerX" }],
    },
    {
      id: "lay_p",
      type: "prg",
      path: "game.prg",
      regions: [{ id: "rgn_1", start: "$8080", end: "$80A0", kind: "text", name: "copyright" }],
      labels: [
        { id: "lbl_b", address: "$8000", name: "Start", type: "function" },
        { id: "lbl_c", address: "$8100", name: "Loop" },
      ],
    },
  ],
  entryPoints: ["$8000"],
  primaryLabels: { $8000: "lbl_b" },
};

const hex = (u: Uint8Array) => Buffer.from(u).toString("hex");

describe("deterministic construction", () => {
  it("builds byte-identical documents on every client", () => {
    // The property the whole design rests on: readable JSON stays canonical
    // only because two clients loading it get a shared ancestor to merge onto.
    // Without this, identical content takes different internal ids and merging
    // duplicates instead of combining.
    expect(hex(encodeDoc(docFromProject(PROJECT)))).toBe(
      hex(encodeDoc(docFromProject(PROJECT)))
    );
  });

  it("does not depend on the order fields were written", () => {
    const reordered: Project = {
      layers: PROJECT.layers,
      primaryLabels: PROJECT.primaryLabels,
      entryPoints: PROJECT.entryPoints,
      name: PROJECT.name,
    };
    expect(hex(encodeDoc(docFromProject(reordered)))).toBe(
      hex(encodeDoc(docFromProject(PROJECT)))
    );
  });
});

describe("round trip", () => {
  it("reads back the project it was built from", () => {
    expect(projectFromDoc(docFromProject(PROJECT))).toEqual(PROJECT);
  });

  it("reads back a document reconstructed from an update", () => {
    // A fresh document reports nothing until its roots are touched, which
    // projectFromDoc does; a reader that forgot would silently see an empty
    // project.
    const fresh = new Y.Doc();
    applyUpdate(fresh, encodeDoc(docFromProject(PROJECT)));
    expect(projectFromDoc(fresh)).toEqual(PROJECT);
  });

  it("orders entries by address regardless of insertion order", () => {
    const doc = docFromProject(PROJECT);
    applyOpToDoc(doc, {
      op: "label.set",
      id: "lbl_z",
      layerId: "lay_p",
      address: 0x8050,
      name: "Between",
    });

    const labels = projectFromDoc(doc).layers[1].labels!;
    expect(labels.map((l) => l.name)).toEqual(["Start", "Between", "Loop"]);
  });
});

describe("merge", () => {
  const twoClients = () => {
    const a = docFromProject(PROJECT);
    const b = docFromProject(PROJECT);
    a.clientID = 101;
    b.clientID = 202;
    return [a, b] as const;
  };

  const sync = (a: Y.Doc, b: Y.Doc) => {
    applyUpdate(a, encodeDoc(b));
    applyUpdate(b, encodeDoc(a));
  };

  it("keeps both sides of divergent edits", () => {
    const [a, b] = twoClients();
    applyOpToDoc(a, {
      op: "label.set",
      id: "lbl_c",
      layerId: "lay_p",
      address: 0x8100,
      name: "MainLoop",
    });
    applyOpToDoc(b, {
      op: "region.set",
      id: "rgn_1",
      layerId: "lay_p",
      start: 0x8080,
      end: 0x80a0,
      kind: "data",
      name: "copyright",
    });
    sync(a, b);

    const merged = projectFromDoc(a);
    expect(merged.layers[1].labels!.find((l) => l.id === "lbl_c")!.name).toBe("MainLoop");
    expect(merged.layers[1].regions![0].kind).toBe("data");
    expect(projectFromDoc(b)).toEqual(merged);
  });

  it("converges when both write the same key", () => {
    // The property the primary-label index depends on: promoting is one map
    // entry, so concurrent promotions pick a winner instead of leaving two.
    const [a, b] = twoClients();
    applyOpToDoc(a, { op: "primary.set", address: 0x8000, labelId: "lbl_x" });
    applyOpToDoc(b, { op: "primary.set", address: 0x8000, labelId: "lbl_y" });
    sync(a, b);

    expect(projectFromDoc(a).primaryLabels).toEqual(projectFromDoc(b).primaryLabels);
  });

  it("survives a delete racing an edit", () => {
    const [a, b] = twoClients();
    applyOpToDoc(a, { op: "label.delete", id: "lbl_c", layerId: "lay_p" });
    applyOpToDoc(b, {
      op: "label.set",
      id: "lbl_c",
      layerId: "lay_p",
      address: 0x8100,
      name: "Renamed",
    });
    sync(a, b);

    expect(projectFromDoc(a)).toEqual(projectFromDoc(b));
  });
});

describe("undo", () => {
  it("reverts my edits and leaves a collaborator's alone", () => {
    const doc = docFromProject(PROJECT);
    doc.clientID = 1;
    const undo = undoManagerFor(doc, "me");

    applyOpToDoc(doc, {
      op: "label.set", id: "lbl_b", layerId: "lay_p", address: 0x8000, name: "Mine",
    }, "me");
    applyOpToDoc(doc, {
      op: "label.set", id: "lbl_c", layerId: "lay_p", address: 0x8100, name: "Theirs",
    }, "them");

    undo.undo();

    const labels = projectFromDoc(doc).layers[1].labels!;
    expect(labels.find((l) => l.id === "lbl_b")!.name).toBe("Start");
    expect(labels.find((l) => l.id === "lbl_c")!.name).toBe("Theirs");
  });

  it("redoes what it undid", () => {
    const doc = docFromProject(PROJECT);
    doc.clientID = 1;
    const undo = undoManagerFor(doc, "me");

    applyOpToDoc(doc, {
      op: "label.set", id: "lbl_b", layerId: "lay_p", address: 0x8000, name: "Mine",
    }, "me");
    undo.undo();
    undo.redo();

    expect(projectFromDoc(doc).layers[1].labels!.find((l) => l.id === "lbl_b")!.name).toBe("Mine");
  });
});

describe("session squashing", () => {
  it("collapses a session's updates into one that replays identically", () => {
    const base = docFromProject(PROJECT);
    const baseline = encodeDoc(base);

    const session = new Y.Doc();
    applyUpdate(session, baseline);
    session.clientID = 7;

    const updates: Uint8Array[] = [];
    session.on("update", (u: Uint8Array) => updates.push(u));

    const ops: Op[] = [
      { op: "label.set", id: "lbl_b", layerId: "lay_p", address: 0x8000, name: "One" },
      { op: "label.set", id: "lbl_c", layerId: "lay_p", address: 0x8100, name: "Two" },
      { op: "primary.clear", address: 0x8000 },
    ];
    for (const op of ops) applyOpToDoc(session, op);

    const replay = new Y.Doc();
    applyUpdate(replay, baseline);
    applyUpdate(replay, squashUpdates(updates));

    expect(projectFromDoc(replay)).toEqual(projectFromDoc(session));
  });

  it("sends only what a peer is missing", () => {
    const base = docFromProject(PROJECT);
    const before = stateVector(base);
    applyOpToDoc(base, {
      op: "label.set", id: "lbl_b", layerId: "lay_p", address: 0x8000, name: "Changed",
    });

    expect(diffSince(base, before).length).toBeLessThan(encodeDoc(base).length);
  });
});

describe("what a flatten may and may not assume", () => {
  it("gives back content, not formatting", () => {
    // projectFromDoc knows nothing about how the file was laid out: which
    // labels were grouped by a blank line, or the order regions were declared
    // in. So a session must be flattened through the operation layer and the
    // line-editing serializer. Regenerating the text from this would replace a
    // one-line edit with a whole-file diff.
    const doc = docFromProject(PROJECT);
    const back = projectFromDoc(doc);

    expect(back.layers[1].labels!.map((l) => l.id)).toEqual(["lbl_b", "lbl_c"]);
    expect(Object.keys(back.layers[1].labels![0])).toEqual(["id", "address", "name", "type"]);
  });

  it("orders entries by address, whatever order they arrived in", () => {
    // Map iteration order differs between clients that inserted concurrently,
    // so something has to impose one; address is the order a reader expects.
    const doc = docFromProject(PROJECT);
    applyOpToDoc(doc, {
      op: "region.set", id: "rgn_early", layerId: "lay_p",
      start: 0x8000, end: 0x8010, kind: "data",
    });

    const starts = projectFromDoc(doc).layers[1].regions!.map((r) => r.start);
    expect(starts).toEqual(["$8000", "$8080"]);
  });
});
