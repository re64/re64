import { describe, it, expect } from "vitest";
import { proveValues, flagBefore, preservedAt, stackBefore, valueBefore } from "./values.js";
import { buildBlocks } from "./blocks.js";
import { InstructionIndex, disassemble } from "../arch/mos6502/disassembler.js";
import { MemoryMap } from "../memory/memory-map.js";
import { BytesLayer } from "../memory/layer.js";
import { REG } from "../il/pcode.js";
import { isExact } from "../il/known-bits.js";

const ORG = 0x1000;
function analyse(bytes: number[]) {
  const map = new MemoryMap();
  map.addLayer(new BytesLayer("test", ORG, new Uint8Array(bytes)));
  const index = new InstructionIndex(disassemble(map, { entryPoints: [ORG] }).instructions);
  const blocks = buildBlocks(index, [ORG]);
  return proveValues(blocks, [ORG]);
}

describe("proving flags from values rather than from set/clear instructions", () => {
  it("decides Z and N from an immediate load", () => {
    // LDA #$00 / RTS — the whole point: nothing sets Z here, a value does.
    const v = analyse([0xa9, 0x00, 0x60]);
    expect(flagBefore(v, ORG + 2, REG.Z)).toBe("set");
    expect(flagBefore(v, ORG + 2, REG.N)).toBe("clear");
  });

  it("proves N from bit seven with every other bit unknown", () => {
    // LDA $10 / AND #$7F / RTS — the value stays a mystery, the sign does not.
    const v = analyse([0xa5, 0x10, 0x29, 0x7f, 0x60]);
    expect(isExact(valueBefore(v, ORG + 4, REG.A), 1)).toBe(false);
    expect(flagBefore(v, ORG + 4, REG.N)).toBe("clear");
    // Z is genuinely undecided: the low seven bits could be anything.
    expect(flagBefore(v, ORG + 4, REG.Z)).toBe("unknown");
  });

  it("proves Z clear from one bit known set", () => {
    // LDA $10 / ORA #$80 / RTS — cannot be zero, whatever was loaded.
    const v = analyse([0xa5, 0x10, 0x09, 0x80, 0x60]);
    expect(flagBefore(v, ORG + 4, REG.Z)).toBe("clear");
    expect(flagBefore(v, ORG + 4, REG.N)).toBe("set");
  });

  it("still answers the flags the old walker answered", () => {
    // SEI / CLD / SEC / RTS — these are register writes like any other now.
    const v = analyse([0x78, 0xd8, 0x38, 0x60]);
    expect(flagBefore(v, ORG + 3, REG.I)).toBe("set");
    expect(flagBefore(v, ORG + 3, REG.D)).toBe("clear");
    expect(flagBefore(v, ORG + 3, REG.C)).toBe("set");
  });

  it("keeps a value across the stack, and loses it on TXS", () => {
    // LDA #$42 / PHA / LDA #$00 / PLA / RTS
    const kept = analyse([0xa9, 0x42, 0x48, 0xa9, 0x00, 0x68, 0x60]);
    const pulled = valueBefore(kept, ORG + 6, REG.A);
    expect(isExact(pulled, 1)).toBe(true);
    expect(pulled.value).toBe(0x42);

    // LDA #$42 / PHA / TXS / PLA / RTS — TXS moves the pointer somewhere
    // unrelated, so what was pushed is no longer addressable by position.
    const lost = analyse([0xa9, 0x42, 0x48, 0x9a, 0x68, 0x60]);
    expect(stackBefore(lost, ORG + 5)).toBeUndefined();
    expect(isExact(valueBefore(lost, ORG + 5, REG.A), 1)).toBe(false);
  });

  it("carries B off the stack, though nothing stores it", () => {
    // PHP / PLA / AND #$10 / RTS — B is not a register anywhere on this machine.
    // It exists only as bit four of the byte PHP pushes, and the only way to
    // reason about it is to follow that byte. Every other flag here is unknown.
    const v = analyse([0x08, 0x68, 0x29, 0x10, 0x60]);
    const extracted = valueBefore(v, ORG + 4, REG.A);
    expect(isExact(extracted, 1)).toBe(true);
    expect(extracted.value).toBe(0x10);
  });

  it("keeps only what both paths agree on", () => {
    // LDA #$00 / BEQ +2 / LDA #$01 / (join) RTS
    //   $1000 A9 00     LDA #$00
    //   $1002 F0 02     BEQ $1006
    //   $1004 A9 01     LDA #$01
    //   $1006 60        RTS
    const v = analyse([0xa9, 0x00, 0xf0, 0x02, 0xa9, 0x01, 0x60]);
    const joined = valueBefore(v, ORG + 6, REG.A);
    // $00 and $01 agree on the top seven bits and disagree on the last.
    expect(joined.known).toBe(0xfe);
    expect(flagBefore(v, ORG + 6, REG.Z)).toBe("unknown");
    expect(flagBefore(v, ORG + 6, REG.N)).toBe("clear");
  });

  it("keeps a flag a callee cannot touch", () => {
    //   $1000 78        SEI
    //   $1001 20 05 10  JSR $1005
    //   $1004 60        RTS
    //   $1005 EA        NOP
    //   $1006 60        RTS
    // The callee cannot reach I, so the critical section survives the call.
    const v = analyse([0x78, 0x20, 0x05, 0x10, 0x60, 0xea, 0x60]);
    expect(flagBefore(v, ORG + 4, REG.I)).toBe("set");
  });

  it("gives up a flag the callee does reach", () => {
    // Same, but the callee does CLI.
    const v = analyse([0x78, 0x20, 0x05, 0x10, 0x60, 0x58, 0x60]);
    expect(flagBefore(v, ORG + 4, REG.I)).toBe("unknown");
  });
});

