import { describe, it, expect } from "vitest";
import { InstructionIndex, describeWarning, disassemble } from "./disassembler.js";
import { ByteReader } from "./decoder.js";
import { MemoryMap } from "../../memory/memory-map.js";
import { BytesLayer } from "../../memory/layer.js";
import { buildBlocks } from "../../analysis/blocks.js";
import { analyzeRoutines } from "../../analysis/routines.js";
import { carrySites, decimalModes, interruptsDisabledAt } from "../../analysis/flags.js";
import { blockEffects } from "../../il/effects.js";

/**
 * The catalogue of 6502 and C64 trickery this project has actually met.
 *
 * Every entry here was found in a real binary — Gridrunner, the KERNAL ROM, or
 * Revenge of the Mutant Camels — and each is a place where the obvious reading
 * of the bytes is wrong. They are gathered because the evidence is spread across
 * three programs and growing, and a corner case pinned only against a 65KB
 * binary is one nobody can see: the assertion says "Gridrunner still works", not
 * "this is what a `PLA PLA RTS` means".
 *
 * So each is reduced to the fewest bytes that still show it, and records **where
 * it was seen**, so the provenance survives even if the binary does not. Some
 * duplicate an assertion in a component's own tests; that is deliberate and
 * cheap. A component test says the component works, and this says what the
 * machine does.
 *
 * The rule for adding one: it earns a place when a *naive* reading of the bytes
 * gives a confidently wrong answer. Not merely unusual — wrong.
 */

const ORG = 0x1000;

function assemble(bytes: number[], entryPoints: number[] = [ORG], org = ORG) {
  const map = new MemoryMap();
  map.addLayer(new BytesLayer("idiom", org, new Uint8Array(bytes)));
  const result = disassemble(map, { entryPoints });
  const blocks = buildBlocks(new InstructionIndex(result.instructions), entryPoints);
  return { result, blocks, routines: analyzeRoutines(blocks, entryPoints), entryPoints };
}

describe("BIT as a two-byte skip", () => {
  // Seen: KERNAL $F6FB, the nine error entry points, chained. Also $EF30, $EDAF.
  //
  //   $F6FB  A9 01     LDA #$01     <- ERROR1 enters here
  //   $F6FD  2C A9 02  BIT $02A9    <- ERROR2 enters at $F6FE: LDA #$02
  //
  // A `BIT abs` whose operand bytes *are* the next instruction. Entering at the
  // BIT skips the load; entering one byte later performs it. Naive reading: one
  // instruction stream, and a routine that mysteriously reads $02A9.
  const CHAIN = [0xa9, 0x01, 0x2c, 0xa9, 0x02, 0x2c, 0xa9, 0x03, 0x60];

  it("reads as a BIT when nothing enters the middle", () => {
    const { result } = assemble(CHAIN);
    expect(result.instructions.get(ORG + 2)?.mnemonic).toBe("BIT");
    expect(result.instructions.has(ORG + 3)).toBe(false);
  });

  it("gives $02A9 a phantom read, which is real and meaningless", () => {
    // BIT genuinely reads the address on hardware. It is reported because it
    // happens, not filtered because it is pointless — recognising BIT-as-skip
    // is a decode question, and inventing an exception in the effects pass
    // would hide it. This is why CHROUT appears to read $03A9 and $10A9.
    const { result } = assemble(CHAIN);
    const bit = result.instructions.get(ORG + 2)!;
    const effects = blockEffects([bit]);
    expect(effects.inputs.some((v) => v.space === "ram" && v.offset === 0x02a9)).toBe(true);
  });

  it("decodes both readings once something enters the middle", () => {
    // Structurally this is overlapping instructions, and re64 keeps both rather
    // than letting one destroy the other.
    const { result } = assemble(CHAIN, [ORG, ORG + 3]);
    expect(result.instructions.get(ORG + 2)?.mnemonic).toBe("BIT");
    expect(result.instructions.get(ORG + 3)?.mnemonic).toBe("LDA");
    expect(result.instructions.get(ORG + 3)?.operand).toMatchObject({ value: 0x02 });
  });
});

