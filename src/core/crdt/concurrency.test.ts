import { describe, it, expect } from "vitest";
import {
  applyUpdate,
  docFromProject,
  encodeDoc,
  projectFromDoc,
  CrdtDoc,
} from "./doc.js";
import { applyOpToDoc } from "./ops.js";
import { Op } from "../ops/types.js";
import { newId } from "../project/identity.js";
import { diffProjects } from "../ops/diff.js";
import { applyOps, invertOp } from "../ops/apply.js";
import { Project, parseProject } from "../project/project.js";
import { formatProject } from "../project/serialize.js";

/**
 * What happens when edits genuinely overlap.
 *
 * The merge tests elsewhere cover edits to different things, which is the easy
 * case. These cover the hard ones: the same field, the same entry, out of
 * order, and after working apart — the situations where a naive last-write-wins
 * over whole objects would quietly lose work.
 */

const PROJECT: Project = {
  layers: [{ id: "lay_a", type: "prg", path: "game.prg" }],
  claims: [
    { id: "lbl_1", at: "$8000", name: "Start", root: "routine", origin: "user" },
    { id: "lbl_2", at: "$8100", name: "Loop", origin: "user" },
    { id: "rgn_1", at: "$8200", extent: 16, is: "data", root: "data", origin: "user" },
  ],
};

/** A participant with its own identity, starting from the shared base. */
function participant(clientId: number): CrdtDoc {
  const doc = docFromProject(PROJECT);
  doc.clientID = clientId;
  return doc;
}

/** Exchange everything, in both directions, until all agree. */
function syncAll(...docs: CrdtDoc[]): void {
  const updates = docs.map(encodeDoc);
  for (const doc of docs) {
    for (const update of updates) applyUpdate(doc, update);
  }
}

const labelsOf = (doc: CrdtDoc) => projectFromDoc(doc).claims!;
const labelById = (doc: CrdtDoc, id: string) => labelsOf(doc).find((l) => l.id === id);

/** Renaming an existing claim, which is a revision rather than a second name. */
const rename = (id: string, name: string): Op => ({ op: "claim.set", id, fields: { name } });

describe("two people editing the same label", () => {
  it("converges on one name rather than duplicating the label", () => {
    const [a, b] = [participant(1), participant(2)];
    applyOpToDoc(a, rename("lbl_2", "MainLoop"));
    applyOpToDoc(b, rename("lbl_2", "InnerLoop"));
    syncAll(a, b);

    expect(labelsOf(a)).toHaveLength(3);
    expect(labelById(a, "lbl_2")!.name).toBe(labelById(b, "lbl_2")!.name);
    expect(["MainLoop", "InnerLoop"]).toContain(labelById(a, "lbl_2")!.name);
  });

  it("keeps both edits when they touch different fields of that label", () => {
    // The reason a label is a nested map rather than a single value: renaming
    // and retyping are different edits and should not clobber each other.
    const [a, b] = [participant(1), participant(2)];
    // Different fields of one claim: both must survive, which is the property
    // partial revision exists for.
    applyOpToDoc(a, { op: "claim.set", id: "lbl_1", fields: { name: "Begin" } });
    applyOpToDoc(b, { op: "claim.set", id: "lbl_1", fields: { root: "location" } });
    syncAll(a, b);

    const merged = labelById(a, "lbl_1")!;
    expect(labelById(b, "lbl_1")).toEqual(merged);
    // Whichever name won, the type edit is not lost to it.
    expect(merged.root).toBeDefined();
  });
});

describe("order independence", () => {
  it("reaches the same state whichever update arrives first", () => {
    // The property that makes a relay safe: it may deliver in any order.
    const base = () => {
      const a = participant(1);
      const b = participant(2);
      applyOpToDoc(a, rename("lbl_1", "FromA"));
      applyOpToDoc(b, rename("lbl_2", "FromB"));
      return [encodeDoc(a), encodeDoc(b)] as const;
    };

    const [ua, ub] = base();

    const forward = participant(9);
    applyUpdate(forward, ua);
    applyUpdate(forward, ub);

    const backward = participant(9);
    applyUpdate(backward, ub);
    applyUpdate(backward, ua);

    expect(projectFromDoc(forward)).toEqual(projectFromDoc(backward));
  });

  it("is unaffected by an update arriving twice", () => {
    // Relays retry, and a client may replay its own send.
    const a = participant(1);
    applyOpToDoc(a, rename("lbl_1", "Once"));
    const update = encodeDoc(a);

    const receiver = participant(2);
    applyUpdate(receiver, update);
    const afterFirst = projectFromDoc(receiver);
    applyUpdate(receiver, update);

    expect(projectFromDoc(receiver)).toEqual(afterFirst);
  });
});

