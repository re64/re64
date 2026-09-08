import { describe, it, expect } from "vitest";
import { applyOp, applyOps, invertOp } from "./apply.js";
import { Op } from "./types.js";
import { parseProject } from "../project/project.js";
import { formatProject } from "../project/serialize.js";

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
