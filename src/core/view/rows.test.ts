import { describe, it, expect } from "vitest";
import { analyze, wrapCommentText } from "./rows.js";
import { MemoryMap } from "../memory/memory-map.js";
import { FileLayer } from "../memory/file-layer.js";
import { LabelIndex, createPlatformLabel, createUserLabel } from "../memory/label.js";
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
    regions?: { start: number; end: number; kind: RegionKind; name?: string; view?: string }[];
  } = {}
): LoadedProject {
  const map = new MemoryMap();
  const layer = new FileLayer("test", "test.prg", ORG, new Uint8Array(bytes), undefined, true, true);

  for (const r of extra.regions ?? []) {
    layer.regions.addRegion(createUserRegion({
      id: `rgn_${r.start.toString(16)}`,
      start: r.start,
      end: r.end,
      kind: r.kind,
      name: r.name,
      view: r.view,
    }));
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

describe("wrapping a comment", () => {
  it("leaves a line that fits alone", () => {
    expect(wrapCommentText("short enough", 40)).toEqual(["short enough"]);
  });

  it("keeps a run of spaces, which is sometimes the content", () => {
    // A comment quoting bytes, or lining up a small table, means the spacing it
    // wrote. Splitting on /  +/ and rejoining with one space silently edited it:
    // `HES  PRESS` came back as `HES PRESS`.
    expect(wrapCommentText("HES  PRESS FIRE", 40)).toEqual(["HES  PRESS FIRE"]);
    expect(wrapCommentText("a    b", 40)).toEqual(["a    b"]);
  });

  it("breaks on spaces, never mid-word", () => {
    const lines = wrapCommentText("alpha bravo charlie delta echo", 12);
    expect(lines).toEqual(["alpha bravo", "charlie", "delta echo"]);
    expect(lines.every((l) => l.length <= 12)).toBe(true);
  });

  it("treats an author's own newline as a paragraph break", () => {
    // The whole design: a wrapped line and a hand-broken one are the same
    // thing, so both arrive here as separate lines and neither is special.
    expect(wrapCommentText("one two\nthree four", 40)).toEqual(["one two", "three four"]);
  });

  it("keeps a blank line, which separates paragraphs", () => {
    expect(wrapCommentText("first\n\nsecond", 40)).toEqual(["first", "", "second"]);
  });

  it("carries an indent onto continuations, so a list stays a list", () => {
    const lines = wrapCommentText("    alpha bravo charlie", 16);
    expect(lines).toEqual(["    alpha bravo", "    charlie"]);
  });

  it("leaves a word longer than the width long rather than splitting it", () => {
    // Usually an identifier or an address. Breaking it saves a column and makes
    // it unselectable, which is the worse trade.
    const lines = wrapCommentText("see UpdateExplosionXPositionArrayForLevel now", 12);
    expect(lines).toContain("UpdateExplosionXPositionArrayForLevel");
  });

  it("terminates on a word longer than the width", () => {
    expect(wrapCommentText("aaaaaaaaaaaaaaaa bb", 4)).toEqual(["aaaaaaaaaaaaaaaa", "bb"]);
  });
});

describe("a name the project did not choose", () => {
  it("renders its description above its own label row", () => {
    // The built-in table carried 382 of these and no consumer saw one. It goes
    // above the label because it introduces the name, which is how a
    // hand-written disassembly reads.
    const loaded = project([0xea, 0x60]);
    const described = createPlatformLabel("lbl_plat", ORG, "CHROUT", "address", "Write a byte");
    loaded.userLabels.addLabel(described);

    const rows = analyze(loaded, { annotations: false }).rows;
    const here = rows.filter((r) => r.address === ORG);
    const comment = here.findIndex((r) => r.kind === "comment" && r.text.includes("Write a byte"));
    const label = here.findIndex((r) => r.kind === "label");
    expect(comment).toBeGreaterThanOrEqual(0);
    expect(comment).toBeLessThan(label);
  });

  it("says nothing where the name has no row", () => {
    // Nothing supplies $FFD2 in an ordinary game, so there is no row to hang it
    // on — which is exactly why this is a description on the label rather than
    // a Comment at the address.
    const loaded = project([0xea, 0x60]);
    loaded.userLabels.addLabel(
      createPlatformLabel("lbl_far", 0xffd2, "CHROUT", "address", "Write a byte")
    );
    const rows = analyze(loaded, { annotations: false }).rows;
    expect(rows.some((r) => r.text.includes("Write a byte"))).toBe(false);
  });
});

describe("a region that holds a picture", () => {
  /** Two glyphs: a solid block, then a vertical bar. */
  const bytes = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, ...new Array(8).fill(0x18)];
  const charset = (view = "char:2") =>
    project(bytes, { regions: [{ start: ORG, end: ORG + 16, kind: "bitmap", name: "Glyphs", view }] });

  it("draws the bytes instead of listing them", () => {
    const rows = analyze(charset()).rows.filter((r) => r.kind === "bitmap");
    // Eight scanlines, one per pixel row of an 8x8 cell.
    expect(rows).toHaveLength(8);
    // The solid glyph on the left, the bar on the right.
    expect(rows[0].text).toContain("@@@@@@@@@@@@@@@@");
    // And no hex column: this row is a picture, not a dump.
    expect(rows.every((r) => !r.text.includes("|"))).toBe(true);
  });

  it("carries the address on every line, as a multi-line comment does", () => {
    const rows = analyze(charset()).rows.filter((r) => r.kind === "bitmap");
    expect(rows.every((r) => r.address === ORG)).toBe(true);
  });

  it("still draws when the view says nothing useful", () => {
    // An unreadable view must not stop the region rendering — the bytes are
    // still there and still worth looking at.
    expect(analyze(charset("nonsense")).rows.filter((r) => r.kind === "bitmap").length)
      .toBeGreaterThan(0);
  });
});

describe("a text region rendered by a decoder", () => {
  const bytes = [0x01, 0x02, 0x03, 0x04];
  const region = (view?: string) =>
    project(bytes, {
      regions: [{ start: ORG, end: ORG + 4, kind: "text", name: "Message", view }],
    });

  it("shows what the decoder returned", () => {
    // A program with its own font is the ordinary case here, and none of the
    // three built-in encodings can read one — declaring such a span `text`
    // produced confident nonsense, which is the failure ruled out everywhere
    // else in this project.
    const rows = analyze(region("snippet:dec_a"), {
      renderText: (id, run) =>
        id === "dec_a" ? [run.map((b) => "ABCD"[b - 1] ?? "?").join("")] : undefined,
    }).rows;
    expect(rows.find((r) => r.kind === "text")?.text).toContain('.TEXT "ABCD"');
  });

  it("falls back to the declared encoding when the decoder produces nothing", () => {
    // A broken decoder should make a listing plainer, never absent.
    const rows = analyze(region("snippet:dec_a"), { renderText: () => undefined }).rows;
    expect(rows.find((r) => r.kind === "text")?.text).toContain(".TEXT");
  });

  it("falls back when no renderer was supplied at all", () => {
    // The CLI and the browser both build rows; neither should have to know
    // about decoders to render a listing.
    const rows = analyze(region("snippet:dec_a")).rows;
    expect(rows.find((r) => r.kind === "text")?.text).toContain(".TEXT");
  });

  it("does not consult a decoder for a region that does not name one", () => {
    let asked = false;
    analyze(region(), { renderText: () => ((asked = true), ["x"]) });
    expect(asked).toBe(false);
  });
});
