/**
 * What a decoder can and cannot do.
 *
 * The tests that matter here are the refusals: this runs code that arrived in a
 * project file, so "it computed the right pixels" is the easy half and "it could
 * not reach anything" is the half worth proving.
 */

import { describe, it, expect } from "vitest";
import { runDecoder } from "./run.js";

/** Wraps a body as a decoder: it receives `bytes` and `params`, and returns. */
const run = (body: string, bytes: number[] = [0xff, 0x00], params = {}) =>
  runDecoder(body, bytes, params);

describe("a decoder that behaves", () => {
  it("turns bytes into pixels", async () => {
    const result = await run(`
      const pixels = new Array(bytes.length * 8);
      for (let i = 0; i < bytes.length; i++)
        for (let b = 0; b < 8; b++) pixels[i * 8 + b] = (bytes[i] >> (7 - b)) & 1;
      return { kind: "bitmap", width: 8, height: bytes.length, pixels,
               palette: ["#000000", "#ffffff"] };
    `);
    expect(result.ok).toBe(true);
    expect(result.decoded).toMatchObject({ kind: "bitmap", width: 8, height: 2 });
  });

  it("can return an animation, which is the case a table could not express", async () => {
    const result = await run(`
      const frame = (v) => ({ width: 1, height: 1, pixels: [v], palette: ["#000000", "#ffffff"] });
      return { kind: "frames", delayMs: 40, frames: [frame(0), frame(1)] };
    `);
    expect(result.ok).toBe(true);
    expect((result.decoded as { frames: unknown[] }).frames).toHaveLength(2);
  });

  it("is given its own copy of the bytes", async () => {
    // SES stops a decoder reaching the outside world; it does not stop one
    // scribbling on what it was handed, and those are the loaded program.
    const bytes = [1, 2, 3];
    await runDecoder(`bytes[0] = 99; return { kind: "text", lines: [] };`, bytes);
    expect(bytes[0]).toBe(1);
  });
});

describe("what a decoder cannot reach", () => {
  const blocked = (label: string, body: string) =>
    it(label, async () => {
      const result = await run(`return { kind: "text", lines: [String(${body})] };`);
      const line = (result.decoded as { lines?: string[] } | undefined)?.lines?.[0];
      // Either it threw, or the thing simply is not there.
      expect(result.ok === false || line === "undefined").toBe(true);
    });

  blocked("the network", "typeof fetch");
  blocked("the process", "typeof process");
  blocked("the module system", "typeof require");
  blocked("the file system", "typeof globalThis.process");

  it("cannot climb out through a constructor", async () => {
    // The escape that makes a hand-rolled sandbox worthless, and the reason
    // this uses SES rather than deleting a few globals.
    const result = await run(
      `return { kind: "text", lines: [String((function(){}).constructor("return typeof process")())] };`
    );
    expect(result.ok).toBe(false);
  });

  it("cannot read a clock, so the same bytes give the same answer", async () => {
    const result = await run(`return { kind: "text", lines: [String(Date.now())] };`);
    expect(result.ok).toBe(false);
  });

  it("cannot be random, for the same reason", async () => {
    const result = await run(`return { kind: "text", lines: [String(Math.random())] };`);
    expect(result.ok).toBe(false);
  });
});

describe("a decoder that misbehaves", () => {
  it("is stopped when it never finishes", async () => {
    // The one thing SES cannot do anything about: looping is not a permission.
    const result = await runDecoder(`for (;;) {}`, [0], {}, 300);
    expect(result.ok).toBe(false);
    expect(result.why).toMatch(/still running after 300ms/);
    expect(result.ms).toBeLessThan(2000);
  });

  it("is told precisely what is wrong with what it returned", async () => {
    const result = await run(`
      return { kind: "bitmap", width: 8, height: 8, pixels: [1, 2, 3],
               palette: ["#000000"] };
    `);
    expect(result.ok).toBe(false);
    expect(result.why).toContain("3 entries");
    expect(result.why).toContain("64");
  });

  it("is refused when it returns nothing recognisable", async () => {
    const result = await run(`return 42;`);
    expect(result.ok).toBe(false);
    expect(result.why).toMatch(/must return an object/);
  });

  it("reports its own error rather than a stack from inside the sandbox", async () => {
    const result = await run(`throw new Error("bad table offset");`);
    expect(result.ok).toBe(false);
    expect(result.why).toContain("bad table offset");
  });
});
