import { describe, it, expect } from "vitest";
import { CheckpointCache, runScenario, prefixKey } from "./scenario.js";
import { MemoryMap } from "../memory/memory-map.js";
import { BytesLayer } from "../memory/layer.js";
import { ProjectScenario } from "../project/project.js";

/**
 * Scenarios, and the cache that makes them interactive.
 *
 * The script is the truth and the machine is a cache — so what has to be
 * asserted is that the two never disagree: a resumed run must equal a cold one,
 * and a changed prefix must not reuse what a different prefix produced.
 */

/** A tiny program at $1000 that counts in $2000 for ever. */
function program(): MemoryMap {
  const map = new MemoryMap();
  // INC $2000 / JMP $1000
  const bytes = new Uint8Array([0xee, 0x00, 0x20, 0x4c, 0x00, 0x10]);
  map.addLayer(new BytesLayer("test", 0x1000, bytes));
  return map;
}

const scenario = (steps: ProjectScenario["steps"]): ProjectScenario => ({
  id: "scn_1",
  name: "test",
  steps,
});

describe("running a scenario", () => {
  it("does each step in order and says what it did", () => {
    const run = runScenario(
      program(),
      scenario([
        { id: "stp_1", kind: "start", at: "$1000" },
        { id: "stp_2", kind: "run", cycles: 100 },
      ]),
      { fingerprint: "f1" }
    );

    expect(run.did.map((d) => d.kind)).toEqual(["start", "run"]);
    expect(run.did[0].said).toContain("$1000");
    expect(run.outcome.reason).toBe("cycles");
  });

  it("starts at the address a vector holds when told to", () => {
    const map = program();
    map.addLayer(new BytesLayer("vec", 0x8000, new Uint8Array([0x00, 0x10])));
    const run = runScenario(
      map,
      scenario([
        { id: "stp_1", kind: "start", at: "$8000", vector: true },
        { id: "stp_2", kind: "run", cycles: 20 },
      ]),
      { fingerprint: "f1" }
    );
    expect(run.did[0].said).toContain("$1000");
  });

  it("holds keys until another step changes them", () => {
    const run = runScenario(
      program(),
      scenario([
        { id: "stp_1", kind: "start", at: "$1000" },
        { id: "stp_2", kind: "key", keys: ["o"] },
        { id: "stp_3", kind: "run", cycles: 50 },
        { id: "stp_4", kind: "key", keys: [] },
      ]),
      { fingerprint: "f1" }
    );
    expect(run.did[1].said).toContain("holding o");
    expect(run.did[3].said).toContain("released");
  });

  it("refuses a key it does not know rather than holding nothing", () => {
    // A typo that quietly pressed nothing looks exactly like a program that
    // ignores the keyboard, which is the expensive way to find out.
    const run = runScenario(
      program(),
      scenario([
        { id: "stp_1", kind: "start", at: "$1000" },
        { id: "stp_2", kind: "key", keys: ["escape"] },
      ]),
      { fingerprint: "f1" }
    );
    expect(run.warnings.join(" ")).toContain("no such key: escape");
    expect(run.did[1].said).toContain("refused");
  });

  it("holds an input until another step changes it", () => {
    const run = runScenario(
      program(),
      scenario([
        { id: "stp_1", kind: "start", at: "$1000" },
        { id: "stp_2", kind: "input", port: 1, fire: true },
        { id: "stp_3", kind: "run", cycles: 50 },
        { id: "stp_4", kind: "input", port: 1, fire: false },
      ]),
      { fingerprint: "f1" }
    );
    expect(run.did[1].said).toContain("fire");
    expect(run.did[3].said).toContain("released");
  });

  it("stops the rest of the scenario when a step cannot finish", () => {
    // Everything after an unmodelled instruction did not run, and saying so is
    // the difference between a short result and a wrong one.
    const map = new MemoryMap();
    map.addLayer(new BytesLayer("jam", 0x1000, new Uint8Array([0x02])));
    const run = runScenario(
      map,
      scenario([
        { id: "stp_1", kind: "start", at: "$1000" },
        { id: "stp_2", kind: "run", cycles: 100 },
        { id: "stp_3", kind: "capture", what: "ram", from: "$1000", to: "$1010", name: "x.prg" },
      ]),
      { fingerprint: "f1" }
    );
    expect(run.outcome.reason).toBe("unmodelled");
    expect(run.warnings.join(" ")).toMatch(/did not run/);
    expect(run.captures).toHaveLength(0);
  });
});

