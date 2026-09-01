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
import { McpLog, McpLogEntry, replyOf } from "./log.js";

/**
 * What a caller cannot work out from the tool list.
 *
 * Experiment 4's agent went looking for `save_project`, did not find one, and
 * concluded it could not save its work — then found the file it had imported
 * from sitting stale on disk, which confirmed the wrong model. It spent effort
 * on a step that does not exist, and reported the absence as a defect.
 *
 * Nothing in a per-tool description could have said this, because it is a fact
 * about the *system* rather than about any one call. It belongs here.
 */
const INSTRUCTIONS = [
  "The project is a live document and it is the truth. Every edit is durable " +
    "the moment the tool returns — there is no save step, no commit, and no " +
    "file that has to be written for your work to count. Other participants " +
    "see it immediately.",
  "export_project exists to get a readable .re64 copy out, not to save. " +
    "tag_project marks a point you can name and come back to; changes_since " +
    "takes a tag and tells you what has happened since.",
  "Anything a tool cannot determine, it says so rather than guessing. Read " +
    "the caveats on an answer: they are the difference between a fact about " +
    "the program and an assumption that happened to render.",
].join("\n\n");

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
  log?: McpLog;
  name?: string;
  version?: string;
}): Promise<McpEndpoint | undefined> {
  // The second argument is `ServerOptions` in the shipped `.d.ts`; this local
  // declaration had only the first, so passing instructions failed to compile
  // against a signature the SDK has always had. Narrower-than-reality is the
  // failure mode of hand-typing a dynamic import.
  let McpServer: new (
    info: { name: string; version: string },
    options?: { instructions?: string }
  ) => Connectable;
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
      const server = new McpServer(
        {
          name: options.name ?? "re64",
          version: options.version ?? "0.1.0",
        },
        { instructions: INSTRUCTIONS }
      );
      options.registerTools(server, options.context);

      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      response.on("close", () => {
        void transport.close();
        void server.close();
      });

      const log = options.log;
      const watching = log ? watchReply(response) : undefined;
      const started = Date.now();

      if (log && watching) {
        // On `finish`, not after `handleRequest`: the transport answers as an
        // event stream and resolves once the stream is set up, so reading the
        // reply at that point sees nothing written yet. `close` is the backstop
        // for a client that hangs up mid-reply, which is itself worth recording.
        let recorded = false;
        const write = (): void => {
          if (recorded) return;
          recorded = true;
          log.record({
            ...describeRequest(body),
            at: new Date(started).toISOString(),
            ms: Date.now() - started,
            ...safeCaller(options.context),
            session: header(request, "mcp-session-id"),
            bytes: watching.bytes(),
            ...replyOf(watching.text(), { truncated: watching.truncated() }),
          });
        };
        response.on("finish", write);
        response.on("close", write);
      }

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

/**
 * The caller, if resolving one does not itself fail.
 *
 * Resolving claims a lease, which touches storage — so a transcript must not
 * be the thing that turns a working request into a failed one.
 */
function safeCaller(context: () => McpContext): Partial<McpLogEntry> {
  try {
    const { userId, sessionId, codename } = context().caller;
    return { caller: userId, sessionId, codename };
  } catch {
    return {};
  }
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * What was asked for, from the request body.
 *
 * Reads the JSON-RPC envelope directly rather than hooking tool dispatch, so a
 * call naming a tool that does not exist is recorded as the attempt it was.
 */
function describeRequest(body: unknown): Partial<McpLogEntry> {
  const message = body as {
    method?: string;
    params?: {
      name?: string;
      arguments?: unknown;
      protocolVersion?: string;
      clientInfo?: { name?: string; version?: string };
    };
  };
  if (!message?.method) return {};

  return {
    method: message.method,
    tool: message.params?.name,
    args: message.params?.arguments,
    client: message.params?.clientInfo,
    protocol: message.params?.protocolVersion,
  };
}

/**
 * Watch what is written back without holding on to it.
 *
 * A disassembly read is large and there is no reason to keep a copy of one, so
 * the size is counted in full and only the head is retained — enough for the
 * JSON-RPC envelope and an error message, which is all the transcript wants.
 */
function watchReply(response: ServerResponse): {
  bytes(): number;
  text(): string;
  truncated(): boolean;
} {
  const KEEP = 8_192;
  let seen = 0;
  let head = "";

  const observe = (chunk: unknown): void => {
    // The SDK writes a plain Uint8Array, which is not a Buffer — a guard
    // checking only for Buffer silently discards every chunk and leaves a
    // transcript that records the request and nothing about the answer.
    let text: string;
    if (typeof chunk === "string") text = chunk;
    else if (ArrayBuffer.isView(chunk)) text = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString("utf8");
    else return;

    seen += Buffer.byteLength(text);
    if (head.length < KEEP) head += text.slice(0, KEEP - head.length);
  };

  const write = response.write.bind(response);
  const end = response.end.bind(response);

  response.write = ((chunk: unknown, ...rest: unknown[]) => {
    observe(chunk);
    return (write as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof response.write;

  response.end = ((chunk: unknown, ...rest: unknown[]) => {
    observe(chunk);
    return (end as (...a: unknown[]) => ServerResponse)(chunk, ...rest);
  }) as typeof response.end;

  return { bytes: () => seen, text: () => head, truncated: () => seen > head.length };
}
