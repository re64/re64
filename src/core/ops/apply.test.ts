import { describe, it, expect } from "vitest";
import { applyOp, applyOps, invertOp } from "./apply.js";
import { Op } from "./types.js";
import { parseProject } from "../project/project.js";
import { formatProject } from "../project/serialize.js";
import { derivedId } from "../project/identity.js";

const RAW = `{
  "name": "Test",
  "layers": [{ "id": "lay_a", "type": "prg", "path": "game.prg" }],
  "claims": [
    { "id": "clm_1", "at": "$8000", "name": "Start", "root": "routine", "origin": "user" },
    { "id": "clm_2", "at": "$8080", "extent": 32, "name": "copyright", "is": "text", "origin": "user" }
  ]
}
`;

/**
 * Canonical form, because every writer now reserialises.
 *
 * The round trip below is byte-identical *in the form `formatProject` produces*,
 * which is the form the export is in. It used to be identical to a hand-authored
 * file as well, because the line editors preserved layout — a property dropped
 * deliberately once the export became a full dump regenerated from the document.
 */
const PROJECT = formatProject(parseProject(RAW));

/**
 * The property every op must have: applying it and then its inverse returns the
 * original text exactly — not an equivalent document, the same bytes.
 *
 * That is what makes undo trustworthy rather than approximate. `runOps` computes
 * and stores an inverse on every write, so an op whose inverse is merely close
 * makes undo lie.
 */
const roundTrips = (op: Op, from = PROJECT) => {
  const inverse = invertOp(from, op);
  return applyOp(applyOp(from, op), inverse) === from;
};

const by = { origin: "user" as const };

describe("claim operations", () => {
  it("adds one, and undoing removes it", () => {
    const op: Op = {
      op: "claim.add",
      claim: { id: "clm_3", at: 0x8200, name: "Added", ...by },
    };
    expect(parseProject(applyOp(PROJECT, op)).claims).toHaveLength(3);
    expect(roundTrips(op)).toBe(true);
  });

  it("revises named fields and leaves the rest alone", () => {
    const op: Op = { op: "claim.set", id: "clm_1", fields: { name: "Begin" } };
    const after = parseProject(applyOp(PROJECT, op)).claims!.find((c) => c.id === "clm_1")!;
    expect(after.name).toBe("Begin");
    // Untouched, because the edit did not name it.
    expect(after.root).toBe("routine");
    expect(roundTrips(op)).toBe(true);
  });

  it("clears a field with null, which an omitted key cannot express", () => {
    // The case that makes `ClaimEdit` necessary: without it, the inverse of
    // setting a root on a claim that had none is unwritable.
    const op: Op = { op: "claim.set", id: "clm_1", fields: { root: null } };
    const after = parseProject(applyOp(PROJECT, op)).claims!.find((c) => c.id === "clm_1")!;
    expect(after.root).toBeUndefined();
    expect(roundTrips(op)).toBe(true);
  });

  it("round-trips an interpretation change", () => {
    expect(roundTrips({ op: "claim.set", id: "clm_2", fields: { says: { is: "data" } } })).toBe(true);
  });

  it("round-trips an extent change — what an address key could not express", () => {
    expect(roundTrips({ op: "claim.set", id: "clm_2", fields: { extent: 64 } })).toBe(true);
  });

  it("removes one, and undoing puts it back whole", () => {
    const op: Op = { op: "claim.remove", id: "clm_2" };
    expect(parseProject(applyOp(PROJECT, op)).claims).toHaveLength(1);
    expect(roundTrips(op)).toBe(true);
  });

  it("revising a claim that is gone does nothing, rather than resurrecting half of one", () => {
    const removed = applyOp(PROJECT, { op: "claim.remove", id: "clm_2" });
    const after = applyOp(removed, { op: "claim.set", id: "clm_2", fields: { name: "Ghost" } });
    expect(after).toBe(removed);
  });
});

describe("primary label operations", () => {
  it("adds the block on first use and removes it when emptied", () => {
    const set = applyOp(PROJECT, { op: "primary.bind", address: 0x8000, labelId: "clm_1" });
    expect(set).toContain('"primaryLabels"');
    const cleared = applyOp(set, { op: "primary.unbind", address: 0x8000 });
    expect(cleared).not.toContain('"primaryLabels"');
    expect(roundTrips({ op: "primary.bind", address: 0x8000, labelId: "clm_1" })).toBe(true);
  });
});