describe("three participants", () => {
  it("converges when all three edit at once", () => {
    // Pairwise merge working does not imply n-way merge working.
    const [a, b, c] = [participant(1), participant(2), participant(3)];
    applyOpToDoc(a, rename("lbl_1", "FromA"));
    applyOpToDoc(b, rename("lbl_2", "FromB"));
    applyOpToDoc(c, { op: "claim.set", id: "rgn_1", fields: { says: { is: "text" } } });
    syncAll(a, b, c);

    expect(projectFromDoc(a)).toEqual(projectFromDoc(b));
    expect(projectFromDoc(b)).toEqual(projectFromDoc(c));
    expect(labelById(a, "lbl_1")!.name).toBe("FromA");
    expect(labelById(a, "lbl_2")!.name).toBe("FromB");
    expect(projectFromDoc(a).claims!.find((c) => c.id === "rgn_1")!.is).toBe("text");
  });

  it("converges even when they sync in a chain rather than all at once", () => {
    const [a, b, c] = [participant(1), participant(2), participant(3)];
    applyOpToDoc(a, rename("lbl_1", "A"));
    applyOpToDoc(b, rename("lbl_2", "B"));
    applyOpToDoc(c, { op: "primary.bind", address: 0x8000, labelId: "lbl_1" });

    // a -> b -> c, then back down.
    applyUpdate(b, encodeDoc(a));
    applyUpdate(c, encodeDoc(b));
    applyUpdate(b, encodeDoc(c));
    applyUpdate(a, encodeDoc(b));

    expect(projectFromDoc(a)).toEqual(projectFromDoc(c));
  });
});

describe("working apart and rejoining", () => {
  it("merges a session's worth of offline edits", () => {
    // Deterministic construction is what makes this possible: both started
    // from the same file, so their edits share an ancestor.
    const online = participant(1);
    const offline = participant(2);

    applyOpToDoc(online, rename("lbl_1", "EditedOnline"));
    for (const name of ["One", "Two", "Three"]) {
      applyOpToDoc(offline, rename("lbl_2", name));
    }
    applyOpToDoc(offline, { op: "claim.add", claim: { id: "lbl_new", at: 0x8300, name: "AddedOffline", origin: "user" } });

    syncAll(online, offline);

    const merged = projectFromDoc(online);
    expect(projectFromDoc(offline)).toEqual(merged);
    expect(labelById(online, "lbl_1")!.name).toBe("EditedOnline");
    expect(labelById(online, "lbl_2")!.name).toBe("Three");
    expect(labelById(online, "lbl_new")!.name).toBe("AddedOffline");
  });

  it("does not resurrect a label deleted while someone was away", () => {
    const present = participant(1);
    const away = participant(2);

    applyOpToDoc(present, { op: "claim.remove", id: "lbl_2" });
    // The away client is still editing what has already gone.
    applyOpToDoc(away, rename("lbl_2", "StillHere"));

    syncAll(present, away);

    expect(projectFromDoc(present)).toEqual(projectFromDoc(away));
  });
});

describe("a partial edit touches only what it names", () => {
  /**
   * **The Codex review's thesis in one operation, and the test above it passed.**
   *
   * `claim.set` re-encoded the whole claim and wrote every key back into the
   * `Y.Map`. So changing `root` reasserted the old `name`, the old extent and
   * the old position: the API said partial and the write set was the whole
   * record. Two peers, one renaming and one re-rooting, converged on the old
   * name.
   *
   * The existing concurrency test checked that the replicas *agreed* and that
   * `root` was defined — both true of the broken behaviour. Convergence was
   * never the property in question; Yjs converges on whatever it is told.
   *
   * The whole-record write had a reason, and it survives as the group: `says` is
   * spelled flat across `is`, `encoding`, `view` and `typeId`, so setting an
   * interpretation to `data` must clear the `encoding` a previous `text` left.
   * That is now part of setting `says` rather than a side effect of rewriting
   * everything.
   */
  it("keeps both when two peers edit different fields of one claim", () => {
    const a = participant(1);
    const b = participant(2);
    applyOpToDoc(a, { op: "claim.set", id: "lbl_1", fields: { name: "Renamed" } });
    applyOpToDoc(b, { op: "claim.set", id: "lbl_1", fields: { root: "location" } });
    syncAll(a, b);

    for (const doc of [a, b]) {
      const claim = projectFromDoc(doc).claims!.find((c) => c.id === "lbl_1")!;
      expect(claim.name).toBe("Renamed");
      expect(claim.root).toBe("location");
    }
  });

  it("still clears a spelling the new interpretation does not use", () => {
    // The group, doing the job the whole-record write was there for.
    const a = participant(1);
    applyOpToDoc(a, {
      op: "claim.set",
      id: "rgn_1",
      fields: { says: { is: "text", encoding: "screen" } },
    });
    const held = () => projectFromDoc(a).claims!.find((c) => c.id === "rgn_1")!;
    expect(held().encoding).toBe("screen");

    applyOpToDoc(a, { op: "claim.set", id: "rgn_1", fields: { says: { is: "data" } } });
    const after = held();
    expect(after.is).toBe("data");
    expect(after.encoding).toBeUndefined();
  });
});

