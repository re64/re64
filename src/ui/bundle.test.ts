import { describe, it, expect } from "vitest";
import { build } from "esbuild";

/**
 * What the browser is made to download.
 *
 * The bundler follows imports, so a single `import` reaching from `src/ui` into
 * server code drags the whole server dependency tree into `public/app.js` — the
 * MCP SDK, `ws`, `node:sqlite`. It would still typecheck and still run, because
 * the code paths are never called; only the download gets bigger. Nothing else
 * in the build reports this, so it is asserted rather than watched.
 */
describe("the browser bundle", () => {
  it("carries no server", async () => {
    const result = await build({
      entryPoints: ["src/ui/main.ts"],
      bundle: true,
      format: "esm",
      write: false,
      metafile: true,
      logLevel: "silent",
    });

    const included = Object.keys(result.metafile.inputs);
    const serverSide = included.filter(
      (path) =>
        path.startsWith("src/server/") ||
        path.startsWith("src/store/") ||
        path.startsWith("src/cli/") ||
        /node_modules\/(@modelcontextprotocol|express|ws)\//.test(path)
    );

    expect(serverSide).toEqual([]);
  });

  it("stays within a size a cold load tolerates", async () => {
    const result = await build({
      entryPoints: ["src/ui/main.ts"],
      bundle: true,
      format: "esm",
      minify: true,
      write: false,
      logLevel: "silent",
    });

    // Not a budget anyone tuned — a tripwire. Shoelace and CodeMirror dominate,
    // so a jump means something large arrived by accident rather than by choice.
    const bytes = result.outputFiles[0].contents.byteLength;
    expect(bytes).toBeLessThan(2_000_000);
  });
});
