#!/usr/bin/env node
import { resolveFile } from "../core/project/files.js";
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
  hashBytes,
} from "../store/index.js";
import { openDatabase } from "../store/db.js";
import { diffProjects, parseProject } from "../core/index.js";
import { needsMigration, migrateToClaims } from "../core/claims/migrate.js";
import { SyncServer } from "./sync.js";
import { CheckpointCache } from "../core/machine/scenario.js";
import { SessionReplica, Workspace } from "./workspace.js";
import { McpContext, McpEndpoint, createMcpEndpoint } from "./mcp/transport.js";
import { Caller, resolveCaller } from "./mcp/identity.js";
import { registerTools } from "./mcp/tools.js";
import { McpLog, defaultMcpLogPath, openMcpLog } from "./mcp/log.js";
import { SessionLeases, sessionKeyOf } from "./sessions.js";
import { MAX_UPLOAD_BYTES, uploadTokens } from "./uploads.js";
import {
  applyOpToDoc,
  applyUpdate,
  emptyDoc,
  encodeDoc,
  joinProject,
  leaveProject,
  projectFromDoc,
} from "../core/crdt/index.js";

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
  /**
   * Where to transcribe agent requests, or false for nowhere.
   *
   * Defaults to a file beside the database. On by default because its purpose
   * is to be there already when something interesting happens — a transcript
   * switched on after the run that raised the question has missed it.
   */
  mcpLog?: string | false;
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
 * One colour for every agent, distinct from the palette people are given.
 *
 * A person watching wants to tell an agent from a colleague at a glance; which
 * agent it is, is what the codename is for.
 */
