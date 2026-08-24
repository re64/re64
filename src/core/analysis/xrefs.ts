/**
 * Program analysis: what refers to what.
 *
 * Distinct from `core/view/` — this answers *what is this code*, not how it is
 * laid out. `disassemble()` already emits a raw reference map as a byproduct of
 * following control flow; this gives it a shape worth querying, and gives basic
 * blocks and the call graph a home to grow into rather than accreting inside the
 * row builder.
 */

import { Reference, ReferenceType } from "../arch/mos6502/disassembler.js";

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
}
