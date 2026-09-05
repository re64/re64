/**
 * The decode graph: one decode attempt per address, no roots, no regions, no
 * walk.
 *
 * The current disassembler answers "what is code" by walking from entry points
 * and refusing to enter a non-code region. That conflates three questions —
 * *what could this byte be*, *what does anything reach*, and *what did somebody
 * claim* — and settles all three in one pass, which is why a `code` region ended
 * up meaning "a decode root" and "not one of the other kinds" at once.
 *
 * Here they are separated. This structure answers only the first, and it does so
 * for every address whether or not anything reaches it:
 *
 * - **Decoding is root-independent.** A byte decodes to what it decodes to. That
 *   is a fact about the bytes, so it is computed once and shared by every query.
 * - **Reachability is a query**, over a root set the caller supplies. Two targets
 *   with different roots ask the same graph twice rather than re-deriving it, and
 *   "what would this look like if `$8E00` were code" costs a walk, not a rebuild.
 * - **Claims never block it.** Declaring a span data hides blocks from a listing;
 *   it does not make them stop existing, so "this span is data, and it also
 *   decodes cleanly, and `$8123` reaches it" becomes a statement the system can
 *   make instead of one it structurally cannot.
 *
 * Dense typed arrays rather than objects, because the whole point is that the
 * exhaustive part is cheap: four arrays of 64K is 640KB flat, and `Instruction`
 * objects are materialised only for the addresses a query actually surfaces.
 */

import { decode, ByteReader } from "../arch/mos6502/decoder.js";
import { Instruction } from "../arch/mos6502/instruction.js";
import { FlowType } from "../arch/mos6502/opcodes.js";

/** One past the highest address a 6502 can name. */
export const ADDRESS_SPACE = 0x10000;

/** No decode here: the byte is unmapped, or the opcode is not defined. */
const NO_DECODE = 0;

const FLOW_CODES: Record<FlowType, number> = {
  next: 1,
  branch: 2,
  jump: 3,
  call: 4,
  ret: 5,
  halt: 6,
};
const FLOW_NAMES: FlowType[] = ["next", "next", "branch", "jump", "call", "ret", "halt"];

/** Nothing here. Typed arrays cannot hold `undefined`, so absence is -1. */
const NONE = -1;

export interface DecodeGraphStats {
  /** Addresses where a legal instruction decodes. */
  readonly decodable: number;
  /** Addresses supplied by no layer. */
  readonly unmapped: number;
  /** Addresses whose byte is not a defined opcode. */
  readonly undefinedOpcode: number;
  /** Addresses where the instruction would run off the end of mapped memory. */
  readonly truncated: number;
  /** Milliseconds to build. */
  readonly ms: number;
}

/**
 * What a query is allowed to follow.
 *
 * Split out because the three edges answer different questions and a caller
 * usually wants a subset: a listing wants control flow, a data closure wants
 * operands, and "who could reach this" wants both, backwards.
 */
export interface WalkOptions {
  /** Follow `JSR` into the callee. On by default. */
  readonly calls?: boolean;
  /** Follow the address an operand names, as a *data* root rather than as code. */
  readonly operands?: boolean;
}

export class DecodeGraph {
  /** Instruction byte length, or `NO_DECODE`. Indexed by address. */
  private readonly len: Uint8Array;
  /** `FLOW_CODES` value, meaningful only where `len` is non-zero. */
  private readonly flowCode: Uint8Array;
  /** Branch/jump/call target, or `NONE`. Never the fall-through. */
  private readonly target: Int32Array;
  /** Address an operand names without transferring control, or `NONE`. */
  private readonly dataRef: Int32Array;

  readonly stats: DecodeGraphStats;

  private constructor(
    private readonly reader: ByteReader,
    len: Uint8Array,
    flowCode: Uint8Array,
    target: Int32Array,
    dataRef: Int32Array,
    stats: DecodeGraphStats
  ) {
    this.len = len;
    this.flowCode = flowCode;
    this.target = target;
    this.dataRef = dataRef;
    this.stats = stats;
  }

