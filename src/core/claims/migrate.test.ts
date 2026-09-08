import { describe, it, expect } from "vitest";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { migrateToClaims, needsMigration } from "./migrate.js";
import { parseProject, projectClaims } from "../project/project.js";
import { formatProject } from "../project/serialize.js";
import { compareClaims } from "./model.js";

/**
 * The migration, counted rather than asserted.
 *
 * Every `.re64` in the repository — the reference project plus what seven
 * experiment runs produced. The numbers are pinned because the rules are easy to
 * state and easy to get subtly wrong: a `code` region that keeps its extent, an
 * interpretation that loses its root, an id that gets minted fresh.
 */

function projectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) projectFiles(path, out);
    else if (entry.endsWith(".re64")) out.push(path);
  }
  return out;
}

const parsed = (path: string) => parseProject(readFileSync(path, "utf8"));

describe("migrating every project in the repository", () => {
  it("converts labels and regions, and counts what it did", () => {
    let labels = 0;
    let regions = 0;
    let code = 0;
    let unknown = 0;
    let rooted = 0;
    let files = 0;

    for (const path of projectFiles(".").sort()) {
      const { stats } = migrateToClaims(parsed(path));
      labels += stats.fromLabels;
      regions += stats.fromRegions;
      code += stats.codeRegionsRooted;
      unknown += stats.unknownRegionsDropped;
      rooted += stats.autoRooted;
      files++;
    }

    // eslint-disable-next-line no-console
    console.log(
      `${files} projects: ${labels} labels, ${regions} regions ` +
        `(${code} code -> rootless roots, ${rooted} auto-rooted, ${unknown} unknown dropped)`
    );

    // The design document's own table: 475 regions, 88 of them `code` (18%),
    // 0 `unknown`. Every region becomes exactly one claim or nothing.
    expect(code + rooted + unknown).toBe(475);
    expect(code).toBe(88);
    expect(unknown).toBe(0);
    expect(regions).toBe(code + rooted);
  });

  it("preserves every id verbatim", () => {
    // Minting fresh ids would dangle every primaryLabels entry, every labelUses
    // binding and every inverse in the ops history — and two peers migrating the
    // same file would produce disjoint claim sets.
    for (const path of projectFiles(".").sort()) {
      const before = parsed(path);
      const wanted = new Set<string>();
      for (const layer of before.layers) {
        for (const l of layer.labels ?? []) if (l.id) wanted.add(l.id);
        for (const r of layer.regions ?? []) if (r.id && r.kind !== "unknown") wanted.add(r.id);
      }

      const { project } = migrateToClaims(before);
      const got = new Set((project.claims ?? []).map((c) => c.id!));
      for (const id of wanted) {
        expect(got, `${path} lost id ${id}`).toContain(id);
      }
    }
  });

  it("leaves nothing needing migration, and is idempotent", () => {
    for (const path of projectFiles(".").sort()) {
      const once = migrateToClaims(parsed(path)).project;
      expect(needsMigration(once)).toBe(false);

      // Running it again must change nothing: `re64 migrate` on an already
      // migrated file is an ordinary thing to do by accident.
      const twice = migrateToClaims(once).project;
      expect(formatProject(twice)).toBe(formatProject(once));
    }
  });

  it("writes a file that parses, and keeps every primaryLabels target", () => {
    for (const path of projectFiles(".").sort()) {
      const { project } = migrateToClaims(parsed(path));
      const text = formatProject(project);
      const reparsed = parseProject(text);

      const ids = new Set((reparsed.claims ?? []).map((c) => c.id!));
      for (const labelId of Object.values(reparsed.primaryLabels ?? {})) {
        expect(ids, `${path}: primaryLabels points at ${labelId}`).toContain(labelId);
      }
    }
  });

  it("a code region keeps its start and loses its span", () => {
    const project = parseProject(`{
      "layers": [{ "id": "lay_a", "type": "prg", "path": "g.prg", "regions": [
        { "id": "rgn_c", "start": "$8000", "end": "$8100", "kind": "code", "name": "main" },
        { "id": "rgn_d", "start": "$8100", "end": "$8120", "kind": "data", "name": "table" },
        { "id": "rgn_u", "start": "$8200", "end": "$8300", "kind": "unknown" }
      ]}]
    }`);

    const { project: after } = migrateToClaims(project);
    const claims = after.claims ?? [];

    expect(claims).toHaveLength(2);
    expect(claims.find((c) => c.id === "rgn_c")).toEqual({
      id: "rgn_c",
      at: "$8000",
      name: "main",
      root: "entry",
      origin: "user",
    });
    // The data one keeps its span and gains a root, or it stops rendering.
    expect(claims.find((c) => c.id === "rgn_d")).toMatchObject({
      at: "$8100",
      extent: 0x20,
      is: "data",
      root: "data",
    });
    expect(claims.find((c) => c.id === "rgn_u")).toBeUndefined();
  });

  it("a region comment becomes a comment, not a description", () => {
    // Those are different things: a description is what a name means on this
    // machine, a comment is what somebody wrote about an address in this
    // project. The row builder already renders a region's comment at its start.
    const project = parseProject(`{
      "layers": [{ "id": "lay_a", "type": "prg", "path": "g.prg", "regions": [
        { "id": "rgn_1", "start": "$8100", "end": "$8120", "kind": "data", "comment": "the level table" }
      ]}]
    }`);

    const { project: after, stats } = migrateToClaims(project);
    expect(stats.commentsMoved).toBe(1);
    expect(after.layers[0].comments).toEqual([
      expect.objectContaining({ address: "$8100", placement: "before", text: "the level table" }),
    ]);
    expect(after.claims![0].description).toBeUndefined();
  });
});


