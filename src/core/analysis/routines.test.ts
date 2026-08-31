import { describe, it, expect } from "vitest";
import { analyzeRoutines, routineEntries } from "./routines.js";
import { buildBlocks } from "./blocks.js";
import { InstructionIndex, disassemble } from "../arch/mos6502/disassembler.js";
import { MemoryMap } from "../memory/memory-map.js";
import { BytesLayer } from "../memory/layer.js";
import { formatVarnode } from "../il/pcode.js";

const ORG = 0x1000;

/** Decode a literal program, so these read as 6502 rather than as fixtures. */
function routines(bytes: number[], entries: number[] = [ORG]) {
  const map = new MemoryMap();
  map.addLayer(new BytesLayer("test", ORG, new Uint8Array(bytes)));
  const result = disassemble(map, { entryPoints: entries });
  const blocks = buildBlocks(new InstructionIndex(result.instructions), entries);
  return { blocks, routines: analyzeRoutines(blocks, entries) };
}

const names = (nodes: { space: string; offset: number; size: number }[]) =>
  nodes.map((n) => formatVarnode(n as never));

describe("what a routine touches", () => {
  it("unions its own blocks", () => {
    // LDA #$01 / STA $10 / RTS
    const { routines: r } = routines([0xa9, 0x01, 0x85, 0x10, 0x60]);
    const found = r.get(ORG)!;
    expect(names(found.own.writes)).toEqual(expect.arrayContaining(["A", "$(0x10)"]));
  });

  it("leaves the program counter and stack pointer out", () => {
    // Every JSR and RTS moves both, so reporting them would put the same two
    // entries on the answer for essentially every routine in a program.
    const { routines: r } = routines([0x20, 0x08, 0x80, 0x60, 0xea, 0xea, 0xea, 0xea, 0x60]);
    const shown = names(r.get(ORG)!.total.writes);
    expect(shown).not.toContain("PC");
    expect(shown).not.toContain("SP");
  });

  it("folds in what it calls, and keeps that apart from its own", () => {
    // $8000: JSR $8004 / RTS      $8004: LDA #$07 / STA $20 / RTS
    const { routines: r } = routines(
      [0x20, 0x04, 0x10, 0x60, 0xa9, 0x07, 0x85, 0x20, 0x60],
      [ORG]
    );
    const caller = r.get(ORG)!;
    expect(names(caller.own.writes)).not.toContain("$(0x20)");
    expect(names(caller.total.writes)).toContain("$(0x20)");
    expect(caller.calls).toEqual([0x1004]);
  });

  it("follows a tail jump, so the routine can be in two places", () => {
    // $8000: JMP $8010   $8010: LDA #$01 / STA $30 / RTS
    const bytes = [0x4c, 0x10, 0x10, ...new Array(13).fill(0xea), 0xa9, 0x01, 0x85, 0x30, 0x60];
    const { routines: r } = routines(bytes);
    const found = r.get(ORG)!;
    expect(names(found.own.writes)).toContain("$(0x30)");
    // Two spans: the jump, and the code it lands in. A single declared extent
    // could not have described this.
    expect(found.spans.length).toBeGreaterThan(1);
  });

  it("says when an instruction has no semantics, rather than answering short", () => {
    // $02 is an undocumented opcode.
    const { routines: r } = routines([0xa9, 0x01, 0x02, 0x60]);
    expect(r.get(ORG)!.incomplete.join(" ")).toMatch(/no modelled semantics/);
  });

  it("takes call targets as entries without being told", () => {
    const { blocks } = routines([0x20, 0x04, 0x10, 0x60, 0xa9, 0x07, 0x60]);
    expect(routineEntries(blocks, [ORG])).toContain(0x1004);
  });
});
