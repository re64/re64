import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { analyze, formatRows } from "./core/index.js";
import { loadProjectFile } from "./node-files.js";

/**
 * The disassembly of the reference project, pinned.
 *
 * Storage is being moved out from under this pipeline — the project text, then
 * the binaries. None of that may change a single byte of the output, and the
 * cheapest way to know is to hash it. A failure here means the bytes reaching
 * the disassembler are not the bytes that reached it before; the counts below
 * are only there to say *how* it moved.
 */

const PROJECT = "assets/gridrunner.re64";
const OUTPUT_SHA1 = "bad43dce3f919744596d89085551bf47a10679d2";

describe("gridrunner disassembly", () => {
  const result = analyze(loadProjectFile(PROJECT), { annotations: false });
  const text = formatRows(result.rows, result.arrows).join("\n");

  it("renders byte-for-byte what it rendered before", () => {
    expect(createHash("sha1").update(text).digest("hex")).toBe(OUTPUT_SHA1);
  });

  it("holds its shape", () => {
    expect(result.stats).toMatchObject({
      instructions: 1449,
      rows: 1846,
      arrows: 206,
      regions: 16,
      // 495, not the 597 this asserted before: the merged index counted every
      // user label twice, once through the memory map and once directly. The
      // rendered text never showed it because label rows dedupe by name, which
      // is why the hash above is unchanged.
      labels: 495,
    });
  });

  it("warns only about KERNAL calls, which have no loaded bytes", () => {
    // These are named by the platform symbol layer, which supplies no bytes on
    // purpose. A warning naming anything else means a layer stopped resolving.
    expect([...result.warnings].sort()).toEqual([
      "$E518: undefined bytes",
      "$FD15: undefined bytes",
      "$FD50: undefined bytes",
      "$FDA3: undefined bytes",
      "$FFD2: undefined bytes",
    ]);
  });
});
