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
import { existsSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, loadProject } from "./analysis.js";
import { resolveOwningLayer } from "./ownership.js";
import { buildMapView } from "./map-view.js";
import {
  deleteLabel,
  readProjectFile,
  upsertLabel,
  writeProjectRaw,
} from "./project-file.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, "../../public");

const LABEL_TYPES = ["entry", "function", "code", "address"];

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
}

export function startServer(options: ServerOptions): void {
  const { projectPath, port, host } = options;

  if (!existsSync(projectPath)) {
    console.error(`Project file not found: ${projectPath}`);
    process.exit(1);
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;

    try {
      // --- API ---------------------------------------------------------
      if (path === "/api/project" && req.method === "GET") {
        const { project, raw } = readProjectFile(projectPath);
        return sendJson(res, 200, { path: projectPath, raw, project });
      }

      if (path === "/api/project" && req.method === "PUT") {
        const raw = await readBody(req);
        const project = writeProjectRaw(projectPath, raw);
        return sendJson(res, 200, { ok: true, project });
      }

      if (path === "/api/disasm" && req.method === "GET") {
        const tolerance = Number(url.searchParams.get("tolerance") ?? "1") || 1;
        const loaded = loadProject(projectPath);
        const analysis = analyze(loaded, tolerance);
        return sendJson(res, 200, {
          name: loaded.project.name ?? "untitled",
          ...analysis,
        });
      }

      if (path === "/api/map" && req.method === "GET") {
        return sendJson(res, 200, buildMapView(loadProject(projectPath)));
      }

      if (path === "/api/label" && req.method === "POST") {
        const { address, name, type } = JSON.parse(await readBody(req));
        if (typeof address !== "number" || typeof name !== "string" || !name.trim()) {
          return sendJson(res, 400, { error: "address (number) and name (string) required" });
        }
        if (type !== undefined && !LABEL_TYPES.includes(type)) {
          return sendJson(res, 400, {
            error: `type must be one of ${LABEL_TYPES.join(", ")}`,
          });
        }
        const owner = resolveOwningLayer(projectPath, address);
        if (owner === undefined) {
          return sendJson(res, 400, {
            error:
              `No layer owns $${address.toString(16).toUpperCase()}. Add a layer of ` +
              `type "symbols" to name addresses outside the loaded bytes.`,
          });
        }
        upsertLabel(projectPath, address, name.trim(), type, owner);
        return sendJson(res, 200, { ok: true });
      }

      if (path === "/api/label" && req.method === "DELETE") {
        const { address } = JSON.parse(await readBody(req));
        if (typeof address !== "number") {
          return sendJson(res, 400, { error: "address (number) required" });
        }
        const owner = resolveOwningLayer(projectPath, address);
        if (owner === undefined) {
          return sendJson(res, 400, { error: "No layer owns that address" });
        }
        deleteLabel(projectPath, address, owner);
        return sendJson(res, 200, { ok: true });
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

  server.listen(port, host, () => {
    console.log(`re64 ui   http://${host}:${port}`);
    console.log(`project   ${projectPath}`);
  });
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
