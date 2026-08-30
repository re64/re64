import { describe, it, expect } from "vitest";
import { LabelIndex, createUserLabel, createPlatformLabel } from "./label.js";
import { MemoryMap } from "./memory-map.js";
import { SymbolLayer } from "./symbol-layer.js";

/**
 * Resolution when several labels share an address.
 *
 * The order must depend only on the data, never on the order the labels
 * happened to be added — two clients that declared the same labels in
 * different orders have to agree on what to display.
 */

const index = (labels: ReturnType<typeof createUserLabel>[]) => {
  const idx = new LabelIndex();
  idx.addLabels(labels);
  return idx;
};

describe("resolution is independent of insertion order", () => {
  it("agrees between clients that added the same labels in either order", () => {
    // This is the bug the primary index exists to close: comparing rank alone
    // left equal-ranked labels in insertion order, so these two resolved
    // differently from identical data.
    const zebra = createUserLabel("lbl_z", 0x8000, "Zebra", "address");
    const alpha = createUserLabel("lbl_a", 0x8000, "Alpha", "address");

    expect(index([zebra, alpha]).resolve(0x8000)?.label.name).toBe(
      index([alpha, zebra]).resolve(0x8000)?.label.name
    );
  });

  it("breaks a rank tie by id, not by name", () => {
    // By id, so renaming a label does not silently move the primary.
    const first = createUserLabel("lbl_a", 0x8000, "Zebra", "address");
    const second = createUserLabel("lbl_b", 0x8000, "Alpha", "address");

    expect(index([first, second]).resolve(0x8000)?.label.id).toBe("lbl_a");
    expect(index([second, first]).resolve(0x8000)?.label.id).toBe("lbl_a");
  });

  it("still prefers a higher-ranked source over a lower one", () => {
    const user = createUserLabel("lbl_zzz", 0xffd2, "ROM_CHROUT", "address");
    const platform = createPlatformLabel("lbl_aaa", 0xffd2, "CHROUT");

    expect(index([platform, user]).resolve(0xffd2)?.label.name).toBe("ROM_CHROUT");
  });
});

describe("explicit primary", () => {
  const two = () => {
    const idx = new LabelIndex();
    idx.addLabels([
      createUserLabel("lbl_a", 0x8000, "Alpha", "address"),
      createUserLabel("lbl_b", 0x8000, "Beta", "address"),
    ]);
    return idx;
  };

  it("wins over rank and over the id tiebreak", () => {
    const idx = two();
    expect(idx.resolve(0x8000)?.label.id).toBe("lbl_a");

    idx.setPrimaryLabels(new Map([[0x8000, "lbl_b"]]));
    expect(idx.resolve(0x8000)?.label.id).toBe("lbl_b");
  });

  it("promotes a lower-ranked label when asked", () => {
    const idx = new LabelIndex();
    idx.addLabels([
      createUserLabel("lbl_u", 0xffd2, "ROM_CHROUT", "address"),
      createPlatformLabel("lbl_p", 0xffd2, "CHROUT"),
    ]);
    idx.setPrimaryLabels(new Map([[0xffd2, "lbl_p"]]));

    expect(idx.resolve(0xffd2)?.label.name).toBe("CHROUT");
  });

  it("falls back to rank when the promoted label is gone", () => {
    // Self-healing: a concurrent delete-versus-promote needs no reconciliation.
    const idx = two();
    idx.setPrimaryLabels(new Map([[0x8000, "lbl_deleted"]]));

    expect(idx.resolve(0x8000)?.label.id).toBe("lbl_a");
  });

  it("orders the whole list, not just the winner", () => {
    const idx = two();
    idx.setPrimaryLabels(new Map([[0x8000, "lbl_b"]]));

    expect(idx.getLabelsAt(0x8000).map((l) => l.id)).toEqual(["lbl_b", "lbl_a"]);
  });

  it("leaves other addresses alone", () => {
    const idx = two();
    idx.addLabel(createUserLabel("lbl_c", 0x9000, "Gamma", "address"));
    idx.setPrimaryLabels(new Map([[0x8000, "lbl_b"]]));

    expect(idx.resolve(0x9000)?.label.id).toBe("lbl_c");
  });
});

describe("the map carries the project's choice", () => {
  it("applies primaryLabels to the index it builds", () => {
    const map = new MemoryMap();
    map.addLayer(
      new SymbolLayer("syms", [
        createUserLabel("lbl_a", 0xd016, "VIC_CTRL2", "address"),
        createUserLabel("lbl_b", 0xd016, "SCROLX", "address"),
      ])
    );
    map.primaryLabels.set(0xd016, "lbl_b");

    expect(map.getLabels().resolve(0xd016)?.label.name).toBe("SCROLX");
  });
});

