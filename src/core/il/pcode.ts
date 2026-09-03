/**
 * P-Code: the primitive operations every instruction is translated into.
 *
 * Ghidra's IL, with Ghidra's names, because it is what the reverse engineering
 * community settled on — so `6502.slaspec` stays readable as a specification
 * and anyone who knows Ghidra can read what comes out of here.
 *
 * The point is not the IL for its own sake. Once an instruction is expressed in
 * these operations, "what does this clobber", "what flags does it touch" and
 * "what does it do to the stack" stop being tables somebody maintains beside
 * the semantics and start being things you compute by looking at the ops. Two
 * tables drift; a derived answer cannot.
 *
 * Deliberately a subset. A 6502 needs no floating point, no 64-bit anything,
 * and no segmented addressing, and operations nothing emits are operations
 * nothing tests.
 */

/**
 * Where a value lives.
 *
 * - `register` — the machine's own state: A, X, Y, the flags. Offset is an id.
 * - `ram` — addressable memory. Offset is the address.
 * - `const` — a literal. Offset *is* the value.
 * - `unique` — a temporary invented during translation, dead at the end of the
 *   instruction that made it. Offset is an id unique within that instruction.
 */
export type Space = "register" | "ram" | "const" | "unique";

/**
 * A typed slot: where, which one, how many bytes.
 *
 * Size matters and is not decoration — the same register offset at size 1 and
 * size 2 are different values, which is how a 6502's 16-bit program counter and
 * its 8-bit halves coexist.
 */
export interface Varnode {
  readonly space: Space;
  readonly offset: number;
  readonly size: number;
}

/**
 * The operations. Ghidra's names and Ghidra's meanings.
 *
 * `CALLOTHER` is the escape hatch: an effect that is real but not modelled.
 * Emitting it says "something happens here and this does not describe it",
 * which is worth more than a plausible description that is wrong — decimal-mode
 * arithmetic being the case in hand.
 */
export type Opcode =
  // Movement
  | "COPY"
  | "LOAD"
  | "STORE"
  // Control flow
  | "BRANCH"
  | "CBRANCH"
  | "BRANCHIND"
  | "CALL"
  | "CALLIND"
  | "RETURN"
  // Comparison, all producing a one-byte boolean
  | "INT_EQUAL"
  | "INT_NOTEQUAL"
  | "INT_LESS"
  | "INT_SLESS"
  | "INT_LESSEQUAL"
  | "INT_SLESSEQUAL"
  // Arithmetic
  | "INT_ADD"
  | "INT_SUB"
  | "INT_CARRY"
  | "INT_SCARRY"
  | "INT_SBORROW"
  | "INT_2COMP"
  /**
   * Binary-coded decimal add and subtract, returning result and carry together.
   *
   * The one place this IL departs from Ghidra's vocabulary, and it departs
   * because there is nothing to be faithful to: Ghidra's `6502.slaspec` does not
   * check `D` at all, so it has no decimal operations to borrow names from.
   *
   * Two bytes out — the low byte is the result, bit 8 is the carry — so one
   * operation answers both and `SUBPIECE` takes them apart, rather than needing
   * a second opcode purely to report a flag.
   *
   * The alternative was expressing nibble-wise correction in existing
   * operations: roughly thirty per `ADC`, branchless, for arithmetic no target
   * we have actually uses. That is unreadable in a listing and unmaintainable in
   * the lifter, and the decimal-mode flag rules would still not come out right.
   */
  | "INT_BCD_ADD"
  | "INT_BCD_SUB"
  // Bitwise
  | "INT_NEGATE"
  | "INT_XOR"
  | "INT_AND"
  | "INT_OR"
  | "INT_LEFT"
  | "INT_RIGHT"
  | "INT_SRIGHT"
  // Width
  | "INT_ZEXT"
  | "INT_SEXT"
  | "PIECE"
  | "SUBPIECE"
  // Boolean
  | "BOOL_NEGATE"
  | "BOOL_AND"
  | "BOOL_OR"
  | "BOOL_XOR"
  // Not modelled
  | "CALLOTHER";

/**
 * One operation: an opcode, its inputs, and where the result goes.
 *
 * `output` is absent for the operations that produce no value — the branches,
 * `STORE`, and a `CALLOTHER` that only marks an effect.
 */
export interface PcodeOp {
  readonly op: Opcode;
  readonly output?: Varnode;
  readonly inputs: readonly Varnode[];
}

