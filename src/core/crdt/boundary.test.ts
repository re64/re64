import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Where the CRDT is allowed to be visible.
 *
 * The property worth protecting is that the **domain never sees a CRDT type**.
 * The disassembler, the memory model, the operation vocabulary and the CLI must
 * work whether or not anything is synchronised, and swapping Yjs for another
 * library must not reach them.
 *
 * That is narrower than "only the adapter may touch Yjs". The wire protocol
 * legitimately belongs in the server and the transport legitimately belongs in
 * the client, and neither belongs inside the adapter. So this is an allowlist
 * per package rather than one forbidden directory — and `src/ui/main.ts` being
 * absent from the transport's list is the assertion that keeps the transport
 * replaceable.
 *
 * It is a grep. It cannot follow a re-export chain, and it is not trying to be
 * unbypassable — its job is to make a violation loud.
 */

/** Matches any test file, wherever it lives. */
const TESTS = "\u0000tests";

/** Package specifier → the only paths that may import it, as path prefixes. */
const ALLOWED: { package: string; match: RegExp; only: string[] }[] = [
  {
    package: "yjs",
    match: /["']yjs["']/,
    only: [join("src", "core", "crdt")],
  },
  {
    package: "y-protocols / lib0",
    match: /["'](?:y-protocols|lib0)\//,
    only: [join("src", "core", "crdt"), join("src", "server", "sync.ts")],
  },
  {
    package: "y-websocket",
    match: /["']y-websocket["']/,
    // One production file, plus tests — which connect a real provider on
    // purpose. A hand-written stand-in would only prove the server agrees with
    // itself; the point is that a stock client interoperates.
    only: [join("src", "ui", "doc-client.ts"), TESTS],
  },
];

/** Static imports, re-exports, `require`, and dynamic `import()`. */
const IMPORTING = (specifier: RegExp) =>
  new RegExp(
    `(?:from\\s+|require\\(\\s*|import\\(\\s*)${specifier.source}`,
    "m"
  );

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("the CRDT boundary", () => {
  const files = sourceFiles("src");

  for (const rule of ALLOWED) {
    it(`keeps ${rule.package} inside ${rule.only.join(", ")}`, () => {
      const pattern = IMPORTING(rule.match);
      const permitted = (path: string) =>
        rule.only.some((prefix) =>
          prefix === TESTS ? path.endsWith(".test.ts") : path.startsWith(prefix)
        );
      const offenders = files
        .filter((path) => !permitted(path))
        .filter((path) => pattern.test(readFileSync(path, "utf-8")));

      expect(offenders).toEqual([]);
    });
  }

  it("is not reachable through a barrel the domain imports", () => {
    // `src/ui` and `src/cli` import `../core/index.js`; if that carried the
    // adapter, every rule above would be bypassable by one re-export.
    expect(readFileSync(join("src", "core", "index.ts"), "utf-8")).not.toContain("crdt");
    // `src/store/index.ts` re-exports the project store, which does hold a
    // document. No UI *source* file may reach it — the browser talks to the
    // server, not to storage. Its tests may, because they stand a server up.
    const uiFiles = files
      .filter((p) => p.startsWith(join("src", "ui")))
      .filter((p) => !p.endsWith(".test.ts"));
    const reachingIntoStore = uiFiles.filter((p) =>
      /from\s+["'][^"']*\/store\//.test(readFileSync(p, "utf-8"))
    );
    expect(reachingIntoStore).toEqual([]);
  });

  it("keeps operations free of the library that merges them", () => {
    // An operation is a description of intent. It has to be expressible by the
    // CLI, by an agent, and over HTTP, none of which have a document.
    const opsFiles = files.filter((p) => p.startsWith(join("src", "core", "ops")));
    expect(opsFiles.length).toBeGreaterThan(0);
    for (const path of opsFiles) {
      expect(readFileSync(path, "utf-8")).not.toMatch(/yjs|y-protocols|y-websocket/);
    }
  });
});