const AGENT_COLOUR = "#7c8ea3";

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
    const store = new ProjectStore(storage);
    // A write that committed and a subscriber that did not hear about it are two
    // different facts, and the second one is only useful if somebody says it.
    store.onPublishError = (error, origin) =>
      console.error(
        `${projectId}: a listener threw on a committed write${
          typeof origin === "string" ? ` from ${origin}` : ""
        }:`,
        error
      );
    const sync = new SyncServer({
      store,
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

  /**
   * Agent sessions, held here rather than per project: one caller working
   * across two projects is one session, the same way one browser tab would be.
   */
  /**
   * Codenames this database has ever issued.
   *
   * Seeded from storage at startup rather than gathered from open rooms,
   * because the case that matters is the *first* call after a restart — the
   * room it names is not open yet, and that is precisely when the pool would
   * otherwise hand out a name somebody is still using. Experiment 9 hit exactly
   * that.
   */
  const spentCodenames = new Set<string>(loadSpentCodenames(projectPath, isDatabase));

  const leases = new SessionLeases({
    onLapsed: (lease) => {
      dropPresence(lease.id);
      // The copy goes with the session that held it. A lapsed lease is not a
      // participant any more, and its unmerged view is nobody's.
      for (const key of [...replicas.keys()]) {
        if (key.startsWith(`${lease.id}\u0000`)) replicas.delete(key);
      }
      for (const key of [...workspaces.keys()]) {
        if (key.startsWith(`${lease.id}\u0000`)) workspaces.delete(key);
      }
    },
    onIssued: (lease) => spentCodenames.add(lease.codename),
    spentCodenames: () => spentCodenames,
  });

  /**
   * Which agents are showing as here, and where.
   *
   * Presence expires much sooner than the lease behind it. The lease is
   * identity and should survive a gap between turns; a dot is a claim that
   * someone is working right now, and one still showing half an hour after the
   * last call is worse than none at all.
   */
  const showing = new Map<string, { projectId: string; clientId: number; lastSeen: number }>();
  const PRESENCE_MS = 90_000;

  function showPresence(
    projectId: string,
    lease: { id: string; clientId: number; codename: string; userId: string; label: string }
  ): void {
    const already = showing.get(lease.id);
    if (already && already.projectId !== projectId) {
      room(already.projectId).sync.setAgentPresence(lease.clientId, null);
    }
    showing.set(lease.id, { projectId, clientId: lease.clientId, lastSeen: Date.now() });
    room(projectId).sync.setAgentPresence(lease.clientId, {
      user: { name: lease.codename, colour: AGENT_COLOUR, agent: true },
    });

    // The same fact, in the document rather than in awareness, because an agent
    // has no socket to read awareness from. Idempotent, which matters: this runs
    // on every request rather than once at a connection.
    joinProject(
      room(projectId).sync.store.document(),
      {
        session: lease.id,
        user: lease.userId,
        name: lease.label,
        codename: lease.codename,
        kind: "agent",
      },
      Date.now()
    );
  }

  function dropPresence(leaseId: string): void {
    const shown = showing.get(leaseId);
    if (!shown) return;
    showing.delete(leaseId);
    room(shown.projectId).sync.setAgentPresence(shown.clientId, null);
    leaveProject(room(shown.projectId).sync.store.document(), leaseId, Date.now());
  }

  // Swept on a timer rather than on the next request, because the interesting
  // case is precisely that no next request comes.
  const presenceSweep = setInterval(() => {
    const cutoff = Date.now() - PRESENCE_MS;
    for (const [id, shown] of showing) if (shown.lastSeen < cutoff) dropPresence(id);
  }, 30_000);
  presenceSweep.unref?.();

  const mcpLog: McpLog = openMcpLog(
    options.mcpLog === undefined ? defaultMcpLogPath(projectPath) : options.mcpLog
  );

  const mcp = () => (endpoint ??= createMcpEndpoint({ registerTools, log: mcpLog }));



  /**
   * One Workspace per project *and target*, holding its analysis cache.
   *
   * A workspace is a view, so the view is part of its identity — two targets
   * are two analyses over one document, and neither invalidates the other.
   * Bounded by the number of targets a project declares, which is small.
   */
  const workspaces = new Map<string, Workspace>();
  /**
   * Machines part-way through a scenario, one cache per project.
   *
   * Per project rather than per workspace, because a workspace is a *view* and
   * two views of one project run the same bytes. Held here rather than in the
   * document because a machine is derived from the script, and this project
   * does not store derived things.
   */
  const machines = new Map<string, CheckpointCache>();

  /**
   * One copy of the document per session and project — the browser tab an agent
   * does not have.
   *
   * Reads answer from it, so a name resolves against what *this* participant
   * knows rather than against whatever the server currently holds. Writes apply
   * here and propagate at once; only the inbox waits, and only until the session
   * asks. Dropped when the lease lapses, along with the workspaces over it.
   */
  const replicas = new Map<string, SessionReplica>();

  function replicaFor(projectId: string, session: string): SessionReplica {
    const key = `${session}\u0000${projectId}`;
    const existing = replicas.get(key);
    if (existing) return existing;

    const { sync, storage } = room(projectId);
    const doc = emptyDoc();
    applyUpdate(doc, encodeDoc(sync.store.document()), "seed");
    const made: SessionReplica = { doc, cursor: storage.opsCursor(), session, changed: 0 };
    doc.on("update", () => {
      made.changed++;
    });
    replicas.set(key, made);
    return made;
  }

  function workspaceFor(projectId: string, target?: string, session?: string): Workspace {
    // A workspace holds an analysis of what its session can see, so the session
    // is part of its identity exactly as the target is.
    const key = `${session ?? ""}\u0000${projectId}\u0000${target ?? ""}`;
    const existing = workspaces.get(key);
    if (existing) return existing;

    const { sync, storage } = room(projectId);
    let cache = machines.get(projectId);
    if (!cache) {
      cache = new CheckpointCache();
      machines.set(projectId, cache);
    }
    const made = new Workspace({
      store: sync.store,
      storage,
      projectId,
      projectPath,
      machines: cache,
      baseUrl: `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${(server.address() as { port: number }).port}`,
      ...(target === undefined ? {} : { target }),
      ...(session === undefined ? {} : { replica: replicaFor(projectId, session) }),
    });
    workspaces.set(key, made);
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
        // **Resolved now, for this request, and held in a local.**
        //
        // This was a server-global closure, reassigned here and read *later*
        // during tool execution — with the `await readBody` below in between.
        // Two requests overlapping by that much is ordinary, and the second
        // replaced the first's identity: a claim asked for by Alice was recorded
        // as Bob, under Bob's session and in Bob's undo scope. A request must
        // never resolve its caller through anything a later request can reach.
        //
        // It matters more since a session reads its own copy of the document: a
        // request that resolves the wrong caller now reads the wrong *replica*
        // as well as recording the wrong author.
        const { storage } = room(projectOf(url));
        const who = resolveCaller(req, url, storage);
        const { key, explicit } = sessionKeyOf(req.headers, who.userId);
        const lease = leases.claim(key, who);
        // Idempotent, and re-run per request so `last_seen_at` tracks a lease
        // that is still being used rather than one that was once opened.
        if (storage instanceof SqliteStorage) {
          storage.startSession(lease.id, lease.userId, Date.now(), lease.codename);
        }
        showPresence(projectOf(url), lease);
        const caller: Caller = {
          ...who,
          sessionId: lease.id,
          codename: lease.codename,
          sharedSession: !explicit,
        };
        const context = (): McpContext => ({
          // The session, so this caller reads its own copy of the document.
          workspace: (projectId, target) =>
            workspaceFor(projectId ?? defaultProject(), target, caller.sessionId),
          caller,
        });

        // The transport wants the parsed body; a GET or DELETE carries none.
        const raw = req.method === "POST" ? await readBody(req) : "";
        return endpoint.handle(req, res, raw ? JSON.parse(raw) : undefined, context);
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
        // Migrated before diffing: the document holds claims, and a caller may
        // PUT either form. Comparing claims against layer labels emits removals
        // for everything and additions for nothing, which is a silent wipe.
        const ops = diffProjects(
          projectFromDoc(doc),
          needsMigration(incoming) ? migrateToClaims(incoming).project : incoming
        );
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
        const requested = url.searchParams.get("file") ?? url.searchParams.get("path");
        const requestedHash = url.searchParams.get("hash");
        if (!requested && !requestedHash) return sendJson(res, 400, { error: "file or hash parameter required" });
        const { sync, storage } = room(projectOf(url));
        let recorded: string | undefined = requestedHash ?? undefined;
        let diskName = requested ?? "";
        if (!requestedHash) {
          try {
            const file = resolveFile(projectFromDoc(sync.store.document()).files ?? [], requested!);
            diskName = file.name;
            recorded = file.hash;
          } catch (error) {
            return sendJson(res, 404, { error: (error as Error).message });
          }
        }
        const bytes = storage instanceof SqliteStorage
          ? recorded ? storage.blobByHash(recorded) : undefined
          : fromDisk(projectPath, diskName);
        if (bytes === undefined) {
          return sendJson(res, 404, {
            error:
              recorded !== undefined
                ? `"${requested}" is recorded as ${recorded} and those bytes are not held`
                : `no such file: ${requested}`,
          });
        }
        if (bytes === FORBIDDEN) {
          return sendJson(res, 403, { error: "path escapes the project directory" });
        }
        if (recorded && hashBytes(bytes) !== recorded) {
          return sendJson(res, 404, { error: "File bytes do not match the recorded content hash" });
        }
        const etag = recorded ? `"${recorded}"` : undefined;
        // **Advertising revalidation and never honouring it is worse than not
        // offering it**, because a client pays the round trip and always gets
        // the whole body back. A disk image is 174KB and the browser fetches it
        // on every load.
        if (etag && etag !== '""' && req.headers["if-none-match"] === etag) {
          res.writeHead(304, { etag, "cache-control": requestedHash ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate" });
          return res.end();
        }
        res.writeHead(200, {
          // Typed by extension, so a rendered sprite sheet opens in a browser
          // tab rather than downloading as an unnamed blob. Everything else
          // stays an octet stream, which is the honest answer for a `.prg`.
          "content-type": mimeOf(diskName || url.searchParams.get("name") || ""),
          "content-length": bytes.length,
          // **A name is not content-addressed, so it is not immutable.** This
          // said `immutable` for a year on a URL that is a *name*, and a name
          // can be pointed at other bytes — uploading over one, or undoing the
          // record of one, leaves every browser that fetched it holding the old
          // content with no reason to ask again. The ETag is the hash, so a
          // revalidating client gets a cheap 304 when nothing moved and the
          // right bytes when something did.
          "cache-control":
            storage instanceof SqliteStorage
              ? requestedHash ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate"
              : "no-store",
          ...(etag ? { etag } : {}),
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

      // Bytes for a binary, sent straight rather than through a tool argument.
      // The token was bound to a project, a name and a caller when it was
      // issued, so this cannot create a blob nobody owns.
      if (path.startsWith("/api/upload/") && req.method === "PUT") {
        const claimed = uploadTokens.claim(path.slice("/api/upload/".length));
        if (!claimed) {
          return sendJson(res, 404, {
            error: "That upload token is unknown, spent, or expired. Prepare another.",
          });
        }

        const chunks: Buffer[] = [];
        let size = 0;
        let refused = false;
        for await (const chunk of req) {
          size += (chunk as Buffer).length;
          if (size > MAX_UPLOAD_BYTES) {
            refused = true;
            break;
          }
          chunks.push(chunk as Buffer);
        }
        if (refused) {
          return sendJson(res, 413, {
            error: `Larger than the ${MAX_UPLOAD_BYTES} byte limit.`,
          });
        }
        if (size === 0) return sendJson(res, 400, { error: "No bytes were sent." });

        const { storage, sync } = room(claimed.projectId);
        if (!(storage instanceof SqliteStorage)) {
          return sendJson(res, 400, { error: "This server holds a file, not a database." });
        }

        const bytes = new Uint8Array(Buffer.concat(chunks));
        const hash = storage.putBlob(claimed.name, bytes);
        // Recorded in the document too, so the file is attributed, undoable,
        // and named in the export beside the hash of the bytes it stands for.
        const noted = new Workspace({
          ...(claimed.sessionId ? { replica: replicaFor(claimed.projectId, claimed.sessionId) } : {}),
          store: sync.store,
          storage,
          projectId: claimed.projectId,
          projectPath,
        }).noteUploadedFile(
          { userId: claimed.author, label: claimed.author, sessionId: claimed.sessionId },
          claimed.name,
          hash,
          bytes.length
        );

        return sendJson(res, 200, {
          ok: true,
          name: claimed.name,
          file: noted.file,
          hash,
          size: bytes.length,
          project: claimed.projectId,
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
    try {
      room(requested || defaultProject()).sync.handleUpgrade(request, socket, head);
    } catch {
      // A socket asking for a project this database does not hold used to throw
      // out of the upgrade handler and take the process down — so a browser tab
      // left open on a previous project killed the next server started on that
      // port, before anybody connected on purpose. One client's bad request
      // closes one socket.
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
      clearInterval(presenceSweep);
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
  const logIndex = args.indexOf("--mcp-log");
  if (!projectArg) {
    console.error(
      "usage: re64-server <project.re64> [--port N] [--mcp-log PATH | --no-mcp-log]"
    );
    process.exit(1);
  }
  const running = startServer({
    projectPath: resolve(projectArg),
    port: portIndex >= 0 ? Number(args[portIndex + 1]) : 5164,
    host: "127.0.0.1",
    mcpLog: args.includes("--no-mcp-log")
      ? false
      : logIndex >= 0
        ? resolve(args[logIndex + 1])
        : undefined,
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

/**
 * Every codename the sessions table remembers.
 *
 * Read once, with its own handle, because it happens before any room exists.
 * A missing or unreadable database is not an error here: the worst case is the
 * behaviour this replaced, and refusing to start a server over it would be a
 * judgement about the result rather than a fact about the request.
 */
function loadSpentCodenames(path: string, isDatabase: boolean): string[] {
  if (!isDatabase) return [];
  try {
    const db = openDatabase(path);
    try {
      const rows = db
        .prepare("SELECT DISTINCT codename FROM sessions WHERE codename IS NOT NULL")
        .all() as { codename: string }[];
      return rows.map((row) => row.codename);
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

/**
 * What a stored file is, by its name.
 *
 * Deliberately short: these are the only types this server puts into the blob
 * store itself, and guessing at anything else would be inventing an answer
 * about bytes somebody else uploaded.
 */
function mimeOf(name: string): string {
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".wav")) return "audio/wav";
  if (name.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}
