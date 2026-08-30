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
import { FileStorage, ProjectStore, SqliteStorage, pathsFor } from "../store/index.js";
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

/** Marks a request that tried to leave the project directory. */
const FORBIDDEN = new Uint8Array(0);

/**
 * Serve a layer binary from beside the project file.
 *
 * Only for a plain `.re64`, which names files it does not contain. A database
 * holds its own, so there is no directory to escape from and no check to make.
 */
function fromDisk(projectPath: string, requested: string): Uint8Array | undefined {
  const baseDir = dirname(projectPath);
  const filePath = resolve(baseDir, requested);
  const inside = relative(baseDir, filePath);
  if (inside.startsWith("..") || resolve(inside) === inside) return FORBIDDEN;
  if (!existsSync(filePath)) return undefined;
  return new Uint8Array(readFileSync(filePath));
}

export function startServer(options: ServerOptions): RunningServer {
  const { projectPath, port, host } = options;

  if (!existsSync(projectPath)) {
    console.error(`Project file not found: ${projectPath}`);
    process.exit(1);
  }

  // A database or a plain project file, both served identically. The database
  // is the one that carries its own binaries.
  const database = projectPath.endsWith("db") ? new SqliteStorage(projectPath) : undefined;
  const storage = database ?? new FileStorage(pathsFor(projectPath));
  const store = new ProjectStore(storage);
  const sync = new SyncServer({
    store,
    // Long enough that a page reload rejoins the same session rather than
    // splitting one piece of work across two history entries.
    idleMs: 30_000,
    // The file should track a live session closely enough that git, the CLI,
    // and an editor open on it all see the work as it happens.
    writeMs: 1_500,
    onSession: (sessionId, userId) => database?.startSession(sessionId, userId, Date.now()),
    onFlatten: (summary) =>
      console.log(`flattened ${summary.length} change${summary.length === 1 ? "" : "s"}`),
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;

    try {
      // --- API ---------------------------------------------------------
      if (path === "/api/project" && req.method === "GET") {
        return sendJson(res, 200, {
          path: projectPath,
          raw: storage.readText(),
          version: store.version(),
        });
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
        const bytes = database ? database.blob(requested) : fromDisk(projectPath, requested);
        if (bytes === undefined) {
          return sendJson(res, 404, { error: `no such file: ${requested}` });
        }
        if (bytes === FORBIDDEN) {
          return sendJson(res, 403, { error: "path escapes the project directory" });
        }
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-length": bytes.length,
          // Content-addressed and immutable: a name maps to bytes that never
          // change under it, so a reload need not refetch a 174KB disk image.
          "cache-control": database ? "public, max-age=31536000, immutable" : "no-store",
          ...(database ? { etag: `"${database.blobHash(requested) ?? ""}"` } : {}),
        });
        res.end(bytes);
        return;
      }

      if (path === "/api/users" && req.method === "GET") {
        return sendJson(res, 200, { users: database?.users() ?? [] });
      }

      if (path === "/api/export" && req.method === "POST") {
        // Writing the project out is a deliberate act now, not a save. The
        // document was already everyone's the moment the edit landed.
        const ops = store.writeFile();
        return sendJson(res, 200, { ok: true, changed: ops.length > 0 });
      }

      if (path === "/api/debug" && req.method === "GET") {
        return sendJson(res, 200, {
          storage: database ? "sqlite" : "file",
          path: projectPath,
          clients: sync.clientCount,
          sessions: database?.sessions().length ?? 0,
          ...store.debug(),
        });
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
    // Prefix, not equality: a stock y-websocket client connects to
    // `<serverUrl>/<room>`, so the room arrives as a path segment. Matching
    // "/sync" exactly would reject every real client.
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname === "/sync" || pathname.startsWith("/sync/")) {
      sync.handleUpgrade(request, socket, head);
    } else {
      socket.destroy();
    }
  });

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
  const running = startServer({
    projectPath: resolve(projectArg),
    port: portIndex >= 0 ? Number(args[portIndex + 1]) : 5164,
    host: "127.0.0.1",
  });

  // Registered here rather than inside `startServer`, which the tests call
  // repeatedly — a listener per server accumulates, and the first exit cuts off
  // every other server's shutdown anyway. A process has one shutdown.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void running.close().finally(() => process.exit(0));
    });
  }
}
