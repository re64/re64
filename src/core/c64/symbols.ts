/**
 * Standard C64 address-space symbols.
 *
 * Hardware registers and KERNAL entry points are facts about the machine, not
 * about any loaded file, so every project used to hand-copy the handful it
 * needed. These are supplied by a platform symbol layer instead.
 *
 * Names follow the conventional C64 register-map abbreviations (the ones used
 * by the Programmer's Reference Guide and every disassembly since). Where a
 * project prefers its own name, its label wins — platform labels rank below
 * user labels, see `LABEL_RANK` in memory/label.ts.
 *
 * Only well-established addresses are listed. A wrong entry here produces
 * silently wrong disassembly, so this table stays conservative rather than
 * exhaustive: no undocumented addresses, no guesses at internal ROM routines
 * beyond the few in universal use.
 */

import { SymbolLayer } from "../memory/symbol-layer.js";
import { createPlatformLabel } from "../memory/label.js";
import { derivedId } from "../project/identity.js";

export interface C64Symbol {
  address: number;
  name: string;
  comment?: string;
}

/** CPU port and data direction register. */
const CPU: C64Symbol[] = [
  { address: 0x0000, name: "D6510", comment: "6510 data direction register" },
  { address: 0x0001, name: "R6510", comment: "6510 I/O port: memory banking" },
];

/** Interrupt and BASIC vectors in low RAM. */
const VECTORS: C64Symbol[] = [
  { address: 0x0314, name: "CINV", comment: "IRQ vector" },
  { address: 0x0316, name: "CBINV", comment: "BRK vector" },
  { address: 0x0318, name: "NMINV", comment: "NMI vector" },
];

/** Default screen and colour memory. */
const MEMORY: C64Symbol[] = [
  { address: 0x0400, name: "SCREEN_RAM", comment: "Default screen memory" },
  { address: 0xd800, name: "COLOR_RAM", comment: "Colour memory (nybbles)" },
];

/** VIC-II, $D000-$D02E. */
const VIC: C64Symbol[] = [
  ...Array.from({ length: 8 }, (_, i) => [
    { address: 0xd000 + i * 2, name: `SP${i}X`, comment: `Sprite ${i} X position` },
    { address: 0xd001 + i * 2, name: `SP${i}Y`, comment: `Sprite ${i} Y position` },
  ]).flat(),
  { address: 0xd010, name: "MSIGX", comment: "Sprite X position MSBs" },
  { address: 0xd011, name: "SCROLY", comment: "VIC control 1: Y scroll, raster MSB" },
  { address: 0xd012, name: "RASTER", comment: "Raster line" },
  { address: 0xd013, name: "LPENX", comment: "Light pen X" },
  { address: 0xd014, name: "LPENY", comment: "Light pen Y" },
  { address: 0xd015, name: "SPENA", comment: "Sprite enable" },
  { address: 0xd016, name: "SCROLX", comment: "VIC control 2: X scroll, multicolour" },
  { address: 0xd017, name: "YXPAND", comment: "Sprite Y expand" },
  { address: 0xd018, name: "VMCSB", comment: "Screen and charset memory pointers" },
  { address: 0xd019, name: "VICIRQ", comment: "VIC interrupt flags" },
  { address: 0xd01a, name: "IRQMASK", comment: "VIC interrupt enable" },
  { address: 0xd01b, name: "SPBGPR", comment: "Sprite to background priority" },
  { address: 0xd01c, name: "SPMC", comment: "Sprite multicolour enable" },
  { address: 0xd01d, name: "XXPAND", comment: "Sprite X expand" },
  { address: 0xd01e, name: "SPSPCL", comment: "Sprite to sprite collision" },
  { address: 0xd01f, name: "SPBGCL", comment: "Sprite to background collision" },
  { address: 0xd020, name: "EXTCOL", comment: "Border colour" },
  { address: 0xd021, name: "BGCOL0", comment: "Background colour 0" },
  { address: 0xd022, name: "BGCOL1", comment: "Background colour 1" },
  { address: 0xd023, name: "BGCOL2", comment: "Background colour 2" },
  { address: 0xd024, name: "BGCOL3", comment: "Background colour 3" },
  { address: 0xd025, name: "SPMC0", comment: "Sprite multicolour 0" },
  { address: 0xd026, name: "SPMC1", comment: "Sprite multicolour 1" },
  ...Array.from({ length: 8 }, (_, i) => ({
    address: 0xd027 + i,
    name: `SP${i}COL`,
    comment: `Sprite ${i} colour`,
  })),
];