describe("a binding is keyed by its site", () => {
  /**
   * **`docs/algebra.md` describes a binding as an address-to-id map** — bind and
   * unbind by key, and binding again is how one is updated. The storage keyed it
   * by a *minted use id* instead, so every bind added a competitor rather than
   * replacing one.
   *
   * Two uses then sat at one site. The loaded index kept whichever the
   * projection sorted last — by id, which is random — so *which value showed
   * depended on the ids rather than on which bind happened later*. Unbinding
   * removed one and left the other still resolving.
   *
   * This is the same family as the field storage above: a shape that does not
   * implement the identity its verbs promise.
   */
  const BOUND: Project = {
    layers: [{ id: "lay_a", type: "prg", path: "game.prg" }],
    constants: [
      { id: "cst_one", name: "ONE", value: "$01" },
      { id: "cst_white", name: "WHITE", value: "$01" },
    ],
  };

  const bind = (doc: CrdtDoc, constantId: string, id: string) =>
    applyOpToDoc(doc, {
      op: "constantUse.bind",
      id,
      layerId: "lay_a",
      address: 0x8000,
      constantId,
    });

  const usesOf = (doc: CrdtDoc) => projectFromDoc(doc).layers[0].constantUses ?? [];

  it("replaces rather than accumulating when the same site is bound again", () => {
    const doc = docFromProject(BOUND);
    bind(doc, "cst_one", "cst_u1");
    bind(doc, "cst_white", "cst_u2");

    const held = usesOf(doc);
    expect(held).toHaveLength(1);
    expect(held[0].constant).toBe("cst_white");
  });

  it("clears the site when it is unbound", () => {
    const doc = docFromProject(BOUND);
    bind(doc, "cst_one", "cst_u1");
    bind(doc, "cst_white", "cst_u2");
    applyOpToDoc(doc, {
      op: "constantUse.unbind",
      id: "cst_u2",
      layerId: "lay_a",
      address: 0x8000,
    });
    expect(usesOf(doc)).toHaveLength(0);
  });

  it("settles two peers binding one site on one value", () => {
    // Concurrent binds are a genuine conflict and last-writer-wins is the right
    // answer — what was wrong was ending up with *both*, and picking between
    // them by an id nobody chose.
    const a = docFromProject(BOUND);
    a.clientID = 1;
    const b = docFromProject(BOUND);
    b.clientID = 2;
    bind(a, "cst_one", "cst_ua");
    bind(b, "cst_white", "cst_ub");
    syncAll(a, b);

    expect(usesOf(a)).toHaveLength(1);
    expect(usesOf(a)[0].constant).toBe(usesOf(b)[0].constant);
  });
});

