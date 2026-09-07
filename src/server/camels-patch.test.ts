import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workspace, Caller } from "./workspace.js";
import { ProjectStore, SqliteStorage, importProject } from "../store/index.js";

/**
 * The 2021 patch, as a target of its own.
 *
 * Revenge of the Mutant Camels exists here as two builds, and until now they
 * were "the disk" and "the .prg" — two fixtures nobody could say the difference
 * between. They differ by **thirty-six bytes** above `$87D0` and by eight
 * kilobytes of new code at `$C000`, and every one of those bytes is Jeff
 * Minter's May 2021 collision fix: the mwenge listing carries his own account of
 * it, quoted off a Discord channel.
 *
 * That matters beyond provenance, because the published article got it backwards.
 * It read `$9AB3` as `LDA #$FF / AND #$02` — a gate stubbed open — and told the
 * story of a 1984 leftover, dead code the author built and never wired up. The
 * 1984 build has `LDA $44` there. The stub is the *fix*, deliberate, thirty-seven
 * years later, and the author says why: a multiplexed sprite registers no
 * hardware collision on a frame it is not drawn.
 *
 * **So the patch is expressed the way a patch should be: as an overlay.** Six
 * byte layers, each three bytes wide and named for what it does, over the 1984
 * build. And the assertion that makes it a fact rather than a story is byte
 * identity — the overlay plus the original reproduces the shipped build over
 * the whole of the code, exactly, and nothing else moves.
 */
let dir: string, ws: Workspace, storage: SqliteStorage, databasePath: string;
const builder: Caller = { userId: "builder", label: "builder" };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "re64-patch-"));
  const seed = join(dir, "camels.re64");
  writeFileSync(seed, JSON.stringify({ name: "camels", layers: [] }));
  const imported = importProject(seed);
  databasePath = imported.databasePath;
  storage = new SqliteStorage(databasePath, imported.projectId);
  ws = new Workspace({
    store: new ProjectStore(storage),
    storage,
    projectId: imported.projectId,
    projectPath: databasePath,
  });
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

function upload(name: string, bytes: Uint8Array): void {
  const hash = storage.putBlob(name, bytes);
  ws.noteUploadedFile(builder, name, hash, bytes.length);
}

const read = (target: string, from: number, to: number) =>
  ws.view(target).bytes(from, to - from + 1).hex.replace(/ /g, "");

/**
 * The patch, site by site, every reading taken from the bytes.
 *
 * Most of it is the hook shape every patch on a 6502 has: three bytes of the
 * original replaced by a call into new code that does what it replaced and
 * something else besides. `sC019` writes the `STA $1F99` it displaced and then
 * clears `$58`; `jC000` ends with the `JMP $94AF` it displaced.
 *
 * The two `A5 44` sites are not hooks, and they are the fix itself. `$44` is
 * this frame's snapshot of `$D01E`, the VIC's sprite-to-sprite collision
 * register — read once at `$8BFD` and stashed — so `LDA $44 / AND #$02` asks
 * whether the bullet collided with anything. `LDA #$FF` in its place makes the
 * answer always yes. That is precisely what the author said he had done:
 * "Bypassed the hardware collision detection, which I probably wasn't doing
 * right."
 */
const PATCH: { at: number; was: string; now: string; what: string }[] = [
  {
    at: 0x87f0,
    was: "205C54A97F8D0DDC20428A4C3C8A",
    now: "EAEAEAEAEAEAEAEAEAEAEAEAEAEA",
    what: "the standalone build's SYS 34800 launch, NOP'd — the disk build enters elsewhere",
  },
  { at: 0x8a8f, was: "8D991F", now: "2019C0", what: "STA $1F99 becomes JSR $C019" },
  // One change in two places: `LDA #$10 / STA $D012` with `ORA #$80` into
  // `$D011` is raster line $110; `#$F8` with `AND #$7F` is line $0F8. The split
  // moved, which is the kind of thing a new per-frame job needs.
  { at: 0x8be6, was: "10", now: "F8", what: "the raster compare, low byte" },
  { at: 0x8bed, was: "0980", now: "297F", what: "ORA #$80 becomes AND #$7F: raster bit 8, cleared" },
  { at: 0x9499, was: "4CAF94", now: "4C00C0", what: "JMP $94AF becomes JMP $C000" },
  { at: 0x9772, was: "20BB9D", now: "2061C0", what: "JSR $9DBB becomes JSR $C061" },
  { at: 0x9ab3, was: "A544", now: "A9FF", what: "the bullet's collision gate: LDA $44 becomes LDA #$FF" },
  { at: 0x9abc, was: "A544", now: "A9FF", what: "the same gate, second half" },
  { at: 0x9d99, was: "200A9E", now: "2023C0", what: "JSR $9E0A becomes JSR $C023" },
  { at: 0x9fe6, was: "4C3C8A", now: "4C82C0", what: "JMP $8A3C becomes JMP $C082" },
  {
    at: 0x9fff,
    was: "3A200140",
    now: "16CD0000",
    // Past the code, in the tail of a "CBOO:" string. What it is has not been
    // established, and saying so is better than a plausible guess.
    what: "the last four bytes of the 1984 image; purpose not established",
  },
];

