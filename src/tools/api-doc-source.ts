/**
 * `docs/api.md`, from the live `tools/list` schema.
 *
 * Split from the writing for the reason `kernal-effects-source.ts` is: a
 * committed generated file goes stale in silence, so a test regenerates this
 * and compares. The previous `docs/api.md` was written by hand from a schema
 * dump and was wrong about eight tools within a fortnight.
 *
 * The **prose** is here rather than in the file, because it is the half a
 * schema cannot produce — conventions, what a write returns, which tensions are
 * open. The **tool reference** is derived, so it cannot disagree with what a
 * client actually sees.
 */

/** One tool, as `tools/list` describes it. */
export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: {
    properties?: Record<string, { type?: string; description?: string; enum?: unknown[] }>;
    required?: string[];
  };
}

/**
 * Which section each tool belongs in.
 *
 * Editorial, and therefore hand-maintained — but *checked*: generation refuses
 * if a tool is in no section or in two, so a new tool forces the decision
 * rather than quietly vanishing from the document. That is the same shape as
 * the exhaustive op table in `roundtrip.test.ts`.
 */
export const SECTIONS: { title: string; blurb: string; tools: string[] }[] = [
  {
    title: "Orienting",
    blurb: "What is here, who you are, and how far along it is.",
    tools: ["list_projects", "whoami", "describe_project", "list_participants", "list_targets"],
  },
  {
    title: "Reading",
    blurb:
      "Structured rows, never rendered text — character offsets into a column are " +
      "useless to a caller, which is the finding this whole surface was built on.",
    tools: [
      "read_disassembly",
      "read_bytes",
      "render",
      "preview",
      "where",
      "list_claims",
      "claims_at",
      "list_roots",
      "list_comments",
      "list_constants",
      "list_types",
      "list_decoders",
      "export_listing",
    ],
  },
  {
    title: "Searching",
    blurb:
      "Every hit says which routine it lands in, which is what makes a list of " +
      "fifty addresses usable rather than a haystack.",
    tools: [
      "find_references",
      "find_instructions",
      "find_bytes",
      "find_immediates",
      "find_unnamed",
      "find_undecoded",
    ],
  },
  {
    title: "Analysing",
    blurb:
      "The answers say which they are: `effects follow:block` is exact because a " +
      "block has one path; everything wider is a union over paths — what the code " +
      "*can* touch, never what it must.",
    tools: ["effects", "call_graph", "run_decoder", "list_warnings", "disagreements"],
  },
  {
    title: "Saying what an address is",
    blurb:
      "One noun. `add_claim` takes a `name`, an `is`, an `extent` and a `root` — " +
      "any of them, at least one. **Always adds**; correcting is `edit_claim`, by id.",
    tools: ["add_claim", "add_claims", "edit_claim", "remove_claim", "mark_function", "unmark_function"],
  },
  {
    title: "Choosing which name shows",
    blurb:
      "Several claims cover any interesting address, so two questions arise that " +
      "a single name cannot answer: which renders by default, and which a " +
      "particular operand means.",
    tools: ["bind_primary_name", "unbind_primary_name", "bind_name", "unbind_name"],
  },
  {
    title: "Comments",
    blurb:
      "Their own objects, with ids. `add_comment` mints and never overwrites — an " +
      "address cannot identify a comment, for exactly the reason it cannot " +
      "identify a claim.",
    tools: ["add_comment", "add_comments", "edit_comment", "reorder_comments", "remove_comment"],
  },
  {
    title: "Declarations",
    blurb:
      "Project-level, because a way of *reading* bytes describes none of its own — " +
      "so there is no layer for one to move with when the stack is reordered. " +
      "Constants and types and decoders all take the same three verbs.",
    tools: [
      "add_constant",
      "add_constants",
      "edit_constant",
      "remove_constant",
      "bind_constant",
      "bind_constants",
      "unbind_constant",
      "add_type",
      "edit_type",
      "remove_type",
      "add_field",
      "edit_field",
      "remove_field",
      "add_decoder",
      "edit_decoder",
      "remove_decoder",
    ],
  },
  {
    title: "Running it",
    blurb:
      "A scenario is a list of typed steps the machine executes in order — not a " +
      "script, which is what makes a re-run able to resume from where the last " +
      "one got to. The machine itself is never stored: it is derived from these " +
      "steps and the project's bytes, so the script is the truth and the machine " +
      "is a cache. Captures go to the file store and are recorded in the " +
      "document, so what a run produced can be read again, and by somebody else, " +
      "without running it.",
    tools: [
      "list_scenarios",
      "add_scenario",
      "edit_scenario",
      "remove_scenario",
      "run_scenario",
      "play_sid",
      "run_program",
      "run_block",
    ],
  },
  {
    title: "Evidence",
    blurb:
      "Something said about a **claim** rather than about an address. It is where " +
      "a refutation lives that shares no bytes with what it refutes, where a " +
      "claim points at a scenario that re-verifies it, and where a retirement " +
      "records who set a reading aside and why. Both experiment-0 agents asked " +
      "for this shape and neither toolchain had it.\n\n" +
      "**Refuting and retiring are different acts.** A refutation says a claim " +
      "is wrong and leaves both standing, because `disagreements` reports " +
      "contradiction and never picks a winner — which is what you want while the " +
      "matter is open. Retiring says it is out, and takes it out of everything " +
      "that reads the document, keeping the claim and the reason where review can " +
      "find them.",
    tools: [
      "list_evidence",
      "add_evidence",
      "edit_evidence",
      "remove_evidence",
      "retire_claim",
      "restore_claim",
      "list_retired",
    ],
  },
  {
    title: "Building a project",
    blurb:
      "From a binary to something disassemblable. Bytes go over HTTP rather than " +
      "through a tool argument: a disk image is ~175KB, and base64 of it would be " +
      "tens of thousands of tokens for a file you never read.",
    tools: [
      "create_project",
      "prepare_upload",
      "list_disk_files",
      "add_byte_layer",
      "add_layer",
      "add_rom_layer",
      "remove_layer",
      "add_target",
      "edit_target",
      "remove_target",
      "set_project_description",
    ],
  },
  {
    title: "History and export",
    blurb:
      "There is no save step — an edit is durable when the call returns. " +
      "`changes_since` is the poll that stands in for the socket a browser has.",
    tools: ["changes_since", "undo", "tag_project", "list_tags", "remove_tag", "export_project"],
  },
  {
    title: "Talking",
    blurb: "A message describes no bytes, so it reaches no `.re64` and moves no version.",
    tools: ["post_message", "read_messages"],
  },
];

