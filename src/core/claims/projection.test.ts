import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { migrateToClaims } from "./migrate.js";
import { parseProject } from "../project/project.js";
import { buildMemoryMap } from "../project/loader.js";
import { makeFileLoader } from "../project/file-source.js";
import { nodeFileBytes } from "../../node-files.js";
import { analyze, formatRows } from "../index.js";

/**
 * The claims path and the legacy path must render the same listing.
 *
 * This is the assertion the whole redesign turns on, and the golden hash cannot
 * make it: `gridrunner.re64` is still written with labels and regions, so
 * `OUTPUT_SHA1` proves only that adding a claim projection changed nothing for a
 * project that has no claims. What matters is that the *same* project, migrated,
 * renders identically — that a claim carries everything a label and a region
 * carried between them.
 *
 * Migrated in memory rather than on disk, so the reference file stays as it is
 * until the write path cuts over and there is one form rather than two.
 */

const PROJECT = "assets/gridrunner/gridrunner.re64";

const listingOf = (project: ReturnType<typeof parseProject>) => {
  const loaded = buildMemoryMap(
    project,
    makeFileLoader(nodeFileBytes("assets/gridrunner"))
  );
  const result = analyze(loaded, { annotations: false });
  return {
    text: formatRows(result.rows, result.arrows).join("\n"),
    stats: result.stats,
  };
};

describe("a migrated project renders identically", () => {
  const legacy = listingOf(parseProject(readFileSync(PROJECT, "utf8")));
  const migrated = listingOf(migrateToClaims(parseProject(readFileSync(PROJECT, "utf8"))).project);

  it("byte for byte", () => {
    const sha = (text: string) => createHash("sha1").update(text).digest("hex");
    // eslint-disable-next-line no-console
    console.log(`legacy ${sha(legacy.text)}\nclaims ${sha(migrated.text)}`);
    expect(sha(migrated.text)).toBe(sha(legacy.text));
  });

  it("with the same counts", () => {
    expect(migrated.stats).toEqual(legacy.stats);
  });

  it("and the projection actually ran", () => {
    // Guards against the whole thing passing because nothing happened: the
    // migrated project must have no labels or regions left on any layer, and the
    // map must be carrying names that came from claims.
    const project = migrateToClaims(parseProject(readFileSync(PROJECT, "utf8"))).project;
    expect(project.layers.some((l) => l.labels?.length || l.regions?.length)).toBe(false);
    expect(project.claims!.length).toBe(118);

    const loaded = buildMemoryMap(
      project,
      makeFileLoader(nodeFileBytes("assets/gridrunner"))
    );
    expect(loaded.map.claimLabels.length).toBeGreaterThan(0);
    // And the regions reached the layer that supplies their bytes, or
    // `getKindAt` would not see them.
    expect(loaded.map.getKindAt(0x8080)).toBe("text");
    expect(loaded.map.getKindAt(0x8e00)).toBe("data");
  });
});
