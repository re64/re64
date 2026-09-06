/**
 * Derive what BASIC's keyword routines do, so projects that have no ROM can
 * know.
 *
 * The same idea as `kernal-effects-source.ts` and one step further, because
 * re64 ships no *names* for this ROM at all: `C64_SYMBOLS` covers the KERNAL and
 * the hardware and has nothing in `$A000-$BFFF`. So the names are taken from the
 * machine too.
 *
 * **BASIC carries its own keyword table**, at `$A09E`: 76 entries in PETSCII
 * with the high bit set on each last character, in token order. Two dispatch
 * tables sit beside it in exactly that order, so pairing them names every
 * routine without transcribing anything:
 *
 * - `$A00C` — 35 statements, `END` through `NEW`, **stored as target − 1**
 *   because BASIC dispatches by pushing the address and executing `RTS`. That
 *   is the idiom this project's catalogue already records, met here in the
 *   place it was invented for.
 * - `$A052` — 23 functions, `SGN` through `MID$`, stored plainly.
 *
 * The seven keywords between them (`TAB(`, `TO`, `FN`, `SPC(`, `THEN`, `NOT`,
 * `STEP`) and the ten operators are syntax rather than routines and dispatch
 * through neither table, which is why 58 of 76 keywords get a row.
 *
 * **The KERNAL is loaded alongside**, and not only because BASIC calls it: *the
 * dispatch tables point into it*. Eleven keywords — `RND`, `SYS`, `SAVE`,
 * `VERIFY`, `LOAD`, `OPEN`, `CLOSE` and the four trig functions — are
 * implemented at `$E000-$E4FF`, in the KERNAL chip, because BASIC's code
 * outgrew the BASIC ROM. Without the second ROM those eleven would decode as
 * nothing and report touching nothing, which reads exactly like a routine with
 * no effects — the failure this project has already been caught by once, when
 * `canTouch` assumed an unseen callee touched nothing and turned an omission
 * into what looked like a proof.
 *
 * Run with `npm run gen:basic`. Neither ROM is in this repository and neither
 * ever will be; see `3party/roms/README.md` for what to put there.
 */

import { readFileSync } from "node:fs";
import { BytesLayer } from "../core/memory/layer.js";
import { Varnode } from "../core/il/pcode.js";
import { MemoryMap } from "../core/memory/memory-map.js";
import { InstructionIndex, disassemble } from "../core/arch/mos6502/disassembler.js";
import { buildBlocks } from "../core/analysis/blocks.js";
import { analyzeRoutines, describeGap } from "../core/analysis/routines.js";
import { REGISTER_NAMES } from "../core/il/run.js";

/** Where each table lives, and how many entries it has. */
const KEYWORDS = 0xa09e;
const STATEMENTS = { at: 0xa00c, count: 35, first: 0 };
const FUNCTIONS = { at: 0xa052, count: 23, first: 52 };

export interface BasicRow {
  address: number;
  name: string;
  keyword: string;
  kind: "statement" | "function";
  /** Present when the routine is reached through a cell in RAM, as `USR` is. */
  vector?: number;
  registers: string[];
  memory: number[];
  ownRegisters: string[];
  ownMemory: number[];
  flags: string[];
  incomplete: string[];
}

/**
 * BASIC's own keyword list, in token order.
 *
 * PETSCII with bit 7 marking the last character of each word, terminated by a
 * zero byte — which is the encoding BASIC's tokeniser reads, so this is the
 * machine's own answer rather than a list somebody typed.
 */
export function basicKeywords(rom: Uint8Array): string[] {
  const words: string[] = [];
  let word = "";
  for (let i = KEYWORDS - 0xa000; i < rom.length && rom[i] !== 0; i++) {
    word += String.fromCharCode(rom[i] & 0x7f);
    if (rom[i] & 0x80) {
      words.push(word);
      word = "";
    }
  }
  return words;
}