const PREAMBLE = `# The re64 MCP API

**Generated from the live \`tools/list\` schema** by \`npm run gen:api\`, so this is
what a client actually sees rather than what somebody remembered. A test
regenerates it and compares, because a committed generated file goes stale in
silence.

Companion to \`docs/developer-guide.md\`, which is how to use all this;
\`docs/algebra.md\`, which is why the writes are shaped the way they are; and
\`docs/model.md\`, which is the document these reach. \`docs/decisions/agents.md\`
says why each of them exists and what it replaced.

---

## How it is reached

\`\`\`
claude mcp add --transport http re64 http://127.0.0.1:5164/mcp \\
  --header "X-Re64-User: <user id>"
\`\`\`

The transport is **stateless** — a fresh \`McpServer\` per request — and MCP lives
inside the web server, so an agent's edit goes through the same \`runOps\` a click
does and lands in an open browser without a reload.

**Identity rides on the \`X-Re64-User\` header, never in a tool schema.** A model
can omit a parameter, invent one, or claim to be somebody else, and removing the
parameter later would break every schema carrying it. Three outcomes, kept
apart: a claim matching a known user is that user; a claim matching nothing is
believed and recorded as given; no claim at all is anonymous. \`whoami\` reports
which. Sessions come from \`Mcp-Session-Id\` where the host issues one, or
\`X-Re64-Session\`.

---

## Conventions

**Every tool takes \`project\`. Only the ones that answer for a view take
\`target\`**, and those report the one they used. The rule is whether the answer
contains an **address**: an address is a fact about a stack, and everything else
here is a fact about the project. So a type, a field, a constant, a decoder, a
piece of evidence, a layer and a target are written without naming a view, and
\`list_targets\` — which cannot need one, since it is how you find out what there
is — takes none. A tool advertising an argument it cannot use is worse than one
that is inconsistent.

**Say which view, and there is no default.** A project declaring more than one
target refuses a call that names none, and lists them. There used to be a
\`defaultTarget\` in the document and it is gone: which view somebody is reading
is a property of the reader, so a field in the shared file could not answer it —
and on a project declaring five targets and no default, every call that named
none was answered through whichever one sorted first. Where there is no choice
to make — one target, or none, which implies one over the whole stack — naming
it is not required. Naming a target that does not exist is refused rather than
answered for with a different stack.

**Addresses** are \`"$8000"\`, \`"0x8000"\` or \`32768\`, anywhere an address is
taken. Ranges are inclusive at both ends. \`extent\` is a byte count.

**\`expectVersion\`** on a write refuses if the project has moved since you read
it — the conflict dialog an agent cannot be shown. The version comes from
\`describe_project\`.

### Ids, and the one rule behind most of these signatures

**Everything you can address has an id, and the id is the only handle.**

- **\`add_*\` never takes an id.** The server mints it and hands it back.
- **\`edit_*\` and \`remove_*\` take one, and never create.** An id nothing holds is
  an error, not an invitation.
- **\`edit_*\` names only what changes.** Omitted is left alone; \`null\` clears.
  Sending a whole object reasserts fields you never read, which silently reverts
  a collaborator.
- **A name may resolve on a read and never on a write.** Whether a name is
  unambiguous is a property of what *you* have synced — a name reaching one
  constant for you may reach two for a peer — so a write keyed on one does
  different things depending on what arrived. Select a view by name; remove a
  constant by id.

Auto-generated names (\`sub_\`, \`loc_\`, \`dat_\`), a layer's own entry label and
built-in platform names are marked \`writable: false\` and their ids withheld,
because nothing stored them.

See \`docs/algebra.md\` for the full rules.

**Writes return more than \`ok\`:**

| field | what it says |
|---|---|
| \`did\` | one line per operation, in addresses |
| \`claims\` | each id beside the address it was minted for |
| \`scope\` | \`layer:<id>\`, \`target:<name>\` or \`machine\` — what the claim belongs to |
| \`covers\` | the span, spelled out, when an extent was given |
| \`nestedInside\` | the enclosing claim, when this one landed inside another |
| \`instructions\` | before, after, and the delta a decision unlocked |
| \`orphaned\` | instructions this edit stopped decoding, when it stopped any |
| \`warnings\` | anything this edit made true |
| \`rejected\` | batch entries declined, with the reason |

**The batch contract, on every batch tool:** apply what is applicable, report
what was declined in \`rejected\`, and fail only when nothing was applicable.

---

## The tools
`;