describe("analysing an interrupt handler as either of the two things it is", () => {
  // A handler is entered with a status byte pushed underneath it, and the one
  // bit that says how it got there — B, set by BRK and clear by a hardware
  // interrupt — lives nowhere else on this machine. Seeding that byte with B
  // decided and the rest a mystery is what lets the same code give two answers.
  //
  //   $1000  PLA        take the status byte
  //   $1001  29 10      AND #$10
  //   $1003  F0 03      BEQ $1008        (hardware interrupt path)
  //   $1005  A9 42      LDA #$42         (BRK path)
  //   $1007  60         RTS
  //   $1008  A9 99      LDA #$99
  //   $100A  60         RTS
  const HANDLER = [0x68, 0x29, 0x10, 0xf0, 0x03, 0xa9, 0x42, 0x60, 0xa9, 0x99, 0x60];

  const withStatus = (bits: { known: number; value: number }) => {
    const map = new MemoryMap();
    map.addLayer(new BytesLayer("handler", ORG, new Uint8Array(HANDLER)));
    const index = new InstructionIndex(disassemble(map, { entryPoints: [ORG] }).instructions);
    return proveValues(buildBlocks(index, [ORG]), [ORG], {
      stackAt: new Map([[ORG, [bits]]]),
    });
  };

  it("takes the BRK path when B is pushed set", () => {
    // Bit 4 known set, every other bit unknown — which is all anybody knows.
    const v = withStatus({ known: 0x10, value: 0x10 });
    expect(flagBefore(v, ORG + 3, REG.Z)).toBe("clear");
  });

  it("takes the interrupt path when B is pushed clear", () => {
    const v = withStatus({ known: 0x10, value: 0x00 });
    expect(flagBefore(v, ORG + 3, REG.Z)).toBe("set");
  });

  it("cannot say which, with nothing pushed", () => {
    const v = withStatus({ known: 0, value: 0 });
    expect(flagBefore(v, ORG + 3, REG.Z)).toBe("unknown");
  });
});

describe("an origin that is re-entered from inside the program", () => {
  /** Same as `analyse`, with a second origin classified. */
  function withKinds(bytes: number[], origins: number[], kinds: [number, "interrupt" | "brk"][]) {
    const map = new MemoryMap();
    map.addLayer(new BytesLayer("test", ORG, new Uint8Array(bytes)));
    const index = new InstructionIndex(disassemble(map, { entryPoints: origins }).instructions);
    return proveValues(buildBlocks(index, origins), origins, {
      cover: origins,
      kinds: new Map(kinds),
    });
  }

  //   $1000  D8        CLD              <- the program's own origin
  //   $1001  A2 05     LDX #$05
  //   $1003  00        BRK
  //   $1004  60        RTS
  //   $1005  ...handler at $1005
  //   $1005  68        PLA              take the pushed status
  //   $1006  29 10     AND #$10
  //   $1008  60        RTS
  const PROGRAM = [0xd8, 0xa2, 0x05, 0x00, 0x60, 0x68, 0x29, 0x10, 0x60];

  it("gives a handler the flags the interrupted code had", () => {
    // CLD runs before the BRK, so D is clear at the only site the handler can
    // be entered from — and the handler inherits it. Seeded as `external` it
    // would be unknown, which is what this whole task was about.
    const v = withKinds(PROGRAM, [ORG, ORG + 5], [[ORG + 5, "brk"]]);
    expect(flagBefore(v, ORG + 5, REG.D)).toBe("clear");
    // The processor sets I on the way in, whatever the interrupted code had.
    expect(flagBefore(v, ORG + 5, REG.I)).toBe("set");
  });

  it("keeps the registers, because an interrupt does not touch them", () => {
    const v = withKinds(PROGRAM, [ORG, ORG + 5], [[ORG + 5, "brk"]]);
    const x = valueBefore(v, ORG + 5, REG.X);
    expect(isExact(x, 1)).toBe(true);
    expect(x.value).toBe(0x05);
  });

  it("knows B is set when the handler was reached by BRK", () => {
    const v = withKinds(PROGRAM, [ORG, ORG + 5], [[ORG + 5, "brk"]]);
    const extracted = valueBefore(v, ORG + 8, REG.A);
    expect(isExact(extracted, 1)).toBe(true);
    expect(extracted.value).toBe(0x10);
  });

  it("knows B is clear when it was reached by an interrupt", () => {
    const v = withKinds(PROGRAM, [ORG, ORG + 5], [[ORG + 5, "interrupt"]]);
    const extracted = valueBefore(v, ORG + 8, REG.A);
    expect(isExact(extracted, 1)).toBe(true);
    expect(extracted.value).toBe(0x00);
  });

  it("cannot say, for a handler reached both ways", () => {
    // Which is the whole reason a real handler tests it: on a 6502 `BRK` and
    // `IRQ` share $FFFE, so one routine serves both and has to look.
    const both = withKinds(PROGRAM, [ORG, ORG + 5], [[ORG + 5, "brk"]]);
    const other = withKinds(PROGRAM, [ORG, ORG + 5], [[ORG + 5, "interrupt"]]);
    expect(valueBefore(both, ORG + 8, REG.A).value).not.toBe(
      valueBefore(other, ORG + 8, REG.A).value
    );
  });
});