/** SID, $D400-$D41C. Three identical voices then filter and read-only registers. */
const SID: C64Symbol[] = [
  ...Array.from({ length: 3 }, (_, v) => {
    const base = 0xd400 + v * 7;
    const n = v + 1;
    return [
      { address: base + 0, name: `V${n}FREQLO`, comment: `Voice ${n} frequency low` },
      { address: base + 1, name: `V${n}FREQHI`, comment: `Voice ${n} frequency high` },
      { address: base + 2, name: `V${n}PWLO`, comment: `Voice ${n} pulse width low` },
      { address: base + 3, name: `V${n}PWHI`, comment: `Voice ${n} pulse width high` },
      { address: base + 4, name: `V${n}CTRL`, comment: `Voice ${n} control: waveform, gate` },
      { address: base + 5, name: `V${n}AD`, comment: `Voice ${n} attack/decay` },
      { address: base + 6, name: `V${n}SR`, comment: `Voice ${n} sustain/release` },
    ];
  }).flat(),
  { address: 0xd415, name: "FCLO", comment: "Filter cutoff low" },
  { address: 0xd416, name: "FCHI", comment: "Filter cutoff high" },
  { address: 0xd417, name: "RESON", comment: "Filter resonance and routing" },
  { address: 0xd418, name: "SIGVOL", comment: "Filter mode and master volume" },
  { address: 0xd419, name: "POTX", comment: "Paddle X (read only)" },
  { address: 0xd41a, name: "POTY", comment: "Paddle Y (read only)" },
  { address: 0xd41b, name: "RANDOM", comment: "Voice 3 oscillator output (read only)" },
  { address: 0xd41c, name: "ENV3", comment: "Voice 3 envelope output (read only)" },
];

/** The two CIAs share a register layout. */
function cia(base: number, prefix: string, n: number): C64Symbol[] {
  return [
    { address: base + 0x0, name: `${prefix}PRA`, comment: `CIA ${n} port A` },
    { address: base + 0x1, name: `${prefix}PRB`, comment: `CIA ${n} port B` },
    { address: base + 0x2, name: `${prefix}DDRA`, comment: `CIA ${n} port A direction` },
    { address: base + 0x3, name: `${prefix}DDRB`, comment: `CIA ${n} port B direction` },
    { address: base + 0x4, name: `${prefix}TALO`, comment: `CIA ${n} timer A low` },
    { address: base + 0x5, name: `${prefix}TAHI`, comment: `CIA ${n} timer A high` },
    { address: base + 0x6, name: `${prefix}TBLO`, comment: `CIA ${n} timer B low` },
    { address: base + 0x7, name: `${prefix}TBHI`, comment: `CIA ${n} timer B high` },
    { address: base + 0x8, name: `${prefix}TOD10`, comment: `CIA ${n} time of day tenths` },
    { address: base + 0x9, name: `${prefix}TODSEC`, comment: `CIA ${n} time of day seconds` },
    { address: base + 0xa, name: `${prefix}TODMIN`, comment: `CIA ${n} time of day minutes` },
    { address: base + 0xb, name: `${prefix}TODHR`, comment: `CIA ${n} time of day hours` },
    { address: base + 0xc, name: `${prefix}SDR`, comment: `CIA ${n} serial data` },
    { address: base + 0xd, name: `${prefix}ICR`, comment: `CIA ${n} interrupt control` },
    { address: base + 0xe, name: `${prefix}CRA`, comment: `CIA ${n} control A` },
    { address: base + 0xf, name: `${prefix}CRB`, comment: `CIA ${n} control B` },
  ];
}

/**
 * KERNAL jump table, $FF81-$FFF3.
 *
 * The documented, version-stable entry points. Internal ROM addresses are not
 * listed except the three below, which predate the jump table in common use.
 */
