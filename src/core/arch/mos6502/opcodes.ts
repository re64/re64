/** 6502 addressing modes */
export type AddressingMode =
  | "imp"      // Implied: RTS
  | "acc"      // Accumulator: ASL A
  | "imm"      // Immediate: LDA #$00
  | "zp"       // Zero Page: LDA $00
  | "zpx"      // Zero Page,X: LDA $00,X
  | "zpy"      // Zero Page,Y: LDX $00,Y
  | "abs"      // Absolute: LDA $1234
  | "abx"      // Absolute,X: LDA $1234,X
  | "aby"      // Absolute,Y: LDA $1234,Y
  | "ind"      // Indirect: JMP ($1234)
  | "izx"      // Indexed Indirect: LDA ($00,X)
  | "izy"      // Indirect Indexed: LDA ($00),Y
  | "rel";     // Relative: BEQ $1234

/** How control flow proceeds after this instruction */
export type FlowType =
  | "next"     // Continue to next instruction
  | "branch"   // Conditional branch (continues + has target)
  | "jump"     // Unconditional jump (target only)
  | "call"     // Subroutine call (continues after return + has target)
  | "ret"      // Return from subroutine
  | "halt";    // BRK/JAM - stops execution

/** Opcode definition */
export interface OpcodeInfo {
  mnemonic: string;
  mode: AddressingMode;
  bytes: number;
  flow: FlowType;
  illegal?: boolean;
}

/** Bytes per addressing mode */
export const MODE_BYTES: Record<AddressingMode, number> = {
  imp: 1,
  acc: 1,
  imm: 2,
  zp: 2,
  zpx: 2,
  zpy: 2,
  abs: 3,
  abx: 3,
  aby: 3,
  ind: 3,
  izx: 2,
  izy: 2,
  rel: 2,
};

/** Create opcode info helper */
function op(
  mnemonic: string,
  mode: AddressingMode,
  flow: FlowType = "next",
  illegal = false
): OpcodeInfo {
  return { mnemonic, mode, bytes: MODE_BYTES[mode], flow, illegal };
}

/** Illegal opcode helper */
function ill(mnemonic: string, mode: AddressingMode, flow: FlowType = "next"): OpcodeInfo {
  return op(mnemonic, mode, flow, true);
}

/**
 * Complete 6502 opcode table (256 entries).
 * Includes all documented and illegal/undocumented opcodes.
 * Illegal opcode mnemonics follow common conventions (SLO, RLA, SRE, RRA, SAX, LAX, DCP, ISC, etc.)
 */
