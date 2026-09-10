import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunningServer, startServer } from "../index.js";
import { importProject } from "../../store/index.js";
import { VIEWLESS } from "./views.js";

/**
 * The agent-facing endpoint, spoken to as an agent would.
 *
 * Raw JSON-RPC rather than an SDK client: what matters is that a stock client
 * can talk to this, and a test using the same library on both ends would only
 * prove the library agrees with itself.
 */

let dir: string;
let server: RunningServer;
let endpoint: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "re64-mcp-"));
  const projectPath = join(dir, "gridrunner.re64");
  copyFileSync("assets/gridrunner/gridrunner.re64", projectPath);
  copyFileSync("assets/gridrunner/gridrunner.prg", join(dir, "gridrunner.prg"));
  const { databasePath } = importProject(projectPath);

  server = startServer({ projectPath: databasePath, port: 0, host: "127.0.0.1", quiet: true });
  await server.ready;
  endpoint = `http://127.0.0.1:${server.port}/mcp`;
});

afterEach(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

/** The transport answers as an event stream, so the payload needs unwrapping. */
async function rpc(method: string, params?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-re64-user": "usr_agent",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  return JSON.parse((line ?? text).replace(/^data: /, "")) as Record<string, unknown>;
}

const callTool = async (name: string, args: Record<string, unknown> = {}) => {
  const reply = (await rpc("tools/call", { name, arguments: args })) as {
    result?: { content: { text: string }[]; isError?: boolean };
    error?: { message: string };
  };
  if (reply.error) throw new Error(reply.error.message);
  const text = reply.result!.content[0].text;
  const isError = reply.result!.isError === true;
  // A refusal is prose for the model to read, not a payload to destructure.
  return { isError, text, value: (isError ? undefined : JSON.parse(text)) as never };
};

describe("speaking the protocol", () => {
  it("introduces itself", async () => {
    const reply = (await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    })) as { result: { serverInfo: { name: string }; capabilities: { tools?: unknown } } };

    expect(reply.result.serverInfo.name).toBe("re64");
    expect(reply.result.capabilities.tools).toBeDefined();
  });

  it("says which mechanism answers which question", async () => {
    /**
     * The instructions carry what no per-tool description can, because this is
     * about choosing *between* tools. Three runs did the wrong thing with the
     * right one available: `sprite(...)` and `where` unused while a reader
     * computed sprite addresses by hand eight times; `find_immediates` called
     * six times and `add_constant` never, in two runs that declared zero
     * constants where the run before declared eighteen; and forty-two level
     * names carved out of a table as nested claims, which is a record field.
     *
     * Asserted so it cannot quietly rot back to describing only the system.
     */
    const { result } = (await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    })) as { result: { instructions?: string } };

    const said = result.instructions ?? "";
    for (const mechanism of ["add_claim", "add_constant", "bind_constants", "add_type", "where"]) {
      expect(said, mechanism).toContain(mechanism);
    }
    // The place forms, which nothing found on its own in three runs.
    expect(said).toContain("sprite[pointer]");
    expect(said).toContain("screen[row,column]");
    // And the one that says nesting is the wrong tool for structure.
    expect(said.toLowerCase()).toContain("field instead");
    // The four things worth naming as a constant. One run declared eighteen and
    // the two after it declared none, while calling find_immediates six times —
    // and every one of these shapes turned out to be wanted. What was missing
    // was never the mechanism, so it is the description that carries the fix.
    for (const idiom of ["count", "bit mask", "members of a set"]) {
      expect(said, idiom).toContain(idiom);
    }

    // **Everything a reader has to reach for, named here.** A per-tool
    // description cannot say which tool answers which question, and every
    // mechanism below was built, shipped, and then went unused by a run that
    // needed it: evidence three times in the project's history, `where` twice,
    // constants never. This paragraph is where that is fixed, so it is asserted
    // rather than trusted to stay written.
    for (const mechanism of [
      "add_evidence",
      "disagreements",
      "describe_project",
      "bind_primary_name",
      "claims_at",
      "list_targets",
      "run_scenario",
      "find_undecoded",
      "preview",
      "effects",
    ]) {
      expect(said, mechanism).toContain(mechanism);
    }

    // And the three concepts a document with somebody else's work in it needs,
    // which no run before the eleventh could have met.
    expect(said).toContain("You may not be the first here");
    expect(said).toContain("re-verifies");
    expect(said).toContain("A target is a view");
  });

  it("answers more than one request, which a shared transport would not", async () => {
    // A transport carries the state of one request-response cycle. Reusing one
    // silently answers nothing after the first.
    await rpc("tools/list");
    const second = (await rpc("tools/list")) as { result: { tools: unknown[] } };
    expect(second.result.tools.length).toBeGreaterThan(0);
  });

  it("offers the tools an agent needs to decide and to act", async () => {
    const reply = (await rpc("tools/list")) as { result: { tools: { name: string }[] } };
    const names = reply.result.tools.map((t) => t.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "list_projects",
        "describe_project",
        "read_disassembly",
        "find_references",
        "find_unnamed",
        "changes_since",
        "add_claim",
        "add_claims",
        "claims_at",
        "list_roots",
        "add_rom_layer",
        "add_type",
        "edit_type",
        "remove_type",
        "list_types",
        "disagreements",
        "edit_claim",
        "remove_claim",
        "list_claims",
        "mark_function",
        "unmark_function",
        "undo",
      ])
    );

    // Gone, not aliased. An agent rediscovers this surface from the schema
    // every session and has no persisted callers, so a deprecated name is a
    // second vocabulary to learn for nothing — and the whole point of the
    // claims redesign is that there is one noun.
    for (const retired of [
      "add_label",
      "add_labels",
      "rename_label",
      "remove_label",
      "list_labels",
      "set_region",
      "set_regions",
      "remove_region",
      "set_primary_label",
      "bind_label",
      "unbind_label",
      "add_root",
      "remove_root",
    ]) {
      expect(names).not.toContain(retired);
    }
  });

});

describe("declaring constants over the wire", () => {
  /**
   * The schema in front of `addConstant` is tested by nothing else.
   *
   * Both `run_block` bugs got through a green suite for exactly this reason:
   * `Workspace` is tested thoroughly and the schema in front of it was not, so
   * everything the tests exercised worked and the tool could not be called. This
   * grew a tool and changed two schemas, so it grows a transport test.
   */
  it("adds rather than replaces, and hands back the id", async () => {
    const first = await callTool("add_constant", { name: "SHIELD_FLAG", value: "$04" });
    const second = await callTool("add_constant", { name: "SHIELD_FLAG", value: "$08" });
    expect(first.isError).toBe(false);
    expect(second.isError).toBe(false);

    const a = (first.value as { constant: string }).constant;
    const b = (second.value as { constant: string }).constant;
    expect(a).not.toBe(b);

    const listed = (await callTool("list_constants")).value as {
      constants: { id: string; name: string; value: string }[];
    };
    const held = listed.constants.filter((c) => c.name === "SHIELD_FLAG");
    expect(held.map((c) => c.value).sort()).toEqual(["$04", "$08"]);
    // Ids are returned, or nothing downstream can say which one it means.
    expect(held.every((c) => typeof c.id === "string" && c.id.length > 0)).toBe(true);
  });

  it("revises by id, and a name reaches no write at all", async () => {
    const first = await callTool("add_constant", { name: "SHIELD_FLAG", value: "$04" });
    await callTool("add_constant", { name: "SHIELD_FLAG", value: "$08" });

    const edited = await callTool("edit_constant", {
      id: (first.value as { constant: string }).constant,
      name: "SHIELD_BIT",
    });
    expect(edited.isError).toBe(false);

    // A name reaches a write nowhere on this surface: whether it is
    // "unambiguous" depends on what you have synced, so the same call would
    // remove different things for two peers.
    const byName = await callTool("remove_constant", { name: "SHIELD_FLAG" });
    expect(byName.isError).toBe(true);

    const ambiguous = await callTool("remove_constant", { id: "cst_nope" });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.text).toContain("No constant");
  });

  it("takes a hex string or a number for the value, like every other address", async () => {
    // The `run_block` lesson: byte values had to be numbers while addresses could
    // be `$8100`, so the API was inconsistent with itself and every caller found
    // out by being rejected.
    const hex = await callTool("add_constant", { name: "AS_HEX", value: "$0F" });
    const dec = await callTool("add_constant", { name: "AS_NUMBER", value: 15 });
    expect(hex.isError).toBe(false);
    expect(dec.isError).toBe(false);
  });
});