describe("capturing", () => {
  it("keeps RAM as an ordinary .prg", () => {
    // Load address first, so a capture is a file the project can lay a layer
    // over rather than a new kind of thing only this tool understands.
    const run = runScenario(
      program(),
      scenario([
        { id: "stp_1", kind: "start", at: "$1000" },
        { id: "stp_2", kind: "run", cycles: 100 },
        { id: "stp_3", kind: "capture", what: "ram", from: "$2000", to: "$2004", name: "out.prg" },
      ]),
      { fingerprint: "f1" }
    );

    const capture = run.captures[0];
    expect(capture.name).toBe("out.prg");
    expect(capture.bytes[0]).toBe(0x00);
    expect(capture.bytes[1]).toBe(0x20);
    expect(capture.bytes.length).toBe(2 + 4);
    // The program has been counting, so the first byte is not zero.
    expect(capture.bytes[2]).toBeGreaterThan(0);
  });

  it("keeps a screen as frames, which every consumer already draws", () => {
    const run = runScenario(
      program(),
      scenario([
        { id: "stp_1", kind: "start", at: "$1000" },
        { id: "stp_2", kind: "run", cycles: 100 },
        { id: "stp_3", kind: "capture", what: "screen", name: "shot.json" },
      ]),
      { fingerprint: "f1" }
    );
    expect(run.captures[0].frames).toHaveLength(1);
    expect(run.captures[0].frames![0].width).toBe(320);
  });

  it("keeps the SID as what was written, not as audio", () => {
    const map = new MemoryMap();
    // LDA #$25 / STA $D400 / JMP *
    map.addLayer(
      new BytesLayer("sid", 0x1000, new Uint8Array([0xa9, 0x25, 0x8d, 0x00, 0xd4, 0x4c, 0x05, 0x10]))
    );
    const run = runScenario(
      map,
      scenario([
        { id: "stp_1", kind: "start", at: "$1000" },
        { id: "stp_2", kind: "run", cycles: 100 },
        { id: "stp_3", kind: "capture", what: "sid", name: "sound.json" },
      ]),
      { fingerprint: "f1" }
    );
    const written = JSON.parse(new TextDecoder().decode(run.captures[0].bytes));
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ register: 0, value: 0x25 });
  });
});

describe("the checkpoint cache", () => {
  const steps: ProjectScenario["steps"] = [
    { id: "stp_1", kind: "start", at: "$1000" },
    { id: "stp_2", kind: "run", cycles: 500 },
    { id: "stp_3", kind: "run", cycles: 500 },
    { id: "stp_4", kind: "capture", what: "ram", from: "$2000", to: "$2002", name: "o.prg" },
  ];

  it("gives a resumed run exactly what a cold one gives", () => {
    // The property the whole cache rests on. If these ever differ, a cached
    // answer is a wrong answer that looks right — which is the failure this
    // project refuses everywhere else.
    const cache = new CheckpointCache();
    const cold = runScenario(program(), scenario(steps), { fingerprint: "f1" });
    const warmed = runScenario(program(), scenario(steps), { fingerprint: "f1", cache });
    expect(cache.size).toBeGreaterThan(0);
    const resumed = runScenario(program(), scenario(steps), { fingerprint: "f1", cache });

    expect(resumed.outcome).toEqual(cold.outcome);
    expect(Array.from(resumed.captures[0].bytes)).toEqual(Array.from(cold.captures[0].bytes));
    expect(Array.from(warmed.captures[0].bytes)).toEqual(Array.from(cold.captures[0].bytes));
  });

  it("resumes rather than re-running when only the last step changed", () => {
    const cache = new CheckpointCache();
    runScenario(program(), scenario(steps), { fingerprint: "f1", cache });

    const longer = [...steps.slice(0, 3), {
      id: "stp_5",
      kind: "capture" as const,
      what: "ram" as const,
      from: "$2000",
      to: "$2002",
      name: "other.prg",
    }];
    const again = runScenario(program(), scenario(longer), { fingerprint: "f1", cache });

    // The machine was already three steps in, so nothing re-ran — which shows
    // as the same cycle count arriving without another thousand cycles of work.
    expect(again.captures[0].name).toBe("other.prg");
    expect(cache.get(prefixKey("f1", steps.slice(0, 3)))).toBeDefined();
  });

  it("will not reuse a checkpoint made from different bytes", () => {
    // The fingerprint is what stops a changed project reading a stale machine.
    const cache = new CheckpointCache();
    runScenario(program(), scenario(steps), { fingerprint: "f1", cache });
    expect(cache.get(prefixKey("f2", steps.slice(0, 2)))).toBeUndefined();
  });

  it("will not reuse a checkpoint from a different prefix", () => {
    const cache = new CheckpointCache();
    runScenario(program(), scenario(steps), { fingerprint: "f1", cache });

    const changed: ProjectScenario["steps"] = [
      { id: "stp_1", kind: "start", at: "$1000" },
      { id: "stp_2", kind: "run", cycles: 999 },
    ];
    expect(cache.get(prefixKey("f1", changed))).toBeUndefined();
  });

  it("carries device state, or a resumed machine is a different one", () => {
    // A checkpoint holding only RAM and registers comes back with the raster
    // somewhere else, and a raster handler then fires on the wrong line for the
    // rest of the run. The cycle count is the visible half of the same thing.
    const cache = new CheckpointCache();
    const cold = runScenario(program(), scenario(steps), { fingerprint: "f1" });
    runScenario(program(), scenario(steps), { fingerprint: "f1", cache });
    const resumed = runScenario(program(), scenario(steps), { fingerprint: "f1", cache });

    expect(resumed.outcome.cycles).toBe(cold.outcome.cycles);
    expect(resumed.outcome.frames).toBe(cold.outcome.frames);
  });

  it("evicts the coldest, because this is a cache and not a store", () => {
    const cache = new CheckpointCache(2);
    runScenario(program(), scenario(steps), { fingerprint: "f1", cache });
    expect(cache.size).toBe(2);
  });
});