/**
 * A name a listing can carry, from a keyword that may hold punctuation.
 *
 * The punctuation has to survive as *something*, or `PRINT#` and `PRINT` become
 * one name — which is the collision this project refuses everywhere else, since
 * a name that reaches two addresses makes `name+4` identify nothing. `#` is
 * BASIC's file suffix and `$` its string suffix, so both are spelled out rather
 * than dropped.
 */
function identifier(keyword: string): string {
  const cleaned = keyword
    .replace(/\$/g, "Str")
    .replace(/#/g, "File")
    .replace(/[^A-Za-z0-9]/g, "");
  return `BASIC_${cleaned || "OP"}`;
}

export function generateBasicEffects(
  basicPath: string,
  kernalPath: string
): {
  source: string;
  rows: number;
  routines: number;
  instructions: number;
  clobbers: number;
} {
  const basic = new Uint8Array(readFileSync(basicPath));
  const kernal = new Uint8Array(readFileSync(kernalPath));
  const keywords = basicKeywords(basic);

  const word = (offset: number) => basic[offset] | (basic[offset + 1] << 8);

  const entries: { address: number; keyword: string; kind: "statement" | "function" }[] = [];
  for (let n = 0; n < STATEMENTS.count; n++) {
    // `+ 1` because the table holds target − 1: BASIC pushes it and returns
    // into the routine, which is the RTS-dispatch idiom.
    entries.push({
      address: word(STATEMENTS.at - 0xa000 + 2 * n) + 1,
      keyword: keywords[STATEMENTS.first + n],
      kind: "statement",
    });
  }
  for (let n = 0; n < FUNCTIONS.count; n++) {
    entries.push({
      address: word(FUNCTIONS.at - 0xa000 + 2 * n),
      keyword: keywords[FUNCTIONS.first + n],
      kind: "function",
    });
  }

  const map = new MemoryMap();
  map.addLayer(new BytesLayer("basic", 0xa000, basic));
  map.addLayer(new BytesLayer("kernal", 0xe000, kernal));

  // Only the entries that are actually in the ROM. `USR` dispatches through
  // `$0310`, a RAM cell BASIC's own initialisation fills, so its table entry
  // points outside both ROMs — reported rather than analysed, because what it
  // reaches depends on a program that has not run.
  const inRom = entries.filter((e) => e.address >= 0xa000);
  const vectored = entries.filter((e) => e.address < 0xa000);

  const entryPoints = inRom.map((e) => e.address);
  const result = disassemble(map, { entryPoints });
  const blocks = buildBlocks(new InstructionIndex(result.instructions), entryPoints);
  const routines = analyzeRoutines(blocks, entryPoints);

  const cells = (e: { reads: Varnode[]; writes: Varnode[] }) =>
    [...new Set([...e.reads, ...e.writes].filter((v) => v.space === "ram").map((v) => v.offset))]
      .sort((a, b) => a - b);
  const regs = (e: { reads: Varnode[]; writes: Varnode[] }) =>
    [
      ...new Set(
        [...e.reads, ...e.writes]
          .filter((v) => v.space === "register")
          .map((v) => REGISTER_NAMES[v.offset] ?? String(v.offset))
      ),
    ].sort();

  const rows: BasicRow[] = [];
  for (const entry of [...inRom, ...vectored]) {
    const routine = routines.get(entry.address);
    const incomplete: string[] = [];
    if (!routine) {
      // A vectored entry, or one the walk could not reach. Said rather than
      // dropped: an absent row is indistinguishable from a routine that touches
      // nothing, which is the confident wrong answer this project refuses.
      rows.push({
        address: entry.address,
        name: identifier(entry.keyword),
        keyword: entry.keyword,
        kind: entry.kind,
        ...(entry.address < 0xa000 ? { vector: entry.address } : {}),
        registers: [],
        memory: [],
        ownRegisters: [],
        ownMemory: [],
        flags: [],
        incomplete: [
          entry.address < 0xa000
            ? "dispatches through a cell in RAM that BASIC's own initialisation fills, so what it reaches is not in either ROM"
            : "the walk did not reach this address",
        ],
      });
      continue;
    }

    incomplete.push(...routine.incomplete.map(describeGap));
    if (routine.total.readsComputedMemory || routine.total.writesComputedMemory) {
      incomplete.push(
        "touches memory at an address that depends on a register, so the list of cells is short"
      );
    }

    rows.push({
      address: entry.address,
      name: identifier(entry.keyword),
      keyword: entry.keyword,
      kind: entry.kind,
      registers: regs(routine.total),
      memory: cells(routine.total),
      ownRegisters: regs(routine.own),
      ownMemory: cells(routine.own),
      flags: routine.total.flags.map((f) => REGISTER_NAMES[f] ?? String(f)).sort(),
      incomplete,
    });
  }

  // What calling *any* routine in either ROM writes, not only the 58 keywords.
  //
  // The reason the KERNAL table has the same section: a program calls ROM
  // internals directly, and games lean on BASIC's floating-point routines
  // constantly without going near a keyword entry point. One unanswered call
  // loses a proof for everything after it, so partial coverage is worth little.
  //
  // Only where the answer is complete. A routine with an unmodelled instruction
  // or an undecoded callee has a clobber set short by an unknown amount, and an
  // under-approximation here would be *believed* — omitting it means "unknown",
  // which the consumer turns back into "assume anything".
  const clobbers = [...routines.entries()]
    .filter(([, routine]) => routine.incomplete.length === 0)
    .map(([address, routine]) => ({
      address,
      writes: [
        ...new Set(
          routine.total.writes
            .filter((v) => v.space === "register")
            // `REGISTER_NAMES` has no entry for PC, so it drops out here; SP is
            // named and excluded deliberately, since every JSR and RTS moves it.
            .map((v) => REGISTER_NAMES[v.offset] as string | undefined)
            .filter((name): name is string => name !== undefined && name !== "SP")
        ),
      ].sort(),
    }))
    .filter((c) => c.writes.length > 0)
    .sort((a, b) => a.address - b.address);

  rows.sort((a, b) => a.address - b.address);

  // Every name identifies exactly one routine. Asserted rather than hoped,
  // because it is a property of *this ROM's* keyword list and a different
  // revision could break it — and because the first version of `identifier`
  // dropped punctuation and silently gave `PRINT#` and `PRINT` one name.
  const byName = new Map<string, number[]>();
  for (const row of rows) {
    const held = byName.get(row.name);
    if (held) held.push(row.address);
    else byName.set(row.name, [row.address]);
  }
  const shared = [...byName].filter(([, at]) => at.length > 1);
  if (shared.length > 0) {
    throw new Error(
      `These names reach more than one address: ` +
        shared
          .map(([name, at]) => `${name} (${at.map((a) => `$${a.toString(16)}`).join(", ")})`)
          .join("; ")
    );
  }

  const list = (v: readonly string[]) => `[${v.map((x) => JSON.stringify(x)).join(", ")}]`;
  const addresses = (v: readonly number[]) =>
    `[${v.map((a) => `0x${a.toString(16).padStart(4, "0")}`).join(", ")}]`;

  const body = rows
    .map((r) => {
      const parts = [
        `    address: 0x${r.address.toString(16).padStart(4, "0")},`,
        `    name: ${JSON.stringify(r.name)},`,
        `    keyword: ${JSON.stringify(r.keyword)},`,
        `    kind: ${JSON.stringify(r.kind)},`,
        ...(r.vector !== undefined ? [`    vector: 0x${r.vector.toString(16).padStart(4, "0")},`] : []),
        `    registers: ${list(r.registers)},`,
        `    memory: ${addresses(r.memory)},`,
        `    ownRegisters: ${list(r.ownRegisters)},`,
        `    ownMemory: ${addresses(r.ownMemory)},`,
        `    flags: ${list(r.flags)},`,
        ...(r.incomplete.length > 0
          ? [
              `    incomplete: [\n${r.incomplete
                .map((i) => `      ${JSON.stringify(i)},`)
                .join("\n")}\n    ],`,
            ]
          : []),
      ];
      return `  {\n${parts.join("\n")}\n  },`;
    })
    .join("\n");

  const source = `/**
 * What each of BASIC's keyword routines touches, and what to call it.
 *
 * **Generated — do not edit.** \`npm run gen:basic\` derives this from the BASIC
 * and KERNAL ROMs, neither of which is in this repository;
 * \`src/tools/gen-basic-effects.ts\` explains how, and \`3party/roms/README.md\`
 * says which files to supply.
 *
 * **The names come from the machine.** re64 ships no symbols for \`$A000-$BFFF\`,
 * so rather than transcribe a list, this reads BASIC's own keyword table at
 * \`$A09E\` and pairs it with the dispatch tables beside it — \`$A00C\` for the ${STATEMENTS.count}
 * statements, stored as target − 1 because BASIC dispatches by pushing the
 * address and executing \`RTS\`, and \`$A052\` for the ${FUNCTIONS.count} functions, stored plainly.
 * The keywords between them are syntax rather than routines, which is why ${rows.length}
 * of ${keywords.length} keywords have a row.
 *
 * The KERNAL is analysed alongside, because BASIC calls it constantly and a
 * call into an absent ROM would silently shorten every list here.
 *
 * May, never must: these are unions over every path, so a routine lists what it
 * *can* touch. \`incomplete\` says where a list is short and why.
 */

export interface BasicEffects {
  address: number;
  /** Derived from the keyword, so it is a name a listing can carry. */
  name: string;
  /** The keyword itself, as BASIC spells it. */
  keyword: string;
  kind: "statement" | "function";
  /** Present when the routine is reached through RAM, as \`USR\` is. */
  vector?: number;
  /** Registers and flags it reads or writes, by name, including its callees. */
  registers: string[];
  /** Addresses it reads or writes, where the address is statically known. */
  memory: number[];
  /** The same two without entering anything it calls. */
  ownRegisters: string[];
  ownMemory: number[];
  /** Processor flags it writes. */
  flags: string[];
  /** Why the lists above may be short. */
  incomplete?: string[];
}

export const BASIC_EFFECTS: readonly BasicEffects[] = [
${body}
];

/** A BASIC keyword routine by the address a program would call. */
export function basicEffectsAt(address: number): BasicEffects | undefined {
  return BASIC_EFFECTS.find((e) => e.address === address);
}

/**
 * What calling any routine in these ROMs can write, by address.
 *
 * A different question from \`BASIC_EFFECTS\` and a different shape for it. That
 * one answers "what does PRINT do" for somebody reading; this answers "what do
 * I lose by calling this" for an analysis, and it has to cover whatever address
 * the program actually called rather than only the keyword entry points —
 * games lean on BASIC's floating-point routines without going near one.
 *
 * Registers and flags only. An absent address means the table cannot say, which
 * a caller must read as "assume anything": an under-approximation here would be
 * believed, so a routine whose analysis is incomplete is left out rather than
 * reported short.
 *
 * No preservation column, unlike the KERNAL's. That one earns its place because
 * every write to \`D\` in the KERNAL is a \`PLP\` restoring a byte the routine
 * pushed itself, so without subtracting what is given back nearly every call
 * looks destructive. Whether the same holds here has not been measured, and
 * shipping an unmeasured column would be the confident wrong answer.
 */
export const BASIC_CLOBBERS: readonly { address: number; writes: string[] }[] = [
${clobbers
  .map(
    (c) =>
      `  { address: 0x${c.address.toString(16).padStart(4, "0")}, writes: ${list(c.writes)} },`
  )
  .join("\n")}
];
`;

  return {
    source,
    rows: rows.length,
    routines: routines.size,
    instructions: result.instructions.size,
    clobbers: clobbers.length,
  };
}
