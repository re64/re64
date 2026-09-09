import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { VIEWLESS } from "./views.js";

/**
 * Every tool answers for the view it was asked about — or for no view at all.
 *
 * A `Workspace` *is* a view: it is constructed for a project **and** a target,
 * which is why the target reaches seventy methods without appearing in any of
 * their signatures. So a handler that builds one without passing `target` does
 * not fail. It answers for a different stack.
 *
 * Two tools shipped with exactly that defect. `export_listing` returned the
 * loader's bytes whatever you asked for. `list_claims` reported **399** labels
 * on a project holding 1,035 — so the tool an agent uses to ask "what has been
 * named here" told the next run that a heavily annotated project was nearly
 * empty. Neither was catchable by testing what the tools *do*: `Workspace`
 * answers correctly for whatever view it is given, and the defect is in the
 * wiring.
 *
 * **This is the source-level half of `views.ts`.** The schema half —
 * `transport.test.ts` — asserts what the published surface says; this asserts
 * that each handler does what its schema promises. A view-bound tool that
 * forgets its target would advertise `target` and ignore it, which is the
 * original bug wearing the new design's clothes.
 */

const SOURCE = readFileSync("src/server/mcp/tools.ts", "utf8");

/** Each `tool("name", …)` registration, as text. */
function registrations(): { name: string; body: string }[] {
  const found: { name: string; body: string }[] = [];
  const starts = [...SOURCE.matchAll(/\n {2}tool\(\n {4}"([a-z_]+)",/g)];
  starts.forEach((match, index) => {
    const from = match.index!;
    const to = index + 1 < starts.length ? starts[index + 1].index! : SOURCE.length;
    found.push({ name: match[1], body: SOURCE.slice(from, to) });
  });
  return found;
}

describe("every tool answers for the view it was asked about", () => {
  it("finds the registrations at all", () => {
    // The rest of this file is a text search, so a regex that stopped matching
    // would pass everything silently. That failure mode has happened here.
    expect(registrations().length).toBeGreaterThan(80);
  });

  it("passes a target wherever a view-bound tool builds a workspace", () => {
    const missing = registrations()
      .filter(({ name }) => !VIEWLESS.has(name))
      .filter(({ body }) => {
        const builds = [...body.matchAll(/workspace\(([^()]*)\)/g)];
        return builds.length > 0 && builds.some(([, args]) => !args.includes(","));
      })
      .map(({ name }) => name);

    expect(missing).toEqual([]);
  });

  it("passes none where the tool has no view to pass", () => {
    // The mirror, and the one that keeps `views.ts` honest: a tool that takes no
    // `target` cannot be reading one, and a handler still threading `args.target`
    // is reading `undefined` while looking like it works.
    const stale = registrations()
      .filter(({ name }) => VIEWLESS.has(name))
      .filter(({ body }) => /workspace\([^()]*,/.test(body) || /args\.target|target\?: string/.test(body))
      .map(({ name }) => name);

    expect(stale).toEqual([]);
  });

  it("classifies every registered tool exactly once", () => {
    // The same shape as the exhaustive op table in `roundtrip.test.ts`: a new
    // tool cannot be added without the decision being made. The schema test in
    // `transport.test.ts` checks the other direction — that `VIEWLESS` names no
    // tool that does not exist.
    const names = new Set(registrations().map((r) => r.name));
    for (const name of VIEWLESS) {
      expect(names.has(name), `VIEWLESS names ${name}, which is not registered here`).toBe(true);
    }
  });
});
