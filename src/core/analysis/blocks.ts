/**
 * Basic blocks: straight-line runs with one way in and one way out.
 *
 * The model the instruction index could not express. `Map<address, Instruction>`
 * has one instruction per address baked into its type, so a byte that is an
 * operand on one path and an opcode on another — legitimate 6502, and used twice
 * in the reference disassembly of Gridrunner — simply could not be represented.
 * Blocks can intersect, and nothing here pretends otherwise.
 *
 * This is also what four other questions were waiting on: a function's extent
 * without being told it, what a routine calls outbound, which routine a call
 * sits in, and whether an undecoded span is unreachable or merely unexplained.
 *
 * Derived, never stored. Blocks are recomputed from the walk like the region
 * tree is recomputed at render time, so nothing here reaches the document, the
 * schema, or merge.
 */

import { Instruction, getTargets } from "../arch/mos6502/instruction.js";

/**
 * Where an instruction can send control *other than* by simply continuing.
 *
 * `getTargets` answers the walk's question — everything to decode next — so it
 * includes the following address for anything that continues. Taking that as
 * "what jumps here" makes every instruction a leader.
 *
 * Decided by flow type rather than by comparing addresses. Filtering "the
 * target that equals the next address" looks equivalent and is not: a `JMP` to
 * the very next instruction has no fall-through to remove, so the comparison
 * threw away a real jump target and left one address in Gridrunner reachable in
 * the middle of a block.
 */
function jumpTargets(instr: Instruction): number[] {
  if (instr.flow === "jump") return getTargets(instr);
  if (instr.flow === "ret" || instr.flow === "halt") return [];

  const next = instr.address + instr.bytes.length;
  return getTargets(instr).filter((t) => t !== next);
}
import { InstructionIndex } from "../arch/mos6502/disassembler.js";

export interface BasicBlock {
  /** First address. Blocks are identified by where they start. */
  readonly start: number;
  /** One past the last byte, so `end - start` is the span in bytes. */
  readonly end: number;
  /** In address order. Never empty. */
  readonly instructions: readonly Instruction[];
  /**
   * Where control can go next, as block start addresses.
   *
   * A conditional branch has two: its target and the instruction after it. A
   * `JSR` has one — the instruction after it — because it is expected to
   * return; who it called is a question for the call graph, and is kept
   * separately so that a routine which never returns does not silently make
   * every caller's block look like it ends there.
   */
  readonly successors: readonly number[];
  /**
   * Subroutines this block calls.
   *
   * A block ends at a call, so there is at most one — kept as a list because
   * an indirect call may resolve to several once anything can say so.
   */
  readonly calls: readonly number[];
  /** How the last instruction leaves: what ended the block. */
  readonly exit: "branch" | "jump" | "call" | "ret" | "halt" | "fallthrough";
}

/**
 * Where a block may begin.
 *
 * Any decoded address that something jumps or branches to, plus anything
 * following an instruction that does not simply continue — the instruction
 * after a `JMP` starts a block only if something reaches it, which is exactly
 * what being a decoded target means.
 */
function leaders(instructions: InstructionIndex, entryPoints: readonly number[]): Set<number> {
  const starts = new Set<number>(entryPoints.filter((a) => instructions.has(a)));

  for (const instr of instructions.all()) {
    // A branch or jump target begins a block.
    for (const target of jumpTargets(instr)) {
      if (instructions.has(target)) starts.add(target);
    }

    // What follows a branch is reachable both ways, and what follows a `JSR` is
    // where the call returns to. Both begin blocks.
    //
    // Splitting at a call is what makes the invariant absolute: control enters
    // a block only at its start, never in the middle. Without it a return edge
    // lands mid-block, and any analysis that treats a block as one transfer
    // function — SSA above all, where phi-nodes sit at block entries — is
    // reasoning about a block that control can arrive inside.
    //
    // On this machine it earns its keep twice over: arguments travel in A, X
    // and Y with no calling convention, so "what does A hold after this call"
    // is precisely the question a boundary exists to ask.
    const after = instr.address + instr.bytes.length;
    if ((instr.flow === "branch" || instr.flow === "call") && instructions.has(after)) {
      starts.add(after);
    }
    // Nothing is added after a jump, return or halt: whatever follows begins a
    // block only if something reaches it, and then a target above added it.
  }

  return starts;
}

/**
 * Every block reachable in this decode.
 *
 * Blocks are grown forward from each leader until control leaves — at a jump, a
 * return, a halt, a branch, or the moment the next address begins another block.
 * That last case is what splits a straight run when something branches into its
 * middle.
 *
 * Two blocks may cover the same byte. That is the point: an overlapping decode
 * produces two blocks whose ranges intersect, each internally consistent, and a
 * reader is shown both rather than one silently winning.
 */
export function buildBlocks(
  instructions: InstructionIndex,
  entryPoints: readonly number[] = []
): BasicBlock[] {
  const starts = leaders(instructions, entryPoints);
  const blocks: BasicBlock[] = [];

  for (const start of [...starts].sort((a, b) => a - b)) {
    const body: Instruction[] = [];
    const calls: number[] = [];
    let at = start;
    let exit: BasicBlock["exit"] = "fallthrough";

    for (;;) {
      const instr = instructions.get(at);
      if (!instr) break;

      body.push(instr);
      if (instr.flow === "call") calls.push(...jumpTargets(instr));

      at += instr.bytes.length;

      if (instr.flow === "jump") { exit = "jump"; break; }
      if (instr.flow === "ret") { exit = "ret"; break; }
      if (instr.flow === "halt") { exit = "halt"; break; }
      if (instr.flow === "branch") { exit = "branch"; break; }
      if (instr.flow === "call") { exit = "call"; break; }
      // Another block begins here, so this one ends.
      if (starts.has(at)) { exit = "fallthrough"; break; }
      if (!instructions.has(at)) { exit = "fallthrough"; break; }
    }

    if (body.length === 0) continue;

    const last = body[body.length - 1];
    const after = last.address + last.bytes.length;
    const successors: number[] = [];

    if (exit === "branch") {
      successors.push(...jumpTargets(last), after);
    } else if (exit === "jump") {
      successors.push(...jumpTargets(last));
    } else if (exit === "call" || exit === "fallthrough") {
      // A call's successor is where it returns to. That assumes it returns,
      // which is the ordinary case and stated rather than hidden: a routine
      // that does not would make the rest of its caller look unreachable, and
      // that is a worse lie than this one.
      successors.push(after);
    }
    // A return or a halt has no successor here. Where a `RTS` goes back to is a
    // property of the call, not of this block.

    blocks.push({
      start,
      end: at,
      instructions: body,
      successors: successors.filter((s) => instructions.has(s)),
      calls,
      exit,
    });
  }

  return blocks;
}

/**
 * Blocks whose ranges intersect another's.
 *
 * Rare and always worth knowing: a byte read two ways means either a
 * deliberate 6502 trick or a decode that went wrong, and both want a reader's
 * attention. Returned in address order, each paired with what it overlaps.
 */
export function overlappingBlocks(
  blocks: readonly BasicBlock[]
): { block: BasicBlock; overlaps: BasicBlock }[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  const found: { block: BasicBlock; overlaps: BasicBlock }[] = [];

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j].start < sorted[i].end; j++) {
      found.push({ block: sorted[j], overlaps: sorted[i] });
    }
  }

  return found;
}

/** The block containing an address, innermost first where blocks overlap. */
export function blockAt(
  blocks: readonly BasicBlock[],
  address: number
): BasicBlock | undefined {
  return blocks
    .filter((b) => address >= b.start && address < b.end)
    .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
}
