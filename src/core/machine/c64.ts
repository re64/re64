/**
 * A C64: the CPU, the chips, and the wire between them.
 *
 * `runProgram` could already execute a decruncher — a million and a half
 * instructions of it — and still not run a *game*, because a game's main loop is
 * an interrupt and nothing raised one. This is the piece that was missing, and
 * it is small: step the processor, spend the cycles it took on the chips, and
 * take the interrupt if one is now being asserted.
 *
 * Everything it needs was built separately and tested separately: the device bus
 * on `Machine`, cycle counts on the opcode table, interrupt entry in
 * `il/interrupt.ts`, the chips in `c64/devices/`. This is the assembly.
 */

import { Machine } from "../il/interpret.js";
import { INTERRUPT_CYCLES, deliverInterrupt } from "../il/interrupt.js";
import { stepMachine } from "../il/run.js";
import { MemoryMap } from "../memory/memory-map.js";
import { C64Bus } from "../c64/devices/index.js";
import { REG } from "../il/pcode.js";

/** Why a run stopped. */
export type StopReason =
  /** As many frames as were asked for. */
  | "frames"
  /** As many cycles as were asked for. */
  | "cycles"
  /** The program counter reached an address the caller named. */
  | "breakpoint"
  /** A watched range was touched. */
  | "watchpoint"
  /** An instruction with no modelled semantics — an undocumented opcode. */
  | "unmodelled"
  /** Bytes that do not decode. */
  | "undecodable"
  /** An interrupt vectored somewhere no layer supplies: no ROMs in this view. */
  | "vectorless"
  /** The instruction budget ran out, so this is a program mid-flight. */
  | "budget"
  /**
   * Control left the program: an address no layer supplied and this run never
   * wrote. For a loader that is the natural finish, and nothing has to guess a
   * limit.
   */
  | "left";

/** A range to stop on, and what counts as touching it. */
export interface Watchpoint {
  from: number;
  to: number;
  on?: "read" | "write" | "any";
}

export interface RunUntil {
  frames?: number;
  cycles?: number;
  breakpoints?: readonly number[];
  watchpoints?: readonly Watchpoint[];
  /**
   * Stop where control leaves the program.
   *
   * **The stop condition a loader needs**, and the one experiment 5 established:
   * a loader that has finished hands control somewhere the file never loaded — a
   * KERNAL call, or code it has just written. Nothing has to pick a limit.
   *
   * "Code the program wrote is still the program" is the half that took a
   * walkthrough to find: a loader relocates itself and jumps to the copy, so
   * stopping at "no layer supplies this" halts on the program's own code.
   * Revenge of the Mutant Camels moves its decruncher onto the stack page, and
   * the first version of this rule stopped at $0100 after 1,258 of the 1.7
   * million instructions that matter.
   */
  leaves?: boolean;
  /** Default ten million, which is about eight seconds of machine time. */
  maxInstructions?: number;
}

export interface RunOutcome {
  reason: StopReason;
  instructions: number;
  cycles: number;
  frames: number;
  /** Where it stopped, which for a breakpoint is the address that was hit. */
  at: number;
  /** Names the instruction where one could not be modelled. */
  detail?: string;
}

export class C64 {
  readonly cpu = new Machine();
  readonly bus = new C64Bus();

  /** Cycles since this machine was made. The clock everything else is in. */
  cycles = 0;
  instructions = 0;

  constructor() {
    this.cpu.bus = this.bus;
    // A real machine boots the stack pointer near the top, and starting it at
    // zero makes the first push land at $0100 and every pull read the bottom of
    // the page — which `run_block` learned the hard way.
    this.cpu.set({ space: "register", offset: REG.SP, size: 1 }, 0xff);
  }

  /** Which addresses a layer supplied, so `leaves` can tell program from nowhere. */
  private readonly supplied = new Uint8Array(0x10000);
  /** Which the run has written, because code the program wrote is still the program. */
  private readonly written = new Uint8Array(0x10000);

  /**
   * Whether this machine was filled from a view, rather than poked directly.
   *
   * The vector check below asks "does this view supply the handler", which is a
   * question about a *project*. A machine built by writing bytes into memory —
   * a test, a hand-made probe — has no view to be missing anything, and
   * `supplied` would say nothing is there at all.
   */
  private fromMap = false;

  /** Fill memory from a project's layers, honouring the target's z-order. */
  load(map: MemoryMap): void {
    this.fromMap = true;
    for (let address = 0; address <= 0xffff; address++) {
      const byte = map.readByte(address);
      if (byte === undefined) continue;
      this.cpu.memory[address] = byte;
      this.supplied[address] = 1;
    }
  }

  /**
   * Whether any layer supplied this address, or the run has written it.
   *
   * The same test `leaves` uses to decide that control has left the program,
   * asked before starting rather than during — because starting somewhere
   * nothing supplies is the same condition, and it is worth refusing at the
   * point a caller can still do something about it.
   */
  supplies(address: number): boolean {
    const at = address & 0xffff;
    return this.supplied[at] === 1 || this.written[at] === 1;
  }

  /** Start here. Reads a vector rather than an address when told to. */
  start(at: number): void {
    this.cpu.pc = at;
  }

  /** The address in a two-byte vector, for a cartridge or a reset. */
  vector(at: number): number {
    return this.cpu.memory[at] | (this.cpu.memory[at + 1] << 8);
  }