export const OPCODES: OpcodeInfo[] = [
  // 0x00-0x0F
  op("BRK", "imp", "halt"),
  op("ORA", "izx"),
  ill("JAM", "imp", "halt"),
  ill("SLO", "izx"),
  ill("NOP", "zp"),
  op("ORA", "zp"),
  op("ASL", "zp"),
  ill("SLO", "zp"),
  op("PHP", "imp"),
  op("ORA", "imm"),
  op("ASL", "acc"),
  ill("ANC", "imm"),
  ill("NOP", "abs"),
  op("ORA", "abs"),
  op("ASL", "abs"),
  ill("SLO", "abs"),

  // 0x10-0x1F
  op("BPL", "rel", "branch"),
  op("ORA", "izy"),
  ill("JAM", "imp", "halt"),
  ill("SLO", "izy"),
  ill("NOP", "zpx"),
  op("ORA", "zpx"),
  op("ASL", "zpx"),
  ill("SLO", "zpx"),
  op("CLC", "imp"),
  op("ORA", "aby"),
  ill("NOP", "imp"),
  ill("SLO", "aby"),
  ill("NOP", "abx"),
  op("ORA", "abx"),
  op("ASL", "abx"),
  ill("SLO", "abx"),

  // 0x20-0x2F
  op("JSR", "abs", "call"),
  op("AND", "izx"),
  ill("JAM", "imp", "halt"),
  ill("RLA", "izx"),
  op("BIT", "zp"),
  op("AND", "zp"),
  op("ROL", "zp"),
  ill("RLA", "zp"),
  op("PLP", "imp"),
  op("AND", "imm"),
  op("ROL", "acc"),
  ill("ANC", "imm"),
  op("BIT", "abs"),
  op("AND", "abs"),
  op("ROL", "abs"),
  ill("RLA", "abs"),

  // 0x30-0x3F
  op("BMI", "rel", "branch"),
  op("AND", "izy"),
  ill("JAM", "imp", "halt"),
  ill("RLA", "izy"),
  ill("NOP", "zpx"),
  op("AND", "zpx"),
  op("ROL", "zpx"),
  ill("RLA", "zpx"),
  op("SEC", "imp"),
  op("AND", "aby"),
  ill("NOP", "imp"),
  ill("RLA", "aby"),
  ill("NOP", "abx"),
  op("AND", "abx"),
  op("ROL", "abx"),
  ill("RLA", "abx"),

  // 0x40-0x4F
  op("RTI", "imp", "ret"),
  op("EOR", "izx"),
  ill("JAM", "imp", "halt"),
  ill("SRE", "izx"),
  ill("NOP", "zp"),
  op("EOR", "zp"),
  op("LSR", "zp"),
  ill("SRE", "zp"),
  op("PHA", "imp"),
  op("EOR", "imm"),
  op("LSR", "acc"),
  ill("ALR", "imm"),
  op("JMP", "abs", "jump"),
  op("EOR", "abs"),
  op("LSR", "abs"),
  ill("SRE", "abs"),

  // 0x50-0x5F
  op("BVC", "rel", "branch"),
  op("EOR", "izy"),
  ill("JAM", "imp", "halt"),
  ill("SRE", "izy"),
  ill("NOP", "zpx"),
  op("EOR", "zpx"),
  op("LSR", "zpx"),
  ill("SRE", "zpx"),
  op("CLI", "imp"),
  op("EOR", "aby"),
  ill("NOP", "imp"),
  ill("SRE", "aby"),
  ill("NOP", "abx"),
  op("EOR", "abx"),
  op("LSR", "abx"),
  ill("SRE", "abx"),

  // 0x60-0x6F
  op("RTS", "imp", "ret"),
  op("ADC", "izx"),
  ill("JAM", "imp", "halt"),
  ill("RRA", "izx"),
  ill("NOP", "zp"),
  op("ADC", "zp"),
  op("ROR", "zp"),
  ill("RRA", "zp"),
  op("PLA", "imp"),
  op("ADC", "imm"),
  op("ROR", "acc"),
  ill("ARR", "imm"),
  op("JMP", "ind", "jump"),
  op("ADC", "abs"),
  op("ROR", "abs"),
  ill("RRA", "abs"),

  // 0x70-0x7F
  op("BVS", "rel", "branch"),
  op("ADC", "izy"),
  ill("JAM", "imp", "halt"),
  ill("RRA", "izy"),
  ill("NOP", "zpx"),
  op("ADC", "zpx"),
  op("ROR", "zpx"),
  ill("RRA", "zpx"),
  op("SEI", "imp"),
  op("ADC", "aby"),
  ill("NOP", "imp"),
  ill("RRA", "aby"),
  ill("NOP", "abx"),
  op("ADC", "abx"),
  op("ROR", "abx"),
  ill("RRA", "abx"),

  // 0x80-0x8F
  ill("NOP", "imm"),
  op("STA", "izx"),
  ill("NOP", "imm"),
  ill("SAX", "izx"),
  op("STY", "zp"),
  op("STA", "zp"),
  op("STX", "zp"),
  ill("SAX", "zp"),
  op("DEY", "imp"),
  ill("NOP", "imm"),
  op("TXA", "imp"),
  ill("ANE", "imm"),
  op("STY", "abs"),
  op("STA", "abs"),
  op("STX", "abs"),
  ill("SAX", "abs"),

  // 0x90-0x9F
  op("BCC", "rel", "branch"),
  op("STA", "izy"),
  ill("JAM", "imp", "halt"),
  ill("SHA", "izy"),
  op("STY", "zpx"),
  op("STA", "zpx"),
  op("STX", "zpy"),
  ill("SAX", "zpy"),
  op("TYA", "imp"),
  op("STA", "aby"),
  op("TXS", "imp"),
  ill("TAS", "aby"),
  ill("SHY", "abx"),
  op("STA", "abx"),
  ill("SHX", "aby"),
  ill("SHA", "aby"),

  // 0xA0-0xAF
  op("LDY", "imm"),
  op("LDA", "izx"),
  op("LDX", "imm"),
  ill("LAX", "izx"),
  op("LDY", "zp"),
  op("LDA", "zp"),
  op("LDX", "zp"),
  ill("LAX", "zp"),
  op("TAY", "imp"),
  op("LDA", "imm"),
  op("TAX", "imp"),
  ill("LXA", "imm"),
  op("LDY", "abs"),
  op("LDA", "abs"),
  op("LDX", "abs"),
  ill("LAX", "abs"),

  // 0xB0-0xBF
  op("BCS", "rel", "branch"),
  op("LDA", "izy"),
  ill("JAM", "imp", "halt"),
  ill("LAX", "izy"),
  op("LDY", "zpx"),
  op("LDA", "zpx"),
  op("LDX", "zpy"),
  ill("LAX", "zpy"),
  op("CLV", "imp"),
  op("LDA", "aby"),
  op("TSX", "imp"),
  ill("LAS", "aby"),
  op("LDY", "abx"),
  op("LDA", "abx"),
  op("LDX", "aby"),
  ill("LAX", "aby"),

  // 0xC0-0xCF
  op("CPY", "imm"),
  op("CMP", "izx"),
  ill("NOP", "imm"),
  ill("DCP", "izx"),
  op("CPY", "zp"),
  op("CMP", "zp"),
  op("DEC", "zp"),
  ill("DCP", "zp"),
  op("INY", "imp"),
  op("CMP", "imm"),
  op("DEX", "imp"),
  ill("SBX", "imm"),
  op("CPY", "abs"),
  op("CMP", "abs"),
  op("DEC", "abs"),
  ill("DCP", "abs"),

  // 0xD0-0xDF
  op("BNE", "rel", "branch"),
  op("CMP", "izy"),
  ill("JAM", "imp", "halt"),
  ill("DCP", "izy"),
  ill("NOP", "zpx"),
  op("CMP", "zpx"),
  op("DEC", "zpx"),
  ill("DCP", "zpx"),
  op("CLD", "imp"),
  op("CMP", "aby"),
  ill("NOP", "imp"),
  ill("DCP", "aby"),
  ill("NOP", "abx"),
  op("CMP", "abx"),
  op("DEC", "abx"),
  ill("DCP", "abx"),

  // 0xE0-0xEF
  op("CPX", "imm"),
  op("SBC", "izx"),
  ill("NOP", "imm"),
  ill("ISC", "izx"),
  op("CPX", "zp"),
  op("SBC", "zp"),
  op("INC", "zp"),
  ill("ISC", "zp"),
  op("INX", "imp"),
  op("SBC", "imm"),
  op("NOP", "imp"),
  ill("USBC", "imm"),
  op("CPX", "abs"),
  op("SBC", "abs"),
  op("INC", "abs"),
  ill("ISC", "abs"),

  // 0xF0-0xFF
  op("BEQ", "rel", "branch"),
  op("SBC", "izy"),
  ill("JAM", "imp", "halt"),
  ill("ISC", "izy"),
  ill("NOP", "zpx"),
  op("SBC", "zpx"),
  op("INC", "zpx"),
  ill("ISC", "zpx"),
  op("SED", "imp"),
  op("SBC", "aby"),
  ill("NOP", "imp"),
  ill("ISC", "aby"),
  ill("NOP", "abx"),
  op("SBC", "abx"),
  op("INC", "abx"),
  ill("ISC", "abx"),
];
