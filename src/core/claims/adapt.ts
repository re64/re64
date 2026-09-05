/**
 * Reading an existing project as claims.
 *
 * A translation rather than a migration: it exists so the redesign can be
 * measured against real projects — Gridrunner, the KERNAL, what the agents built
 * — instead of against an argument. Nothing writes back through it.
 *
 * Two rules do the reducing, and both are the design in one line each:
 *
 * - **A `code` region becomes a root with no extent.** Its span never meant
 *   anything: for the walk, `code` was indistinguishable from `unknown` and from
 *   silence, and the only effect its *start* had was to seed the queue.
 * - **An `unknown` region becomes nothing at all.** "Not yet analysed" is the
 *   absence of a claim, and spelling absence as a value is what made
 *   "unexplained" a kind to filter for rather than a question about the set.
 */

import { LoadedProject } from "../project/loader.js";
import { Label, LabelType } from "../memory/label.js";
import { Region } from "../memory/region.js";
import { Claim, Interpretation, Provenance, RootKind } from "./model.js";

/** The old label types, minus the one that was only ever "just a name". */
const ROOT_FOR_LABEL: Partial<Record<LabelType, RootKind>> = {
  entry: "entry",
  function: "routine",
  code: "location",
};

function provenanceOf(label: Label): Provenance {
  const kind = label.source.kind;
  return {
    author: kind === "user" ? "project" : kind,
    source: kind === "region" ? "auto" : kind,
  };
}

function interpretationOf(region: Region): Interpretation | undefined {
  switch (region.kind) {
    case "data":
      return { is: "data" };
    case "text":
      return { is: "text", encoding: region.encoding };
    case "bitmap":
      return { is: "bitmap", view: region.view };
    case "jumptable":
      return { is: "jumptable" };
    // `code` is a root, not an interpretation; `unknown` is no claim at all.
    case "code":
    case "unknown":
      return undefined;
  }
}

export interface AdaptStats {
  readonly fromLabels: number;
  readonly fromRegions: number;
  /** `code` regions that became rootless points rather than spans. */
  readonly codeRegionsDemoted: number;
  /** `unknown` regions that produced no claim at all. */
  readonly unknownRegionsDropped: number;
}

export function claimsFromProject(loaded: LoadedProject): {
  claims: Claim[];
  stats: AdaptStats;
} {
  const claims: Claim[] = [];
  let codeRegionsDemoted = 0;
  let unknownRegionsDropped = 0;

  for (const label of loaded.userLabels.getAllLabels()) {
    claims.push({
      id: label.id,
      at: label.address,
      extent: label.extent,
      name: label.name,
      root: ROOT_FOR_LABEL[label.type],
      description: label.description,
      by: provenanceOf(label),
    });
  }
  const fromLabels = claims.length;

  for (const region of loaded.map.getAllRegions()) {
    if (region.kind === "unknown") {
      unknownRegionsDropped++;
      continue;
    }
    const says = interpretationOf(region);
    if (says === undefined) {
      // A code region: its span said nothing, only its start did.
      codeRegionsDemoted++;
      claims.push({
        id: region.id,
        at: region.start,
        name: region.name,
        root: "entry",
        description: region.comment,
        by: { author: "project", source: "user" },
      });
      continue;
    }
    claims.push({
      id: region.id,
      at: region.start,
      extent: region.end - region.start,
      name: region.name,
      says,
      description: region.comment,
      by: { author: "project", source: "user" },
    });
  }

  return {
    claims,
    stats: {
      fromLabels,
      fromRegions: claims.length - fromLabels,
      codeRegionsDemoted,
      unknownRegionsDropped,
    },
  };
}
