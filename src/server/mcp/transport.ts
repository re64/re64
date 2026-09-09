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
    "see it immediately. export_project gets a readable copy out; it does not " +
    "save. tag_project marks a point to come back to, and changes_since says " +
    "what has happened since one.",

  "Anything a tool cannot determine, it says so rather than guessing. Read " +
    "the caveats on an answer: they are the difference between a fact about " +
    "the program and an assumption that happened to render.",

  "**Addresses are named three ways, and the difference is real.** A point is " +
    "`address`. A span you read is `start` with a `length` or `lines`. A range " +
    "you filter is `from` and `to`. Nothing else — three independent readers " +
    "have lost round trips guessing between them, which is why this is said " +
    "here rather than left to each tool.",

  // **How to say what you find**, which no per-tool description can carry
  // because it is about choosing between tools rather than using one.
  //
  // Written from what runs did instead. `sprite(...)` and `where` went unused
  // while a reader computed sprite addresses by hand eight times; add_constant
  // was never called across two runs that declared zero constants where the run
  // before declared eighteen; a reader carved forty-two names out of a table as
  // nested text claims, which is what a record field is for.
  "**Five things can be said about a program**, and reaching for the wrong one " +
    "is the usual reason something will not go in. " +
    "An **address** is a claim: add_claim names it and says what its bytes are " +
    "(`is`: data, text, bitmap, jumptable, record), how far it reaches " +
    "(`extent`), and whether to decode from there (`root`). " +
    "A **value** is a constant: the program writes $C0, never $3000, so the " +
    "number is the thing it manipulates. add_constant names one and " +
    "bind_constants attaches it to the sites that mean it; find_immediates " +
    "finds those sites. Name a value you recognise, a **count** you can then " +
    "use as an array bound, a **bit mask** so `AND #$80` reads as " +
    "`AND #RASTER_BIT8`, and the **members of a set**. This is the most " +
    "under-reached-for tool here: one run declared eighteen constants and the " +
    "two after it declared none. " +
    "A **shape** is a type: add_type declares fields at offsets, and a claim " +
    "with is:\"record\" says a span is an array of them. A field is any of " +
    "u8/i8/u16/u16be/ptr/ptrbe/char(n)/bytes(n)/bits(n) or another type's " +
    "name, optionally an array — u8[8], Creature[42], u8[1..32], " +
    "u8[CreatureCount]. A record declared unit:\"bits\" is a **bitmask**, " +
    "whose fields sit at bit offsets. **If you are about to nest a claim inside " +
    "another to express structure — text inside data, a name inside a table — " +
    "you want a field instead.** " +
    "A **place** goes in any address argument: screen[row,column], " +
    "screen[cell], sprite[pointer] — array references, with the array's own " +
    "base in parentheses if the program moved it: screen($8400)[10,2]. " +
    "`where` goes the other way, and for a hardware register says what its " +
    "bits mean — $D011 is seven fields, not a byte, and `mask` names the ones " +
    "an AND or ORA touches. " +
    "A **judgement about a claim** is evidence, and it is next.",

  // The half no run has ever used. `add_evidence` has been called three times
  // in the project's entire history, all by one session, while thirty scenarios
  // were declared and never attached to anything.
  "**Evidence is said about a claim, not about an address**, and it is how a " +
    "finding stops being a sentence somebody has to trust. add_evidence with " +
    "`supports` backs a claim; with `refutes` says it is wrong and by what — " +
    "and both claims stay, because a contradiction is reported here, never " +
    "resolved for you. **When it is settled, retire_claim** takes the losing " +
    "reading out of the working set: it stops rendering, stops competing for " +
    "the name and stops being reported, while the claim, your reason and the " +
    "history stay in the document for list_retired to show and restore_claim " +
    "to undo. Anyone may retire anything — it is not withdrawing, and it is not " +
    "deleting. **Point at a `scenario` and the evidence re-verifies**: running " +
    "it says pass or fail, where a note only says what you believed. That is " +
    "the strongest thing you can leave, and it is almost never done — three " +
    "such calls exist in this project's whole history. " +
    "`method` records **how you know** — guessed, transcribed, read, derived, " +
    "ran — and it is not a confidence score. Two accounts agreeing only mean " +
    "something when the methods differ; the same method twice is one account " +
    "arriving twice, which is how two readers once agreed on the same wrong " +
    "answer.",

  // Every run before the eleventh started from an empty document, so none of
  // this could arise. It arises now.
  "**You may not be the first here.** A document can already hold other " +
    "people's work, and naming an address never replaces what is there — " +
    "claims_at shows everything covering an address, with who vouched for each " +
    "and how they know. So: read before you write. " +
    "`disagreements` is where the project contradicts itself — one name " +
    "reaching two addresses, two claims reading one span differently, a decode " +
    "root inside somebody's data. Nothing is resolved for you, which is the " +
    "point. `describe_project` reports hygiene: your annotations against " +
    "themselves, and zero is the resting state. " +
    "To settle one: bind_primary_name chooses which of several claims at an " +
    "address gives the name that renders; add_evidence refutes says one is " +
    "wrong and why; retire_claim takes a settled-and-wrong one out of the way; " +
    "edit_claim revises your own. **Prefer deciding in the open " +
    "to overwriting quietly** — a reader who meets a correction learns more " +
    "than one who meets a tidy page.",

  "**A target is a view**, and every read takes one. A project can hold the " +
    "same program at several moments of its life — packed on disk, expanded in " +
    "memory, with the ROMs banked in — and a target is an allowlist of the " +
    "layers that make one of them. list_targets shows them and what each links. " +
    "A layer nobody links supplies nothing, which is the usual reason bytes " +
    "read as unmapped.",

  "**The machine is real and you can run the program.** run_program and " +
    "run_scenario execute 6510 code with the VIC, SID and CIA modelled; a " +
    "scenario is a list of typed steps — start, run, poke, key, assert, " +
    "capture — that re-runs, which is what makes it evidence rather than an " +
    "anecdote. A view with no ROM linked vectors into zeros, so run against one " +
    "that has them.",

  "**Where to start when you do not know**: describe_project says what is " +
    "here; find_undecoded is the queue of spans nothing has explained; " +
    "read_disassembly and render show bytes as code or as pictures; preview " +
    "reads a span as text, code or a record *without* claiming it is that; " +
    "effects says what a routine reads and writes; find_references and " +
    "find_instructions search. When a tool cannot see something — an indirect " +
    "jump, a computed address — it says so rather than leaving it out.",
].join("\n\n");

export interface McpContext {
  workspace: (projectId?: string, target?: string) => Workspace;
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
