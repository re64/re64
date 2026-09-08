import { describe, it, expect } from "vitest";
import { describeOp } from "./types.js";

/**
 * A description is very much the wire.
 *
 * It is the field a caller reads to check that its write did what it asked, and
 * a layer-framed claim stores an *offset* into its layer's bytes. Describing one
 * without resolving it reported `$03C1` for a claim written at `$83C1`, and the
 * first reader to meet it read that as their write having landed 32KB away.
 */
const at = (position: number, framed = true) =>
  ({
    op: "claim.add" as const,
    claim: {
      id: "clm_1",
      at: position,
      ...(framed ? { frame: { space: "layer" as const, layer: "lay_a" } } : {}),
      root: "entry" as const,
      origin: "user" as const,
    },
  });

describe("describing a claim", () => {
  it("speaks the address the caller used, not the offset it is stored as", () => {
    expect(describeOp(at(0x3c1), () => 0x83c1)).toContain("$83C1");
  });

  it("says the offset it has when there is no project to resolve against", () => {
    // Two of the four callers describe an op with no project to hand. Spelling
    // it as an offset is honest; spelling it as an address it is not was the bug.
    expect(describeOp(at(0x3c1), () => undefined)).toContain("+$03C1");
  });

  it("ends a span on its last byte, like every other span this surface prints", () => {
    const span = {
      op: "claim.add" as const,
      claim: {
        id: "clm_2",
        at: 0,
        extent: 32,
        says: { is: "text" as const },
        origin: "user" as const,
      },
    };
    // `covers` says `$8F00-$8F1F` for 32 bytes; this said `-$8F20`.
    expect(describeOp(span, () => 0x8f00)).toContain("$8F00-$8F1F");
  });
});
