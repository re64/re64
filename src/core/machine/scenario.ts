/**
 * Running a scenario, and remembering where it got to.
 *
 * **The script is the truth and the machine is a cache.** A machine state is
 * derived from these steps and the project's bytes, and this project does not
 * store derived things — the region tree, basic blocks, the record count and the
 * equate block are all computed when something asks. So a scenario lives in the
 * document and the machine it describes does not; what is held is a checkpoint
 * per step prefix, in memory, evicted under pressure, and a miss simply re-runs
 * from the beginning.
 *
 * That is what makes "continue from step five" cheap without the server holding
 * a session, which matters because the MCP transport is stateless by design.
 *
 * **Determinism is the enabling invariant**, not a nice property. Prefix caching
 * is sound only because the same steps over the same bytes produce the same
 * machine — which is also why input is *scheduled* rather than delivered live.
 */

import { MemoryMap } from "../memory/memory-map.js";
import { ProjectScenario, ProjectStep, parseProjectAddress } from "../project/project.js";
import { Bitmap } from "../view/bitmap-view.js";
import { composeScreen, FRAME_MS } from "../c64/screen.js";
import { SidWrite } from "../c64/devices/index.js";
import { C64, RunOutcome } from "./c64.js";
import { REG } from "../il/pcode.js";

/** What a `capture` step produced. Bytes, ready for the blob store. */
export interface Capture {
  /** The step that made it. */
  step: string;
  kind: "ram" | "screen" | "frames" | "trace" | "sid";
  name: string;
  /** For `ram` and `screen`, a `.prg`: load address first. For the rest, JSON. */
  bytes: Uint8Array;
  /** A drawn form, where there is one — so a caller can show it without decoding. */
  frames?: Bitmap[];
}

export interface ScenarioRun {
  /** One line per step, in order, saying what it did. */
  did: { step: string; kind: string; said: string }[];
  /**
   * Every `assert`, and whether it held.
   *
   * What turns a scenario into a **probe**: a claim can point at one as
   * evidence, and re-running says pass or fail rather than "somebody wrote
   * verified in a document once".
   */
  checks: { step: string; ok: boolean; said: string }[];
  /** True when every check held. Absent where the scenario asserts nothing. */
  passed?: boolean;
  captures: Capture[];
  /** Where the machine ended up. */
  outcome: RunOutcome;
  /** Anything that makes the result less trustworthy than it looks. */
  warnings: string[];
}

/**
 * A scenario part-way through, keyed by the steps that made it.
 *
 * **The machine and what the run has produced**, not just the machine. A
 * checkpoint holding only state is wrong in a way a test caught immediately:
 * resuming from the final step skips every step, so the captures those steps
 * made never happen and the run comes back empty. Outputs are part of what a
 * prefix produced, so they are part of what a prefix caches.
 */
interface Checkpoint {
  after: string;
  memory: Uint8Array;
  registers: number[];
  devices: Uint8Array;
  cycles: number;
  instructions: number;
  pc: number;
  /** Everything the steps up to here reported and produced. */
  did: ScenarioRun["did"];
  checks: ScenarioRun["checks"];
  captures: Capture[];
  warnings: string[];
  outcome: RunOutcome;
}

/**
 * Checkpoints, keyed by the bytes and the steps that produced them.
 *
 * The shape `Workspace.key()` already uses for the analysis cache, one level
 * along: a fingerprint of what the project holds, plus a hash of the step prefix.
 * Held in memory and lost on restart, because it is a cache of a derived thing
 * and re-running from the start is always correct.
 */
export class CheckpointCache {
  private readonly held = new Map<string, Checkpoint>();

  constructor(private readonly limit = 8) {}

  get(key: string): Checkpoint | undefined {
    const found = this.held.get(key);
    // Least-recently-used: re-inserting moves it to the end of the iteration
    // order, so the first key is always the coldest.
    if (found) {
      this.held.delete(key);
      this.held.set(key, found);
    }
    return found;
  }

  put(key: string, checkpoint: Checkpoint): void {
    this.held.delete(key);
    this.held.set(key, checkpoint);
    while (this.held.size > this.limit) {
      const coldest = this.held.keys().next().value;
      if (coldest === undefined) break;
      this.held.delete(coldest);
    }
  }

