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
import {
  DEFAULT_PROJECT,
  FileStorage,
  ProjectStore,
  SqliteStorage,
  pathsFor,
} from "../store/index.js";
import { diffProjects, parseProject } from "../core/index.js";
import { SyncServer } from "./sync.js";
import { Workspace } from "./workspace.js";
import { McpEndpoint, createMcpEndpoint } from "./mcp/transport.js";
import { Caller, resolveCaller } from "./mcp/identity.js";
import { registerTools } from "./mcp/tools.js";
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

  const isDatabase = projectPath.endsWith("db");

  /**
   * One relay per project, made when someone first asks for it.
   *
   * Kept separate rather than making a single relay multi-tenant: a project has
   * its own document, its own participants and its own idle timer, and sharing
   * one relay between them would mean threading a room through every one of
   * those. Nothing is shared between projects except the database file and the
   * blobs inside it.
   */
  const rooms = new Map<string, { sync: SyncServer; storage: SqliteStorage | FileStorage }>();

  function room(requested: string): { sync: SyncServer; storage: SqliteStorage | FileStorage } {
    // A plain project file holds exactly one project, so every room name means
    // the same thing. Honouring them separately would open two relays over one
    // file, each unaware of the other.
    const projectId = isDatabase ? requested : DEFAULT_PROJECT;
    const existing = rooms.get(projectId);
    if (existing) return existing;

    const storage = isDatabase
      ? new SqliteStorage(projectPath, projectId)
      : new FileStorage(pathsFor(projectPath));
    const sync = new SyncServer({
      store: new ProjectStore(storage),
      // Long enough that a page reload rejoins the same session rather than
      // splitting one piece of work across two history entries.
      idleMs: 30_000,
      // The export should track a live session closely enough that the CLI and
      // git see the work without anyone asking.
      writeMs: 1_500,
      onSession: (sessionId, userId) =>
        storage instanceof SqliteStorage
          ? storage.startSession(sessionId, userId, Date.now())
          : undefined,
      onClient: (sessionId, clientId) =>
        storage instanceof SqliteStorage
          ? storage.noteSessionClient(sessionId, clientId, Date.now())
          : undefined,
      onFlatten: (summary) =>
        console.log(`${projectId}: recorded ${summary.length} change${summary.length === 1 ? "" : "s"}`),
    });

    const made = { sync, storage };
    rooms.set(projectId, made);
    return made;
  }

  /** Which project a request is about; the only one, unless it says otherwise. */
  const projectOf = (url: URL) => url.searchParams.get("project") ?? defaultProject();

  /**
   * One connection for questions about the database itself, rather than about a
   * project inside it.
   *
   * Opened once. Every open runs the schema DDL, and this is reached from any
   * request that omits `?project=` — a handful of times for a browser, hundreds
   * for an agent.
   */
  let catalogue: SqliteStorage | undefined;
  function catalog(): SqliteStorage | undefined {
    if (!isDatabase) return undefined;
    catalogue ??= new SqliteStorage(projectPath);
    return catalogue;
  }

  function defaultProject(): string {
    return catalog()?.projects()[0]?.id ?? DEFAULT_PROJECT;
  }

  /**
   * The agent-facing endpoint, brought up on first use.
   *
   * Its SDK is the heaviest dependency here by a wide margin, and a server
   * nobody points an agent at should not pay to load it.
   */
  let endpoint: Promise<McpEndpoint | undefined> | undefined;
  let callerFor: () => Caller = () => ({ userId: "agent", label: "agent" });

  const mcp = () =>
    (endpoint ??= createMcpEndpoint({
      registerTools,
      context: () => ({
        workspace: (projectId) => workspaceFor(projectId ?? defaultProject()),
        caller: callerFor(),
      }),
    }));

  /** One Workspace per project, holding its analysis cache between calls. */
  const workspaces = new Map<string, Workspace>();
  function workspaceFor(projectId: string): Workspace {
    const existing = workspaces.get(projectId);
    if (existing) return existing;

    const { sync, storage } = room(projectId);
    const made = new Workspace({ store: sync.store, storage, projectId, projectPath });
    workspaces.set(projectId, made);
    return made;
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;

    try {
      // --- API ---------------------------------------------------------
      if (path === "/mcp") {
        const endpoint = await mcp();
        if (!endpoint) {
          return sendJson(res, 501, {
            error: "The MCP endpoint is unavailable; its SDK could not be loaded",
          });
        }
        callerFor = () => resolveCaller(req, url, room(projectOf(url)).storage);
        // The transport wants the parsed body; a GET or DELETE carries none.
        const raw = req.method === "POST" ? await readBody(req) : "";
        return endpoint.handle(req, res, raw ? JSON.parse(raw) : undefined);
      }

      if (path === "/api/projects" && req.method === "GET") {
        const listed = catalog()?.projects() ?? [];
        return sendJson(res, 200, {
          projects: listed.length ? listed : [{ id: defaultProject(), name: projectPath }],
        });
      }

      if (path === "/api/project" && req.method === "GET") {
        const { storage, sync } = room(projectOf(url));
        return sendJson(res, 200, {
          path: projectPath,
          project: projectOf(url),
          raw: storage.readText(),
          version: sync.store.version(),
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
        const { sync } = room(projectOf(url));
        const store = sync.store;
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
        const { storage } = room(projectOf(url));
        const bytes =
          storage instanceof SqliteStorage
            ? storage.blob(requested)
            : fromDisk(projectPath, requested);
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
          "cache-control":
            storage instanceof SqliteStorage
              ? "public, max-age=31536000, immutable"
              : "no-store",
          ...(storage instanceof SqliteStorage
            ? { etag: `"${storage.blobHash(requested) ?? ""}"` }
            : {}),
        });
        res.end(bytes);
        return;
      }

      if (path === "/api/users" && req.method === "GET") {
        const { storage } = room(projectOf(url));
        return sendJson(res, 200, {
          users: storage instanceof SqliteStorage ? storage.users() : [],
        });
      }

      if (path === "/api/export" && req.method === "POST") {
        // Writing the project out is a deliberate act now, not a save. The
        // document was already everyone's the moment the edit landed.
        const ops = room(projectOf(url)).sync.store.writeFile();
        return sendJson(res, 200, { ok: true, changed: ops.length > 0 });
      }

      if (path === "/api/debug" && req.method === "GET") {
        const { sync, storage } = room(projectOf(url));
        return sendJson(res, 200, {
          storage: isDatabase ? "sqlite" : "file",
          path: projectPath,
          project: projectOf(url),
          clients: sync.clientCount,
          sessions: storage instanceof SqliteStorage ? storage.sessions().length : 0,
          ...sync.store.debug(),
        });
      }

      if (path === "/api/history" && req.method === "GET") {
        return sendJson(res, 200, { entries: room(projectOf(url)).sync.store.history() });
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
    if (pathname !== "/sync" && !pathname.startsWith("/sync/")) {
      socket.destroy();
      return;
    }
    // The room is the path segment a stock client appends. This is the only
    // place a project is chosen for a socket, and it happens before the
    // handshake, which is where an access check would go.
    const requested = pathname.slice("/sync/".length);
    room(requested || defaultProject()).sync.handleUpgrade(request, socket, head);
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
      catalogue?.close();
      for (const { sync } of rooms.values()) {
        sync.flattenNow();
        sync.close();
      }
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
