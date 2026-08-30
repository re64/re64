import { describe, it, expect } from "vitest";
import { CommentIndex, createComment } from "./comment.js";

describe("comments at an address", () => {
  it("keeps every one, rather than choosing", () => {
    // No primary comment and no index picking one. That machinery exists for
    // labels because operand rendering must substitute exactly one name for an
    // address — a forced single choice. Nothing forces one here.
    const index = new CommentIndex();
    index.add(createComment("cmt_b", 0x8000, "before", "second"));
    index.add(createComment("cmt_a", 0x8000, "before", "first"));

    expect(index.at(0x8000, "before").map((c) => c.text)).toEqual(["first", "second"]);
  });

  it("orders by id, so every peer agrees without coordinating", () => {
    const forwards = new CommentIndex();
    const backwards = new CommentIndex();
    const comments = [
      createComment("cmt_c", 0x8000, "before", "c"),
      createComment("cmt_a", 0x8000, "before", "a"),
      createComment("cmt_b", 0x8000, "before", "b"),
    ];

    forwards.addAll(comments);
    backwards.addAll([...comments].reverse());

    expect(forwards.at(0x8000, "before")).toEqual(backwards.at(0x8000, "before"));
  });

  it("separates the two placements", () => {
    const index = new CommentIndex();
    index.add(createComment("cmt_a", 0x8000, "before", "above"));
    index.add(createComment("cmt_b", 0x8000, "inline", "beside"));

    expect(index.at(0x8000, "before").map((c) => c.text)).toEqual(["above"]);
    expect(index.at(0x8000, "inline").map((c) => c.text)).toEqual(["beside"]);
  });

  it("knows whether anything is written about an address at all", () => {
    const index = new CommentIndex();
    index.add(createComment("cmt_a", 0x8000, "inline", "x"));

    expect(index.has(0x8000)).toBe(true);
    expect(index.has(0x8001)).toBe(false);
  });
});
