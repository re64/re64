import { describe, it, expect } from "vitest";
import { decode, ByteReader } from "./decoder.js";
import { formatInstruction, formatOperand } from "./instruction.js";

/** Simple byte reader from an array at a base address */
function arrayReader(base: number, bytes: number[]): ByteReader {
  return {
    readByte(address: number): number | undefined {
      const offset = address - base;
      if (offset < 0 || offset >= bytes.length) return undefined;
      return bytes[offset];
    },
  };
}

describe("decode", () => {
  describe("implied addressing", () => {
    it("decodes NOP", () => {
      const reader = arrayReader(0x1000, [0xea]);
      const result = decode(reader, 0x1000);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.instruction.mnemonic).toBe("NOP");
        expect(result.instruction.bytes.length).toBe(1);
        expect(formatInstruction(result.instruction)).toBe(" NOP");
      }
    });

    it("decodes RTS", () => {
      const reader = arrayReader(0x1000, [0x60]);
      const result = decode(reader, 0x1000);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.instruction.mnemonic).toBe("RTS");
        expect(result.instruction.flow).toBe("ret");
      }
    });
  });

  describe("immediate addressing", () => {
    it("decodes LDA #$42", () => {
      const reader = arrayReader(0x1000, [0xa9, 0x42]);
      const result = decode(reader, 0x1000);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.instruction.mnemonic).toBe("LDA");
        expect(result.instruction.operand).toEqual({ type: "immediate", value: 0x42 });
        expect(formatOperand(result.instruction.operand)).toBe("#$42");
      }
    });
  });

  describe("zero page addressing", () => {
    it("decodes LDA $10", () => {
      const reader = arrayReader(0x1000, [0xa5, 0x10]);
      const result = decode(reader, 0x1000);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.instruction.operand).toEqual({ type: "zeroPage", address: 0x10 });
        expect(formatOperand(result.instruction.operand)).toBe("$10");
      }
    });

    it("decodes STA $20,X", () => {
      const reader = arrayReader(0x1000, [0x95, 0x20]);
      const result = decode(reader, 0x1000);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.instruction.operand).toEqual({ type: "zeroPageX", address: 0x20 });
        expect(formatOperand(result.instruction.operand)).toBe("$20,X");
      }
    });
  });

  describe("absolute addressing", () => {
    it("decodes LDA $1234", () => {
      const reader = arrayReader(0x1000, [0xad, 0x34, 0x12]);
      const result = decode(reader, 0x1000);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.instruction.operand).toEqual({ type: "absolute", address: 0x1234 });
        expect(formatOperand(result.instruction.operand)).toBe("$1234");
      }
    });

    it("decodes JMP $2000", () => {
      const reader = arrayReader(0x1000, [0x4c, 0x00, 0x20]);
      const result = decode(reader, 0x1000);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.instruction.mnemonic).toBe("JMP");
        expect(result.instruction.flow).toBe("jump");
        expect(result.instruction.operand).toEqual({ type: "absolute", address: 0x2000 });
      }
    });

    it("decodes JSR $3000", () => {
      const reader = arrayReader(0x1000, [0x20, 0x00, 0x30]);
      const result = decode(reader, 0x1000);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.instruction.mnemonic).toBe("JSR");
        expect(result.instruction.flow).toBe("call");
      }
    });
  });

  describe("indexed addressing", () => {
    it("decodes LDA $1234,X", () => {
      const reader = arrayReader(0x1000, [0xbd, 0x34, 0x12]);
      const result = decode(reader, 0x1000);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.instruction.operand).toEqual({ type: "absoluteX", address: 0x1234 });
        expect(formatOperand(result.instruction.operand)).toBe("$1234,X");
      }
    });

    it("decodes LDA ($20,X)", () => {
      const reader = arrayReader(0x1000, [0xa1, 0x20]);
      const result = decode(reader, 0x1000);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.instruction.operand).toEqual({ type: "indexedIndirect", address: 0x20 });
        expect(formatOperand(result.instruction.operand)).toBe("($20,X)");
      }
    });

    it("decodes LDA ($30),Y", () => {
      const reader = arrayReader(0x1000, [0xb1, 0x30]);
      const result = decode(reader, 0x1000);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.instruction.operand).toEqual({ type: "indirectIndexed", address: 0x30 });
        expect(formatOperand(result.instruction.operand)).toBe("($30),Y");
      }
    });
  });

  describe("relative addressing (branches)", () => {
    it("decodes BEQ with forward branch", () => {
      // BEQ +$10 at $1000 -> target $1012 (1000 + 2 + 10)
      const reader = arrayReader(0x1000, [0xf0, 0x10]);
      const result = decode(reader, 0x1000);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.instruction.mnemonic).toBe("BEQ");
        expect(result.instruction.flow).toBe("branch");
        expect(result.instruction.operand).toEqual({
          type: "relative",
          offset: 0x10,
          target: 0x1012,
        });
        expect(formatOperand(result.instruction.operand)).toBe("$1012");
      }
    });

    it("decodes BNE with backward branch", () => {
      // BNE -$10 at $1000 -> target $0FF2 (1000 + 2 - 10)
      const reader = arrayReader(0x1000, [0xd0, 0xf0]); // 0xF0 = -16
      const result = decode(reader, 0x1000);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.instruction.mnemonic).toBe("BNE");
        expect(result.instruction.operand).toEqual({
          type: "relative",
          offset: -16,
          target: 0x0ff2,
        });
      }
    });
  });

  describe("indirect addressing", () => {
    it("decodes JMP ($1234)", () => {
      const reader = arrayReader(0x1000, [0x6c, 0x34, 0x12]);
      const result = decode(reader, 0x1000);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.instruction.mnemonic).toBe("JMP");
        expect(result.instruction.operand).toEqual({ type: "indirect", address: 0x1234 });
        expect(formatOperand(result.instruction.operand)).toBe("($1234)");
      }
    });
  });

  describe("accumulator addressing", () => {
    it("decodes ASL A", () => {
      const reader = arrayReader(0x1000, [0x0a]);
      const result = decode(reader, 0x1000);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.instruction.mnemonic).toBe("ASL");
        expect(result.instruction.operand).toEqual({ type: "accumulator" });
        expect(formatOperand(result.instruction.operand)).toBe("A");
      }
    });
  });

  describe("illegal opcodes", () => {
    it("decodes LAX (illegal)", () => {
      const reader = arrayReader(0x1000, [0xa7, 0x10]); // LAX $10
      const result = decode(reader, 0x1000);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.instruction.mnemonic).toBe("LAX");
        expect(result.instruction.illegal).toBe(true);
        expect(formatInstruction(result.instruction)).toBe("*LAX $10");
      }
    });

    it("decodes JAM (illegal halt)", () => {
      const reader = arrayReader(0x1000, [0x02]);
      const result = decode(reader, 0x1000);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.instruction.mnemonic).toBe("JAM");
        expect(result.instruction.illegal).toBe(true);
        expect(result.instruction.flow).toBe("halt");
      }
    });
  });

  describe("error cases", () => {
    it("returns undefined error for missing bytes", () => {
      const reader = arrayReader(0x1000, []);
      const result = decode(reader, 0x1000);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("undefined");
      }
    });

    it("returns truncated error for incomplete instruction", () => {
      // LDA $1234 needs 3 bytes, only 2 available
      const reader = arrayReader(0x1000, [0xad, 0x34]);
      const result = decode(reader, 0x1000);
      expect(result.ok).toBe(false);
      if (!result.ok && result.reason === "truncated") {
        expect(result.needed).toBe(3);
        expect(result.available).toBe(2);
      }
    });
  });
});