const TENSIONS = `
---

## Known tensions

Written down rather than smoothed over.

**\`find_references\` sees absolute addressing only**, and says so on every
answer. A routine reached through a zero-page or indirect jump appears to have no
callers, which is the opposite of the truth — so the blind spot is stated rather
than left to be inferred from an empty result.

**Statically reachable is smaller than executed**, and the gap is not a defect. A
disagreement with a human listing always has three live explanations: the
annotation is wrong, the decode leading there is wrong, or the program does
something no walk can follow.

**Banking is not modelled.** \`$D000\` is VIC registers or character ROM depending
on \`$01\`, and layers cannot express that — shadowing is static z-order, banking is
runtime alternation. Targets answer the *overlay* half of this and not this half.

**A claim inside an instruction renders no row.** It resolves correctly in
operands and the write says so at the time; the listing has nowhere to draw it.

**\`add_layer\` makes symbols layers only**, with \`add_byte_layer\` and
\`add_rom_layer\` beside it. A naming wart rather than a gap, recorded so it is
not mistaken for one.
`;

/** A tool's arguments, as a table, or nothing where it takes only the common two. */
function argumentsOf(tool: ToolInfo): string {
  const properties = tool.inputSchema?.properties ?? {};
  const required = new Set(tool.inputSchema?.required ?? []);
  // `project` and `target` are on every tool and are documented once above.
  const names = Object.keys(properties).filter((n) => n !== "project" && n !== "target");
  if (names.length === 0) return "";

  const rows = names.map((name) => {
    const property = properties[name];
    const type = property.enum
      ? property.enum.map((v) => `\`${String(v)}\``).join(" \\| ")
      : `\`${property.type ?? "any"}\``;
    const mark = required.has(name) ? "**required**" : "optional";
    const said = (property.description ?? "").replace(/\s+/g, " ").replace(/\|/g, "\\|");
    return `| \`${name}\` | ${type} | ${mark} | ${said} |`;
  });

  return [
    "",
    "| argument | type | | |",
    "|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

/**
 * The document, from the schema.
 *
 * Throws where a tool is in no section or in two, rather than emitting a file
 * that quietly omits it — the failure mode of every hand-maintained list here.
 */
export function generateApiDoc(tools: readonly ToolInfo[]): string {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const placed = new Map<string, string>();

  for (const section of SECTIONS) {
    for (const name of section.tools) {
      if (!byName.has(name)) {
        throw new Error(
          `${section.title} lists ${name}, which the server does not offer. ` +
            `Remove it from SECTIONS or restore the tool.`
        );
      }
      const already = placed.get(name);
      if (already) throw new Error(`${name} is in both ${already} and ${section.title}.`);
      placed.set(name, section.title);
    }
  }

  const missing = tools.filter((t) => !placed.has(t.name)).map((t) => t.name);
  if (missing.length) {
    throw new Error(
      `Not in any section: ${missing.join(", ")}. Put each in one in ` +
        `src/tools/api-doc-source.ts — a tool in no section would be absent ` +
        `from the document with nothing to say so.`
    );
  }

  const body = SECTIONS.map((section) => {
    const tools = section.tools.map((name) => {
      const tool = byName.get(name)!;
      const said = (tool.description ?? "").replace(/\s+/g, " ").trim();
      return `#### \`${name}\`\n\n${said}\n${argumentsOf(tool)}`;
    });
    return `### ${section.title}\n\n${section.blurb}\n\n${tools.join("\n")}`;
  }).join("\n---\n\n");

  return `${PREAMBLE}\n${tools.length} tools.\n\n${body}\n${TENSIONS}`;
}