  get size(): number {
    return this.held.size;
  }
}

const REGISTERS = [REG.A, REG.X, REG.Y, REG.SP, REG.C, REG.Z, REG.I, REG.D, REG.B, REG.V, REG.N];

/** A stable name for "these bytes, then these steps". */
export function prefixKey(fingerprint: string, steps: readonly ProjectStep[]): string {
  return `${fingerprint}|${JSON.stringify(steps)}`;
}

export interface ScenarioOptions {
  /** Identifies the bytes, so a changed project cannot reuse a checkpoint. */
  fingerprint: string;
  cache?: CheckpointCache;
  /** Character ROM, for composing a frame where the VIC shadows it. */
  characters?: Uint8Array;
}

/**
 * Run a scenario over a project's bytes.
 *
 * Steps are executed in order, and after each one the machine is checkpointed
 * under the prefix that produced it — so re-running a scenario whose last step
 * changed resumes rather than starting again.
 */
export function runScenario(
  map: MemoryMap,
  scenario: ProjectScenario,
  options: ScenarioOptions
): ScenarioRun {
  const machine = new C64();
  const did: ScenarioRun["did"] = [];
  const checks: ScenarioRun["checks"] = [];
  const captures: Capture[] = [];
  const warnings: string[] = [];
  let outcome: RunOutcome = {
    reason: "frames",
    instructions: 0,
    cycles: 0,
    frames: 0,
    at: 0,
  };

  // The longest prefix already held, so the machine starts as far along as it
  // can. A miss at every length simply means loading from the map and running.
  let start = 0;
  if (options.cache) {
    for (let length = scenario.steps.length; length > 0; length--) {
      const held = options.cache.get(prefixKey(options.fingerprint, scenario.steps.slice(0, length)));
      if (!held) continue;
      restore(machine, held);
      did.push(...held.did);
      checks.push(...held.checks);
      captures.push(...held.captures);
      warnings.push(...held.warnings);
      outcome = held.outcome;
      start = length;
      break;
    }
  }
  if (start === 0) machine.load(map);

  for (let index = start; index < scenario.steps.length; index++) {
    const step = scenario.steps[index];
    const id = step.id ?? `step ${index + 1}`;
    // A step that cannot be performed stops the run and is reported, rather
    // than throwing out through the tool that called it. A scenario is data
    // somebody wrote, and the shape of a refusal here should match the one a
    // caller already gets for an unmodelled instruction: what stopped it, at
    // which step, and that nothing after it ran.
    let said: string;
    try {
      said = perform(machine, step, captures, checks, warnings, id, options);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      warnings.push(`Stopped at step ${id}: ${why}. Everything after this step did not run.`);
      did.push({ step: id, kind: step.kind, said: `refused: ${why}` });
      break;
    }
    did.push({ step: id, kind: step.kind, said });
    if (step.kind === "run") {
      outcome = machine.run(runUntil(step));
      did[did.length - 1].said = `${outcome.reason} at ${hex(outcome.at)}, frame ${outcome.frames}`;
      if (outcome.reason === "unmodelled" || outcome.reason === "undecodable") {
        warnings.push(
          `Stopped at step ${id}: ${outcome.detail ?? outcome.reason}. Everything after ` +
            `this step did not run.`
        );
        break;
      }
    }
    options.cache?.put(
      prefixKey(options.fingerprint, scenario.steps.slice(0, index + 1)),
      snapshot(machine, id, did, checks, captures, warnings, outcome)
    );
  }

  if (machine.bus.sid.unmodelledReads.size) {
    warnings.push(
      `Read ${machine.bus.sid.unmodelledReads.size} SID register(s) this does not model; ` +
        `they answered zero, and a program using $D41B for entropy will not behave as ` +
        `it does on a machine.`
    );
  }

  return {
    did,
    checks,
    ...(checks.length ? { passed: checks.every((c) => c.ok) } : {}),
    captures,
    outcome,
    warnings,
  };
}

