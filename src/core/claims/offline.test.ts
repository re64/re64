import { describe, it, expect } from "vitest";
import { regionSetOp } from "../ops/edits.js";
import { loadProjectFile } from "../../node-files.js";
import { ClaimSet, disagreements, describeDisagreement } from "./set.js";
import { Claim } from "./model.js";

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
  it("the region write's outcome depends on whether you had synced", () => {
    const loaded = loadProjectFile(GRIDRUNNER);
    const existing = loaded.map.getAllRegions().find((r) => r.start === 0x8e00)!;
    expect(existing.name).toBe("characterSetData");

    // Online. This reader has synced, so `characterSetData` is in their project,
    // and declaring its exact span is read as *revising* it: the op carries the
    // existing id, so applying it replaces the kind and the name. The other
    // reader's conclusion is gone, and both callers were told `ok`.
    const synced = regionSetOp(loaded, existing.start, existing.end, "data", "levelTable");
    if (synced.op !== "region.set") throw new Error("shape");
    expect(synced.id).toBe(existing.id);

    // Offline. The same reader, the same intent, the same call — but their copy
    // has not seen `characterSetData`, so nothing starts at that address as far
    // as they know. A fresh id, and on merge both statements stand.
    const unsynced = regionSetOp(loaded, 0x8a00, 0x8a20, "data", "levelTable");
    if (unsynced.op !== "region.set") throw new Error("shape");
    expect(unsynced.id).not.toBe(existing.id);

    // eslint-disable-next-line no-console
    console.log(
      `same declaration, two outcomes: synced -> ${synced.id} (overwrites ` +
      `"${existing.name}"), unsynced -> ${unsynced.id} (stands alongside)`
    );
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