const KERNAL: C64Symbol[] = [
  { address: 0xfd15, name: "ROM_RESTOR", comment: "Restore default I/O vectors" },
  { address: 0xfd50, name: "ROM_RAMTAS", comment: "RAM test and pointer init" },
  { address: 0xfda3, name: "ROM_IOINIT", comment: "Initialise the CIAs, the 6510 port, SID volume and the jiffy timer" },

  { address: 0xff81, name: "CINT", comment: "Initialise the screen editor, the VIC-II and PAL/NTSC timing" },
  { address: 0xff84, name: "IOINIT", comment: "Initialise the CIAs, the 6510 port, SID volume and the jiffy timer" },
  { address: 0xff87, name: "RAMTAS", comment: "Clear low memory, size the RAM, set the memory pointers" },
  { address: 0xff8a, name: "RESTOR", comment: "Restore default I/O vectors" },
  { address: 0xff8d, name: "VECTOR", comment: "Read/set I/O vectors" },
  { address: 0xff90, name: "SETMSG", comment: "Set KERNAL message control" },
  { address: 0xff93, name: "SECOND", comment: "Send secondary address after LISTEN" },
  { address: 0xff96, name: "TKSA", comment: "Send secondary address after TALK" },
  { address: 0xff99, name: "MEMTOP", comment: "Read/set top of memory" },
  { address: 0xff9c, name: "MEMBOT", comment: "Read/set bottom of memory" },
  { address: 0xff9f, name: "SCNKEY", comment: "Scan keyboard" },
  { address: 0xffa2, name: "SETTMO", comment: "Set the IEEE-488 timeout flag - not used by this KERNAL" },
  { address: 0xffa5, name: "ACPTR", comment: "Read byte from serial bus" },
  { address: 0xffa8, name: "CIOUT", comment: "Send byte to serial bus - buffered until the next byte or UNLSN" },
  { address: 0xffab, name: "UNTLK", comment: "Send UNTALK" },
  { address: 0xffae, name: "UNLSN", comment: "Send UNLISTEN" },
  { address: 0xffb1, name: "LISTEN", comment: "Send LISTEN" },
  { address: 0xffb4, name: "TALK", comment: "Send TALK" },
  { address: 0xffb7, name: "READST", comment: "Read the I/O status word; for RS-232 it also clears it" },
  { address: 0xffba, name: "SETLFS", comment: "Set logical file parameters" },
  { address: 0xffbd, name: "SETNAM", comment: "Set filename" },
  { address: 0xffc0, name: "OPEN", comment: "Open a logical file" },
  { address: 0xffc3, name: "CLOSE", comment: "Close a logical file" },
  { address: 0xffc6, name: "CHKIN", comment: "Set channel for input" },
  { address: 0xffc9, name: "CHKOUT", comment: "Set channel for output" },
  { address: 0xffcc, name: "CLRCHN", comment: "Restore default channels" },
  { address: 0xffcf, name: "CHRIN", comment: "Read byte from input channel" },
  { address: 0xffd2, name: "CHROUT", comment: "Write byte to output channel" },
  { address: 0xffd5, name: "LOAD", comment: "Load or verify a file from a device" },
  { address: 0xffd8, name: "SAVE", comment: "Save to device" },
  { address: 0xffdb, name: "SETTIM", comment: "Set jiffy clock" },
  { address: 0xffde, name: "RDTIM", comment: "Read the jiffy clock - it also writes it back and does CLI" },
  { address: 0xffe1, name: "STOP", comment: "Test STOP key" },
  { address: 0xffe4, name: "GETIN", comment: "Read a byte from the input channel without waiting" },
  { address: 0xffe7, name: "CLALL", comment: "Forget all open files and restore the default channels" },
  { address: 0xffea, name: "UDTIM", comment: "Increment the jiffy clock and sample the STOP key" },
  { address: 0xffed, name: "SCREEN", comment: "Return screen size" },
  { address: 0xfff0, name: "PLOT", comment: "Read/set cursor position" },
  { address: 0xfff3, name: "IOBASE", comment: "Return I/O base address" },
];

/** Hardware vectors at the top of memory. */
const HARDWARE_VECTORS: C64Symbol[] = [
  { address: 0xfffa, name: "NMI_VECTOR", comment: "NMI vector" },
  { address: 0xfffc, name: "RESET_VECTOR", comment: "Reset vector" },
  { address: 0xfffe, name: "IRQ_VECTOR", comment: "IRQ/BRK vector" },
];

/**
 * KERNAL and editor zero page.
 *
 * Where the KERNAL keeps its working state. On this machine zero page is the
 * variable space, so a program that calls the KERNAL reads and writes these
 * whether it means to or not.
 */
