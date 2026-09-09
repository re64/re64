import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { loadProjectFile } from "../../node-files.js";
import { analyzeProgram } from "./program.js";
import { parseProject } from "../project/project.js";

/**
 * Three checks about record layouts, and the rule they have to satisfy.
 *
 * **Zero is the resting state.** A list that always has entries gets ignored,
 * and the one entry that mattered gets ignored with it — which is why
 * `find_undecoded` counts incompleteness and lives nowhere near here.
 */
const SCRATCH = "experiments/07-scale/run/.hygiene-test.re64";
const SOURCE = "experiments/07-scale/run/final.re64";

function withProject(mutate: (p: ReturnType<typeof parseProject>) => void) {
  const project = parseProject(readFileSync(SOURCE, "utf-8"));
  mutate(project);
  writeFileSync(SCRATCH, JSON.stringify(project, null, 1), "utf-8");
  try {
    return analyzeProgram(loadProjectFile(SCRATCH, "runtime")).hygiene;
  } finally {
    rmSync(SCRATCH, { force: true });
  }
}

const zone = (fields: Record<string, { name: string; type: string }>) => ({
  id: "typ_zone",
  name: "Zone",
  size: 200,
  fields,
});

describe("what a record layout can be wrong about", () => {
  it("says nothing about a project that declares no types", () => {
    // The reference project has none, so every one of these must be silent on
    // it. A check that fires on a healthy project is not a check.
    const found = withProject(() => {});
    expect(found.filter((f) => f.kind.startsWith("type."))).toEqual([]);
  });

  it("reports a claim whose layout is not declared", () => {
    const found = withProject((p) => {
      p.claims = [
        ...(p.claims ?? []),
        {
          id: "clm_x",
          at: "$6700",
          extent: 400,
          is: "record",
          typeId: "typ_gone",
          origin: "user",
        },
      ];
    });
    // It renders its bytes rather than breaking, which is right and is also
    // invisible — so this is the one place it becomes visible.
    expect(found.filter((f) => f.kind === "type.missing")).toHaveLength(1);
  });

  it("reports an extent that leaves a partial record at the end", () => {
    const found = withProject((p) => {
      p.types = [zone({ "0": { name: "kind", type: "u8" } })];
      p.claims = [
        ...(p.claims ?? []),
        {
          id: "clm_x",
          at: "$6700",
          extent: 450,
          is: "record",
          typeId: "typ_zone",
          origin: "user",
        },
      ];
    });
    const [finding] = found.filter((f) => f.kind === "type.extentMismatch");
    expect(finding).toBeDefined();
    expect(finding.message).toContain("50 bytes in a partial record");
  });

  it("reports the 42 claims the layout now also describes, and removes none", () => {
    // The real thing, and the reason this check exists. Before types, the one
    // field of a 200-byte record the model could express was the name at +$A0
    // — so this project holds exactly 42 `text` claims, one per record, which
    // is the reader's work as the old model forced them to write it.
    //
    // Declaring `Zone` does not invalidate any of it. They carry an author, so
    // they stay: silently deleting somebody's forty-two recovered claims is
    // what this redesign exists to stop, and a migration that removed them
    // would be a destructive operation built from an inference — the shape that
    // has bitten this project three times.
    const found = withProject((p) => {
      p.types = [zone({ "160": { name: "name", type: "char(40,screen)" } })];
      p.claims = [
        ...(p.claims ?? []),
        {
          id: "clm_arr",
          at: "$6700",
          extent: 8400,
          is: "record",
          typeId: "typ_zone",
          origin: "user",
        },
      ];
    });

    const redundant = found.filter((f) => f.kind === "type.redundantClaim");
    expect(redundant).toHaveLength(42);
    expect(redundant[0].message).toContain('describes as "name" at +$A0');
    expect(redundant[0].message).toContain("nothing has removed it");
  });
});
