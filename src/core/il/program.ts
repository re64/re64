/**
 * Running a whole program, not one block.
 *
 * `run_block` is deliberately scoped to a straight line: no branch inside one,
 * so the instructions that run are known before it starts and nothing is
 * guessed on the caller's behalf. That scope is what makes its answer honest,
 * and it is also why a project built from a crunched disk tops out at 141
 * instructions — everything past the decruncher needs the decruncher to have
 * *run*.
 *
 * Both builders in experiment 5 hit that wall, both wrote their own 6502
 * interpreter outside re64, and both spent most of their run doing it. Since
 * re64 already owns a CPU that passes Klaus Dormann's functional suite, what
 * was missing was never the semantics — it was a driver.
 *
 * **This does not pretend to be an emulator.** It runs instructions over flat
 * memory. What that gets right, and why it is enough for a decruncher:
 *
 * - Writes to `$A000-$BFFF` and `$E000-$FFFF` always reach RAM on this machine
 *   whatever is banked in — which is why `POKE I, PEEK(I)` copies ROM into the
 *   RAM beneath it. A decruncher writes under ROM, so flat memory is right
 *   here for the right reason rather than by luck.
 * - The exception is `$D000-$DFFF` while I/O is banked in, where writes reach
 *   the chips instead. Nothing here models that, so I/O touches are *reported*
 *   rather than emulated, and a caller can see whether the run leaned on any.
 *
 * What it gets wrong, stated rather than discovered: reading ROM returns
 * whatever the map supplied (usually nothing), hardware registers read back
 * what was written, and an undocumented opcode stops the run instead of
 * executing. Each of those is visible in the result.
 */

import { MemoryMap } from "../memory/memory-map.js";
import { Machine } from "./interpret.js";
import { stepMachine } from "./run.js";

export type StopReason =
  /** The program counter reached an address no layer supplies. */
  | "left the program"
  /** The address the caller asked to stop at. */
  | "reached the stop address"
  /** An instruction with no modelled semantics — an undocumented opcode. */
  | "unmodelled instruction"
  /** Bytes that do not decode. */
  | "undecodable"
  /** A routine called with `returnTo` reached its own RTS. */
  | "returned"
  /** Ran out of the instruction budget, so the result is a program mid-flight. */
  | "budget";

export interface ProgramRunOptions {
  /** Where to start. */
  from: number;
  /** Stop when the program counter reaches this, instead of running on. */
  stopAt?: number;
  /**
   * Call `from` as a subroutine: push this as its return address and stop when
   * it is reached.
   *
   * Without it a routine's own `RTS` pops whatever happens to be at the bottom
   * of an untouched stack and carries on into nowhere. That is not theoretical:
   * running `RESTOR` out of the KERNAL looked clean only because the rubbish it
   * returned to happened to be outside the loaded map, while `IOINIT` — 38
   * instructions, no illegal opcode, an ordinary `RTS` — ran on for four more
   * and stopped on an unmodelled instruction. Same routine shape, opposite
   * verdicts, decided by what the garbage address landed on.
   *
   * So a caller who means "call this" says so, and gets `returned` rather than
   * a reason that describes where the wreckage came to rest.
   */
  returnTo?: number;
  /** Default 20 million, which is about ten seconds. */
  maxInstructions?: number;
}

export interface ProgramRun {
  from: string;
  instructions: number;
  /** How much code actually ran, which for a decruncher is a very small number. */
  distinctAddresses: number;
  stoppedAt: string;
  reason: StopReason;
  /** Names the instruction when one could not be modelled. */
  detail?: string;
  /** Hardware addresses read or written, which this does not emulate. */
  ioTouched: string[];
  /** Ranges the run wrote that no layer supplied — usually the output. */
  wrote: { start: string; end: string; bytes: number }[];
  /** The memory afterwards, for capturing a range of it as a layer. */
  memory: Uint8Array;
}

const hex4 = (n: number) => `$${n.toString(16).toUpperCase().padStart(4, "0")}`;

/**
 * Run from an address until the program leaves the bytes the project holds.
 *
 * The stop condition is semantic rather than a guess: a loader that has
 * finished its work hands control somewhere the file never loaded — a KERNAL
 * call, or code it has just written. Nothing has to pick a limit, and the
 * budget exists only so a runaway cannot hang the caller.
 *
 * The project is untouched. Memory is copied out of the map, run over, and
 * handed back; making a layer of the result is a separate decision.
 */
