/**
 * Who the server decides you are.
 *
 * There was no test here, which is why the defect was quiet: an unrecognised
 * claim fell through to `known[0]` — the first row of the users table — so
 * three agents announcing themselves as `reader-1`, `reader-2` and `reader-3`
 * all had their edits recorded as `usr_agent` with nothing said about it. The
 * existing MCP tests all send a header that *does* match, so every one of them
 * passed.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";
import { SqliteStorage, importProject } from "../../store/index.js";
import { ANONYMOUS, resolveCaller } from "./identity.js";

let dir: string;
let storage: SqliteStorage;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "re64-identity-"));
  const project = join(dir, "gridrunner.re64");
  copyFileSync("assets/gridrunner.re64", project);
  copyFileSync("assets/gridrunner.prg", join(dir, "gridrunner.prg"));
  const { databasePath, projectId } = importProject(project);
  storage = new SqliteStorage(databasePath, projectId);
});

afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Just enough of a request for the header lookup. */
const asking = (user?: string): IncomingMessage =>
  ({ headers: user === undefined ? {} : { "x-re64-user": user } }) as IncomingMessage;

const url = new URL("http://127.0.0.1/mcp");
const resolve = (user?: string) => resolveCaller(asking(user), url, storage);

describe("resolving who is calling", () => {
  it("recognises a user by id", () => {
    expect(resolve("usr_agent")).toMatchObject({
      userId: "usr_agent",
      label: "agent",
      identity: "user",
    });
  });

  it("recognises a user by name", () => {
    expect(resolve("agent")).toMatchObject({ userId: "usr_agent", identity: "user" });
  });

  it("believes a claim it does not recognise, rather than picking somebody else", () => {
    // The defect, stated as a test. `reader-2` is nobody here, and the answer
    // used to be `usr_agent` because that is what sorts first.
    const who = resolve("reader-2");
    expect(who).toMatchObject({ userId: "reader-2", label: "reader-2", identity: "claimed" });
    expect(who.userId).not.toBe("usr_agent");
  });

  it("is anonymous when nothing is claimed", () => {
    expect(resolve()).toMatchObject({ userId: ANONYMOUS, identity: "anonymous" });
  });

  it("does not confuse claiming nothing with claiming a stranger", () => {
    // Both used to resolve to the same user, which made them indistinguishable
    // in the history afterwards.
    expect(resolve("reader-2").userId).not.toBe(resolve().userId);
  });

  it("treats blank space as no claim at all", () => {
    expect(resolve("   ")).toMatchObject({ userId: ANONYMOUS, identity: "anonymous" });
  });

  it("keeps two strangers apart", () => {
    expect(resolve("reader-1").userId).not.toBe(resolve("reader-3").userId);
  });

  it("takes the claim from the query string when there is no header", () => {
    const withQuery = new URL("http://127.0.0.1/mcp?user=usr_guest");
    expect(resolveCaller(asking(), withQuery, storage)).toMatchObject({
      userId: "usr_guest",
      identity: "user",
    });
  });
});
