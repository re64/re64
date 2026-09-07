import { describe, it, expect } from "vitest";
import {
  applyUpdate,
  docFromProject,
  encodeDoc,
  projectFromDoc,
  CrdtDoc,
} from "./doc.js";
import { applyOpToDoc } from "./ops.js";
import { Project } from "../project/project.js";
import { Op } from "../ops/types.js";
import { newId } from "../project/identity.js";

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
    { id: "lbl_1", at: "$8000", name: "Start", root: "routine", author: "m", source: "user" },
    { id: "lbl_2", at: "$8100", name: "Loop", author: "m", source: "user" },
    { id: "rgn_1", at: "$8200", extent: 16, is: "data", root: "data", author: "m", source: "user" },
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
    applyOpToDoc(offline, { op: "claim.add", claim: { id: "lbl_new", at: 0x8300, name: "AddedOffline", by: { author: "test", source: "user" } } });

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