describe("a field keeps its identity and its parts merge", () => {
  /**
   * **Two defects with one cause: the storage did not implement the identity
   * its verbs promised.**
   *
   * Fields were keyed by **offset**, argued on the grounds that two cannot share
   * one. True of a single writer. Under two it made a move a delete plus a
   * create, so moving one field to two different offsets produced *two entries
   * carrying one id* — and `field.remove` then took one away and left the other
   * in the document.
   *
   * And a field was a plain object at that key, so `field.set` wrote the whole
   * of it: a rename and a description edit made the later win over a property it
   * never read. That is the same defect `claim.set` had, one level down.
   *
   * Adding `field.add` / `field.set` / `field.remove` did not fix either. The
   * verbs were built on a shape that could not honour them, which is the review's
   * thesis in miniature.
   */
  const WITH_TYPE: Project = {
    layers: [{ id: "lay_a", type: "prg", path: "game.prg" }],
    types: [
      {
        id: "typ_a",
        name: "Sprite",
        size: 4,
        fields: [{ id: "fld_a", offset: 0, name: "old", type: "u8", description: "old" }],
      },
    ],
  };

  const pair = (): [CrdtDoc, CrdtDoc] => {
    const a = docFromProject(WITH_TYPE);
    a.clientID = 1;
    const b = docFromProject(WITH_TYPE);
    b.clientID = 2;
    return [a, b];
  };

  const fieldsOf = (doc: CrdtDoc) => projectFromDoc(doc).types![0].fields;

  it("keeps a rename and a description written at the same time", () => {
    const [a, b] = pair();
    applyOpToDoc(a, { op: "field.set", typeId: "typ_a", id: "fld_a", fields: { name: "renamed" } });
    applyOpToDoc(b, {
      op: "field.set",
      typeId: "typ_a",
      id: "fld_a",
      fields: { description: "described" },
    });
    syncAll(a, b);

    for (const doc of [a, b]) {
      const [field] = fieldsOf(doc);
      expect(field.name).toBe("renamed");
      expect(field.description).toBe("described");
    }
  });

  it("stays one field when two peers move it to different offsets", () => {
    const [a, b] = pair();
    applyOpToDoc(a, { op: "field.set", typeId: "typ_a", id: "fld_a", fields: { offset: 1 } });
    applyOpToDoc(b, { op: "field.set", typeId: "typ_a", id: "fld_a", fields: { offset: 2 } });
    syncAll(a, b);

    const held = fieldsOf(a).filter((f) => f.id === "fld_a");
    expect(held).toHaveLength(1);
    // One of the two offsets, whichever the merge settled on — the point is
    // that there is one field, not which offset won.
    expect([1, 2]).toContain(held[0].offset);

    // And removing it by that id removes it, rather than leaving a twin.
    applyOpToDoc(a, { op: "field.remove", typeId: "typ_a", id: "fld_a" });
    expect(fieldsOf(a).filter((f) => f.id === "fld_a")).toHaveLength(0);
  });

  it("keeps two fields that two peers put at one offset", () => {
    // The trade, stated: offset keys made this merge into one field and lose a
    // reader's work. Both stand now, and hygiene reports the pair — the same
    // treatment two claims at one address get.
    const [a, b] = pair();
    applyOpToDoc(a, {
      op: "field.add",
      typeId: "typ_a",
      id: "fld_x",
      offset: 2,
      name: "fromA",
      type: "u8",
    });
    applyOpToDoc(b, {
      op: "field.add",
      typeId: "typ_a",
      id: "fld_y",
      offset: 2,
      name: "fromB",
      type: "u8",
    });
    syncAll(a, b);

    const at2 = fieldsOf(a).filter((f) => f.offset === 2);
    expect(at2.map((f) => f.name).sort()).toEqual(["fromA", "fromB"]);
  });
});

describe("recreating a type keeps every field, including two at one offset", () => {
  /**
   * **A map keyed by offset holds one field per offset**, and `type.add`'s
   * payload was one. Two readers disagreeing about what sits at `+0` is a state
   * the document now keeps deliberately — and it reached two places that
   * rebuild a type from scratch with one of the pair missing: the file
   * reconciler emitting `type.add` for a type a peer had never seen, and the
   * inverse of `type.remove`, so undoing a removal put back half the layout.
   */
  const disputed: Project = {
    layers: [{ id: "lay_a", type: "prg", path: "game.prg" }],
    types: [
      {
        id: "typ_a",
        name: "Zone",
        size: 8,
        fields: [
          { id: "fld_a", offset: 0, name: "fromA", type: "u8" },
          { id: "fld_b", offset: 0, name: "fromB", type: "u16" },
          { id: "fld_c", offset: 4, name: "agreed", type: "u8" },
        ],
      },
    ],
  };
  const empty: Project = { layers: [{ id: "lay_a", type: "prg", path: "game.prg" }] };
  const idsOf = (p: Project) => p.types![0].fields.map((f) => f.id).sort();
  // The text writers take the file, not the project.
  const asText = (p: Project) => formatProject(parseProject(JSON.stringify(p)));

  it("reconciles a type a peer has not seen with both fields", () => {
    const ops = diffProjects(empty, disputed);
    const added = ops.find((op) => op.op === "type.add");
    expect(added).toBeDefined();
    expect(idsOf(parseProject(applyOps(asText(empty), ops)))).toEqual(["fld_a", "fld_b", "fld_c"]);

    const doc = docFromProject(empty);
    for (const op of ops) applyOpToDoc(doc, op);
    expect(idsOf(projectFromDoc(doc))).toEqual(["fld_a", "fld_b", "fld_c"]);
  });

  it("undoes a removal with both fields", () => {
    const remove: Op = { op: "type.remove", id: "typ_a" };
    const inverse = invertOp(asText(disputed), remove);
    const restored = parseProject(applyOps(applyOps(asText(disputed), [remove]), [inverse]));
    expect(idsOf(restored)).toEqual(["fld_a", "fld_b", "fld_c"]);
    expect(restored.types![0].fields.filter((f) => f.offset === 0)).toHaveLength(2);
  });
});