describe("proving that a routine gives something back", () => {
  function withIdentity(bytes: number[]) {
    const map = new MemoryMap();
    map.addLayer(new BytesLayer("test", ORG, new Uint8Array(bytes)));
    const index = new InstructionIndex(disassemble(map, { entryPoints: [ORG] }).instructions);
    return proveValues(buildBlocks(index, [ORG]), [ORG], { identity: true });
  }

  it("carries a flag through PHP and PLP", () => {
    // PHP / SED / PLP / RTS. D is set in the middle and restored at the end, so
    // it is preserved — and no amount of knowing *bits* can say that, because
    // the value is unknown at both ends. This is the case the whole KERNAL turns
    // on: every write to D in that ROM is a PLP.
    const v = withIdentity([0x08, 0xf8, 0x28, 0x60]);
    expect(preservedAt(v, ORG + 3, REG.D)).toBe(true);
    expect(flagBefore(v, ORG + 3, REG.D)).toBe("unknown");
  });

  it("does not claim preservation when the flag is really decided", () => {
    // PHP / PLP / SED / RTS — restored, then set. Not preserved.
    const v = withIdentity([0x08, 0x28, 0xf8, 0x60]);
    expect(preservedAt(v, ORG + 3, REG.D)).toBe(false);
    expect(flagBefore(v, ORG + 3, REG.D)).toBe("set");
  });

  it("sees TXA / TAX give X back", () => {
    // The idiom the reviewing agent noticed in the KERNAL by hand: both
    // registers are written, and X ends up exactly as it began.
    const v = withIdentity([0x8a, 0xaa, 0x60]);
    expect(preservedAt(v, ORG + 2, REG.X)).toBe(true);
    // A is not: it holds X's value now, which is a different thing.
    expect(preservedAt(v, ORG + 2, REG.A)).toBe(false);
  });

  it("carries a register through the stack", () => {
    // PHA / LDA #$00 / PLA / RTS
    const v = withIdentity([0x48, 0xa9, 0x00, 0x68, 0x60]);
    expect(preservedAt(v, ORG + 4, REG.A)).toBe(true);
  });

  it("loses the identity at anything that computes", () => {
    // PHP / CLC / ADC #$00 / PLP / RTS — the ADC decides C, so restoring the
    // pushed byte afterwards puts back a *different* carry than the one this
    // routine was entered with... no: PLP restores what PHP pushed, so C is
    // preserved. What is not preserved is A, which the ADC computed.
    const v = withIdentity([0x08, 0x18, 0x69, 0x00, 0x28, 0x60]);
    expect(preservedAt(v, ORG + 5, REG.C)).toBe(true);
    expect(preservedAt(v, ORG + 5, REG.A)).toBe(false);
  });

  it("needs both paths to agree", () => {
    //   $1000 08        PHP
    //   $1001 F0 01     BEQ $1004
    //   $1003 F8        SED
    //   $1004 28        PLP        <- restores whatever was pushed, either way
    //   $1005 60        RTS
    const restored = withIdentity([0x08, 0xf0, 0x01, 0xf8, 0x28, 0x60]);
    expect(preservedAt(restored, ORG + 5, REG.D)).toBe(true);

    //   $1000 F0 01     BEQ $1003
    //   $1002 F8        SED
    //   $1003 60        RTS        <- one path set D, the other did not
    const decided = withIdentity([0xf0, 0x01, 0xf8, 0x60]);
    expect(preservedAt(decided, ORG + 3, REG.D)).toBe(false);
  });
});