describe("returning somewhere other than where you were called from", () => {
  it("PLA PLA RTS returns to its caller's caller", () => {
    // Seen: Gridrunner $87FE, and $8A2F/$8A41 where the pops and the return are
    // eight blocks apart. Naive reading: an ordinary subroutine.
    const { routines } = assemble([0x68, 0x68, 0x60]);
    const behaviour = routines.get(ORG)!.returns[0];
    expect(behaviour.kind).toBe("skips");
    expect(behaviour.skipsFrames).toBe(1);
  });

  it("TXS abandons the call chain outright", () => {
    // Seen: Gridrunner $8ADE and $8C2D, both jumping into the death path. This
    // is the one that makes a may-analysis union the whole program, and the
    // only kind `follow: "returning"` will cut on.
    const { routines } = assemble([0xa2, 0xf6, 0x9a, 0x60]);
    expect(routines.get(ORG)!.returns[0].kind).toBe("abandons");
  });

  it("RTI pops three bytes, not two", () => {
    // Comparing every return against -2 reports every interrupt handler in
    // every program as broken, which is how this was wrong the first time.
    // A bare RTI is balanced; it would not be if the pop count were assumed.
    const { routines } = assemble([0x40]);
    expect(routines.get(ORG)!.returns).toEqual([]);
  });

  it("but a handler that restores registers really is unbalanced", () => {
    // Seen: Gridrunner $83E2 — PLA TAY PLA TAX PLA RTI. Three bytes shallower
    // than it started, because the *interrupt* pushed what it is popping. A
    // real finding rather than a false one, and the distinction from the case
    // above is the whole reason the pop count has to come from the instruction.
    const { routines } = assemble([0x68, 0xa8, 0x68, 0xaa, 0x68, 0x40]);
    const behaviour = routines.get(ORG)!.returns[0];
    expect(behaviour.kind).toBe("ambiguous");
    expect(behaviour.why).toContain("3 bytes shallower");
  });
});

describe("flags that change what an instruction means", () => {
  it("SED makes ADC decimal, and the proof follows calls", () => {
    // Seen: nowhere in Gridrunner, which has one CLD and no SED — which is why
    // proving it mattered. A binary default was a guess that happened to hold.
    const { blocks, entryPoints } = assemble([0xf8, 0x69, 0x01, 0x60]);
    expect(decimalModes(blocks, entryPoints).get(ORG + 1)).toBe("decimal");
  });

  it("a 6502 does not clear D on reset, so an entry point starts unknown", () => {
    // The 65C02 does. Assuming clear would assume the very thing every real
    // reset routine's CLD exists to establish.
    const { blocks, entryPoints } = assemble([0x69, 0x01, 0x60]);
    expect(decimalModes(blocks, entryPoints).get(ORG)).toBe("unknown");
  });

  it("CLC before SBC subtracts one more than the operand reads", () => {
    // Seen: Gridrunner $8279, $828D, $82CA, $82E5 — found by hand across two
    // binaries before anything computed it. Reported as a fact, not a defect:
    // all of Gridrunner's sit in visual effects where being one out is invisible.
    const { blocks, entryPoints } = assemble([0x18, 0xe9, 0x01, 0x60]);
    const sites = carrySites(blocks, entryPoints);
    expect(sites).toContainEqual(expect.objectContaining({ mnemonic: "SBC", carry: "clear" }));
  });

  it("falling through into a routine that does CLI reopens a critical section", () => {
    // Seen: KERNAL $F6DD. RDTIM has no RTS — it falls straight into SETTIM,
    // which ends with CLI. Reading the clock inside what a caller believes is a
    // critical section turns interrupts back on underneath it.
    //   $1000  SEI / LDA $10 / JMP $1006
    //   $1006  STA $10 / CLI / RTS      <- entered with interrupts already off
    const { blocks, entryPoints } = assemble([
      0x78, 0xa5, 0x10, 0x4c, 0x06, 0x10, 0x85, 0x10, 0x58, 0x60,
    ]);
    expect(interruptsDisabledAt(blocks, entryPoints)).toContain(ORG + 6);
  });
});