const ZP: C64Symbol[] = [
  { address: 0x0090, name: "STATUS", comment: "The I/O status word (ST). Every serial, tape and RS-232 routine ORs into it; READST returns it." },
  { address: 0x0091, name: "STKEY", comment: "Raw CIA1 PRB reading of the STOP key column, written by UDTIM and read by STOP." },
  { address: 0x0092, name: "SVXT", comment: "Tape timing constant." },
  { address: 0x0093, name: "VERCK", comment: "0 = load, non-zero = verify. Set by LOAD from A." },
  { address: 0x0094, name: "C3PO", comment: "Serial bus: a byte is buffered in BSOUR waiting to be sent." },
  { address: 0x0095, name: "BSOUR", comment: "Serial bus byte buffer - where CIOUT parks its argument." },
  { address: 0x0096, name: "SYNO", comment: "Tape block synchronisation." },
  { address: 0x0097, name: "XSAV", comment: "Temporary save of X inside CHRIN/GETIN." },
  { address: 0x0098, name: "LDTND", comment: "Number of open files, and the index into LAT/FAT/SAT. Max 10." },
  { address: 0x0099, name: "DFLTN", comment: "Default input device. 0 = keyboard. Set by CHKIN, cleared by CLRCHN." },
  { address: 0x009a, name: "DFLTO", comment: "Default output device. 3 = screen. Set by CHKOUT, reset by CLRCHN." },
  { address: 0x009b, name: "PRTY", comment: "Tape parity." },
  { address: 0x009c, name: "DPSW", comment: "Tape byte-received flag." },
  { address: 0x009d, name: "MSGFLG", comment: "KERNAL message control, set by SETMSG. Bit 7 control messages, bit 6 errors." },
  { address: 0x009e, name: "PTR1", comment: "Tape error log index / temp." },
  { address: 0x009f, name: "PTR2", comment: "Tape error correction index / temp." },
  { address: 0x00a0, name: "TIME", comment: "Jiffy clock, three bytes, BIG-endian ($A0 high). SETTIM/RDTIM/UDTIM." },
  { address: 0x00a3, name: "R2D2", comment: "Serial EOI flag / tape bit counter." },
  { address: 0x00a4, name: "BSOUR1", comment: "Serial byte being shifted in by ACPTR / tape shift register." },
  { address: 0x00a5, name: "COUNT", comment: "Serial bit counter." },
  { address: 0x00a6, name: "BUFPT", comment: "Tape buffer index." },
  { address: 0x00a7, name: "INBIT", comment: "RS-232 received bit." },
  { address: 0x00a8, name: "BITCI", comment: "RS-232 input bit count." },
  { address: 0x00a9, name: "RINONE", comment: "RS-232 start bit check." },
  { address: 0x00aa, name: "RIDATA", comment: "RS-232 input byte being assembled." },
  { address: 0x00ab, name: "RIPRTY", comment: "RS-232 input parity." },
  { address: 0x00ac, name: "SAL", comment: "Start-of-block pointer for tape and screen scrolling." },
  { address: 0x00ae, name: "EAL", comment: "End address of the current load/save. LOAD returns it in X/Y from here." },
  { address: 0x00b0, name: "CMP0", comment: "Tape timing constants." },
  { address: 0x00b2, name: "TAPE1", comment: "Pointer to the tape buffer; RAMTAS sets it to $033C." },
  { address: 0x00b4, name: "BITTS", comment: "RS-232 output bit count." },
  { address: 0x00b5, name: "NXTBIT", comment: "RS-232 next bit to send." },
  { address: 0x00b6, name: "RODATA", comment: "RS-232 output byte." },
  { address: 0x00b7, name: "FNLEN", comment: "Filename length, set by SETNAM." },
  { address: 0x00b8, name: "LA", comment: "Current logical file number, set by SETLFS." },
  { address: 0x00b9, name: "SA", comment: "Current secondary address, set by SETLFS." },
  { address: 0x00ba, name: "FA", comment: "Current device number, set by SETLFS. READST switches on it." },
  { address: 0x00bb, name: "FNADR", comment: "Pointer to the filename, set by SETNAM." },
  { address: 0x00bd, name: "ROPRTY", comment: "RS-232 output parity." },
  { address: 0x00be, name: "FSBLK", comment: "Tape block counter." },
  { address: 0x00bf, name: "MYCH", comment: "Serial word buffer." },
  { address: 0x00c0, name: "CAS1", comment: "Tape motor interlock; the IRQ handler switches the motor on $01 bit 5 from it." },
  { address: 0x00c1, name: "STAL", comment: "Start address for LOAD/SAVE. SAVE fetches it from the zero-page pointer you name." },
  { address: 0x00c3, name: "MEMUSS", comment: "Load address for a secondary-address-0 LOAD; also RESTOR/VECTOR's scratch pointer." },
  { address: 0x00c5, name: "LSTX", comment: "Matrix code of the key last read; $40 = none." },
  { address: 0x00c6, name: "NDX", comment: "Number of characters in the keyboard buffer." },
  { address: 0x00c7, name: "RVS", comment: "Reverse-video flag for the screen editor." },
  { address: 0x00c8, name: "INDX", comment: "End-of-line pointer for input." },
  { address: 0x00c9, name: "LSXP", comment: "Cursor row at the start of the input line." },
  { address: 0x00ca, name: "LSTP", comment: "Cursor column at the start of the input line." },
  { address: 0x00cb, name: "SFDX", comment: "Matrix code of the key currently down." },
  { address: 0x00cc, name: "BLNSW", comment: "Cursor blink enable; 0 = blinking." },
  { address: 0x00cd, name: "BLNCT", comment: "Cursor blink countdown." },
  { address: 0x00ce, name: "GDBLN", comment: "Character under the cursor." },
  { address: 0x00cf, name: "BLNON", comment: "Cursor blink phase." },
  { address: 0x00d0, name: "CRSW", comment: "Input from keyboard (0) or from the screen (3)." },
  { address: 0x00d1, name: "PNT", comment: "Pointer to the start of the current screen line." },
  { address: 0x00d3, name: "PNTR", comment: "Cursor column on the current line." },
  { address: 0x00d4, name: "QTSW", comment: "Quote mode flag." },
  { address: 0x00d5, name: "LNMX", comment: "Physical length of the current logical line, 39 or 79." },
  { address: 0x00d6, name: "TBLX", comment: "Current cursor row." },
  { address: 0x00d8, name: "INSRT", comment: "Insert-mode character count." },
  { address: 0x00d9, name: "LDTB1", comment: "Screen line link table, 26 bytes. Bit 7 marks the start of a logical line." },
  { address: 0x00f3, name: "USER", comment: "Pointer to the colour RAM line matching PNT." },
  { address: 0x00f5, name: "KEYTAB", comment: "Pointer to the keyboard decode table SCNKEY selected." },
  { address: 0x00f7, name: "RIBUF", comment: "Pointer to the RS-232 input buffer." },
  { address: 0x00f9, name: "ROBUF", comment: "Pointer to the RS-232 output buffer." },
  { address: 0x00fb, name: "FREEZP", comment: "Four bytes of zero page the KERNAL does not use." },
];