  /**
   * Decode every address once.
   *
   * Deliberately not lazy. A lazy version would be a cache with an eviction
   * question attached, and the measurement this exists to make is whether the
   * eager version is cheap enough that the question never arises.
   */
  static build(reader: ByteReader): DecodeGraph {
    const started = performance.now();

    const len = new Uint8Array(ADDRESS_SPACE);
    const flowCode = new Uint8Array(ADDRESS_SPACE);
    const target = new Int32Array(ADDRESS_SPACE).fill(NONE);
    const dataRef = new Int32Array(ADDRESS_SPACE).fill(NONE);

    let decodable = 0;
    let unmapped = 0;
    let undefinedOpcode = 0;
    let truncated = 0;

    for (let address = 0; address < ADDRESS_SPACE; address++) {
      if (reader.readByte(address) === undefined) {
        unmapped++;
        continue;
      }

      const result = decode(reader, address);
      if (!result.ok) {
        if (result.reason === "truncated") truncated++;
        else undefinedOpcode++;
        continue;
      }

      const instr = result.instruction;
      len[address] = instr.bytes.length;
      flowCode[address] = FLOW_CODES[instr.flow];
      target[address] = transferTarget(instr);
      dataRef[address] = operandTarget(instr);
      decodable++;
    }

    return new DecodeGraph(reader, len, flowCode, target, dataRef, {
      decodable,
      unmapped,
      undefinedOpcode,
      truncated,
      ms: performance.now() - started,
    });
  }

  /** Does a legal instruction start here? */
  decodes(address: number): boolean {
    return address >= 0 && address < ADDRESS_SPACE && this.len[address] !== NO_DECODE;
  }

  /** How many bytes the instruction here occupies, or 0 if none decodes. */
  size(address: number): number {
    return this.decodes(address) ? this.len[address] : 0;
  }

  flowAt(address: number): FlowType | undefined {
    return this.decodes(address) ? FLOW_NAMES[this.flowCode[address]] : undefined;
  }

  /**
   * The instruction here, decoded on demand.
   *
   * Not cached: a caller that wants many of them is building a listing and will
   * hold them itself, and a cache of 64K instructions would undo the reason the
   * graph is typed arrays in the first place.
   */
  instructionAt(address: number): Instruction | undefined {
    if (!this.decodes(address)) return undefined;
    const result = decode(this.reader, address);
    return result.ok ? result.instruction : undefined;
  }

  /** The address after the instruction here, when control continues past it. */
  fallThrough(address: number): number | undefined {
    const flow = this.flowAt(address);
    if (flow === undefined) return undefined;
    if (flow === "jump" || flow === "ret" || flow === "halt") return undefined;
    return address + this.len[address];
  }

  /** Where a branch or jump goes; where a call goes. Never the fall-through. */
  transferTo(address: number): number | undefined {
    if (!this.decodes(address)) return undefined;
    const t = this.target[address];
    return t === NONE ? undefined : t;
  }

  /** The address an operand names without transferring control. */
  operandRef(address: number): number | undefined {
    if (!this.decodes(address)) return undefined;
    const t = this.dataRef[address];
    return t === NONE ? undefined : t;
  }

  /**
   * Where control can go from here, as addresses.
   *
   * A call's successor is where it returns to; the callee is reported by
   * `transferTo` and followed separately, so a routine that never comes back
   * does not silently make its caller's tail look reachable.
   */
  successors(address: number, options: WalkOptions = {}): number[] {
    const flow = this.flowAt(address);
    if (flow === undefined) return [];

    const out: number[] = [];
    const next = this.fallThrough(address);
    if (next !== undefined && next < ADDRESS_SPACE) out.push(next);

    const t = this.transferTo(address);
    if (t !== undefined && (flow !== "call" || options.calls !== false)) out.push(t);

    return out;
  }
}

/**
 * The address a control transfer names, if it names one statically.
 *
 * An indirect `JMP` names a *cell*, not a destination, so it contributes no
 * edge — the same refusal the walk already makes, and for the same reason: the
 * vector holds whatever the program last wrote there.
 */
function transferTarget(instr: Instruction): number {
  switch (instr.flow) {
    case "branch":
      return instr.operand.type === "relative" ? instr.operand.target : NONE;
    case "jump":
    case "call":
      return instr.operand.type === "absolute" ? instr.operand.address : NONE;
    default:
      return NONE;
  }
}

/**
 * The address a non-transferring operand names.
 *
 * Zero page is included, unlike `extractReferences`, which sees absolute modes
 * only. On this machine zero page *is* the variable space, so excluding it means
 * the data closure cannot see most of what a routine touches — and the reference
 * project names 336 addresses below `$0100`.
 */
function operandTarget(instr: Instruction): number {
  if (instr.flow !== "next") return NONE;
  switch (instr.operand.type) {
    case "absolute":
    case "absoluteX":
    case "absoluteY":
    case "zeroPage":
    case "zeroPageX":
    case "zeroPageY":
      return instr.operand.address;
    default:
      return NONE;
  }
}
