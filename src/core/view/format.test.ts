import { describe, it, expect } from "vitest";
import { formatRows, formatWarnings } from "./format.js";
import { Row } from "./rows.js";

const row = (text: string): Row => ({
  address: 0x8000,
  kind: "instruction",
  text,
  tokens: [{ start: 0, end: 4, kind: "operand", target: 0x8100 }],
});

describe("formatRows", () => {
  it("renders row text and ignores interaction spans", () => {
    // The spans exist for the web UI; nothing in a terminal is clickable.
    expect(formatRows([row("8000  A9 00      LDA #$00")])).toEqual([
      "8000  A9 00      LDA #$00",
    ]);
  });

  it("returns one line per row, in order", () => {
    expect(formatRows([row("a"), row("b"), row("c")])).toEqual(["a", "b", "c"]);
  });

  it("handles an empty document", () => {
    expect(formatRows([])).toEqual([]);
  });
});

describe("formatWarnings", () => {
  it("indents warnings the way the CLI reports them", () => {
    expect(formatWarnings(["$FDA3: undefined bytes"])).toEqual([
      "  $FDA3: undefined bytes",
    ]);
  });
});