/** Do one step, except `run`, which the caller does so it can report the outcome. */
function perform(
  machine: C64,
  step: ProjectStep,
  captures: Capture[],
  checks: ScenarioRun["checks"],
  warnings: string[],
  id: string,
  options: ScenarioOptions
): string {
  switch (step.kind) {
    case "start": {
      const at = parseProjectAddress(step.at);
      const from = step.vector ? machine.vector(at) : at;
      machine.start(from);
      return step.vector ? `start at ${hex(from)}, from the vector at ${hex(at)}` : `start at ${hex(from)}`;
    }
    case "set": {
      for (const [name, value] of Object.entries(step.registers ?? {})) {
        const offset = REG[name.toUpperCase() as keyof typeof REG];
        if (offset === undefined) {
          warnings.push(`Step ${id} names no register "${name}"; it was ignored.`);
          continue;
        }
        machine.cpu.set({ space: "register", offset, size: 1 }, value);
      }
      for (const [address, value] of Object.entries(step.memory ?? {})) {
        machine.cpu.memory[parseProjectAddress(address) & 0xffff] = value & 0xff;
      }
      return "set";
    }
    case "input": {
      const stick = {
        ...(step.up === undefined ? {} : { up: step.up }),
        ...(step.down === undefined ? {} : { down: step.down }),
        ...(step.left === undefined ? {} : { left: step.left }),
        ...(step.right === undefined ? {} : { right: step.right }),
        ...(step.fire === undefined ? {} : { fire: step.fire }),
      };
      if (step.port === 1) machine.bus.joystick1 = stick;
      else machine.bus.joystick2 = stick;
      const pushed = Object.entries(stick).filter(([, on]) => on).map(([way]) => way);
      return `port ${step.port}: ${pushed.length ? pushed.join(" + ") : "released"}`;
    }
    case "key": {
      // Refused by name rather than dropped, and the message names the key: a
      // scenario that silently held nothing is indistinguishable from a program
      // that ignores the keyboard, which is an afternoon spent in the wrong
      // place.
      machine.bus.keys = step.keys;
      const held = machine.bus.keys;
      return held.length ? `holding ${held.join(" + ")}` : "keys released";
    }
    case "capture": {
      const capture = take(machine, step, id, options);
      captures.push(capture);
      return `${step.kind === "capture" ? step.what : ""} as ${capture.name} (${capture.bytes.length} bytes)`;
    }
    case "assert": {
      // Every part is reported, not just the first failure: a probe saying
      // "score was 320, not 720" is worth more than "failed", and a caller
      // fixing one expectation should not have to re-run to find the next.
      const parts: string[] = [];
      let ok = true;
      for (const [address, expected] of Object.entries(step.memory ?? {})) {
        const at = parseProjectAddress(address) & 0xffff;
        const held = machine.cpu.memory[at];
        if (held !== (expected & 0xff)) ok = false;
        parts.push(`${hex(at)} is ${byte(held)}${held === (expected & 0xff) ? "" : `, wanted ${byte(expected)}`}`);
      }
      for (const [name, expected] of Object.entries(step.registers ?? {})) {
        const offset = REG[name.toUpperCase() as keyof typeof REG];
        if (offset === undefined) {
          warnings.push(`Step ${id} names no register "${name}"; it was not checked.`);
          continue;
        }
        const held = machine.cpu.register(offset);
        if (held !== expected) ok = false;
        parts.push(`${name.toUpperCase()} is ${held}${held === expected ? "" : `, wanted ${expected}`}`);
      }
      const said = `${step.note ? `${step.note}: ` : ""}${parts.join("; ") || "nothing to check"}`;
      checks.push({ step: id, ok, said });
      return `${ok ? "held" : "FAILED"} — ${said}`;
    }
    case "run":
      return "";
  }
}

const byte = (n: number) => `$${(n & 0xff).toString(16).toUpperCase().padStart(2, "0")}`;