/** Where the new code lives. Below $A003 the 1984 build simply stops. */
const ADDED_FROM = 0xc000;
const ADDED_TO = 0xc11e;

/** How many leading bytes the two spellings of a site share: a kept opcode. */
function shared(site: { was: string; now: string }): number {
  let i = 0;
  while (site.was.slice(i * 2, i * 2 + 2) === site.now.slice(i * 2, i * 2 + 2)) i += 1;
  return i;
}

const hex = (at: number) => `$${at.toString(16).toUpperCase().padStart(4, "0")}`;

/** Where the code is. Below this the two builds are different data, not a patch. */
const CODE_FROM = 0x87d0;
const CODE_TO = 0xa002;

describe("Revenge of the Mutant Camels, patched", () => {
  it("expresses the 2021 fix as an overlay, and proves it by byte identity", () => {
    upload(
      "revenge.d64",
      new Uint8Array(readFileSync("assets/mutant-camels/revenge-of-the-mutant-camels.d64"))
    );
    upload(
      "standalone.prg",
      new Uint8Array(readFileSync("assets/mutant-camels/revenge-of-the-mutant-camels.prg"))
    );

    // The disk holds the patched build, crunched. Running the loader is the only
    // way to see it: static analysis of the disk stops at 141 instructions.
    ws.addByteLayer(builder, { type: "prg", path: "revenge.d64:revenge fixed", name: "packed" });
    ws.runProgram(builder, 0x080d, { capture: { name: "shipped.prg", from: 0x0800, to: 0xc11f } });
    ws.addByteLayer(builder, { type: "prg", path: "shipped.prg", name: "shipped" });

    // And the .prg is the 1984 build, which needs no running at all.
    ws.addByteLayer(builder, { type: "prg", path: "standalone.prg", name: "original" });

    // One layer per site, each named for what it does — which is the whole
    // documentation value of a patch expressed as layers rather than as prose
    // about two fixtures.
    for (const site of PATCH) {
      ws.addByteLayer(builder, {
        type: "bytes",
        address: site.at,
        bytes: site.now,
        name: `patch $${site.at.toString(16).toUpperCase()}: ${site.what}`,
      });
    }
    const id = Object.fromEntries(ws.targets().layers.map((l) => [l.name, l.id]));
    const patchLinks = PATCH.map((site) => ({
      layer: id[`patch $${site.at.toString(16).toUpperCase()}: ${site.what}`],
    }));

    ws.addTarget(builder, "shipped", [{ layer: id.shipped }], [0xc065], 1, "The disk build.");
    ws.addTarget(builder, "original", [{ layer: id.original }], [0x87f0], 2, "The 1984 build.");
    // Plus the new code itself, which overlays nothing: below $A003 the 1984
    // build stops, so there is no byte here to replace. Read out of the shipped
    // image rather than written down — 287 bytes, and identity at $C000 is
    // therefore true by construction. What it buys is that `patched` is a whole
    // build somebody can disassemble, not an assertion vehicle. The claim that
    // carries weight is the one over the code.
    ws.addByteLayer(builder, {
      type: "bytes",
      address: ADDED_FROM,
      bytes: read("shipped", ADDED_FROM, ADDED_TO),
      name: "the $C000 block: the code the 2021 fix added",
    });
    const block = ws.targets().layers.find((l) => l.name.startsWith("the $C000 block"))!.id;

    ws.addTarget(
      builder,
      "patched",
      [{ layer: id.original }, ...patchLinks, { layer: block }],
      [0xc065],
      3,
      "The 1984 build with the May 2021 collision fix laid over it."
    );

    // **The assertion the overlay exists for.** Not "these fixtures differ in
    // thirty-six places" — anybody can count that. That the *named* thirty-six,
    // and nothing else, are the whole of the difference over the code.
    expect(read("patched", CODE_FROM, CODE_TO)).toBe(read("shipped", CODE_FROM, CODE_TO));
    expect(read("original", CODE_FROM, CODE_TO)).not.toBe(read("shipped", CODE_FROM, CODE_TO));

    // And the view is whole rather than only correct: `patched` is a build that
    // reaches $C11E and can be disassembled, not an assertion vehicle.
    expect(read("patched", ADDED_FROM, ADDED_TO)).toBe(read("shipped", ADDED_FROM, ADDED_TO));

    // Each site says what it replaced, and that is checked rather than trusted:
    // a `was` that has gone stale would otherwise sit in the table looking true.
    for (const site of PATCH) {
      const width = site.now.length / 2;
      expect(read("original", site.at, site.at + width - 1), `was at $${site.at.toString(16)}`).toBe(
        site.was
      );
      expect(read("patched", site.at, site.at + width - 1), `now at $${site.at.toString(16)}`).toBe(
        site.now
      );
    }
  });

  it("counts the patch, so a fixture that changed cannot pass quietly", () => {
    upload(
      "revenge.d64",
      new Uint8Array(readFileSync("assets/mutant-camels/revenge-of-the-mutant-camels.d64"))
    );
    upload(
      "standalone.prg",
      new Uint8Array(readFileSync("assets/mutant-camels/revenge-of-the-mutant-camels.prg"))
    );
    ws.addByteLayer(builder, { type: "prg", path: "revenge.d64:revenge fixed", name: "packed" });
    ws.runProgram(builder, 0x080d, { capture: { name: "shipped.prg", from: 0x0800, to: 0xc11f } });
    ws.addByteLayer(builder, { type: "prg", path: "shipped.prg", name: "shipped" });
    ws.addByteLayer(builder, { type: "prg", path: "standalone.prg", name: "original" });
    const id = Object.fromEntries(ws.targets().layers.map((l) => [l.name, l.id]));
    ws.addTarget(builder, "shipped", [{ layer: id.shipped }], undefined, 1);
    ws.addTarget(builder, "original", [{ layer: id.original }], undefined, 2);

    const a = read("original", CODE_FROM, CODE_TO);
    const b = read("shipped", CODE_FROM, CODE_TO);
    let bytes = 0;
    let previous = -2;
    const sites: number[] = [];
    for (let i = 0; i < a.length; i += 2) {
      if (a.slice(i, i + 2) === b.slice(i, i + 2)) continue;
      bytes += 1;
      const at = CODE_FROM + i / 2;
      if (at !== previous + 1) sites.push(at);
      previous = at;
    }

    // Thirty-six bytes in eleven runs, and the runs are where the table says.
    // Derived from the two fixtures and compared against the hand-written list,
    // so a table that drifts fails here rather than sitting there looking true.
    //
    // The table is addressed by *instruction* and the differing run usually
    // starts one byte later, because a hook keeps the `JSR` and changes only
    // where it goes. Trimming the bytes the two spellings share is what lines
    // the two up — and it is worth doing rather than writing the operand
    // addresses down, since `JMP $94AF becomes JMP $C000` is the readable fact
    // and `$949A` is not.
    expect(bytes).toBe(36);
    expect(sites.map(hex)).toEqual(PATCH.map((site) => hex(site.at + shared(site))));

    // $A003-$BFFF is 8,189 zero bytes: the gap between where the 1984 code
    // stops and where the 2021 code was put. Asserted because it is the reason
    // the added block can be 287 bytes rather than eight kilobytes.
    expect(new Set(read("shipped", 0xa003, 0xbfff).match(/../g))).toEqual(new Set(["00"]));

    // The zone table — 8,400 bytes, a fifth of the program and the thing the
    // whole analysis turns on — is untouched between the two builds. That is
    // what makes the mwenge listing's names transferable, and it is worth
    // asserting rather than assuming, since it is the basis for treating one
    // project as covering both.
    expect(read("original", 0x6700, 0x87cf)).toBe(read("shipped", 0x6700, 0x87cf));
  });
});
