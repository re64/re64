import { decode, ByteReader, DecodeResult } from "./decoder.js";
import { Instruction, getTargets, continues } from "./instruction.js";
import { Region, RegionKind } from "../../memory/region.js";

/**
 * What the disassembler needs to know about memory semantics.
 *
 * Narrower than `MemoryMap` on purpose: `core/arch` stays independent of the
 * layer stack, and tests can supply a literal.
 */
export interface RegionLookup {
  /** Effective kind at an address, or undefined where nothing is mapped. */
  getKindAt(address: number): RegionKind | undefined;
  /** Jumptable regions across the whole map, for entry point extraction. */
  getJumptables(): readonly Region[];
}

/** Warning types that can occur during disassembly */
export type DisassemblyWarning =
  | { type: "undefined"; address: number }
  | { type: "truncated"; address: number; needed: number; available: number }
  | { type: "overlap"; address: number; existingAddress: number };

/** A warning as a line someone can read. */
export function describeWarning(w: DisassemblyWarning): string {
  const hex = (n: number) => `$${n.toString(16).toUpperCase().padStart(4, "0")}`;
  switch (w.type) {
    case "undefined":
      return `${hex(w.address)}: undefined bytes`;
    case "truncated":
      return `${hex(w.address)}: truncated instruction (needed ${w.needed}, got ${w.available})`;
    case "overlap":
      return `${hex(w.address)}: overlaps instruction at ${hex(w.existingAddress)}`;
  }
}

/**
 * Reference types discovered during disassembly:
 * - "call" - JSR target (subroutine entry)
 * - "branch" - branch target (local label)
 * - "jump" - JMP target
 * - "data" - data reference (LDA/STA absolute, etc.)
 */
export type ReferenceType = "call" | "branch" | "jump" | "data";

/** Information about a reference to an address */
export interface Reference {
  /** Type of reference */
  type: ReferenceType;
  /** Address of the instruction making the reference */
  from: number;
}

/** Result of disassembly */
export interface DisassemblyResult {
  /** Decoded instructions, keyed by address */
  instructions: Map<number, Instruction>;
  /** Warnings encountered during disassembly */
  warnings: DisassemblyWarning[];
  /** References discovered during disassembly, keyed by target address */
  references: Map<number, Reference[]>;
}

/** Options for the disassembler */
export interface DisassemblyOptions {
  /** Entry point addresses to start disassembly from */
  entryPoints: number[];
  /** Optional region info for determining what to disassemble */
  regions?: RegionLookup;
}

/**
 * Check if an address should be disassembled as code.
 * Returns true for code regions and unknown regions (which default to code).
 */
function shouldDisassemble(regions: RegionLookup | undefined, address: number): boolean {
  if (!regions) {
    return true; // No region info = disassemble everything
  }
  const kind = regions.getKindAt(address);
  if (!kind) {
    return true; // Nothing mapped here = assume code
  }
  return kind === "code" || kind === "unknown";
}

/**
 * Extract entry points from jumptable regions.
 * Reads 16-bit little-endian addresses from each jumptable region.
 */
function extractJumptableEntries(reader: ByteReader, regions: RegionLookup): number[] {
  const entries: number[] = [];
  const jumptables = regions.getJumptables();

  for (const table of jumptables) {
    // Read 16-bit addresses (little-endian) from the table
    for (let addr = table.start; addr + 1 < table.end; addr += 2) {
      const lo = reader.readByte(addr);
      const hi = reader.readByte(addr + 1);
      if (lo !== undefined && hi !== undefined) {
        const target = lo | (hi << 8);
        entries.push(target);
      }
    }
  }

  return entries;
}

/**
 * Add a reference to the references map
 */
function addReference(
  references: Map<number, Reference[]>,
  target: number,
  type: ReferenceType,
  from: number
): void {
  const existing = references.get(target);
  if (existing) {
    existing.push({ type, from });
  } else {
    references.set(target, [{ type, from }]);
  }
}

/**
 * Extract references from an instruction based on its flow type and operand
 */
function extractReferences(instr: Instruction): { target: number; type: ReferenceType }[] {
  const refs: { target: number; type: ReferenceType }[] = [];
  const operand = instr.operand;

  switch (instr.flow) {
    case "call":
      // JSR - subroutine call
      if (operand.type === "absolute") {
        refs.push({ target: operand.address, type: "call" });
      }
      break;
    case "jump":
      // JMP - direct jump
      if (operand.type === "absolute") {
        refs.push({ target: operand.address, type: "jump" });
      }
      break;
    case "branch":
      // Conditional branch
      if (operand.type === "relative") {
        refs.push({ target: operand.target, type: "branch" });
      }
      break;
    case "next":
      // Regular instruction - check for data references
      if (operand.type === "absolute" || operand.type === "absoluteX" || operand.type === "absoluteY") {
        refs.push({ target: operand.address, type: "data" });
      }
      break;
  }

  return refs;
}

