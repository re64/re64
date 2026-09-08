import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { generateApiDoc, SECTIONS } from "../../tools/api-doc-source.js";
import { liveTools } from "../../tools/live-tools.js";
import { CLAIM_FIELDS } from "../../core/crdt/doc.js";

/**
 * `docs/api.md` against the server it describes.
 *
 * A committed generated file goes stale in silence, and this one did: the
 * previous `docs/api.md` was written by hand from a schema dump and was wrong
 * about eight tools within a fortnight — describing writes that had been split,
 * renamed, or tightened, with nothing to say so.
 *
 * The generation is split from the writing for the same reason
 * `kernal-effects-source.ts` is, so this can regenerate and compare without
 * touching the file.
 */
describe("the API document against the live schema", () => {
  it("is what the generator produces today", async () => {
    const tools = await liveTools();
    expect(readFileSync("docs/api.md", "utf-8")).toBe(generateApiDoc(tools));
  }, 30_000);

  it("puts every tool in exactly one section", async () => {
    // Generation refuses rather than emitting a document that quietly omits a
    // tool, which is the failure mode of every hand-maintained list here — so
    // this asserts the refusal is reachable rather than only trusting it.
    const tools = await liveTools();
    const placed = SECTIONS.flatMap((s) => s.tools);

    expect([...new Set(placed)]).toHaveLength(placed.length);
    expect(placed.slice().sort()).toEqual(tools.map((t) => t.name).sort());
  }, 30_000);
});

/**
 * Every field the document persists reaches a tool that can write it.
 *
 * **The check that would have caught `Provenance.confidence`.** That field was
 * carried by the model, the CRDT, the serializer, the ops and the export — five
 * layers — and exposed by no tool, no UI and no CLI, so nobody could ever set
 * it. Its own doc comment called it *"the thing the old model had no way to
 * spell"*, and then nothing was wired to spell it.
 *
 * It is the sixth instance of the same shape and the reason invariant **F1**
 * exists: the vocabulary being closed is checked by the compiler, and whether
 * anything ever *reads or writes* a member of it is not. Nothing structural
 * covered it until this, because each layer in isolation was correct.
 *
 * A field that is genuinely derived or internal is listed below with the reason.
 * The list is the point: it makes "nothing can set this" a decision somebody
 * wrote down rather than an accident nobody noticed.
 */
/**
 * What a claim-writing tool actually sets, as opposed to what it takes.
 *
 * `project`, `target` and `expectVersion` are request parameters on every tool,
 * and `id` says *which* claim rather than setting anything. `target` is the
 * sharpest of these: as a tool argument it names the **view** to answer for, and
 * as a claim field it is the **scope** — two meanings for one word, which this
 * check would otherwise conflate into "the scope is writable".
 */
function writableClaimFields(tools: { name: string; inputSchema?: { properties?: Record<string, unknown> } }[]): Set<string> {
  const REQUEST = new Set(["project", "target", "expectVersion", "id"]);
  return new Set(
    tools
      .filter((t) => /^(add|edit)_claim$/.test(t.name))
      .flatMap((t) => Object.keys(t.inputSchema?.properties ?? {}))
      .filter((n) => !REQUEST.has(n))
  );
}

describe("what the document persists against what a tool can write", () => {
  /** Persisted, and deliberately not writable. Each needs a reason. */
  const NOT_WRITTEN: Record<string, string> = {
    id: "minted by the server and returned; a caller never supplies one",
    layer: "the scope, derived from the address — never chosen (see docs/model.md)",
    target: "the same, for a claim no layer supplies bytes for",
    origin:
      "machinery or judgement; `user` for anything a tool writes, and the one " +
      "part of provenance that is a property of the claim rather than of an " +
      "act of vouching — who and how now live on the supporting evidence",
    description:
      "what a name means on this *machine*, carried by the built-in platform " +
      "table — a person's note about an address is a comment, deliberately a " +
      "different object",
  };

  /**
   * Persisted, not writable, and **not on purpose**.
   *
   * Empty, and that is the news. It held `confidence` — a field carried by the
   * model, the CRDT, the serializer, the ops and the export, and settable by
   * nothing — until it was replaced by `method`, which is the axis experiment-0
   * established, and which has since moved off the claim entirely onto the
   * evidence that vouches for it. `add_claim` still takes it and still records
   * it; it simply lands somewhere a second reader can add to rather than
   * overwrite.
   *
   * Kept rather than deleted, because this asserts the set *exactly*: a seventh
   * instance of the shape fails the test, and so does leaving an entry here
   * after it has been settled. An empty list is a claim, not an absence.
   */
  const KNOWN_GAPS: Record<string, string> = {};

  it("leaves no claim field unreachable and unexplained", async () => {
    const tools = await liveTools();
    const writable = writableClaimFields(tools);

    const orphaned = CLAIM_FIELDS.filter(
      (f) => !writable.has(f) && !(f in NOT_WRITTEN)
    );
    expect({ orphaned }).toEqual({ orphaned: Object.keys(KNOWN_GAPS) });
  }, 30_000);

  it("explains nothing it does not have to", async () => {
    // The exemption list is itself a thing that goes stale: an entry for a
    // field that has since become writable would quietly excuse the next one.
    const tools = await liveTools();
    const writable = writableClaimFields(tools);
    const stale = [...Object.keys(NOT_WRITTEN), ...Object.keys(KNOWN_GAPS)].filter(
      (f) => writable.has(f) || !CLAIM_FIELDS.includes(f as (typeof CLAIM_FIELDS)[number])
    );
    expect({ stale }).toEqual({ stale: [] });
  }, 30_000);
});
