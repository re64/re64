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
  /** The region covering an address, for finding where non-code ends. */
  getRegionAt(address: number): Region | undefined;
  /** Jumptable regions across the whole map, for entry point extraction. */
  getJumptables(): readonly Region[];
}

/** Warning types that can occur during disassembly */
export type DisassemblyWarning =
  | { type: "undefined"; address: number }
  | { type: "truncated"; address: number; needed: number; available: number }
  | { type: "overlap"; address: number; existingAddress: number }
  | { type: "oddJumptable"; address: number; bytes: number }
  | { type: "flowIntoData"; address: number; kind: RegionKind };

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
    case "oddJumptable":
      return (
        `${hex(w.address)}: jumptable covers ${w.bytes} bytes, which is odd — ` +
        `the last byte is not part of any entry and is being ignored`
      );
    case "flowIntoData":
      return (
        `${hex(w.address)}: this analysis arrives here and it is declared ` +
        `${w.kind}, so decoding stops. It may not be ${w.kind}; the code ` +
        `leading here may be read wrongly; or the program may do something ` +
        `here that a static walk cannot follow`
      );
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
  /**
   * Second readings of bytes the main decode already claimed.
   *
   * A byte can be an operand on one path and an opcode on another — a branch
   * that lands mid-instruction, which is legitimate 6502 and which the
   * reference disassembly of Gridrunner does twice. One map cannot hold both,
   * so each contested reading gets its own stream, decoded with its own
   * occupancy so the two do not fight over the same bytes.
   *
   * Empty for almost every program. Kept separate rather than merged so that
   * everything downstream sees the same primary decode it always did, and can
   * choose whether to look at the alternates.
   */
  shadows: ShadowStream[];
}

/** One alternate reading, self-consistent within itself. */
export interface ShadowStream {
  /** The contested address this reading starts from. */
  from: number;
  /** Its own instructions, which overlap the main decode by construction. */
  instructions: Map<number, Instruction>;
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
function extractJumptableEntries(
  reader: ByteReader,
  regions: RegionLookup,
  warnings?: DisassemblyWarning[],
  references?: Map<number, Reference[]>
): number[] {
  const entries: number[] = [];
  const jumptables = regions.getJumptables();

  for (const table of jumptables) {
    // A file can already hold one — the write path refuses new ones, but
    // refusing to *load* a project over it would make it unopenable. Say so
    // instead, since the dropped byte is otherwise invisible.
    const span = table.end - table.start;
    if (span % 2 !== 0) {
      warnings?.push({ type: "oddJumptable", address: table.start, bytes: span });
    }

    // Read 16-bit addresses (little-endian) from the table
    for (let addr = table.start; addr + 1 < table.end; addr += 2) {
      const lo = reader.readByte(addr);
      const hi = reader.readByte(addr + 1);
      if (lo !== undefined && hi !== undefined) {
        const target = lo | (hi << 8);
        entries.push(target);
        // A table entry refers to its target as surely as a JMP does, and this
        // is the only kind of reference not written as an instruction. Without
        // it, the pointer a C64 program reaches its own entry point through is
        // invisible to `find_references`, which then reports no callers for the
        // one address everything starts from.
        if (references) addReference(references, target, "jump", addr);
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
  const contested: number[] = [];
  const regions = options.regions;

  // Build initial queue from explicit entry points plus jumptable entries
  const queue: number[] = [...options.entryPoints];
  if (regions) {
    const jumptableEntries = extractJumptableEntries(reader, regions, warnings, references);
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

    // Flow arrived somewhere declared not to be code. Stop, and say so.
    //
    // Resuming after the region was tried and is wrong: it assumes execution
    // passes through the bytes, which is true of NOP filler and false of the
    // lookup table it would also apply to. On the reference project it decoded
    // a routine that nothing reaches, purely because a routine is what usually
    // follows a table — a correct-looking answer from a false premise, which is
    // the worst kind to produce silently.
    //
    // The disagreement itself is the useful thing, and it has more than two
    // explanations: the region may be mislabelled, the decode leading here may
    // be wrong, or the program may genuinely do something a static walk cannot
    // follow — a computed jump, self-modifying code, or a plain bug in a
    // forty-year-old binary. Naming the address is what lets someone settle
    // which. Claiming to know is not this warning's job.
    if (!shouldDisassemble(regions, address)) {
      const kind = regions?.getKindAt(address);
      if (kind) warnings.push({ type: "flowIntoData", address, kind });
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
      // Kept, to be followed as its own stream once this walk is done. Decoding
      // it here would fight the instruction already claiming those bytes.
      contested.push(address);
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

    // Queue targets for further disassembly.
    //
    // Not filtered by region here: the loop decides what to do with an address
    // that is not code, and it now continues past it rather than dropping it.
    // Filtering in both places meant a fall-through into data never reached the
    // one that knew how to carry on.
    const targets = getTargets(instr);
    for (const target of targets) {
      if (!visited.has(target)) queue.push(target);
    }
  }

  return {
    instructions,
    warnings,
    references,
    shadows: followContested(reader, regions, instructions, contested),
  };
}

/**
 * How far an alternate reading is followed before giving up.
 *
 * A second stream normally rejoins the first within a handful of instructions —
 * that is what makes the trick usable, since the program has to carry on
 * afterwards.
 * A stream that does not rejoin is either a long deliberate alternate path or a
 * decode wandering through data, and neither is worth chasing indefinitely.
 */
const SHADOW_LIMIT = 64;

/** At most this many alternate readings, so a pathological binary cannot fork forever. */
const SHADOW_STREAMS = 32;

/**
 * Follow each contested address as its own decode.
 *
 * Its own occupancy, so it is not blocked by the instructions it overlaps, and
 * stopping where it rejoins the main reading — which is the natural end, since
 * a byte read two ways converges again as soon as both agree on where an
 * instruction starts.
 *
 * References are deliberately not collected from these. A speculative reading's
 * idea of what refers to what would be mixed into the reference graph with no
 * way to tell it apart, and being wrong there is worse than being silent.
 */
function followContested(
  reader: ByteReader,
  regions: RegionLookup | undefined,
  main: ReadonlyMap<number, Instruction>,
  contested: readonly number[]
): ShadowStream[] {
  const streams: ShadowStream[] = [];

  for (const seed of contested.slice(0, SHADOW_STREAMS)) {
    const own = new Occupancy();
    const found = new Map<number, Instruction>();
    const seen = new Set<number>();
    const queue = [seed];

    while (queue.length > 0 && found.size < SHADOW_LIMIT) {
      const address = queue.shift()!;
      if (seen.has(address)) continue;
      seen.add(address);

      if (!shouldDisassemble(regions, address)) continue;
      if (own.covering(address) !== undefined) continue;
      // Rejoined the main reading: both now agree an instruction starts here,
      // so there is nothing further that is alternate about this path.
      if (found.size > 0 && main.has(address)) continue;

      const decoded = decode(reader, address);
      if (!decoded.ok) continue;

      const instr = decoded.instruction;
      found.set(address, instr);
      own.claim(address, instr.bytes.length);

      for (const target of getTargets(instr)) {
        if (!seen.has(target)) queue.push(target);
      }
    }

    if (found.size > 0) streams.push({ from: seed, instructions: found });
  }

  return streams;
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
