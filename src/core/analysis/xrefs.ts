/**
 * Program analysis: what refers to what.
 *
 * Distinct from `core/view/` — this answers *what is this code*, not how it is
 * laid out. `disassemble()` already emits a raw reference map as a byproduct of
 * following control flow; this gives it a shape worth querying, and gives basic
 * blocks and the call graph a home to grow into rather than accreting inside the
 * row builder.
 */

import { Instruction } from "../arch/mos6502/instruction.js";
import { InstructionIndex, Reference, ReferenceType } from "../arch/mos6502/disassembler.js";

/** Everything known about the references pointing at one address. */
export interface XrefTarget {
  address: number;
  refs: readonly Reference[];
}

/** Queryable view over the disassembler's raw reference map. */
export class XrefIndex {
  constructor(private readonly refs: Map<number, Reference[]>) {}

  /** References pointing at an address, in discovery order. */
  to(address: number): readonly Reference[] {
    return this.refs.get(address) ?? [];
  }

  /** How many references point at an address. */
  count(address: number): number {
    return this.refs.get(address)?.length ?? 0;
  }

  /** True when any reference of the given type points here. */
  hasType(address: number, type: ReferenceType): boolean {
    return this.to(address).some((r) => r.type === type);
  }

  /**
   * Addresses that are called, i.e. genuine subroutine entries.
   *
   * This is the seed of call-graph analysis: a JSR target has callers and a
   * return contract, which is what distinguishes a function from a branch label.
   */
  callTargets(): number[] {
    return [...this.refs.entries()]
      .filter(([, refs]) => refs.some((r) => r.type === "call"))
      .map(([address]) => address)
      .sort((a, b) => a - b);
  }

  /** Every referenced address, ascending. */
  targets(): number[] {
    return [...this.refs.keys()].sort((a, b) => a - b);
  }

  get size(): number {
    return this.refs.size;
  }

  /** The underlying map, for callers that need to walk every target. */
  raw(): ReadonlyMap<number, readonly Reference[]> {
    return this.refs;
  }
}

/**
 * What an address refers to, which the reference map cannot say.
 *
 * `disassemble` keys references by their *target*, so "who calls this" is a
 * lookup and "what does this call" is not. This walks the decoded instructions
 * once and builds the other direction.
 *
 * It reads the operand rather than the reference map, which means it sees
 * zero-page targets — a `LDA $02` names a variable, and the reference map
 * silently omits it because only absolute modes are recorded there.
 */
export class OutboundIndex {
  private constructor(private readonly byAddress: Map<number, OutboundRef[]>) {}

  static from(instructions: InstructionIndex): OutboundIndex {
    const byAddress = new Map<number, OutboundRef[]>();

    for (const instruction of instructions.all()) {
      const target = targetOf(instruction);
      if (target === undefined) continue;
      byAddress.set(instruction.address, [{ to: target, type: kindOf(instruction) }]);
    }

    return new OutboundIndex(byAddress);
  }

  /** What the instruction at this address refers to. */
  from(address: number): readonly OutboundRef[] {
    return this.byAddress.get(address) ?? [];
  }

  /** Everything referred to from within a span, in address order. */
  inRange(start: number, end: number): { address: number; refs: readonly OutboundRef[] }[] {
    return [...this.byAddress.entries()]
      .filter(([address]) => address >= start && address < end)
      .sort((a, b) => a[0] - b[0])
      .map(([address, refs]) => ({ address, refs }));
  }

  get size(): number {
    return this.byAddress.size;
  }
}

export interface OutboundRef {
  to: number;
  type: ReferenceType;
}

function kindOf(instruction: Instruction): ReferenceType {
  switch (instruction.flow) {
    case "call":
      return "call";
    case "jump":
      return "jump";
    case "branch":
      return "branch";
    default:
      return "data";
  }
}

/** The address an operand names, whatever the addressing mode. */
function targetOf(instruction: Instruction): number | undefined {
  const operand = instruction.operand;
  switch (operand.type) {
    case "absolute":
    case "absoluteX":
    case "absoluteY":
    case "indirect":
    case "zeroPage":
    case "zeroPageX":
    case "zeroPageY":
      return operand.address;
    case "relative":
      // Branches carry a resolved target, not an address field.
      return operand.target;
    default:
      return undefined;
  }
}
