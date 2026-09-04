/**
 * Derive the KERNAL's effects from a ROM, so projects that have no ROM can use
 * them.
 *
 * re64 has always shipped *names* for the KERNAL's documented entry points. This
 * ships what each one **does** — which registers and memory it reads and writes
 * — computed by re64's own analysis rather than transcribed from a book, so a
 * program calling `JSR $FFD2` can be understood by somebody who does not own the
 * ROM and cannot legally be given one.
 *
 * Three steps, and the first is the one that makes the rest possible:
 *
 * 1. **Run `RESTOR` out of the ROM** to learn the machine's own default vectors.
 *    Fifteen documented entry points are a `JMP` through a cell in RAM, which is
 *    how they are hooked and therefore correct rather than a failure — but it
 *    means their behaviour is not in the ROM alone. `RESTOR` installs them, and
 *    `RESTOR` is in the ROM, so the defaults are something to be *executed* for
 *    rather than assumed.
 * 2. **Decode from the jump table**, adding whatever the indirect jumps resolve
 *    to. The walk still refuses to follow one on its own — a vector holds
 *    whatever the program last wrote there — so this declares them, which is the
 *    same judgement a person makes with `mark_function`. Here it is sound
 *    because step 1 just watched the machine install them.
 * 3. **Analyse**, and record `total`: what calling it touches, including its
 *    callees. The ROM has no routine that abandons its call chain, so the
 *    bounded scope would give the same answer.
 *
 * Run with `npm run gen:kernal`. The ROM is not in this repository and never
 * will be; see `3party/roms/README.md` for what to put there.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { BytesLayer } from "../core/memory/layer.js";
import { Varnode } from "../core/il/pcode.js";
import { MemoryMap } from "../core/memory/memory-map.js";
import { runProgram } from "../core/il/program.js";
import { InstructionIndex, disassemble } from "../core/arch/mos6502/disassembler.js";
import { buildBlocks } from "../core/analysis/blocks.js";
import { analyzeRoutines } from "../core/analysis/routines.js";
import { C64_SYMBOLS } from "../core/c64/symbols.js";
import { REGISTER_NAMES } from "../core/il/run.js";

const ROM = process.argv[2] ?? "3party/roms/kernal.901227-03.bin";
const OUT = "src/core/c64/kernal-effects.ts";

/** The documented jump table: $FF81 to $FFF3, three bytes each. */
const TABLE: number[] = [];
for (let at = 0xff81; at <= 0xfff3; at += 3) TABLE.push(at);

/** $FF8A RESTOR, which installs the default vectors into $0314-$0333. */
const RESTOR = 0xff8a;
const VECTORS = 0x0314;

const rom = new Uint8Array(readFileSync(ROM));
const kernalLayer = () => new BytesLayer("kernal", 0xe000, rom);

// 1. Watch the machine install its own vectors.
const boot = new MemoryMap();
boot.addLayer(kernalLayer());
const restored = runProgram(boot, { from: RESTOR, maxInstructions: 100_000 });
if (restored.reason !== "left the program") {
  throw new Error(`RESTOR did not finish on its own: ${restored.reason}`);
}
const installed = new Uint8Array(32);
for (let i = 0; i < installed.length; i++) installed[i] = restored.memory[VECTORS + i] ?? 0;

const map = new MemoryMap();
map.addLayer(kernalLayer());
map.addLayer(new BytesLayer("vectors", VECTORS, installed));

// 2. Declare what the indirect jumps reach, which the walk will not assume.
const vectoredBy = new Map<number, { pointer: number; target: number }>();
let entryPoints = [...TABLE];
for (let pass = 0; pass < 4; pass++) {
  const { warnings } = disassemble(map, { entryPoints });
  const before = entryPoints.length;
  for (const warning of warnings) {
    if (warning.type !== "indirectJump" || warning.target === undefined) continue;
    vectoredBy.set(warning.address, { pointer: warning.pointer, target: warning.target });
    if (!entryPoints.includes(warning.target)) entryPoints.push(warning.target);
  }
  if (entryPoints.length === before) break;
}

// 3. Analyse.
const result = disassemble(map, { entryPoints });
const blocks = buildBlocks(new InstructionIndex(result.instructions), entryPoints);
const routines = analyzeRoutines(blocks, entryPoints);
const named = new Map(C64_SYMBOLS.map((s) => [s.address, s.name]));

interface Row {
  address: number;
  name: string;
  vector?: { pointer: number; defaultImpl: number };
  registers: string[];
  memory: number[];
  ownRegisters: string[];
  ownMemory: number[];
  flags: string[];
  incomplete: string[];
}

