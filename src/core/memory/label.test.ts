import { describe, it, expect } from "vitest";
import {
  createLayerLabel,
  createUserLabel,
  LabelIndex,
} from "./label.js";

describe("createLayerLabel", () => {
  it("creates a label with layer source", () => {
    const label = createLayerLabel(0x1000, "main", "entry", "file1");
    expect(label.address).toBe(0x1000);
    expect(label.name).toBe("main");
    expect(label.type).toBe("entry");
    expect(label.source.kind).toBe("layer");
    expect(label.source.layerName).toBe("file1");
    expect(label.source.auto).toBe(true);
  });

  it("allows $10000 for end-of-memory", () => {
    const label = createLayerLabel(0x10000, "end", "address", "layer1");
    expect(label.address).toBe(0x10000);
  });

  it("rejects addresses above $10000", () => {
    expect(() => createLayerLabel(0x10001, "bad", "address", "layer1")).toThrow();
  });

  it("rejects negative addresses", () => {
    expect(() => createLayerLabel(-1, "bad", "address", "layer1")).toThrow();
  });
});

describe("createUserLabel", () => {
  it("creates a label with user source", () => {
    const label = createUserLabel(0x2000, "player_x", "address");
    expect(label.address).toBe(0x2000);
    expect(label.name).toBe("player_x");
    expect(label.type).toBe("address");
    expect(label.source.kind).toBe("user");
    expect(label.source.auto).toBe(false);
  });
});

describe("LabelIndex", () => {
  it("stores and retrieves labels by address", () => {
    const index = new LabelIndex();
    const label = createUserLabel(0x1000, "test", "address");
    index.addLabel(label);

    const found = index.getLabelsAt(0x1000);
    expect(found).toHaveLength(1);
    expect(found[0]).toBe(label);
  });

  it("returns empty array for addresses without labels", () => {
    const index = new LabelIndex();
    expect(index.getLabelsAt(0x1000)).toHaveLength(0);
  });

  it("supports multiple labels at same address", () => {
    const index = new LabelIndex();
    const label1 = createUserLabel(0x1000, "main", "entry");
    const label2 = createLayerLabel(0x1000, "file+$0", "address", "file1");
    index.addLabel(label1);
    index.addLabel(label2);

    const found = index.getLabelsAt(0x1000);
    expect(found).toHaveLength(2);
  });

  it("hasLabelAt returns correct boolean", () => {
    const index = new LabelIndex();
    index.addLabel(createUserLabel(0x1000, "test", "address"));

    expect(index.hasLabelAt(0x1000)).toBe(true);
    expect(index.hasLabelAt(0x2000)).toBe(false);
  });

  it("getAllLabels returns sorted by address", () => {
    const index = new LabelIndex();
    index.addLabel(createUserLabel(0x3000, "c", "address"));
    index.addLabel(createUserLabel(0x1000, "a", "address"));
    index.addLabel(createUserLabel(0x2000, "b", "address"));

    const all = index.getAllLabels();
    expect(all[0].address).toBe(0x1000);
    expect(all[1].address).toBe(0x2000);
    expect(all[2].address).toBe(0x3000);
  });

  it("getLabelsInRange returns labels in range", () => {
    const index = new LabelIndex();
    index.addLabel(createUserLabel(0x1000, "a", "address"));
    index.addLabel(createUserLabel(0x1500, "b", "address"));
    index.addLabel(createUserLabel(0x2000, "c", "address"));
    index.addLabel(createUserLabel(0x3000, "d", "address"));

    const range = index.getLabelsInRange(0x1000, 0x2000);
    expect(range).toHaveLength(2);
    expect(range[0].name).toBe("a");
    expect(range[1].name).toBe("b");
  });

  it("addLabels adds multiple labels", () => {
    const index = new LabelIndex();
    const labels = [
      createUserLabel(0x1000, "a", "address"),
      createUserLabel(0x2000, "b", "address"),
    ];
    index.addLabels(labels);

    expect(index.getAllLabels()).toHaveLength(2);
  });

  describe("resolve", () => {
    it("returns exact match with offset 0", () => {
      const index = new LabelIndex();
      index.addLabel(createUserLabel(0x1000, "data", "address"));

      const resolved = index.resolve(0x1000, 0);
      expect(resolved).toBeDefined();
      expect(resolved!.label.name).toBe("data");
      expect(resolved!.offset).toBe(0);
    });

    it("returns undefined for non-matching address with zero tolerance", () => {
      const index = new LabelIndex();
      index.addLabel(createUserLabel(0x1000, "data", "address"));

      expect(index.resolve(0x1001, 0)).toBeUndefined();
    });

    it("finds label with negative offset (address before label)", () => {
      const index = new LabelIndex();
      index.addLabel(createUserLabel(0x1000, "data", "address"));

      const resolved = index.resolve(0x0FFF, 1);
      expect(resolved).toBeDefined();
      expect(resolved!.label.name).toBe("data");
      expect(resolved!.offset).toBe(-1);
    });

    it("finds label with positive offset (address after label)", () => {
      const index = new LabelIndex();
      index.addLabel(createUserLabel(0x1000, "data", "address"));

      const resolved = index.resolve(0x1001, 1);
      expect(resolved).toBeDefined();
      expect(resolved!.label.name).toBe("data");
      expect(resolved!.offset).toBe(1);
    });

    it("prefers exact match over nearby labels", () => {
      const index = new LabelIndex();
      index.addLabel(createUserLabel(0x1000, "nearby", "address"));
      index.addLabel(createUserLabel(0x1001, "exact", "address"));

      const resolved = index.resolve(0x1001, 5);
      expect(resolved).toBeDefined();
      expect(resolved!.label.name).toBe("exact");
      expect(resolved!.offset).toBe(0);
    });

    it("prefers smaller offset when multiple labels in range", () => {
      const index = new LabelIndex();
      index.addLabel(createUserLabel(0x1000, "far", "address"));
      index.addLabel(createUserLabel(0x1003, "close", "address"));

      const resolved = index.resolve(0x1002, 5);
      expect(resolved).toBeDefined();
      expect(resolved!.label.name).toBe("close");
      expect(resolved!.offset).toBe(-1);
    });

    it("respects tolerance limit", () => {
      const index = new LabelIndex();
      index.addLabel(createUserLabel(0x1000, "data", "address"));

      expect(index.resolve(0x1003, 2)).toBeUndefined();
      expect(index.resolve(0x1003, 3)).toBeDefined();
    });
  });
});
