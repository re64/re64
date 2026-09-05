import { Claim } from "./model.js";
import { LabelType } from "../memory/label-type.js";

/**
 * A name somebody chose.
 *
 * There is no factory for one, and that is the point: a user claim is whatever
 * the person wrote, where the others exist because something derives them. The
 * root is spelled as a label type here only because these tests are about
 * resolution, which is where the two meet.
 */
const userClaim = (
  id: string,
  at: number,
  name: string,
  type: LabelType = "address",
  extent?: number
): Claim => ({
  id,
  at,
  name,
  ...(type === "entry" ? { root: "entry" as const } : {}),
  ...(type === "function" ? { root: "routine" as const } : {}),
  ...(type === "code" ? { root: "location" as const } : {}),
  ...(extent === undefined ? {} : { extent }),
  by: { author: "test", source: "user" },
});

import { describe, it, expect } from "vitest";
import { layerClaim, NameIndex } from "./names.js";

describe("a name a layer brings with it", () => {
  it("carries the layer as its source, and the root its type asks for", () => {
    const claim = layerClaim("lbl_layer1000", 0x1000, "main", "entry");
    expect(claim.at).toBe(0x1000);
    expect(claim.name).toBe("main");
    expect(claim.root).toBe("entry");
    expect(claim.by.source).toBe("layer");
  });

  it("allows $10000 for end-of-memory", () => {
    expect(layerClaim("lbl_layer10000", 0x10000, "end", "address").at).toBe(0x10000);
  });

  it("rejects an address outside the machine", () => {
    expect(() => layerClaim("lbl_hi", 0x10001, "bad", "address")).toThrow();
    expect(() => layerClaim("lbl_lo", -1, "bad", "address")).toThrow();
  });
});

describe("a name somebody chose", () => {
  it("is a claim with no root, which is what \"just a name\" means", () => {
    const claim = userClaim("lbl_user2000", 0x2000, "player_x", "address");
    expect(claim.at).toBe(0x2000);
    expect(claim.name).toBe("player_x");
    expect(claim.root).toBeUndefined();
    expect(claim.by.source).toBe("user");
  });
});

describe("NameIndex", () => {
  it("stores and retrieves labels by address", () => {
    const index = new NameIndex();
    const label = userClaim("lbl_user1000", 0x1000, "test", "address");
    index.addLabel(label);

    const found = index.getLabelsAt(0x1000);
    expect(found).toHaveLength(1);
    expect(found[0]).toBe(label);
  });

  it("returns empty array for addresses without labels", () => {
    const index = new NameIndex();
    expect(index.getLabelsAt(0x1000)).toHaveLength(0);
  });

  it("supports multiple labels at same address", () => {
    const index = new NameIndex();
    const label1 = userClaim("lbl_user1000", 0x1000, "main", "entry");
    const label2 = layerClaim("lbl_layer1000", 0x1000, "file+$0", "address");
    index.addLabel(label1);
    index.addLabel(label2);

    const found = index.getLabelsAt(0x1000);
    expect(found).toHaveLength(2);
  });

  it("hasLabelAt returns correct boolean", () => {
    const index = new NameIndex();
    index.addLabel(userClaim("lbl_user1000", 0x1000, "test", "address"));

    expect(index.hasLabelAt(0x1000)).toBe(true);
    expect(index.hasLabelAt(0x2000)).toBe(false);
  });

  it("getAllLabels returns sorted by address", () => {
    const index = new NameIndex();
    index.addLabel(userClaim("lbl_user3000", 0x3000, "c", "address"));
    index.addLabel(userClaim("lbl_user1000", 0x1000, "a", "address"));
    index.addLabel(userClaim("lbl_user2000", 0x2000, "b", "address"));

    const all = index.getAllLabels();
    expect(all[0].at).toBe(0x1000);
    expect(all[1].at).toBe(0x2000);
    expect(all[2].at).toBe(0x3000);
  });

  it("getLabelsInRange returns labels in range", () => {
    const index = new NameIndex();
    index.addLabel(userClaim("lbl_user1000", 0x1000, "a", "address"));
    index.addLabel(userClaim("lbl_user1500", 0x1500, "b", "address"));
    index.addLabel(userClaim("lbl_user2000", 0x2000, "c", "address"));
    index.addLabel(userClaim("lbl_user3000", 0x3000, "d", "address"));

    const range = index.getLabelsInRange(0x1000, 0x2000);
    expect(range).toHaveLength(2);
    expect(range[0].name).toBe("a");
    expect(range[1].name).toBe("b");
  });

  it("addLabels adds multiple labels", () => {
    const index = new NameIndex();
    const labels = [
      userClaim("lbl_user1000", 0x1000, "a", "address"),
      userClaim("lbl_user2000", 0x2000, "b", "address"),
    ];
    index.addLabels(labels);

    expect(index.getAllLabels()).toHaveLength(2);
  });

  describe("resolve", () => {
    it("returns exact match with offset 0", () => {
      const index = new NameIndex();
      index.addLabel(userClaim("lbl_user1000", 0x1000, "data", "address"));

      const resolved = index.resolve(0x1000, 0);
      expect(resolved).toBeDefined();
      expect(resolved!.label.name).toBe("data");
      expect(resolved!.offset).toBe(0);
    });

    it("returns undefined for non-matching address with zero tolerance", () => {
      const index = new NameIndex();
      index.addLabel(userClaim("lbl_user1000", 0x1000, "data", "address"));

      expect(index.resolve(0x1001, 0)).toBeUndefined();
    });

    it("finds label with negative offset (address before label)", () => {
      const index = new NameIndex();
      index.addLabel(userClaim("lbl_user1000", 0x1000, "data", "address"));

      const resolved = index.resolve(0x0FFF, 1);
      expect(resolved).toBeDefined();
      expect(resolved!.label.name).toBe("data");
      expect(resolved!.offset).toBe(-1);
    });

    it("finds label with positive offset (address after label)", () => {
      const index = new NameIndex();
      index.addLabel(userClaim("lbl_user1000", 0x1000, "data", "address"));

      const resolved = index.resolve(0x1001, 1);
      expect(resolved).toBeDefined();
      expect(resolved!.label.name).toBe("data");
      expect(resolved!.offset).toBe(1);
    });

    it("prefers exact match over nearby labels", () => {
      const index = new NameIndex();
      index.addLabel(userClaim("lbl_user1000", 0x1000, "nearby", "address"));
      index.addLabel(userClaim("lbl_user1001", 0x1001, "exact", "address"));

      const resolved = index.resolve(0x1001, 5);
      expect(resolved).toBeDefined();
      expect(resolved!.label.name).toBe("exact");
      expect(resolved!.offset).toBe(0);
    });

    it("prefers smaller offset when multiple labels in range", () => {
      const index = new NameIndex();
      index.addLabel(userClaim("lbl_user1000", 0x1000, "far", "address"));
      index.addLabel(userClaim("lbl_user1003", 0x1003, "close", "address"));

      const resolved = index.resolve(0x1002, 5);
      expect(resolved).toBeDefined();
      expect(resolved!.label.name).toBe("close");
      expect(resolved!.offset).toBe(-1);
    });

    it("respects tolerance limit", () => {
      const index = new NameIndex();
      index.addLabel(userClaim("lbl_user1000", 0x1000, "data", "address"));

      expect(index.resolve(0x1003, 2)).toBeUndefined();
      expect(index.resolve(0x1003, 3)).toBeDefined();
    });
  });
});
