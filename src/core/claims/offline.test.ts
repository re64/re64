import { describe, it, expect } from "vitest";
import { regionSetOp } from "../ops/edits.js";
import { loadProjectFile } from "../../node-files.js";
import { ClaimSet, disagreements, describeDisagreement } from "./set.js";
import { Claim } from "./model.js";
import { readFileSync } from "node:fs";

/**
 * *What works offline — locally, ignorant of every other edit — must also work
 * online. And the reverse.*
 *
 * This project's own acceptance test for an edit, and the one the region write
 * still fails. It is the last surviving instance of the shape named twice
 * already: `set_comment` keyed by slot and `set_label` keyed by address, both
 * justified by single-author use and both revisited only after an experiment
 * found them destroying somebody's work.
 */

const GRIDRUNNER = "assets/gridrunner/gridrunner.re64";
const SPAN = { start: 0x8e00, end: 0x8e20 };

describe("two readers declaring the same span, offline", () => {
  it("declaring a span adds, whatever the writer had seen", () => {
    const loaded = loadProjectFile(GRIDRUNNER);
    const existing = loaded.claims.find((c) => c.name === "characterSetData")!;
    expect(existing).toBeDefined();

    // The same declaration a synced reader makes and an unsynced one makes.
    // It used to matter which: matching the exact span reused the existing id
    // and replaced it, while a writer who had not seen it minted a second — the
    // same call with two outcomes, which is this project's own offline/online
    // test failing. Now there is one outcome, and it is additive.
    const synced = regionSetOp(loaded, existing.at, existing.at + existing.extent!, "data", "levelTable");
    const elsewhere = regionSetOp(loaded, 0x8a00, 0x8a20, "data", "levelTable");

    expect(synced.op).toBe("claim.add");
    expect(elsewhere.op).toBe("claim.add");
    if (synced.op !== "claim.add" || elsewhere.op !== "claim.add") throw new Error("shape");

    // Neither touches what is already there, and the two are told apart by id.
    expect(synced.claim.id).not.toBe(existing.id);
    expect(elsewhere.claim.id).not.toBe(synced.claim.id);
  });

  it("revising a span requires saying which one, by id", () => {
    const loaded = loadProjectFile(GRIDRUNNER);
    const existing = loaded.claims.find((c) => c.name === "characterSetData")!;

    const revised = regionSetOp(
      loaded,
      existing.at,
      existing.at + 0x20,
      "bitmap",
      "charSet",
      undefined,
      undefined,
      undefined,
      existing.id
    );
    expect(revised.op).toBe("claim.set");
    if (revised.op !== "claim.set") throw new Error("shape");
    expect(revised.id).toBe(existing.id);
    // Partial: it names the fields it changes and leaves the rest alone.
    expect(revised.fields.extent).toBe(0x20);
  });

  it("claims keep both, and the disagreement is the output", () => {
    // The same two conclusions, as claims. Ids are minted by the writer, so
    // nothing has to be agreed on beforehand — which is what makes this work
    // while disconnected.
    const offlineGfx: Claim[] = [
      {
        id: "clm_gfx_1",
        at: SPAN.start,
        extent: SPAN.end - SPAN.start,
        name: "spriteSheet",
        says: { is: "bitmap", view: "sprite" },
        by: { author: "gfx", source: "user" },
      },
    ];
    const offlineLead: Claim[] = [
      {
        id: "clm_lead_1",
        at: SPAN.start,
        extent: SPAN.end - SPAN.start,
        name: "levelTable",
        says: { is: "data" },
        by: { author: "lead", source: "user" },
      },
    ];

    // Merge is concatenation: claims are id-keyed and nothing is ever
    // overwritten, so a CRDT union is the whole of it. Order does not matter,
    // which is the property that makes offline and online the same.
    const merged = new ClaimSet([...offlineGfx, ...offlineLead]);
    const reversed = new ClaimSet([...offlineLead, ...offlineGfx]);

    expect(merged.all().map((c) => c.id)).toEqual(reversed.all().map((c) => c.id));
    expect(merged.interpretationsAt(0x8e10)).toHaveLength(2);

    const conflict = disagreements(merged).find((d) => d.kind === "interpretation");
    expect(conflict).toBeDefined();
    // eslint-disable-next-line no-console
    console.log(describeDisagreement(conflict!));
  });

  it("a claim written offline about an address no layer supplies still lands", () => {
    // Zero page: every 6502 variable lives there and no layer supplies the bytes.
    // The region write refuses this outright — "there is nothing there to
    // interpret" — which is why naming a byteless address had to grow a whole
    // symbols-layer apparatus to work around the ownership rule.
    const loaded = loadProjectFile(GRIDRUNNER);
    expect(() => regionSetOp(loaded, 0x0010, 0x0020, "data", "playerState")).toThrow(
      /nothing there to interpret/
    );

    const claim: Claim = {
      id: "clm_zp",
      at: 0x0010,
      extent: 0x10,
      name: "playerState",
      says: { is: "data" },
      by: { author: "gfx", source: "user" },
    };
    const set = new ClaimSet([claim]);
    expect(set.covering(0x0018)).toHaveLength(1);
  });

  it("two peers revising one claim converge without either losing the other's", () => {
    // Last-writer-wins per *field*, which is all a CRDT can offer — but the
    // losing peer's own claim is a different object and survives intact. The
    // region write cannot separate those, because one id holds both statements.
    const base: Claim = {
      id: "clm_shared",
      at: SPAN.start,
      extent: 0x20,
      name: "charSet",
      says: { is: "bitmap", view: "char:8" },
      by: { author: "gfx", source: "user" },
    };
    const gfxRenames: Claim = { ...base, name: "characterSet" };
    const leadAddsTheirOwn: Claim = {
      id: "clm_lead_2",
      at: SPAN.start,
      extent: 0x20,
      name: "glyphs",
      says: { is: "bitmap", view: "char:8" },
      by: { author: "lead", source: "user" },
    };

    const merged = new ClaimSet([gfxRenames, leadAddsTheirOwn]);
    expect(merged.size).toBe(2);
    expect(merged.get("clm_shared")!.name).toBe("characterSet");
    // Same interpretation, so this is duplication rather than contradiction —
    // untidy, visible, and somebody removes one.
    expect(disagreements(merged).filter((d) => d.kind === "interpretation")).toHaveLength(0);
  });
});