describe("meta operations", () => {
  it("round-trips a description", () => {
    expect(roundTrips({ op: "meta.set", key: "description", value: "a test" })).toBe(true);
  });
});

describe("sequences", () => {
  it("undoes a batch by reversing it", () => {
    const ops: Op[] = [
      { op: "claim.add", claim: { id: "clm_3", at: 0x8200, name: "One", ...by } },
      { op: "claim.set", id: "clm_1", fields: { name: "Two" } },
      { op: "claim.remove", id: "clm_2" },
    ];

    // Inverses computed as the batch runs: each must see the state its own
    // operation saw, so computing them up front inverts against the wrong text.
    let text = PROJECT;
    const inverses: Op[] = [];
    for (const op of ops) {
      inverses.unshift(invertOp(text, op));
      text = applyOp(text, op);
    }
    expect(applyOps(text, inverses)).toBe(PROJECT);
  });
});

describe("errors", () => {
  it("names a claim that does not exist rather than writing one", () => {
    const out = applyOp(PROJECT, { op: "claim.set", id: "clm_nope", fields: { name: "X" } });
    expect(out).toBe(PROJECT);
  });

  it("keeps the file parseable after every operation", () => {
    const ops: Op[] = [
      { op: "claim.add", claim: { id: "clm_3", at: 0x9000, extent: 8, says: { is: "data" }, ...by } },
      { op: "claim.set", id: "clm_3", fields: { name: "table" } },
      { op: "primary.bind", address: 0x8000, labelId: "clm_1" },
    ];
    const out = applyOps(PROJECT, ops);
    expect(() => parseProject(out)).not.toThrow();
    expect(formatProject(parseProject(out))).toBe(out);
  });
});

describe("a binding's inverse restores what was at the site", () => {
  /**
   * **A bind mints a fresh use id, so on a rebind that id cannot exist in the
   * state the inverse is computed against.** Looking the pre-state up by it
   * found nothing, the inverse became `unbind`, and undoing a rebind cleared the
   * site instead of putting back the constant that was there.
   *
   * The keying fix is what makes the answer available: a site holds one binding,
   * so "what was here" is a question with one answer, and the inverse asks it by
   * layer and address rather than by an id nobody had yet.
   */
  const withConstants = formatProject(
    parseProject(`{
  "name": "Test",
  "layers": [{ "id": "lay_a", "type": "prg", "path": "game.prg" }],
  "constants": [
    { "id": "cst_a", "name": "ONE", "value": "$01" },
    { "id": "cst_b", "name": "WHITE", "value": "$01" }
  ],
  "claims": [
    { "id": "clm_1", "at": "$8000", "name": "Start", "root": "routine", "origin": "user" }
  ]
}
`)
  );

  it("puts back the constant a rebind replaced", () => {
    const first: Op = {
      op: "constantUse.bind",
      id: "cst_use1",
      frame: { space: "address" },
      at: 0x8000,
      constantId: "cst_a",
    };
    const again: Op = {
      op: "constantUse.bind",
      id: "cst_use2",
      frame: { space: "address" },
      at: 0x8000,
      constantId: "cst_b",
    };

    const bound = applyOp(withConstants, first);
    const inverse = invertOp(bound, again);
    const rebound = applyOp(bound, again);
    expect(parseProject(rebound).constantUses).toHaveLength(1);

    // Undoing it is `ONE` again, not an empty site.
    const undone = parseProject(applyOp(rebound, inverse));
    expect(undone.constantUses).toHaveLength(1);
    expect(undone.constantUses![0].constant).toBe("cst_a");
  });

  it("puts back the label a rebind replaced", () => {
    const first: Op = {
      op: "labelUse.bind",
      id: "lbl_use1",
      frame: { space: "address" },
      at: 0x8010,
      labelId: "clm_1",
    };
    const again: Op = {
      op: "labelUse.bind",
      id: "lbl_use2",
      frame: { space: "address" },
      at: 0x8010,
      labelId: "clm_2",
    };

    const bound = applyOp(withConstants, first);
    const inverse = invertOp(bound, again);
    const undone = parseProject(applyOp(applyOp(bound, again), inverse));
    expect(undone.labelUses).toHaveLength(1);
    expect(undone.labelUses![0].label).toBe("clm_1");
  });

  it("clears a site that had nothing on it, as before", () => {
    const fresh: Op = {
      op: "constantUse.bind",
      id: "cst_use1",
      frame: { space: "address" },
      at: 0x8020,
      constantId: "cst_a",
    };
    expect(roundTrips(fresh, withConstants)).toBe(true);
  });
});

