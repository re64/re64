import { describe, it, expect } from "vitest";
import { analyze } from "./rows.js";
import { MemoryMap } from "../memory/memory-map.js";
import { FileLayer } from "../memory/file-layer.js";
import { LabelIndex, createUserLabel } from "../memory/label.js";
import { CommentIndex } from "../memory/comment.js";
import { ConstantIndex } from "../memory/constant.js";
import { createUserRegion, RegionKind } from "../memory/region.js";
import { LoadedProject } from "../project/loader.js";

/**
 * Assertions here are deliberately about *semantics*, not rendering.
 *
 * Row text — column widths, tag wording, whether annotations appear — is a
 * presentation choice that changes freely. What must not change silently is
 * what the analysis concluded: which addresses are code, what refers to what,
 * and what things get named. So these check `kind`, `address`, token targets,
 * and label names, never the formatted line.
 */

const ORG = 0x1000;

/** A project consisting of one PRG layer holding the given bytes. */
function project(
  bytes: number[],
  extra: {
    labels?: { address: number; name: string; type?: "function" | "code" | "address" }[];
    regions?: { start: number; end: number; kind: RegionKind; name?: string }[];
  } = {}
): LoadedProject {
  const map = new MemoryMap();
  const layer = new FileLayer("test", "test.prg", ORG, new Uint8Array(bytes), undefined, true, true);

  for (const r of extra.regions ?? []) {
    layer.regions.addRegion(createUserRegion(`rgn_${r.start.toString(16)}`, r.start, r.end, r.kind, r.name));
  }

  const userLabels = new LabelIndex();
  for (const l of extra.labels ?? []) {
    const label = createUserLabel(`lbl_${l.address.toString(16)}`, l.address, l.name, l.type ?? "address");
    layer.labels.push(label);
    userLabels.addLabel(label);
  }

  map.addLayer(layer);
  return {
    project: { layers: [], entryPoints: [ORG] },
    map,
    prgEntries: [ORG],
    userLabels,
    comments: new CommentIndex(),
    constants: new ConstantIndex(),
    layers: [layer],
  };
}

/** The label names rendered at an address, highest priority first. */
const labelsAt = (rows: ReturnType<typeof analyze>["rows"], address: number) =>
  rows
    .filter((r) => r.address === address && r.kind === "label")
    .flatMap((r) => r.tokens.filter((t) => t.kind === "label").map((t) => t.name));

const kindAt = (rows: ReturnType<typeof analyze>["rows"], address: number) =>
  rows.find((r) => r.address === address && r.kind !== "label")?.kind;

describe("auto-labelling from references", () => {
  it("names a JSR target sub_ and types it as a function", () => {
    // JSR $1004 / RTS ; RTS
    const rows = analyze(project([0x20, 0x04, 0x10, 0x60, 0x60])).rows;

    expect(labelsAt(rows, 0x1004)).toEqual(["sub_1004"]);
    const label = rows.find((r) => r.address === 0x1004 && r.kind === "label")!;
    expect(label.tokens.find((t) => t.kind === "label")!.labelType).toBe("function");
  });

  it("names a branch target loc_ and types it as code", () => {
    // BNE $1003 / NOP / RTS
    const rows = analyze(project([0xd0, 0x01, 0xea, 0x60])).rows;

    expect(labelsAt(rows, 0x1003)).toEqual(["loc_1003"]);
    const label = rows.find((r) => r.address === 0x1003 && r.kind === "label")!;
    expect(label.tokens.find((t) => t.kind === "label")!.labelType).toBe("code");
  });

  it("names a JMP target loc_ as well", () => {
    // JMP $1004 / NOP ; RTS
    const rows = analyze(project([0x4c, 0x04, 0x10, 0xea, 0x60])).rows;
    expect(labelsAt(rows, 0x1004)).toEqual(["loc_1004"]);
  });

  it("names a data reference dat_ and does not disassemble it", () => {
    // LDA $1008 / RTS, then filler
    const rows = analyze(
      project([0xad, 0x08, 0x10, 0x60, 0xea, 0xea, 0xea, 0xea, 0x00, 0x00])
    ).rows;

    expect(labelsAt(rows, 0x1008)).toEqual(["dat_1008"]);
    // A data reference is not a control-flow target, so nothing was decoded there.
    expect(kindAt(rows, 0x1008)).toBe("data");
  });

  it("prefers a user label over the generated one", () => {
    const rows = analyze(
      project([0x20, 0x04, 0x10, 0x60, 0x60], {
        labels: [{ address: 0x1004, name: "MyRoutine", type: "function" }],
      })
    ).rows;

    expect(labelsAt(rows, 0x1004)).toEqual(["MyRoutine"]);
    expect(labelsAt(rows, 0x1004)).not.toContain("sub_1004");
  });
});

describe("operand resolution", () => {
  it("points an operand token at the address it references", () => {
    const rows = analyze(project([0x20, 0x04, 0x10, 0x60, 0x60])).rows;

    const jsr = rows.find((r) => r.address === ORG && r.kind === "instruction")!;
    const operand = jsr.tokens.find((t) => t.kind === "operand")!;
    expect(operand.target).toBe(0x1004);
  });

  it("renders a named address by its name", () => {
    const rows = analyze(
      project([0xad, 0x08, 0x10, 0x60, 0xea, 0xea, 0xea, 0xea, 0x00, 0x00], {
        labels: [{ address: 0x1008, name: "counter" }],
      })
    ).rows;

    const lda = rows.find((r) => r.address === ORG && r.kind === "instruction")!;
    expect(lda.text).toContain("counter");
  });
});

