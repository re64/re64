import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { writeClaims, readClaims } from "./claims.js";
import { applyOpToDoc } from "./ops.js";
import { Claim, compareClaims } from "../claims/model.js";
import { ClaimSet, disagreements } from "../claims/set.js";

/**
 * Two peers, disconnected, then merged.
 *
 * The offline/online rule as an actual CRDT exercise rather than an argument
 * about one. Each test does the same thing: build a shared base, split, edit both
 * copies with no communication, exchange updates in *both* directions, and check
 * the two peers agree and that nobody's work vanished.
 *
 * **Through `applyOpToDoc`, which is the path the server takes.** These ran
 * against a prototype `applyClaimOp` for as long as R2 was live, and passed —
 * the prototype had its own per-key semantics and the defect was in the live
 * handler these never reached. A merge test that does not exercise the merging
 * code is the R2 concurrency test all over again.
 */

const claim = (over: Partial<Claim> & Pick<Claim, "id" | "at">): Claim => ({
  origin: "user",
  ...over,
});

/** A document, and a second one that has seen exactly the same updates. */
function split(base: readonly Claim[]): [Y.Doc, Y.Doc] {
  const a = new Y.Doc({ gc: false });
  writeClaims(a, base);
  const b = new Y.Doc({ gc: false });
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  return [a, b];
}

/** Exchange in both directions, which is what a real reconnect does. */
function reconcile(a: Y.Doc, b: Y.Doc): void {
  const fromA = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const fromB = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(b, fromA);
  Y.applyUpdate(a, fromB);
}

const sorted = (doc: Y.Doc) => readClaims(doc).sort(compareClaims);

describe("two peers on one claims root", () => {
  it("both survive when each declares the same span offline", () => {
    const [a, b] = split([]);

    applyOpToDoc(a, {
      op: "claim.add",
      claim: claim({
        id: "clm_a", at: 0x1800, extent: 0x800, name: "spriteBank",
        says: { is: "bitmap", view: "sprite" },
        origin: "user",
      }),
    }, "gfx");
    applyOpToDoc(b, {
      op: "claim.add",
      claim: claim({
        id: "clm_b", at: 0x1800, extent: 0x800, name: "levelData",
        says: { is: "data" },
        origin: "user",
      }),
    }, "lead");

    reconcile(a, b);

    expect(sorted(a)).toEqual(sorted(b));
    expect(sorted(a)).toHaveLength(2);
    // And the contradiction is reportable rather than resolved.
    const conflict = disagreements(new ClaimSet(sorted(a))).find(
      (d) => d.kind === "interpretation"
    );
    expect(conflict).toBeDefined();
  });

  it("two peers revising different fields of one claim both land", () => {
    const [a, b] = split([
      claim({ id: "clm_1", at: 0x8e00, extent: 0x200, name: "charSet", says: { is: "data" } }),
    ]);

    applyOpToDoc(a, { op: "claim.set", id: "clm_1", fields: { name: "characterSet" } }, "gfx");
    applyOpToDoc(b, {
      op: "claim.set", id: "clm_1", fields: { says: { is: "bitmap", view: "char:8" } },
    }, "lead");

    reconcile(a, b);

    expect(sorted(a)).toEqual(sorted(b));
    const [only] = sorted(a);
    // Neither edit was a whole-object replace, so neither reverted the other.
    expect(only.name).toBe("characterSet");
    expect(only.says).toEqual({ is: "bitmap", view: "char:8" });
  });

  it("two peers revising the same field converge on one answer", () => {
    const [a, b] = split([claim({ id: "clm_1", at: 0x8e00, name: "charSet" })]);

    applyOpToDoc(a, { op: "claim.set", id: "clm_1", fields: { name: "characterSet" } }, "gfx");
    applyOpToDoc(b, { op: "claim.set", id: "clm_1", fields: { name: "glyphs" } }, "lead");
    reconcile(a, b);

    // Last writer wins per field, which is all a CRDT offers. What matters is
    // that both peers reach the *same* answer, and that it is one of the two.
    expect(sorted(a)).toEqual(sorted(b));
    expect(["characterSet", "glyphs"]).toContain(sorted(a)[0].name);
  });

  it("a delete racing a revision does not resurrect a half-built claim", () => {
    const [a, b] = split([
      claim({ id: "clm_1", at: 0x8e00, extent: 0x200, name: "charSet", says: { is: "data" } }),
    ]);

    applyOpToDoc(a, { op: "claim.remove", id: "clm_1" }, "gfx");
    applyOpToDoc(b, { op: "claim.set", id: "clm_1", fields: { name: "characterSet" } }, "lead");
    reconcile(a, b);

    expect(sorted(a)).toEqual(sorted(b));
    // Yjs resolves a concurrent delete and set on one key deterministically; the
    // point is that both peers agree, and that whatever survives is a whole claim
    // rather than one field of a deleted one.
    const survivors = sorted(a);
    if (survivors.length === 1) {
      expect(survivors[0].at).toBe(0x8e00);
      expect(survivors[0].says).toEqual({ is: "data" });
    }
  });

  it("undo takes back one peer's work and leaves the other's", () => {
    const [a, b] = split([]);
    // Scoped to an origin, which is how this project scopes undo to a session
    // rather than to a person: two tabs are two peers who may not undo each other.
    const undo = new Y.UndoManager(a.getMap("claims"), {
      trackedOrigins: new Set(["gfx"]),
      captureTimeout: 0,
    });

    applyOpToDoc(a, {
      op: "claim.add",
      claim: claim({ id: "clm_gfx", at: 0x1800, name: "spriteBank", origin: "user" }),
    }, "gfx");
    applyOpToDoc(b, {
      op: "claim.add",
      claim: claim({ id: "clm_lead", at: 0x2000, name: "levelData", origin: "user" }),
    }, "lead");
    reconcile(a, b);
    expect(sorted(a)).toHaveLength(2);

    undo.undo();
    reconcile(a, b);

    expect(sorted(a)).toEqual(sorted(b));
    expect(sorted(a).map((c) => c.id)).toEqual(["clm_lead"]);
  });

  it("survives a round trip through the document unchanged", () => {
    const original: Claim[] = [
      claim({
        id: "clm_1", at: 0x8e00, extent: 0x200, name: "characterSet",
        says: { is: "bitmap", view: "char:8" },
        description: "the game's own glyphs",
        origin: "user",
      }),
      claim({
        id: "clm_2", at: 0x10, frame: { space: "layer", layer: "decruncher" },
        name: "fetchBit", root: "routine",
        origin: "user",
      }),
      claim({ id: "clm_3", at: 0x5000, extent: 0x40, says: { is: "text", encoding: "petscii" } }),
    ];
    const doc = new Y.Doc({ gc: false });
    writeClaims(doc, original);
    expect(readClaims(doc).sort(compareClaims)).toEqual([...original].sort(compareClaims));
  });
});