/**
 * The 6502's own state, by register offset.
 *
 * Flags are one byte holding 0 or 1 rather than one bit. P-Code sizes are in
 * bytes and Ghidra does the same; a flag that is its own varnode is what lets
 * "which flags does this clobber" be answered by looking at outputs.
 */
export const REG = {
  A: 0,
  X: 1,
  Y: 2,
  /** Stack pointer, low byte. The high byte is always $01 on this machine. */
  SP: 3,
  /** Carry. */
  C: 4,
  /** Zero. */
  Z: 5,
  /** Interrupt disable. */
  I: 6,
  /** Decimal mode. */
  D: 7,
  /** Break. */
  B: 8,
  /** Overflow. */
  V: 9,
  /** Negative. */
  N: 10,
  /** Program counter, two bytes. */
  PC: 11,
} as const;

/** Reverse lookup, so a printed operation names registers rather than numbers. */
const REGISTER_NAMES = new Map<number, string>(
  Object.entries(REG).map(([name, offset]) => [offset, name])
);

export const FLAGS = [REG.C, REG.Z, REG.I, REG.D, REG.B, REG.V, REG.N] as const;

export const reg = (offset: number, size = 1): Varnode => ({
  space: "register",
  offset,
  size,
});

export const constant = (value: number, size = 1): Varnode => ({
  space: "const",
  offset: value,
  size,
});

export const unique = (id: number, size = 1): Varnode => ({
  space: "unique",
  offset: id,
  size,
});

export const ram = (address: number, size = 1): Varnode => ({
  space: "ram",
  offset: address,
  size,
});

/** Whether two varnodes name the same slot. */
export function sameVarnode(a: Varnode, b: Varnode): boolean {
  return a.space === b.space && a.offset === b.offset && a.size === b.size;
}

const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`;

/** One varnode, readably: `A`, `#0x1F`, `$(0400)`, `u3`. */
export function formatVarnode(v: Varnode): string {
  switch (v.space) {
    case "register": {
      const name = REGISTER_NAMES.get(v.offset);
      return name ?? `r${v.offset}`;
    }
    case "const":
      return `#${hex(v.offset)}`;
    case "ram":
      return `$(${hex(v.offset)})`;
    case "unique":
      return `u${v.offset}${v.size === 1 ? "" : `:${v.size}`}`;
  }
}

/** One operation, readably: `A = INT_ADD A, #0x1`. */
export function formatOp(op: PcodeOp): string {
  const args = op.inputs.map(formatVarnode).join(", ");
  return op.output ? `${formatVarnode(op.output)} = ${op.op} ${args}` : `${op.op} ${args}`;
}

export const formatOps = (ops: readonly PcodeOp[]): string => ops.map(formatOp).join("\n");

/**
 * Every slot an operation writes.
 *
 * The whole reason for the IL: clobber sets are read off the operations rather
 * than kept beside them. A `unique` is excluded — it is a temporary that dies
 * with the instruction that made it, and reporting it as clobbered would say
 * that every instruction destroys state nobody can observe.
 */
export function writes(ops: readonly PcodeOp[]): Varnode[] {
  const found: Varnode[] = [];
  for (const op of ops) {
    if (!op.output || op.output.space === "unique") continue;
    if (!found.some((v) => sameVarnode(v, op.output!))) found.push(op.output);
  }
  return found;
}

/**
 * Every slot an operation reads before anything here wrote it.
 *
 * "Before" matters: an instruction that computes a temporary and then reads it
 * back does not read anything of the machine's, and counting it would make
 * every instruction look like it depends on everything it touches.
 */
export function reads(ops: readonly PcodeOp[]): Varnode[] {
  const written: Varnode[] = [];
  const found: Varnode[] = [];

  for (const op of ops) {
    for (const input of op.inputs) {
      if (input.space === "const") continue;
      if (written.some((v) => sameVarnode(v, input))) continue;
      if (!found.some((v) => sameVarnode(v, input))) found.push(input);
    }
    if (op.output) written.push(op.output);
  }

  return found;
}

/** The flags an operation writes, by register offset. */
export function flagsWritten(ops: readonly PcodeOp[]): number[] {
  return writes(ops)
    .filter((v) => v.space === "register" && (FLAGS as readonly number[]).includes(v.offset))
    .map((v) => v.offset);
}