/** KERNAL working storage and vectors in low RAM. */
const LOWRAM: C64Symbol[] = [
  { address: 0x0200, name: "BUF", comment: "BASIC input buffer, 89 bytes; CHRIN's line editor fills it." },
  { address: 0x0259, name: "LAT", comment: "Logical file number table, 10 entries." },
  { address: 0x0263, name: "FAT", comment: "Device number table, 10 entries." },
  { address: 0x026d, name: "SAT", comment: "Secondary address table, 10 entries." },
  { address: 0x0277, name: "KEYD", comment: "Keyboard buffer, 10 bytes." },
  { address: 0x0281, name: "MEMSTR", comment: "Bottom of BASIC RAM; MEMBOT reads and writes it." },
  { address: 0x0283, name: "MEMSIZ", comment: "Top of BASIC RAM; MEMTOP reads and writes it, RAMTAS sets it." },
  { address: 0x0285, name: "TIMOUT", comment: "IEEE-488 timeout flag, set by SETTMO and read by nothing in this ROM." },
  { address: 0x0286, name: "COLOR", comment: "Current character colour for the screen editor." },
  { address: 0x0287, name: "GDCOL", comment: "Colour under the cursor." },
  { address: 0x0288, name: "HIBASE", comment: "High byte of the screen memory page. $04 after RAMTAS." },
  { address: 0x0289, name: "XMAX", comment: "Maximum keyboard buffer size, 10 by default." },
  { address: 0x028a, name: "RPTFLG", comment: "Key repeat control." },
  { address: 0x028b, name: "KOUNT", comment: "Key repeat speed counter." },
  { address: 0x028c, name: "DELAY", comment: "Key repeat delay counter." },
  { address: 0x028d, name: "SHFLAG", comment: "SHIFT / CTRL / Commodore key flags, built by SCNKEY." },
  { address: 0x028e, name: "LSTSHF", comment: "Previous SHFLAG, for the SHIFT+C= charset toggle." },
  { address: 0x028f, name: "KEYLOG", comment: "Vector to the keyboard decode routine. Default $EB48. SCNKEY ends with JMP ($028F)." },
  { address: 0x0291, name: "MODE", comment: "Whether SHIFT+Commodore may switch the character set." },
  { address: 0x0292, name: "AUTODN", comment: "Screen scroll-down enable." },
  { address: 0x0293, name: "M51CTR", comment: "RS-232 control register image." },
  { address: 0x0294, name: "M51CDR", comment: "RS-232 command register image." },
  { address: 0x0295, name: "M51AJB", comment: "RS-232 non-standard bit timing, taken from the baud table." },
  { address: 0x0297, name: "RSSTAT", comment: "RS-232 status. READST returns it and CLEARS it when FA = 2." },
  { address: 0x0298, name: "BITNUM", comment: "RS-232 number of bits left to send." },
  { address: 0x0299, name: "BAUDOF", comment: "RS-232 baud rate half-bit time." },
  { address: 0x029b, name: "RIDBE", comment: "RS-232 input buffer end index." },
  { address: 0x029c, name: "RIDBS", comment: "RS-232 input buffer start index." },
  { address: 0x029d, name: "RODBS", comment: "RS-232 output buffer start index." },
  { address: 0x029e, name: "RODBE", comment: "RS-232 output buffer end index." },
  { address: 0x029f, name: "IRQTMP", comment: "Saved CINV while the tape routines own the IRQ." },
  { address: 0x02a1, name: "ENABL", comment: "RS-232 NMI enables." },
  { address: 0x02a2, name: "CASTON", comment: "CIA1 CRA image during tape operations." },
  { address: 0x02a3, name: "KIKA26", comment: "Temporary store during tape I/O." },
  { address: 0x02a4, name: "STUPID", comment: "CIA1 ICR image during tape I/O." },
  { address: 0x02a5, name: "LINTMP", comment: "Temporary screen line index." },
  { address: 0x02a6, name: "PALNTS", comment: "0 = NTSC, 1 = PAL. Set by CINT from the raster; chooses the jiffy timer value at $FDDD and the RS-232 baud table at $F42C. Arguably the single most useful address missing from the table." },
  { address: 0x0300, name: "IERROR", comment: "BASIC vector: print an error message." },
  { address: 0x0302, name: "IMAIN", comment: "BASIC vector: main loop." },
  { address: 0x0304, name: "ICRNCH", comment: "BASIC vector: tokenise." },
  { address: 0x0306, name: "IQPLOP", comment: "BASIC vector: list a token." },
  { address: 0x0308, name: "IGONE", comment: "BASIC vector: execute a statement." },
  { address: 0x030a, name: "IEVAL", comment: "BASIC vector: evaluate a term." },
  { address: 0x030c, name: "SAREG", comment: "A for SYS." },
  { address: 0x030d, name: "SXREG", comment: "X for SYS." },
  { address: 0x030e, name: "SYREG", comment: "Y for SYS." },
  { address: 0x030f, name: "SPREG", comment: "Status for SYS." },
  { address: 0x0310, name: "USRPOK", comment: "USR() jump instruction, three bytes." },
  { address: 0x031a, name: "IOPEN", comment: "OPEN vector. $FFC0 is JMP ($031A). Default $F34A." },
  { address: 0x031c, name: "ICLOSE", comment: "CLOSE vector. Default $F291." },
  { address: 0x031e, name: "ICHKIN", comment: "CHKIN vector. Default $F20E." },
  { address: 0x0320, name: "ICKOUT", comment: "CHKOUT vector. Default $F250." },
  { address: 0x0322, name: "ICLRCH", comment: "CLRCHN vector. Default $F333." },
  { address: 0x0324, name: "IBASIN", comment: "CHRIN vector. Default $F157." },
  { address: 0x0326, name: "IBSOUT", comment: "CHROUT vector. Default $F1CA." },
  { address: 0x0328, name: "ISTOP", comment: "STOP vector. Default $F6ED." },
  { address: 0x032a, name: "IGETIN", comment: "GETIN vector. Default $F13E." },
  { address: 0x032c, name: "ICLALL", comment: "CLALL vector. Default $F32F." },
  { address: 0x032e, name: "USRCMD", comment: "Unused vector, default $FE66." },
  { address: 0x0330, name: "ILOAD", comment: "LOAD vector. Default $F4A5." },
  { address: 0x0332, name: "ISAVE", comment: "SAVE vector. Default $F5ED." },
  { address: 0x033c, name: "TBUFFR", comment: "Tape buffer, 192 bytes." },
];