describe("drawing a span", () => {
  /**
   * The schema, over the real transport — the only layer where this class of
   * defect exists, and the rule this file was written for: if a tool grows an
   * argument, it grows a transport test.
   */
  it("draws a sheet and hands back a url rather than the bytes", async () => {
    const { value, isError } = await callTool("render", {
      start: "$8E00",
      length: 512,
      view: "char:8",
    });
    expect(isError).toBe(false);
    const sheet = value as { url: string; cells: number; width: number; height: number };
    // Gridrunner's font: 64 glyphs of eight bytes, eight to a row.
    expect(sheet.cells).toBe(64);
    expect(sheet.width).toBe(64);
    expect(sheet.height).toBe(64);
    expect(sheet.url).toContain("/api/blob");
    expect(sheet.url).toContain(".png");
  });

  it("animates the same cells when asked", async () => {
    const { value, isError } = await callTool("render", {
      start: "$8E00",
      length: 64,
      view: "char:1",
      as: "frames",
      delayMs: 200,
    });
    expect(isError).toBe(false);
    const animation = value as { frames: number; delayMs: number; width: number };
    expect(animation.frames).toBe(8);
    expect(animation.delayMs).toBe(200);
    expect(animation.width).toBe(8);
  });

  it("draws a claim by id, using the claim's own view", async () => {
    // A name that addresses nothing is a display string. Naming a span once
    // should make it drawable by name for ever after.
    const made = await callTool("add_claim", {
      address: "$8E00",
      name: "characterSetData",
      is: "bitmap",
      view: "char:8",
      extent: 512,
    });
    expect(made.isError).toBe(false);
    // Every write returns the ids it minted, keyed `claim` beside the address.
    const id = (made.value as { claims: { claim: string }[] }).claims[0].claim;

    const { value, isError, text } = await callTool("render", { claim: id });
    expect(isError, text).toBe(false);
    const drawn = value as { cells: number; view: string; name: string; from: string };
    expect(drawn.from).toBe("$8E00");
    expect(drawn.cells).toBe(64);
    expect(drawn.view).toBe("char:8");
    expect(drawn.name).toBe("characterSetData");

    // And the view can be overridden without editing the claim, because hires
    // versus multicolour is a runtime bit that is not in the data.
    const other = await callTool("render", { claim: id, view: "sprite" });
    expect(other.isError).toBe(false);
    expect((other.value as { view: string }).view).toBe("sprite");

    // The listing can be pointed at the same claim.
    const listed = await callTool("export_listing", { claim: id });
    expect(listed.isError).toBe(false);
    expect((listed.value as { name: string }).name).toBe("characterSetData");
  });

  it("refuses a claim and a span together, and an id nothing holds", async () => {
    const both = await callTool("render", {
      claim: "clm_whatever",
      start: "$8E00",
      length: 8,
      view: "char:1",
    });
    expect(both.isError).toBe(true);
    expect(both.text).toContain("not both");

    const missing = await callTool("render", { claim: "clm_nothing" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("No claim");
  });

  it("refuses a view it cannot draw, and says what it takes", async () => {
    // A refusal is prose for the model to read, so this asserts the prose.
    const { text, isError } = await callTool("render", {
      start: "$8E00",
      length: 64,
      view: "petscii",
    });
    expect(isError).toBe(true);
    expect(text).toContain("sprite-multi");
  });

  it("refuses a span too short for one cell rather than drawing nothing", async () => {
    const { isError } = await callTool("render", { start: "$8E00", length: 4, view: "char:1" });
    expect(isError).toBe(true);
  });
});

describe("a layer nobody links supplies nothing", () => {
  /**
   * Two consecutive experiments lost real work to this. Run 9's editor called
   * `add_rom_layer` twice, got `ok` twice, saw no change, decided the problem
   * was `reference: true`, and uploaded the ROMs again as raw bytes *while*
   * creating a target that linked them — two variables at once, and it credited
   * the wrong one in notes that run 10's editor then inherited. Run 10 declared
   * three ROM layers, linked none, and hand-wrote a KERNAL shim instead of
   * using the ROMs on the disk.
   *
   * `ok: true` on a write nothing can see is the confident wrong answer in
   * miniature, so both halves of the mistake are now reported.
   */
  it("says nothing about linking where there is only one view to be in", async () => {
    // **The advice used to fire here, and it was wrong.** It read the project
    // *after* the loader had synthesised a view for a file declaring none — a
    // view that links every layer, this one included — and then reported the
    // layer as linked into nothing. Read from the document, the condition is
    // what it always meant: a project that declares targets, and a layer no
    // declared target links. That case is the test below, which builds one.
    const made = await callTool("add_rom_layer", { rom: "characters" });
    // The ROM may be absent on this machine; the advice must not depend on it.
    if (made.isError) return;
    const value = made.value as { note?: string; linkedInto?: string[] };
    expect(value.linkedInto).toBeUndefined();
    expect(value.note).toBeUndefined();
  });

  it("names the ROMs a new view leaves out, since it will boot into zeros", async () => {
    // `list_targets` reports every layer, including ones no view links — which
    // is how a caller finds the id to link in the first place.
    const seen = (await callTool("list_targets", {})).value as {
      layers: { id: string; type: string }[];
    };
    const someLayer = seen.layers.find((l) => l.type !== "symbols")?.id;
    expect(someLayer).toBeDefined();

    const rom = await callTool("add_rom_layer", { rom: "kernal" });
    if (rom.isError) return; // no ROM on this machine; the advice is not the point

    const made = await callTool("add_target", {
      name: "reading-only",
      layers: [{ layer: someLayer }],
    });
    expect(made.isError, made.text).toBe(false);
    const value = made.value as { romsNotLinked?: string[]; romNote?: string };
    expect(value.romsNotLinked?.length).toBeGreaterThan(0);
    expect(value.romNote).toContain("boots into $0000");
  });
});

describe("reading a span without saying what it is", () => {
  /**
   * The most repeated workaround of experiment 10. Reader one decoded about
   * twenty strings by hand across six script runs; reader two a dozen more, and
   * probed undecoded spans by force-adding a root, reading, and reverting —
   * twenty times, six of which had to be undone. `render` had always done this
   * for pictures; text and code had no equivalent, so the only way to find out
   * was to write a claim in a document somebody else is reading.
   */
  it("shows every encoding when none is named", async () => {
    const { value, isError } = await callTool("preview", {
      start: "$8E00",
      length: 16,
      as: "text",
    });
    expect(isError, "preview text").toBe(false);
    const seen = value as { alternatives?: Record<string, string>; text: string };
    // Four now: `keycode` reads bytes as keyboard matrix positions, which is
    // what a key table holds and what reads as noise under the other three.
    expect(Object.keys(seen.alternatives ?? {}).sort()).toEqual([
      "ascii",
      "keycode",
      "petscii",
      "screen",
    ]);
  });

  it("takes one encoding when named, and offers no alternatives", async () => {
    const { value } = await callTool("preview", {
      start: "$8E00",
      length: 16,
      as: "text",
      encoding: "screen",
    });
    const seen = value as { encoding: string; alternatives?: unknown };
    expect(seen.encoding).toBe("screen");
    expect(seen.alternatives).toBeUndefined();
  });

  it("counts what did not decode and what is undocumented, without deciding", async () => {
    // The evidence for "is this code", not the verdict: data read as code
    // usually shows both, real code usually shows neither.
    const code = (await callTool("preview", { start: "$8000", length: 32, as: "code" }))
      .value as { lines: string[]; undecodable: number; illegal: number; note: string };
    expect(code.lines.length).toBeGreaterThan(0);
    expect(code.undecodable).toBeGreaterThanOrEqual(0);
    expect(code.note).toContain("Nothing has been written");
  });

  it("hands a record back decoded, which is the read side of add_type", async () => {
    const type = await callTool("add_type", {
      name: "PreviewProbe",
      size: 4,
      fields: { 0: { name: "first", type: "u8" }, 1: { name: "word", type: "ptr" } },
    });
    expect(type.isError, type.text).toBe(false);
    const typeId = (type.value as { type: string }).type;

    const { value, isError, text } = await callTool("preview", {
      start: "$8000",
      length: 12,
      as: "record",
      typeId,
    });
    expect(isError, text).toBe(false);
    const seen = value as {
      count: number;
      records: { at: string; fields: Record<string, string> }[];
    };
    expect(seen.count).toBe(3);
    expect(Object.keys(seen.records[0].fields).sort()).toEqual(["first", "word"]);
  });

  it("refuses a record read with no layout, and one too short for a record", async () => {
    const noType = await callTool("preview", { start: "$8000", length: 8, as: "record" });
    expect(noType.isError).toBe(true);
    expect(noType.text).toContain("typeId");
  });
});

describe("the three claim writers carry the same fields", () => {
  /**
   * They did not. `add_claim` took `typeId` and `method`; the batch took
   * neither, so reader two of experiment 10 made every claim singly to keep
   * provenance — "This cost turns but kept provenance honest." And
   * `edit_claim`'s `is` had no `record`, so a record claim could be created and
   * never corrected, reported in two consecutive runs.
   *
   * The workspace supported all of it. Only the schemas refused.
   */
  it("takes method and a record layout in the batch", async () => {
    const type = await callTool("add_type", {
      name: "BatchProbe",
      size: 4,
      fields: { 0: { name: "whole", type: "bytes(4)" } },
    });
    expect(type.isError, type.text).toBe(false);
    const typeId = (type.value as { type: string }).type;

    const made = await callTool("add_claims", {
      claims: [
        { address: "$8100", name: "batchOne", method: "derived" },
        { address: "$8110", name: "batchTwo", is: "record", typeId, extent: 4, method: "ran" },
      ],
    });
    expect(made.isError, made.text).toBe(false);

    const at = (await callTool("claims_at", { address: "$8110" })).value as {
      claims: { name?: string; is?: string; typeId?: string; by?: { method?: string }[] }[];
    };
    const mine = at.claims.find((c) => c.name === "batchTwo")!;
    expect(mine.is).toBe("record");
    expect(mine.typeId).toBe(typeId);
    // The batch mints a vouching per claim, exactly as the single writer does —
    // which is the property this test exists for: three writers, same fields.
    expect(mine.by?.[0].method).toBe("ran");
  });

  it("revises how you know, without forgetting who said it", async () => {
    const made = await callTool("add_claim", {
      address: "$8120",
      name: "guessedFirst",
      method: "guessed",
    });
    expect(made.isError, made.text).toBe(false);
    const id = (made.value as { claims: { claim: string }[] }).claims[0].claim;

    // "I guessed, then I ran it" is the movement this axis exists to record,
    // and it was unsayable: method could be set at creation and nowhere else.
    const edited = await callTool("edit_claim", { id, method: "ran" });
    expect(edited.isError, edited.text).toBe(false);

    const at = (await callTool("claims_at", { address: "$8120" })).value as {
      claims: { id: string; origin?: string; by?: { author: string; method?: string }[] }[];
    };
    const mine = at.claims.find((c) => c.id === id)!;

    // **Revised in place, not stacked.** How you know lives on *your own*
    // vouching now, so changing it edits that record rather than adding a
    // second — somebody else's account of the same claim is theirs, and
    // rewriting it would be the overwrite this model was rebuilt to stop.
    expect(mine.by).toHaveLength(1);
    expect(mine.by![0].method).toBe("ran");
    expect(mine.by![0].author).toBeTruthy();
    // And the claim itself says only what kind of thing it is.
    expect(mine.origin).toBe("user");
  });
});

describe("naming a value has an on-ramp", () => {
  /**
   * `find_immediates` exists to be the way in to constants — "the query behind
   * a dropdown for a person and a batch for an agent". Both readers in
   * experiment 10 called it six times between them, saw the sites, and declared
   * **zero** constants; the run before the claims model declared eighteen.
   *
   * The tool answered its question and stopped, which is out of step with a
   * surface where a nested claim names how to replace it and an indirect jump
   * names `mark_function`. So the answer now says what to do next, and this
   * asserts it rather than trusting a description to stay written.
   */
  it("says how many values are unnamed, and what to call next", async () => {
    const { value, isError } = await callTool("find_immediates", {});
    expect(isError).toBe(false);
    const found = value as { total: number; unnamed?: number; next?: string };
    expect(found.total).toBeGreaterThan(0);
    expect(found.unnamed).toBeGreaterThan(0);
    expect(found.next).toContain("add_constant");
    expect(found.next).toContain("bind_constants");
  });

  it("stops saying it once every site is named", async () => {
    // The hint is a work queue, not decoration: an answer where nothing is left
    // to name should not still be telling somebody to name something.
    const sites = (
      (await callTool("find_immediates", { value: "$01" })).value as {
        sites: { address: string }[];
      }
    ).sites.slice(0, 2);
    expect(sites.length).toBeGreaterThan(0);

    const made = await callTool("add_constant", { name: "ONE_THING", value: "$01" });
    expect(made.isError, made.text).toBe(false);
    const id = (made.value as { constant: string }).constant;

    const bound = await callTool("bind_constants", {
      bindings: sites.map((s) => ({ address: s.address, constant: id })),
    });
    expect(bound.isError, bound.text).toBe(false);

    const after = (await callTool("find_immediates", { value: "$01" })).value as {
      sites: { address: string; boundTo?: string }[];
    };
    const named = after.sites.filter((s) => s.boundTo === "ONE_THING");
    expect(named.length).toBe(sites.length);
  });
});

describe("undoing a rebind puts back what was there", () => {
  /**
   * **A bind mints a fresh use id, and the inverse looked the pre-state up by
   * it.** On a rebind that id does not exist yet, so nothing was found, the
   * inverse became `unbind`, and undoing a rebind cleared the site rather than
   * restoring the constant it replaced. The keying fix is what makes the right
   * answer available: one binding per site, so "what was here" has one answer.
   */
  it("restores the first constant after a rebind is undone", async () => {
    const sites = (
      (await callTool("find_immediates", { value: "$01" })).value as {
        sites: { address: string }[];
      }
    ).sites;
    expect(sites.length).toBeGreaterThan(0);
    const at = sites[0].address;

    const one = (
      (await callTool("add_constant", { name: "FIRST_ONE", value: "$01" })).value as {
        constant: string;
      }
    ).constant;
    const other = (
      (await callTool("add_constant", { name: "SECOND_ONE", value: "$01" })).value as {
        constant: string;
      }
    ).constant;

    expect((await callTool("bind_constant", { address: at, constant: one })).isError).toBe(false);
    expect((await callTool("bind_constant", { address: at, constant: other })).isError).toBe(
      false
    );

    const boundTo = async (): Promise<string | undefined> =>
      (
        (await callTool("find_immediates", { value: "$01" })).value as {
          sites: { address: string; boundTo?: string }[];
        }
      ).sites.find((s) => s.address === at)?.boundTo;

    // One binding at the site, and it is the second one.
    expect(await boundTo()).toBe("SECOND_ONE");

    const undone = await callTool("undo", {});
    expect(undone.isError, undone.text).toBe(false);
    expect(await boundTo()).toBe("FIRST_ONE");
  });
});

describe("what counts as explained", () => {
  /**
   * `find_undecoded` is a work queue, so a kind it does not recognise tells a
   * reader their finished work is unfinished.
   *
   * It was a hand-written list of four interpretation kinds and `record` was
   * added to the union afterwards without being added to it. Both readers in
   * experiment 10 hit it independently: one declared four 52-byte records and
   * watched all 208 bytes stay in the queue, then cross-checked every record
   * claim by hand rather than trust the count. That is the tool actively
   * punishing the deepest work available.
   */
  it("counts a record claim as explaining its bytes", async () => {
    const before = await callTool("find_undecoded", { limit: 200 });
    const covering = (value: unknown, at: number) =>
      (value as { spans: { start: string; end: string }[] }).spans.filter(
        (s) => parseInt(s.start.slice(1), 16) <= at && at <= parseInt(s.end.slice(1), 16)
      );
    // The largest span still unexplained, so the assertion has something to
    // move whatever else this file has already claimed.
    const spans = (before.value as { spans: { start: string; bytes: number }[] }).spans;
    expect(spans.length, "nothing left unexplained to probe with").toBeGreaterThan(0);
    const span = spans[0];
    const size = Math.min(16, span.bytes);
    const at = parseInt(span.start.slice(1), 16);

    const type = await callTool("add_type", {
      name: "Probe",
      size,
      // Keyed by offset: two fields cannot share one, so the key *is* the
      // identity and two people adding different fields both survive.
      fields: { 0: { name: "whole", type: `bytes(${size})` } },
    });
    expect(type.isError, type.text).toBe(false);
    const typeId = (type.value as { type: string }).type;

    const claim = await callTool("add_claim", {
      address: span.start,
      is: "record",
      typeId,
      extent: size,
      name: "probeRecord",
    });
    expect(claim.isError, claim.text).toBe(false);

    const after = await callTool("find_undecoded", { limit: 200 });
    // The span is either gone or shortened — what must not happen is that the
    // same bytes are still reported as saying nothing.
    const still = covering(after.value, at);
    expect(still, "record claim did not explain its own bytes").toEqual([]);
  });
});

describe("reading a named view", () => {
  /**
   * The behavioural half of `target.test.ts`. Two tools shipped answering for
   * the project's default view whatever was asked — and the failure was
   * invisible, because both returned a perfectly good answer about the wrong
   * thing.
   */
  it("narrows what it lists to the target it was given", async () => {
    // Gridrunner declares no targets, so an unknown one must be refused rather
    // than quietly answered for the default — which is the behaviour that makes
    // a wrong answer impossible rather than merely unlikely.
    const { isError, text } = await callTool("list_claims", { target: "nonesuch" });
    expect(isError).toBe(true);
    expect(text).toMatch(/target/i);
  });

  it("says which view every answer was computed for", async () => {
    // Being told is what turns "always name your target" into a habit the API
    // teaches rather than a rule it enforces.
    for (const tool of ["list_claims", "export_listing", "describe_project"]) {
      const { value, isError } = await callTool(tool, {});
      expect(isError, tool).toBe(false);
      expect(value, tool).toHaveProperty("target");
    }
  });
});

describe("saying where something is", () => {
  /**
   * The arithmetic experiment 8's readers did by hand over and over, and asked
   * for by name three times. Over the real transport, because the interesting
   * half is the address *schema* — which every tool shares, so this reaches all
   * of them at once.
   */
  it("accepts a place wherever an address goes", async () => {
    const { value, isError } = await callTool("read_bytes", {
      start: "screen(10,2)",
      length: 1,
    });
    expect(isError).toBe(false);
    expect((value as { start: string }).start).toBe("$0592");
  });

  it("accepts a sprite pointer the same way", async () => {
    const { value, isError } = await callTool("read_bytes", { start: "sprite($9D)", length: 1 });
    expect(isError).toBe(false);
    expect((value as { start: string }).start).toBe("$2740");
  });

  it("goes the other way, and says what it assumed", async () => {
    const { value, isError } = await callTool("where", { address: "$0592" });
    expect(isError).toBe(false);
    const at = value as {
      screen: { row: number; column: number; colourRam: string };
      sprite: { pointer: string; startsHere: boolean };
      assumed: { screenBase: string; vicBank: string };
    };
    expect(at.screen.row).toBe(10);
    expect(at.screen.column).toBe(2);
    expect(at.screen.colourRam).toBe("$D992");
    // The assumptions are the point: both bases are runtime state, so an answer
    // that did not name them would be wrong for any program that moved them.
    expect(at.assumed.screenBase).toBe("$0400");
    expect(at.assumed.vicBank).toBe("$0000");
  });

  it("follows a screen the program moved", async () => {
    const { value, isError } = await callTool("where", {
      address: "$4192",
      screenBase: "$4000",
    });
    expect(isError).toBe(false);
    expect((value as { screen: { row: number } }).screen.row).toBe(10);
  });

  it("refuses a place that is not one, rather than guessing", async () => {
    const { isError, text } = await callTool("read_bytes", { start: "screen(99,0)", length: 1 });
    expect(isError).toBe(true);
    expect(text).toContain("not on the screen");
  });

  it("is not an expression language", async () => {
    // A call is a lookup with parentheses. Arithmetic would be a grammar.
    const { isError } = await callTool("read_bytes", { start: "sprite($9D)+3", length: 1 });
    expect(isError).toBe(true);
  });
});

describe("working on a project", () => {
  it("orients from nothing", async () => {
    const { value } = await callTool("list_projects");
    expect((value as { projects: { id: string }[] }).projects[0].id).toBe("gridrunner");
  });

  it("reports what has been understood and what has not", async () => {
    const { value } = await callTool("describe_project");
    const counts = (value as { counts: { namedByHand: number; namedAutomatically: number } })
      .counts;

    expect(counts.namedByHand).toBeGreaterThan(0);
    expect(counts.namedAutomatically).toBeGreaterThan(0);
  });

  it("ranks what to work on", async () => {
    const { value } = await callTool("find_unnamed", { kind: "calls", limit: 3 });
    const { targets } = value as { targets: { name: string; references: number }[] };

    expect(targets).toHaveLength(3);
    expect(targets[0].references).toBeGreaterThanOrEqual(targets[2].references);
    expect(targets[0].name).toMatch(/^sub_/);
  });

  it("shows callers with the line that calls them", async () => {
    const { value } = await callTool("find_references", { address: "$8870", direction: "in" });
    const { inbound, incomplete } = value as {
      inbound: { from: string; text: string; inRoutine?: string }[];
      incomplete: string;
    };

    expect(inbound.length).toBeGreaterThan(0);
    expect(inbound.some((r) => r.text.includes("JSR"))).toBe(true);
    // Which routine the call sits in: "who calls this" is a question about
    // names, and the answer used to be a bag of addresses.
    expect(inbound.some((r) => r.inRoutine !== undefined)).toBe(true);
    // Stated on every answer, because a reader that trusts it would otherwise
    // conclude a routine has no callers when it has several.
    expect(incomplete).toMatch(/zero-page/i);
  });

  it("returns disassembly that can be acted on, not only printed", async () => {
    const { value } = await callTool("read_disassembly", { start: "$8011", lines: 5 });
    const { lines, truncated, nextStart } = value as {
      lines: { text: string; mnemonic?: string }[];
      truncated: boolean;
      nextStart?: string;
    };

    expect(lines).toHaveLength(5);
    expect(lines.some((l) => l.mnemonic)).toBe(true);
    expect(truncated).toBe(true);
    expect(nextStart).toMatch(/^\$[0-9A-F]{4}$/);
  });

  it("accepts an address however it is written", async () => {
    for (const start of ["$8011", "0x8011", "32785"]) {
      const { value } = await callTool("read_disassembly", { start, lines: 1 });
      expect((value as { start: string }).start).toBe("$8011");
    }
  });
});

describe("talking to whoever else is here", () => {
  it("says something and reads it back", async () => {
    await callTool("post_message", { text: "$8000 is a cartridge header, not code" });
    const { value } = await callTool("read_messages", {});
    const chat = value as { total: number; messages: { from: string; text: string }[] };
    expect(chat.total).toBe(1);
    expect(chat.messages[0].text).toBe("$8000 is a cartridge header, not code");
  });

  it("is attributed to the session codename, so two agents are distinguishable", async () => {
    // The user id would be the same string for two agents sharing a credential.
    await callTool("post_message", { text: "working on the zapper routines" });
    const { value } = await callTool("read_messages", {});
    const chat = value as { messages: { from: string }[] };
    expect(chat.messages.at(-1)!.from).toMatch(/^[a-z]+$/);
  });

  it("shows in the history, which is how a session learns talk is waiting", async () => {
    // **This asserted the opposite**, on the ground that a conversation is not
    // an edit. It still is not — chat moves no version and re-analyses nothing —
    // but it has to reach the feed, because the feed is how a session finds out
    // that anything is waiting for it without merging first.
    const before = (await callTool("changes_since", {})).value as { cursor: number };
    await callTool("post_message", { text: "not an annotation" });
    const after = (await callTool("changes_since", { cursor: before.cursor })).value as {
      changes: { did: string }[];
    };
    expect(after.changes.some((c) => c.did.includes("not an annotation"))).toBe(true);
  });

  it("does not reach the listing or the analysis", async () => {
    // What the old fifth-root design was protecting, kept: chat is in the file
    // now, and it still describes no bytes — so it appears in no listing and
    // nothing about the program is re-derived when somebody speaks.
    await callTool("post_message", { text: "keep-this-out-of-the-listing" });
    const { value } = await callTool("export_listing", {});
    expect(JSON.stringify(value)).not.toContain("keep-this-out-of-the-listing");

    const { value: described } = await callTool("describe_project", {});
    expect(JSON.stringify(described)).not.toContain("keep-this-out-of-the-listing");
  });

  it("refuses an empty message rather than posting a blank row", async () => {
    const { isError } = await callTool("post_message", { text: "   " });
    const { value } = await callTool("read_messages", {});
    const chat = value as { messages: { text: string }[] };
    expect(isError || chat.messages.every((m) => m.text.trim().length > 0)).toBe(true);
  });
});

describe("asking what a routine does", () => {
  it("says what a block touches without running it", async () => {
    const { value } = await callTool("effects", { address: "$8015", follow: "block" });
    const effects = value as { reads: string[]; writes: string[]; unmodelled: unknown[] };
    expect(effects.reads).toContain("X");
    expect(effects.writes).toContain("Z");
    expect(effects.unmodelled).toEqual([]);
  });

  it("declares several regions at once, and reports the ones it declined", async () => {
    // The last write with no batch form, and the most used of all of them: 129
    // of 648 calls in one collaborative run, a round trip each. Partial, like
    // every other batch here — one bad span must not lose the rest.
    const { isError, value } = await callTool("add_claims", {
      claims: [
        { address: "$8E00", extent: 0x40, is: "data", name: "batchOne" },
        { address: "$8E40", extent: 0x40, is: "data", name: "batchTwo" },
        // Says nothing at all: rejected, and the others still land.
        { address: "$8F00" },
      ],
    });
    expect(isError).toBeFalsy();
    const result = value as { rejected?: { address: string }[]; did: string[] };
    expect(result.rejected?.map((r) => r.address)).toEqual(["$8F00"]);
    expect(result.did.length).toBeGreaterThanOrEqual(2);
  });

  it("takes an inclusive address range on list_labels", async () => {
    // Every other range on this surface has an inclusive end — `set_region`,
    // `export_listing` — and this one was half-open with `to` carrying no
    // description at all, so asking about a single address came back empty.
    const { value } = await callTool("list_claims", { from: "$8000", to: "$8000" });
    expect((value as { total: number }).total).toBeGreaterThan(0);
  });

  it("takes every value of follow, and defaults to calls", async () => {
    // The schema in front of a tool is the one layer neither the Workspace
    // tests nor the analysis tests can reach — both run_block bugs got through
    // a green suite exactly here.
    const sizes: Record<string, number> = {};
    for (const follow of ["block", "routine", "calls", "returning"]) {
      const { isError, value } = await callTool("effects", { address: "$8172", follow });
      expect(isError).toBeFalsy();
      const answer = value as { scope: string; reads: string[]; writes: string[] };
      expect(answer.scope).toBe(follow);
      sizes[follow] = answer.reads.length + answer.writes.length;
    }
    expect(sizes.block).toBeLessThanOrEqual(sizes.routine);
    expect(sizes.returning).toBeLessThanOrEqual(sizes.calls);

    const { value } = await callTool("effects", { address: "$8172" });
    expect((value as { scope: string }).scope).toBe("calls");
  });

  it("points somewhere useful when no block covers the address", async () => {
    // "No decoded block covers $8000" is true and a dead end. The nearest block
    // start is the next call.
    const { isError, text } = await callTool("effects", { address: "$8000", follow: "block" });
    expect(isError).toBe(true);
    expect(text).toMatch(/nearest starts at \$[0-9A-F]{4}/);
  });

  it("runs a block with only the registers the caller cares about", async () => {
    // Every reader in experiment 2 passed one register and was rejected for
    // omitting the other ten. The schema demanded a complete set and nothing
    // said so.
    const { value } = await callTool("run_block", { address: "$8015", registers: { X: 5 } });
    expect((value as { registers: Record<string, string> }).registers.X).toBe("$06");
  });

  it("takes a byte the way it takes an address", async () => {
    // This API accepts $8100 for an address, so refusing $05 for a value is
    // inconsistent with itself — which is exactly how every caller found out.
    for (const x of [5, "5", "$05", "0x05"]) {
      const { value } = await callTool("run_block", { address: "$8015", registers: { X: x } });
      expect((value as { registers: Record<string, string> }).registers.X).toBe("$06");
    }
  });

  it("reports which way the branch went, which is the point of running it", async () => {
    // INX / CPX #$07 / BNE. At 6 the counter reaches 7 and falls through; below
    // that it branches. The same block, two decisions.
    const branched = await callTool("run_block", { address: "$8015", registers: { X: "$01" } });
    expect((branched.value as { exit: { kind: string } }).exit.kind).toBe("goto");

    const fell = await callTool("run_block", { address: "$8015", registers: { X: "$06" } });
    expect((fell.value as { exit: { kind: string } }).exit.kind).toBe("fallthrough");
  });

  it("says which values it had to assume", async () => {
    const { value } = await callTool("run_block", { address: "$8040", registers: { X: 2 } });
    const run = value as { warnings: string[]; memoryRead: { address: string }[] };
    expect(run.memoryRead.map((m) => m.address)).toContain("$1502");
    // Nothing supplied $1502 and the PRG does not cover it, so it read as zero.
    // Reporting the result without saying so would look identical to knowing.
    expect(run.warnings.join(" ")).toMatch(/read as zero/);
  });
});

describe("editing as an agent", () => {
  it("names an address and says what it did", async () => {
    const { value } = await callTool("add_claim", {
      address: "$8870",
      name: "NamedByAnAgent",
      root: "routine",
    });

    expect((value as { did: string[] }).did[0]).toContain("NamedByAnAgent");

    const listed = await callTool("list_claims", { namePattern: "NamedByAnAgent" });
    expect((listed.value as { total: number }).total).toBe(1);
  });

  it("reports the code a decision unlocked", async () => {
    // $801B sits in a code region that nothing reaches, so declaring it a
    // function is what gets it decoded at all.
    const { value } = await callTool("mark_function", { address: "$801B" });
    expect((value as { instructions: { delta: number } }).instructions.delta).toBeGreaterThan(0);
  });

  it("does not refuse a write because somebody else wrote first", async () => {
    // **`expectVersion` used to be here, and it was an antipattern.** It refused
    // a write if the whole document had moved — which is refusing to merge, in a
    // system whose premise is that concurrent edits merge. Worse, an offline
    // participant can never supply a valid whole-document hash, so it was a
    // second mode by construction: a thing only the connected can use.
    //
    // What replaces it is not a weaker check but a different shape. A write
    // carries ids, so there is nothing for a concurrent edit to make it mean
    // something else; and where a name has to be resolved, it resolves against
    // what this session knows.
    await callTool("add_claim", { address: "$8870", name: "Meanwhile" });
    const alongside = await callTool("add_claim", { address: "$8450", name: "Alongside" });

    expect(alongside.isError, alongside.text).toBe(false);
    const here = (await callTool("claims_at", { address: "$8450" })).value as {
      claims: { name?: string }[];
    };
    expect(here.claims.some((c) => c.name === "Alongside")).toBe(true);
  });

  it("records the change, attributed to the caller", async () => {
    await callTool("add_claim", { address: "$8870", name: "Attributed" });
    const { value } = await callTool("changes_since", { cursor: 0 });
    const { changes } = value as { changes: { did: string; by: string }[] };

    // The naming and the vouching that records who did it: two operations, one
    // action, both attributed. The feed is per operation on purpose.
    expect(changes).toHaveLength(2);
    expect(changes.every((c) => c.by === "usr_agent")).toBe(true);
    expect(changes[0].did).toContain("Attributed");
  });

  it("lets a caller catch up on what it missed", async () => {
    await callTool("add_claim", { address: "$8870", name: "First" });
    const { value: first } = await callTool("changes_since", { cursor: 0 });
    const cursor = (first as { cursor: number }).cursor;

    await callTool("add_claim", { address: "$8450", name: "Second" });
    const { value: next } = await callTool("changes_since", { cursor });

    const { changes } = next as { changes: { did: string }[] };
    expect(changes).toHaveLength(2);
    expect(changes[0].did).toContain("Second");
  });

  it("reports an action as one entry that several changes share", async () => {
    await callTool("mark_function", { address: "$801B" });
    const { value } = await callTool("changes_since", { cursor: 0 });
    const { changes } = value as { changes: { action?: string; as?: string }[] };

    // However many ops it took, it was one decision, and the feed says so.
    const actions = new Set(changes.map((c) => c.action));
    expect(actions.size).toBe(1);
    // And it says who, by a name a person can read.
    expect(changes[0].as).toMatch(/^[a-z]+$/);
  });

  it("takes an edit back", async () => {
    await callTool("add_claim", { address: "$8870", name: "Regretted" });
    const { value } = await callTool("undo");

    expect((value as { undone: string }).undone).toContain("Regretted");
    const listed = await callTool("list_claims", { namePattern: "Regretted" });
    expect((listed.value as { total: number }).total).toBe(0);
  });

  it("sets a region, which the browser cannot", async () => {
    const { value } = await callTool("add_claim", {
      address: "$8F00",
      extent: 0x20,
      is: "text",
      name: "blurb",
    });
    expect((value as { ok: boolean }).ok).toBe(true);
  });

  it("takes back a region and a function declaration", async () => {
    const made = await callTool("add_claim", { address: "$8F00", extent: 0x20, is: "text" });
    const dropped = await callTool("remove_claim", {
      id: (made.value as { claims: { claim: string }[] }).claims[0].claim,
    });
    expect(dropped.isError).toBe(false);

    // $801B is reached by nothing, so the declaration is what decodes it —
    // and withdrawing it puts those instructions back out of reach.
    const marked = await callTool("mark_function", { address: "$801B" });
    const gained = (marked.value as { instructions: { delta: number } }).instructions.delta;
    const unmarked = await callTool("unmark_function", { address: "$801B" });
    const lost = (unmarked.value as { instructions: { delta: number } }).instructions.delta;

    expect(gained).toBeGreaterThan(0);
    expect(lost).toBe(-gained);
  });

  it("refuses an argument it never declared", async () => {
    // A bare shape becomes a zod object that strips unknown keys, so this
    // returned ok having quietly ignored both. For something probing what an
    // API can do, "ok, did nothing" reads as a feature that exists and works.
    const result = await callTool("add_claim", {
      address: "$8F00",
      extent: 0x20,
      is: "text",
      encoding: "petscii",
      charset: "$2000",
    });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/encoding|charset|unrecognized/i);
  });

  it("says how far a claim reaches in one spelling, not two", async () => {
    // `set_region` took `end` *or* `length` and had to refuse both and neither.
    // A claim has `extent`, which is the length, so the pair — and the two ways
    // of getting it wrong — are gone rather than validated.
    const { value } = await callTool("add_claim", {
      address: "$8F00",
      extent: 32,
      is: "text",
    });

    expect((value as { covers: string }).covers).toBe("$8F00-$8F1F (32 bytes)");
  });

  it("says what is wrong rather than failing silently", async () => {
    const missing = await callTool("remove_claim", { id: "clm_nothere" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/no claim/i);
  });

  // Every argument below reached a caller only as a rejection until it was
  // added, and none of it was visible from inside: `Workspace` took a range and
  // an end address all along, and the schema in front of it did not. That is
  // the class of bug this file exists for.
  it("narrows labels to an address range, which the description always promised", async () => {
    const zeroPage = await callTool("list_claims", { from: "$00", to: "$FF" });
    expect(zeroPage.isError).toBe(false);
    const { labels } = zeroPage.value as { labels: { address: string }[] };
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(parseInt(label.address.slice(1), 16)).toBeLessThanOrEqual(0xff);
  });

  it("takes an end address on a listing, the way set_region does", async () => {
    const page = await callTool("export_listing", { start: "$8100", end: "$8110" });
    expect(page.isError).toBe(false);
    expect((page.value as { text: string }).text.length).toBeGreaterThan(0);
  });

  it("adds comments without clobbering, then edits and reorders by id", async () => {
    // The defect three of four readers hit across two runs: set_comment upserted
    // by (address, placement), so a second writer silently replaced the first.
    // The model always rendered several comments per address; only the write
    // path could not reach it.
    const first = await callTool("add_comment", { address: "$8240", text: "first voice" });
    const second = await callTool("add_comment", { address: "$8240", text: "second voice" });
    expect(first.isError).toBe(false);
    expect(second.isError).toBe(false);

    const a = (first.value as { comment: string }).comment;
    const b = (second.value as { comment: string }).comment;
    expect(a).not.toBe(b);

    const listed = await callTool("list_comments");
    const texts = (listed.value as { comments: { id: string; text: string }[] }).comments;
    expect(texts.filter((c) => /voice$/.test(c.text))).toHaveLength(2);
    // Without ids on the listing, editing and removing are unreachable.
    expect(texts.every((c) => typeof c.id === "string")).toBe(true);

    expect((await callTool("edit_comment", { id: a, text: "revised" })).isError).toBe(false);
    expect((await callTool("reorder_comments", { address: "$8240", ids: [b, a] })).isError).toBe(
      false
    );
    expect((await callTool("remove_comment", { id: b })).isError).toBe(false);
  });

  it("hands out an upload URL rather than taking bytes as an argument", async () => {
    // A D64 is 175KB, which is ~233KB of base64 and tens of thousands of tokens
    // through a transcript for a file nothing needs to read.
    const prepared = await callTool("prepare_upload", { name: "disk.d64" });
    expect(prepared.isError).toBe(false);
    const { url, method, maxBytes } = prepared.value as {
      url: string;
      method: string;
      maxBytes: number;
    };
    expect(method).toBe("PUT");
    expect(url).toMatch(/\/api\/upload\/[0-9a-f]{48}$/);
    expect(maxBytes).toBeGreaterThan(174848);
  });

  it("refuses a byte layer over a file the project has not been given", async () => {
    const refused = await callTool("add_byte_layer", { type: "prg", path: "nothere.prg" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/holds no file/i);
  });

  it("says which field of which record an address is, as a path", async () => {
    // The notation the whole model turns on: `zones[2].name`, the same shape
    // whether the array is the program's or the machine's. Until this, a reader
    // with a proved layout still counted offsets by hand to work out which of
    // nineteen fields an indexed load was reaching.
    const type = await callTool("add_type", {
      name: "Wave",
      size: 16,
      fields: {
        0: { name: "kind", type: "u8" },
        1: { name: "slots", type: "u8[4]" },
        8: { name: "name", type: "char(4)" },
      },
    });
    expect(type.isError, type.text).toBe(false);
    const typeId = (type.value as { type: string }).type;

    const claimed = await callTool("add_claim", {
      address: "$8100",
      name: "waves",
      is: "record",
      typeId,
      extent: 48,
      method: "derived",
    });
    expect(claimed.isError, claimed.text).toBe(false);

    const path = async (at: string) =>
      ((await callTool("where", { address: at })).value as { field?: { path: string } }).field
        ?.path;

    expect(await path("$8100")).toBe("waves[0].kind");
    // Into the third record, into the array field, at its second element.
    expect(await path("$8122")).toBe("waves[2].slots[1]");
    // Inside a fixed string, which is not the string's start — and saying so is
    // the point, because rounding it down would claim the wrong byte.
    expect(await path("$811A")).toBe("waves[1].name + 2");
    // A hole is a hole: offsets 5, 6 and 7 are not any field, and no name is
    // invented for them.
    expect(await path("$8105")).toBeUndefined();
    // And nothing at all where no record claim covers the address.
    expect(await path("$9000")).toBeUndefined();
  });

  it("declares a bitmask as a record whose offsets count bits", async () => {
    // $D011 is seven fields in one byte, and until this the only way to say so
    // was English inside a comment — which is what `c64/symbols.ts` does, and
    // what `vic.ts` works around by hand-writing the mask and the shift ten
    // times over. Structurally it is a record: named things at offsets, holes
    // legal, two people editing different offsets. Only the unit differs.
    const type = await callTool("add_type", {
      name: "VicControl1",
      size: 1,
      unit: "bits",
      fields: {
        0: { name: "yScroll", type: "bits(3)" },
        3: { name: "rowSelect", type: "bits(1)" },
        4: { name: "displayEnable", type: "bits(1)" },
        5: { name: "bitmapMode", type: "bits(1)" },
        7: { name: "rasterBit8", type: "bits(1)", description: "The ninth bit of $D012" },
      },
    });
    expect(type.isError, type.text).toBe(false);
    const typeId = (type.value as { type: string }).type;

    // `size` is still bytes, so the bound is eight times as far and an offset
    // past it is refused by number rather than silently wrapping. Through
    // `add_field`, which is where a single field arrives now: `edit_type`
    // corrects the record and never its parts.
    const past = await callTool("add_field", {
      typeId,
      offset: 8,
      name: "nowhere",
      type: "bits(1)",
    });
    expect(`${past.text}${JSON.stringify(past.value)}`).toMatch(/8 bits|bit 8/);

    // And bits(n) needs somewhere to sit: a byte-addressed record has no
    // sub-byte offsets, so it is refused rather than rounded up to a byte.
    const wrongUnit = await callTool("add_type", {
      name: "NotBits",
      size: 2,
      fields: { 0: { name: "flag", type: "bits(1)" } },
    });
    expect(`${wrongUnit.text}${JSON.stringify(wrongUnit.value)}`).toMatch(/unit/);

    // The path notation reaches through, which is the payoff and needed no new
    // machinery: a bit record nests inside a byte record like any other.
    const claimed = await callTool("add_claim", {
      address: "$8100",
      name: "control",
      is: "record",
      typeId,
      extent: 1,
      method: "read",
    });
    expect(claimed.isError, claimed.text).toBe(false);
    const where = (await callTool("where", { address: "$8100" })).value as {
      field?: { path: string };
    };
    // Offset 0 is the low bit, so the first field the walk finds is yScroll.
    expect(where.field?.path).toBe("control[0].yScroll");
  });

  it("shows the machine's layouts beside the project's, as worked examples", async () => {
    // **The discoverability half.** `unit: "bits"` and the array notation are
    // the two newest things a field type can say, and a project that uses
    // neither teaches neither — the Camels silver image declares six types and
    // every field in all of them is a scalar. So the hardware's own layouts are
    // reported here: thirty of them, which is where a reader meets `bits(n)` in
    // use rather than in a paragraph of schema prose.
    const listed = (await callTool("list_types", {})).value as {
      total: number;
      machine: { at: string; name: string; unit: string; bits: string[] }[];
    };
    expect(listed.machine.length).toBeGreaterThan(20);

    const scroly = listed.machine.find((m) => m.name === "SCROLY")!;
    expect(scroly.at).toBe("$D011");
    expect(scroly.unit).toBe("bits");
    // High bit first, the order a byte is written in, with the width shown as
    // the field type that would declare it.
    expect(scroly.bits[0]).toBe("b7 rasterBit8: bits(1)");
    expect(scroly.bits.at(-1)).toBe("b2..0 yScroll: bits(3)");

    // The SID's three voices are the same registers three times, and the names
    // say which — `SIDCTRL2.gate` must not be ambiguous about whose gate.
    for (const voice of [1, 2, 3]) {
      expect(listed.machine.some((m) => m.name === `SIDCTRL${voice}`)).toBe(true);
    }
  });

  it("says what a register's bits mean, and which ones a mask touches", async () => {
    // Write the whole byte and it is SCROLY; touch one bit and the answer says
    // which. The layouts are the machine's, not this project's, so they need no
    // declaring and appear beside `field` rather than inside it.
    const whole = (await callTool("where", { address: "$D011" })).value as {
      register?: { name: string; bits: { at: string; name: string; mask: string }[] };
    };
    expect(whole.register?.name).toBe("SCROLY");
    // High bit first, because that is the order a byte is written in.
    expect(whole.register?.bits[0]).toMatchObject({
      at: "b7",
      name: "rasterBit8",
      // The number you would `#define`. A field's identity in code is its mask,
      // so this is what add_constant takes and bind_constant puts at the site —
      // which is why naming a masked value needs no provenance analysis at all.
      mask: "$80",
    });
    expect(whole.register?.bits.at(-1)).toMatchObject({
      at: "b2..0",
      name: "yScroll",
      mask: "$07",
    });

    const masked = (await callTool("where", { address: "$D011", mask: "$80" })).value as {
      register?: { touches: string[] };
    };
    expect(masked.register?.touches).toEqual(["SCROLY.rasterBit8"]);

    // And the one the 2021 patch turned into an AND: clearing the raster bit.
    const rest = (await callTool("where", { address: "$D011", mask: "$7F" })).value as {
      register?: { touches: string[] };
    };
    expect(rest.register?.touches).not.toContain("SCROLY.rasterBit8");
    expect(rest.register?.touches).toContain("SCROLY.yScroll");

    // An ordinary address has no register layout and says nothing about one.
    const plain = (await callTool("where", { address: "$8100" })).value as { register?: unknown };
    expect(plain.register).toBeUndefined();
  });

  it("takes a patch as bytes, with no file to upload", async () => {
    // The schema half of the layer kind the file format has always had. `path`
    // had to stop being required for this to be sayable at all, so the two
    // refusals below are what keeps the looser schema honest.
    const made = await callTool("add_byte_layer", {
      type: "bytes",
      address: "$C000",
      bytes: "A9 00 8D 20 D0 60",
      name: "collision patch",
    });
    expect(made.isError).toBe(false);
    // No advice about linking: this project declares no targets, so the loader
    // implies one over the whole stack and the new layer is in it. The note is
    // for a project that declares views and a layer none of them links.
    expect((made.value as { note?: string }).note).toBeUndefined();

    const listed = (await callTool("list_targets", {})).value as {
      layers: { id: string; name: string }[];
    };
    expect(listed.layers.map((l) => l.name)).toContain("collision patch");

    const noPath = await callTool("add_byte_layer", { type: "raw", address: "$C000" });
    expect(noPath.isError).toBe(true);
    expect(noPath.text).toMatch(/needs a path/i);

    const noAddress = await callTool("add_byte_layer", { type: "bytes", bytes: "EA" });
    expect(noAddress.isError).toBe(true);
    expect(noAddress.text).toMatch(/no load address of its own/i);
  });

  it("says several things at once and reports what it declined", async () => {
    const { isError, value } = await callTool("add_claims", {
      claims: [
        { address: "$8E00", extent: 0x40, is: "data", name: "batchA" },
        { address: "$8250", name: "batchB" },
        { address: "$801B", root: "routine", name: "batchC" },
      ],
    });

    expect(isError).toBeFalsy();
    const result = value as { claims: { at: string; claim: string }[]; rejected?: unknown[] };
    expect(result.rejected).toBeUndefined();

    // Each id beside the address it was minted for, not a positional array.
    // A positional array is what the first batch reader got: one entry produced
    // no new claim, every id after it lined up with the wrong input, and six
    // corrections landed on claims the reader had never looked at — every call
    // returning `ok`. An index cannot be checked and an address can.
    expect(result.claims.map((c) => c.at).sort()).toEqual(["$801B", "$8250", "$8E00"]);
    for (const made of result.claims) expect(made.claim).toMatch(/^clm_|^rgn_|^lbl_/);
  });

  it("reports every claim covering an address, resolving nothing", async () => {
    await callTool("add_claim", { address: "$8250", name: "oneReading" });
    await callTool("add_claim", { address: "$8250", name: "another" });

    const { isError, value } = await callTool("claims_at", { address: "$8250" });
    expect(isError).toBeFalsy();

    // Both stand. Which of them an operand shows is a separate question, and
    // this tool deliberately does not answer it.
    const names = (value as { claims: { name?: string }[] }).claims.map((c) => c.name);
    expect(names).toContain("oneReading");
    expect(names).toContain("another");
  });

  it("corrects one field of a claim and leaves the rest alone", async () => {
    const made = await callTool("add_claim", {
      address: "$8250",
      name: "beforeCorrection",
      extent: 16,
    });
    const id = (made.value as { claims: { claim: string }[] }).claims[0].claim;

    const revised = await callTool("edit_claim", { id, name: "afterCorrection" });
    expect(revised.isError).toBeFalsy();

    const { value } = await callTool("claims_at", { address: "$8250" });
    const claim = (value as { claims: { id?: string; name?: string; extent?: number }[] }).claims.find(
      (c) => c.id === id
    );
    expect(claim?.name).toBe("afterCorrection");
    // Omitted means "leave alone", which is the whole reason a revise is
    // partial: two people correcting different fields must both survive.
    expect(claim?.extent).toBe(16);
  });

  it("moves a claim, keeping the id everything else points at", async () => {
    // There was no way to do this. `edit_claim` offered no `at`, because a raw
    // absolute address written into a layer-framed claim is read back as an
    // *offset* — so rather than get it wrong the field was left out, and
    // repositioning meant remove-and-re-add, which loses the id and dangles
    // every primary and every use bound to it.
    const made = await callTool("add_claim", { address: "$8100", name: "MovedLater" });
    const id = (made.value as { claims: { claim: string }[] }).claims[0].claim;

    const moved = await callTool("edit_claim", { id, address: "$8104" });
    expect(moved.isError).toBe(false);

    const gone = (await callTool("claims_at", { address: "$8100" })).value as {
      claims: { id?: string }[];
    };
    expect(gone.claims.some((c) => c.id === id)).toBe(false);

    const now = (await callTool("claims_at", { address: "$8104" })).value as {
      claims: { id?: string; name?: string }[];
    };
    expect(now.claims.find((c) => c.id === id)?.name).toBe("MovedLater");
  });

  it("clears a field with null, which omitting it cannot say", async () => {
    const made = await callTool("add_claim", { address: "$8250", name: "hasAnExtent", extent: 16 });
    const id = (made.value as { claims: { claim: string }[] }).claims[0].claim;

    const cleared = await callTool("edit_claim", { id, extent: null });
    expect(cleared.isError).toBeFalsy();

    const { value } = await callTool("claims_at", { address: "$8250" });
    const claim = (value as { claims: { id?: string; extent?: number }[] }).claims.find(
      (c) => c.id === id
    );
    expect(claim?.extent).toBeUndefined();
  });

  it("refuses a revise that names no field, rather than reporting success", async () => {
    const made = await callTool("add_claim", { address: "$8250", name: "untouched" });
    const id = (made.value as { claims: { claim: string }[] }).claims[0].claim;

    const nothing = await callTool("edit_claim", { id });
    expect(nothing.isError).toBe(true);
    expect(nothing.text).toMatch(/at least one field/i);
  });

  it("declares a record layout with a hole in it, and binds a claim to it", async () => {
    // The layout is the one a reader actually established in Revenge of the
    // Mutant Camels: 200-byte records with a 40-character name at +$A0, in
    // screen codes. The hole between the fields is the point — declaring what
    // you have proved without inventing padding for the rest.
    const made = await callTool("add_type", {
      name: "Zone",
      size: 200,
      fields: {
        "0": { name: "kind", type: "u8" },
        "$A0": { name: "label", type: "char(40,screen)" },
      },
    });
    expect(made.isError).toBeFalsy();
    const typeId = (made.value as { type: string }).type;
    expect(typeId).toMatch(/^typ_/);

    const listed = (await callTool("list_types", {})).value as {
      types: {
        id: string;
        fields: { offset: string; name: string; type: string }[];
        unexplainedBytes: number;
        usedAt: string[];
      }[];
    };
    const zone = listed.types.find((t) => t.id === typeId)!;
    // Memory order, derived from the offsets, which is why fields need no ids.
    expect(zone.fields.map((f) => f.name)).toEqual(["kind", "label"]);
    expect(zone.fields[1].offset).toBe("+$A0");
    // The type came back the way it was written, byte order and encoding kept.
    expect(zone.fields[1].type).toBe("char(40,screen)");
    // 200 bytes, 41 accounted for: the rest is a work queue, not a fault.
    expect(zone.unexplainedBytes).toBe(159);
    expect(zone.usedAt).toEqual([]);

    const bound = await callTool("add_claim", {
      address: "$8E00",
      is: "record",
      typeId,
      extent: 400,
      name: "zones",
    });
    expect(bound.isError).toBeFalsy();

    const after = (await callTool("list_types", {})).value as {
      types: { id: string; usedAt: string[] }[];
    };
    expect(after.types.find((t) => t.id === typeId)!.usedAt).toEqual(["$8E00"]);
  });

  it("declines a field it cannot read and keeps the rest", async () => {
    // Partial, like every batch here: one bad field must not lose the ones
    // somebody proved from a copy routine.
    const made = await callTool("add_type", {
      name: "Partial",
      size: 8,
      fields: {
        "0": { name: "good", type: "u8" },
        "1": { name: "bogus", type: "widget" },
        "9": { name: "outside", type: "u8" },
      },
    });

    expect(made.isError).toBeFalsy();
    const result = made.value as {
      type: string;
      rejected: { address: string; reason: string }[];
    };
    expect(result.rejected.map((r) => r.address).sort()).toEqual(["1", "9"]);
    expect(result.rejected.find((r) => r.address === "9")!.reason).toMatch(/outside/);

    const listed = (await callTool("list_types", {})).value as {
      types: { id: string; fields: { name: string }[] }[];
    };
    expect(listed.types.find((t) => t.id === result.type)!.fields.map((f) => f.name)).toEqual([
      "good",
    ]);
  });

  it("refuses a record claim with no layout and no extent, rather than guessing", async () => {
    const made = await callTool("add_type", { name: "Tiny", size: 2, fields: {} });
    const typeId = (made.value as { type: string }).type;

    const noType = await callTool("add_claim", { address: "$8E00", is: "record", extent: 8 });
    expect(noType.isError).toBe(true);
    expect(noType.text).toMatch(/typeId/);

    // How many records is derived from extent / size, so an extent-less record
    // claim is one record and almost certainly not what anybody meant.
    const noExtent = await callTool("add_claim", { address: "$8E00", is: "record", typeId });
    expect(noExtent.isError).toBe(true);
    expect(noExtent.text).toMatch(/extent/);
  });

  it("leaves a claim readable when the layout it names is taken away", async () => {
    // Same rule as a dangling constant: the bytes render, so a delete racing
    // somebody else's binding heals itself rather than needing a sweep.
    const made = await callTool("add_type", { name: "Doomed", size: 4, fields: {} });
    const typeId = (made.value as { type: string }).type;
    await callTool("add_claim", { address: "$8E00", is: "record", typeId, extent: 8 });

    expect((await callTool("remove_type", { id: typeId })).isError).toBeFalsy();
    // Still there, still readable, still saying what it said.
    const covering = (await callTool("claims_at", { address: "$8E00" })).value as {
      claims: { name?: string }[];
    };
    expect(covering.claims.length).toBeGreaterThan(0);
  });

  it("links a layer into a target at a chosen address, and reports the link", async () => {
    // The schema in front of `setTarget` is the only layer that catches this:
    // `layers` used to be a plain array of ids, and a caller passing the object
    // form would have been rejected with the logic underneath working fine.
    const targets = (await callTool("list_targets", {})).value as {
      layers: { id: string; name: string }[];
    };
    const layer = targets.layers[0].id;

    const made = await callTool("add_target", {
      name: "relocated",
      layers: [{ layer, at: "$0100" }],
    });
    expect(made.isError).toBeFalsy();

    const after = (await callTool("list_targets", {})).value as {
      targets: { name: string; layers: { layer: string; at?: string }[] }[];
    };
    const relocated = after.targets.find((t) => t.name === "relocated")!;
    // Reported, because it is what decides shadowing — and because a
    // layer-scoped claim's absolute address is this plus its offset.
    expect(relocated.layers).toEqual([
      { id: expect.any(String), layer, name: expect.any(String), at: "$0100" },
    ]);
  });

  it("says nothing about where a layer lands when the target does not move it", async () => {
    const targets = (await callTool("list_targets", {})).value as {
      layers: { id: string }[];
    };
    const layer = targets.layers[0].id;

    // A link is an object with an id now — the bare-string shorthand is gone,
    // because a shorthand has nowhere to put one and a link is a thing the API
    // addresses on its own.
    await callTool("add_target", { name: "plain", layers: [{ layer }] });
    const after = (await callTool("list_targets", {})).value as {
      targets: { name: string; layers: { layer: string; at?: string }[] }[];
    };
    // No `at`: the layer sits where its own header puts it, and saying so
    // would be inventing a fact the target does not hold.
    expect(after.targets.find((t) => t.name === "plain")!.layers[0].at).toBeUndefined();
  });

  it("refuses to link one layer twice, which would shadow itself", async () => {
    const targets = (await callTool("list_targets", {})).value as { layers: { id: string }[] };
    const layer = targets.layers[0].id;

    const refused = await callTool("add_target", {
      name: "doubled",
      layers: [{ layer }, { layer }],
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/once/i);
  });

  it("links a ROM as reference, and keeps it out of the disassembly", async () => {
    const added = await callTool("add_rom_layer", { rom: "basic" });
    expect(added.isError).toBeFalsy();

    // It is in the project, and it is not in the listing: a ROM is bytes to
    // resolve through, not bytes to read.
    const layers = (await callTool("list_targets", {})).value as {
      layers: { name: string; type: string }[];
    };
    expect(layers.layers.some((l) => l.type === "rom")).toBe(true);

    const listing = (await callTool("export_listing", { start: "$A000", lines: 5 })).value as {
      text?: string;
      lines?: unknown[];
    };
    const rendered = JSON.stringify(listing);
    expect(rendered).not.toMatch(/A00[0-9A-F]  [0-9A-F]{2} /);
  });

  it("refuses to link the same ROM twice", async () => {
    await callTool("add_rom_layer", { rom: "kernal" });
    const again = await callTool("add_rom_layer", { rom: "kernal" });
    expect(again.isError).toBe(true);
    expect(again.text).toMatch(/already links/);
  });

  it("adds beside a rooted claim rather than replacing it", async () => {
    // The defect two readers found by probing, and it ate a name. A claim
    // carrying a root routed through the span writer, which infers an existing
    // claim from a start address and reuses its id — an upsert, under a tool
    // whose own description promises it never replaces, in the noun this
    // project rewrote its model around to stop exactly that.
    const first = await callTool("add_claim", { address: "$8250", name: "firstReading", root: "routine" });
    const second = await callTool("add_claim", { address: "$8250", name: "secondReading", root: "routine" });
    expect(second.isError).toBeFalsy();

    const covering = (await callTool("claims_at", { address: "$8250" })).value as {
      claims: { id?: string; name?: string }[];
    };
    const names = covering.claims.map((c) => c.name);
    expect(names).toContain("firstReading");
    expect(names).toContain("secondReading");
    expect((first.value as { claims: { claim: string }[] }).claims[0].claim).not.toBe(
      (second.value as { claims: { claim: string }[] }).claims[0].claim
    );
  });

  it("stores the root it was given, not a different one", async () => {
    // `location` was stored as `entry`, so twenty-eight branch targets became
    // program entry points — inflating the root count and generating two
    // hundred phantom shadow decodes. The two write paths disagreed about
    // their own enum, which nothing could see from outside.
    const made = await callTool("add_claim", { address: "$8300", name: "aBranchTarget", root: "location" });
    const id = (made.value as { claims: { claim: string }[] }).claims[0].claim;

    const covering = (await callTool("claims_at", { address: "$8300" })).value as {
      claims: { id?: string; root?: string }[];
    };
    expect(covering.claims.find((c) => c.id === id)?.root).toBe("location");
  });

  it("keeps the comment on a claim that also says what the bytes are", async () => {
    // Nineteen findings were destroyed by this in one run, with `ok: true` and
    // nothing in `rejected` — and on exactly the claims where the comment is
    // the only place the finding lives, because a data claim renders as hex and
    // argues for nothing by itself. The comment was handed to the span writer
    // as a field that no longer exists.
    const made = await callTool("add_claims", {
      claims: [
        { address: "$8E00", extent: 0x40, is: "data", name: "aTable", comment: "why this is a table" },
      ],
    });
    expect(made.isError).toBeFalsy();

    const comments = (await callTool("list_comments", {})).value as {
      comments: { address: string; text: string }[];
    };
    expect(comments.comments.some((c) => c.text === "why this is a table")).toBe(true);
  });

  it("attaches a decoder to the text it decodes", async () => {
    // `view: "snippet:<id>"` was accepted everywhere and stored nowhere, so a
    // decoder could be defined and run and never reach the span it was written
    // for — which is the one case it exists for, a program with its own
    // character set that no built-in encoding can read.
    const decoder = await callTool("add_decoder", {
      name: "glyphs",
      source: "return { kind: 'text', lines: ['decoded'] };",
    });
    const id = (decoder.value as { decoder: string }).decoder;

    const made = await callTool("add_claim", {
      address: "$8F00",
      extent: 8,
      is: "text",
      view: `snippet:${id}`,
    });
    const claimId = (made.value as { claims: { claim: string }[] }).claims[0].claim;

    const covering = (await callTool("claims_at", { address: "$8F00" })).value as {
      claims: { id?: string; view?: string }[];
    };
    expect(covering.claims.find((c) => c.id === claimId)?.view).toBe(`snippet:${id}`);
  });

  it("does not lose a whole batch to one comment on a byteless address", async () => {
    // A comment needs a layer to hold it and a name no longer does, so this
    // threw inside the transaction, past the per-claim guard — and one
    // zero-page comment rejected all fifty-one claims with advice the caller
    // had no way to follow. A batch tool that fails whole is not a batch tool.
    const made = await callTool("add_claims", {
      claims: [
        { address: "$02", name: "aZeroPageByte", comment: "used as a pointer" },
        { address: "$8250", name: "aNormalName" },
      ],
    });

    expect(made.isError).toBeFalsy();
    expect((made.value as { claims: { at: string }[] }).claims.map((c) => c.at)).toEqual([
      "$0002",
      "$8250",
    ]);
  });

  it("says what a claim belongs to, without being asked to choose", async () => {
    // Derived from the address, never chosen. It decides whether the claim
    // follows its bytes if that layer is ever linked somewhere else, so a
    // caller that could not see it would be holding shared state it did not
    // know about — which is what an invisible extent cost two readers.
    const inCode = await callTool("add_claim", { address: "$8250", name: "insideThePrg" });
    expect((inCode.value as { scope: string }).scope).toMatch(/^layer:/);

    // Nothing supplies zero page, so it is a fact about the arrangement rather
    // than about any file's bytes.
    const inZeroPage = await callTool("add_claim", { address: "$08", name: "aVariable" });
    expect((inZeroPage.value as { scope: string }).scope).not.toMatch(/^layer:/);

    // And the read that verifies the write can see the same thing.
    const covering = (await callTool("claims_at", { address: "$8250" })).value as {
      claims: { name?: string; scope: string }[];
    };
    expect(covering.claims.find((c) => c.name === "insideThePrg")!.scope).toMatch(/^layer:/);
  });

  it("names a byteless address without inventing a layer to hold it", async () => {
    // Naming zero page used to fabricate a symbols layer so the annotation had
    // an owner — machinery that existed only because there was no scope for "a
    // fact about this arrangement". There is one now, so nothing is invented.
    //
    // Comments still create one, and that is left alone deliberately: whether a
    // comment belongs to a layer or a target is exactly the kind of thing to
    // settle with evidence, having already been burned once by `set_comment`
    // being keyed by slot on a justification nobody revisited.
    const before = (await callTool("list_targets", {})).value as { layers: unknown[] };
    await callTool("add_claim", { address: "$FE", name: "scratchByte" });
    const after = (await callTool("list_targets", {})).value as { layers: unknown[] };

    expect(after.layers.length).toBe(before.layers.length);
  });

  it("refuses a target it does not have rather than guessing", async () => {
    const refused = await callTool("add_claim", {
      address: "$8250",
      name: "elsewhere",
      target: "no-such-view",
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/list_targets/);
  });

  it("says where decoding starts, and which of those it can take back", async () => {
    const before = await callTool("list_roots", {});
    const listed = before.value as {
      total: number;
      roots: { address: string; id?: string; writable: boolean }[];
    };
    expect(listed.total).toBeGreaterThan(0);

    // A PRG's load address is inherent to the file: reported, and with no id,
    // because handing one back invites a write against an identity nobody owns.
    expect(listed.roots.some((r) => !r.writable && r.id === undefined)).toBe(true);

    // A root somebody declared is correctable, by the id the write returned.
    const made = await callTool("add_claim", { address: "$801B", root: "routine", name: "aRoot" });
    const id = (made.value as { claims: { claim: string }[] }).claims[0].claim;

    const after = (await callTool("list_roots", {})).value as {
      roots: { address: string; id?: string; writable: boolean }[];
    };
    const mine = after.roots.find((r) => r.address === "$801B");
    expect(mine?.writable).toBe(true);
    expect(mine?.id).toBe(id);
  });

  it("reports where the project contradicts itself", async () => {
    // One name reaching two addresses: `levelTable-1` means a different byte
    // against each, so an operand rendered bare would be a wrong answer that
    // looks right — which is what both neutral readers in experiment 3 hit.
    await callTool("add_claim", { address: "$8250", name: "sharedName" });
    await callTool("add_claim", { address: "$8450", name: "sharedName" });

    const { isError, value } = await callTool("disagreements", {});
    expect(isError).toBeFalsy();
    const found = value as { total: number; findings: { kind: string; what: string }[] };
    expect(found.total).toBeGreaterThan(0);
    expect(found.findings.some((f) => f.what.includes("sharedName"))).toBe(true);
  });

  it("removes a claim by id, which is the only thing that can name one", async () => {
    // Two names at one address is ordinary — the reference disassembly calls
    // $08 two things — so "remove the claim at $8250" has no single answer and
    // there is no longer a spelling that asks it. The write returns the id, and
    // claims_at reports every id covering an address.
    const first = await callTool("add_claim", { address: "$8250", name: "firstName" });
    const second = await callTool("add_claim", { address: "$8250", name: "secondName" });

    const covering = await callTool("claims_at", { address: "$8250" });
    const ids = (covering.value as { claims: { id?: string }[] }).claims.map((c) => c.id);
    expect(ids).toContain((first.value as { claims: { claim: string }[] }).claims[0].claim);
    expect(ids).toContain((second.value as { claims: { claim: string }[] }).claims[0].claim);

    const id = (second.value as { claims: { claim: string }[] }).claims[0].claim;
    expect((await callTool("remove_claim", { id })).isError).toBe(false);
  });

  it("runs a program over the wire and reports where it stopped", async () => {
    const run = await callTool("run_program", { address: "$8100", maxInstructions: 5000 });
    expect(run.isError).toBe(false);
    const { instructions, reason, stoppedAt } = run.value as {
      instructions: number;
      reason: string;
      stoppedAt: string;
    };
    expect(instructions).toBeGreaterThan(0);
    expect(typeof reason).toBe("string");
    expect(stoppedAt).toMatch(/^\$[0-9A-F]{4}$/);
  });

  it("refuses a capture of no bytes", async () => {
    const refused = await callTool("run_program", {
      address: "$8100",
      maxInstructions: 100,
      capture: { name: "nothing.prg", from: "$8000", to: "$8000" },
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/at least one byte/i);
  });

  it("declares a view, and answers for it when a call names it", async () => {
    const listed = await callTool("list_targets");
    expect(listed.isError).toBe(false);
    const { layers } = listed.value as { layers: { id: string; name: string }[] };
    expect(layers.length).toBeGreaterThan(0);

    const made = await callTool("add_target", {
      name: "just-the-prg",
      layers: [{ layer: layers[0].id }],
    });
    expect(made.isError).toBe(false);

    // Named per call, and nothing on the server remembers it — so this reads
    // through that view without changing what anybody else sees, and there is
    // no selection to put back afterwards.
    const through = await callTool("describe_project", { target: "just-the-prg" });
    expect(through.isError).toBe(false);
    expect((through.value as { layers: unknown[] }).layers).toHaveLength(1);

    // A view nothing declares is refused rather than answered for with a
    // different stack, which would be a wrong answer that looks right.
    const missing = await callTool("describe_project", { target: "no-such-view" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/No target/);

    expect((await callTool("remove_target", { id: made.value ? (made.value as { target: string }).target : "" })).isError).toBe(false);
  });

  it("refuses a target over a layer that is not there", async () => {
    const refused = await callTool("add_target", {
      name: "bad",
      layers: [{ layer: "lay_nope" }],
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/No layer/);
  });

  it("lists who is in the project, including itself", async () => {
    // An agent has no socket and so no awareness; membership is in the document
    // precisely so both consumers can read the same list.
    const here = await callTool("list_participants");
    expect(here.isError).toBe(false);
    const { participants, online } = here.value as {
      online: number;
      participants: { kind: string; online: boolean; codename?: string }[];
    };
    expect(participants.length).toBeGreaterThan(0);
    expect(online).toBeGreaterThan(0);
    expect(participants.some((p) => p.kind === "agent" && p.online)).toBe(true);
  });

  it("tags a point over the wire, and takes the tag back as a cursor", async () => {
    const tagged = await callTool("tag_project", { name: "wire-test", note: "over MCP" });
    expect(tagged.isError).toBe(false);

    await callTool("add_claim", { address: "$8210", name: "afterWireTag" });

    const since = await callTool("changes_since", { tag: "wire-test" });
    expect(since.isError).toBe(false);
    expect(since.text).toContain("afterWireTag");

    const listed = await callTool("list_tags");
    const { tags } = listed.value as { tags: { name: string; changesSince: number }[] };
    expect(tags.some((t) => t.name === "wire-test")).toBe(true);

    const gone = await callTool("remove_tag", { name: "wire-test" });
    expect(gone.isError).toBe(false);
    expect((await callTool("changes_since", { tag: "wire-test" })).isError).toBe(true);
  });

  it("returns the project as text an agent can read back", async () => {
    // There was no tool for this at all: an agent had to reach past the surface
    // to an HTTP route it could only find by reading the server.
    const written = await callTool("export_project");
    expect(written.isError).toBe(false);
    const { text, bytes } = written.value as { text: string; bytes: number };
    expect(bytes).toBeGreaterThan(0);
    expect(() => JSON.parse(text)).not.toThrow();
  });
});

describe("running a scenario over the wire", () => {
  it("declares a workflow, runs it, and keeps what it captured", async () => {
    // The whole loop through the surface an agent actually uses. Gridrunner is
    // a cartridge with no ROMs linked here, so this runs its own code without a
    // KERNAL — enough to prove the path, and the machine model's real
    // acceptance is `core/machine/gridrunner.test.ts`.
    const made = await callTool("add_scenario", {
      name: "first frames",
      description: "boot the cartridge and keep the screen",
      steps: [
        { kind: "start", at: "$8000", vector: true },
        { kind: "run", frames: 2 },
        { kind: "capture", what: "ram", from: "$0400", to: "$0500", name: "screen.prg" },
      ],
    });
    expect(made.isError).toBe(false);
    const id = (made.value as { scenario: string }).scenario;

    const run = (await callTool("run_scenario", { id })).value as {
      did: { step: string; kind: string }[];
      captured?: { id: string; step: string; kind: string; file: string; url: string }[];
      stopped: { reason: string };
    };

    expect(run.did.map((d) => d.kind)).toEqual(["start", "run", "capture"]);
    expect(run.captured).toHaveLength(1);
    expect(run.captured![0].file).toBe("screen.prg");
    // Where the bytes actually are. The route has existed since the browser
    // needed binaries and nothing told a caller about it — which is experiment
    // 4's `save_project` finding repeating.
    expect(run.captured![0].url).toContain("/api/blob?");

    // The capture is in the document beside the scenario that made it, so what
    // a run produced can be found without running it again.
    const listed = (await callTool("list_scenarios", {})).value as {
      scenarios: { id: string; captures: { file: string }[] }[];
    };
    const found = listed.scenarios.find((x) => x.id === id)!;
    expect(found.captures.map((c) => c.file)).toEqual(["screen.prg"]);
  });

  it("mints an id for every step, so a capture can name the one that made it", async () => {
    const made = await callTool("add_scenario", {
      name: "ids",
      steps: [{ kind: "start", at: "$8000", vector: true }],
    });
    const id = (made.value as { scenario: string }).scenario;

    const listed = (await callTool("list_scenarios", {})).value as {
      scenarios: { id: string; steps: { id?: string }[] }[];
    };
    const found = listed.scenarios.find((x) => x.id === id)!;
    expect(found.steps[0].id).toMatch(/^stp_/);
  });

  it("revises by id, and refuses an id nothing holds", async () => {
    const made = await callTool("add_scenario", {
      name: "before",
      steps: [{ kind: "start", at: "$8000" }],
    });
    const id = (made.value as { scenario: string }).scenario;

    expect((await callTool("edit_scenario", { id, name: "after" })).isError).toBe(false);
    const missing = await callTool("edit_scenario", { id: "scn_nope", name: "x" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("No scenario");
  });

  it("refuses a scenario with no steps, which would do nothing", async () => {
    const refused = await callTool("add_scenario", { name: "empty", steps: [] });
    expect(refused.isError).toBe(true);
  });
});

describe("evidence, and saying things about a claim", () => {
  it("records a refutation that shares no bytes with what it refutes", async () => {
    // The shape both experiment-0 agents hit and neither could express. `$8DF9`
    // holding `$3B` refutes a claim about the *glyph* `$3B`, somewhere else
    // entirely — so `disagreements`, which sweeps for claims covering the same
    // bytes, could never find it.
    const glyph = await callTool("add_claim", {
      address: "$8E18",
      name: "glyph3B",
      comment: "never drawn",
      method: "read",
    });
    const table = await callTool("add_claim", { address: "$8DF9", name: "levelText", method: "ran" });
    const wrong = (glyph.value as { claims: { claim: string }[] }).claims[0].claim;
    const right = (table.value as { claims: { claim: string }[] }).claims[0].claim;

    const noted = await callTool("add_evidence", {
      claim: right,
      kind: "refutes",
      other: wrong,
      note: "$8DF9 holds $3B, so the glyph is drawn",
    });
    expect(noted.isError).toBe(false);

    const contested = (await callTool("disagreements", {})).value as {
      findings: { kind: string; what: string }[];
    };
    const declared = contested.findings.filter((f) => f.kind === "declared");
    expect(declared).toHaveLength(1);
    expect(declared[0].what).toContain("so the glyph is drawn");
  });

  it("refuses a refutation that points at nothing", async () => {
    // An opinion with no handle on it: the whole point is that a reader can
    // follow it to the thing that was wrong.
    const made = await callTool("add_claim", { address: "$8F00", name: "Something" });
    const claim = (made.value as { claims: { claim: string }[] }).claims[0].claim;

    const refused = await callTool("add_evidence", { claim, kind: "refutes" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/point at/);
  });

  it("keeps a reading somebody moved on from, rather than deleting it", async () => {
    // "The wrong model that led to the right place is worth keeping, and prose
    // deliverables silently discard it."
    //
    // **This used to declare a `supersedes`, and that kind is gone.** It said
    // "an earlier reading, replaced" — neither support nor refutation — and it
    // stored an *ordering*, which is the one thing a conflict-free merge cannot
    // supply: two peers offline can each supersede one claim with a different
    // replacement and nothing breaks the tie. The single-valued key for "which
    // reading is current" already existed and is read by the renderer, which
    // `supersedes` never was.
    //
    // The evidence that nobody wanted it: of every add_evidence call the runs
    // have made, all are supports or refutes — and the one facing exactly this
    // case wrote "Refutes the earlier framing of this as new/cut music."
    const first = await callTool("add_claim", { address: "$8F10", name: "cipherTable", method: "guessed" });
    const second = await callTool("add_claim", { address: "$8F10", name: "characterSet", method: "ran" });
    const old = (first.value as { claims: { claim: string }[] }).claims[0].claim;
    const now = (second.value as { claims: { claim: string }[] }).claims[0].claim;

    const said = await callTool("add_evidence", {
      claim: now,
      kind: "refutes",
      other: old,
      note: "the substitution-cipher attack is what led here, and it was wrong",
    });
    expect(said.isError, said.text).toBe(false);

    const about = (await callTool("list_evidence", { claim: now })).value as {
      evidence: { kind: string; other?: string; author?: string }[];
    };
    const written = about.evidence.find((e) => e.kind === "refutes" && e.other === old);
    expect(written).toBeDefined();
    // **Signed.** Refutations arrived anonymous — `add_evidence` never recorded
    // an author — and `list_evidence`, whose whole job is what has been said
    // about a claim, could not have shown one if it had.
    expect(written?.author).toBeTruthy();

    // Both readings are still there to be read: refuting is not deleting.
    const still = (await callTool("claims_at", { address: "$8F10" })).value as {
      claims: { id?: string }[];
    };
    expect(still.claims.some((c) => c.id === old)).toBe(true);
    expect(still.claims.some((c) => c.id === now)).toBe(true);

    // And the contradiction is reported rather than resolved, which is the
    // whole difference between a refutation and a deletion.
    const open = (await callTool("disagreements", {})).value as {
      findings: { kind: string; what: string }[];
    };
    expect(open.findings.some((f) => f.kind === "declared")).toBe(true);
  });

  it("retires a settled reading out of the working set, and puts it back", async () => {
    // **Refuting was not enough, and this is the test that says why.** The test
    // above ends with both readings in `claims_at` and a declared disagreement
    // standing — correct while the matter is open, and clutter once it is not.
    // A reader arriving later meets the contradiction with nothing marking which
    // half is live, and making refutation itself hide its target would be worse:
    // `disagreements()` reports contradiction and never picks a winner.
    const first = await callTool("add_claim", { address: "$8F40", name: "waveTable", method: "guessed" });
    const second = await callTool("add_claim", { address: "$8F40", name: "zoneTable", method: "ran" });
    const old = (first.value as { claims: { claim: string }[] }).claims[0].claim;
    const now = (second.value as { claims: { claim: string }[] }).claims[0].claim;

    const out = await callTool("retire_claim", {
      id: old,
      other: now,
      note: "the trace shows this read as zones, never as waveforms",
    });
    expect(out.isError, out.text).toBe(false);

    // Gone from everything that reads the document — one filter in the loader,
    // so this holds for the listing and hygiene too rather than for the three
    // surfaces somebody remembered.
    const here = (await callTool("claims_at", { address: "$8F40" })).value as {
      claims: { id?: string }[];
    };
    expect(here.claims.some((c) => c.id === old)).toBe(false);
    expect(here.claims.some((c) => c.id === now)).toBe(true);

    const listed = (await callTool("list_claims", { namePattern: "waveTable" })).value as {
      labels: unknown[];
    };
    expect(listed.labels).toHaveLength(0);

    // And kept, with what took it out — which is the whole difference from
    // remove_claim, whose record lives only in the operations log.
    const shelved = (await callTool("list_retired", {})).value as {
      total: number;
      claims: { id: string; at: string; name?: string; by: { note?: string; other?: string }[] }[];
    };
    const mine = shelved.claims.find((c) => c.id === old);
    expect(mine?.name).toBe("waveTable");
    // **Absolute, like every other address this surface reports.** This read the
    // stored form and printed it raw, so a claim framed on a layer came back at
    // its offset — `$0000` for a claim on the byte at `$0801`.
    expect(mine?.at).toBe("$8F40");
    expect(mine?.by[0].other).toBe(now);
    expect(mine?.by[0].note).toContain("never as waveforms");

    // Said out loud rather than left to be inferred from a document that looks
    // tidier than it is.
    const project = (await callTool("describe_project", {})).value as { retired?: number };
    expect(project.retired).toBeGreaterThanOrEqual(1);

    // Restoring is removing what retired it. Nothing about the claim changed,
    // so there is nothing to restore *to* — which is why retirement is derived
    // from the evidence rather than stored as a flag on the claim.
    const back = await callTool("restore_claim", { id: old });
    expect(back.isError, back.text).toBe(false);
    const again = (await callTool("claims_at", { address: "$8F40" })).value as {
      claims: { id?: string; name?: string }[];
    };
    expect(again.claims.find((c) => c.id === old)?.name).toBe("waveTable");
  });

  it("refuses to retire without a reason a later reader can follow", async () => {
    // Same rule refutation follows, and it matters more here: this one takes
    // the claim out of sight.
    const made = await callTool("add_claim", { address: "$8F50", name: "Unexplained" });
    const claim = (made.value as { claims: { claim: string }[] }).claims[0].claim;

    const refused = await callTool("retire_claim", { id: claim });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/reason/);
  });

  it("says how a claim was reached, so agreement can be told from repetition", async () => {
    const made = await callTool("add_claim", { address: "$8F20", name: "watched", method: "ran" });
    expect(made.isError).toBe(false);

    const here = (await callTool("claims_at", { address: "$8F20" })).value as {
      claims: { name?: string; by?: { author: string; method?: string }[] }[];
    };
    const mine = here.claims.find((c) => c.name === "watched");
    // **On the vouching, not on the claim** — which is what makes the next part
    // possible: a second reader reaching the same finding a different way adds
    // an account to this list rather than a claim nobody can merge with it.
    expect(mine?.by?.[0]).toMatchObject({ method: "ran" });
    expect(mine?.by?.[0].author).toBeTruthy();
  });

  it("backs a claim with a scenario, which re-verifies rather than asserting", async () => {
    // The form both agents asked for: evidence as a named re-runnable probe.
    // Theirs lived in shell history and was gone by the time anybody read the
    // finding it supported.
    const probe = await callTool("add_scenario", {
      name: "the header is a cartridge",
      steps: [
        { kind: "start", at: "$8000", vector: true },
        { kind: "assert", memory: { "$8004": 0xc3 }, note: "CBM80 signature" },
      ],
    });
    const scenario = (probe.value as { scenario: string }).scenario;

    const claim = await callTool("add_claim", { address: "$8004", name: "cartridgeHeader", method: "ran" });
    const id = (claim.value as { claims: { claim: string }[] }).claims[0].claim;
    expect((await callTool("add_evidence", { claim: id, kind: "supports", scenario })).isError)
      .toBe(false);

    // And running it says pass or fail, which is what makes it evidence.
    const run = (await callTool("run_scenario", { id: scenario })).value as {
      passed?: boolean;
      checks?: { ok: boolean; said: string }[];
    };
    expect(run.passed).toBe(true);
    expect(run.checks![0].said).toContain("CBM80 signature");
  });
});

describe("a target only where a target means something", () => {
  /**
   * **The schema is the surface, and it used to say something untrue.**
   *
   * `target` was injected onto all ninety-four tools — convenient, and a lie in
   * the one place agents read: a tool advertising an argument it cannot use
   * tells a reader it matters. It was not only cosmetic. A view could *break* a
   * call whose meaning it could not change: `add_evidence` refused three writes
   * during a silver-image build because the claims were framed on a layer that
   * the view nobody had chosen did not link, and reported them as retired.
   *
   * Every tool is now in exactly one class, so a new one cannot be added
   * without the decision being made — the same shape as the exhaustive op table
   * in `roundtrip.test.ts` and the section list in `api-doc-source.ts`.
   */
  it("puts every tool in exactly one class, and names no tool that is not there", async () => {
    const listed = ((await rpc("tools/list")) as {
      result: { tools: { name: string; inputSchema: { properties?: object } }[] };
    }).result.tools;
    expect(listed.length).toBeGreaterThan(80);

    const declares = (t: (typeof listed)[number]) =>
      Object.keys(t.inputSchema.properties ?? {}).includes("target");

    for (const tool of listed) {
      expect(
        VIEWLESS.has(tool.name) ? !declares(tool) : declares(tool),
        `${tool.name} is ${VIEWLESS.has(tool.name) ? "view-free but declares" : "view-bound but omits"} target`
      ).toBe(true);
    }

    const real = new Set(listed.map((t) => t.name));
    for (const name of VIEWLESS) {
      expect(real.has(name), `VIEWLESS names ${name}, which is not a tool`).toBe(true);
    }
  });

  it("does not answer with a view where no view was involved", async () => {
    // A document edit belongs to every view, so naming one would be inventing a
    // scope for it — the same reason it takes no target in the first place.
    const made = await callTool("add_constant", { name: "VIEWLESS_PROBE", value: "$2A" });
    expect(made.isError, made.text).toBe(false);
    expect(made.value).not.toHaveProperty("target");
    // And no instruction delta: there is no view for that count to be about.
    expect(made.value).not.toHaveProperty("instructions");
  });

  it("refuses a target on a tool that has none, rather than ignoring it", async () => {
    // `strictObject`, which is why: "ok, did nothing" is the worst answer for
    // something probing what an API can do.
    const refused = await callTool("list_evidence", { target: "runtime" });
    expect(refused.isError).toBe(true);
  });
});

describe("a field type refers by id and reads by name", () => {
  /**
   * **Names are suggestive and that is worth keeping.** `Creature[CreatureCount]`
   * is something a reader can be wrong about out loud; `typ_kj39fa[cst_x0plq2]`
   * is something nobody can be wrong about because nobody can read it. So the
   * name stays the way it is written and the way it renders, and the *reference*
   * stored in the document is an id — renaming then changes how a field reads
   * and never what it means.
   *
   * Which makes ambiguity the interesting case, and it is refused rather than
   * guessed: a bare name two types answer to comes back with both `name@id`
   * forms, and that refusal is itself the notice that the document has grown a
   * second `Creature`.
   */
  it("stores an id for a type a caller named, and renders the name back", async () => {
    const made = await callTool("add_type", {
      name: "Creature",
      size: 4,
      fields: { 0: { name: "kind", type: "u8" } },
    });
    expect(made.isError, made.text).toBe(false);
    const creature = (made.value as { type: string }).type;

    const holder = await callTool("add_type", {
      name: "Wave",
      size: 8,
      fields: { 0: { name: "first", type: "Creature" } },
    });
    expect(holder.isError, holder.text).toBe(false);

    // Rendered as the name...
    const listed = (await callTool("list_types", {})).value as {
      types: { name: string; fields: { name: string; type: string }[] }[];
    };
    const wave = listed.types.find((t) => t.name === "Wave")!;
    expect(wave.fields.find((f) => f.name === "first")!.type).toBe("Creature");

    // ...and stored as the id, which is what a rename must not disturb.
    const exported = JSON.parse(
      ((await callTool("export_project", {})).value as { text: string }).text
    ) as { types: { name: string; fields: Record<string, { type: string }> }[] };
    const stored = exported.types.find((t) => t.name === "Wave")!;
    expect(Object.values(stored.fields)[0].type).toBe(creature);
  });

  it("refuses a name two types answer to, and names both", async () => {
    const first = await callTool("add_type", { name: "Twin", size: 2, fields: {} });
    const second = await callTool("add_type", { name: "Twin", size: 2, fields: {} });
    expect(first.isError, first.text).toBe(false);
    expect(second.isError, second.text).toBe(false);
    const a = (first.value as { type: string }).type;
    const b = (second.value as { type: string }).type;

    // A whole declaration whose only field is ambiguous refuses, and says which
    // two — the refusal is the notice that a second `Twin` now exists.
    const refused = await callTool("add_type", {
      name: "Holder",
      size: 4,
      fields: { 0: { name: "which", type: "Twin" } },
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain(`Twin@${a}`);
    expect(refused.text).toContain(`Twin@${b}`);

    // The disambiguated form is accepted straight back, on the same call.
    const made = await callTool("add_type", {
      name: "Holder",
      size: 4,
      fields: { 0: { name: "which", type: `Twin@${b}` } },
    });
    expect(made.isError, made.text).toBe(false);
    const holder = (made.value as { type: string }).type;

    // Stored as the id it named, not as either name.
    const exported = JSON.parse(
      ((await callTool("export_project", {})).value as { text: string }).text
    ) as { types: { id: string; fields: Record<string, { type: string }> }[] };
    const stored = exported.types.find((t) => t.id === holder)!;
    expect(Object.values(stored.fields)[0].type).toBe(b);

    // And rendered back with the suffix, because the plain name is no longer
    // something this project can resolve.
    const listed = (await callTool("list_types", {})).value as {
      types: { id: string; fields: { type: string }[] }[];
    };
    expect(listed.types.find((t) => t.id === holder)!.fields[0].type).toBe(`Twin@${b}`);

    // add_field takes the same three spellings, since one resolver serves all
    // three writers.
    const byId = await callTool("add_field", {
      typeId: holder,
      offset: 2,
      name: "other",
      type: a,
    });
    expect(byId.isError, byId.text).toBe(false);
    const byBareName = await callTool("add_field", {
      typeId: holder,
      offset: 3,
      name: "nope",
      type: "Twin",
    });
    expect(byBareName.isError).toBe(true);
    expect(byBareName.text).toContain("say which");
  });
});

describe("a field is addressed by its id, and a record is not its fields", () => {
  /**
   * **Two routes wrote one storage, and one of them was keyed on the thing that
   * is explicitly not an identity.** `edit_type` required a whole layout back and
   * merged it per offset. Once two fields may sit at one offset — which they may,
   * because two readers disagreeing about a layout is the state this model exists
   * to hold — an offset cannot say which of them an edit meant, and it took
   * whichever it found first.
   *
   * It also made renaming a record restate its size, which is how a caller loses
   * a field: send the layout back one field short and the short version wins.
   */
  it("renames a record without being told its size or its fields", async () => {
    const made = await callTool("add_type", {
      name: "Zone",
      size: 8,
      fields: { 0: { name: "left", type: "u8" }, 4: { name: "right", type: "u8" } },
    });
    expect(made.isError, made.text).toBe(false);
    const id = (made.value as { type: string }).type;

    const renamed = await callTool("edit_type", { id, name: "ZoneEntry" });
    expect(renamed.isError, renamed.text).toBe(false);

    const listed = (await callTool("list_types", {})).value as {
      types: { id: string; name: string; size: number | string; fields: { name: string }[] }[];
    };
    const held = listed.types.find((t) => t.id === id)!;
    expect(held.name).toBe("ZoneEntry");
    expect(held.fields.map((f) => f.name)).toEqual(["left", "right"]);
  });

  it("refuses a size that would strand the fields already in the record", async () => {
    const made = await callTool("add_type", {
      name: "Wide",
      size: 8,
      fields: { 0: { name: "head", type: "u8" }, 6: { name: "tail", type: "u8" } },
    });
    const id = (made.value as { type: string }).type;

    const shrunk = await callTool("edit_type", { id, size: 4 });
    expect(shrunk.isError).toBe(true);
    expect(`${shrunk.text}`).toContain("tail");
  });

  it("checks an offset against the offsets, not against a position in a list", async () => {
    // `Object.entries` over a **list** hands back array indices, so this
    // compared 0, 1 against a record laid out at 0 and $A0 — the third time this
    // project has been caught by that exact substitution.
    const made = await callTool("add_type", {
      name: "Sparse",
      size: 0x100,
      fields: { 0: { name: "head", type: "u8" }, 0xa0: { name: "tail", type: "u8" } },
    });
    const id = (made.value as { type: string }).type;
    const fields = (
      (await callTool("list_types", {})).value as {
        types: { id: string; fields: { id: string; name: string; offset: number }[] }[];
      }
    ).types.find((t) => t.id === id)!.fields;
    const head = fields.find((f) => f.name === "head")!;

    // Offset 1 is free, and only an index-shaped check would say otherwise.
    const moved = await callTool("edit_field", { typeId: id, id: head.id, offset: 1 });
    expect(moved.isError, moved.text).toBe(false);

    // $A0 is taken, and only an offset-shaped check can see that.
    const onto = await callTool("edit_field", { typeId: id, id: head.id, offset: 0xa0 });
    expect(onto.isError).toBe(true);
    expect(onto.text).toContain("tail");
  });
});

describe("a message is an entity", () => {
  /**
   * **Messages have carried an id since they existed and no surface returned
   * one**, so nothing could revise or take one back. F1 in the place it is
   * easiest to miss: the value was minted, stored and read back, and stopped at
   * the door.
   */
  it("returns the id it minted, and takes it back by that id", async () => {
    const said = await callTool("post_message", { text: "starting on the loader" });
    expect(said.isError, said.text).toBe(false);
    const id = (said.value as { message: string }).message;
    expect(id).toMatch(/^msg_/);

    const reworded = await callTool("edit_message", { id, text: "starting on the decruncher" });
    expect(reworded.isError, reworded.text).toBe(false);

    const held = (await callTool("read_messages", {})).value as {
      messages: { id: string; text: string; from: string }[];
    };
    const mine = held.messages.find((m) => m.id === id)!;
    expect(mine.text).toBe("starting on the decruncher");

    const gone = await callTool("remove_message", { id });
    expect(gone.isError, gone.text).toBe(false);
    const after = (await callTool("read_messages", {})).value as { messages: { id: string }[] };
    expect(after.messages.some((m) => m.id === id)).toBe(false);
  });

  it("is in the document, and moves no version", async () => {
    // The two halves of the decision. Chat travels with the exported file, so a
    // project arrives with the argument that produced it — and it re-analyses
    // nothing, which is what the old fifth-root design was protecting and what
    // `programFromDoc` now protects by a stated rule instead of by omission.
    const before = (await callTool("describe_project", {})).value as { version: string };
    const said = await callTool("post_message", { text: "the zone table is 42 x 200" });
    expect(said.isError, said.text).toBe(false);

    const exported = ((await callTool("export_project", {})).value as { text: string }).text;
    expect(exported).toContain("the zone table is 42 x 200");

    const after = (await callTool("describe_project", {})).value as { version: string };
    expect(after.version).toBe(before.version);
  });
});

describe("a session reads its own copy of the document", () => {
  /**
   * **The browser tab an agent does not have.**
   *
   * Everything a session reads answers from the document as *it* last saw it, so
   * a name means the same thing from one call to the next and a batch cannot
   * have the ground move under it halfway through. Its own writes are there at
   * once — only other people's wait, and only until it asks.
   *
   * This is what the offline rule actually requires. Resolving against whatever
   * the server currently holds is "an operation whose correctness depends on
   * having seen what everyone else did", which is the failure the rule names,
   * not a defence of it.
   */
  const as = async (session: string, name: string, args: Record<string, unknown> = {}) => {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "x-re64-user": "usr_agent",
        "x-re64-session": session,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    const text = await res.text();
    const line = text.split("\n").find((l) => l.startsWith("data: ")) ?? text;
    const reply = JSON.parse(line.replace(/^data: /, "")) as {
      result: { content: { text: string }[]; isError?: boolean };
    };
    const body = reply.result.content[0].text;
    const isError = reply.result.isError === true;
    return { isError, text: body, value: (isError ? undefined : JSON.parse(body)) as never };
  };

  it("does not show one session another's work until it merges", async () => {
    // Beta reads first, so its copy exists before alpha writes. A session that
    // joins *after* a write starts from what is there — there is nothing for it
    // to be out of step with yet, which is the same rule read forwards.
    await as("ses_beta", "list_types", {});

    const mine = await as("ses_alpha", "add_type", { name: "Creature", size: 4, fields: {} });
    expect(mine.isError, mine.text).toBe(false);

    // Alpha sees what alpha just did: only the inbox is deferred, so "add a
    // type, then use it" works within one session.
    const own = (await as("ses_alpha", "list_types", {})).value as {
      types: { name: string }[];
    };
    expect(own.types.some((t) => t.name === "Creature")).toBe(true);

    // Beta does not, and is told there is something waiting rather than left to
    // wonder.
    const theirs = (await as("ses_beta", "list_types", {})).value as {
      types: { name: string }[];
      pending?: { operations: number; from: string[] };
    };
    expect(theirs.types.some((t) => t.name === "Creature")).toBe(false);
    expect(theirs.pending?.operations).toBeGreaterThan(0);

    // And after asking, it does.
    const merged = (await as("ses_beta", "merge", {})).value as { merged: number };
    expect(merged.merged).toBeGreaterThan(0);
    const after = (await as("ses_beta", "list_types", {})).value as {
      types: { name: string }[];
      pending?: unknown;
    };
    expect(after.types.some((t) => t.name === "Creature")).toBe(true);
    // Nothing waiting, so nothing said: a counter reading zero on most calls
    // teaches a reader to stop looking.
    expect(after.pending).toBeUndefined();
  });

  it("resolves a name against what this session knows, not what the server holds", async () => {
    // The point of the whole arrangement. Alpha declares a second `Twin` and
    // beta, which has not seen it, still resolves `Twin` to the one it knows —
    // rather than being refused for an ambiguity it cannot see.
    const first = await as("ses_a2", "add_type", { name: "Twin", size: 2, fields: {} });
    expect(first.isError, first.text).toBe(false);
    await as("ses_b2", "merge", {});

    const second = await as("ses_a2", "add_type", { name: "Twin", size: 2, fields: {} });
    expect(second.isError, second.text).toBe(false);

    // Alpha sees two and must say which.
    const forAlpha = await as("ses_a2", "add_type", {
      name: "HolderA",
      size: 4,
      fields: { 0: { name: "which", type: "Twin" } },
    });
    expect(forAlpha.isError).toBe(true);
    expect(forAlpha.text).toContain("say which");

    // Beta sees one, and its write means what beta meant.
    const forBeta = await as("ses_b2", "add_type", {
      name: "HolderB",
      size: 4,
      fields: { 0: { name: "which", type: "Twin" } },
    });
    expect(forBeta.isError, forBeta.text).toBe(false);
  });
});

describe("two requests overlapping keep their own identities", () => {
  /**
   * **The caller was a server-global closure**, reassigned at the top of each
   * `/mcp` request and read *later*, during tool execution — with the request
   * body still arriving in between. Two requests overlapping by that much is
   * ordinary rather than exotic, and the second replaced the first's identity: a
   * claim asked for by one user was recorded as another, under another's session
   * and in another's undo scope.
   *
   * It became worse when a session started reading its own copy of the document:
   * a request that resolves the wrong caller reads the wrong *replica* too.
   *
   * `Workspace` could not have caught this. It answers correctly for whatever
   * caller it is handed, and the defect is in what hands it one — so this test
   * has to be over the real transport, with a body held open.
   */
  const send = (user: string, payload: string) =>
    fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "x-re64-user": user,
        "x-re64-session": `ses_${user}`,
      },
      body: payload,
    });

  it("records a slow request under the user that sent it", async () => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "add_claim", arguments: { address: "$8E40", name: "FromAlice" } },
    });

    // A stream that dribbles the body out, so a second request can complete in
    // the middle of the first — which is the whole point.
    const slow = new ReadableStream({
      async start(controller) {
        const bytes = new TextEncoder().encode(body);
        controller.enqueue(bytes.slice(0, 20));
        await new Promise((resolve) => setTimeout(resolve, 120));
        controller.enqueue(bytes.slice(20));
        controller.close();
      },
    });

    const alice = fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "x-re64-user": "usr_alice",
        "x-re64-session": "ses_alice",
      },
      body: slow,
      // undici wants this to stream a request body rather than buffer it, which
      // is the whole point here: the overlap only exists while the body is
      // still arriving.
      duplex: "half",
    });

    // Bob finishes while Alice's body is still on the wire.
    await new Promise((resolve) => setTimeout(resolve, 40));
    const bob = await send(
      "usr_bob",
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "whoami" } })
    );
    expect(bob.ok).toBe(true);
    await alice;

    const changes = (await callTool("changes_since", { cursor: 0 })).value as {
      changes: { did: string; by?: string }[];
    };
    const naming = changes.changes.find((c) => c.did.includes("FromAlice"));
    expect(naming, "Alice's claim never landed").toBeDefined();
    expect(naming!.by).toBe("usr_alice");
  });
});