function runUntil(step: Extract<ProjectStep, { kind: "run" }>) {
  return {
    ...(step.frames === undefined ? {} : { frames: step.frames }),
    ...(step.cycles === undefined ? {} : { cycles: step.cycles }),
    ...(step.breakpoints === undefined
      ? {}
      : { breakpoints: step.breakpoints.map((b) => parseProjectAddress(b)) }),
    ...(step.watchpoints === undefined
      ? {}
      : {
          watchpoints: step.watchpoints.map((w) => ({
            from: parseProjectAddress(w.from),
            to: parseProjectAddress(w.to),
            ...(w.on === undefined ? {} : { on: w.on }),
          })),
        }),
    ...(step.leaves === undefined ? {} : { leaves: step.leaves }),
    ...(step.maxInstructions === undefined ? {} : { maxInstructions: step.maxInstructions }),
  };
}

/** Keep something. Bytes, always — a picture is a bitmap the caller may draw. */
function take(
  machine: C64,
  step: Extract<ProjectStep, { kind: "capture" }>,
  id: string,
  options: ScenarioOptions
): Capture {
  const base = { step: id, kind: step.what, name: step.name };

  switch (step.what) {
    case "ram": {
      const from = parseProjectAddress(step.from ?? 0);
      const to = parseProjectAddress(step.to ?? 0x10000);
      // A `.prg`, load address first, so a capture is an ordinary file the
      // project can lay a layer over rather than a new kind of thing.
      const bytes = new Uint8Array(2 + (to - from));
      bytes[0] = from & 0xff;
      bytes[1] = (from >> 8) & 0xff;
      bytes.set(machine.cpu.memory.subarray(from, to), 2);
      return { ...base, bytes };
    }
    case "screen":
    case "frames": {
      const wanted = step.what === "screen" ? 1 : step.count ?? 1;
      const every = step.every ?? 1;
      const frames: Bitmap[] = [];
      for (let taken = 0; taken < wanted; taken++) {
        if (taken > 0) machine.run({ frames: every });
        frames.push(composeScreen(machine.bus, machine.cpu.memory, options.characters));
      }
      return { ...base, bytes: encode({ delayMs: FRAME_MS * every, frames: frames.map(flat) }), frames };
    }
    case "sid":
      return { ...base, bytes: encode(machine.bus.sid.writes satisfies SidWrite[]) };
    case "trace":
      return {
        ...base,
        bytes: encode({
          cycles: machine.cycles,
          instructions: machine.instructions,
          frames: machine.bus.frames,
          pc: machine.cpu.pc,
        }),
      };
  }
}

/** A bitmap as JSON, with the pixels as an ordinary array. */
const flat = (bitmap: Bitmap) => ({ ...bitmap, pixels: Array.from(bitmap.pixels) });

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

function snapshot(
  machine: C64,
  after: string,
  did: ScenarioRun["did"],
  checks: ScenarioRun["checks"],
  captures: Capture[],
  warnings: string[],
  outcome: RunOutcome
): Checkpoint {
  return {
    after,
    memory: machine.cpu.memory.slice(),
    registers: REGISTERS.map((offset) => machine.cpu.register(offset)),
    devices: machine.bus.snapshot(),
    cycles: machine.cycles,
    instructions: machine.instructions,
    pc: machine.cpu.pc,
    // Copied, not shared: the arrays keep growing as later steps run, and a
    // checkpoint holding a live reference would remember the future.
    did: did.map((entry) => ({ ...entry })),
    checks: checks.map((entry) => ({ ...entry })),
    captures: captures.slice(),
    warnings: warnings.slice(),
    outcome: { ...outcome },
  };
}

function restore(machine: C64, held: Checkpoint): void {
  machine.cpu.memory.set(held.memory);
  REGISTERS.forEach((offset, i) =>
    machine.cpu.set({ space: "register", offset, size: 1 }, held.registers[i])
  );
  // **Device state too.** A checkpoint that carried only RAM and registers
  // resumes into a different machine: the raster is somewhere else, so a raster
  // handler fires on the wrong line for the rest of the run.
  machine.bus.restore(held.devices);
  machine.cycles = held.cycles;
  machine.instructions = held.instructions;
  machine.cpu.pc = held.pc;
}

const hex = (n: number) => `$${n.toString(16).toUpperCase().padStart(4, "0")}`;
