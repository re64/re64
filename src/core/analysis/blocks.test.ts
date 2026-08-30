import { describe, it, expect } from "vitest";
import { blockAt, buildBlocks, overlappingBlocks } from "./blocks.js";
import { InstructionIndex, disassemble } from "../arch/mos6502/disassembler.js";
import { MemoryMap } from "../memory/memory-map.js";
import { BytesLayer } from "../memory/layer.js";

const ORG = 0x1000;

/** Decode a literal program, so these tests read as 6502 rather than as fixtures. */
function program(bytes: number[], entryPoints: number[] = [ORG]) {
  const map = new MemoryMap();
  map.addLayer(new BytesLayer("test", ORG, new Uint8Array(bytes)));
  const result = disassemble(map, { entryPoints });
  return {
    index: new InstructionIndex(result.instructions),
    entryPoints,
  };
}

describe("splitting a program into blocks", () => {
  it("keeps a straight run in one block", () => {
    //  LDA #$01 / STA $02 / RTS
    const { index, entryPoints } = program([0xa9, 0x01, 0x85, 0x02, 0x60]);
    const blocks = buildBlocks(index, entryPoints);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ start: 0x1000, end: 0x1005, exit: "ret" });
    expect(blocks[0].instructions).toHaveLength(3);
  });

  it("ends a block at a conditional branch, with both ways out", () => {
    //  LDA #$00 / BEQ +2 / NOP / RTS
    const { index, entryPoints } = program([0xa9, 0x00, 0xf0, 0x01, 0xea, 0x60]);
    const blocks = buildBlocks(index, entryPoints);

    const first = blocks.find((b) => b.start === 0x1000)!;
    expect(first.exit).toBe("branch");
    // The target and the instruction after it.
    expect(first.successors.sort()).toEqual([0x1004, 0x1005]);
  });

  it("splits a straight run where something branches into its middle", () => {
    //  BNE +3 / NOP / NOP / NOP / RTS  — the branch lands mid-run
    const { index, entryPoints } = program([0xd0, 0x03, 0xea, 0xea, 0xea, 0x60]);
    const blocks = buildBlocks(index, entryPoints);

    expect(blocks.map((b) => b.start)).toContain(0x1005);
    // The run before the target is its own block, ending because another begins.
    const middle = blocks.find((b) => b.start === 0x1002)!;
    expect(middle.exit).toBe("fallthrough");
    expect(middle.end).toBe(0x1005);
  });

  it("does not end a block at a call, and records who was called", () => {
    //  JSR $1006 / LDA #$00 / RTS ... target: RTS
    const { index, entryPoints } = program(
      [0x20, 0x06, 0x10, 0xa9, 0x00, 0x60, 0x60],
      [0x1000]
    );
    const blocks = buildBlocks(index, entryPoints);
    const first = blocks.find((b) => b.start === 0x1000)!;

    // A JSR is expected to return, so the run continues past it. Who it called
    // is kept separately, so a routine that never returns does not make every
    // caller's block look like it ends there.
    expect(first.calls).toEqual([0x1006]);
    expect(first.instructions.length).toBeGreaterThan(1);
  });

  it("gives a jump its target and nothing else", () => {
    //  JMP $1000 (to itself)
    const { index, entryPoints } = program([0x4c, 0x00, 0x10]);
    const blocks = buildBlocks(index, entryPoints);

    expect(blocks[0].exit).toBe("jump");
    expect(blocks[0].successors).toEqual([0x1000]);
  });

  it("gives a return no successor here", () => {
    // Where an RTS goes back to is a property of the call, not of this block.
    const { index, entryPoints } = program([0x60]);
    expect(buildBlocks(index, entryPoints)[0].successors).toEqual([]);
  });
});

describe("a byte read two ways", () => {
  // BNE +1 skips the $A9 and lands on its operand, so $1003 is an opcode on one
  // path and an operand on the other. Legitimate 6502; the reference
  // disassembly of Gridrunner does this twice.
  const overlapping = [0xd0, 0x01, 0xa9, 0x60];

  it("cannot see the second reading yet, because the decoder discards it", () => {
    // The blocking finding, pinned so it is not mistaken for working. The walk
    // sees the contested address is already claimed, warns, and skips — so the
    // second decode never exists to be put in a block. Blocks are the right
    // model for overlap and are not sufficient on their own: the decoder has to
    // keep both readings first.
    const { index, entryPoints } = program(overlapping);

    expect(index.has(0x1002)).toBe(true);
    expect(index.has(0x1003)).toBe(false);
    expect(overlappingBlocks(buildBlocks(index, entryPoints))).toEqual([]);
  });

  it("reports an overlap even though it cannot render one", () => {
    const map = new MemoryMap();
    map.addLayer(new BytesLayer("test", ORG, new Uint8Array(overlapping)));
    const result = disassemble(map, { entryPoints: [ORG] });

    expect(result.warnings).toContainEqual({
      type: "overlap",
      address: 0x1003,
      existingAddress: 0x1002,
    });
  });

  it("keeps every block it does build internally consistent", () => {
    // What blocks do give: each run is a real decode of its own bytes, with no
    // gaps and no borrowed instructions.
    const { index, entryPoints } = program(overlapping);
    for (const block of buildBlocks(index, entryPoints)) {
      let at = block.start;
      for (const instr of block.instructions) {
        expect(instr.address).toBe(at);
        at += instr.bytes.length;
      }
      expect(at).toBe(block.end);
    }
  });

  it("finds the block covering an address", () => {
    const { index, entryPoints } = program(overlapping);
    expect(blockAt(buildBlocks(index, entryPoints), 0x1002)).toBeDefined();
  });
});

describe("with nothing decoded", () => {
  it("returns no blocks rather than an empty one", () => {
    expect(buildBlocks(new InstructionIndex(new Map()), [])).toEqual([]);
  });

  it("ignores an entry point that decoded nothing", () => {
    expect(buildBlocks(new InstructionIndex(new Map()), [0x1000])).toEqual([]);
  });
});