describe("the text writers key a binding by its site under either spelling", () => {
  /**
   * A use may spell its address `32768` or `"$8000"` — both are legal in a file
   * — and the text writers compared the spellings. So an existing use at the
   * number and a bind at the hex were two sites to them, and one to the
   * document: the two adapters disagreed again, one level down from where they
   * had just been made to agree.
   */
  const withNumericUse = formatProject(
    parseProject(`{
  "name": "Test",
  "layers": [{
    "id": "lay_a", "type": "prg", "path": "game.prg",
    "constantUses": [
      { "id": "cst_old", "address": 32768, "constant": "cst_a" },
      { "id": "cst_dup", "address": "$8000", "constant": "cst_b" }
    ]
  }],
  "constants": [
    { "id": "cst_a", "name": "ONE", "value": "$01" },
    { "id": "cst_b", "name": "WHITE", "value": "$01" }
  ]
}
`)
  );
  // Nested, so the operations that reach them are the nested spelling: a
  // layer and an absolute address. See `bindSite`.
  const usesIn = (text: string) =>
    (parseProject(text).layers[0].constantUses ?? []).map((u) => `${u.id}:${u.constant}`);

  it("replaces every use at the site, however each spelled it", () => {
    const bound = applyOp(withNumericUse, {
      op: "constantUse.bind",
      id: "cst_new",
      layerId: "lay_a",
      address: 0x8000,
      constantId: "cst_b",
    });
    expect(usesIn(bound)).toEqual(["cst_new:cst_b"]);
  });

  it("clears the site by number, and by id when the operation predates sites", () => {
    const cleared = applyOp(withNumericUse, {
      op: "constantUse.unbind",
      id: "cst_whatever",
      layerId: "lay_a",
      address: 0x8000,
    });
    expect(usesIn(cleared)).toEqual([]);

    const byId = applyOp(withNumericUse, {
      op: "constantUse.unbind",
      id: "cst_old",
      layerId: "lay_a",
    });
    expect(usesIn(byId)).toEqual(["cst_dup:cst_b"]);
  });
});

describe("an old type.set child patch, read from history", () => {
  /**
   * `type.set` no longer carries children, and history still does. Each entry
   * means what it meant: by the id it carries, else the field at its offset;
   * `null` removes what sits there; an entry with no id declares a field.
   */
  const withType = formatProject(
    parseProject(`{
  "name": "Test",
  "layers": [{ "id": "lay_a", "type": "prg", "path": "game.prg" }],
  "types": [{ "id": "typ_a", "name": "Sprite", "size": 8, "fields": {
    "0": { "id": "fld_a", "name": "x", "type": "u8" },
    "4": { "id": "fld_b", "name": "y", "type": "u8" }
  } }]
}
`)
  );
  const legacySet = (children: Record<string, unknown>): Op =>
    ({ op: "type.set", id: "typ_a", fields: { fields: children } }) as unknown as Op;
  const fieldsOf = (text: string) =>
    parseProject(text).types![0].fields.map((f) => `${f.id}@${f.offset}:${f.name}`);

  it("revises by id, removes by offset, declares without an id", () => {
    const out = applyOp(
      withType,
      legacySet({ 0: { id: "fld_a", name: "renamed", type: "u8" }, 4: null, 6: { name: "z", type: "u8" } })
    );
    expect(fieldsOf(out)).toEqual(["fld_a@0:renamed", `${derivedId("fld", "typ_a", 6)}@6:z`]);
  });

  it("replaces the field, so an omitted description is a cleared one", () => {
    const described = applyOp(withType, {
      op: "field.set",
      id: "fld_a",
      typeId: "typ_a",
      fields: { description: "says something" },
    });
    const out = applyOp(described, legacySet({ 0: { id: "fld_a", name: "x", type: "u8" } }));
    expect(parseProject(out).types![0].fields[0].description).toBeUndefined();
  });

  it("finds a moved field by its id rather than by the offset it left", () => {
    const moved = applyOp(withType, { op: "field.set", id: "fld_a", typeId: "typ_a", fields: { offset: 2 } });
    const out = applyOp(moved, legacySet({ 0: { id: "fld_a", name: "renamed", type: "u8" } }));
    expect(fieldsOf(out)).toEqual(["fld_a@0:renamed", "fld_b@4:y"]);
  });
});
