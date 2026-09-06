import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { buildMemoryMap } from "./loader.js";
import { makeFileLoader } from "./file-source.js";
import { analyze } from "../view/rows.js";
import { Project } from "./project.js";
import { nodeRomBytes } from "../../node-files.js";

/**
 * A machine ROM as a layer somebody asks for.
 *
 * Deliberately never automatic. Loading these into every project would add
 * twelve kilobytes to its address space and make the analysis depend on whether
 * a developer happens to have gitignored files on disk — so the golden test
 * would pass on one machine and fail on another. A project asks, and the
 * request is committed even though the bytes never are.
 */
const GAME: Project["layers"] = [
  { id: "lay_game", type: "bytes", address: "$8000", bytes: "a9 01 60" },
];

const load = (layers: Project["layers"], loadRom = nodeRomBytes()) =>
  buildMemoryMap(
    { layers },
    makeFileLoader(() => {
      throw new Error("no files in this fixture");
    }),
    { platform: false, loadRom }
  );

describe("a project that has not asked for a ROM", () => {
  it("has the address space it always had", () => {
    const loaded = load(GAME);
    expect(loaded.map.readByte(0xa000)).toBeUndefined();
    expect(loaded.romsMissing).toEqual([]);
  });
});

describe("a project that asks for a ROM this host does not have", () => {
  it("loads, supplies nothing, and says which", () => {
    // Openable by somebody who cannot legally be handed a ROM — and *not*
    // silent about it, because every answer that would have used those bytes
    // is short by an unknown amount.
    const loaded = load([...GAME, { id: "lay_rom", type: "rom", rom: "basic" }], () => undefined);
    expect(loaded.romsMissing).toEqual(["basic"]);
    expect(loaded.map.readByte(0xa000)).toBeUndefined();
  });
});

const ROM = "3party/roms/basic.901226-01.bin";

describe.runIf(existsSync(ROM))("a project that asks for one that is here", () => {
  const withBasic = () => load([...GAME, { id: "lay_rom", type: "rom", rom: "basic" }]);

  it("supplies the ROM's bytes at the address the machine decodes them", () => {
    const loaded = withBasic();
    const rom = new Uint8Array(readFileSync(ROM));
    expect(loaded.romsMissing).toEqual([]);
    expect(loaded.map.readByte(0xa000)).toBe(rom[0]);
    expect(loaded.map.readByte(0xbfff)).toBe(rom[rom.length - 1]);
  });

  it("keeps eight kilobytes of ROM out of the listing", () => {
    // The whole reason a reference layer exists. Its bytes answer questions —
    // what does this program read out of BASIC — and have no business being
    // rendered as somebody's disassembly.
    const rows = analyze(withBasic(), { annotations: false }).rows;
    expect(rows.every((r) => r.address < 0xa000)).toBe(true);

    // And the program itself still renders, so this suppresses the ROM rather
    // than the listing.
    expect(rows.some((r) => r.address === 0x8000)).toBe(true);
  });

  it("lets a read into ROM be answered at all, which is the point", () => {
    // `$A000-$BFFF` is where the flat memory model finally cost something real:
    // Gridrunner's random number generator reads ROM bytes for entropy through
    // eleven callers, and with nothing supplying those bytes there was no
    // answer to give. There is one now, for a project that asks.
    expect(withBasic().map.readByte(0xe097 - 0x4000)).toBeDefined();
  });
});
