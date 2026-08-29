import { describe, it, expect } from "vitest";
import { encodeChanges, decodeChanges, undoable, redoable, change } from "./log.js";
import { Change, Op } from "./types.js";

const op: Op = {
  op: "label.set",
  id: "lbl_1",
  layerId: "lay_a",
  address: 0x8000,
  name: "Start",
};
const inverse: Op = { op: "label.delete", id: "lbl_1", layerId: "lay_a" };

describe("the edit log", () => {
  it("round-trips changes", () => {
    const changes = [change(op, inverse, "cli", 1000)];
    expect(decodeChanges(encodeChanges(changes))).toEqual(changes);
  });

  it("writes one line per change, so appending never rewrites the file", () => {
    const text = encodeChanges([change(op, inverse), change(op, inverse)]);
    expect(text.trimEnd().split("\n")).toHaveLength(2);
  });

  it("keeps the entries it can read when the last line is truncated", () => {
    // Exactly what a crash mid-write leaves behind, which is the case the log
    // exists for — losing one entry beats losing the file.
    const good = encodeChanges([change(op, inverse)]);
    expect(decodeChanges(good + '{"op":{"op":"label.se')).toHaveLength(1);
  });

  it("ignores blank lines and entries missing an inverse", () => {
    const text = ['{"op":{"op":"primary.clear","address":1}}', "", encodeChanges([change(op, inverse)])].join("\n");
    expect(decodeChanges(text)).toHaveLength(1);
  });

  it("encodes an empty log as an empty string", () => {
    expect(encodeChanges([])).toBe("");
    expect(decodeChanges("")).toEqual([]);
  });

  it("separates what can be undone from what can be redone", () => {
    const changes: Change[] = [
      { op, inverse },
      { op, inverse, undone: true },
    ];
    expect(undoable(changes)).toHaveLength(1);
    expect(redoable(changes)).toHaveLength(1);
  });
});