const rows: Row[] = [];
for (const address of TABLE) {
  const vectored = vectoredBy.get(address);
  // A vectored entry's own routine is the three-byte jump. What it *does* is
  // whatever the vector points at, so this reports the default implementation
  // and says so — the caller may have hooked it, and that is not ours to guess.
  const subject = vectored ? vectored.target : address;
  const routine = routines.get(subject);
  if (!routine) continue;

  const cells = (effects: { reads: Varnode[]; writes: Varnode[] }) =>
    [...new Set([...effects.reads, ...effects.writes].filter((v) => v.space === "ram").map((v) => v.offset))]
      .sort((a, b) => a - b);
  const regs = (effects: { reads: Varnode[]; writes: Varnode[] }) =>
    [...new Set(
      [...effects.reads, ...effects.writes]
        .filter((v) => v.space === "register")
        .map((v) => REGISTER_NAMES[v.offset] ?? String(v.offset))
    )].sort();

  const memory = cells(routine.total);
  const registers = regs(routine.total);
  // The same routine without entering its callees.
  //
  // Both are shipped because neither is the answer on its own, and CHROUT shows
  // why: it dispatches on the current output device, so `total` unions the
  // screen editor, the serial bus, the tape system and the RS-232 code into 90
  // cells — sound, and no use to somebody asking what printing a character
  // does. `own` is the dispatch itself and is too narrow. Reporting one and
  // hiding the other would dress a limitation as an answer.
  const ownMemory = cells(routine.own);
  const ownRegisters = regs(routine.own);
  const incomplete = [...routine.incomplete];
  if (routine.total.readsComputedMemory || routine.total.writesComputedMemory) {
    incomplete.push("touches memory at an address that depends on a register, so the list of cells is short");
  }

  rows.push({
    address,
    name: named.get(address) ?? `KERNAL_${address.toString(16).toUpperCase()}`,
    ...(vectored ? { vector: { pointer: vectored.pointer, defaultImpl: vectored.target } } : {}),
    registers,
    memory,
    ownRegisters,
    ownMemory,
    flags: routine.total.flags.map((f) => REGISTER_NAMES[f] ?? String(f)).sort(),
    incomplete,
  });
}

const hex = (n: number) => `0x${n.toString(16).padStart(4, "0")}`;
const list = (xs: string[]) => `[${xs.map((x) => `"${x}"`).join(", ")}]`;
const addresses = (xs: number[]) => (xs.length === 0 ? "[]" : `[${xs.map(hex).join(", ")}]`);

const body = rows
  .map((r) => {
    const parts = [
      `    address: ${hex(r.address)},`,
      `    name: "${r.name}",`,
      ...(r.vector
        ? [`    vector: { pointer: ${hex(r.vector.pointer)}, defaultImpl: ${hex(r.vector.defaultImpl)} },`]
        : []),
      `    registers: ${list(r.registers)},`,
      `    memory: ${addresses(r.memory)},`,
      `    ownRegisters: ${list(r.ownRegisters)},`,
      `    ownMemory: ${addresses(r.ownMemory)},`,
      `    flags: ${list(r.flags)},`,
      ...(r.incomplete.length > 0
        ? [`    incomplete: [\n${r.incomplete.map((i) => `      ${JSON.stringify(i)},`).join("\n")}\n    ],`]
        : []),
    ];
    return `  {\n${parts.join("\n")}\n  },`;
  })
  .join("\n");

const vectoredCount = rows.filter((r) => r.vector).length;
const source = `/**
 * What each documented KERNAL entry point touches.
 *
 * **Generated — do not edit.** \`npm run gen:kernal\` derives this from a ROM,
 * which is not in this repository; \`src/tools/gen-kernal-effects.ts\` explains
 * how, and \`3party/roms/README.md\` says which file to supply.
 *
 * re64 has always shipped *names* for these addresses. This is what they **do**,
 * computed by re64's own lifter and call-graph analysis rather than transcribed
 * from a book — so a program calling \`JSR $FFD2\` can be understood by somebody
 * who does not own the ROM.
 *
 * ${vectoredCount} of these are a \`JMP\` through a cell in RAM. That is how they are hooked,
 * so what is recorded is the **default** implementation — the one the machine
 * installs for itself, learned by running \`RESTOR\` out of the ROM rather than
 * by assuming it. A program that hooks the vector does something else, and
 * \`vector\` is there so a reader can see that the question arises.
 *
 * May, never must: these are unions over every path, so an entry point lists
 * what it *can* touch. \`incomplete\` says where a list is short and why.
 */

export interface KernalEffects {
  address: number;
  name: string;
  /** Present when the entry point jumps through RAM, which a program may hook. */
  vector?: { pointer: number; defaultImpl: number };
  /** Registers and flags it reads or writes, by name, including its callees. */
  registers: string[];
  /** Addresses it reads or writes, including its callees, where the address is statically known. */
  memory: number[];
  /**
   * The same two without entering anything it calls.
   *
   * Both are here because neither answers on its own. \`CHROUT\` dispatches on
   * the current output device, so the full union covers the screen editor, the
   * serial bus, the tape system and the RS-232 code at once — sound, and no use
   * to somebody asking what printing a character does. The narrow pair is the
   * dispatch itself. The honest thing is to show both and say why.
   */
  ownRegisters: string[];
  ownMemory: number[];
  /** Processor flags it writes. */
  flags: string[];
  /** Why the lists above may be short. */
  incomplete?: string[];
}

export const KERNAL_EFFECTS: readonly KernalEffects[] = [
${body}
];
`;

writeFileSync(OUT, source);
console.log(
  `${OUT}: ${rows.length} entry points (${vectoredCount} vectored), ` +
    `from ${result.instructions.size} instructions in ${routines.size} routines`
);
