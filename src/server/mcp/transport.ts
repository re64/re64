/**
 * The agent-facing endpoint.
 *
 * Mounted inside the server rather than run beside it, so a tool call reads the
 * same live document a browser is editing and an agent's change reaches that
 * browser without a reload. Running it outside would mean a second copy of the
 * document synced over a socket, and edits that no history could attribute.
 *
 * The SDK is loaded on demand. It is by far the heaviest thing here, and
 * nothing that never calls a tool should pay for it — including `re64` itself,
 * which shares this package and would otherwise fail to start if the SDK were
 * absent or broken.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Caller } from "./identity.js";
import type { Workspace } from "../workspace.js";

export interface McpContext {
  workspace: (projectId?: string) => Workspace;
  caller: Caller;
}

/** Built once, then asked to handle each request. */
export interface McpEndpoint {
  handle(request: IncomingMessage, response: ServerResponse, body: unknown): Promise<void>;
  close(): Promise<void>;
}

type ToolRegistrar = (server: unknown, context: () => McpContext) => void;

/**
 * Bring up the endpoint, or explain why not.
 *
 * Returns undefined rather than throwing when the SDK is missing, so a server
 * without it still serves everything else.
 */
export async function createMcpEndpoint(options: {
  context: () => McpContext;
  registerTools: ToolRegistrar;
  name?: string;
  version?: string;
}): Promise<McpEndpoint | undefined> {
  let McpServer: new (info: { name: string; version: string }) => Connectable;
  let StreamableHTTPServerTransport: new (config: {
    sessionIdGenerator: undefined;
  }) => Transport;

  try {
    ({ McpServer } = (await import("@modelcontextprotocol/sdk/server/mcp.js")) as never);
    ({ StreamableHTTPServerTransport } = (await import(
      "@modelcontextprotocol/sdk/server/streamableHttp.js"
    )) as never);
  } catch {
    return undefined;
  }

  return {
    /**
     * A fresh server and transport for every request.
     *
     * This is the SDK's own stateless pattern, not thrift. A transport carries
     * the state of one request-response cycle, so reusing one silently answers
     * nothing after the first — which is exactly what happened before this was
     * checked against the SDK rather than assumed.
     *
     * Stateless is right here regardless: the project is named in each call and
     * the document lives in the server, so a session at this layer would only
     * shadow one that already exists a layer down. Registration is schemas
     * only, and costs nothing worth caching.
     */
    async handle(request, response, body) {
      const server = new McpServer({
        name: options.name ?? "re64",
        version: options.version ?? "0.1.0",
      });
      options.registerTools(server, options.context);

      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      response.on("close", () => {
        void transport.close();
        void server.close();
      });

      await server.connect(transport);
      await transport.handleRequest(request, response, body);
    },

    async close() {
      // Nothing is held between requests.
    },
  };
}

interface Connectable {
  connect(transport: Transport): Promise<void>;
  close(): Promise<void>;
}

interface Transport {
  handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    body?: unknown
  ): Promise<void>;
  close(): Promise<void>;
}