describe("a number is a whole number or it is refused", () => {
  /**
   * **`parseInt` stops at the first character it cannot use and returns what it
   * had.** So `$8000+1` parsed as `$8000`, and an `add_claim` for it *succeeded*
   * — writing at an address the caller did not ask for and reporting success.
   * Arithmetic is not offered here, and a caller who wrote some is much better
   * told than quietly obeyed.
   *
   * The same shape was in the byte and flag transforms, so all three share one
   * parser now. It stays separate from `parsePlace`, which handles
   * `screen[10,2]` — that is a grammar, and folding it in is what would make
   * arithmetic look supported.
   */
  it("refuses an address with anything after the number", async () => {
    for (const address of ["$8000+1", "$8000 1", "0x8000-", "32768x", "$80.00", "$"]) {
      const refused = await callTool("add_claim", { address, name: "ShouldNotLand" });
      expect(refused.isError, `${address} was accepted`).toBe(true);
    }

    // And nothing landed at $8000 from the first of them.
    const here = (await callTool("claims_at", { address: "$8000" })).value as {
      claims: { name?: string }[];
    };
    expect(here.claims.some((c) => c.name === "ShouldNotLand")).toBe(false);
  });

  it("still takes every spelling it advertises", async () => {
    const made = await callTool("add_claim", { address: "$8F90", name: "Dollar" });
    expect(made.isError, made.text).toBe(false);
    for (const [address, name] of [
      ["0x8F91", "Hex"],
      ["36754", "Decimal"],
      [36755, "Number"],
      [" $8F94 ", "Padded"],
    ] as const) {
      const ok = await callTool("add_claim", { address, name });
      expect(ok.isError, `${String(address)}: ${ok.text}`).toBe(false);
    }
  });

  it("refuses a byte and a flag the same way", async () => {
    // `bind_constant` takes a byte-shaped value; a flag is 0 or 1 and took a
    // prefix too.
    const bad = await callTool("add_constant", { name: "BAD", value: "$2A+1" });
    expect(bad.isError).toBe(true);
    const good = await callTool("add_constant", { name: "GOOD", value: "$2A" });
    expect(good.isError, good.text).toBe(false);
  });
});
