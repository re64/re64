/**
 * The tool vocabulary.
 *
 * Schemas and shaping only — every question is answered by `Workspace`, which
 * is tested without a protocol in the way. If something here needs logic, the
 * logic is in the wrong file.
 *
 * Two rules the shapes follow, both from what an agent needs rather than what a
 * browser does. Every answer is bounded, because a full 64K disassembly is tens
 * of thousands of tokens. And every line carries structure as well as its
 * rendered text: the text is what a person reads, the fields are what a caller
 * acts on.
 */

import { z } from "zod";
import type { LabelType } from "../../core/index.js";
import type { McpContext } from "./transport.js";
import type { Claim, Interpretation, RootKind } from "../../core/claims/model.js";
import type { ClaimEdit } from "../../core/ops/types.js";
import type { TextEncoding } from "../../core/c64/text.js";
import type { ClaimInput } from "../workspace.js";

/** One entry of `add_claims`, which is one claim. */
type ClaimArg = ClaimInput;

/**
 * Accepts `$8100`, `0x8100`, `"33024"` **or the number 33024**, and says so.
 *
 * The number was rejected until a transport test asked for it, which is the
 * `run_block` lesson repeating: the project file has always taken `32768` as
 * well as `"$8000"`, so the tool surface was inconsistent with the format it
 * writes, and every caller found out by being refused. A schema is exercised by
 * nothing but the wire, which is why that is where this was caught.
 */
const address = z
  .union([z.string(), z.number()])
  .describe("An address, as $8100, 0x8100, decimal text, or a number")
  .transform((value, ctx) => {
    if (typeof value === "number") {
      if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Not an address: ${value}` });
        return z.NEVER;
      }
      return value;
    }
    const text = value.trim();
    const parsed = text.startsWith("$")
      ? parseInt(text.slice(1), 16)
      : text.startsWith("0x")
        ? parseInt(text.slice(2), 16)
        : parseInt(text, 10);

    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0xffff) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Not an address: ${value}` });
      return z.NEVER;
    }
    return parsed;
  });

/**
 * A byte, written however an address is written.
 *
 * Accepts `$05`, `0x05`, `"5"` and `5`, because a tool that takes `$8100` for
 * an address and then refuses `$05` for a value is inconsistent with itself,
 * and every caller found that out by being rejected. Addresses in this API are
 * hex strings; values had to be numbers, and nothing said so until the schema
 * failed.
 */
const byte = z
  .union([z.number().int(), z.string()])
  .describe("A byte, as $1F, 0x1F, or decimal")
  .transform((value, ctx) => {
    const parsed =
      typeof value === "number"
        ? value
        : value.trim().startsWith("$")
          ? parseInt(value.trim().slice(1), 16)
          : value.trim().startsWith("0x")
            ? parseInt(value.trim().slice(2), 16)
            : parseInt(value.trim(), 10);

    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0xff) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Not a byte: ${value}` });
      return z.NEVER;
    }
    return parsed;
  });

/** A flag: 0 or 1, and the same spellings a byte takes. */
const flag = z
  .union([z.number().int(), z.string()])
  .describe("0 or 1")
  .transform((value, ctx) => {
    const parsed = typeof value === "number" ? value : parseInt(String(value).trim(), 10);
    if (parsed !== 0 && parsed !== 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Not a flag: ${value}` });
      return z.NEVER;
    }
    return parsed;
  });

const project = z.string().optional().describe("Which project; the only one if omitted");

interface Server {
  registerTool(
    name: string,
    // A schema, not only a shape: the SDK accepts either, and only a schema
    // can reject an argument the tool never declared.
    config: { title?: string; description: string; inputSchema?: unknown },
    handler: (args: never) => Promise<{ content: { type: "text"; text: string }[] }>
  ): unknown;
}

const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

