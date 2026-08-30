import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  BASE_CLIENT_ID,
  applyUpdate,
  diffSince,
  docFromProject,
  docFromUpdates,
  emptyDoc,
  encodeDoc,
  projectFromDoc,
  squashUpdates,
  stateVector,
} from "./doc.js";
import { applyOpToDoc, applyOpsToDoc, undoManagerFor } from "./ops.js";
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

describe("joining without a shared base", () => {
  it("starts empty and takes everything from a peer", () => {
    // The safe way in. Building a base locally from JSON both sides are assumed
    // to share only works while those bytes are provably identical, and fails
    // silently when they are not.
    const server = docFromProject(PROJECT);
    const joining = emptyDoc();
    expect(projectFromDoc(joining).layers).toEqual([]);

    applyUpdate(joining, encodeDoc(server));
    expect(projectFromDoc(joining)).toEqual(projectFromDoc(server));
  });

  it("takes its own client id, so its edits stay distinguishable", () => {
    const joining = emptyDoc();
    expect(joining.clientID).not.toBe(BASE_CLIENT_ID);
  });

  it("keeps deleted content, so history can be reconstructed", () => {
    expect(emptyDoc().gc).toBe(false);
    expect(docFromProject(PROJECT).gc).toBe(false);
    expect(docFromUpdates([]).gc).toBe(false);
  });
});

describe("rebuilding from stored updates", () => {
  it("reaches the same state the updates came from", () => {
    const original = docFromProject(PROJECT);
    const rebuilt = docFromUpdates([encodeDoc(original)]);
    expect(projectFromDoc(rebuilt)).toEqual(projectFromDoc(original));
  });

  it("does not care what order they are replayed in", () => {
    const source = docFromProject(PROJECT);
    const updates: Uint8Array[] = [];
    source.on("update", (u: Uint8Array) => updates.push(u));

    applyOpToDoc(source, {
      op: "label.set", id: "lbl_b", layerId: "lay_p", address: 0x8000, name: "One",
      type: "function",
    });
    applyOpToDoc(source, {
      op: "label.set", id: "lbl_c", layerId: "lay_p", address: 0x8100, name: "Two",
    });

    const base = encodeDoc(docFromProject(PROJECT));
    const forwards = docFromUpdates([base, ...updates]);
    const backwards = docFromUpdates([base, ...[...updates].reverse()]);
    expect(projectFromDoc(backwards)).toEqual(projectFromDoc(forwards));
  });

  it("is unbothered by a duplicate", () => {
    const base = encodeDoc(docFromProject(PROJECT));
    const once = docFromUpdates([base]);
    const twice = docFromUpdates([base, base]);
    expect(projectFromDoc(twice)).toEqual(projectFromDoc(once));
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

describe("one action, one undo step", () => {
  const names = (doc: ReturnType<typeof docFromProject>) =>
    (projectFromDoc(doc).layers[1].labels ?? []).map((l) => l.name);

  it("takes back a whole batch at once", () => {
    // Promoting a label to a function sets its type and renames it. Undo has
    // to take both or neither; pressing it twice for one action is a bug.
    const doc = docFromProject(PROJECT);
    const um = undoManagerFor(doc, "me");

    applyOpsToDoc(
      doc,
      [
        { op: "label.set", id: "lbl_c", layerId: "lay_p", address: 0x8100, name: "sub_8100",
          type: "function" },
        { op: "primary.set", address: 0x8100, labelId: "lbl_c" },
      ],
      "me"
    );
    expect(names(doc)).toContain("sub_8100");

    um.undo();
    expect(names(doc)).toContain("Loop");
    expect(projectFromDoc(doc).primaryLabels?.["8100"]).toBeUndefined();
  });

  it("keeps two separate actions separate, however fast they were", () => {
    // The UndoManager default merges anything within 500ms into one step,
    // which is right for typing and wrong for deliberate edits.
    const doc = docFromProject(PROJECT);
    const um = undoManagerFor(doc, "me");

    applyOpsToDoc(doc,
      [{ op: "label.set", id: "lbl_b", layerId: "lay_p", address: 0x8000, name: "First",
         type: "function" }], "me");
    applyOpsToDoc(doc,
      [{ op: "label.set", id: "lbl_c", layerId: "lay_p", address: 0x8100, name: "Second" }], "me");

    um.undo();
    expect(names(doc)).toContain("First");
    expect(names(doc)).toContain("Loop");
  });

  it("does nothing when the batch is empty", () => {
    const doc = docFromProject(PROJECT);
    const before = hex(encodeDoc(doc));
    applyOpsToDoc(doc, [], "me");
    expect(hex(encodeDoc(doc))).toBe(before);
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

describe("comments in the document", () => {
  const project = {
    name: "t",
    layers: [
      {
        id: "lay_a",
        type: "prg" as const,
        path: "game.prg",
        comments: [
          { id: "cmt_1", address: "$8000", text: "why this exists" },
          { id: "cmt_2", address: "$8004", placement: "inline" as const, text: "beside" },
        ],
      },
    ],
  };

  it("survives the trip out and back", () => {
    const back = projectFromDoc(docFromProject(project));
    expect(back.layers[0].comments).toEqual(project.layers[0].comments);
  });

  it("orders them the same way on every peer", () => {
    // Ordering has to be identical everywhere without anyone coordinating,
    // because two peers rendering different orders is a visible disagreement
    // about a document they have both fully synchronised.
    const shuffled = {
      ...project,
      layers: [
        { ...project.layers[0], comments: [...project.layers[0].comments].reverse() },
      ],
    };

    expect(projectFromDoc(docFromProject(shuffled)).layers[0].comments).toEqual(
      projectFromDoc(docFromProject(project)).layers[0].comments
    );
  });

  it("leaves a layer with no comments without the key", () => {
    const bare = { name: "t", layers: [{ id: "lay_a", type: "prg" as const, path: "g.prg" }] };
    expect(projectFromDoc(docFromProject(bare)).layers[0].comments).toBeUndefined();
  });
});
