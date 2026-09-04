/**
 * What each documented KERNAL entry point touches.
 *
 * **Generated — do not edit.** `npm run gen:kernal` derives this from a ROM,
 * which is not in this repository; `src/tools/gen-kernal-effects.ts` explains
 * how, and `3party/roms/README.md` says which file to supply.
 *
 * re64 has always shipped *names* for these addresses. This is what they **do**,
 * computed by re64's own lifter and call-graph analysis rather than transcribed
 * from a book — so a program calling `JSR $FFD2` can be understood by somebody
 * who does not own the ROM.
 *
 * 10 of these are a `JMP` through a cell in RAM. That is how they are hooked,
 * so what is recorded is the **default** implementation — the one the machine
 * installs for itself, learned by running `RESTOR` out of the ROM rather than
 * by assuming it. A program that hooks the vector does something else, and
 * `vector` is there so a reader can see that the question arises.
 *
 * May, never must: these are unions over every path, so an entry point lists
 * what it *can* touch. `incomplete` says where a list is short and why.
 */

export interface KernalEffects {
  address: number;
  name: string;
  /** Present when the entry point jumps through RAM, which a program may hook. */
  vector?: { pointer: number; defaultImpl: number };
  /** Registers and flags it reads or writes, by name, including its callees. */
  registers: string[];
  /** Addresses it reads or writes, including its callees, where the address is statically known. */
  memory: number[];
  /**
   * The same two without entering anything it calls.
   *
   * Both are here because neither answers on its own. `CHROUT` dispatches on
   * the current output device, so the full union covers the screen editor, the
   * serial bus, the tape system and the RS-232 code at once — sound, and no use
   * to somebody asking what printing a character does. The narrow pair is the
   * dispatch itself. The honest thing is to show both and say why.
   */
  ownRegisters: string[];
  ownMemory: number[];
  /** Processor flags it writes. */
  flags: string[];
  /** Why the lists above may be short. */
  incomplete?: string[];
}

