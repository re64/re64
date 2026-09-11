import { filesWithIds } from "../project/files.js";
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
  migrateDoc,
  projectFromDoc,
  squashUpdates,
  stateVector,
} from "./doc.js";
import { applyOpToDoc, applyOpsToDoc, undoManagerFor } from "./ops.js";
import { Project, entryPointsIntoTarget } from "../project/project.js";
import { derivedId } from "../project/identity.js";
import { Op } from "../ops/types.js";

/**
 * Written with claims. A document never holds layer labels or regions —
 * `docFromProject` migrates a legacy project on the way in — so a fixture in the
 * old shape would be converted here and compared against itself unconverted.
 */
const PROJECT: Project = {
  name: "Test",
  layers: [
    { id: "lay_s", type: "symbols", name: "syms" },
    { id: "lay_p", type: "prg", path: "game.prg" },
  ],
  claims: [
    { id: "lbl_a", at: "$0002", name: "playerX", origin: "user" },
    { id: "lbl_b", at: "$8000", name: "Start", root: "routine", origin: "user" },
    { id: "rgn_1", at: "$8080", extent: 32, name: "copyright", is: "text", root: "data", origin: "user" },
    { id: "lbl_c", at: "$8100", name: "Loop", origin: "user" },
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
      claims: PROJECT.claims,
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
    expect(projectFromDoc(docFromProject(PROJECT))).toEqual(filesWithIds(entryPointsIntoTarget(PROJECT)));
  });

  it("reads back a document reconstructed from an update", () => {
    // A fresh document reports nothing until its roots are touched, which
    // projectFromDoc does; a reader that forgot would silently see an empty
    // project.
    const fresh = new Y.Doc();
    applyUpdate(fresh, encodeDoc(docFromProject(PROJECT)));
    expect(projectFromDoc(fresh)).toEqual(filesWithIds(entryPointsIntoTarget(PROJECT)));
  });

  it("orders entries by address regardless of insertion order", () => {
    const doc = docFromProject(PROJECT);
    applyOpToDoc(doc, { op: "claim.add", claim: { id: "lbl_z", at: 0x8050, name: "Between", origin: "user" } });

    const named = projectFromDoc(doc).claims!.filter((c) => c.at !== "$0002");
    expect(named.map((c) => c.name)).toEqual(["Start", "Between", "copyright", "Loop"]);
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

    applyOpToDoc(source, { op: "claim.add", claim: { id: "lbl_b", at: 0x8000, name: "One", root: "routine", origin: "user" } });
    applyOpToDoc(source, { op: "claim.add", claim: { id: "lbl_c", at: 0x8100, name: "Two", origin: "user" } });

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
    applyOpToDoc(a, { op: "claim.add", claim: { id: "lbl_c", at: 0x8100, name: "MainLoop", origin: "user" } });
    applyOpToDoc(b, { op: "claim.add", claim: { id: "rgn_1", at: 0x8080, extent: 0x80a0 - 0x8080, name: "copyright", says: { is: "data" }, root: "data", origin: "user" } });
    sync(a, b);

    const merged = projectFromDoc(a);
    expect(merged.claims!.find((c) => c.id === "lbl_c")!.name).toBe("MainLoop");
    expect(merged.claims!.find((c) => c.id === "rgn_1")!.is).toBe("data");
    expect(projectFromDoc(b)).toEqual(merged);
  });

  it("converges when both write the same key", () => {
    // The property the primary-label index depends on: promoting is one map
    // entry, so concurrent promotions pick a winner instead of leaving two.
    const [a, b] = twoClients();
    applyOpToDoc(a, { op: "primary.bind", address: 0x8000, labelId: "lbl_x" });
    applyOpToDoc(b, { op: "primary.bind", address: 0x8000, labelId: "lbl_y" });
    sync(a, b);

    expect(projectFromDoc(a).primaryLabels).toEqual(projectFromDoc(b).primaryLabels);
  });

  it("survives a delete racing an edit", () => {
    const [a, b] = twoClients();
    applyOpToDoc(a, { op: "claim.remove", id: "lbl_c" });
    applyOpToDoc(b, { op: "claim.add", claim: { id: "lbl_c", at: 0x8100, name: "Renamed", origin: "user" } });
    sync(a, b);

    expect(projectFromDoc(a)).toEqual(projectFromDoc(b));
  });
});