describe("region kinds decide row kinds", () => {
  it("renders a data region as data rather than decoding it", () => {
    // Without the region these bytes would decode as instructions.
    const rows = analyze(
      project([0x60, 0xea, 0xea, 0xea], {
        regions: [{ start: 0x1001, end: 0x1004, kind: "data" }],
      })
    ).rows;

    expect(kindAt(rows, ORG)).toBe("instruction");
    expect(kindAt(rows, 0x1001)).toBe("data");
  });

  it("renders a text region as text", () => {
    const rows = analyze(
      project([0x60, 0x41, 0x42, 0x43], {
        regions: [{ start: 0x1001, end: 0x1004, kind: "text" }],
      })
    ).rows;

    expect(kindAt(rows, 0x1001)).toBe("text");
  });

  it("renders a jumptable as words and follows its entries", () => {
    // Table at $1000 holding $1004, then RTS at $1004.
    const rows = analyze(
      project([0x04, 0x10, 0x00, 0x00, 0x60], {
        regions: [{ start: ORG, end: 0x1002, kind: "jumptable" }],
      })
    ).rows;

    expect(kindAt(rows, ORG)).toBe("word");
    // The entry is an entry point, so the code it points at was decoded.
    expect(kindAt(rows, 0x1004)).toBe("instruction");
  });

  it("names a region's start address", () => {
    const rows = analyze(
      project([0x60, 0xea, 0xea, 0xea], {
        regions: [{ start: 0x1001, end: 0x1004, kind: "data", name: "table" }],
      })
    ).rows;

    expect(labelsAt(rows, 0x1001)).toContain("table");
  });
});

describe("document shape", () => {
  it("covers every byte exactly once, in ascending order", () => {
    const rows = analyze(project([0x20, 0x04, 0x10, 0x60, 0x60])).rows;
    const addresses = rows.filter((r) => r.kind !== "label").map((r) => r.address);

    expect(addresses).toEqual([...addresses].sort((a, b) => a - b));
    expect(new Set(addresses).size).toBe(addresses.length);
    expect(addresses[0]).toBe(ORG);
  });

  it("places a label row before the row it names", () => {
    const rows = analyze(project([0x20, 0x04, 0x10, 0x60, 0x60])).rows;
    const label = rows.findIndex((r) => r.address === 0x1004 && r.kind === "label");
    const code = rows.findIndex((r) => r.address === 0x1004 && r.kind === "instruction");

    expect(label).toBeGreaterThanOrEqual(0);
    expect(label).toBeLessThan(code);
  });

  it("reports what it found", () => {
    const result = analyze(project([0x20, 0x04, 0x10, 0x60, 0x60]));
    expect(result.stats.instructions).toBe(3); // JSR, RTS, RTS
    expect(result.stats.rows).toBe(result.rows.length);
  });

  it("omits annotations when asked, without changing the analysis", () => {
    const withTags = analyze(project([0x20, 0x04, 0x10, 0x60, 0x60]));
    const without = analyze(project([0x20, 0x04, 0x10, 0x60, 0x60]), {
      annotations: false,
    });

    expect(without.stats.instructions).toBe(withTags.stats.instructions);
    expect(without.rows.length).toBe(withTags.rows.length);
    expect(without.rows.some((r) => r.text.includes("[fn]"))).toBe(false);
    expect(withTags.rows.some((r) => r.text.includes("[fn]"))).toBe(true);
  });
});

describe("naming in zero page", () => {
  it("never borrows a neighbour's name", () => {
    // Every byte in zero page is its own variable, so an adjacent label is not
    // a near miss but a different thing. `$0B` rendering as
    // `previousYPosition-1` is less readable than the address it replaced.
    const loaded = project([0xa5, 0x0c, 0xa5, 0x0b, 0x60], {
      labels: [{ address: 0x0c, name: "previousYPosition" }],
    });

    const text = analyze(loaded, { labelTolerance: 1 })
      .rows.map((r) => r.text)
      .join("\n");

    expect(text).toContain("LDA previousYPosition");
    expect(text).toContain("LDA $0B");
    expect(text).not.toContain("previousYPosition-1");
  });
});

describe("a byte read two ways", () => {
  it("shows every reading rather than choosing one", () => {
    // BNE +1 lands on the $A9's operand, so $1003 is an opcode one way and an
    // operand the other. The listing is address-ordered and a row holds one
    // instruction, so the alternate is shown where the walk stepped over it.
    //
    // Choosing a winner was going to need a policy and every candidate was
    // arbitrary. Emitting every block in order of where it starts, and marking
    // one whose start has already been passed, makes "primary" mean nothing
    // more than "reached first" — and the question does not arise.
    const loaded = project([0xd0, 0x01, 0xa9, 0x60]);
    const rows = analyze(loaded, { annotations: false }).rows;

    expect(rows.some((r) => r.kind === "overlap")).toBe(true);
    expect(rows.filter((r) => r.kind === "overlap")[0].text).toContain("RTS");
    // And the main reading is untouched.
    expect(rows.some((r) => r.kind === "instruction" && r.text.includes("LDA"))).toBe(true);
  });

  it("says nothing extra when no byte is contested", () => {
    const loaded = project([0xa9, 0x01, 0x85, 0x02, 0x60]);
    const rows = analyze(loaded, { annotations: false }).rows;

    expect(rows.some((r) => r.kind === "overlap")).toBe(false);
    expect(rows.some((r) => r.text.includes("also decodes"))).toBe(false);
  });
});
