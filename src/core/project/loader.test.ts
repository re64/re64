import { describe, it, expect } from "vitest";
import { buildMemoryMap } from "./loader.js";
import { parseProject } from "./project.js";
import { Project } from "./project.js";

/** A stand-in for reading files, so these tests touch no disk. */
const bytes = (start: number, values: number[]) => () => ({
  start,
  data: new Uint8Array(values),
  isPrg: true,
});

describe("buildMemoryMap", () => {
  it("gives each layer the labels and regions declared inside it", () => {
    const project: Project = {
      layers: [
        {
          type: "prg",
          path: "game.prg",
          labels: [{ address: "$1000", name: "Start", type: "function" }],
          regions: [{ start: "$1002", end: "$1004", kind: "data", name: "table" }],
        },
      ],
    };

    const { map, layers } = buildMemoryMap(project, bytes(0x1000, [1, 2, 3, 4]), {
      platform: false,
    });

    expect(layers[0].labels.map((l) => l.name)).toEqual(["Start"]);
    expect(map.getRegionAt(0x1002)?.name).toBe("table");
    expect(map.getKindAt(0x1002)).toBe("data");
    // Outside the region, the layer default applies.
    expect(map.getKindAt(0x1000)).toBe("code");
  });

  it("keeps a symbol layer's labels without giving it any address range", () => {
    const project: Project = {
      layers: [
        {
          type: "symbols",
          name: "syms",
          labels: [{ address: "$D020", name: "BORDER" }],
        },
        { type: "prg", path: "game.prg" },
      ],
    };

    const { map, layers } = buildMemoryMap(project, bytes(0x1000, [1, 2]), {
      platform: false,
    });

    expect(map.getLabels().resolve(0xd020)?.label.name).toBe("BORDER");
    expect(layers[0].hasBytes).toBe(false);
    expect(map.getLayers().filter((l) => l.hasBytes)).toHaveLength(1);
  });

  it("orders layers so a later declaration shadows an earlier one", () => {
    const project: Project = {
      layers: [
        { type: "bytes", address: "$1000", bytes: "aa", length: 4, name: "under" },
        { type: "bytes", address: "$1000", bytes: "bb", length: 4, name: "over" },
      ],
    };

    const { map } = buildMemoryMap(project, bytes(0, []), { platform: false });

    expect(map.readByte(0x1000)).toBe(0xbb);
    expect(map.layerAt(0x1000)?.name).toBe("over");
  });

  it("reports declaration-order layers so edits can be written back", () => {
    const project: Project = {
      layers: [
        { type: "symbols", name: "syms", labels: [{ address: "$02", name: "v" }] },
        { type: "prg", path: "game.prg" },
      ],
    };

    const { layers, project: parsed } = buildMemoryMap(project, bytes(0x1000, [1, 2]), {
      platform: false,
    });

    // Index i must line up with project.layers[i], which the z-ordered map does not.
    expect(layers).toHaveLength(2);
    expect(layers[0].name).toBe("syms");
    expect(parsed.layers[1].type).toBe("prg");
  });

  it("collects PRG entry points unless suppressed", () => {
    const withEntry = buildMemoryMap(
      { layers: [{ type: "prg", path: "game.prg" }] },
      bytes(0x0801, [1, 2]),
      { platform: false }
    );
    expect(withEntry.prgEntries).toEqual([0x0801]);

    const suppressed = buildMemoryMap(
      { layers: [{ type: "prg", path: "game.prg", noAutoEntry: true }] },
      bytes(0x0801, [1, 2]),
      { platform: false }
    );
    expect(suppressed.prgEntries).toEqual([]);
  });

  it("includes the C64 platform layer unless disabled", () => {
    const project: Project = { layers: [{ type: "prg", path: "game.prg" }] };

    const withPlatform = buildMemoryMap(project, bytes(0x1000, [1, 2]));
    expect(withPlatform.map.getLabels().resolve(0xffd2)?.label.name).toBe("CHROUT");

    const without = buildMemoryMap(project, bytes(0x1000, [1, 2]), { platform: false });
    expect(without.map.getLabels().resolve(0xffd2)).toBeUndefined();
  });
});

describe("project schema", () => {
  it("carries comments through to labels and regions", () => {
    // Both were declared in the schema but silently dropped by the converters.
    const project = parseProject(
      JSON.stringify({
        layers: [
          {
            type: "prg",
            path: "game.prg",
            labels: [{ address: "$1000", name: "Start", comment: "why it matters" }],
            regions: [{ start: "$1000", end: "$1002", kind: "data", comment: "a table" }],
          },
        ],
      })
    );

    const { map, layers } = buildMemoryMap(project, bytes(0x1000, [1, 2]), {
      platform: false,
    });

    expect(layers[0].labels[0].comment).toBe("why it matters");
    expect(map.getRegionAt(0x1000)?.comment).toBe("a table");
  });

  it("rejects the old flat form instead of ignoring it", () => {
    const legacy = JSON.stringify({
      layers: [{ type: "prg", path: "game.prg" }],
      labels: [{ address: "$1000", name: "Start" }],
    });

    expect(() => parseProject(legacy)).toThrow(/no longer supported/);
  });

  it("names the offending region when its kind is unknown", () => {
    // A typo in a hand-written file should say what is wrong and where, not
    // surface later as a crash inside the render walk.
    const bad = JSON.stringify({
      layers: [
        {
          type: "prg",
          path: "game.prg",
          regions: [{ start: "$1000", end: "$1010", kind: "sprite" }],
        },
      ],
    });

    expect(() => parseProject(bad)).toThrow(/Unknown region kind "sprite".*\$1000.*game\.prg/);
  });

  it("names the offending label when its type is unknown", () => {
    const bad = JSON.stringify({
      layers: [
        {
          type: "prg",
          path: "game.prg",
          labels: [{ address: "$1000", name: "Start", type: "subroutine" }],
        },
      ],
    });

    expect(() => parseProject(bad)).toThrow(/Unknown label type "subroutine".*Start/);
  });

  it("accepts every documented region kind and label type", () => {
    const ok = JSON.stringify({
      layers: [
        {
          type: "prg",
          path: "game.prg",
          regions: ["code", "data", "text", "jumptable", "unknown"].map((kind, i) => ({
            start: 0x1000 + i * 16,
            end: 0x1000 + i * 16 + 8,
            kind,
          })),
          labels: ["entry", "function", "code", "address"].map((type, i) => ({
            address: 0x1000 + i,
            name: `l${i}`,
            type,
          })),
        },
      ],
    });

    expect(() => parseProject(ok)).not.toThrow();
  });

  it("accepts a symbol layer with nothing in it yet", () => {
    // Refused once, as a layer contributing nothing. It is now something a
    // caller creates deliberately — and something that exists for an instant
    // between adding a layer and putting the first name into it.
    expect(() => parseProject(JSON.stringify({ layers: [{ type: "symbols" }] }))).not.toThrow();
  });

  it("drops a region on a symbols layer rather than refusing to open", () => {
    // It used to throw. One accepted write could then put a region there and
    // the project became permanently unopenable — no interface could repair
    // what one of them had written.
    const parsed = parseProject(
      JSON.stringify({
        layers: [
          {
            type: "symbols",
            labels: [{ address: "$02", name: "v" }],
            regions: [{ start: "$02", end: "$03", kind: "data" }],
          },
        ],
      })
    );

    expect(parsed.layers[0].regions).toBeUndefined();
    expect(parsed.layers[0].labels).toHaveLength(1);
  });

});