  /**
   * One instruction, its cycles, and the interrupt it may have let in.
   *
   * The order matters and is the hardware's: the instruction completes, the
   * chips advance by what it cost, and only then is the line sampled. Checking
   * before would let an interrupt land in the middle of an instruction.
   */
  step(): { ok: boolean; reason?: StopReason; detail?: string } {
    const at = this.cpu.pc;
    const step = stepMachine(this.cpu, at);
    if (!step) {
      return { ok: false, reason: "undecodable", detail: `bytes at ${hex(at)} do not decode` };
    }
    if (step.flow.kind === "unmodelled") {
      return {
        ok: false,
        reason: "unmodelled",
        detail:
          `${step.instruction.mnemonic} at ${hex(at)}` +
          (step.instruction.illegal ? " (undocumented opcode)" : ""),
      };
    }

    this.cpu.pc = step.next;
    this.instructions += 1;
    this.spend(step.cycles);

    // NMI first, and it cannot be refused. CIA 2 is wired to it, which is why
    // a timer there and the RESTORE key are the two things a program cannot
    // mask away.
    //
    // **A vector into nothing stops the run and says so.** Experiment 10's
    // editor ran five scenarios before working out that its machine had no
    // operating system: with no ROM linked, `$FFFE` reads as zero, and the
    // first interrupt after `CLI` — about 430 instructions in — took the
    // program to $0000, where it ran whatever was there and came back as a
    // black screen with `reason: frames`. Refusing to start somewhere
    // unsupplied is not enough, because this program starts somewhere real and
    // *arrives* somewhere that is not.
    if (this.bus.nmi) {
      const to = this.vector(0xfffa);
      if (this.fromMap && !this.supplies(to)) return this.vectorless("nmi", 0xfffa, to);
      deliverInterrupt(this.cpu, "nmi");
      this.spend(INTERRUPT_CYCLES);
    } else if (this.bus.irq && !this.cpu.register(REG.I)) {
      const to = this.vector(0xfffe);
      if (this.fromMap && !this.supplies(to)) return this.vectorless("irq", 0xfffe, to);
      if (deliverInterrupt(this.cpu, "irq")) this.spend(INTERRUPT_CYCLES);
    }
    return { ok: true };
  }

  /**
   * An interrupt whose vector points where no layer supplies bytes.
   *
   * Reported as its own stop reason rather than as a crash, because the caller
   * can act on it: the machine is fine and the *view* is missing its ROMs.
   */
  private vectorless(
    line: string,
    from: number,
    to: number
  ): { ok: boolean; reason: StopReason; detail: string } {
    return {
      ok: false,
      reason: "vectorless",
      detail:
        `An ${line.toUpperCase()} vectored through ${hex(from)} to ${hex(to)}, which no ` +
        `layer in this view supplies — so there is no handler to run. A view needs its ` +
        `ROMs linked to boot through a vector; list_targets shows which layers each ` +
        `links.`,
    };
  }

  /** Advance the clock and the chips together, so they never disagree. */
  private spend(cycles: number): void {
    this.cycles += cycles;
    this.bus.tick(cycles);
  }

  /**
   * Run until one of the conditions the caller named.
   *
   * A watchpoint is checked through the machine's own watcher rather than by
   * re-reading memory, so it sees an address reached by indexing or through a
   * pointer — which is the whole reason the bus reports the access rather than
   * the intent.
   */
  run(until: RunUntil): RunOutcome {
    const budget = until.maxInstructions ?? 10_000_000;
    const stopFrame = until.frames === undefined ? undefined : this.bus.frames + until.frames;
    const stopCycle = until.cycles === undefined ? undefined : this.cycles + until.cycles;
    const breakpoints = new Set(until.breakpoints ?? []);
    const watched = until.watchpoints ?? [];

    let hitWatch = false;
    const previous = this.cpu.watch;
    if (watched.length || until.leaves) {
      this.cpu.watch = {
        read: (address) => {
          if (touches(watched, address, "read")) hitWatch = true;
          previous?.read(address, 1, 0);
        },
        write: (address, size) => {
          if (touches(watched, address, "write")) hitWatch = true;
          // Recorded whatever the caller asked for, because a checkpoint
          // resumed later may be asked to stop where control leaves.
          for (let i = 0; i < size; i++) this.written[(address + i) & 0xffff] = 1;
          previous?.write(address, 1, 0);
        },
      };
    }

    try {
      const start = this.instructions;
      while (this.instructions - start < budget) {
        if (breakpoints.has(this.cpu.pc)) {
          return this.outcome("breakpoint");
        }
        if (until.leaves && !this.supplied[this.cpu.pc] && !this.written[this.cpu.pc]) {
          return this.outcome("left");
        }
        const step = this.step();
        if (!step.ok) return this.outcome(step.reason!, step.detail);
        if (hitWatch) return this.outcome("watchpoint");
        if (stopFrame !== undefined && this.bus.frames >= stopFrame) {
          return this.outcome("frames");
        }
        if (stopCycle !== undefined && this.cycles >= stopCycle) {
          return this.outcome("cycles");
        }
      }
      return this.outcome("budget");
    } finally {
      this.cpu.watch = previous;
    }
  }

  private outcome(reason: StopReason, detail?: string): RunOutcome {
    return {
      reason,
      instructions: this.instructions,
      cycles: this.cycles,
      frames: this.bus.frames,
      at: this.cpu.pc,
      ...(detail ? { detail } : {}),
    };
  }
}

function touches(watched: readonly Watchpoint[], address: number, kind: "read" | "write"): boolean {
  return watched.some(
    (w) => address >= w.from && address <= w.to && (w.on ?? "any") !== other(kind)
  );
}

const other = (kind: "read" | "write") => (kind === "read" ? "write" : "read");

const hex = (n: number) => `$${n.toString(16).toUpperCase().padStart(4, "0")}`;
