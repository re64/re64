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

/** Accepts `$8100`, `0x8100` or plain decimal, and says so in the schema. */
const address = z
  .string()
  .describe("An address, as $8100, 0x8100, or decimal")
  .transform((value, ctx) => {
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
    {},
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
    "post_message",
    "Say something to whoever else is in this project — people in a browser see " +
      "it live. Use it to say what you are about to work on, ask about something " +
      "ambiguous, or report what you found. " +
      "It is not an annotation: it goes nowhere near the listing, leaves no " +
      "history entry, cannot be undone, and is not in the exported file. Put a " +
      "conclusion in a comment; put a conversation here.",
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
        .describe("The body of the function. Use `return` to produce the result."),
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
      params,
    }: {
      project?: string;
      start: number;
      length: number;
      source: string;
      params?: Record<string, unknown>;
    }) => context().workspace(id).decode(source, start, length, params ?? {})
  );

  tool(
    "block_effects",
    "What the straight-line block at an address reads and writes, without " +
      "running it. The first question about a routine nobody has named: not " +
      "what it is called but what it depends on and what it leaves behind. " +
      "Holds for every input. Says so where it cannot answer — an address that " +
      "depends on a register cannot be named, and an instruction with no " +
      "modelled semantics makes both lists incomplete.",
    { project, address },
    ({ project: id, address: at }: { project?: string; address: number }) =>
      context().workspace(id).blockEffects(at)
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
      "name the address instead.",
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
    "Spans of bytes nothing has explained: no instruction covers them and no " +
      "region says what they hold. This is the orientation question on a " +
      "project nobody has worked on yet — find_unnamed ranks what has already " +
      "been reached, which on a fresh project is almost nothing. Biggest span " +
      "first. Declaring a span data or text is an answer and removes it from " +
      "this list; so does making it decode.",
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
    "list_labels",
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
      limit: z.number().int().min(1).max(500).optional().describe("Default 200"),
    },
    ({ project: id, limit, ...criteria }: { project?: string; limit?: number }) =>
      context().workspace(id).labels(criteria, limit ?? 200)
  );

  tool(
    "changes_since",
    "What has happened to a project since a position you were given. Use it " +
      "to catch up rather than re-reading everything: someone may be editing " +
      "alongside you. Pass 0 the first time, then the cursor you get back.",
    {
      project,
      cursor: z.number().int().min(0).optional().describe("Default 0, from the beginning"),
      limit: z.number().int().min(1).max(500).optional().describe("Default 100"),
    },
    ({
      project: id,
      cursor,
      limit,
    }: {
      project?: string;
      cursor?: number;
      limit?: number;
    }) => context().workspace(id).changesSince(cursor ?? 0, limit ?? 100)
  );

  // --- editing --------------------------------------------------------
  //
  // Every write reports how the instruction count moved. Naming something a
  // function is how code reachable only through a jump table gets decoded at
  // all, so that number is how you tell a good guess from a wasted one.

  tool(
    "set_label",
    "Name an address, or rename what is already there. Give `extent` when the " +
      "name covers an array, so operands inside it read as NAME + offset. " +
      "Note that type \"function\" also makes the address an entry point, so " +
      "code only reachable from there starts decoding.",
    {
      project,
      address,
      name: z.string().min(1),
      type: z.enum(["entry", "function", "code", "address"]).optional(),
      comment: z.string().optional(),
      extent: z
        .number()
        .int()
        .min(1)
        .max(0x10000)
        .optional()
        .describe(
          "Bytes this name covers, when it names an array rather than a spot. " +
            "An operand inside it renders as NAME + $000F instead of a bare address."
        ),
      expectVersion: z
        .string()
        .optional()
        .describe("Refuse if the project has changed since you read it"),
    },
    (args: {
      project?: string;
      address: number;
      name: string;
      type?: "entry" | "function" | "code" | "address";
      comment?: string;
      extent?: number;
      expectVersion?: string;
    }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.setLabel(
        caller,
        args.address,
        args.name,
        args.type,
        args.comment,
        args.extent
      );
    }
  );

  tool(
    "set_labels",
    "Name several addresses in one call, as one action. Undo takes the whole " +
      "batch back. Use this rather than a call per label: a real disassembly " +
      "has hundreds, and one round trip each is almost all protocol.",
    {
      project,
      labels: z
        .array(
          z.strictObject({
            address,
            name: z.string().min(1),
            type: z.enum(["entry", "function", "code", "address"]).optional(),
            comment: z.string().optional(),
            extent: z.number().int().min(1).max(0x10000).optional(),
          })
        )
        .min(1)
        .max(500),
      expectVersion: z.string().optional(),
    },
    (args: {
      project?: string;
      labels: {
        address: number;
        name: string;
        type?: LabelType;
        comment?: string;
        extent?: number;
      }[];
      expectVersion?: string;
    }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.setLabels(caller, args.labels);
    }
  );

  tool(
    "add_label",
    "Add a SECOND name at an address, rather than renaming the one there. For " +
      "an address that genuinely has two — the reference calls $08 " +
      "randomValue throughout and gridXPos inside one routine, which is a " +
      "finding about the program. Which name an operand shows is bind_label; " +
      "without one, the primary wins.",
    {
      project,
      address,
      name: z.string().min(1),
      type: z.enum(["entry", "function", "code", "address"]).optional(),
      extent: z.number().int().min(1).max(0x10000).optional().describe("Bytes this name covers, when it names an array: an operand inside it renders as NAME + $000F instead of a bare address"),
      expectVersion: z.string().optional(),
    },
    (args: {
      project?: string;
      address: number;
      name: string;
      type?: LabelType;
      extent?: number;
      expectVersion?: string;
    }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.addLabel(caller, args.address, args.name, args.type, args.extent);
    }
  );

  tool(
    "set_primary_label",
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
    "bind_label",
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
    "unbind_label",
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
    "remove_label",
    "Remove the label at an address. Only labels this project declares; a " +
      "built-in name is not one of them.",
    { project, address, expectVersion: z.string().optional() },
    (args: { project?: string; address: number; expectVersion?: string }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.removeLabel(caller, args.address);
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
    },
    (args: { project?: string; start?: number; lines?: number }) =>
      context().workspace(args.project).listing(args.start, args.lines ?? 200)
  );

  tool(
    "set_constant",
    "Declare a name for a byte value: GRID = $00, ORANGE = $08. Declaring " +
      "changes no listing — a value has no single meaning, and the reference " +
      "disassembly names $01 both LEFT_ZAPPER and WHITE. Use bind_constant to " +
      "say that a particular operand means this one.",
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
      return space.setConstant(caller, args.name, args.value);
    }
  );

  tool(
    "remove_constant",
    "Forget a declared constant. Operands bound to it go back to showing the " +
      "literal; nothing needs unbinding first.",
    { project, name: z.string().min(1), expectVersion: z.string().optional() },
    (args: { project?: string; name: string; expectVersion?: string }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.removeConstant(caller, args.name);
    }
  );

  tool(
    "bind_constants",
    "Bind several sites in one call, as one action. set_constants batches the " +
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
      "takes no immediate or loads a different value.",
    { project, address, name: z.string().min(1), expectVersion: z.string().optional() },
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
    "set_comment",
    "Write a comment about an address. \"before\" gets its own rows above the " +
      "label and may run to several lines; \"inline\" shares the instruction's " +
      "row and cannot. Comments are their own objects, so an address needs no " +
      "label to carry one. Writing the same slot twice revises it rather than " +
      "stacking a second comment.",
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
      return space.setComment(caller, args.address, args.text, args.placement ?? "before");
    }
  );

  tool(
    "set_comments",
    "Write several comments in one call, as one action. Undo takes the batch " +
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
      return space.setComments(caller, args.comments);
    }
  );

  tool(
    "set_constants",
    "Declare several constants in one call, as one action. Declaring changes " +
      "no listing; bind_constant is what makes an operand show a name.",
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
      return space.setConstants(caller, args.constants);
    }
  );

  tool(
    "remove_comment",
    "Delete the comment at an address. Give a placement to pick one when the " +
      "address carries both.",
    {
      project,
      address,
      placement: z.enum(["before", "inline", "after"]).optional(),
      expectVersion: z.string().optional(),
    },
    (args: {
      project?: string;
      address: number;
      placement?: "before" | "inline" | "after";
      expectVersion?: string;
    }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.removeComment(caller, args.address, args.placement);
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
      extent: z
        .number()
        .int()
        .min(1)
        .max(0x10000)
        .optional()
        .describe(
          "How many bytes the routine runs for, if you know. Never inferred — " +
            "working out where a routine ends needs analysis re64 does not do, " +
            "and a wrong extent is not visibly wrong. Saying so is what lets " +
            "find_references answer which routine a call came from."
        ),
      expectVersion: z.string().optional(),
    },
    (args: {
      project?: string;
      address: number;
      name?: string;
      extent?: number;
      expectVersion?: string;
    }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.markFunction(caller, args.address, args.name, args.extent);
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
    "set_region",
    "Say what a span of memory holds. Marking data stops it being disassembled " +
      "as garbage, marking code starts decoding at its first address, and " +
      "marking a jumptable decodes the code it points at, which no control-flow " +
      "walk can reach on its own, and marking a bitmap draws the bytes as a " +
      "picture instead of a hex column. " +
      "walk can reach on its own. Give start with either end (exclusive) or " +
      "length; the reply says which bytes it actually took. The span must lie " +
      "in a layer that supplies bytes — a region says how to read bytes, so " +
      "there has to be something there to read.",
    {
      project,
      start: address,
      end: address
        .optional()
        .describe("Exclusive: the first address AFTER the span. Give this or length."),
      length: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("How many bytes, as an alternative to end. No off-by-one to get wrong."),
      kind: z.enum(["code", "data", "text", "jumptable", "bitmap", "unknown"]),
      name: z.string().optional(),
      comment: z.string().optional(),
      encoding: z
        .enum(["ascii", "petscii", "screen"])
        .optional()
        .describe(
          "How to read a text region: petscii for KERNAL strings, screen for " +
            "bytes destined for screen RAM, ascii by default. Neither C64 " +
            "encoding is ASCII, so the default misreads most C64 text."
        ),
      id: z
        .string()
        .optional()
        .describe(
          "The region to revise, from describe_project. Without one, a " +
            "declaration strictly inside an existing region creates a new, " +
            "nested region rather than resizing the one already there."
        ),
      view: z
        .string()
        .optional()
        .describe(
          "For kind:bitmap, how to read the bytes as a picture. " +
            "char:<columns> for a character set, sprite:<columns> or " +
            "sprite-multi:<columns> for sprites, bits:<bytes per row> for " +
            "anything else. The listing then draws it, in the browser and in " +
            "exported text alike."
        ),
      expectVersion: z.string().optional(),
    },
    (args: {
      project?: string;
      start: number;
      end?: number;
      length?: number;
      kind: "code" | "data" | "text" | "jumptable" | "bitmap" | "unknown";
      name?: string;
      comment?: string;
      id?: string;
      view?: string;
      encoding?: "ascii" | "petscii" | "screen";
      expectVersion?: string;
    }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);

      // Either, not neither and not both — two ways to say the same thing that
      // disagree is worse than one way that is easy to misread.
      if ((args.end === undefined) === (args.length === undefined)) {
        throw new Error("Give exactly one of end (exclusive) or length.");
      }
      const end = args.end ?? args.start + (args.length as number);

      return space.setRegion(
        caller,
        args.start,
        end,
        args.kind,
        args.name,
        args.comment,
        args.encoding,
        args.view,
        args.id
      );
    }
  );

  tool(
    "remove_region",
    "Drop a region, so its span falls back to whatever the region around it — or " +
      "its layer — declares. A start address is enough while only one region " +
      "begins there; where several do, because one is nested inside another, it " +
      "refuses and names them so you can say which by id. describe_project " +
      "reports the ids.",
    {
      project,
      start: address,
      id: z.string().optional().describe("Which region, when several start at that address"),
      expectVersion: z.string().optional(),
    },
    (args: { project?: string; start: number; id?: string; expectVersion?: string }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.removeRegion(caller, args.start, args.id);
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