export const KERNAL_EFFECTS: readonly KernalEffects[] = [
  {
    address: 0xff81,
    name: "CINT",
    registers: ["A", "C", "N", "V", "X", "Y", "Z"],
    memory: [0x0099, 0x009a, 0x00cc, 0x00cd, 0x00cf, 0x00d1, 0x00d2, 0x00d3, 0x00d5, 0x00d6, 0x00f3, 0x00f4, 0x0286, 0x0288, 0x0289, 0x028b, 0x028c, 0x028f, 0x0290, 0x0291, 0x02a6, 0xd012, 0xd019, 0xdc04, 0xdc05, 0xdc0d, 0xdc0e, 0xdd00],
    ownRegisters: [],
    ownMemory: [],
    flags: ["C", "N", "V", "Z"],
    incomplete: [
      "touches memory at an address that depends on a register, so the list of cells is short",
    ],
  },
  {
    address: 0xff84,
    name: "IOINIT",
    registers: ["A", "N", "X", "Z"],
    memory: [0x0000, 0x0001, 0x02a6, 0xd418, 0xdc00, 0xdc02, 0xdc03, 0xdc04, 0xdc05, 0xdc0d, 0xdc0e, 0xdc0f, 0xdd00, 0xdd02, 0xdd03, 0xdd0d, 0xdd0e, 0xdd0f],
    ownRegisters: [],
    ownMemory: [],
    flags: ["N", "Z"],
  },
  {
    address: 0xff87,
    name: "RAMTAS",
    registers: ["A", "C", "N", "X", "Y", "Z"],
    memory: [0x00b2, 0x00b3, 0x00c2, 0x0282, 0x0283, 0x0284, 0x0288],
    ownRegisters: [],
    ownMemory: [],
    flags: ["C", "N", "Z"],
    incomplete: [
      "touches memory at an address that depends on a register, so the list of cells is short",
    ],
  },
  {
    address: 0xff8a,
    name: "RESTOR",
    registers: ["A", "C", "N", "X", "Y", "Z"],
    memory: [0x00c3, 0x00c4],
    ownRegisters: [],
    ownMemory: [],
    flags: ["C", "N", "Z"],
    incomplete: [
      "touches memory at an address that depends on a register, so the list of cells is short",
    ],
  },
  {
    address: 0xff8d,
    name: "VECTOR",
    registers: ["A", "C", "N", "X", "Y", "Z"],
    memory: [0x00c3, 0x00c4],
    ownRegisters: [],
    ownMemory: [],
    flags: ["N", "Z"],
    incomplete: [
      "touches memory at an address that depends on a register, so the list of cells is short",
    ],
  },
  {
    address: 0xff90,
    name: "SETMSG",
    registers: ["A", "N", "Z"],
    memory: [0x0090, 0x009d],
    ownRegisters: [],
    ownMemory: [],
    flags: ["N", "Z"],
  },
  {
    address: 0xff93,
    name: "SECOND",
    registers: ["A", "C", "I", "N", "V", "X", "Z"],
    memory: [0x0090, 0x0095, 0x00a3, 0x00a5, 0x03a9, 0xdc07, 0xdc0d, 0xdc0f, 0xdd00],
    ownRegisters: [],
    ownMemory: [],
    flags: ["C", "I", "N", "V", "Z"],
  },
  {
    address: 0xff96,
    name: "TKSA",
    registers: ["A", "C", "I", "N", "V", "X", "Z"],
    memory: [0x0090, 0x0095, 0x00a3, 0x00a5, 0x03a9, 0xdc07, 0xdc0d, 0xdc0f, 0xdd00],
    ownRegisters: [],
    ownMemory: [],
    flags: ["C", "I", "N", "V", "Z"],
  },
  {
    address: 0xff99,
    name: "MEMTOP",
    registers: ["C", "N", "X", "Y", "Z"],
    memory: [0x0283, 0x0284],
    ownRegisters: [],
    ownMemory: [],
    flags: ["N", "Z"],
  },
  {
    address: 0xff9c,
    name: "MEMBOT",
    registers: ["C", "N", "X", "Y", "Z"],
    memory: [0x0281, 0x0282],
    ownRegisters: [],
    ownMemory: [],
    flags: ["N", "Z"],
  },
  {
    address: 0xff9f,
    name: "SCNKEY",
    registers: ["A", "C", "N", "X", "Y", "Z"],
    memory: [0x00c5, 0x00c6, 0x00cb, 0x00f5, 0x00f6, 0x0289, 0x028b, 0x028c, 0x028d, 0x028e, 0x028f, 0x0290, 0xdc00, 0xdc01],
    ownRegisters: [],
    ownMemory: [],
    flags: ["C", "N", "Z"],
    incomplete: [
      "touches memory at an address that depends on a register, so the list of cells is short",
    ],
  },
  {
    address: 0xffa2,
    name: "SETTMO",
    registers: ["A"],
    memory: [0x0285],
    ownRegisters: [],
    ownMemory: [],
    flags: [],
  },
  {
    address: 0xffa5,
    name: "ACPTR",
    registers: ["A", "C", "I", "N", "V", "X", "Z"],
    memory: [0x0090, 0x0095, 0x00a3, 0x00a4, 0x00a5, 0x03a9, 0xdc07, 0xdc0d, 0xdc0f, 0xdd00],
    ownRegisters: [],
    ownMemory: [],
    flags: ["C", "I", "N", "V", "Z"],
  },
  {
    address: 0xffa8,
    name: "CIOUT",
    registers: ["A", "C", "I", "N", "V", "X", "Z"],
    memory: [0x0090, 0x0094, 0x0095, 0x00a3, 0x00a5, 0x03a9, 0xdc07, 0xdc0d, 0xdc0f, 0xdd00],
    ownRegisters: [],
    ownMemory: [],
    flags: ["C", "I", "N", "V", "Z"],
  },
  {
    address: 0xffab,
    name: "UNTLK",
    registers: ["A", "C", "I", "N", "V", "X", "Z"],
    memory: [0x0090, 0x0094, 0x0095, 0x00a3, 0x00a5, 0x03a9, 0x3fa9, 0xdc07, 0xdc0d, 0xdc0f, 0xdd00],
    ownRegisters: [],
    ownMemory: [],
    flags: ["C", "I", "N", "V", "Z"],
  },
  {
    address: 0xffae,
    name: "UNLSN",
    registers: ["A", "C", "I", "N", "V", "X", "Z"],
    memory: [0x0090, 0x0094, 0x0095, 0x00a3, 0x00a5, 0x03a9, 0xdc07, 0xdc0d, 0xdc0f, 0xdd00],
    ownRegisters: [],
    ownMemory: [],
    flags: ["C", "I", "N", "V", "Z"],
  },
  {
    address: 0xffb1,
    name: "LISTEN",
    registers: ["A", "C", "I", "N", "V", "X", "Z"],
    memory: [0x0090, 0x0094, 0x0095, 0x00a3, 0x00a5, 0x02a1, 0x03a9, 0xdc07, 0xdc0d, 0xdc0f, 0xdd00, 0xdd0d],
    ownRegisters: [],
    ownMemory: [],
    flags: ["C", "I", "N", "V", "Z"],
  },
  {
    address: 0xffb4,
    name: "TALK",
    registers: ["A", "C", "I", "N", "V", "X", "Z"],
    memory: [0x0090, 0x0094, 0x0095, 0x00a3, 0x00a5, 0x02a1, 0x03a9, 0x2009, 0xdc07, 0xdc0d, 0xdc0f, 0xdd00, 0xdd0d],
    ownRegisters: [],
    ownMemory: [],
    flags: ["C", "I", "N", "V", "Z"],
  },
  {
    address: 0xffb7,
    name: "READST",
    registers: ["A", "C", "N", "Z"],
    memory: [0x0090, 0x00ba, 0x0297],
    ownRegisters: [],
    ownMemory: [],
    flags: ["C", "N", "Z"],
  },
  {
    address: 0xffba,
    name: "SETLFS",
    registers: ["A", "X", "Y"],
    memory: [0x00b8, 0x00b9, 0x00ba],
    ownRegisters: [],
    ownMemory: [],
    flags: [],
  },
  {
    address: 0xffbd,
    name: "SETNAM",
    registers: ["A", "X", "Y"],
    memory: [0x00b7, 0x00bb, 0x00bc],
    ownRegisters: [],
    ownMemory: [],
    flags: [],
  },
  {
    address: 0xffc0,
    name: "OPEN",
    vector: { pointer: 0x031a, defaultImpl: 0xf34a },
    registers: ["A", "C", "D", "I", "N", "V", "X", "Y", "Z"],
    memory: [0x0001, 0x0090, 0x0091, 0x0093, 0x0094, 0x0095, 0x0098, 0x009b, 0x009c, 0x009d, 0x009e, 0x009f, 0x00a1, 0x00a3, 0x00a4, 0x00a5, 0x00a6, 0x00a8, 0x00a9, 0x00aa, 0x00ab, 0x00ae, 0x00af, 0x00b0, 0x00b2, 0x00b3, 0x00b4, 0x00b7, 0x00b8, 0x00b9, 0x00ba, 0x00be, 0x00c0, 0x00c1, 0x00c2, 0x00f7, 0x00f8, 0x00f9, 0x00fa, 0x0283, 0x0284, 0x0293, 0x0294, 0x0295, 0x0296, 0x0297, 0x0298, 0x0299, 0x029a, 0x029b, 0x029c, 0x029d, 0x029e, 0x029f, 0x02a0, 0x02a1, 0x02a2, 0x02a6, 0x02a9, 0x0314, 0x0315, 0x0322, 0x0323, 0x0326, 0x0327, 0x0328, 0x0329, 0x03a9, 0x04a9, 0x05a9, 0x06a9, 0x07a9, 0x08a9, 0x09a9, 0xd011, 0xdc00, 0xdc01, 0xdc04, 0xdc05, 0xdc07, 0xdc0d, 0xdc0e, 0xdc0f, 0xdd00, 0xdd01, 0xdd03, 0xdd0d],
    ownRegisters: ["A", "C", "N", "X", "Y", "Z"],
    ownMemory: [0x0098, 0x00a6, 0x00b7, 0x00b8, 0x00b9, 0x00ba],
    flags: ["C", "D", "I", "N", "V", "Z"],
    incomplete: [
      "touches memory at an address that depends on a register, so the list of cells is short",
    ],
  },
  {
    address: 0xffc3,
    name: "CLOSE",
    vector: { pointer: 0x031c, defaultImpl: 0xf291 },
    registers: ["A", "C", "D", "I", "N", "V", "X", "Y", "Z"],
    memory: [0x0001, 0x0090, 0x0091, 0x0093, 0x0094, 0x0095, 0x0098, 0x009b, 0x009c, 0x009e, 0x009f, 0x00a3, 0x00a4, 0x00a5, 0x00a6, 0x00a8, 0x00a9, 0x00aa, 0x00ab, 0x00ae, 0x00af, 0x00b0, 0x00b2, 0x00b3, 0x00b4, 0x00b5, 0x00b6, 0x00b7, 0x00b8, 0x00b9, 0x00ba, 0x00bd, 0x00be, 0x00c0, 0x00c1, 0x00c2, 0x00f8, 0x00fa, 0x0283, 0x0284, 0x0294, 0x0297, 0x0298, 0x0299, 0x029a, 0x029d, 0x029e, 0x029f, 0x02a0, 0x02a1, 0x02a2, 0x02a6, 0x0314, 0x0315, 0x0326, 0x0327, 0x0328, 0x0329, 0x03a9, 0x10a9, 0xd011, 0xdc00, 0xdc01, 0xdc04, 0xdc05, 0xdc07, 0xdc0d, 0xdc0e, 0xdc0f, 0xdd00, 0xdd01, 0xdd03, 0xdd04, 0xdd05, 0xdd0d, 0xdd0e],
    ownRegisters: ["A", "C", "N", "X", "Y", "Z"],
    ownMemory: [0x00b9, 0x00ba, 0x00f8, 0x00fa],
    flags: ["C", "D", "I", "N", "V", "Z"],
    incomplete: [
      "touches memory at an address that depends on a register, so the list of cells is short",
    ],
  },
  {
    address: 0xffc6,
    name: "CHKIN",
    vector: { pointer: 0x031e, defaultImpl: 0xf20e },
    registers: ["A", "C", "D", "I", "N", "V", "X", "Y", "Z"],
    memory: [0x0090, 0x0094, 0x0095, 0x0098, 0x0099, 0x009d, 0x00a3, 0x00a5, 0x00b8, 0x00b9, 0x00ba, 0x0294, 0x0297, 0x02a1, 0x0322, 0x0323, 0x0326, 0x0327, 0x03a9, 0x04a9, 0x05a9, 0x06a9, 0x07a9, 0x08a9, 0x09a9, 0x2009, 0xdc07, 0xdc0d, 0xdc0f, 0xdd00, 0xdd01, 0xdd0d],
    ownRegisters: ["A", "C", "N", "X", "Z"],
    ownMemory: [0x0099, 0x00b9, 0x00ba],
    flags: ["C", "D", "I", "N", "V", "Z"],
    incomplete: [
      "touches memory at an address that depends on a register, so the list of cells is short",
    ],
  },
  {
    address: 0xffc9,
    name: "CHKOUT",
    vector: { pointer: 0x0320, defaultImpl: 0xf250 },
    registers: ["A", "C", "D", "I", "N", "V", "X", "Y", "Z"],
    memory: [0x0090, 0x0094, 0x0095, 0x0098, 0x009a, 0x009d, 0x00a3, 0x00a5, 0x00b8, 0x00b9, 0x00ba, 0x0294, 0x0297, 0x02a1, 0x0322, 0x0323, 0x0326, 0x0327, 0x03a9, 0x04a9, 0x05a9, 0x06a9, 0x07a9, 0x08a9, 0x09a9, 0xdc07, 0xdc0d, 0xdc0f, 0xdd00, 0xdd01, 0xdd0d],
    ownRegisters: ["A", "C", "N", "V", "X", "Z"],
    ownMemory: [0x0090, 0x009a, 0x00b9, 0x00ba],
    flags: ["C", "D", "I", "N", "V", "Z"],
    incomplete: [
      "touches memory at an address that depends on a register, so the list of cells is short",
    ],
  },
  {
    address: 0xffcc,
    name: "CLRCHN",
    vector: { pointer: 0x0322, defaultImpl: 0xf333 },
    registers: ["A", "C", "I", "N", "V", "X", "Z"],
    memory: [0x0090, 0x0094, 0x0095, 0x0099, 0x009a, 0x00a3, 0x00a5, 0x03a9, 0x3fa9, 0xdc07, 0xdc0d, 0xdc0f, 0xdd00],
    ownRegisters: ["A", "C", "N", "X", "Z"],
    ownMemory: [0x0099, 0x009a],
    flags: ["C", "I", "N", "V", "Z"],
  },
  {
    address: 0xffcf,
    name: "CHRIN",
    vector: { pointer: 0x0324, defaultImpl: 0xf157 },
    registers: ["A", "C", "D", "I", "N", "V", "X", "Y", "Z"],
    memory: [0x0001, 0x0090, 0x0091, 0x0093, 0x0094, 0x0095, 0x0097, 0x0099, 0x009a, 0x009b, 0x009c, 0x009e, 0x009f, 0x00a3, 0x00a4, 0x00a5, 0x00a6, 0x00a8, 0x00a9, 0x00aa, 0x00ab, 0x00ac, 0x00ad, 0x00ae, 0x00af, 0x00b0, 0x00b2, 0x00b3, 0x00b4, 0x00b5, 0x00b6, 0x00bd, 0x00be, 0x00c0, 0x00c1, 0x00c2, 0x00c6, 0x00c7, 0x00c8, 0x00c9, 0x00ca, 0x00cc, 0x00cd, 0x00ce, 0x00cf, 0x00d0, 0x00d1, 0x00d2, 0x00d3, 0x00d4, 0x00d5, 0x00d6, 0x00d7, 0x00d8, 0x00d9, 0x00f1, 0x00f3, 0x00f4, 0x0277, 0x0286, 0x0287, 0x0288, 0x0291, 0x0292, 0x0294, 0x0297, 0x0298, 0x0299, 0x029a, 0x029b, 0x029c, 0x029d, 0x029e, 0x029f, 0x02a0, 0x02a1, 0x02a2, 0x02a5, 0x02a6, 0x0314, 0x0315, 0x0326, 0x0327, 0x0328, 0x0329, 0x03a9, 0x10a9, 0xd011, 0xd018, 0xdc00, 0xdc01, 0xdc04, 0xdc05, 0xdc07, 0xdc0d, 0xdc0e, 0xdc0f, 0xdd00, 0xdd01, 0xdd04, 0xdd05, 0xdd0d, 0xdd0e],
    ownRegisters: ["A", "C", "N", "X", "Z"],
    ownMemory: [0x0090, 0x0097, 0x0099, 0x00a6, 0x00c8, 0x00c9, 0x00ca, 0x00d0, 0x00d3, 0x00d5, 0x00d6, 0x0297],
    flags: ["C", "D", "I", "N", "V", "Z"],
    incomplete: [
      "touches memory at an address that depends on a register, so the list of cells is short",
    ],
  },
  {
    address: 0xffd2,
    name: "CHROUT",
    vector: { pointer: 0x0326, defaultImpl: 0xf1ca },
    registers: ["A", "C", "D", "I", "N", "V", "X", "Y", "Z"],
    memory: [0x0001, 0x0090, 0x0091, 0x0093, 0x0094, 0x0095, 0x009a, 0x009b, 0x009c, 0x009e, 0x009f, 0x00a3, 0x00a4, 0x00a5, 0x00a6, 0x00a8, 0x00a9, 0x00aa, 0x00ab, 0x00ac, 0x00ad, 0x00ae, 0x00af, 0x00b0, 0x00b2, 0x00b3, 0x00b4, 0x00b5, 0x00b6, 0x00bd, 0x00be, 0x00c0, 0x00c1, 0x00c2, 0x00c6, 0x00c7, 0x00c9, 0x00cd, 0x00d0, 0x00d1, 0x00d2, 0x00d3, 0x00d4, 0x00d5, 0x00d6, 0x00d7, 0x00d8, 0x00d9, 0x00f1, 0x00f3, 0x00f4, 0x0286, 0x0288, 0x0291, 0x0292, 0x0294, 0x0297, 0x0298, 0x0299, 0x029a, 0x029d, 0x029e, 0x029f, 0x02a0, 0x02a1, 0x02a2, 0x02a5, 0x02a6, 0x0314, 0x0315, 0x0326, 0x0327, 0x0328, 0x0329, 0x03a9, 0x10a9, 0xd011, 0xd018, 0xdc00, 0xdc01, 0xdc04, 0xdc05, 0xdc07, 0xdc0d, 0xdc0e, 0xdc0f, 0xdd00, 0xdd01, 0xdd04, 0xdd05, 0xdd0d, 0xdd0e],
    ownRegisters: ["A", "C", "N", "Z"],
    ownMemory: [0x009a],
    flags: ["C", "D", "I", "N", "V", "Z"],
    incomplete: [
      "touches memory at an address that depends on a register, so the list of cells is short",
    ],
  },
  {
    address: 0xffd5,
    name: "LOAD",
    registers: ["X", "Y"],
    memory: [0x00c3, 0x00c4, 0x0330, 0x0331],
    ownRegisters: [],
    ownMemory: [],
    flags: [],
  },
  {
    address: 0xffd8,
    name: "SAVE",
    registers: ["A", "N", "X", "Y", "Z"],
    memory: [0x00ae, 0x00af, 0x00c1, 0x00c2, 0x0332, 0x0333],
    ownRegisters: [],
    ownMemory: [],
    flags: ["N", "Z"],
    incomplete: [
      "touches memory at an address that depends on a register, so the list of cells is short",
    ],
  },
  {
    address: 0xffdb,
    name: "SETTIM",
    registers: ["A", "I", "X", "Y"],
    memory: [0x00a0, 0x00a1, 0x00a2],
    ownRegisters: [],
    ownMemory: [],
    flags: ["I"],
  },
  {
    address: 0xffde,
    name: "RDTIM",
    registers: ["A", "I", "N", "X", "Y", "Z"],
    memory: [0x00a0, 0x00a1, 0x00a2],
    ownRegisters: [],
    ownMemory: [],
    flags: ["I", "N", "Z"],
  },
  {
    address: 0xffe1,
    name: "STOP",
    vector: { pointer: 0x0328, defaultImpl: 0xf6ed },
    registers: ["A", "C", "D", "I", "N", "V", "Z"],
    memory: [0x0091, 0x00c6, 0x0322, 0x0323],
    ownRegisters: ["A", "C", "D", "I", "N", "V", "Z"],
    ownMemory: [0x0091, 0x00c6],
    flags: ["C", "D", "I", "N", "V", "Z"],
  },
  {
    address: 0xffe4,
    name: "GETIN",
    vector: { pointer: 0x032a, defaultImpl: 0xf13e },
    registers: ["A", "C", "D", "I", "N", "V", "X", "Y", "Z"],
    memory: [0x0001, 0x0090, 0x0091, 0x0093, 0x0094, 0x0095, 0x0097, 0x0099, 0x009a, 0x009b, 0x009c, 0x009e, 0x009f, 0x00a3, 0x00a4, 0x00a5, 0x00a6, 0x00a8, 0x00a9, 0x00aa, 0x00ab, 0x00ac, 0x00ad, 0x00ae, 0x00af, 0x00b0, 0x00b2, 0x00b3, 0x00b4, 0x00b5, 0x00b6, 0x00bd, 0x00be, 0x00c0, 0x00c1, 0x00c2, 0x00c6, 0x00c7, 0x00c8, 0x00c9, 0x00ca, 0x00cc, 0x00cd, 0x00ce, 0x00cf, 0x00d0, 0x00d1, 0x00d2, 0x00d3, 0x00d4, 0x00d5, 0x00d6, 0x00d7, 0x00d8, 0x00d9, 0x00f1, 0x00f3, 0x00f4, 0x0277, 0x0286, 0x0287, 0x0288, 0x0291, 0x0292, 0x0294, 0x0297, 0x0298, 0x0299, 0x029a, 0x029b, 0x029c, 0x029d, 0x029e, 0x029f, 0x02a0, 0x02a1, 0x02a2, 0x02a5, 0x02a6, 0x0314, 0x0315, 0x0326, 0x0327, 0x0328, 0x0329, 0x03a9, 0x10a9, 0xd011, 0xd018, 0xdc00, 0xdc01, 0xdc04, 0xdc05, 0xdc07, 0xdc0d, 0xdc0e, 0xdc0f, 0xdd00, 0xdd01, 0xdd04, 0xdd05, 0xdd0d, 0xdd0e],
    ownRegisters: ["A", "C", "I", "N", "X", "Z"],
    ownMemory: [0x0090, 0x0097, 0x0099, 0x00a6, 0x00c6, 0x00c8, 0x00d0, 0x00d5, 0x0297],
    flags: ["C", "D", "I", "N", "V", "Z"],
    incomplete: [
      "touches memory at an address that depends on a register, so the list of cells is short",
    ],
  },
  {
    address: 0xffe7,
    name: "CLALL",
    vector: { pointer: 0x032c, defaultImpl: 0xf32f },
    registers: ["A", "C", "I", "N", "V", "X", "Z"],
    memory: [0x0090, 0x0094, 0x0095, 0x0098, 0x0099, 0x009a, 0x00a3, 0x00a5, 0x03a9, 0x3fa9, 0xdc07, 0xdc0d, 0xdc0f, 0xdd00],
    ownRegisters: ["A", "N", "Z"],
    ownMemory: [0x0098],
    flags: ["C", "I", "N", "V", "Z"],
  },
  {
    address: 0xffea,
    name: "UDTIM",
    registers: ["A", "C", "N", "V", "X", "Z"],
    memory: [0x0091, 0x00a0, 0x00a1, 0x00a2, 0xdc00, 0xdc01],
    ownRegisters: [],
    ownMemory: [],
    flags: ["C", "N", "V", "Z"],
  },
  {
    address: 0xffed,
    name: "SCREEN",
    registers: ["N", "X", "Y", "Z"],
    memory: [],
    ownRegisters: [],
    ownMemory: [],
    flags: ["N", "Z"],
  },
  {
    address: 0xfff0,
    name: "PLOT",
    registers: ["A", "C", "N", "V", "X", "Y", "Z"],
    memory: [0x00d1, 0x00d2, 0x00d3, 0x00d5, 0x00d6, 0x00f3, 0x00f4, 0x0288],
    ownRegisters: [],
    ownMemory: [],
    flags: ["C", "N", "V", "Z"],
    incomplete: [
      "touches memory at an address that depends on a register, so the list of cells is short",
    ],
  },
  {
    address: 0xfff3,
    name: "IOBASE",
    registers: ["N", "X", "Y", "Z"],
    memory: [],
    ownRegisters: [],
    ownMemory: [],
    flags: ["N", "Z"],
  },
];
