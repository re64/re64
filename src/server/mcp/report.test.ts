import { describe, it, expect } from "vitest";
import { McpLogEntry } from "./log.js";
import { formatSummary, readTranscript, shapeOf, summarise } from "./report.js";

const entry = (over: Partial<McpLogEntry>): McpLogEntry => ({
  at: "2026-08-30T12:00:00.000Z",
  ms: 5,
  ok: true,
  bytes: 100,
  method: "tools/call",
  ...over,
});

describe("what the transcript is asked", () => {
  it("names tools that were reached for and are not there", () => {
    // The point of the whole exercise: the agent says what is missing by
    // trying to use it.
    const summary = summarise([
      entry({ tool: "add_label" }),
      entry({
        tool: "add_comment",
        ok: false,
        error: "MCP error -32602: Tool add_comment not found",
        args: { address: "$8870", text: "wait for raster" },
      }),
      entry({
        tool: "add_comment",
        ok: false,
        error: "MCP error -32602: Tool add_comment not found",
      }),
    ]);

    expect(summary.absent).toEqual([
      { tool: "add_comment", calls: 2, example: { address: "$8870", text: "wait for raster" } },
    ]);
    // And it does not appear as a tool that exists and failed.
    expect(summary.tools.map((t) => t.tool)).toEqual(["add_label"]);
  });

  it("keeps a real tool that merely refused out of the missing list", () => {
    const summary = summarise([
      entry({ tool: "remove_label", ok: false, error: "no label at $8F80" }),
      entry({ tool: "remove_label" }),
    ]);

    expect(summary.absent).toEqual([]);
    expect(summary.tools[0]).toMatchObject({ tool: "remove_label", calls: 2, failed: 1 });
  });

  it("groups a refusal by its shape, not its particulars", () => {
    const summary = summarise([
      entry({ tool: "remove_label", ok: false, error: "no label at $8F80" }),
      entry({ tool: "remove_label", ok: false, error: "no label at $9000" }),
      entry({ tool: "remove_label", ok: false, error: "no label at $A100" }),
    ]);

    expect(summary.refusals).toEqual([
      {
        shape: "no label at $_",
        count: 3,
        tool: "remove_label",
        example: "no label at $8F80",
      },
    ]);
  });

  it("counts what a reader had to read", () => {
    const summary = summarise([
      entry({ tool: "read_disassembly", bytes: 40_000, ms: 30 }),
      entry({ tool: "read_disassembly", bytes: 20_000, ms: 10 }),
    ]);

    expect(summary.tools[0]).toMatchObject({ bytes: 60_000, medianMs: 30 });
  });

  it("answers the question about hosts and sessions", () => {
    // Whether several agents are several clients or one shared client, which
    // is what decides how agent sessions have to be keyed.
    const summary = summarise([
      entry({
        method: "initialize",
        client: { name: "claude-code", version: "1.0" },
        protocol: "2025-06-18",
        session: "a",
      }),
      entry({
        method: "initialize",
        client: { name: "claude-code", version: "1.0" },
        protocol: "2025-06-18",
        session: "b",
      }),
      entry({ tool: "add_label", session: "a", sessionId: "ses_1", codename: "basalt" }),
      entry({ tool: "add_label", session: "b", sessionId: "ses_2", codename: "quartz" }),
    ]);

    expect(summary.hosts).toEqual([
      { name: "claude-code", version: "1.0", protocol: "2025-06-18", initializes: 2 },
    ]);
    expect(summary.distinctMcpSessions).toBe(2);
    expect(summary.sessions.map((s) => s.codename).sort()).toEqual(["basalt", "quartz"]);
  });

  it("counts calls that arrived with no session handle", () => {
    // These all shared one lease, and therefore one undo scope. Silent
    // otherwise, which is exactly what makes it worth counting.
    const summary = summarise([entry({ tool: "add_label" }), entry({ tool: "add_label" })]);
    expect(summary.unkeyed).toBe(2);
  });

  it("reports the span so a run can be placed in time", () => {
    const summary = summarise([
      entry({ at: "2026-08-30T12:05:00.000Z" }),
      entry({ at: "2026-08-30T12:00:00.000Z" }),
    ]);

    expect(summary.span).toEqual({
      from: "2026-08-30T12:00:00.000Z",
      to: "2026-08-30T12:05:00.000Z",
    });
  });
});

describe("reading the file", () => {
  it("skips a line it cannot parse rather than giving up on the run", () => {
    // A log being tailed while a server is running ends mid-write often enough
    // that failing here would mean never reading a live experiment.
    const parsed = readTranscript('{"ok":true,"bytes":1,"at":"x","ms":1}\n{"ok":tr');
    expect(parsed).toHaveLength(1);
  });

  it("ignores blank lines", () => {
    expect(readTranscript("\n\n")).toEqual([]);
  });
});

describe("shaping a message", () => {
  it("removes what varies between instances of one gap", () => {
    expect(shapeOf("no label at $8F80")).toBe("no label at $_");
    expect(shapeOf('unknown region kind "sprite"')).toBe('unknown region kind "_"');
    expect(shapeOf("expected 1449 instructions")).toBe("expected _ instructions");
  });

  it("leaves a message with nothing variable in it alone", () => {
    expect(shapeOf("the project changed since you read it")).toBe(
      "the project changed since you read it"
    );
  });
});

describe("the printed report", () => {
  it("leads with what is missing", () => {
    const text = formatSummary(
      summarise([
        entry({ tool: "add_label" }),
        entry({ tool: "add_comment", ok: false, error: "Tool add_comment not found" }),
      ])
    );

    expect(text).toContain("Reached for and not there:");
    expect(text.indexOf("add_comment")).toBeLessThan(text.indexOf("Used:"));
  });

  it("says plainly when nothing announced itself", () => {
    expect(formatSummary(summarise([]))).toContain("none announced themselves");
  });
});
