import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Every tool answers for the view it was asked about.
 *
 * A `Workspace` *is* a view — it is constructed for a project **and** a target,
 * which is why the target reaches seventy methods without appearing in any of
 * their signatures. So a handler that builds one without passing `target` does
 * not fail; it silently answers for the project's default view, and on a
 * project built by running a loader that is the packed file rather than the
 * program.
 *
 * Two tools shipped with exactly that defect. `export_listing` returned the
 * loader's bytes whatever you asked for. `list_claims` reported **399** labels
 * on a project holding 1,035, and one hand-made claim out of thirty-four — so
 * the tool an agent uses to ask "what has been named here" would have told the
 * next run's readers that a heavily annotated project was nearly empty.
 *
 * Neither was catchable by testing what the tools *do*: `Workspace` is tested
 * thoroughly and answers correctly for whatever view it was given. The defect
 * is in the wiring, which is the layer that reads its arguments — so this
 * checks the source, in the same spirit as the CRDT allowlist.
 */

const SOURCE = readFileSync("src/server/mcp/tools.ts", "utf8");

/**
 * Tools whose answer genuinely does not depend on a view, with the reason.
 *
 * Keeping this an explicit list rather than a rule is the point: adding a name
 * here is a decision somebody makes and a reviewer can see, where a heuristic
 * would quietly absorb the next mistake.
 */
const VIEWLESS: Record<string, string> = {
  targetName: "asks which view is the default — the question itself",
  tagProject: "a tag names a point in the op log, which is project-wide",
  prepareUpload: "issues an upload token; no bytes are read",
  undo: "inverts operations, which are recorded per project rather than per view",
  catalogue: "lists the projects on this server, so there is no project yet, let alone a view",
  createProject: "makes a project; nothing exists to have a view of until it returns",
};

describe("every tool answers for the view it was asked about", () => {
  it("passes target wherever a workspace is built", () => {
    // `workspace(...)` followed by the method called on it, across line breaks.
    const calls = [...SOURCE.matchAll(/workspace\(([^()]*)\)\s*\.?\s*\n?\s*\.?(\w+)?/g)];
    expect(calls.length).toBeGreaterThan(5);

    const dropped = calls
      .filter(([, args]) => !args.includes(","))
      .map(([, , method]) => method ?? "(unknown)")
      .filter((method) => !(method in VIEWLESS));

    expect(dropped).toEqual([]);
  });

  it("names a reason for each tool that does not need one", () => {
    // So the list cannot grow by accident: an entry with no reason is somebody
    // silencing this test rather than deciding something.
    for (const [method, why] of Object.entries(VIEWLESS)) {
      expect(why.length, method).toBeGreaterThan(20);
      expect(SOURCE).toContain(`${method}(`);
    }
  });
});
