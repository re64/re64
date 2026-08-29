import { describe, it, expect } from "vitest";
import { MemoryMap } from "./memory-map.js";
import { BytesLayer } from "./layer.js";
import { createUserRegion } from "./region.js";

/** Helper to create a constant-fill layer */
function constLayer(name: string, start: number, length: number, value: number) {
  return new BytesLayer(name, start, new Uint8Array([value]), length);
}

describe("MemoryMap", () => {
  describe("layer management", () => {
    it("starts with no layers", () => {
      const map = new MemoryMap();
      expect(map.getLayerCount()).toBe(0);
      expect(map.getLayers()).toEqual([]);
    });

    it("adds layers to top by default", () => {
      const map = new MemoryMap();
      const layer1 = constLayer("bottom", 0, 0x100, 0x00);
      const layer2 = constLayer("top", 0, 0x100, 0xff);

      map.addLayer(layer1);
      map.addLayer(layer2);

      expect(map.getLayerCount()).toBe(2);
      expect(map.getLayers()[0]).toBe(layer2); // top
      expect(map.getLayers()[1]).toBe(layer1); // bottom
    });

    it("adds layers at specific index", () => {
      const map = new MemoryMap();
      const layer1 = constLayer("first", 0, 0x100, 0x01);
      const layer2 = constLayer("second", 0, 0x100, 0x02);
      const layer3 = constLayer("middle", 0, 0x100, 0x03);

      map.addLayer(layer1);
      map.addLayer(layer2);
      map.addLayer(layer3, 1); // insert between top and bottom

      expect(map.getLayers()[0]).toBe(layer2);
      expect(map.getLayers()[1]).toBe(layer3);
      expect(map.getLayers()[2]).toBe(layer1);
    });

    it("removes layers by index", () => {
      const map = new MemoryMap();
      const layer1 = constLayer("a", 0, 0x100, 0x01);
      const layer2 = constLayer("b", 0, 0x100, 0x02);

      map.addLayer(layer1);
      map.addLayer(layer2);

      const removed = map.removeLayer(0);
      expect(removed).toBe(layer2);
      expect(map.getLayerCount()).toBe(1);
      expect(map.getLayers()[0]).toBe(layer1);
    });

    it("throws on invalid remove index", () => {
      const map = new MemoryMap();
      expect(() => map.removeLayer(0)).toThrow("Index out of bounds");
      expect(() => map.removeLayer(-1)).toThrow("Index out of bounds");
    });

    it("moves layers", () => {
      const map = new MemoryMap();
      const layer1 = constLayer("a", 0, 0x100, 0x01);
      const layer2 = constLayer("b", 0, 0x100, 0x02);
      const layer3 = constLayer("c", 0, 0x100, 0x03);

      map.addLayer(layer1);
      map.addLayer(layer2);
      map.addLayer(layer3);
      // order: [layer3, layer2, layer1]

      map.moveLayer(0, 2);
      // order: [layer2, layer1, layer3]

      expect(map.getLayers()[0]).toBe(layer2);
      expect(map.getLayers()[1]).toBe(layer1);
      expect(map.getLayers()[2]).toBe(layer3);
    });
  });

  describe("reading bytes", () => {
    it("returns undefined for unmapped addresses", () => {
      const map = new MemoryMap();
      expect(map.readByte(0x1000)).toBeUndefined();
    });

    it("reads from single layer", () => {
      const map = new MemoryMap();
      const data = new Uint8Array([0xaa, 0xbb, 0xcc]);
      map.addLayer(new BytesLayer("data", 0x1000, data));

      expect(map.readByte(0x1000)).toBe(0xaa);
      expect(map.readByte(0x1001)).toBe(0xbb);
      expect(map.readByte(0x1002)).toBe(0xcc);
      expect(map.readByte(0x1003)).toBeUndefined();
    });

    it("top layer shadows lower layers (full overlap)", () => {
      const map = new MemoryMap();

      // bottom layer: all zeros at $1000-$10FF
      map.addLayer(constLayer("bottom", 0x1000, 0x100, 0x00));

      // top layer: all ones at $1000-$10FF (same range)
      map.addLayer(constLayer("top", 0x1000, 0x100, 0xff));

      expect(map.readByte(0x1000)).toBe(0xff);
      expect(map.readByte(0x1050)).toBe(0xff);
    });

    it("top layer shadows lower layers (partial overlap)", () => {
      const map = new MemoryMap();

      // bottom layer: $1000-$1100
      map.addLayer(constLayer("bottom", 0x1000, 0x100, 0x00));

      // top layer: $1080-$1180 (overlaps second half)
      map.addLayer(constLayer("top", 0x1080, 0x100, 0xff));

      // first half: from bottom layer
      expect(map.readByte(0x1000)).toBe(0x00);
      expect(map.readByte(0x107f)).toBe(0x00);

      // overlap region: from top layer
      expect(map.readByte(0x1080)).toBe(0xff);
      expect(map.readByte(0x10ff)).toBe(0xff);

      // beyond bottom, still in top
      expect(map.readByte(0x1100)).toBe(0xff);
      expect(map.readByte(0x117f)).toBe(0xff);

      // beyond both
      expect(map.readByte(0x1180)).toBeUndefined();
    });

    it("smaller layer entirely inside larger layer", () => {
      const map = new MemoryMap();

      // large bottom layer
      map.addLayer(constLayer("big", 0x1000, 0x1000, 0xaa));

      // small top layer in the middle
      map.addLayer(constLayer("small", 0x1800, 0x100, 0xbb));

      expect(map.readByte(0x1000)).toBe(0xaa);
      expect(map.readByte(0x17ff)).toBe(0xaa);
      expect(map.readByte(0x1800)).toBe(0xbb);
      expect(map.readByte(0x18ff)).toBe(0xbb);
      expect(map.readByte(0x1900)).toBe(0xaa);
      expect(map.readByte(0x1fff)).toBe(0xaa);
    });

    it("readByteWithSource returns layer info", () => {
      const map = new MemoryMap();
      const bottom = constLayer("bottom", 0x1000, 0x100, 0x00);
      const top = constLayer("top", 0x1080, 0x80, 0xff);

      map.addLayer(bottom);
      map.addLayer(top);

      const result1 = map.readByteWithSource(0x1000);
      expect(result1?.value).toBe(0x00);
      expect(result1?.layer).toBe(bottom);

      const result2 = map.readByteWithSource(0x1080);
      expect(result2?.value).toBe(0xff);
      expect(result2?.layer).toBe(top);

      expect(map.readByteWithSource(0x0fff)).toBeUndefined();
    });

    it("readBytes returns array of values", () => {
      const map = new MemoryMap();
      const data = new Uint8Array([0x01, 0x02, 0x03]);
      map.addLayer(new BytesLayer("data", 0x1000, data));

      expect(map.readBytes(0x1000, 3)).toEqual([0x01, 0x02, 0x03]);
      expect(map.readBytes(0x0ffe, 5)).toEqual([
        undefined,
        undefined,
        0x01,
        0x02,
        0x03,
      ]);
    });
  });

  describe("layer reordering affects shadowing", () => {
    it("moving layer changes visible bytes", () => {
      const map = new MemoryMap();
      const zeros = constLayer("zeros", 0x1000, 0x100, 0x00);
      const ones = constLayer("ones", 0x1000, 0x100, 0xff);

      map.addLayer(zeros);
      map.addLayer(ones);
      // ones on top

      expect(map.readByte(0x1000)).toBe(0xff);

      map.moveLayer(0, 1);
      // zeros now on top

      expect(map.readByte(0x1000)).toBe(0x00);
    });
  });

  describe("regions belong to their layer", () => {
    it("resolves the region from the layer that supplies the byte", () => {
      const map = new MemoryMap();
      const lower = constLayer("lower", 0x1000, 0x100, 0x00);
      const upper = constLayer("upper", 0x1000, 0x100, 0xff);

      lower.regions.addRegion(createUserRegion("rgn_1000", 0x1000, 0x1010, "text", "lowerText"));
      upper.regions.addRegion(createUserRegion("rgn_1000", 0x1000, 0x1010, "jumptable", "upperTable"));

      map.addLayer(lower);
      map.addLayer(upper); // upper on top

      expect(map.getRegionAt(0x1000)?.name).toBe("upperTable");
      expect(map.getKindAt(0x1000)).toBe("jumptable");
    });

    it("moves regions with their layer when the stack is reordered", () => {
      // The bug this ownership change exists to fix: annotations must follow
      // the bytes they describe, not stay pinned to an address.
      const map = new MemoryMap();
      const lower = constLayer("lower", 0x1000, 0x100, 0x00);
      const upper = constLayer("upper", 0x1000, 0x100, 0xff);

      lower.regions.addRegion(createUserRegion("rgn_1000", 0x1000, 0x1010, "text", "lowerText"));
      map.addLayer(lower);
      map.addLayer(upper);

      // upper is on top and declares nothing, so its default kind applies
      expect(map.getRegionAt(0x1000)).toBeUndefined();
      expect(map.getKindAt(0x1000)).toBe("data");

      map.moveLayer(0, 1); // lower to the top

      expect(map.getRegionAt(0x1000)?.name).toBe("lowerText");
      expect(map.getKindAt(0x1000)).toBe("text");
    });

    it("falls back to the layer default outside any declared region", () => {
      const map = new MemoryMap();
      const layer = constLayer("layer", 0x1000, 0x100, 0x00);
      layer.regions.addRegion(createUserRegion("rgn_1000", 0x1000, 0x1010, "text"));
      map.addLayer(layer);

      expect(map.getKindAt(0x1005)).toBe("text");
      expect(map.getKindAt(0x1020)).toBe("data"); // BytesLayer default
      expect(map.getKindAt(0x2000)).toBeUndefined(); // nothing mapped
    });

    it("resolves nested regions innermost-first", () => {
      const map = new MemoryMap();
      const layer = constLayer("layer", 0x1000, 0x100, 0x00);
      layer.regions.addRegion(createUserRegion("rgn_1000", 0x1000, 0x1080, "data", "outer"));
      layer.regions.addRegion(createUserRegion("rgn_1010", 0x1010, 0x1020, "text", "inner"));
      map.addLayer(layer);

      expect(map.getRegionAt(0x1005)?.name).toBe("outer");
      expect(map.getRegionAt(0x1015)?.name).toBe("inner");
      expect(map.getKindAt(0x1015)).toBe("text");
    });

    it("attachRegion gives the region to the topmost covering layer", () => {
      const map = new MemoryMap();
      const lower = constLayer("lower", 0x1000, 0x100, 0x00);
      const upper = constLayer("upper", 0x1000, 0x100, 0xff);
      map.addLayer(lower);
      map.addLayer(upper);

      const owner = map.attachRegion(createUserRegion("rgn_1000", 0x1000, 0x1010, "text"));

      expect(owner).toBe(upper);
      expect(upper.regions.size).toBe(1);
      expect(lower.regions.size).toBe(0);
    });

    it("attachRegion reports unmapped regions instead of dropping them silently", () => {
      const map = new MemoryMap();
      map.addLayer(constLayer("layer", 0x1000, 0x100, 0x00));

      expect(map.attachRegion(createUserRegion("rgn_9000", 0x9000, 0x9010, "data"))).toBeUndefined();
    });
  });
});
