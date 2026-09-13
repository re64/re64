import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { D64Entry, listDirectory, extractFile, findFile } from "./d64.js";

const d64Path = "assets/mutant-camels/revenge-of-the-mutant-camels.d64";

describe("d64", () => {
  const image = new Uint8Array(readFileSync(d64Path));

  describe("listDirectory", () => {
    it("lists files on disk", () => {
      const entries = listDirectory(image);
      expect(entries.length).toBeGreaterThan(0);
    });

    it("finds expected files", () => {
      const entries = listDirectory(image);
      const filenames = entries.map((e) => e.filename.toLowerCase());

      // Should have two files based on our earlier inspection
      expect(entries.length).toBe(2);
      expect(filenames).toContain("revenge fixed");
      expect(filenames).toContain("attack mutant.hi");
    });

    it("identifies PRG files", () => {
      const entries = listDirectory(image);
      const prgs = entries.filter((e) => e.type === "prg");
      expect(prgs.length).toBeGreaterThan(0);
    });
  });

  describe("findFile", () => {
    it("finds file by name (case insensitive)", () => {
      const entry = findFile(image, "REVENGE FIXED");
      expect(entry).toBeDefined();
      expect(entry?.type).toBe("prg");
    });

    it("returns undefined for non-existent file", () => {
      const entry = findFile(image, "NONEXISTENT");
      expect(entry).toBeUndefined();
    });
  });

  describe("extractFile", () => {
    it("extracts PRG file with correct load address", () => {
      const entry = findFile(image, "REVENGE FIXED");
      expect(entry).toBeDefined();

      const data = extractFile(image, entry!);
      expect(data.length).toBeGreaterThan(2);

      // PRG files start with 2-byte load address
      const loadAddress = data[0] | (data[1] << 8);
      expect(loadAddress).toBeGreaterThan(0);
      expect(loadAddress).toBeLessThan(0x10000);
    });

    it("extracts exactly the bytes the chain says, to the last sector's last used byte", () => {
      // **Exact, not a range.** The range assertion this replaces bounded the
      // length between (blocks-1)*254 and blocks*254, and every file was one
      // byte too long inside that window for as long as the test existed. The
      // expected length is read off the image independently: full sectors
      // contribute 254, and the last sector's second link byte is the offset
      // of its last used byte, so it contributes that minus one.
      for (const [name, blocks, length] of [
        ["REVENGE FIXED", 75, 18855],
        ["ATTACK MUTANT.HI", 1, 210],
      ] as const) {
        const entry = findFile(image, name)!;
        expect(entry.sizeInSectors).toBe(blocks);
        expect(extractFile(image, entry).length).toBe(lengthFromChain(image, entry));
        expect(extractFile(image, entry).length).toBe(length);
      }
    });
  });
});

/** Walk a file's sector chain and add up what each link says, without extracting. */
function lengthFromChain(image: Uint8Array, entry: D64Entry): number {
  let [track, sector] = [entry.track, entry.sector];
  let length = 0;
  while (track !== 0) {
    const offset = sectorOffset(track, sector);
    const [nextTrack, nextSector] = [image[offset], image[offset + 1]];
    length += nextTrack === 0 ? nextSector - 1 : 254;
    [track, sector] = [nextTrack, nextSector];
  }
  return length;
}

const SECTORS_PER_TRACK = [...Array(17).fill(21), ...Array(7).fill(19), ...Array(6).fill(18), ...Array(5).fill(17)];
function sectorOffset(track: number, sector: number): number {
  let offset = 0;
  for (let t = 1; t < track; t++) offset += SECTORS_PER_TRACK[t - 1] * 256;
  return offset + sector * 256;
}

describe("a disk built by hand, so the last sector's link byte is known", () => {
  /**
   * The specification, as a fixture: a file whose first sector is full and
   * whose last sector's second link byte is chosen, with the sector *after*
   * it on the disk filled with a sentinel. The old code read one byte past
   * the last used byte, and that byte was the sentinel.
   */
  const disk = (lastLink: number): { image: Uint8Array; expected: Uint8Array } => {
    const image = new Uint8Array(174848);
    // Directory: one entry, a closed PRG at track 1 sector 0, two blocks.
    const dir = sectorOffset(18, 1);
    image[dir] = 0;
    image[dir + 1] = 0xff;
    image[dir + 2] = 0x82;
    image[dir + 3] = 1;
    image[dir + 4] = 0;
    image.set(new TextEncoder().encode("FILE"), dir + 5);
    image.fill(0xa0, dir + 9, dir + 21);
    image[dir + 30] = 2;
    // First sector: full, linking to track 1 sector 1; data bytes count up.
    const first = sectorOffset(1, 0);
    image[first] = 1;
    image[first + 1] = 1;
    for (let i = 0; i < 254; i++) image[first + 2 + i] = i & 0xff;
    // Last sector: data bytes count down from $FE; the link says how many are used.
    const last = sectorOffset(1, 1);
    image[last] = 0;
    image[last + 1] = lastLink;
    for (let i = 0; i < 254; i++) image[last + 2 + i] = (0xfe - i) === 0xa5 ? 0x00 : (0xfe - i) & 0xff;
    // The sector after it, which is not part of the file at all. Its first
    // byte is what the old code appended to every file.
    image.fill(0xa5, sectorOffset(1, 2), sectorOffset(1, 3));

    const used = lastLink - 1;
    const expected = new Uint8Array(254 + used);
    expected.set(image.slice(first + 2, first + 256), 0);
    expected.set(image.slice(last + 2, last + 2 + used), 254);
    return { image, expected };
  };

  it.each([
    ["one byte used", 0x02, 255],
    ["part of the sector used", 0x3c, 254 + 59],
    ["the whole sector used", 0xff, 254 + 254],
    ["nothing used", 0x01, 254],
  ])("extracts exactly the bytes the link describes: %s", (_case, link, length) => {
    const { image, expected } = disk(link);
    const entry = findFile(image, "file")!;
    expect(entry.sizeInSectors).toBe(2);
    const data = extractFile(image, entry);
    expect(data.length).toBe(length);
    expect(data).toEqual(expected);
    // The byte the old code took was the first of the sector that follows.
    expect(data[data.length - 1]).not.toBe(0xa5);
  });
});
