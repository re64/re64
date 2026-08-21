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
  { address: 0xfda3, name: "ROM_IOINIT", comment: "Initialise CIA I/O" },

  { address: 0xff81, name: "CINT", comment: "Initialise screen editor" },
  { address: 0xff84, name: "IOINIT", comment: "Initialise I/O devices" },
  { address: 0xff87, name: "RAMTAS", comment: "Initialise RAM" },
  { address: 0xff8a, name: "RESTOR", comment: "Restore default I/O vectors" },
  { address: 0xff8d, name: "VECTOR", comment: "Read/set I/O vectors" },
  { address: 0xff90, name: "SETMSG", comment: "Set KERNAL message control" },
  { address: 0xff93, name: "SECOND", comment: "Send secondary address after LISTEN" },
  { address: 0xff96, name: "TKSA", comment: "Send secondary address after TALK" },
  { address: 0xff99, name: "MEMTOP", comment: "Read/set top of memory" },
  { address: 0xff9c, name: "MEMBOT", comment: "Read/set bottom of memory" },
  { address: 0xff9f, name: "SCNKEY", comment: "Scan keyboard" },
  { address: 0xffa2, name: "SETTMO", comment: "Set IEEE timeout" },
  { address: 0xffa5, name: "ACPTR", comment: "Read byte from serial bus" },
  { address: 0xffa8, name: "CIOUT", comment: "Send byte to serial bus" },
  { address: 0xffab, name: "UNTLK", comment: "Send UNTALK" },
  { address: 0xffae, name: "UNLSN", comment: "Send UNLISTEN" },
  { address: 0xffb1, name: "LISTEN", comment: "Send LISTEN" },
  { address: 0xffb4, name: "TALK", comment: "Send TALK" },
  { address: 0xffb7, name: "READST", comment: "Read I/O status word" },
  { address: 0xffba, name: "SETLFS", comment: "Set logical file parameters" },
  { address: 0xffbd, name: "SETNAM", comment: "Set filename" },
  { address: 0xffc0, name: "OPEN", comment: "Open a logical file" },
  { address: 0xffc3, name: "CLOSE", comment: "Close a logical file" },
  { address: 0xffc6, name: "CHKIN", comment: "Set channel for input" },
  { address: 0xffc9, name: "CHKOUT", comment: "Set channel for output" },
  { address: 0xffcc, name: "CLRCHN", comment: "Restore default channels" },
  { address: 0xffcf, name: "CHRIN", comment: "Read byte from input channel" },
  { address: 0xffd2, name: "CHROUT", comment: "Write byte to output channel" },
  { address: 0xffd5, name: "LOAD", comment: "Load from device" },
  { address: 0xffd8, name: "SAVE", comment: "Save to device" },
  { address: 0xffdb, name: "SETTIM", comment: "Set jiffy clock" },
  { address: 0xffde, name: "RDTIM", comment: "Read jiffy clock" },
  { address: 0xffe1, name: "STOP", comment: "Test STOP key" },
  { address: 0xffe4, name: "GETIN", comment: "Read byte from keyboard buffer" },
  { address: 0xffe7, name: "CLALL", comment: "Close all channels and files" },
  { address: 0xffea, name: "UDTIM", comment: "Increment jiffy clock" },
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
    C64_SYMBOLS.map((s) => createPlatformLabel(s.address, s.name))
  );
}
