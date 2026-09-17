import { describe, it, expect } from "vitest";
import { liveTools } from "../../tools/live-tools.js";
import { generateApiDoc } from "../../tools/api-doc-source.js";

/**
 * Every tool-shaped name in live text is a tool that exists.
 *
 * `add_byte_layer` said "link the layer into a target with set_target" for
 * months after the tool became `edit_target`, and `run_block` called itself the
 * complement of `block_effects` after that became `effects`. Nothing checked,
 * because a description is a string and a string compiles. Invariant F3 says an
 * agent invents tool names from what it reads, and the text is where it reads.
 *
 * The check is over what the transport serves rather than over `tools.ts`, for
 * the reason `live-tools.ts` gives: the schema in front of a tool is the layer
 * nothing else can see. Argument descriptions are walked to any depth, because
 * a nested `.describe` is live text the same as a top one.
 */
describe("tool names in live text", () => {
  it("each name a description or the document uses is a tool that exists", async () => {
    const tools = await liveTools();
    const registry = new Set(tools.map((t) => t.name));

    const texts: { where: string; text: string }[] = [];
    const walk = (where: string, schema: unknown): void => {
      if (!schema || typeof schema !== "object") return;
      const node = schema as { description?: string; properties?: Record<string, unknown>; items?: unknown; anyOf?: unknown[]; oneOf?: unknown[] };
      if (node.description) texts.push({ where, text: node.description });
      for (const [name, child] of Object.entries(node.properties ?? {})) walk(`${where}.${name}`, child);
      if (node.items) walk(`${where}[]`, node.items);
      for (const child of [...(node.anyOf ?? []), ...(node.oneOf ?? [])]) walk(where, child);
    };
    for (const tool of tools) {
      if (tool.description) texts.push({ where: tool.name, text: tool.description });
      walk(tool.name, tool.inputSchema);
    }
    texts.push({ where: "docs/07-api.md", text: generateApiDoc(tools) });

    const unknown = new Map<string, Set<string>>();
    for (const { where, text } of texts) {
      for (const [word] of text.matchAll(/\b[a-z]+(?:_[a-z0-9]+)+\b/g)) {
        if (registry.has(word) || NOT_TOOLS.has(word)) continue;
        if (!unknown.has(word)) unknown.set(word, new Set());
        unknown.get(word)!.add(where);
      }
    }

    expect(
      [...unknown].map(([word, at]) => `${word} (in ${[...at].join(", ")})`)
    ).toEqual([]);
  }, 30_000);
});

/**
 * Tool-shaped names that live text is allowed to use without a tool behind them.
 *
 * The list is the point: a name here is one somebody decided the text should
 * say, with the reason beside it, rather than one that slipped by. Nothing in it
 * is a field or a value — those do not look like tools. So far it holds only
 * names a description says do *not* exist, which is the one honest reason to
 * write a tool name that is not one.
 */
const NOT_TOOLS = new Set<string>([
  // `list_roots` says there is no add_root or remove_root, and why.
  "add_root",
  "remove_root",
]);