describe("addressing that does not do the obvious thing", () => {
  it("JMP ($10FF) takes its high byte from $1000, not $1100", () => {
    // The page-wrap bug people relied on. Modelled in the lifter and in the
    // indirect-jump warning, so the two cannot drift apart.
    const map = new MemoryMap();
    map.addLayer(new BytesLayer("code", 0x2000, new Uint8Array([0x6c, 0xff, 0x10])));
    map.addLayer(new BytesLayer("low", 0x1000, new Uint8Array([0x12])));
    map.addLayer(new BytesLayer("high", 0x10ff, new Uint8Array([0x34])));
    const { warnings } = disassemble(map, { entryPoints: [0x2000] });
    expect(warnings.find((w) => w.type === "indirectJump")).toMatchObject({ target: 0x1234 });
  });

  it("an indirect jump is not followed, but says what it would have reached", () => {
    // Seen: KERNAL, 15 of 42 documented entry points. Following it would be
    // wrong exactly where vectors are most used, since hooking $0314 is the
    // standard idiom — so it names the cell and leaves the judgement to a reader.
    const map = new MemoryMap();
    map.addLayer(new BytesLayer("code", ORG, new Uint8Array([0x6c, 0x26, 0x03])));
    map.addLayer(new BytesLayer("vector", 0x0326, new Uint8Array([0xca, 0xf1])));
    const { instructions, warnings } = disassemble(map, { entryPoints: [ORG] });
    expect(instructions.size).toBe(1);
    const warning = warnings.find((w) => w.type === "indirectJump")!;
    expect(warning).toMatchObject({ pointer: 0x0326, target: 0xf1ca });
    expect(describeWarning(warning)).toContain("mark_function");
  });

  it("a write through a zero-page pointer names no address at all", () => {
    // Seen: Gridrunner writes the VIC-II *only* this way, so a range search over
    // $D000-$D02E found one dead instruction and missed every write that
    // mattered. Static analysis can only admit to it; run_block resolves it.
    const { result } = assemble([0x91, 0x02, 0x60]);
    const effects = blockEffects([result.instructions.get(ORG)!]);
    expect(effects.writesComputedMemory).toBe(true);
    expect(effects.outputs.some((v) => v.space === "ram")).toBe(false);
  });

  it("the stack is not an address the analysis failed to name", () => {
    // Every RTS pops through SP, which lifts to a computed load. Counting those
    // made the "indexed access I cannot resolve" flag fire on all 42 KERNAL
    // entry points, IOBASE included, which touches no memory whatsoever.
    const { result } = assemble([0x48, 0x68, 0x60]);
    const effects = blockEffects([...result.instructions.values()]);
    expect(effects.readsComputedMemory).toBe(false);
    expect(effects.writesComputedMemory).toBe(false);
  });
});

describe("BRK, which is a jump through a vector", () => {
  // Seen: any program with its own BRK handler, and the KERNAL's own at $FE66.
  // Naive reading: execution stops. It does not — it goes wherever $FFFE points,
  // with B set in the byte it pushes so the handler can tell a BRK from an
  // interrupt, and comes back to BRK+2.
  function flat(cells: Record<number, number[]>): ByteReader {
    const memory = new Map<number, number>();
    for (const [base, bytes] of Object.entries(cells))
      bytes.forEach((b, i) => memory.set(Number(base) + i, b));
    return { readByte: (a) => memory.get(a) };
  }

  it("is not followed, and names the vector and what is in it", () => {
    const reader = flat({ 0x1000: [0x00, 0x60], 0x2000: [0xa9, 0x01, 0x40], 0xfffe: [0x00, 0x20] });
    const { instructions, warnings } = disassemble(reader, { entryPoints: [0x1000] });

    // Not followed: a program may install its own handler, exactly as it may
    // rehook an indirect jump's vector.
    expect(instructions.has(0x2000)).toBe(false);

    const warning = warnings.find((w) => w.type === "breakVector");
    expect(warning).toMatchObject({ address: 0x1000, vector: 0xfffe, target: 0x2000 });
    expect(describeWarning(warning!)).toContain("mark_function");
    expect(describeWarning(warning!)).toContain("B set");
  });

  it("says so plainly when nothing supplies the vector", () => {
    const reader = flat({ 0x1000: [0x00, 0x60] });
    const warning = disassemble(reader, { entryPoints: [0x1000] }).warnings.find(
      (w) => w.type === "breakVector"
    );
    expect(warning && "target" in warning).toBe(false);
    expect(describeWarning(warning!)).toContain("nothing to read");
  });
});