/**
 * KERNAL ROM internals: the implementations behind the jump table, and
 * the tables they read.
 *
 * Named because the documented entry points are mostly three-byte jumps and a
 * listing that stops there says nothing.
 *
 * The suffix is `_IMPL` rather than a `ROM_` prefix because a project may well
 * name the *jump table* entry `ROM_CHROUT` — the reference disassembly of
 * Gridrunner does exactly that for $FFD2 — and calling $F1CA the same thing
 * leaves the name identifying neither. `ROM_RESTOR`, `ROM_RAMTAS` and
 * `ROM_IOINIT` keep the prefix: those three names were chosen independently by
 * that same human disassembly and matching it is evidence worth keeping. Fifteen of them go through a RAM
 * vector, so these are also the addresses to declare when a program hooks one.
 */
const ROMINT: C64Symbol[] = [
  { address: 0xe4ec, name: "BAUD_TABLE_PAL", comment: "RS-232 bit timing, PAL. Read as $E4EA,X." },
  { address: 0xe500, name: "IOBASE_IMPL", comment: "Implementation of $FFF3." },
  { address: 0xe505, name: "SCREEN_IMPL", comment: "Implementation of $FFED." },
  { address: 0xe50a, name: "PLOT_IMPL", comment: "Implementation of $FFF0." },
  { address: 0xe518, name: "ROM_INIT_EDITOR", comment: "Initialise the VIC and the screen editor; the first half of CINT." },
  { address: 0xe544, name: "ROM_CLRSCR", comment: "Clear the screen." },
  { address: 0xe566, name: "ROM_HOME", comment: "Home the cursor." },
  { address: 0xe56c, name: "ROM_SET_SCREEN_PTR", comment: "Recompute PNT, USER and LNMX from TBLX and PNTR." },
  { address: 0xe5a0, name: "ROM_INIT_VIC", comment: "Copy the VIC table at $ECB9 into $D000-$D02E; set DFLTN/DFLTO." },
  { address: 0xe5b4, name: "ROM_KEY_FROM_BUFFER", comment: "Take one character out of KEYD and shift the buffer down." },
  { address: 0xe716, name: "ROM_SCREEN_OUT", comment: "The screen editor's character output - where CHROUT goes for device 3." },
  { address: 0xe8cb, name: "ROM_SET_COLOR_CODE", comment: "Match a PETSCII colour code against the table at $E8DA and set COLOR." },
  { address: 0xe8da, name: "COLOR_CODE_TABLE", comment: "The sixteen PETSCII colour codes in colour order." },
  { address: 0xe9f0, name: "ROM_SCREEN_LINE_ADDR", comment: "Screen line address from the table at $ECF0." },
  { address: 0xea31, name: "ROM_IRQ_MAIN", comment: "Default CINV handler: UDTIM, cursor blink, cassette motor, SCNKEY." },
  { address: 0xea87, name: "SCNKEY_IMPL", comment: "Implementation of $FF9F." },
  { address: 0xeb48, name: "ROM_KEYLOG_DEFAULT", comment: "Default KEYLOG routine; selects the decode table. Reached only through JMP ($028F), so nothing static finds it." },
  { address: 0xeb79, name: "KEYBOARD_TABLE_PTRS", comment: "Four pointers to the keyboard matrix tables." },
  { address: 0xeb81, name: "KEYTAB_UNSHIFTED", comment: "Keyboard matrix to PETSCII, no modifier, 65 bytes." },
  { address: 0xebc2, name: "KEYTAB_SHIFTED", comment: "Keyboard matrix to PETSCII, SHIFT." },
  { address: 0xec03, name: "KEYTAB_CBM", comment: "Keyboard matrix to PETSCII, Commodore key." },
  { address: 0xec78, name: "KEYTAB_CONTROL", comment: "Keyboard matrix to PETSCII, CTRL." },
  { address: 0xecb9, name: "VIC_INIT_TABLE", comment: "47 bytes copied to $D000-$D02E by $E5AA." },
  { address: 0xece7, name: "SHIFT_RUNSTOP_TEXT", comment: "\"LOAD<CR>RUN<CR>\", stuffed into KEYD by SHIFT+RUN/STOP." },
  { address: 0xecf0, name: "SCREEN_LINE_LO", comment: "Low bytes of the 25 screen line starts." },
  { address: 0xed09, name: "TALK_IMPL", comment: "Implementation of $FFB4." },
  { address: 0xed0c, name: "LISTEN_IMPL", comment: "Implementation of $FFB1." },
  { address: 0xedb9, name: "SECOND_IMPL", comment: "Implementation of $FF93." },
  { address: 0xedc7, name: "TKSA_IMPL", comment: "Implementation of $FF96." },
  { address: 0xeddd, name: "CIOUT_IMPL", comment: "Implementation of $FFA8." },
  { address: 0xedef, name: "UNTLK_IMPL", comment: "Implementation of $FFAB." },
  { address: 0xedfe, name: "UNLSN_IMPL", comment: "Implementation of $FFAE." },
  { address: 0xee13, name: "ACPTR_IMPL", comment: "Implementation of $FFA5." },
  { address: 0xee85, name: "ROM_CLKHI", comment: "Serial bus: release CLOCK." },
  { address: 0xee8e, name: "ROM_CLKLO", comment: "Serial bus: pull CLOCK low." },
  { address: 0xee97, name: "ROM_DATAHI", comment: "Serial bus: release DATA." },
  { address: 0xeea0, name: "ROM_DATALO", comment: "Serial bus: pull DATA low." },
  { address: 0xeea9, name: "ROM_DEBPIA", comment: "Serial bus: debounced read of CIA2 PRA into the carry/sign." },
  { address: 0xf0bd, name: "KERNAL_MESSAGES", comment: "The ten KERNAL messages, PETSCII with bit 7 marking the last character." },
  { address: 0xf12b, name: "ROM_PRINT_MSG_IF_ENABLED", comment: "Print the message at offset Y if MSGFLG allows." },
  { address: 0xf12f, name: "ROM_PRINT_MSG", comment: "Print the message at offset Y unconditionally." },
  { address: 0xf13e, name: "GETIN_IMPL", comment: "Default IGETIN." },
  { address: 0xf157, name: "CHRIN_IMPL", comment: "Default IBASIN." },
  { address: 0xf1ca, name: "CHROUT_IMPL", comment: "Default IBSOUT." },
  { address: 0xf20e, name: "CHKIN_IMPL", comment: "Default ICHKIN." },
  { address: 0xf250, name: "CHKOUT_IMPL", comment: "Default ICKOUT." },
  { address: 0xf291, name: "CLOSE_IMPL", comment: "Default ICLOSE." },
  { address: 0xf32f, name: "CLALL_IMPL", comment: "Default ICLALL." },
  { address: 0xf333, name: "CLRCHN_IMPL", comment: "Default ICLRCH." },
  { address: 0xf34a, name: "OPEN_IMPL", comment: "Default IOPEN." },
  { address: 0xf49e, name: "ROM_LOAD_VECTORED", comment: "The $FFD5 stub: stores X/Y in MEMUSS then JMP (ILOAD)." },
  { address: 0xf4a5, name: "LOAD_IMPL", comment: "Default ILOAD." },
  { address: 0xf5dd, name: "ROM_SAVE_VECTORED", comment: "The $FFD8 stub: stores X/Y in EAL and the pointer in STAL, then JMP (ISAVE)." },
  { address: 0xf5ed, name: "SAVE_IMPL", comment: "Default ISAVE." },
  { address: 0xf69b, name: "UDTIM_IMPL", comment: "Implementation of $FFEA." },
  { address: 0xf6dd, name: "RDTIM_IMPL", comment: "Implementation of $FFDE; falls through into SETTIM." },
  { address: 0xf6e4, name: "SETTIM_IMPL", comment: "Implementation of $FFDB." },
  { address: 0xf6ed, name: "STOP_IMPL", comment: "Default ISTOP." },
  { address: 0xf6fb, name: "ROM_ERROR1", comment: "KERNAL error 1, TOO MANY FILES. Nine LDA #n / .BYTE $2C entries, $F6FB to $F713." },
  { address: 0xf6fe, name: "ROM_ERROR2", comment: "FILE OPEN." },
  { address: 0xf701, name: "ROM_ERROR3", comment: "FILE NOT OPEN." },
  { address: 0xf704, name: "ROM_ERROR4", comment: "FILE NOT FOUND." },
  { address: 0xf707, name: "ROM_ERROR5", comment: "DEVICE NOT PRESENT." },
  { address: 0xf70a, name: "ROM_ERROR6", comment: "NOT INPUT FILE." },
  { address: 0xf70d, name: "ROM_ERROR7", comment: "NOT OUTPUT FILE." },
  { address: 0xf710, name: "ROM_ERROR8", comment: "MISSING FILE NAME." },
  { address: 0xf713, name: "ROM_ERROR9", comment: "ILLEGAL DEVICE NUMBER." },
  { address: 0xfce2, name: "ROM_RESET", comment: "Reset entry, from $FFFC." },
  { address: 0xfd02, name: "ROM_CHECK_CARTRIDGE", comment: "Compare $8004-$8008 against the CBM80 signature at $FD10." },
  { address: 0xfd10, name: "CBM80_SIGNATURE", comment: "\"CBM80\" in PETSCII." },
  { address: 0xfd1a, name: "VECTOR_IMPL", comment: "Implementation of $FF8D." },
  { address: 0xfd30, name: "DEFAULT_VECTORS", comment: "The 32 default bytes RESTOR copies into $0314-$0333." },
  { address: 0xfd9b, name: "TAPE_IRQ_VECTORS", comment: "Four handlers the tape code installs into CINV: $FC6A, $FBCD, $EA31, $F92C. Declaring this a jumptable is what makes 451 instructions of tape code decode." },
  { address: 0xfddd, name: "ROM_SET_JIFFY_TIMER", comment: "Set CIA1 timer A from PALNTS. IOINIT falls into it; CINT jumps to it." },
  { address: 0xfdf9, name: "SETNAM_IMPL", comment: "Implementation of $FFBD." },
  { address: 0xfe00, name: "SETLFS_IMPL", comment: "Implementation of $FFBA." },
  { address: 0xfe07, name: "READST_IMPL", comment: "Implementation of $FFB7." },
  { address: 0xfe18, name: "SETMSG_IMPL", comment: "Implementation of $FF90." },
  { address: 0xfe1c, name: "ROM_OR_INTO_STATUS", comment: "OR A into STATUS ($90) and return it. The KERNAL's own way of setting ST." },
  { address: 0xfe21, name: "SETTMO_IMPL", comment: "Implementation of $FFA2." },
  { address: 0xfe25, name: "MEMTOP_IMPL", comment: "Implementation of $FF99." },
  { address: 0xfe34, name: "MEMBOT_IMPL", comment: "Implementation of $FF9C." },
  { address: 0xfe43, name: "ROM_NMI_ENTRY", comment: "NMI entry from $FFFA: SEI, JMP (NMINV)." },
  { address: 0xfe47, name: "ROM_NMI_MAIN", comment: "Default NMINV: RESTORE key and the RS-232 engine." },
  { address: 0xfe66, name: "ROM_BRK_ENTRY", comment: "Default CBINV, and the default USRCMD." },
  { address: 0xfec2, name: "BAUD_TABLE_NTSC", comment: "RS-232 bit timing, NTSC. Read as $FEC0,X, so nothing references $FEC2." },
  { address: 0xff43, name: "ROM_FAKE_IRQ", comment: "Clears the B flag on the stacked status and falls into the IRQ handler, so the tape code can enter it from a JSR." },
  { address: 0xff48, name: "ROM_IRQ_ENTRY", comment: "IRQ/BRK entry from $FFFE; splits to CBINV or CINV on the stacked B flag." },
  { address: 0xff5b, name: "CINT_IMPL", comment: "Implementation of $FF81." },
  { address: 0xff6e, name: "ROM_RESTORE_CIA1_TIMER", comment: "Re-enable and start CIA1 timer A after tape I/O." },
  { address: 0xff80, name: "KERNAL_REVISION", comment: "$03. The documented way to identify 901227-03." },
  { address: 0xfff6, name: "ROM_SIGNATURE", comment: "\"RRBY\". Nothing reads it." },
];

/** Every standard C64 symbol, sorted by address. */
export const C64_SYMBOLS: readonly C64Symbol[] = [
  ...CPU,
  ...VECTORS,
  ...MEMORY,
  ...VIC,
  ...SID,
  ...cia(0xdc00, "CIA1", 1),
  ...cia(0xdd00, "CIA2", 2),
  ...KERNAL,
  ...ZP,
  ...LOWRAM,
  ...ROMINT,
  ...HARDWARE_VECTORS,
].sort((a, b) => a.address - b.address);

/**
 * The platform symbol layer, to sit at the bottom of the stack.
 *
 * Its labels rank below everything a project declares, so a project that
 * prefers `ROM_CHROUT` to `CHROUT` keeps its own name.
 */
export function createC64PlatformLayer(): SymbolLayer {
  return new SymbolLayer(
    "c64",
    // Derived, not minted: the built-in set must have the same ids everywhere.
    C64_SYMBOLS.map((s) =>
      createPlatformLabel(
        derivedId("lbl", "c64", s.address),
        s.address,
        s.name,
        "address",
        s.comment
      )
    )
  );
}
