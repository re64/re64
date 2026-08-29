import { describe, it, expect } from "vitest";
import { applyOp, applyOps, invertOp } from "./apply.js";
import { Op } from "./types.js";
import { parseProject } from "../project/project.js";

const PROJECT = `{
  "name": "Test",
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

/**
 * The property every op must have: applying it and then its inverse returns
 * the original text exactly — not an equivalent document, the same bytes. That
 * is what makes undo trustworthy rather than approximate, and it is also what
 * keeps project files diffable after an undone edit.
 */
const roundTrips = (op: Op, from = PROJECT) => {
  const inverse = invertOp(from, op);
  return applyOp(applyOp(from, op), inverse) === from;
};

describe("label operations", () => {
  const rename: Op = {
    op: "label.set",
    id: "lbl_2",
    layerId: "lay_a",
    address: 0x8100,
    name: "MainLoop",
  };

  it("renames by id", () => {
    const out = applyOp(PROJECT, rename);
    expect(out).toContain(`"name": "MainLoop"`);
    expect(out).not.toContain(`"name": "Loop"`);
  });

  it("round-trips a rename", () => {
    expect(roundTrips(rename)).toBe(true);
  });

  it("creates when the id is new, and undoing deletes it", () => {
    const create: Op = {
      op: "label.set",
      id: "lbl_new",
      layerId: "lay_a",
      address: 0x8200,
      name: "Extra",
    };

    expect(invertOp(PROJECT, create)).toEqual({
      op: "label.delete",
      id: "lbl_new",
      layerId: "lay_a",
    });
    expect(roundTrips(create)).toBe(true);
  });

  it("round-trips a delete, restoring type and position", () => {
    expect(roundTrips({ op: "label.delete", id: "lbl_1", layerId: "lay_a" })).toBe(true);
  });

  it("round-trips a type change", () => {
    expect(
      roundTrips({
        op: "label.set",
        id: "lbl_2",
        layerId: "lay_a",
        address: 0x8100,
        name: "Loop",
        type: "function",
      })
    ).toBe(true);
  });

  it("keeps the blank lines that group labels", () => {
    const blanks = (s: string) => s.split("\n").filter((l) => !l.trim()).length;
    expect(blanks(applyOp(PROJECT, rename))).toBe(blanks(PROJECT));
  });

  it("changes exactly one line for a rename", () => {
    const before = PROJECT.split("\n");
    const after = applyOp(PROJECT, rename).split("\n");
    expect(before.filter((l, i) => l !== after[i])).toHaveLength(1);
  });
});

describe("region operations", () => {
  const retype: Op = {
    op: "region.set",
    id: "rgn_1",
    layerId: "lay_a",
    start: 0x8080,
    end: 0x80a0,
    kind: "data",
    name: "copyright",
  };

  it("changes a kind in place", () => {
    expect(applyOp(PROJECT, retype)).toContain(`"kind": "data"`);
  });

  it("round-trips a retype", () => {
    expect(roundTrips(retype)).toBe(true);
  });

  it("round-trips an extend — the case an address key could not express", () => {
    // Growing a region must stay the same region, not a delete plus a create.
    expect(
      roundTrips({
        op: "region.set",
        id: "rgn_1",
        layerId: "lay_a",
        start: 0x8080,
        end: 0x8100,
        kind: "text",
        name: "copyright",
      })
    ).toBe(true);
  });

  it("round-trips a move", () => {
    expect(
      roundTrips({
        op: "region.set",
        id: "rgn_1",
        layerId: "lay_a",
        start: 0x8200,
        end: 0x8220,
        kind: "text",
        name: "copyright",
      })
    ).toBe(true);
  });

  it("round-trips a delete", () => {
    expect(roundTrips({ op: "region.delete", id: "rgn_1", layerId: "lay_a" })).toBe(true);
  });

  it("round-trips a create", () => {
    expect(
      roundTrips({
        op: "region.set",
        id: "rgn_new",
        layerId: "lay_a",
        start: 0x8300,
        end: 0x8310,
        kind: "data",
      })
    ).toBe(true);
  });
});

describe("primary label operations", () => {
  it("adds the block on first use and removes it when emptied", () => {
    const set: Op = { op: "primary.set", address: 0x8000, labelId: "lbl_1" };
    const out = applyOp(PROJECT, set);

    expect(parseProject(out).primaryLabels).toEqual({ $8000: "lbl_1" });
    expect(roundTrips(set)).toBe(true);
  });

  it("round-trips a change of promotion", () => {
    const withPrimary = applyOp(PROJECT, {
      op: "primary.set",
      address: 0x8000,
      labelId: "lbl_1",
    });

    expect(
      roundTrips({ op: "primary.set", address: 0x8000, labelId: "lbl_2" }, withPrimary)
    ).toBe(true);
  });

  it("round-trips a clear", () => {
    const withPrimary = applyOp(PROJECT, {
      op: "primary.set",
      address: 0x8000,
      labelId: "lbl_1",
    });

    expect(roundTrips({ op: "primary.clear", address: 0x8000 }, withPrimary)).toBe(true);
  });

  it("treats clearing an absent promotion as a no-op", () => {
    const clear: Op = { op: "primary.clear", address: 0x9999 };
    expect(applyOp(PROJECT, clear)).toBe(PROJECT);
    expect(roundTrips(clear)).toBe(true);
  });
});

describe("sequences", () => {
  it("applies in order", () => {
    const out = applyOps(PROJECT, [
      { op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8100, name: "A" },
      { op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8100, name: "B" },
    ]);
    expect(out).toContain(`"name": "B"`);
  });

  it("undoes a batch by reversing it", () => {
    // Each inverse is computed against the state that op saw, so they must be
    // collected as the batch is applied, not afterwards.
    const ops: Op[] = [
      { op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8100, name: "A" },
      { op: "region.delete", id: "rgn_1", layerId: "lay_a" },
      { op: "label.delete", id: "lbl_1", layerId: "lay_a" },
    ];

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
  it("names a layer that does not exist", () => {
    expect(() =>
      applyOp(PROJECT, {
        op: "label.set",
        id: "x",
        layerId: "lay_missing",
        address: 0,
        name: "n",
      })
    ).toThrow(/No layer with id lay_missing/);
  });
});