export function runProgram(map: MemoryMap, options: ProgramRunOptions): ProgramRun {
  const machine = new Machine();

  // Seeded through `readByte`, so the layer stack's own z-order decides what
  // the program sees — the active target's view, and nothing it hides.
  const supplied = new Uint8Array(0x10000);
  for (let address = 0; address <= 0xffff; address++) {
    const byte = map.readByte(address);
    if (byte === undefined) continue;
    machine.memory[address] = byte;
    supplied[address] = 1;
  }

  const io = new Set<number>();
  const written = new Set<number>();
  machine.watch = {
    read(address) {
      if (address >= 0xd000 && address < 0xe000) io.add(address);
    },
    write(address, size) {
      for (let i = 0; i < size; i++) {
        const at = (address + i) & 0xffff;
        if (at >= 0xd000 && at < 0xe000) io.add(at);
        if (!supplied[at]) written.add(at);
      }
    },
  };

  machine.pc = options.from;
  // A real program sets the stack pointer near the top at boot; starting it at
  // zero makes the first push land at $0100 and every pull read the bottom of
  // the stack page, which `run_block` learned the hard way.
  machine.set({ space: "register", offset: 3, size: 1 }, 0xff);

  // `RTS` pops an address and continues at the byte *after* it, so what goes on
  // the stack is one less than where control should resume.
  if (options.returnTo !== undefined) {
    const pushed = (options.returnTo - 1) & 0xffff;
    machine.memory[0x01ff] = (pushed >> 8) & 0xff;
    machine.memory[0x01fe] = pushed & 0xff;
    machine.set({ space: "register", offset: 3, size: 1 }, 0xfd);
  }

  const budget = options.maxInstructions ?? 20_000_000;
  const seen = new Set<number>();
  let instructions = 0;
  let reason: StopReason = "budget";
  let detail: string | undefined;

  for (; instructions < budget; instructions++) {
    const at = machine.pc;
    if (options.stopAt !== undefined && at === options.stopAt && instructions > 0) {
      reason = "reached the stop address";
      break;
    }
    if (options.returnTo !== undefined && at === options.returnTo && instructions > 0) {
      reason = "returned";
      break;
    }
    // Left the program: an address neither the project supplies nor this run
    // wrote. That second half is not a detail — a loader relocates itself and
    // jumps to the copy, so "no layer supplies this" stops at the program's own
    // code. Revenge of the Mutant Camels moves its decruncher onto the stack
    // page and runs it there; the first version of this rule stopped at $0100
    // after 1,258 of the 1,768,853 instructions that matter.
    //
    // Code the program wrote is still the program. Code nobody wrote is the
    // KERNAL, or nowhere.
    if (map.readByte(at) === undefined && !written.has(at)) {
      reason = "left the program";
      break;
    }

    seen.add(at);
    const step = stepMachine(machine, at);
    if (!step) {
      reason = "undecodable";
      detail = `bytes at ${hex4(at)} do not decode`;
      break;
    }
    if (step.flow.kind === "unmodelled") {
      reason = "unmodelled instruction";
      detail =
        `${step.instruction.mnemonic} at ${hex4(at)}` +
        (step.instruction.illegal ? " (undocumented opcode)" : "");
      break;
    }
    machine.pc = step.next;
  }

  // Contiguous runs, so 47,000 written bytes read as one range rather than as
  // a list nobody can use.
  const ranges: { start: string; end: string; bytes: number }[] = [];
  const sorted = [...written].sort((a, b) => a - b);
  let start: number | undefined;
  let previous: number | undefined;
  const close = () => {
    if (start === undefined || previous === undefined) return;
    ranges.push({ start: hex4(start), end: hex4(previous), bytes: previous - start + 1 });
  };
  for (const address of sorted) {
    if (previous !== undefined && address === previous + 1) {
      previous = address;
      continue;
    }
    close();
    start = address;
    previous = address;
  }
  close();

  return {
    from: hex4(options.from),
    instructions,
    distinctAddresses: seen.size,
    stoppedAt: hex4(machine.pc),
    reason,
    ...(detail ? { detail } : {}),
    ioTouched: [...io].sort((a, b) => a - b).map(hex4),
    wrote: ranges.sort((a, b) => b.bytes - a.bytes).slice(0, 20),
    memory: machine.memory,
  };
}