describe("a scenario as a probe", () => {
  /**
   * What makes evidence re-runnable.
   *
   * Both experiment-0 agents asked for the same thing and lost it the same way:
   * they ran their checks, the checks lived in shell history, and `findings.md`
   * was left saying "verified in emulation" with the instrumentation gone. A
   * claim can point at one of these, and it re-verifies.
   */
  /** LDA #$42 / STA $2000 / JMP * — one exact value, no cycle arithmetic. */
  function writes42(): MemoryMap {
    const map = new MemoryMap();
    map.addLayer(
      new BytesLayer("p", 0x1000, new Uint8Array([0xa9, 0x42, 0x8d, 0x00, 0x20, 0x4c, 0x05, 0x10]))
    );
    return map;
  }

  it("passes when what it asserts holds", () => {
    const run = runScenario(
      writes42(),
      scenario([
        { id: "stp_1", kind: "start", at: "$1000" },
        { id: "stp_2", kind: "run", cycles: 200 },
        {
          id: "stp_3",
          kind: "assert",
          memory: { "$2000": 0x42 },
          note: "the routine wrote what it was meant to",
        },
      ]),
      { fingerprint: "f1" }
    );

    expect(run.passed).toBe(true);
    expect(run.checks).toHaveLength(1);
    expect(run.checks[0].said).toContain("the routine wrote what it was meant to");
  });

  it("fails, and says what it found rather than only that it failed", () => {
    // "score was 320, not 720" is worth more than "failed", and a caller fixing
    // one expectation should not have to re-run to discover the next.
    const run = runScenario(
      writes42(),
      scenario([
        { id: "stp_1", kind: "start", at: "$1000" },
        { id: "stp_2", kind: "run", cycles: 200 },
        { id: "stp_3", kind: "assert", memory: { "$2000": 0xff, "$2001": 0x00 } },
      ]),
      { fingerprint: "f1" }
    );

    expect(run.passed).toBe(false);
    expect(run.checks[0].said).toMatch(/wanted \$FF/);
    // The second part is reported too, even though the first already failed.
    expect(run.checks[0].said).toContain("$2001");
  });

  it("checks registers as well as memory", () => {
    const run = runScenario(
      program(),
      scenario([
        { id: "stp_1", kind: "start", at: "$1000" },
        { id: "stp_2", kind: "set", registers: { X: 7 } },
        { id: "stp_3", kind: "assert", registers: { X: 7 } },
      ]),
      { fingerprint: "f1" }
    );
    expect(run.passed).toBe(true);
  });

  it("says nothing about passing when a scenario asserts nothing", () => {
    // A scenario that captures but never checks is not a probe, and reporting
    // `passed: true` for one would be a claim it never made.
    const run = runScenario(
      program(),
      scenario([
        { id: "stp_1", kind: "start", at: "$1000" },
        { id: "stp_2", kind: "run", cycles: 50 },
      ]),
      { fingerprint: "f1" }
    );
    expect(run.passed).toBeUndefined();
    expect(run.checks).toEqual([]);
  });

  it("keeps its verdict across a resume, like everything else it produced", () => {
    const cache = new CheckpointCache();
    const steps: ProjectScenario["steps"] = [
      { id: "stp_1", kind: "start", at: "$1000" },
      { id: "stp_2", kind: "run", cycles: 200 },
      { id: "stp_3", kind: "assert", memory: { "$2000": 0x42 } },
    ];
    const cold = runScenario(writes42(), scenario(steps), { fingerprint: "f1" });
    runScenario(writes42(), scenario(steps), { fingerprint: "f1", cache });
    const resumed = runScenario(writes42(), scenario(steps), { fingerprint: "f1", cache });

    expect(resumed.passed).toBe(cold.passed);
    expect(resumed.checks).toEqual(cold.checks);
  });
});