describe("undo", () => {
  it("reverts my edits and leaves a collaborator's alone", () => {
    const doc = docFromProject(PROJECT);
    doc.clientID = 1;
    const undo = undoManagerFor(doc, "me");

    applyOpToDoc(doc, { op: "claim.add", claim: { id: "lbl_b", at: 0x8000, name: "Mine", origin: "user" } }, "me");
    applyOpToDoc(doc, { op: "claim.add", claim: { id: "lbl_c", at: 0x8100, name: "Theirs", origin: "user" } }, "them");

    undo.undo();

    const claims = projectFromDoc(doc).claims!;
    expect(claims.find((c) => c.id === "lbl_b")!.name).toBe("Start");
    expect(claims.find((c) => c.id === "lbl_c")!.name).toBe("Theirs");
  });

  it("redoes what it undid", () => {
    const doc = docFromProject(PROJECT);
    doc.clientID = 1;
    const undo = undoManagerFor(doc, "me");

    applyOpToDoc(doc, { op: "claim.add", claim: { id: "lbl_b", at: 0x8000, name: "Mine", origin: "user" } }, "me");
    undo.undo();
    undo.redo();

    expect(projectFromDoc(doc).claims!.find((c) => c.id === "lbl_b")!.name).toBe("Mine");
  });
});

