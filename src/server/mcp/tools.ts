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
    "Name an address, or rename what is already there.",
    {
      project,
      address,
      name: z.string().min(1),
      type: z.enum(["entry", "function", "code", "address"]).optional(),
      comment: z.string().optional(),
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
      expectVersion?: string;
    }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.setLabel(caller, args.address, args.name, args.type, args.comment);
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
          })
        )
        .min(1)
        .max(500),
      expectVersion: z.string().optional(),
    },
    (args: {
      project?: string;
      labels: { address: number; name: string; type?: LabelType; comment?: string }[];
      expectVersion?: string;
    }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.setLabels(caller, args.labels);
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
      placement: z.enum(["before", "inline"]).optional().describe("Default before"),
      expectVersion: z.string().optional(),
    },
    (args: {
      project?: string;
      address: number;
      text: string;
      placement?: "before" | "inline";
      expectVersion?: string;
    }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.setComment(caller, args.address, args.text, args.placement ?? "before");
    }
  );

  tool(
    "remove_comment",
    "Delete the comment at an address. Give a placement to pick one when the " +
      "address carries both.",
    {
      project,
      address,
      placement: z.enum(["before", "inline"]).optional(),
      expectVersion: z.string().optional(),
    },
    (args: {
      project?: string;
      address: number;
      placement?: "before" | "inline";
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
      expectVersion: z.string().optional(),
    },
    (args: { project?: string; address: number; name?: string; expectVersion?: string }) => {
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
    "set_region",
    "Say what a span of memory holds. Marking data stops it being disassembled " +
      "as garbage, marking code starts decoding at its first address, and " +
      "marking a jumptable decodes the code it points at, which no control-flow " +
      "walk can reach on its own. Give start with either end (exclusive) or " +
      "length; the reply says which bytes it actually took.",
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
      kind: z.enum(["code", "data", "text", "jumptable", "unknown"]),
      name: z.string().optional(),
      comment: z.string().optional(),
      expectVersion: z.string().optional(),
    },
    (args: {
      project?: string;
      start: number;
      end?: number;
      length?: number;
      kind: "code" | "data" | "text" | "jumptable" | "unknown";
      name?: string;
      comment?: string;
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

      return space.setRegion(caller, args.start, end, args.kind, args.name, args.comment);
    }
  );

  tool(
    "remove_region",
    "Drop the region starting at an address, so the span falls back to whatever " +
      "kind its layer declares. Identified by start, since that is what a reader " +
      "of the disassembly can see.",
    { project, start: address, expectVersion: z.string().optional() },
    (args: { project?: string; start: number; expectVersion?: string }) => {
      const { workspace, caller } = context();
      const space = workspace(args.project);
      space.expect(args.expectVersion);
      return space.removeRegion(caller, args.start);
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
