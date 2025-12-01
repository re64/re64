import { decode, ByteReader, DecodeResult } from "./decoder.js";
import { Instruction, getTargets, continues } from "./instruction.js";
import { RegionIndex } from "../../memory/region.js";

/** Warning types that can occur during disassembly */
export type DisassemblyWarning =
  | { type: "undefined"; address: number }
  | { type: "truncated"; address: number; needed: number; available: number }
  | { type: "overlap"; address: number; existingAddress: number };

/** Result of disassembly */
export interface DisassemblyResult {
  /** Decoded instructions, keyed by address */
  instructions: Map<number, Instruction>;
  /** Warnings encountered during disassembly */
  warnings: DisassemblyWarning[];
}

/** Options for the disassembler */
export interface DisassemblyOptions {
  /** Entry point addresses to start disassembly from */
  entryPoints: number[];
  /** Optional region index for determining what to disassemble */
  regions?: RegionIndex;
}

/**
 * Check if an address should be disassembled as code.
 * Returns true for code regions and unknown regions (which default to code).
 */
function shouldDisassemble(regions: RegionIndex | undefined, address: number): boolean {
  if (!regions) {
    return true; // No regions = disassemble everything
  }
  const region = regions.getRegionAt(address);
  if (!region) {
    return true; // Unknown region = assume code
  }
  return region.kind === "code" || region.kind === "unknown";
}

/**
 * Extract entry points from jumptable regions.
 * Reads 16-bit little-endian addresses from each jumptable region.
 */
function extractJumptableEntries(reader: ByteReader, regions: RegionIndex): number[] {
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
 * Work-queue based disassembler.
 * Starts from entry points and follows control flow to discover code.
 * Also extracts entry points from jumptable regions.
 */
export function disassemble(
  reader: ByteReader,
  options: DisassemblyOptions
): DisassemblyResult {
  const instructions = new Map<number, Instruction>();
  const warnings: DisassemblyWarning[] = [];
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
    const overlap = findOverlap(instructions, address);
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

    // Queue targets for further disassembly
    const targets = getTargets(instr);
    for (const target of targets) {
      if (!visited.has(target) && shouldDisassemble(regions, target)) {
        queue.push(target);
      }
    }
  }

  return { instructions, warnings };
}

/**
 * Check if decoding at `address` would overlap with an existing instruction.
 * Returns the address of the overlapping instruction, or undefined if no overlap.
 */
function findOverlap(
  instructions: Map<number, Instruction>,
  address: number
): number | undefined {
  // Check if any existing instruction spans this address
  for (const [existingAddr, instr] of instructions) {
    const end = existingAddr + instr.bytes.length;
    if (address > existingAddr && address < end) {
      return existingAddr;
    }
  }
  return undefined;
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