describe("one action, one undo step", () => {
  const names = (doc: ReturnType<typeof docFromProject>) =>
    (projectFromDoc(doc).claims ?? []).map((c) => c.name);

  it("takes back a whole batch at once", () => {
    // Promoting a label to a function sets its type and renames it. Undo has
    // to take both or neither; pressing it twice for one action is a bug.
    const doc = docFromProject(PROJECT);
    const um = undoManagerFor(doc, "me");

    applyOpsToDoc(
      doc,
      [
        { op: "claim.add", claim: { id: "lbl_c", at: 0x8100, name: "sub_8100", root: "routine", origin: "user" } },
        { op: "primary.bind", address: 0x8100, labelId: "lbl_c" },
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
      [{ op: "claim.add", claim: { id: "lbl_b", at: 0x8000, name: "First", root: "routine", origin: "user" } }], "me");
    applyOpsToDoc(doc,
      [{ op: "claim.add", claim: { id: "lbl_c", at: 0x8100, name: "Second", origin: "user" } }], "me");

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
      { op: "claim.add", claim: { id: "lbl_b", at: 0x8000, name: "One", origin: "user" } },
      { op: "claim.add", claim: { id: "lbl_c", at: 0x8100, name: "Two", origin: "user" } },
      { op: "primary.unbind", address: 0x8000 },
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
    applyOpToDoc(base, { op: "claim.add", claim: { id: "lbl_b", at: 0x8000, name: "Changed", origin: "user" } });

    expect(diffSince(base, before).length).toBeLessThan(encodeDoc(base).length);
  });
});

describe("what a flatten may and may not assume", () => {
  it("gives back content, not formatting", () => {
    // `projectFromDoc` knows nothing about how a file was laid out, and no
    // longer needs to: the export is a full dump regenerated from the document,
    // so there is no hand-authored layout left to preserve. What it must give
    // back is every field, in a defined order, so two peers flattening the same
    // document produce the same text.
    const doc = docFromProject(PROJECT);
    const back = projectFromDoc(doc);

    expect(back.claims!.map((c) => c.id)).toEqual(["lbl_a", "lbl_b", "rgn_1", "lbl_c"]);
    expect(Object.keys(back.claims![1])).toEqual(["id", "at", "name", "root", "origin"]);
  });

  it("orders entries by address, whatever order they arrived in", () => {
    // Map iteration order differs between clients that inserted concurrently,
    // so something has to impose one; address is the order a reader expects.
    const doc = docFromProject(PROJECT);
    applyOpToDoc(doc, { op: "claim.add", claim: { id: "rgn_early", at: 0x8000, extent: 0x8010 - 0x8000, says: { is: "data" }, root: "data", origin: "user" } });

    const spans = projectFromDoc(doc)
      .claims!.filter((c) => c.is !== undefined)
      .map((c) => c.at);
    expect(spans).toEqual(["$8000", "$8080"]);
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

describe("migrating a stored document's bindings", () => {
  /**
   * The shape a `.re64db` written before bindings were keyed by site holds:
   * uses keyed by use id. `docFromProject` never sees one — a store restores a
   * snapshot and its updates directly — so an upgraded project kept the R4
   * behaviour exactly until the stored map itself was rekeyed.
   */
  const legacy = () => {
    const doc = emptyDoc();
    const layer = new Y.Map<unknown>();
    doc.getArray<Y.Map<unknown>>("layers").push([layer]);
    layer.set("id", "lay_a");
    layer.set("type", "prg");
    layer.set("path", "g.prg");
    const mk = (o: Record<string, unknown>) => {
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(o)) m.set(k, v);
      return m;
    };
    const uses = new Y.Map<unknown>();
    layer.set("constantUses", uses);
    uses.set("cst_u1", mk({ id: "cst_u1", address: "$8000", constant: "cst_a" }));
    uses.set("cst_u0", mk({ id: "cst_u0", address: "$8000", constant: "cst_b" }));
    uses.set("cst_u2", mk({ id: "cst_u2", address: "$8010", constant: "cst_b" }));
    const labelUses = new Y.Map<unknown>();
    layer.set("labelUses", labelUses);
    labelUses.set("lbl_u1", mk({ id: "lbl_u1", address: "$8004", label: "clm_1" }));
    return doc;
  };
  const constantsOf = (doc: Y.Doc) =>
    (projectFromDoc(doc).constantUses ?? []).map((u) => `${u.at}=${u.constant}`).sort();

  it("keys each use by its site, and where two shared one keeps the last id", () => {
    const doc = legacy();
    expect(migrateDoc(doc)).toBe(true);
    // `cst_u1` sorts after `cst_u0`, and was the one the loaded index showed.
    expect(constantsOf(doc)).toEqual(["$8000=cst_a", "$8010=cst_b"]);
    expect(projectFromDoc(doc).labelUses).toEqual([{ id: "lbl_u1", at: "$8004", label: "clm_1" }]);
    // At the root, keyed by the site with its frame — and gone from the layer.
    const keys = [...doc.getMap<unknown>("constantUses").keys()].sort();
    expect(keys).toEqual(["address::$8000", "address::$8010"]);
    expect(doc.getArray<Y.Map<unknown>>("layers").get(0).has("constantUses")).toBe(false);
  });

  it("takes an unbind stored without an address, by the id it carries", () => {
    const doc = legacy();
    migrateDoc(doc);
    applyOpToDoc(doc, { op: "constantUse.unbind", id: "cst_u2", layerId: "lay_a" });
    expect(constantsOf(doc)).toEqual(["$8000=cst_a"]);
    // And one naming an id nothing holds does nothing, rather than guessing.
    applyOpToDoc(doc, { op: "constantUse.unbind", id: "cst_u0", layerId: "lay_a" });
    expect(constantsOf(doc)).toEqual(["$8000=cst_a"]);
  });

  it("moves nothing twice", () => {
    const doc = legacy();
    migrateDoc(doc);
    expect(migrateDoc(doc)).toBe(false);
  });
});

describe("a record written before fields had ids", () => {
  /**
   * **Converting the shape is not the migration; the identity is.**
   *
   * Fields used to be an object keyed by offset, and every `.re64` written then
   * says so. `fieldsOfType` turned that object into a list — and stopped there,
   * leaving each field without an id. `typeMapFrom` keys the inner map by id and
   * skipped anything that had none, so a legacy record reached the document
   * holding **no fields at all**, silently, on load.
   *
   * The id is derived rather than minted for the reason `derivedId` exists: two
   * clients opening one un-migrated file have to agree, or the merge sees two
   * fields where the file has one — which is the identity defect this whole
   * change is about, reintroduced by its own migration.
   */
  const legacy = {
    name: "old",
    layers: [{ id: "lay_a", type: "prg" as const, path: "g.prg" }],
    types: [
      {
        id: "typ_a",
        name: "Sprite",
        size: 4,
        // As written on disk: keyed by offset, and not one id among them.
        fields: { 0: { name: "x", type: "u8" }, 2: { name: "y", type: "u8" } },
      },
    ],
  } as unknown as Project;

  it("keeps its fields, and gives each one an identity", () => {
    const fields = projectFromDoc(docFromProject(legacy)).types![0].fields;
    expect(fields.map((f) => f.name)).toEqual(["x", "y"]);
    expect(fields.map((f) => f.offset)).toEqual([0, 2]);
    for (const field of fields) expect(field.id).toMatch(/^fld_/);
  });

  it("gives two readers of that file the same ids", () => {
    const one = projectFromDoc(docFromProject(legacy)).types![0].fields;
    const two = projectFromDoc(docFromProject(legacy)).types![0].fields;
    expect(one.map((f) => f.id)).toEqual(two.map((f) => f.id));
  });

  it("tells the two fields apart, having no offset to key on", () => {
    const doc = docFromProject(legacy);
    const [x, y] = projectFromDoc(doc).types![0].fields;
    applyOpToDoc(doc, { op: "field.remove", id: x.id!, typeId: "typ_a" });
    const left = projectFromDoc(doc).types![0].fields;
    expect(left.map((f) => f.id)).toEqual([y.id]);
  });
});

describe("migrating a stored document's fields", () => {
  /**
   * The shape a `.re64db` written before fields were keyed by id holds: an
   * offset-keyed map of plain objects. `docFromProject` never sees one — a
   * store restores a snapshot and its updates directly — so the text migration
   * in `fieldsOfType` did nothing for it, and every stored project kept
   * projecting its fields without offsets and taking no edits by id.
   */
  const legacy = () => {
    const doc = emptyDoc();
    const entry = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("types").set("typ_a", entry);
    entry.set("id", "typ_a");
    entry.set("name", "Sprite");
    entry.set("size", 16);
    const fields = new Y.Map<unknown>();
    entry.set("fields", fields);
    fields.set("4", { id: "fld_a", name: "x", type: "u8", description: "kept" });
    fields.set("12", { name: "y", type: "u8" });
    return doc;
  };

  it("keys each field by id, carrying the offset it was keyed by", () => {
    const doc = legacy();
    expect(migrateDoc(doc)).toBe(true);
    const fields = projectFromDoc(doc).types![0].fields;
    expect(fields.map((f) => [f.id, f.offset, f.name, f.description])).toEqual([
      ["fld_a", 4, "x", "kept"],
      [derivedId("fld", "typ_a", 12), 12, "y", undefined],
    ]);
  });

  it("derives the same id the text migration does for a field without one", () => {
    const doc = legacy();
    migrateDoc(doc);
    const throughText = projectFromDoc(
      docFromProject({
        layers: [],
        types: [{ id: "typ_a", name: "Sprite", size: 16, fields: { 12: { name: "y", type: "u8" } } }],
      } as unknown as Project)
    );
    expect(projectFromDoc(doc).types![0].fields[1].id).toBe(throughText.types![0].fields[0].id);
  });

  it("takes edits by id afterwards, and moves nothing twice", () => {
    const doc = legacy();
    migrateDoc(doc);
    applyOpToDoc(doc, { op: "field.set", id: "fld_a", typeId: "typ_a", fields: { name: "renamed" } });
    expect(projectFromDoc(doc).types![0].fields[0].name).toBe("renamed");
    expect(migrateDoc(doc)).toBe(false);
    expect(projectFromDoc(doc).types![0].fields[0].name).toBe("renamed");
  });
});

describe("migrating a stored document's entry points", () => {
  /**
   * A root `entryPoints` list lived under `meta` before targets existed, and a
   * stored snapshot still holding one never passes through the file migration.
   * Same move `entryPointsIntoTarget` makes for a file: a target for a document
   * with none, nothing for one with targets, and the meta key goes either way.
   */
  const legacy = (withTarget: boolean) => {
    const doc = emptyDoc();
    const layer = new Y.Map<unknown>();
    doc.getArray<Y.Map<unknown>>("layers").push([layer]);
    layer.set("id", "lay_p");
    layer.set("type", "prg");
    layer.set("path", "g.prg");
    const meta = doc.getMap<unknown>("meta");
    meta.set("name", "Old");
    meta.set("entryPoints", ["$8011"]);
    if (withTarget) {
      const t = new Y.Map<unknown>();
      t.set("id", "tgt_a"); t.set("name", "runtime"); t.set("layers", ["lay_p"]); t.set("entryPoints", ["$0801"]);
      doc.getMap<Y.Map<unknown>>("targets").set("tgt_a", t);
    }
    return doc;
  };

  it("gives a document with no targets one holding the list", () => {
    const doc = legacy(false);
    expect(migrateDoc(doc)).toBe(true);
    const project = projectFromDoc(doc);
    expect(project.entryPoints).toBeUndefined();
    expect(project.targets).toEqual([
      { id: derivedId("tgt", "entryPoints", "Old"), name: "Old", layers: ["lay_p"], entryPoints: ["$8011"] },
    ]);
    expect(doc.getMap<unknown>("meta").has("entryPoints")).toBe(false);
    expect(migrateDoc(doc)).toBe(false);
  });

  it("drops the list where the document already declares targets", () => {
    const doc = legacy(true);
    expect(migrateDoc(doc)).toBe(true);
    const project = projectFromDoc(doc);
    expect(project.targets!.map((t) => t.entryPoints)).toEqual([["$0801"]]);
    expect(doc.getMap<unknown>("meta").has("entryPoints")).toBe(false);
  });
});
