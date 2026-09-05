import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { analyzeProgram } from "../analysis/program.js";
import { loadProjectFile } from "../../node-files.js";

/**
 * The human disassembly as an oracle for the decode.
 *
 * `gridrunner.asm` is 65KB of somebody's reverse engineering, and its
 * auto-generated labels encode the address they sit at — `b8D1A` is a branch
 * target at $8D1A. So every one of them is an address a person's disassembler
 * decided was the start of an instruction, which is exactly the claim this
 * project's walk makes independently.
 *
 * Agreement is not proof: both could be wrong the same way, and the human's
 * listing was itself produced by a tool. Disagreement is the useful direction —
 * an address the reference treats as an instruction start and re64 does not is
 * either a decode this analysis is missing or an annotation that is wrong.
 */
const ORACLE = "assets/gridrunner/gridrunner.asm";
const PROJECT = "assets/gridrunner/gridrunner.re64";

/**
 * Addresses the reference names as instruction starts.
 *
 * Two exclusions, and the second is the interesting one:
 *
 * - A `.BYTE` line is data. `p0800` is the BASIC stub.
 * - An `=*+$01` equate names an address *inside* an instruction, which is what
 *   an assembler makes you do when a label cannot be placed inline. The
 *   reference needs it exactly twice in 65KB — `b8737` is the operand byte of
 *   `BNE` at $8736, and `b8D5A` the operand byte of `STA` at $8D59 — so these
 *   are the human agreeing that the address is mid-instruction, not disagreeing
 *   about where instructions start.
 */
function oracleCodeAddresses(): { code: number[]; insideInstruction: number[] } {
  const text = readFileSync(ORACLE, "utf8");
  const code = new Set<number>();
  const insideInstruction = new Set<number>();
  for (const line of text.split("\n")) {
    const match = /^([a-z])([0-9A-F]{4})\s+(.*)$/.exec(line);
    if (!match) continue;
    const address = parseInt(match[2], 16);
    // Zero page labels are variables, not instruction starts.
    if (address < 0x0200) continue;
    const rest = match[3].trim();
    if (rest.startsWith(".BYTE")) continue;
    if (rest.startsWith("=*+")) insideInstruction.add(address);
    else code.add(address);
  }
  return {
    code: [...code].sort((a, b) => a - b),
    insideInstruction: [...insideInstruction].sort((a, b) => a - b),
  };
}

describe("against the human disassembly", () => {
  it("decodes every address the reference calls an instruction start", () => {
    const program = analyzeProgram(loadProjectFile(PROJECT));
    const { code, insideInstruction } = oracleCodeAddresses();
    const missing = code.filter((a) => !program.instructions.has(a));

    // eslint-disable-next-line no-console
    console.log(
      `oracle instruction starts: ${code.length}, decoded by re64: ${code.length - missing.length}` +
      (missing.length ? `, missing: ${missing.map((a) => "$" + a.toString(16)).join(" ")}` : "")
    );

    // $8D1A and $8D24 were missing before a claim lost its veto over an explicit
    // transfer — both inside `PlayNewLevelSounds`, which a two-byte region
    // overrun had been deleting. The oracle is what says they were real.
    expect(missing).toEqual([]);
  });

  it("agrees about the two addresses that are inside an instruction", () => {
    const program = analyzeProgram(loadProjectFile(PROJECT));
    const { insideInstruction } = oracleCodeAddresses();

    // The human reached for an equate because an assembler cannot put a label
    // mid-instruction. re64 has the same gap from the other side: `add_label`
    // there succeeds, the name resolves in operands, and the listing shows no
    // row. This is the measurement of how much that gap costs — twice in 65KB —
    // and the equate is a rendering that is known to work.
    expect(insideInstruction).toEqual([0x8737, 0x8d5a]);
    for (const address of insideInstruction) {
      expect(program.instructions.has(address)).toBe(false);
      // Each is the operand byte of the instruction that starts just before it.
      const owner = program.instructions.get(address - 1)!;
      expect(owner).toBeDefined();
      expect(owner.bytes.length).toBe(2);
    }
  });
});
