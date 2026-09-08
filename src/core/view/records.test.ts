import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { analyze } from "./rows.js";
import { formatRows } from "./format.js";
import { loadProjectFile } from "../../node-files.js";
import { LoadedProject } from "../project/loader.js";
import { parseProject } from "../project/project.js";

/**
 * Field rows, against the layout a reader actually established.
 *
 * `zoneDataTable` in Revenge of the Mutant Camels is 8,400 bytes that
 * experiment 7 established as **42 records of exactly 200** — 152 of template
 * plus 8 scalars plus a 40-character name at `+$A0`, in screen codes, verified
 * three ways. The model could hold exactly one of those fields, as 42 `text`
 * claims, and the other 80% became one `data` blob with the finding living in
 * prose.
 *
 * So this is the acceptance test for the whole struct slice: the same bytes,
 * the same reader's conclusion, and a listing that can now say it.
 */
const PROJECT = "experiments/07-scale/run/final.re64";

/**
 * The project with a `Zone` declared and `$6700` claimed as an array of them.
 *
 * Written to disk and loaded through the real path rather than assembled in
 * memory: the point is that a `.re64` can *say* this, and a fixture that
 * bypassed the parser would not test that at all.
 */
const SCRATCH = "experiments/07-scale/run/.records-test.re64";

function withZones(): LoadedProject {
  const declared = parseProject(readFileSync(PROJECT, "utf-8"));
  const project = {
    ...declared,
    types: [
      {
        id: "typ_zone",
        name: "Zone",
        size: 200,
        fields: {
          // Two of the nineteen. The rest of the record stays a hole, which is
          // the point of declaring `size` rather than deriving it: a reader who
          // has proved two fields has said something true, and inventing
          // padding for the rest would be the cop-out this replaces.
          "0": { name: "template", type: "u8" },
          "160": { name: "name", type: "char(40,screen)" },
        },
      },
    ],
    claims: [
      ...(declared.claims ?? []).filter(
        (c) => Number(String(c.at).replace("$", "0x")) !== 0x6700
      ),
      {
        id: "clm_zones",
        at: "$6700",
        extent: 8400,
        name: "zoneDataTable",
        is: "record" as const,
        typeId: "typ_zone",
        root: "data" as const,
        origin: "user" as const,
      },
    ],
  };
  writeFileSync(SCRATCH, JSON.stringify(project, null, 1), "utf-8");
  try {
    return loadProjectFile(SCRATCH);
  } finally {
    rmSync(SCRATCH, { force: true });
  }
}

describe("an 8,400-byte table, as 42 records", () => {
  const rows = () => {
    const loaded = withZones();
    return analyze(loaded, { annotations: false }).rows;
  };

  it("shows records rather than 8,400 bytes of hex", () => {
    const fields = rows().filter((r) => r.kind === "field");
    expect(fields.length).toBeGreaterThan(0);
  });

  it("derives 42 from the extent and the size, storing the count nowhere", () => {
    // 8400 / 200. A stored count would be a third fact that can disagree with
    // the other two.
    const headers = rows().filter((r) => r.kind === "field" && r.text.includes("Zone["));
    expect(headers.length).toBe(42);
    expect(headers[0].text).toContain("Zone[0]");
    expect(headers[41].text).toContain("Zone[41]");
  });

  it("decodes the name at +$A0 as screen codes", () => {
    const named = rows().filter((r) => r.kind === "field" && r.text.includes("name:"));
    expect(named[0].text).toContain("ASSORTED EASY AVIAN ALIENS");
    // The last record's name sits at $87A8 and lands inside the claim.
    expect(named[41].text.startsWith("87A8")).toBe(true);
    expect(named[41].text).toContain("REVENGE OF THE MUTANT MUTANT CAMELIDS");
  });

  it("gives every field its own address, so every one is navigable", () => {
    // Unlike bitmap art, which repeats one address per scanline: a field is a
    // place in memory and a reader clicking it means to go there.
    //
    // The record header shares its address with the field at `+$00`, which is
    // the same arrangement a label row has with the instruction under it —
    // `push` indexes first-wins, so navigating to $6700 lands on the header.
    const fields = rows().filter((r) => r.kind === "field" && !r.text.includes("Zone["));
    const first = fields.slice(0, 6);
    expect(new Set(first.map((r) => r.address)).size).toBe(first.length);
    expect(first[0].address).toBe(0x6700);
  });

  it("leaves the hole between the two fields as a hole", () => {
    // $01 to $9F is unexplained and says so, rather than being covered by a
    // padding field nobody proved.
    const holes = rows().filter((r) => r.kind === "field" && r.text.includes(".BYTE"));
    expect(holes.length).toBeGreaterThan(0);
  });

  it("starts every row with a four-character address column", () => {
    // What `buildDecorations` assumes of every row kind.
    for (const row of rows().filter((r) => r.kind === "field")) {
      expect(row.text).toMatch(/^[0-9A-F]{4} {2}/);
    }
  });

  it("renders the whole span, leaving nothing behind", () => {
    // The loop-foot guard fires on a strategy that consumes no bytes, and warns
    // rather than spinning. Nothing should have tripped it.
    const loaded = withZones();
    const result = analyze(loaded, { annotations: false });
    expect(result.warnings.filter((w) => w.includes("could not render"))).toEqual([]);
    expect(formatRows(result.rows, result.arrows).length).toBeGreaterThan(0);
  });
});