export function registerTools(rawServer: unknown, context: () => McpContext): void {
  const server = rawServer as Server;
  /**
   * Register one tool, refusing arguments it does not declare.
   *
   * `registerTool` accepts a schema as well as a raw shape, and a bare shape
   * becomes a zod object that *strips* unknown keys — so a call passing
   * `charset` to `set_region` returned ok having quietly ignored it. For
   * something probing what an API can do, "ok, did nothing" is the worst
   * available answer: it reads as a feature that exists and works.
   */
  const tool = (
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    handler: (args: never) => unknown
  ) =>
    server.registerTool(
      name,
      { description, inputSchema: z.strictObject(inputSchema as z.ZodRawShape) },
      async (args: never) => json(await handler(args))
    );

  // --- orienting ------------------------------------------------------

  tool(
    "list_projects",
    "Every project on this server, and the users an edit can be made as. " +
      "Start here when you do not know what exists.",
    {},
    () => {
      const { workspace } = context();
      return workspace().catalogue();
    }
  );

  tool(
    "whoami",
    "Who this server thinks you are, and whether your session is your own. " +
      "Identity comes from the X-Re64-User header and is never a tool argument, " +
      "so there is no other way to find out — and an edit recorded against the " +
      "wrong name is invisible until somebody reads the history. Worth one call " +
      "at the start if you care how your work is attributed.",
    // Accepts `project` and ignores it. Every other tool takes one, so passing
    // it here is the natural thing to do and being refused for it is a round
    // trip spent on nothing.
    { project },
    () => {
      const { caller } = context();
      const identity = caller.identity ?? "claimed";
      return {
        userId: caller.userId,
        name: caller.label,
        identity,
        session: caller.sessionId,
        codename: caller.codename,
        ownSession: !caller.sharedSession,
        notes: [
          identity === "claimed" &&
            `"${caller.userId}" is not a user on this server. It is believed and ` +
              "recorded as given, so your edits are attributable — but list_projects " +
              "shows the known users if you meant to be one of them.",
          identity === "anonymous" &&
            "No identity was presented, so edits are recorded as anonymous.",
          caller.sharedSession &&
            "No session handle was presented, so this lease is keyed by identity " +
              "alone: anyone calling as the same user shares this session and this " +
              "undo scope. Send X-Re64-Session to get one of your own.",
        ].filter(Boolean),
      };
    }
  );

  tool(
    "read_messages",
    "What people and agents working this project have said to each other. " +
      "Newest last. This is where somebody tells you what they are already " +
      "working on, or what they have concluded that is not yet in the listing.",
    { project, limit: z.number().int().min(1).max(200).optional().describe("Default 50") },
    ({ project: id, limit }: { project?: string; limit?: number }) =>
      context().workspace(id).messages(limit ?? 50)
  );

  tool(
    "list_participants",
    "Who is in this project: people in a browser and other agents, online " +
      "first, with when each was last seen. Membership lives in the document " +
      "rather than in the socket's presence, so this is the same list a browser " +
      "shows — and somebody who has left is still listed, marked offline, " +
      "rather than vanishing.",
    { project },
    ({ project: id }: { project?: string }) => context().workspace(id).participants()
  );

  tool(
    "post_message",
    "Say something to whoever else is in this project — people in a browser see " +
      "it live. Use it to say what you are about to work on, ask about something " +
      "ambiguous, or report what you found. " +
      "It is not an annotation: it goes nowhere near the listing, leaves no " +
      "history entry, cannot be undone, and is not in the exported file. Put a " +
      "conclusion in a comment; put a conversation here. " +
      "At most 2000 characters, and it refuses rather than truncating — a " +
      "long status post is several messages.",
    { project, text: z.string().min(1).max(2000) },
    ({ project: id, text }: { project?: string; text: string }) => {
      const { workspace, caller } = context();
      return workspace(id).postMessage(caller, text);
    }
  );

  tool(
    "describe_project",
    "What a project contains: its layers, its declared regions, where " +
      "disassembly starts, and how much of it has been named by a person " +
      "rather than by the disassembler. The last of those is the best single " +
      "measure of how far along the work is.",
    { project },
    ({ project: id }: { project?: string }) => context().workspace(id).describe()
  );

  tool(
    "export_project",
    "Return the project as .re64 text. The document is the truth and holds " +
      "every edit the moment it lands, so nothing needs saving — this is for " +
      "getting a readable, diffable copy out. describe_project reports " +
      "exportStale when a write to the stored copy has failed, which is " +
      "otherwise silent.",
    { project },
    ({ project: id }: { project?: string }) => context().workspace(id).exportProject()
  );

  // --- reading --------------------------------------------------------

  tool(
    "read_disassembly",
    "Disassembly from an address. Each line carries both the rendered text " +
      "and the fields behind it, so you can read it and act on it without " +
      "parsing. Bounded; follow nextStart to continue.",
    {
      project,
      start: address,
      lines: z.number().int().min(1).max(400).optional().describe("Default 80"),
    },
    ({ project: id, start, lines }: { project?: string; start: number; lines?: number }) =>
      context().workspace(id).disassembly(start, lines ?? 80)
  );

  tool(
    "find_references",
    "What refers to an address, and what it refers to. Inbound entries carry " +
      "the calling line, so you need not read each one separately.",
    {
      project,
      address,
      direction: z.enum(["in", "out", "both"]).optional().describe("Default both"),
    },
    ({
      project: id,
      address: at,
      direction,
    }: {
      project?: string;
      address: number;
      direction?: "in" | "out" | "both";
    }) => context().workspace(id).references(at, direction ?? "both")
  );

  // --- understanding a routine ----------------------------------------

  tool(
    "read_bytes",
    "The raw bytes at an address, as hex and as base64. " +
      "For when you want to work on the data yourself rather than read a " +
      "listing — your own script, your own decoder, your own arithmetic. " +
      "These are the bytes the analysis sees, which is not the same as reading " +
      "the file: a project is a stack of layers and the topmost one supplying " +
      "an address wins, so a patch or a second file changes what is really " +
      "there. Addresses nothing supplies are listed as unmapped rather than " +
      "quietly returned as zero.",
    {
      project,
      start: address,
      target: z
        .string()
        .optional()
        .describe(
          "Read through another view without selecting it. select_target is shared, so switching it to glance at something changes what everybody else is reading"
        ),
      length: z.number().int().min(1).max(8192).describe("How many bytes; 8192 at a time"),
    },
    ({
      project: id,
      start,
      length,
      target,
    }: {
      project?: string;
      start: number;
      length: number;
      target?: string;
    }) => context().workspace(id).bytes(start, length, target)
  );

  tool(
    "run_decoder",
    "Run a decoder you write over a span of bytes, and see what it produces. " +
      "For data whose layout is not one of the built-in ones — a packed screen, " +
      "a run-length-encoded animation, a font in an order somebody invented — " +
      "where the only honest description is code. " +
      "The body receives `bytes` (a plain array of numbers) and `params`, and " +
      "must return {kind:\"bitmap\", width, height, pixels, palette}, " +
      "{kind:\"frames\", delayMs, frames}, or {kind:\"text\", lines}. A bitmap " +
      "comes back drawn as text so you can read it. " +
      "It runs with no access to anything: no network, no files, no clock, no " +
      "randomness — so it is a pure function of the bytes — and it is stopped if " +
      "it does not finish quickly.",
    {
      project,
      start: address,
      length: z.number().int().min(1).max(0x10000).describe("How many bytes to hand it"),
      source: z
        .string()
        .min(1)
        .max(20000)
        .optional()
        .describe("The body of the function. Use `return` to produce the result."),
      decoder: z
        .string()
        .optional()
        .describe("Id of a decoder kept in the project, instead of source. See list_decoders."),
      params: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Passed through as `params`, for anything the body should not hard-code"),
    },
    ({
      project: id,
      start,
      length,
      source,
      decoder,
      params,
    }: {
      project?: string;
      start: number;
      length: number;
      source?: string;
      decoder?: string;
      params?: Record<string, unknown>;
    }) => {
      const space = context().workspace(id);
      if ((source === undefined) === (decoder === undefined)) {
        throw new Error("Give exactly one of source or decoder.");
      }
      const body = source ?? space.decoders().decoders.find((d) => d.id === decoder)?.source;
      if (body === undefined) {
        throw new Error(`No decoder ${decoder}. list_decoders shows what this project has.`);
      }
      return space.decode(body, start, length, params ?? {});
    }
  );

  tool(
    "find_instructions",
    "Every instruction matching a mnemonic, an operand range, or both — each " +
      "with the routine it sits in. " +
      "On this machine the range is the meaning: $D000-$D02E is the VIC-II " +
      "(sprites, colours, raster), $D400-$D418 the SID, $DC00-$DC0F the CIA " +
      "(joystick, keyboard). So \"what makes a sound\" is stores into $D400, and " +
      "\"what draws\" is stores into $D000. " +
      "For immediate values — how many lives, which colour — use find_immediates " +
      "instead: an immediate names no address and cannot be in a range.",
    {
      project,
      mnemonic: z.string().optional().describe("STA, LDA, JSR … case does not matter"),
      from: address.optional().describe("Lowest operand address to match"),
      to: address.optional().describe("Highest operand address to match"),
      limit: z.number().int().min(1).max(500).optional().describe("Default 100"),
    },
    ({
      project: id,
      mnemonic,
      from,
      to,
      limit,
    }: {
      project?: string;
      mnemonic?: string;
      from?: number;
      to?: number;
      limit?: number;
    }) => {
      if (mnemonic === undefined && from === undefined && to === undefined) {
        throw new Error("Give a mnemonic, an operand range, or both — otherwise this is every instruction in the program.");
      }
      return context().workspace(id).instructions({ mnemonic, from, to, limit });
    }
  );

  tool(
    "find_bytes",
    "Every place a sequence of bytes occurs. The search that does not care what " +
      "anything means: the other copies of a table, where a magic value is " +
      "written, whether a pattern recurs before there is any theory about why. " +
      "Use ?? for any byte — the useful searches are nearly always partial, like " +
      "\"A9 ?? 8D 20 D0\" for any store of a literal to the border colour. " +
      "Each hit says which region and routine it lands in.",
    {
      project,
      pattern: z.string().min(1).describe('Hex bytes, spaces between, ?? for any: "A9 ?? 8D"'),
      limit: z.number().int().min(1).max(500).optional().describe("Default 100"),
    },
    ({ project: id, pattern, limit }: { project?: string; pattern: string; limit?: number }) =>
      context().workspace(id).bytesLike(pattern, limit ?? 100)
  );

  tool(
    "call_graph",
    "Who calls a routine, and what it calls, to a depth. The shape of a program " +
      "rather than one address at a time — where to start reading, and what a " +
      "change would reach. " +
      "Sees absolute JSRs only, so a routine reached through a computed jump or " +
      "an RTS dispatch looks unconnected. It says so on every answer.",
    {
      project,
      address,
      depth: z.number().int().min(1).max(4).optional().describe("How far down to follow. Default 2"),
    },
    ({ project: id, address: at, depth }: { project?: string; address: number; depth?: number }) =>
      context().workspace(id).callGraph(at, depth ?? 2)
  );

  tool(
    "list_comments",
    "Everything written about this project, in address order — what has been " +
      "understood so far, without reading the listing to find it.",
    { project, limit: z.number().int().min(1).max(500).optional().describe("Default 200") },
    ({ project: id, limit }: { project?: string; limit?: number }) =>
      context().workspace(id).comments(limit ?? 200)
  );

  tool(
    "list_decoders",
    "Decoders this project carries, with their source. One kept here can be run " +
      "again, and by anyone else in the project, without pasting it.",
    { project },
    ({ project: id }: { project?: string }) => context().workspace(id).decoders()
  );

  tool(
    "set_decoder",
    "Keep a decoder in the project so it can be used again and by somebody " +
      "else. Give an id to revise one, or leave it out to add one. " +
      "It lives at project level rather than on a layer, because a way of " +
      "*reading* bytes describes none of its own — the same reason a constant " +
      "declaration does.",
    {
      project,
      name: z.string().min(1).describe("What it is for, shown in a listing and a menu"),
      source: z.string().min(1).max(20000).describe("The body of a function taking (bytes, params)"),
      id: z.string().optional().describe("Which decoder to revise; omit to add one"),
      expectVersion: z.string().optional(),
    },
    (args: {
      project?: string;
      name: string;
      source: string;
      id?: string;
      expectVersion?: string;
    }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.setDecoder(caller, args.name, args.source, args.id);
    }
  );

  tool(
    "remove_decoder",
    "Drop a decoder from the project. Anything referring to it falls back to " +
      "showing the bytes, the way a dangling constant renders its literal.",
    { project, id: z.string(), expectVersion: z.string().optional() },
    (args: { project?: string; id: string; expectVersion?: string }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.removeDecoder(caller, args.id);
    }
  );

  tool(
    "effects",
    "What the code at an address touches — registers, flags and memory — over " +
      "a scope you choose. The question naming a routine requires: `writes " +
      "$(0xD418) and $(0xD40F)` says it makes a noise whatever it is called. " +
      "Give any address inside a routine, not only its first.\n" +
      "`follow` says how far to look, and the four points differ in what they " +
      "assume:\n" +
      "- `block` — the straight-line block here. **Exact**: a block has no " +
      "branch inside it, so this holds for every input. A block ends at the " +
      "first branch, jump or call, so at a routine head that begins `JSR` this " +
      "is one instruction. Use it beside run_block.\n" +
      "- `routine` — the routine's own blocks, not entering what it calls.\n" +
      "- `calls` — plus everything its callees reach, transitively. The default, " +
      "and what a caller usually means.\n" +
      "- `returning` — `calls`, refusing to enter a callee that never comes " +
      "back. Use it when `calls` unions most of the program: on this reference " +
      "project it takes a subsystem from 47% of every slot touched to 13%. " +
      "`stoppedAt` names every place it stopped, so nothing is hidden.\n" +
      "Everything but `block` is what the code *can* touch, never what it must: " +
      "an intersection over paths is often unanswerable, and a maybe dressed as " +
      "a certainty is worse than neither. A routine's extent is worked out from " +
      "control flow, not declared, because one that tail-jumps away is in two " +
      "places and no single span describes it. Reachability is static, so a " +
      "computed jump leads somewhere this cannot follow.",
    {
      project,
      address,
      follow: z
        .enum(["block", "routine", "calls", "returning"])
        .optional()
        .describe("How far to look. Default `calls`."),
    },
    ({
      project: id,
      address: at,
      follow,
    }: {
      project?: string;
      address: number;
      follow?: "block" | "routine" | "calls" | "returning";
    }) => context().workspace(id).effects(at, follow ?? "calls")
  );

  tool(
    "run_block",
    "Execute the block at an address with values you choose, and see what " +
      "comes out. The complement of block_effects: that says which slots the " +
      "block touches for any input, this says what happens for one. Often the " +
      "fastest route to what a routine is for — pick values, look at the exit " +
      "and the bytes written, and the intent shows. " +
      "One block only, deliberately: a block has no branch inside it, so the " +
      "instructions that run are known before it starts and no path is chosen " +
      "on your behalf. " +
      "Unset registers start at zero and unset memory comes from the program " +
      "as loaded; every result reports which values it actually read and where " +
      "each came from, so you can see what an answer rests on. Decimal mode is " +
      "not modelled and says so.",
    {
      project,
      address,
      // Spelled out rather than `z.record` over an enum of the names, which
      // makes every key *required* — so passing one register was rejected for
      // omitting the other ten, and the tool could not be called at all.
      registers: z
        .strictObject({
          A: byte.optional(),
          X: byte.optional(),
          Y: byte.optional(),
          SP: byte.optional(),
          C: flag.optional(),
          Z: flag.optional(),
          I: flag.optional(),
          D: flag.optional(),
          B: flag.optional(),
          V: flag.optional(),
          N: flag.optional(),
        })
        .optional()
        .describe("Starting registers and flags; anything omitted starts at zero"),
      memory: z
        .record(z.string(), byte)
        .optional()
        .describe("Starting bytes, keyed by address as $D012 or decimal"),
    },
    ({
      project: id,
      address: at,
      registers,
      memory,
    }: {
      project?: string;
      address: number;
      registers?: Record<string, number>;
      memory?: Record<string, number>;
    }) => context().workspace(id).runBlock(at, { registers, memory })
  );

  tool(
    "find_unnamed",
    "Addresses the disassembler had to invent a name for, most-referenced " +
      "first. This is the work queue: an auto-named address is one that has " +
      "been found and not yet understood. Their names cannot be edited by id — " +
      "name the address instead. " +
      "Returns them in `targets`, beside a `total` that counts them all rather " +
      "than the page.",
    {
      project,
      kind: z
        .enum(["calls", "jumps", "data", "any"])
        .optional()
        .describe("calls = sub_, jumps = loc_, data = dat_. Default any"),
      limit: z.number().int().min(1).max(200).optional().describe("Default 50"),
    },
    ({
      project: id,
      kind,
      limit,
    }: {
      project?: string;
      kind?: "calls" | "jumps" | "data" | "any";
      limit?: number;
    }) => context().workspace(id).unnamed(kind ?? "any", limit ?? 50)
  );

  tool(
    "list_warnings",
    "What the disassembler could not make sense of. describe_project reports " +
      "how many there are, which is enough to know something is wrong and no " +
      "use for doing anything about it.",
    { project },
    ({ project: id }: { project?: string }) => context().workspace(id).warnings()
  );

  tool(
    "find_undecoded",
    "Spans of bytes nothing has explained: no claim says what they hold and no " +
      "root reaches them, so nothing decoded there either. This is the " +
      "orientation question on a project nobody has worked on yet — find_unnamed " +
      "ranks what has already been reached, which on a fresh project is almost " +
      "nothing. Biggest span first. " +
      "Both kinds of answer shrink this list: `add_claim is:` says what bytes " +
      "are, and `add_claim root:` says to decode them. It counts what is left " +
      "to do rather than what is wrong, which is why it is not a hygiene check " +
      "— on a fresh project it is the whole binary, and none of that is a fault.",
    {
      project,
      limit: z.number().int().min(1).max(200).optional().describe("Default 20"),
      minimumBytes: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Ignore holes smaller than this. Default 1."),
    },
    (args: { project?: string; limit?: number; minimumBytes?: number }) =>
      context().workspace(args.project).undecoded(args.limit ?? 20, args.minimumBytes ?? 1)
  );

  tool(
    "list_claims",
    "Labels, narrowed by where they came from, their type, their name, or an " +
      "address range.",
    {
      project,
      source: z
        .enum(["user", "layer", "region", "platform", "auto"])
        .optional()
        .describe("user = someone chose it; auto = the disassembler invented it"),
      type: z.enum(["entry", "function", "code", "address"]).optional(),
      namePattern: z.string().optional().describe("Case-insensitive substring"),
      // The description promised an address range and the schema did not have
      // one, so "what is named in zero page" could only be answered by pulling
      // every label and filtering locally. `labels()` took a range all along.
      from: address.optional().describe("Inclusive; with `to`, narrows to a range"),
      to: address.optional().describe("Inclusive, like `export_listing`'s `to`"),
      limit: z.number().int().min(1).max(500).optional().describe("Default 200"),
    },
    ({
      project: id,
      limit,
      from,
      to,
      ...criteria
    }: {
      project?: string;
      limit?: number;
      from?: number;
      to?: number;
    }) =>
      context()
        .workspace(id)
        .labels(
          {
            ...criteria,
            ...(from === undefined && to === undefined
              ? {}
              : // Inclusive, because every other range on this surface is —
                // `export_listing`'s `to` is part of the span, and a claim's
                // `extent` counts the last byte in. `labels()` itself is half-open and says so;
                // converting here is what stops `from:$0400 to:$0400` coming
                // back empty, which is the shape anybody asking about one
                // address writes.
                { range: { start: from ?? 0, end: (to ?? 0xffff) + 1 } }),
          },
          limit ?? 200
        )
  );

  tool(
    "changes_since",
    "What has happened to a project since a position you were given. Use it " +
      "to catch up rather than re-reading everything: someone may be editing " +
      "alongside you. Pass 0 the first time, then the cursor you get back — or " +
      "the name of a tag, to ask what has changed since you marked it.",
    {
      project,
      cursor: z.number().int().min(0).optional().describe("Default 0, from the beginning"),
      tag: z.string().optional().describe("A tag name, instead of a cursor"),
      limit: z.number().int().min(1).max(500).optional().describe("Default 100"),
    },
    ({
      project: id,
      cursor,
      tag,
      limit,
    }: {
      project?: string;
      cursor?: number;
      tag?: string;
      limit?: number;
    }) => context().workspace(id).changesSince(tag ?? cursor ?? 0, limit ?? 100)
  );

  tool(
    "tag_project",
    "Mark this point with a name you can come back to — a tag, in the git " +
      "sense. It is not a save: the document already holds every edit the " +
      "moment it lands. What a tag buys is a position you can ask about later, " +
      "so changes_since takes its name and tells you what has happened since.",
    {
      project,
      name: z.string().describe("Short, and unique within the project"),
      note: z.string().optional().describe("Why this point is worth marking"),
    },
    ({ project: id, name, note }: { project?: string; name: string; note?: string }) => {
      const { workspace, caller } = context();
      return workspace(id).tagProject(caller, name, note);
    }
  );

  tool(
    "list_tags",
    "Points that have been marked, oldest first, each with how many changes " +
      "have been recorded since and whether the project still looks the way it " +
      "did — which are different questions, since an edit and its undo move " +
      "the count and not the content.",
    { project },
    ({ project: id }: { project?: string }) => context().workspace(id).listTags()
  );

  tool(
    "remove_tag",
    "Forget a tag. The history it pointed at is untouched.",
    { project, name: z.string() },
    ({ project: id, name }: { project?: string; name: string }) =>
      context().workspace(id).removeTag(name)
  );

  // --- editing --------------------------------------------------------
  //
  // Every write reports how the instruction count moved. Naming something a
  // function is how code reachable only through a jump table gets decoded at
  // all, so that number is how you tell a good guess from a wasted one.

  tool(
    "add_claim",
    "Say something about an address. **This adds; it never replaces.** " +
      "A claim carries any of: a `name`, what the bytes are (`is`), how far it " +
      "reaches (`extent`), and whether to decode from there (`root`). One tool " +
      "rather than two, because naming an address and saying what a span holds " +
      "were only ever separate because an assembler source file has labels and " +
      "directives — the machine does not. " +
      "Several claims can cover one address and that is the point: the reference " +
      "disassembly calls $08 a scratch byte in most of a program and something " +
      "specific in one routine, and both are true. So an address cannot say " +
      "which claim you meant, and a write keyed by one must not decide. " +
      "The id comes back; use it with set_claim to correct what you said, or " +
      "claims_at first to see what is already there. Which name an operand shows " +
      "is set_primary_name, and that is the only thing anybody sets.",
    {
      project,
      at: address,
      name: z.string().min(1).optional(),
      is: z
        .enum(["data", "text", "bitmap", "jumptable", "record"])
        .optional()
        .describe(
          "What the bytes are. There is no `code`: code is what bytes are when " +
            "nobody has said otherwise, so to have an address decoded set a root. " +
            "`record` is an array of a layout from list_types, and needs typeId."
        ),
      typeId: z.string().optional().describe("With is:\"record\": which layout, from list_types"),
      extent: z
        .number()
        .int()
        .min(1)
        .max(0x10000)
        .optional()
        .describe(
          "Bytes covered. On a name it makes an operand inside render as " +
            "NAME + $000F; on an interpretation it is the span."
        ),
      root: z
        .enum(["entry", "routine", "location", "data"])
        .optional()
        .describe(
          "Surface this regardless of what reaches it. `routine` is a subroutine, " +
            "`entry` is where execution starts, `data` means show these bytes even " +
            "though nothing names them — an unreferenced sprite sheet needs it."
        ),
      encoding: z.enum(["petscii", "screen", "ascii"]).optional(),
      view: z.string().optional().describe("For a bitmap: char:8, bits:3, sprite, snippet:<id>"),
      comment: z.string().optional(),
      expectVersion: z
        .string()
        .optional()
        .describe("Refuse if the project has changed since you read it"),
    },
    (args: {
      project?: string;
      at: number;
      name?: string;
      is?: "data" | "text" | "bitmap" | "jumptable";
      extent?: number;
      root?: "entry" | "routine" | "location" | "data";
      encoding?: "petscii" | "screen" | "ascii";
      view?: string;
      comment?: string;
      expectVersion?: string;
    }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.addClaim(caller, args);
    }
  );

  tool(
    "add_type",
    "Declare a record layout: what the bytes of one array element mean. " +
      "The thing a claim alone cannot say. An 8,400-byte table that a reader " +
      "has established is 42 records of 200 bytes, with nineteen named fields " +
      "each, could previously be expressed as one `data` span and a note — " +
      "finished analysis, discarded for want of a shape. " +
      "**Holes are legal and are the point**: declare the fields you have " +
      "proved and leave the rest unexplained, rather than inventing padding. " +
      "`size` is bytes per record; how many records a claim holds is derived " +
      "from its extent, never stored. " +
      "Returns the id. Bind it with add_claim is:\"record\" typeId:<id>.",
    {
      project,
      name: z.string().min(1),
      size: z.number().int().min(1).max(0x10000).describe("Bytes per record"),
      fields: z
        .record(
          z.string().describe("Offset into the record: 0, 160, or \"$A0\""),
          z.strictObject({
            name: z.string().min(1),
            type: z
              .string()
              .describe(
                "u8, i8, u16, u16be, ptr, ptrbe, char(n), char(n,screen), " +
                  "bytes(n), or the name of another type. Byte order is part of " +
                  "the type rather than a flag beside it, because a hand-written " +
                  "table on this machine is not always little-endian."
              ),
            description: z.string().optional(),
          })
        )
        .describe("By offset. Two fields cannot share one, so the key is the identity."),
      expectVersion: z.string().optional(),
    },
    (args: {
      project?: string;
      name: string;
      size: number;
      fields: Record<string, { name: string; type: string; description?: string }>;
      expectVersion?: string;
    }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.setType(caller, { name: args.name, size: args.size, fields: args.fields });
    }
  );

  tool(
    "edit_type",
    "Correct a record layout, by its id. " +
      "The fields are given whole: send the layout you mean, and a field you " +
      "leave out is one you removed. Two readers adding *different* fields to " +
      "one record still both survive — that merges per offset underneath, which " +
      "is why fields carry no ids of their own.",
    {
      project,
      id: z.string().describe("Type id, from list_types or add_type"),
      name: z.string().min(1),
      size: z.number().int().min(1).max(0x10000),
      fields: z.record(
        z.string(),
        z.strictObject({
          name: z.string().min(1),
          type: z.string(),
          description: z.string().optional(),
        })
      ),
      expectVersion: z.string().optional(),
    },
    (args: {
      project?: string;
      id: string;
      name: string;
      size: number;
      fields: Record<string, { name: string; type: string; description?: string }>;
      expectVersion?: string;
    }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.setType(caller, {
        id: args.id,
        name: args.name,
        size: args.size,
        fields: args.fields,
      });
    }
  );

  tool(
    "remove_type",
    "Take back a record layout, by its id. " +
      "A claim still referencing it renders its bytes rather than breaking — " +
      "the same rule a dangling constant follows, so a delete racing somebody " +
      "else's binding heals itself instead of needing a sweep.",
    { project, id: z.string(), expectVersion: z.string().optional() },
    (args: { project?: string; id: string; expectVersion?: string }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.removeType(caller, args.id);
    }
  );

  tool(
    "list_types",
    "Every record layout this project declares, with its fields in memory " +
      "order and where each type is meant. " +
      "`unexplainedBytes` is how much of a record nobody has accounted for, " +
      "which is a work queue rather than a fault: a reader who has proved " +
      "nineteen fields of a 200-byte record has said something true.",
    { project },
    (args: { project?: string }) => context().workspace(args.project).listTypes()
  );

  tool(
    "list_roots",
    "Where decoding starts. " +
      "A root is what makes bytes get decoded regardless of whether anything " +
      "reaches them — a load address, an entry point, a routine nothing calls " +
      "because it is reached through a jump table. " +
      "There is no add_root or remove_root: a root is a field on a claim, so " +
      "add_claim with `root` declares one and set_claim with `root: null` takes " +
      "it back. A root reported without an id is inherent to a file rather than " +
      "something this project said, so there is nothing to take back.",
    { project },
    (args: { project?: string }) => context().workspace(args.project).listRoots()
  );

  tool(
    "claims_at",
    "Every claim covering an address, with nothing resolved. " +
      "The read that makes an additive write safe: naming an address never " +
      "replaces what is there, so this is how you see what is there before " +
      "adding beside it — and how you get the id to correct one instead. " +
      "Several claims covering an address is ordinary, not a fault; which of " +
      "them renders is a separate question.",
    { project, at: address },
    (args: { project?: string; at: number }) =>
      context().workspace(args.project).claimsAt(args.at)
  );

  tool(
    "disagreements",
    "Where this project contradicts itself: one name reaching two addresses, " +
      "two claims reading one span differently, a decode root inside somebody " +
      "else's data. " +
      "Nothing is resolved for you — that is the point. Declaring is additive, " +
      "so two readers who disagree both stand and this is how anybody finds out, " +
      "rather than one of them silently winning. " +
      "A claim nested inside another is not a contradiction: an 8K table and a " +
      "40-byte string inside it are both true.",
    { project },
    (args: { project?: string }) => context().workspace(args.project).disagreements()
  );

  tool(
    "add_claims",
    "Say several things at once, as one action. Undo takes the whole batch back. " +
      "Use this rather than a call per claim: a real disassembly has hundreds, " +
      "and one round trip each is almost all protocol. " +
      "Partial, like every batch here — an entry that cannot be written is " +
      "reported in `rejected` and the rest still land.",
    {
      project,
      claims: z
        .array(
          z.strictObject({
            at: address,
            name: z.string().min(1).optional(),
            is: z
              .enum(["data", "text", "bitmap", "jumptable"])
              .optional()
              .describe(
                "What the bytes are. There is no `code`: code is what bytes are when " +
                        "nobody has said otherwise, so to have an address decoded set a root."
              ),
            extent: z.number().int().min(1).max(0x10000).optional(),
            root: z.enum(["entry", "routine", "location", "data"]).optional(),
            encoding: z.enum(["petscii", "screen", "ascii"]).optional(),
            view: z.string().optional(),
            comment: z.string().optional(),
          })
        )
        .min(1)
        .max(500),
      expectVersion: z.string().optional(),
    },
    (args: { project?: string; claims: ClaimArg[]; expectVersion?: string }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.addClaims(caller, args.claims);
    }
  );

  tool(
    "set_claim",
    "Correct a claim, by its id. " +
      "The way to change what you said rather than say something else: adding is " +
      "never keyed by an address, because several claims cover any interesting " +
      "one and so an address cannot say which you meant. `claims_at` reports the " +
      "ids covering an address; an invented `dat_`/`loc_`/`sub_` name has none, " +
      "because nothing stored it, and naming that address is an ordinary " +
      "`add_claim`. " +
      "Every field is optional and **omitting one leaves it alone**; passing " +
      "`null` clears it — which is how a root is taken off, an extent removed, " +
      "or an interpretation un-said.",
    {
      project,
      id: z.string().describe("Claim id, from claims_at or add_claim"),
      name: z.string().min(1).nullable().optional(),
      is: z.enum(["data", "text", "bitmap", "jumptable"]).nullable().optional(),
      extent: z.number().int().min(1).max(0x10000).nullable().optional(),
      root: z.enum(["entry", "routine", "location", "data"]).nullable().optional(),
      encoding: z.enum(["petscii", "screen", "ascii"]).nullable().optional(),
      view: z.string().nullable().optional(),
      expectVersion: z.string().optional(),
    },
    (args: {
      project?: string;
      id: string;
      name?: string | null;
      is?: Interpretation["is"] | null;
      extent?: number | null;
      root?: RootKind | null;
      encoding?: TextEncoding | null;
      view?: string | null;
      expectVersion?: string;
    }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);

      // Omitted means "leave alone" and null means "clear", so the edit is
      // built from the keys actually present rather than from their values.
      // `is`, `encoding` and `view` are three arguments for one field: `says`
      // is the interpretation together with how to read it, and a caller should
      // not have to assemble that by hand.
      const fields: Record<string, unknown> = {};
      const says: Record<string, unknown> = {};
      let saysTouched = false;
      let saysCleared = false;
      for (const [key, value] of Object.entries({
        name: args.name,
        extent: args.extent,
        root: args.root,
      })) {
        if (value !== undefined) fields[key] = value;
      }
      for (const [key, value] of [
        ["is", args.is],
        ["encoding", args.encoding],
        ["view", args.view],
      ] as const) {
        if (value === undefined) continue;
        saysTouched = true;
        if (key === "is" && value === null) saysCleared = true;
        else if (value !== null) says[key] = value;
      }
      if (saysTouched) fields.says = saysCleared ? null : (says as Claim["says"]);

      return space.setClaim(caller, args.id, fields as ClaimEdit);
    }
  );

  tool(
    "set_primary_name",
    "Choose which of several names at an address is shown where nothing says " +
      "otherwise.",
    { project, address, name: z.string().min(1), expectVersion: z.string().optional() },
    (args: { project?: string; address: number; name: string; expectVersion?: string }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.setPrimaryLabel(caller, args.address, args.name);
    }
  );

  tool(
    "bind_name",
    "Say which name the operands referring to an address mean, over a span. " +
      "Give `from` alone for one instruction, or `from` and `to` for a whole " +
      "routine. Stored per site, so a binding travels with its instruction " +
      "rather than with a range that may stop being the right one.",
    {
      project,
      target: address.describe("The address being referred to"),
      name: z.string().min(1).describe("Which of its labels these sites mean"),
      from: address.describe("First instruction to bind"),
      to: address.optional().describe("Last instruction; just `from` if omitted"),
      expectVersion: z.string().optional(),
    },
    (args: {
      project?: string;
      target: number;
      name: string;
      from: number;
      to?: number;
      expectVersion?: string;
    }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.bindLabel(caller, args.name, args.target, args.from, args.to);
    }
  );

  tool(
    "unbind_name",
    "Let the operand at an address resolve by the usual rule again.",
    { project, address, expectVersion: z.string().optional() },
    (args: { project?: string; address: number; expectVersion?: string }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.unbindLabel(caller, args.address);
    }
  );


  tool(
    "export_listing",
    "The disassembly as a listing, the way a hand-written one reads: any " +
      "constants used in the span as an equate block, then the rows. Plain " +
      "text rather than JSON, so it is both what you compare against a " +
      "reference and the cheapest way to read a lot at once.",
    {
      project,
      start: address.optional().describe("From the beginning if omitted"),
      lines: z.number().int().min(1).max(2000).optional().describe("Default 200"),
      // A caller who has just written a claim is thinking in addresses, so
      // reaching for an end address here is the natural first guess and cost a
      // round trip to find out otherwise. Both are accepted; `lines` wins when
      // somebody passes both.
      end: address.optional().describe("Alternative to `lines`: stop at this address"),
    },
    (args: { project?: string; start?: number; lines?: number; end?: number }) =>
      context()
        .workspace(args.project)
        .listing(args.start, args.lines ?? (args.end === undefined ? 200 : undefined), args.end)
  );

  tool(
    "add_constant",
    "Declare a name for a byte value: EMPTY_CELL = $00, ORANGE = $08. " +
      "**This adds a declaration; it never replaces one.** Declaring the same " +
      "name twice gives two constants, because a name is prose somebody chose " +
      "and two readers can pick the same word for different things — use " +
      "edit_constant with the id to revise one. " +
      "Declaring changes no listing: a value has no single meaning, and in the " +
      "reference disassembly the same byte is both a colour and a direction in " +
      "different routines. Use bind_constant to say that a particular operand " +
      "means this one.",
    {
      project,
      name: z.string().min(1),
      value: address.describe("A byte, $00-$FF"),
      expectVersion: z.string().optional(),
    },
    (args: { project?: string; name: string; value: number; expectVersion?: string }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.addConstant(caller, args.name, args.value);
    }
  );

  tool(
    "edit_constant",
    "Revise a declared constant by its id: its name, its value, or both. " +
      "The id comes from add_constant or list_constants. By id because declaring " +
      "is additive, so a name can reach two constants and would not say which.",
    {
      project,
      id: z.string().min(1),
      name: z.string().min(1).optional(),
      value: address.optional().describe("A byte, $00-$FF"),
      expectVersion: z.string().optional(),
    },
    (args: {
      project?: string;
      id: string;
      name?: string;
      value?: number;
      expectVersion?: string;
    }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.editConstant(caller, args.id, args.name, args.value);
    }
  );

  tool(
    "remove_constant",
    "Forget a declared constant, by id or by a name that reaches exactly one. " +
      "Operands bound to it go back to showing the literal; nothing needs " +
      "unbinding first.",
    { project, name: z.string().min(1).describe("An id, or an unambiguous name"), expectVersion: z.string().optional() },
    (args: { project?: string; name: string; expectVersion?: string }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.removeConstant(caller, args.name);
    }
  );

  tool(
    "bind_constants",
    "Bind several sites in one call, as one action. add_constants batches the " +
      "declarations, which change no listing by design; this batches the " +
      "operation that actually changes what a reader sees.",
    {
      project,
      bindings: z
        .array(z.strictObject({ address, name: z.string().min(1) }))
        .min(1)
        .max(500),
      expectVersion: z.string().optional(),
    },
    (args: {
      project?: string;
      bindings: { address: number; name: string }[];
      expectVersion?: string;
    }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.bindConstants(caller, args.bindings);
    }
  );

  tool(
    "set_project_description",
    "Say what this project is: provenance, what the binary is, anything a " +
      "reader should know before the first line. A hand-written listing keeps " +
      "this in its file header.",
    { project, description: z.string(), expectVersion: z.string().optional() },
    (args: { project?: string; description: string; expectVersion?: string }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.setDescription(caller, args.description);
    }
  );

  tool(
    "list_constants",
    "Every declared constant, with its value.",
    { project },
    ({ project: id }: { project?: string }) => context().workspace(id).constants()
  );

  tool(
    "bind_constant",
    "Say that the immediate operand at an address means a named constant, so " +
      "it renders as #ORANGE rather than #$08. Refused if the instruction " +
      "takes no immediate or loads a different value. " +
      "Takes a name or an id; where a name reaches two constants the operand's " +
      "own value picks between them, since two constants sharing a name must " +
      "differ in value to be worth telling apart.",
    { project, address, name: z.string().min(1).describe("A name, or an id"), expectVersion: z.string().optional() },
    (args: { project?: string; address: number; name: string; expectVersion?: string }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.bindConstant(caller, args.address, args.name);
    }
  );

  tool(
    "unbind_constant",
    "Read the operand at an address as its literal value again.",
    { project, address, expectVersion: z.string().optional() },
    (args: { project?: string; address: number; expectVersion?: string }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.unbindConstant(caller, args.address);
    }
  );

  tool(
    "find_immediates",
    "Every instruction loading an immediate value, optionally just one value, " +
      "with whatever constant is already bound there. The question after " +
      "naming one site: where else is this value loaded, and does it mean the " +
      "same thing there? Only a reader can answer the second part.",
    {
      project,
      value: address.optional().describe("Only sites loading this byte"),
      limit: z.number().int().min(1).max(500).optional().describe("Default 100"),
    },
    (args: { project?: string; value?: number; limit?: number }) =>
      context().workspace(args.project).immediates(args.value, args.limit ?? 100)
  );

  tool(
    "run_program",
    "Run the program from an address until it leaves the bytes this project " +
      "holds — which is how a loader exits once its work is done, so no limit " +
      "has to be guessed. Unlike run_block, which is one straight line by " +
      "design, this follows branches and calls wherever they go. Give " +
      "`capture` to keep a range of the resulting memory as a file, then " +
      "add_byte_layer over it: that is how a packed program becomes something " +
      "you can read. It runs over flat memory and does not emulate the VIC, " +
      "SID or CIA — hardware it touched is reported so you can judge the " +
      "answer, and an undocumented opcode stops it rather than being guessed.",
    {
      project,
      from: address,
      stopAt: address.optional().describe("Stop here instead of running on"),
      maxInstructions: z
        .number()
        .int()
        .min(1)
        .max(100_000_000)
        .optional()
        .describe("Default 20 million, about ten seconds"),
      capture: z
        .object({
          name: z.string().min(1).describe('What to call the file, e.g. "decrunched.prg"'),
          from: address,
          to: address.describe("Exclusive"),
        })
        .optional(),
      expectVersion: z.string().optional(),
    },
    (args: {
      project?: string;
      from: number;
      stopAt?: number;
      maxInstructions?: number;
      capture?: { name: string; from: number; to: number };
      expectVersion?: string;
    }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.runProgram(caller, args.from, {
        ...(args.stopAt === undefined ? {} : { stopAt: args.stopAt }),
        ...(args.maxInstructions === undefined
          ? {}
          : { maxInstructions: args.maxInstructions }),
        ...(args.capture === undefined ? {} : { capture: args.capture }),
      });
    }
  );

  tool(
    "list_targets",
    "The named views this project has over its layer stack, which is selected, " +
      "and every layer with the id a target is defined in terms of — including " +
      "layers the current selection hides, since that is how you find the view " +
      "that shows them.",
    { project },
    ({ project: id }: { project?: string }) => context().workspace(id).targets()
  );

  tool(
    "set_target",
    "Declare a named view: which layers are linked in, in what order, where " +
      "each one lands, and where disassembly starts beyond what they " +
      "contribute. A project holding a packed file and the image it unpacks to " +
      "can be read as the bytes load or as the program runs — one target each — " +
      "because the second must shadow the first. Annotations belong to layers, " +
      "so they follow linking. " +
      "**The order is the z-order**, bottom-up: the last layer shadows the ones " +
      "before it. So reordering the stack is this call with a reordered list. " +
      "A bare layer id links it at its own address — a PRG's is in its own " +
      "header — and `{layer, at}` puts it somewhere else, which is what a " +
      "program relocating its own code needs. " +
      "The list is a history of the program's life — loader, then the image it " +
      "expands into, then whatever it loads later — so `order` says where this " +
      "sits and `description` says what the phase is. " +
      "Every field but the name is optional and an omitted one is left alone, " +
      "so describing a target does not restate its layers and two people " +
      "revising one do not revert each other.",
    {
      project,
      name: z.string().min(1),
      layers: z
        .array(
          z.union([
            z.string(),
            z.strictObject({
              layer: z.string(),
              at: address.describe("Where this layer lands in this target"),
            }),
          ])
        )
        .min(1)
        .optional()
        .describe(
          "Bottom-up, so the last shadows the rest. Layer ids from list_targets; " +
            "omit to leave the links as they are"
        ),
      entryPoints: z.array(address).optional(),
      order: z
        .number()
        .int()
        .optional()
        .describe("Where this sits in the program's life: the loader before the image it expands, before the levels"),
      description: z
        .string()
        .optional()
        .describe("What this phase is, in prose — a name carries none of it"),
      expectVersion: z.string().optional(),
    },
    (args: {
      project?: string;
      name: string;
      layers?: string[];
      entryPoints?: number[];
      order?: number;
      description?: string;
      expectVersion?: string;
    }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.setTarget(
        caller,
        args.name,
        args.layers,
        args.entryPoints,
        args.order,
        args.description
      );
    }
  );

  tool(
    "select_target",
    "Choose which view to read the project through. Omit the name to go back " +
      "to every layer. This changes what analysis sees, so it moves the " +
      "version and re-analyses — and it is shared, because the view is part of " +
      "the project rather than a setting of yours.",
    { project, name: z.string().optional(), expectVersion: z.string().optional() },
    (args: { project?: string; name?: string; expectVersion?: string }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.selectTarget(caller, args.name);
    }
  );

  tool(
    "remove_target",
    "Forget a view. The layers and everything in them are untouched.",
    { project, name: z.string().min(1), expectVersion: z.string().optional() },
    (args: { project?: string; name: string; expectVersion?: string }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.removeTarget(caller, args.name);
    }
  );

  tool(
    "create_project",
    "Start a project with nothing in it: no layers, no bytes. The first step " +
      "when you have been handed a binary and no project. Follow it with " +
      "prepare_upload to put the file in, list_disk_files if it is a .d64, and " +
      "add_layer to make something disassemblable.",
    { name: z.string().min(1) },
    ({ name }: { name: string }) => context().workspace().createProject(name)
  );

  tool(
    "prepare_upload",
    "Get a URL to PUT a binary to. Bytes go over HTTP rather than through a " +
      "tool argument, because a disk image is ~175KB and base64 of it would be " +
      "tens of thousands of tokens for a file you never need to read. The URL " +
      "is good once and expires. The name is what layers will refer to it by.",
    {
      project,
      name: z.string().min(1).describe('What layers will call it, e.g. "revenge.d64"'),
    },
    ({ project: id, name }: { project?: string; name: string }) => {
      const { workspace, caller } = context();
      return workspace(id).prepareUpload(caller, name);
    }
  );

  tool(
    "list_disk_files",
    "The directory of a .d64 disk image this project holds — what is on the " +
      "disk, and the path to give add_layer for each entry.",
    { project, name: z.string().min(1).describe("The image, as uploaded") },
    ({ project: id, name }: { project?: string; name: string }) =>
      context().workspace(id).diskFiles(name)
  );

  tool(
    "add_byte_layer",
    "Add a layer over bytes the project holds — which is what turns an " +
      "uploaded binary into something to disassemble. `path` is the file's " +
      'name, or "image.d64:FILE" for one inside a disk image. A .prg carries ' +
      "its load address in its first two bytes; a raw layer needs one given.",
    {
      project,
      type: z.enum(["prg", "raw"]),
      path: z.string().min(1),
      name: z.string().optional().describe("Defaults to the file's name"),
      address: address.optional().describe("Required for raw, ignored for prg"),
      expectVersion: z.string().optional(),
    },
    (args: {
      project?: string;
      type: "prg" | "raw";
      path: string;
      name?: string;
      address?: number;
      expectVersion?: string;
    }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.addByteLayer(caller, {
        type: args.type,
        path: args.path,
        ...(args.name === undefined ? {} : { name: args.name }),
        ...(args.address === undefined ? {} : { address: args.address }),
      });
    }
  );

  tool(
    "add_layer",
    "Add a symbols layer: names for addresses that hold no loaded bytes — zero " +
      "page variables, I/O registers, KERNAL entry points. Usually unnecessary, " +
      "because naming or commenting such an address creates one on demand. Use " +
      "this to give it a name of your choosing, or to add a second.",
    {
      project,
      name: z.string().min(1),
      expectVersion: z.string().optional(),
    },
    (args: { project?: string; name: string; expectVersion?: string }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.addSymbolsLayer(caller, args.name);
    }
  );

  tool(
    "remove_layer",
    "Take a layer out of the project. " +
      "For the scratch layers a build leaves behind: a capture aimed at the " +
      "wrong range, a probe, a second attempt. Without it a project carries " +
      "every one of them for ever, and `list_targets` is the only place they " +
      "show. " +
      "Refuses while the layer still owns labels, regions or comments, since " +
      "those would go with it — move them first. Give the id from " +
      "`list_targets`, not the name.",
    {
      project,
      id: z.string().describe("Layer id, from list_targets"),
      expectVersion: z.string().optional(),
    },
    (args: { project?: string; id: string; expectVersion?: string }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.removeLayer(caller, args.id);
    }
  );

  tool(
    "add_comment",
    "Add a comment about an address, and return its id. \"before\" gets its own " +
      "rows above the label and may run to several lines; \"inline\" shares the " +
      "instruction's row and cannot. Comments are their own objects, so an " +
      "address needs no label to carry one — and SEVERAL can share an address: " +
      "all of them render. Adding is cheap and deciding what survives is an " +
      "editing pass, so add freely, then use edit_comment, reorder_comments and " +
      "remove_comment, each by id. This never overwrites anybody, including you.",
    {
      project,
      address,
      text: z.string().min(1),
      placement: z
        .enum(["before", "inline", "after"])
        .optional()
        .describe(
          "before (own rows above the label), inline (shares the instruction's " +
            "row), or after (own rows below it, for an observation about what " +
            "happens next). Default before."
        ),
      expectVersion: z.string().optional(),
    },
    (args: {
      project?: string;
      address: number;
      text: string;
      placement?: "before" | "inline" | "after";
      expectVersion?: string;
    }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.addComment(caller, args.address, args.text, args.placement ?? "before");
    }
  );

  tool(
    "add_comments",
    "Add several comments in one call, as one action. Undo takes the batch " +
      "back whole. A real disassembly carries more comments than labels, so " +
      "one round trip each is almost all protocol.",
    {
      project,
      comments: z
        .array(
          z.strictObject({
            address,
            text: z.string().min(1),
            placement: z.enum(["before", "inline", "after"]).optional(),
          })
        )
        .min(1)
        .max(500),
      expectVersion: z.string().optional(),
    },
    (args: {
      project?: string;
      comments: { address: number; text: string; placement?: "before" | "inline" | "after" }[];
      expectVersion?: string;
    }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.addComments(caller, args.comments);
    }
  );

  tool(
    "add_constants",
    "Declare several constants in one call, as one action. Adds, like " +
      "add_constant: a batch that quietly revised whatever it matched would be " +
      "the obvious way to get back the behaviour that was removed. Declaring " +
      "changes no listing; bind_constant is what makes an operand show a name.",
    {
      project,
      constants: z
        .array(z.strictObject({ name: z.string().min(1), value: address }))
        .min(1)
        .max(500),
      expectVersion: z.string().optional(),
    },
    (args: {
      project?: string;
      constants: { name: string; value: number }[];
      expectVersion?: string;
    }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.addConstants(caller, args.constants);
    }
  );

  tool(
    "edit_comment",
    "Revise a comment by id: its text, its placement, or where it sits among " +
      "the comments at its address. The half add_comment deliberately does not " +
      "do — an address does not identify a comment, so revising by address is " +
      "how one writer silently destroys another's.",
    {
      project,
      id: z.string().describe("From list_comments or add_comment"),
      text: z.string().min(1).optional(),
      placement: z.enum(["before", "inline", "after"]).optional(),
      expectVersion: z.string().optional(),
    },
    (args: {
      project?: string;
      id: string;
      text?: string;
      placement?: "before" | "inline" | "after";
      expectVersion?: string;
    }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.editComment(caller, args.id, {
        ...(args.text === undefined ? {} : { text: args.text }),
        ...(args.placement === undefined ? {} : { placement: args.placement }),
      });
    }
  );

  tool(
    "reorder_comments",
    "Put the comments at an address in the order given, by id. Ordering is " +
      "otherwise by id — stable everywhere and arbitrary — which is fine while " +
      "an address carries one comment and no use once several do. Ids you leave " +
      "out keep their places after the ones you name.",
    {
      project,
      address,
      ids: z.array(z.string()).min(1).describe("In the order you want them"),
      expectVersion: z.string().optional(),
    },
    (args: { project?: string; address: number; ids: string[]; expectVersion?: string }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.reorderComments(caller, args.address, args.ids);
    }
  );

  tool(
    "remove_comment",
    "Delete a comment by id. Several comments can share an address, so an " +
      "address does not identify one.",
    {
      project,
      id: z.string().describe("From list_comments"),
      expectVersion: z.string().optional(),
    },
    (args: { project?: string; id: string; expectVersion?: string }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.removeComment(caller, args.id);
    }
  );

  tool(
    "mark_function",
    "Declare an address a subroutine, creating a label if there is none. " +
      "This makes it an entry point, so it is how code nothing references " +
      "gets decoded. An invented name is rewritten so its prefix matches.",
    {
      project,
      address,
      name: z.string().optional(),
      expectVersion: z.string().optional(),
    },
    (args: {
      project?: string;
      address: number;
      name?: string;
      expectVersion?: string;
    }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.markFunction(caller, args.address, args.name);
    }
  );

  tool(
    "unmark_function",
    "Take back a function declaration. An auto-shaped name is removed outright " +
      "rather than left behind contradicting its own prefix; a name someone " +
      "chose is kept and only its type is cleared.",
    { project, address, expectVersion: z.string().optional() },
    (args: { project?: string; address: number; expectVersion?: string }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.unmarkFunction(caller, args.address);
    }
  );



  tool(
    "remove_claim",
    "Take back a claim, by its id. " +
      "By id and only by id: an address cannot identify a claim, since several " +
      "cover any interesting one — which is what claims_at is for. Removing a " +
      "claim leaves its bytes explained by whatever else covers them, or by " +
      "nothing, which is an honest answer rather than a gap to be avoided.",
    { project, id: z.string().min(1), expectVersion: z.string().optional() },
    (args: { project?: string; id: string; expectVersion?: string }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.removeClaim(caller, args.id);
    }
  );

  tool(
    "undo",
    "Take back your own most recent action — the whole of it, however many " +
      "changes it made. Reaches anything recorded here, on the command line, " +
      "or in a browser. Any part of it that somebody else has changed since is " +
      "left alone and reported rather than reverted over the top of them.",
    { project },
    ({ project: id }: { project?: string }) => {
      const { workspace, caller } = context();
      return workspace(id).undo(caller);
    }
  );
}
