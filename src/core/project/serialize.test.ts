import { describe, it, expect } from "vitest";
import { upsertLabel, deleteLabel, migrateIds, normalizeProjectText } from "./serialize.js";
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
      "id": "lay_aaa",
      "type": "symbols",
      "name": "syms",
      "labels": [
        { "id": "lbl_aaa001", "address": "$02", "name": "playerX" },
        { "id": "lbl_aaa002", "address": "$03", "name": "playerY" },

        { "id": "lbl_aaa003", "address": "$D020", "name": "BORDER" }
      ]
    },
    {
      "id": "lay_bbb",
      "type": "prg",
      "path": "game.prg",
      "labels": [
        { "id": "lbl_bbb001", "address": "$8000", "name": "Start", "type": "function" },
        { "id": "lbl_bbb002", "address": "$8100", "name": "Loop" },
        { "id": "lbl_bbb003", "address": "$8200", "name": "Done" }
      ]
    }
  ],
  "entryPoints": ["$8000"]
}
`;

/** A file written before ids existed. */
const LEGACY = `{
  "layers": [
    {
      "type": "prg",
      "path": "game.prg",
      "labels": [
        { "address": "$8000", "name": "Start" },

        { "address": "$8100", "name": "Loop" }
      ]
    }
  ]
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
    const out = upsertLabel(PROJECT, "lbl_t8100", 0x8100, "MainLoop", undefined, 1);

    // One line out, one line in: a rename, not a reformat.
    expect(diffSize(PROJECT, out)).toBe(2);
    expect(out).toContain(`{ "id": "lbl_bbb002", "address": "$8100", "name": "MainLoop" }`);
    expect(out).not.toContain(`"name": "Loop"`);
  });

  it("preserves the blank lines that group labels", () => {
    // The whole reason this edits text rather than re-serialising JSON.
    const out = upsertLabel(PROJECT, "lbl_t2", 0x02, "shipX", undefined, 0);

    expect(blankCount(out)).toBe(blankCount(PROJECT));
  });

  it("writes into the layer it is told to, not the first one found", () => {
    // Both layers have a "labels" array; a naive scan would hit the symbol one.
    const out = upsertLabel(PROJECT, "lbl_t8300", 0x8300, "Extra", undefined, 1);
    const prgStart = out.indexOf(`"path": "game.prg"`);

    expect(out.indexOf(`"name": "Extra"`)).toBeGreaterThan(prgStart);
  });

  it("inserts a new label in address order", () => {
    const out = upsertLabel(PROJECT, "lbl_t8150", 0x8150, "Middle", undefined, 1);
    const names = [...out.matchAll(/"name": "(\w+)"/g)].map((m) => m[1]);

    expect(names.indexOf("Middle")).toBeGreaterThan(names.indexOf("Loop"));
    expect(names.indexOf("Middle")).toBeLessThan(names.indexOf("Done"));
  });

  it("appends when the new address is past the end", () => {
    const out = upsertLabel(PROJECT, "lbl_t8900", 0x8900, "Last", undefined, 1);

    expect(parseProject(out).layers[1].labels!.at(-1)!.name).toBe("Last");
  });

  it("records the default type by absence rather than writing it out", () => {
    const typed = upsertLabel(PROJECT, "lbl_t8100", 0x8100, "Loop", "function", 1);
    expect(typed).toContain(`"name": "Loop", "type": "function"`);

    const cleared = upsertLabel(typed, "lbl_t8100", 0x8100, "Loop", "address", 1);
    expect(cleared).toContain(`{ "id": "lbl_bbb002", "address": "$8100", "name": "Loop" }`);
    expect(cleared).not.toContain(`"type": "address"`);
  });

  it("round-trips a type change back to the original text", () => {
    const there = upsertLabel(PROJECT, "lbl_t8100", 0x8100, "Loop", "function", 1);
    const back = upsertLabel(there, "lbl_t8100", 0x8100, "Loop", "address", 1);

    expect(back).toBe(PROJECT);
  });

  it("returns text that still parses", () => {
    const out = upsertLabel(PROJECT, "lbl_t8400", 0x8400, "New", "code", 1);
    expect(() => parseProject(out)).not.toThrow();
  });

  it("refuses a layer index that does not exist", () => {
    expect(() => upsertLabel(PROJECT, "lbl_t8000", 0x8000, "X", undefined, 9)).toThrow(/No layer/);
  });
});

