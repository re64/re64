/**
 * Converting a project written with labels and regions into one written with
 * claims.
 *
 * **This is not `adapt.ts`.** That file says so itself — *"a translation rather
 * than a migration… Nothing writes back through it"* — and it deliberately does
 * not auto-root, because it exists to measure the old model against the new one
 * rather than to replace it. Using it as the migration would drop every span
 * nothing references, which on the project three agents built is 24 claims.
 *
 * Four rules, and the last two are the ones that would be missed:
 *
 * - **A `code` region becomes a root with no extent.** Its span never meant
 *   anything: for the walk, `code` was indistinguishable from `unknown` and from
 *   silence, and the only effect its start had was to seed the queue.
 * - **An `unknown` region becomes nothing.** Absence of a claim is what it always
 *   meant. There are none in any project here, so this rule is free.
 * - **Every interpretation claim is rooted.** Inclusion becomes reachability, so a
 *   span nothing names would stop rendering. Rooting them preserves exactly
 *   today's output and leaves the discipline for new work.
 * - **Ids are carried across verbatim**, prefix and all: `rgn_1jmk1o` becomes
 *   claim `rgn_1jmk1o`. Minting fresh ones would dangle every `primaryLabels`
 *   entry, every `labelUses` binding and every inverse in the `ops` history, and
 *   two peers migrating the same file independently would produce disjoint sets.
 *
 * A region's `comment` becomes a real `Comment`, not a claim `description`. Those
 * are different things and this project defends the distinction at length: a
 * description is *what a name means on this machine*, where a comment is what
 * somebody wrote about an address *in this project*. The row builder already
 * renders a region's comment as comment rows at its start, so a `before` comment
 * there reproduces the rendering exactly.
 */

import { Project, ProjectClaim, parseProjectAddress } from "../project/project.js";
import { LabelType } from "../memory/label-type.js";
import { RegionKind } from "../memory/region.js";
import { RootKind } from "./model.js";
import { derivedId } from "../project/identity.js";

/** The old label types, minus `address`, which was only ever "just a name". */
const ROOT_FOR_LABEL: Partial<Record<LabelType, RootKind>> = {
  entry: "entry",
  function: "routine",
  code: "location",
};

const IS_FOR_KIND: Partial<Record<RegionKind, ProjectClaim["is"]>> = {
  data: "data",
  text: "text",
  bitmap: "bitmap",
  jumptable: "jumptable",
};

export interface MigrationStats {
  readonly fromLabels: number;
  readonly fromRegions: number;
  /** `code` regions that became rootless points rather than spans. */
  readonly codeRegionsRooted: number;
  /** `unknown` regions that produced no claim at all. */
  readonly unknownRegionsDropped: number;
  /** Interpretation claims given a `data` root so they keep rendering. */
  readonly autoRooted: number;
  /** Region comments turned into real comments. */
  readonly commentsMoved: number;
}

const hex = (n: number) => "$" + n.toString(16).toUpperCase().padStart(4, "0");

/**
 * The same project, written with claims.
 *
 * Layers keep their comments, constant uses and label uses; they lose their
 * labels and regions, which move to the project-level `claims` root.
 */
export function migrateToClaims(project: Project): {
  project: Project;
  stats: MigrationStats;
} {
  const claims: ProjectClaim[] = [];
  let fromLabels = 0;
  let fromRegions = 0;
  let codeRegionsRooted = 0;
  let unknownRegionsDropped = 0;
  let autoRooted = 0;
  let commentsMoved = 0;

  const layers = project.layers.map((layer) => {
    const { labels, regions, comments, ...rest } = layer;
    const moved = [...(comments ?? [])];

    for (const label of labels ?? []) {
      const at = parseProjectAddress(label.address);
      claims.push({
        // Verbatim. See the note above: a fresh id dangles everything that
        // points at this one.
        id: label.id ?? derivedId("lbl", String(at), label.name),
        at: hex(at),
        ...(label.extent !== undefined ? { extent: label.extent } : {}),
        name: label.name,
        ...(ROOT_FOR_LABEL[label.type ?? "address"]
          ? { root: ROOT_FOR_LABEL[label.type ?? "address"] }
          : {}),
        author: "project",
        source: "user",
      });
      fromLabels++;

      // The dead field on a label, which was stored and rendered nowhere. If any
      // project carries one it becomes a real comment rather than vanishing.
      if (label.comment) {
        moved.push({
          id: derivedId("cmt", label.id ?? "", "label-comment"),
          address: hex(at),
          placement: "before",
          text: label.comment,
        });
        commentsMoved++;
      }
    }

    for (const region of regions ?? []) {
      const start = parseProjectAddress(region.start);
      const end = parseProjectAddress(region.end);
      const id = region.id ?? derivedId("rgn", String(start), String(end));

      if (region.comment) {
        moved.push({
          id: derivedId("cmt", id, "region-comment"),
          address: hex(start),
          placement: "before",
          text: region.comment,
        });
        commentsMoved++;
      }

      if (region.kind === "unknown") {
        unknownRegionsDropped++;
        continue;
      }

      if (region.kind === "code") {
        // No extent: the span said nothing, only the start did.
        claims.push({
          id,
          at: hex(start),
          ...(region.name !== undefined ? { name: region.name } : {}),
          root: "entry",
          author: "project",
          source: "user",
        });
        codeRegionsRooted++;
        fromRegions++;
        continue;
      }

      claims.push({
        id,
        at: hex(start),
        extent: end - start,
        ...(region.name !== undefined ? { name: region.name } : {}),
        is: IS_FOR_KIND[region.kind],
        ...(region.encoding !== undefined ? { encoding: region.encoding } : {}),
        ...(region.view !== undefined ? { view: region.view } : {}),
        // Rooted so it still renders once inclusion is reachability.
        root: "data",
        author: "project",
        source: "user",
      });
      autoRooted++;
      fromRegions++;
    }

    return { ...rest, ...(moved.length ? { comments: moved } : {}) };
  });

  return {
    project: {
      ...project,
      layers,
      ...(claims.length ? { claims: [...(project.claims ?? []), ...claims] } : {}),
    },
    stats: {
      fromLabels,
      fromRegions,
      codeRegionsRooted,
      unknownRegionsDropped,
      autoRooted,
      commentsMoved,
    },
  };
}

/** True for a project still written with labels and regions. */
export function needsMigration(project: Project): boolean {
  return project.layers.some((l) => l.labels?.length || l.regions?.length);
}
