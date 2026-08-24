import { describe, it, expect } from "vitest";
import { upsertLabel, deleteLabel, normalizeProjectText } from "./serialize.js";
import { parseProject } from "./project.js";

/**
 * A project in the house style: nested layers, one entry per line, and blank
 * lines grouping related labels. The grouping is the thing most at risk from a
 * careless write, so it appears in nearly every case below.
 */
const PROJECT = `{
  "name": "Test",
  "layers": [
    {
      "type": "symbols",
      "name": "syms",
      "labels": [
        { "address": "$02", "name": "playerX" },
        { "address": "$03", "name": "playerY" },

        { "address": "$D020", "name": "BORDER" }
      ]
    },
    {
      "type": "prg",
      "path": "game.prg",
      "labels": [
        { "address": "$8000", "name": "Start", "type": "function" },
        { "address": "$8100", "name": "Loop" },
        { "address": "$8200", "name": "Done" }
      ]
    }
  ],
  "entryPoints": ["$8000"]
}
`;

const linesOf = (s: string) => s.split("\n");
/**
 * Lines added and removed, ignoring position.
 *
 * Not a positional comparison: deleting one line shifts every line after it,
 * which would report the whole tail as changed.
 */
const diffSize = (before: string, after: string) => {
  const a = linesOf(before);
  const b = linesOf(after);
  return (
    a.filter((l) => !b.includes(l)).length + b.filter((l) => !a.includes(l)).length
  );
};

/** Blank lines survive an edit — the grouping the house style depends on. */
const blankCount = (s: string) => linesOf(s).filter((l) => l.trim() === "").length;

describe("upsertLabel", () => {
  it("renames in place, changing exactly one line", () => {
    const out = upsertLabel(PROJECT, 0x8100, "MainLoop", undefined, 1);

    // One line out, one line in: a rename, not a reformat.
    expect(diffSize(PROJECT, out)).toBe(2);
    expect(out).toContain(`{ "address": "$8100", "name": "MainLoop" }`);
    expect(out).not.toContain(`"name": "Loop"`);
  });

  it("preserves the blank lines that group labels", () => {
    // The whole reason this edits text rather than re-serialising JSON.
    const out = upsertLabel(PROJECT, 0x02, "shipX", undefined, 0);

    expect(blankCount(out)).toBe(blankCount(PROJECT));
  });

  it("writes into the layer it is told to, not the first one found", () => {
    // Both layers have a "labels" array; a naive scan would hit the symbol one.
    const out = upsertLabel(PROJECT, 0x8300, "Extra", undefined, 1);
    const prgStart = out.indexOf(`"path": "game.prg"`);

    expect(out.indexOf(`"name": "Extra"`)).toBeGreaterThan(prgStart);
  });

  it("inserts a new label in address order", () => {
    const out = upsertLabel(PROJECT, 0x8150, "Middle", undefined, 1);
    const names = [...out.matchAll(/"name": "(\w+)"/g)].map((m) => m[1]);

    expect(names.indexOf("Middle")).toBeGreaterThan(names.indexOf("Loop"));
    expect(names.indexOf("Middle")).toBeLessThan(names.indexOf("Done"));
  });

  it("appends when the new address is past the end", () => {
    const out = upsertLabel(PROJECT, 0x8900, "Last", undefined, 1);

    expect(parseProject(out).layers[1].labels!.at(-1)!.name).toBe("Last");
  });

  it("records the default type by absence rather than writing it out", () => {
    const typed = upsertLabel(PROJECT, 0x8100, "Loop", "function", 1);
    expect(typed).toContain(`"name": "Loop", "type": "function"`);

    const cleared = upsertLabel(typed, 0x8100, "Loop", "address", 1);
    expect(cleared).toContain(`{ "address": "$8100", "name": "Loop" }`);
    expect(cleared).not.toContain(`"type": "address"`);
  });

  it("round-trips a type change back to the original text", () => {
    const there = upsertLabel(PROJECT, 0x8100, "Loop", "function", 1);
    const back = upsertLabel(there, 0x8100, "Loop", "address", 1);

    expect(back).toBe(PROJECT);
  });

  it("returns text that still parses", () => {
    const out = upsertLabel(PROJECT, 0x8400, "New", "code", 1);
    expect(() => parseProject(out)).not.toThrow();
  });

  it("refuses a layer index that does not exist", () => {
    expect(() => upsertLabel(PROJECT, 0x8000, "X", undefined, 9)).toThrow(/No layer/);
  });
});

describe("deleteLabel", () => {
  it("removes one line and leaves the grouping intact", () => {
    const out = deleteLabel(PROJECT, 0x8100, 1);

    expect(diffSize(PROJECT, out)).toBe(1);
    expect(linesOf(out).length).toBe(linesOf(PROJECT).length - 1);
    expect(out).not.toContain(`"name": "Loop"`);
    expect(blankCount(out)).toBe(blankCount(PROJECT));
  });

  it("fixes the trailing comma when the last entry goes", () => {
    const out = deleteLabel(PROJECT, 0x8200, 1);

    expect(() => parseProject(out)).not.toThrow();
    expect(parseProject(out).layers[1].labels!.map((l) => l.name)).toEqual([
      "Start",
      "Loop",
    ]);
  });

  it("leaves the text alone when the address is not there", () => {
    expect(deleteLabel(PROJECT, 0x9999, 1)).toBe(PROJECT);
  });

  it("round-trips with upsert", () => {
    const added = upsertLabel(PROJECT, 0x8400, "Temp", undefined, 1);
    expect(deleteLabel(added, 0x8400, 1)).toBe(PROJECT);
  });
});

describe("normalizeProjectText", () => {
  it("ensures a trailing newline without doubling one", () => {
    expect(normalizeProjectText("{}")).toBe("{}\n");
    expect(normalizeProjectText("{}\n")).toBe("{}\n");
  });
});