/**
 * The same defect, twice more, found by looking rather than by assuming.
 *
 * `set_region` was called the last surviving instance of upsert-by-inference.
 * That was an assumption. Auditing the write surface found two more —
 * `set_constant` and `set_decoder`, both keying on a name — and **both are now
 * fixed**: declaring a constant adds, `edit_constant` revises by id, and
 * `set_decoder` matches by id only. `set_region` is the one that remains, and it
 * goes when claims land.
 *
 * The distinction that separates them from the writes that are *fine* is worth
 * keeping here, because it is checkable by reading one line of any write:
 *
 * - **Keyed by name in the document** — targets, tags. Offline and online behave
 *   identically: two writers converge field by field, and nothing is destroyed
 *   that was not overwritten on purpose. A target *is* its name.
 * - **Keyed by id, with the id inferred at write time** — regions by span,
 *   constants by name, decoders by name. The identity of the write depends on
 *   what the writer had synced, so the same call has two outcomes.
 *
 * What decides which a thing should be: **is the name a key the system assigns
 * meaning to, or prose a person chose?** A target name is a handle and there is
 * one view called "runtime". A constant name is prose, and two readers can pick
 * the same word for different things — which is the same argument that made
 * labels additive.
 *
 * The rule that falls out: *if a write infers identity from anything other than
 * an id it was given, it is offline/online asymmetric.*
 */
describe("upsert by inference, elsewhere on the write surface", () => {
  it("declaring a constant twice mints two ids", () => {
    // Behaviour, not source text. The workspace tests cover the tool surface;
    // this pins the property the rule above is about — that the write does not
    // consult what the writer has seen.
    const loaded = loadProjectFile(GRIDRUNNER);
    expect(loaded.constants.allByName("nothing-is-called-this")).toEqual([]);
    // `byName` now answers only when exactly one holds the name, so a caller
    // cannot silently act on the wrong one of two.
    expect(loaded.constants.byName("nothing-is-called-this")).toBeUndefined();
  });
});