describe("upsertLabel on a file without ids", () => {
  it("adds an id to the line it touches, leaving the rest alone", () => {
    const out = upsertLabel(LEGACY, "lbl_new", 0x8100, "MainLoop", undefined, 0);

    expect(out).toContain(`{ "id": "lbl_new", "address": "$8100", "name": "MainLoop" }`);
    // Untouched entries stay as they were: migration is per-edit, not wholesale.
    expect(out).toContain(`{ "address": "$8000", "name": "Start" }`);
    expect(blankCount(out)).toBe(blankCount(LEGACY));
  });

  it("still parses as a project", () => {
    expect(() => parseProject(upsertLabel(LEGACY, "lbl_new", 0x8100, "X", undefined, 0))).not.toThrow();
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
    const added = upsertLabel(PROJECT, "lbl_t8400", 0x8400, "Temp", undefined, 1);
    expect(deleteLabel(added, 0x8400, 1)).toBe(PROJECT);
  });
});

describe("upsertLabel into a layer with no labels array", () => {
  it("writes a well-formed address, not a bare number", () => {
    // This path reformats the whole file, so it is exercised rarely - and it
    // silently produced "8100" instead of "$8100" until a round-trip caught it.
    const bare = JSON.stringify({ layers: [{ type: "prg", path: "game.prg" }] });
    const out = upsertLabel(bare, "lbl_z", 0x8100, "New", "function", 0);

    expect(out).toContain(`"address": "$8100"`);
    expect(out).toContain(`"id": "lbl_z"`);
    const parsed = parseProject(out);
    expect(parsed.layers[0].labels).toEqual([
      { id: "lbl_z", address: "$8100", name: "New", type: "function" },
    ]);
  });
});

describe("migrateIds", () => {
  /** Deterministic minting, so assertions can name the ids. */
  const mint = () => {
    let n = 0;
    return (prefix: "lbl" | "rgn" | "lay") => `${prefix}_m${++n}`;
  };

  it("gives every layer, label, and region an id", () => {
    const project = parseProject(migrateIds(LEGACY, mint()));

    expect(project.layers[0].id).toBeDefined();
    expect(project.layers[0].labels!.every((l) => l.id !== undefined)).toBe(true);
  });

  it("preserves every line's content, adding only ids", () => {
    const stripped = migrateIds(LEGACY, mint())
      .split("\n")
      .filter((l) => !/^\s*"id": "[^"]*",$/.test(l))
      .map((l) => l.replace(/"id": "[^"]*", /, ""))
      .join("\n");

    expect(stripped).toBe(LEGACY);
  });

  it("keeps the blank lines that group labels", () => {
    expect(blankCount(migrateIds(LEGACY, mint()))).toBe(blankCount(LEGACY));
  });

  it("is idempotent - a second run changes nothing", () => {
    // A layer id lives on the line after its brace, so checking the brace
    // alone would miss it and insert a duplicate.
    const once = migrateIds(LEGACY, mint());
    expect(migrateIds(once, mint())).toBe(once);
  });

  it("leaves an already-migrated file alone", () => {
    expect(migrateIds(PROJECT, mint())).toBe(PROJECT);
  });
});

describe("normalizeProjectText", () => {
  it("ensures a trailing newline without doubling one", () => {
    expect(normalizeProjectText("{}")).toBe("{}\n");
    expect(normalizeProjectText("{}\n")).toBe("{}\n");
  });
});
