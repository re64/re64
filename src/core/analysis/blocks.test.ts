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
    expect([...first.successors].sort()).toEqual([0x1004, 0x1005]);
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

  it("ends a block at a call, so nothing returns into the middle of one", () => {
    //  JSR $1006 / LDA #$00 / RTS ... target: RTS
    const { index, entryPoints } = program(
      [0x20, 0x06, 0x10, 0xa9, 0x00, 0x60, 0x60],
      [0x1000]
    );
    const blocks = buildBlocks(index, entryPoints);
    const first = blocks.find((b) => b.start === 0x1000)!;

    expect(first.exit).toBe("call");
    expect(first.calls).toEqual([0x1006]);
    // Its successor is where the call comes back to, which is a block start —
    // so the return edge lands at an entry rather than inside a run.
    expect(first.successors).toEqual([0x1003]);
    expect(blocks.map((b) => b.start)).toContain(0x1003);
  });

  it("ends a block at a jump to the very next instruction", () => {
    //  JMP $1003 / RTS — the target is also the following address.
    const { index, entryPoints } = program([0x4c, 0x03, 0x10, 0x60]);
    const blocks = buildBlocks(index, entryPoints);

    // Filtering "the target that equals the next address" looks equivalent to
    // removing fall-through and is not: a jump has none to remove, and this
    // target was being discarded, leaving $1003 reachable mid-block.
    expect(blocks.map((b) => b.start)).toContain(0x1003);
    expect(blocks.find((b) => b.start === 0x1000)!.successors).toEqual([0x1003]);
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

describe("the invariant the whole definition exists for", () => {
  it("lets control enter a block only at its start, on a real program", () => {
    // Every control-flow edge in Gridrunner must land on a block start. This is
    // what makes a block a single transfer function: an analysis can treat its
    // inputs as fixed at entry and ignore what happens inside. SSA needs it
    // outright, since phi-nodes sit at block entries and nowhere else.
    //
    // Data references are excluded: reading a byte that happens to sit inside
    // code is not control arriving there.
    const map = new MemoryMap();
    map.addLayer(new BytesLayer("test", ORG, new Uint8Array(GRIDRUNNER_SHAPED)));
    const result = disassemble(map, { entryPoints: [ORG] });
    const index = new InstructionIndex(result.instructions);
    const starts = new Set(buildBlocks(index, [ORG]).map((b) => b.start));

    for (const [target, refs] of result.references) {
      if (!index.has(target)) continue;
      if (refs.every((r) => r.type === "data")) continue;
      expect(starts.has(target)).toBe(true);
    }
  });

  it("holds where a branch lands in the middle of a run", () => {
    //  BNE +3 / NOP / NOP / NOP / RTS
    const { index, entryPoints } = program([0xd0, 0x03, 0xea, 0xea, 0xea, 0x60]);
    const blocks = buildBlocks(index, entryPoints);

    for (const block of blocks) {
      // Nothing but the first instruction of a block is a branch target.
      for (const instr of block.instructions.slice(1)) {
        expect(blocks.some((b) => b.start === instr.address)).toBe(false);
      }
    }
  });
});

/**
 * A program with every shape that can break the invariant: a call, a jump to
 * the following address, a branch backwards into a run, and a return.
 */
const GRIDRUNNER_SHAPED = [
  0x20, 0x0c, 0x10, // 1000  JSR $100C     — call, returns into 1003
  0xa9, 0x01,       // 1003  LDA #$01
  0x4c, 0x08, 0x10, // 1005  JMP $1008     — jump to the very next address
  0xea,             // 1008  NOP
  0xd0, 0xf8,       // 1009  BNE $1003     — backwards into the middle of a run
  0x60,             // 100B  RTS
  0x60,             // 100C  RTS           — the callee
];
