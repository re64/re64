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

  it("stops at a tail jump and records where it went", () => {
    // $1000: JMP $1010   $1010: LDA #$01 / STA $30 / RTS
    //
    // The routine ends at the JMP. Following through was the first attempt and
    // it made attribution useless: on a program whose top level is a JMP chain
    // one routine absorbed a quarter of the code, and every SID write in the
    // game reported as being in the same place.
    const bytes = [0x4c, 0x10, 0x10, ...new Array(13).fill(0xea), 0xa9, 0x01, 0x85, 0x30, 0x60];
    const { routines: r } = routines(bytes);
    const found = r.get(ORG)!;

    expect(found.continuesInto).toEqual([0x1010]);
    // Its own code does not include the target...
    expect(names(found.own.writes)).not.toContain("$(0x30)");
    // ...but what it *does* still accounts for it, exactly as a call would.
    expect(names(found.total.writes)).toContain("$(0x30)");
  });

  it("makes the target of a jump a routine of its own", () => {
    // The symmetric half: if a jump leaves the routine it was in, the code it
    // lands on has to belong to something, or a JMP chain is a program in which
    // no address is in any routine.
    const bytes = [0x4c, 0x10, 0x10, ...new Array(13).fill(0xea), 0xa9, 0x01, 0x85, 0x30, 0x60];
    const { routines: r } = routines(bytes);
    expect(r.has(0x1010)).toBe(true);
    expect(names(r.get(0x1010)!.own.writes)).toContain("$(0x30)");
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

describe("how a routine leaves", () => {
  it("says nothing about an ordinary return", () => {
    const { routines: r } = routines([0xa9, 0x01, 0x60]); // LDA #$01 / RTS
    expect(r.get(ORG)!.returns).toEqual([]);
  });

  it("does not flag a balanced interrupt handler", () => {
    // PHA TXA PHA / ... / PLA TAX PLA RTI — saves and restores, then returns.
    // The *returning block* alone is three bytes short and looks broken, which
    // is why the depth has to be accumulated from the entry rather than read
    // off that block: judging blocks in isolation reports every handler in
    // every program as anomalous.
    const { routines: r } = routines([0x48, 0x8a, 0x48, 0x68, 0xaa, 0x68, 0x40]);
    expect(r.get(ORG)!.returns).toEqual([]);
  });

  it("counts RTI as popping three bytes, not two", () => {
    // An interrupt pushes the status byte as well as the address, so a bare RTI
    // is balanced and must not be flagged. If this treated RTI like RTS it
    // would come out one byte short and complain — which is exactly what it did
    // for every handler before the expected depth was made to depend on the
    // return instruction.
    const { routines: r } = routines([0x40]);
    expect(r.get(ORG)!.returns).toEqual([]);
  });

  it("works out that popping an extra address returns past the caller", () => {
    // PLA PLA RTS — Gridrunner does this at $87FE. The stack delta already
    // determined it; it used to be reported as an open question.
    const { routines: r } = routines([0x68, 0x68, 0x60]);
    const found = r.get(ORG)!;
    expect(found.skipsFrames).toBe(true);
    expect(found.returns[0]).toMatchObject({ skipsFrames: 1 });
    expect(found.returns[0].why).toContain("caller's caller");
  });

  it("counts two extra frames as two", () => {
    const { routines: r } = routines([0x68, 0x68, 0x68, 0x68, 0x60]);
    expect(r.get(ORG)!.returns[0]).toMatchObject({ skipsFrames: 2 });
  });

  it("treats setting the stack pointer as abandoning the chain, not as unknown", () => {
    // LDX #$F6 / TXS / RTS. Gridrunner resets the stack this way when it
    // restarts. "Depth unknown" is true and useless next to what it means.
    const { routines: r } = routines([0xa2, 0xf6, 0x9a, 0x60]);
    expect(r.get(ORG)!.returns[0].why).toContain("abandoning");
  });

  it("warns a caller that it will not get control back", () => {
    // $1000: JSR $1004 / RTS      $1004: PLA PLA RTS
    const { routines: r } = routines([0x20, 0x04, 0x10, 0x60, 0x68, 0x68, 0x60]);
    expect(r.get(ORG)!.incomplete.join(" ")).toMatch(/returns past whoever called it/);
  });
});
