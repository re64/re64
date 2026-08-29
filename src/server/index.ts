#!/usr/bin/env node
/**
 * Prototype web server for the re64 UI.
 *
 * Deliberately dependency-free (node:http, no framework) and stateless: every
 * request re-reads and re-analyzes the project file, so edits made in an editor
 * on disk and edits made in the UI stay consistent. Fast enough at C64 scale;
 * this is where incremental analysis would eventually go.
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FileStorage, ProjectStore, pathsFor } from "../store/index.js";
import { diffProjects, parseProject } from "../core/index.js";
import { SyncServer } from "./sync.js";
import { applyOpToDoc, projectFromDoc } from "../core/crdt/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, "../../public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

export interface ServerOptions {
  projectPath: string;
  port: number;
  host: string;
  /** Suppress the startup banner; tests bind ephemeral ports in bulk. */
  quiet?: boolean;
}

/** A running server, so callers (and tests) can shut one down cleanly. */
export interface RunningServer {
  /** Resolves once the socket is bound and connections will be accepted. */
  ready: Promise<void>;
  /** The port actually bound, which differs from the request when 0 was asked for. */
  port: number;
  /** Flatten any open session and stop listening. */
  close(): Promise<void>;
}

export function startServer(options: ServerOptions): RunningServer {
  const { projectPath, port, host } = options;

  if (!existsSync(projectPath)) {
    console.error(`Project file not found: ${projectPath}`);
    process.exit(1);
  }

  const store = new ProjectStore(new FileStorage(pathsFor(projectPath)));
  const sync = new SyncServer({
    store,
    // Long enough that a page reload rejoins the same session rather than
    // splitting one piece of work across two history entries.
    idleMs: 30_000,
    // The file should track a live session closely enough that git, the CLI,
    // and an editor open on it all see the work as it happens.
    writeMs: 1_500,
    onFlatten: (summary) =>
      console.log(`flattened ${summary.length} change${summary.length === 1 ? "" : "s"}`),
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;

    try {
      // --- API ---------------------------------------------------------
      if (path === "/api/project" && req.method === "GET") {
        const raw = readFileSync(projectPath, "utf-8");
        return sendJson(res, 200, { path: projectPath, raw, version: store.version() });
      }

      if (path === "/api/project" && req.method === "PUT") {
        const body = await readBody(req);
        const { raw, baseVersion } = JSON.parse(body) as {
          raw: string;
          baseVersion?: string;
        };

        // Checked against the document, not the file: during a live session the
        // file is stale by design, so comparing it would let a whole-document
        // write silently overwrite edits that had already merged.
        const current = store.version();
        if (baseVersion !== undefined && baseVersion !== current) {
          return sendJson(res, 409, {
            error:
              "The project changed since it was loaded — someone else edited it. " +
              "Reload to pick up their changes, or send operations instead of a " +
              "whole document to merge with them.",
            version: current,
          });
        }

        const incoming = parseProject(raw); // refuse what will not load

        // Route the write through the shared document as a synthetic client:
        // one write path, two front doors. A blind overwrite would discard
        // whatever a connected session had merged in the meantime.
        const doc = store.document();
        const ops = diffProjects(projectFromDoc(doc), incoming);
        for (const op of ops) applyOpToDoc(doc, op, "http");
        store.addAuthor("http");

        // Write from the whole document, so the file reflects socket edits that
        // merged alongside this one. History stays session-scoped: a save is
        // not a session, and one entry per keystroke would defeat the point.
        store.writeFile();
        return sendJson(res, 200, { ok: true, version: store.version(), applied: ops.length });
      }

      // Raw bytes for a layer, so the browser can build the memory map and
      // analyse locally. Confined to the project file's directory: the path
      // comes from the project, but the project is user-supplied.
      if (path === "/api/blob" && req.method === "GET") {
        const requested = url.searchParams.get("path");
        if (!requested) {
          return sendJson(res, 400, { error: "path parameter required" });
        }
        const baseDir = dirname(projectPath);
        const filePath = resolve(baseDir, requested);
        const inside = relative(baseDir, filePath);
        if (inside.startsWith("..") || resolve(inside) === inside) {
          return sendJson(res, 403, { error: "path escapes the project directory" });
        }
        if (!existsSync(filePath)) {
          return sendJson(res, 404, { error: `no such file: ${requested}` });
        }
        const bytes = readFileSync(filePath);
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-length": bytes.length,
          "cache-control": "no-store",
        });
        res.end(bytes);
        return;
      }

      if (path === "/api/history" && req.method === "GET") {
        return sendJson(res, 200, { entries: store.history() });
      }

      // --- Static ------------------------------------------------------
      const filePath = join(PUBLIC_DIR, path === "/" ? "index.html" : path);
      if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403).end("forbidden");
        return;
      }
      if (existsSync(filePath)) {
        const body = await readFile(filePath);
        res.writeHead(200, {
          "content-type": MIME[extname(filePath)] ?? "application/octet-stream",
          "cache-control": "no-store",
        });
        res.end(body);
        return;
      }

      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[error] ${req.method} ${path}: ${message}`);
      sendJson(res, 500, { error: message });
    }
  });

  server.on("upgrade", (request, socket, head) => {
    if (new URL(request.url ?? "/", "http://localhost").pathname === "/sync") {
      sync.handleUpgrade(request, socket, head);
    } else {
      socket.destroy();
    }
  });

  // A session that never idles out would otherwise be lost on shutdown.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      sync.flattenNow();
      sync.close();
      process.exit(0);
    });
  }

  const ready = new Promise<void>((resolve) => {
    server.listen(port, host, () => {
      if (!options.quiet) {
        const bound = (server.address() as { port: number }).port;
        console.log(`re64 ui   http://${host}:${bound}`);
        console.log(`project   ${projectPath}`);
      }
      resolve();
    });
  });

  return {
    ready,
    get port() {
      return (server.address() as { port: number } | null)?.port ?? port;
    },
    async close() {
      sync.flattenNow();
      sync.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

// Invoked directly: re64-server <project.re64> [--port N]
const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  const projectArg = args.find((a) => !a.startsWith("-"));
  const portIndex = args.indexOf("--port");
  if (!projectArg) {
    console.error("usage: re64-server <project.re64> [--port N]");
    process.exit(1);
  }
  startServer({
    projectPath: resolve(projectArg),
    port: portIndex >= 0 ? Number(args[portIndex + 1]) : 5164,
    host: "127.0.0.1",
  });
}
