/**
 * Where an indirect access actually goes, by running it.
 *
 * `STA ($02),Y` names no address, so a search over an address range cannot see
 * it — and on this machine that is not a corner case. Gridrunner writes the
 * VIC-II *only* through a pointer, so asking "what touches $D000-$D02E" returned
 * a single dead instruction and missed every write that mattered. Two readers in
 * experiment 2 hit that independently.
 *
 * **This used to fold constants by hand** — walk backwards looking for
 * `LDA #imm` immediately before `STA $zp` — and that was a mechanism built
 * beside one that already existed. The lifter describes every documented
 * instruction and the interpreter runs it, so the address a block reaches is
 * something the machine *computes*, exactly, rather than something a pattern
 * reconstructs. The pattern also could not see past its own shape: it required
 * the load to sit immediately before the store, so `LDA #$D0 / TAX / STX $03`
 * defeated it, and it never folded the *index*, so all three of Gridrunner's VIC
 * writes reported the shared base `$D000` instead of `$D018`, `$D020`, `$D021`.
 *
 * Running is exact only when nothing was assumed, and that is checkable rather
 * than hoped for: the run is seeded with **nothing at all**, so any cell the
 * block did not write itself reads as `unknown`, and one such read before the
 * access refuses the answer. The load image is deliberately not supplied —
 * zero page in a `.prg` holds whatever was in the file before the program
 * initialised it, which is exactly where pointers live.
 *
 * **It stops rather than guessing**, in the same two places as before, for the
 * same reasons:
 *
 * - At a **join**. Walking back through single predecessors is path-insensitive
 *   *and sound* precisely because there is one way in; the moment a block has
 *   two predecessors the answer could differ per path, so there is no answer.
 * - At a **computed store**. Gridrunner's screen pointer is loaded from a table
 *   (`LDA $0340,X / STA $06`), so it genuinely depends on runtime state. That
 *   read is `unknown` and refuses the answer, which is the same refusal the hand
 *   folder made and reached the same way.
 *
 * Measured on the reference project: 3 of 18 indirect accesses resolve, the same
 * three as before — the other 15 are loop bodies with several predecessors whose
 * pointer comes from the screen-line table and genuinely differs per iteration.
 * What changed is not coverage but precision, and that no second mechanism has
 * to be maintained to get it.
 */

import { Instruction } from "../arch/mos6502/instruction.js";
import { BasicBlock } from "./blocks.js";
import { InstructionTrace, RegisterName, runBlock } from "../il/run.js";
import { REG } from "../il/pcode.js";

export interface ResolvedPointer {
  /**
   * The address the pointer holds, before indexing.
   *
   * Known whenever the pointer bytes are, which is the weaker and more often
   * available claim — a search can still use it, as long as it knows that is
   * what it has.
   */
  base: number;
  /**
   * The address the instruction actually reached.
   *
   * Absent when the index register was never assigned on this path: the pointer
   * is then known and the offset into it is not, so `base` stands and this does
   * not. Reporting `base` as though it were the address is what made three
   * different VIC registers look like one.
   */
  address?: number;
  /** The byte stored, for a store whose value was known. */
  value?: number;
  /**
   * The instructions that wrote the pointer bytes, so a reader can check the
   * claim.
   *
   * The *stores*, not the loads that fed them. Running makes the distinction
   * meaningful: a pointer byte can be established through any chain of
   * instructions, and only the write to the cell is a fixed point in all of
   * them.
   */
  setAt: number[];
}

/** How far back to look. Beyond this the pointer is somebody else's business. */
const MAX_BLOCKS = 4;

/** The zero-page pair an indirect operand names, or undefined for anything else. */
function pointerOperand(
  instruction: Instruction
): { slot: number; index: "X" | "Y" } | undefined {
  const operand = instruction.operand;
  if (operand.type === "indirectIndexed") return { slot: operand.address, index: "Y" };
  // `($zp,X)` offsets the zero-page *slot* rather than the address it holds, so
  // X has to be known before the pointer can even be located — not merely
  // before it is indexed. Reading `$zp` regardless is what the hand folder did,
  // which is silently wrong for any X but zero.
  if (operand.type === "indexedIndirect") return { slot: operand.address, index: "X" };
  return undefined;
}

const INDEX_REGISTER: Record<"X" | "Y", number> = { X: REG.X, Y: REG.Y };

/**
 * Resolve the pointer an indirect instruction uses, by running the path that
 * built it.
 *
 * Returns undefined whenever anything is in doubt — a join, a value nothing
 * supplied, or simply running out of room to look.
 */
