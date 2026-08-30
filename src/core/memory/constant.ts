/**
 * Names for values, and the sites that mean them.
 *
 * A constant is not a label. A label names an *address*, and an address has one
 * meaning; a constant names a *value*, and a value does not. The reference
 * disassembly of Gridrunner settles this on its own:
 *
 *     LEFT_ZAPPER   = $01        WHITE = $01
 *     BOTTOM_ZAPPER = $02        RED   = $02
 *
 * The same number carries two names in the same program, and only the person
 * writing each line knows which one was meant. So there is no value-to-name map
 * to be had, and nothing here tries to infer one: a declaration says a name
 * exists, and a separate use says *this* operand means it. That is exactly what
 * an assembler's equate plus its source text do, split into two objects.
 *
 * The split is also why the two live in different places. A declaration
 * describes no bytes, so it belongs to the project, beside `primaryLabels`. A
 * use is about one instruction's bytes, so it belongs to that instruction's
 * layer and moves with it when the stack is reordered.
 */

export interface Constant {
  readonly id: string;
  readonly name: string;
  /** The 8-bit value this names. */
  readonly value: number;
}

/**
 * One operand that means a constant.
 *
 * Keyed by address alone, with no operand slot, because the 6502 has exactly
 * one immediate addressing mode out of thirteen and no instruction takes two
 * immediates. Keying by address also leaves room for a data byte to mean a
 * constant later — `.BYTE EXPLOSION1` rather than `.BYTE $16` — without
 * changing the shape.
 */
export interface ConstantUse {
  readonly id: string;
  readonly address: number;
  readonly constantId: string;
}

export function createConstant(id: string, name: string, value: number): Constant {
  return { id, name, value };
}

export function createConstantUse(id: string, address: number, constantId: string): ConstantUse {
  return { id, address, constantId };
}

/**
 * Which constant each site means, and what the constants are.
 *
 * A use whose constant no longer exists resolves to nothing and the operand
 * renders as the literal it always was. That is the same rule a dangling
 * `primaryLabels` entry follows: deleting a declaration needs no cleanup pass,
 * and a delete racing a bind heals itself rather than leaving a broken
 * reference behind.
 */
export class ConstantIndex {
  private readonly declared = new Map<string, Constant>();
  private readonly uses = new Map<number, ConstantUse>();

  declare(constant: Constant): void {
    this.declared.set(constant.id, constant);
  }

  declareAll(constants: readonly Constant[]): void {
    for (const constant of constants) this.declare(constant);
  }

  bind(use: ConstantUse): void {
    this.uses.set(use.address, use);
  }

  bindAll(uses: readonly ConstantUse[]): void {
    for (const use of uses) this.bind(use);
  }

  /** The name to render at this address, if a live constant is bound there. */
  nameAt(address: number): string | undefined {
    const use = this.uses.get(address);
    if (!use) return undefined;
    return this.declared.get(use.constantId)?.name;
  }

  /** Every declared name for a value, which is what a chooser offers. */
  named(value: number): readonly Constant[] {
    return [...this.declared.values()]
      .filter((c) => c.value === value)
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  byName(name: string): Constant | undefined {
    return [...this.declared.values()].find((c) => c.name === name);
  }

  all(): readonly Constant[] {
    return [...this.declared.values()].sort((a, b) =>
      a.value - b.value || (a.name < b.name ? -1 : 1)
    );
  }

  /**
   * The constants actually meant somewhere, in value order.
   *
   * Derived rather than stored, so an equate block emitted for a listing stays
   * in step with the uses by construction. Filterable by address so exporting
   * one layer can emit only what that layer means.
   */
  used(within?: (address: number) => boolean): readonly Constant[] {
    const ids = new Set<string>();
    for (const use of this.uses.values()) {
      if (!within || within(use.address)) ids.add(use.constantId);
    }
    return [...ids]
      .map((id) => this.declared.get(id))
      .filter((c): c is Constant => c !== undefined)
      .sort((a, b) => a.value - b.value || (a.name < b.name ? -1 : 1));
  }

  get size(): number {
    return this.declared.size;
  }
}