/**
 * What happens to the names that used to be arbitrated by `LABEL_RANK`.
 *
 * The old model ranked a user label above a region-generated one, `4 > 3`, and
 * `Provenance.source` has no member where `region` sat — so the obvious reading
 * is that the claim model cannot express the ordering and something must be
 * added to it.
 *
 * Measuring says otherwise. `compareClaims` sorts by position, then **narrowest
 * span first**, and a label has no extent while a region has one — so the label
 * already wins, and for a better reason than rank did. `user > region` was
 * encoding *specificity*, not authority: a region-generated label names a span,
 * a user label names an address, and a name on one address is more specific than
 * a name on a span that merely starts there. That is the same "innermost wins"
 * rule the model already applies to nesting.
 *
 * Across all 24 projects there are 215 addresses carrying two named claims.
 * 205 resolve to what `LABEL_RANK` chose. The 10 that differ are all cases where
 * somebody declared a label with a span one or two bytes wider than a region —
 * `tuneVoice1` (76) against `shortTuneVoice1` (78), `moveHandlerTable` (6)
 * against `moveHandlerLo` (7) — near-synonyms for the same bytes, where neither
 * name is clearly right. One of them is region-against-region, which rank could
 * not arbitrate either and settled by id, arbitrarily.
 *
 * So the rule stands on its own and no provenance member is needed. Pinned here
 * because it is a decision rather than an accident, and because the reference
 * project is what the golden hash depends on.
 */
describe("which name wins where two claims share an address", () => {
  const winnerAt = (path: string) => {
    const claims = projectClaims(
      migrateToClaims(parsed(path)).project.claims
    ).filter((c) => c.name !== undefined);

    const byAddress = new Map<number, typeof claims>();
    for (const claim of claims) {
      const held = byAddress.get(claim.at);
      if (held) held.push(claim);
      else byAddress.set(claim.at, [claim]);
    }
    return byAddress;
  };

  it("the reference project resolves every collision to the label, as rank did", () => {
    // Eight addresses, and this is what protects OUTPUT_SHA1 through the
    // projection step: three of them carry genuinely different names.
    const byAddress = winnerAt("assets/gridrunner/gridrunner.re64");
    const contested = [...byAddress.entries()].filter(([, cs]) => cs.length > 1);

    expect(contested).toHaveLength(8);
    for (const [address, cs] of contested) {
      const winner = [...cs].sort(compareClaims)[0];
      expect(winner.id.startsWith("lbl_"), `$${address.toString(16)} chose ${winner.name}`).toBe(
        true
      );
    }
  });

  it("prefers the narrower claim, which is what rank was approximating", () => {
    const byAddress = winnerAt("assets/gridrunner/gridrunner.re64");
    const [, atStart] = [...byAddress.entries()].find(([a]) => a === 0x8000)!;

    const winner = [...atStart].sort(compareClaims)[0];
    // A label naming this address, against a region naming the span that starts
    // here. The address is the more specific statement.
    expect(winner.name).toBe("initializeDataJumpAddress");
    expect(winner.extent).toBeUndefined();
  });
});