export function resolvePointer(
  instruction: Instruction,
  blocks: readonly BasicBlock[]
): ResolvedPointer | undefined {
  const operand = pointerOperand(instruction);
  if (!operand) return undefined;

  const real = blocks.filter((b) => !b.alternate);
  const containing = real.find(
    (b) => instruction.address >= b.start && instruction.address < b.end
  );
  if (!containing) return undefined;

  // Shortest path first, extending only when the shorter one could not answer.
  // The refusal below is deliberately blunt — *any* unsupplied read refuses —
  // so a longer path can only ever poison an answer a shorter one gave. Trying
  // them in order is what keeps the extra reach from costing precision.
  let chain: BasicBlock[] = [containing];
  for (;;) {
    const resolved = attempt(chain, instruction.address, operand);
    if (resolved) return resolved;
    if (chain.length >= MAX_BLOCKS) return undefined;

    // One predecessor or none: with two, the halves could have been set
    // differently on each path and picking one would be a guess.
    const before = real.filter((b) => b.successors.includes(chain[0].start));
    if (before.length !== 1 || chain.includes(before[0])) return undefined;
    chain = [before[0], ...chain];
  }
}

/**
 * Run one straight-line path and read the access off it.
 *
 * Seeded with nothing but what the previous block left, so every cell the path
 * did not write itself reads as `unknown` — which is the certificate. One such
 * read anywhere before the access refuses the answer: telling an unknown that
 * reaches the address from one that does not is taint tracking, and a wrong
 * address costs more than a refusal.
 */
function attempt(
  chain: readonly BasicBlock[],
  target: number,
  operand: { slot: number; index: "X" | "Y" }
): ResolvedPointer | undefined {
  const memory: Record<number, number> = {};
  const registers: Partial<Record<RegisterName, number>> = {};
  const defined = new Set<number>();
  const setAt = new Map<number, number>();

  for (const block of chain) {
    const run = runBlock(block, { memory, registers });

    for (const step of run.trace) {
      // At the access itself only the pointer cells are checked. The last read
      // *is* the target, and its value is exactly what nobody claims to know —
      // requiring it to be supplied would refuse every load through a pointer,
      // which is half the question.
      const relied = step.address === target ? step.reads.slice(0, 2) : step.reads;
      if (relied.some((r) => r.source === "unknown" || r.source === "image")) {
        return undefined;
      }
      for (const offset of step.registersWritten) defined.add(offset);
      for (const write of step.writes) setAt.set(write.address, step.address);

      if (step.address === target) return report(step, operand, defined, setAt);
    }

    // Nothing here reached it. What this block leaves is `given` to the next,
    // which is exactly what it is.
    for (const write of run.memoryWritten) memory[write.address] = write.value;
    for (const [name, value] of Object.entries(run.registers)) {
      registers[name as RegisterName] = value;
    }
    // `defined` is not reset: a register assigned in an earlier block is still
    // assigned in this one, which is the whole reason for walking the path.
  }

  return undefined;
}

function report(
  step: InstructionTrace,
  operand: { slot: number; index: "X" | "Y" },
  defined: Set<number>,
  setAt: Map<number, number>
): ResolvedPointer | undefined {
  // `($zp,X)` cannot even name its pointer cells without X, so an undefined
  // index refuses outright rather than falling back to a base.
  const indexed = defined.has(INDEX_REGISTER[operand.index]);
  if (operand.index === "X" && !indexed) return undefined;

  // The pointer cells, as the instruction read them — the low byte first, which
  // is what the lifter emits and what this machine is.
  const cells = step.reads.slice(0, 2);
  if (cells.length < 2) return undefined;
  const base = (cells[0].value | (cells[1].value << 8)) & 0xffff;

  // The access itself: a store writes one address, a load reads the target last
  // after reading the pointer.
  const touched = step.writes.length
    ? step.writes[0]
    : step.reads[step.reads.length - 1];
  if (!touched) return undefined;

  const where = [cells[0].address, cells[1].address]
    .map((cell) => setAt.get(cell))
    .filter((at): at is number => at !== undefined)
    .sort((a, b) => a - b);

  return {
    base,
    // Only when the index is known. With Y unassigned the machine ran it as
    // zero, so the address it touched *is* the base and reporting it as the
    // address would dress an assumption as a finding.
    ...(indexed ? { address: touched.address } : {}),
    ...(indexed && step.writes.length ? { value: step.writes[0].value } : {}),
    setAt: where,
  };
}

/** Every address an instruction is known to touch: its operand, or a resolved pointer. */
export function targetsOf(
  instruction: Instruction,
  blocks: readonly BasicBlock[]
): { address: number; indirect: boolean; exact?: boolean; value?: number; setAt?: number[] } | undefined {
  const operand = instruction.operand as { address?: number; type: string };
  if (pointerOperand(instruction)) {
    const resolved = resolvePointer(instruction, blocks);
    if (!resolved) return undefined;
    return {
      address: resolved.address ?? resolved.base,
      indirect: true,
      // Said rather than implied: with the index unknown this is the pointer,
      // and the access is somewhere at or after it.
      exact: resolved.address !== undefined,
      ...(resolved.value === undefined ? {} : { value: resolved.value }),
      setAt: resolved.setAt,
    };
  }
  return operand.address === undefined ? undefined : { address: operand.address, indirect: false };
}