/**
 * Work-queue based disassembler.
 * Starts from entry points and follows control flow to discover code.
 * Also extracts entry points from jumptable regions.
 */
export function disassemble(
  reader: ByteReader,
  options: DisassemblyOptions
): DisassemblyResult {
  const instructions = new Map<number, Instruction>();
  const occupied = new Occupancy();
  const warnings: DisassemblyWarning[] = [];
  const references = new Map<number, Reference[]>();
  const regions = options.regions;

  // Build initial queue from explicit entry points plus jumptable entries
  const queue: number[] = [...options.entryPoints];
  if (regions) {
    const jumptableEntries = extractJumptableEntries(reader, regions);
    queue.push(...jumptableEntries);
  }

  const visited = new Set<number>();

  while (queue.length > 0) {
    const address = queue.shift()!;

    // Skip if already processed
    if (visited.has(address)) {
      continue;
    }
    visited.add(address);

    // Skip if this address is not in a code region
    if (!shouldDisassemble(regions, address)) {
      continue;
    }

    // Check for overlap with existing instruction
    const overlap = occupied.covering(address);
    if (overlap !== undefined) {
      warnings.push({
        type: "overlap",
        address,
        existingAddress: overlap,
      });
      continue;
    }

    // Decode the instruction
    const result = decode(reader, address);

    if (!result.ok) {
      if (result.reason === "undefined") {
        warnings.push({ type: "undefined", address: result.address });
      } else {
        warnings.push({
          type: "truncated",
          address: result.address,
          needed: result.needed,
          available: result.available,
        });
      }
      continue;
    }

    const instr = result.instruction;
    instructions.set(address, instr);
    occupied.claim(address, instr.bytes.length);

    // Extract and record references from this instruction
    const instrRefs = extractReferences(instr);
    for (const ref of instrRefs) {
      addReference(references, ref.target, ref.type, address);
    }

    // Queue targets for further disassembly
    const targets = getTargets(instr);
    for (const target of targets) {
      if (!visited.has(target) && shouldDisassemble(regions, target)) {
        queue.push(target);
      }
    }
  }

  return { instructions, warnings, references };
}

/**
 * Check if decoding at `address` would overlap with an existing instruction.
 * Returns the address of the overlapping instruction, or undefined if no overlap.
 */
/**
 * Which decoded instruction, if any, already covers an address.
 *
 * A byte map rather than a scan of everything decoded so far. The scan was
 * quadratic — every queued address against every instruction already found —
 * which is invisible on a few thousand instructions and four seconds on forty
 * thousand. That matters now that analysis runs on the server, where it would
 * block the event loop and stall every connected browser.
 *
 * Holds the address of the instruction owning each byte, offset by one so that
 * zero means unclaimed; the 6502 address space is small enough to afford it.
 */
class Occupancy {
  private readonly owner = new Uint32Array(0x10000);

  claim(address: number, length: number): void {
    for (let i = 0; i < length; i++) this.owner[(address + i) & 0xffff] = address + 1;
  }

  /** The instruction covering this address, or undefined when it starts one. */
  covering(address: number): number | undefined {
    const owner = this.owner[address & 0xffff];
    return owner !== 0 && owner - 1 !== address ? owner - 1 : undefined;
  }
}

/** Create an index for fast instruction lookup by address */
export class InstructionIndex {
  private byAddress: Map<number, Instruction>;

  constructor(instructions: Map<number, Instruction>) {
    this.byAddress = new Map(instructions);
  }

  get(address: number): Instruction | undefined {
    return this.byAddress.get(address);
  }

  has(address: number): boolean {
    return this.byAddress.has(address);
  }

  /** Get all instructions sorted by address */
  all(): Instruction[] {
    return [...this.byAddress.values()].sort((a, b) => a.address - b.address);
  }

  /** Get instructions in a range (inclusive start, exclusive end) */
  range(start: number, end: number): Instruction[] {
    return this.all().filter((i) => i.address >= start && i.address < end);
  }

  get size(): number {
    return this.byAddress.size;
  }
}
