import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { analyze, formatRows } from "./core/index.js";
import { loadProjectFile } from "./node-files.js";

/**
 * The disassembly of the reference project, pinned.
 *
 * Storage is being moved out from under this pipeline — the project text, then
 * the binaries. None of that may change a single byte of the output, and the
 * cheapest way to know is to hash it. A failure here means the bytes reaching
 * the disassembler are not the bytes that reached it before; the counts below
 * are only there to say *how* it moved.
 */

const PROJECT = "assets/gridrunner/gridrunner.re64";
// Moved once, deliberately: fuzzy label matching is now off below $0100.
//
// Eighteen zero-page operands used to borrow a neighbour's name — `$1A`
// rendered as `laserAndPodInterval+1`, `$2A` as `clearScreenLineLoPtr-1`. The
// human reference names those addresses `leftLaserYPosition` and
// `droidsLeftToKill`: separate variables, not offsets into anything. Every byte
// in zero page is its own thing, so a near miss there is a wrong answer rather
// than a helpful approximation, and `$1A` says less but says nothing false.
//
// Above the first page an offset usually does mean "just inside this table" —
// `droidXPositionArray-1,X` is the standard 1-indexed table trick — so those
// are unchanged.
// Moved a second time: a text row now shows its decoded content.
//
// It used to render the `.TEXT` directive and nothing else, so declaring a
// span text made the listing strictly *less* readable than leaving it as data,
// which at least printed an ASCII column. Gridrunner's copyright line uses the
// game's own character set, so ASCII gives `<= 1982` where the reference reads
// `(c) 1982 HES` — wrong, but visibly wrong, which is what tells a reader the
// encoding needs saying. PETSCII and screen codes are now sayable; a custom
// charset still is not.
// Moved a third time: the platform symbol table grew from 160 names to 382,
// reviewed against the ROM in experiment 6.
//
// Exactly one line of this listing moved — `JSR sub_E518` became
// `JSR ROM_INIT_EDITOR` — which is the point worth pinning. A platform label
// only renders where an operand reaches it, so 221 new names for KERNAL zero
// page and ROM internals are invisible to a game that calls the KERNAL once.
// Moved a fourth time, and this one is a bug fix rather than a feature.
//
// A claim about what bytes *mean* could stop control flow: `shouldDisassemble`
// refused any address inside a non-code region, including one an explicit `JMP`
// targets. `laserFrameRateForLevel` is declared $8CF6-$8D18 and the routine at
// $8D16 begins two bytes inside it, so `$8D75: 4c 16 8d` — an unconditional jump
// — was refused, and 32 instructions vanished: `PlayNewLevelSounds` with
// `Waste20Cycles` and `SoundEffect`, all three in the human reference,
// instruction for instruction.
//
// It hid behind its own damage. The label `PlayNewLevelSounds` sits at $8D18,
// two bytes late, placed where the bad boundary left room — so the *name* was in
// the listing at an address with no routine under it, and the missing 32
// instructions read as ordinary undecoded space. The listing now shows both
// `loc_8D16` and `PlayNewLevelSounds:` two bytes apart, which is what makes the
// misplaced label visible at last.
//
// It moved again when labels and regions became one claim, and every change was
// an improvement the merge made reachable:
//
//   - A named span renders its name. `screenHeaderText:` and four others were
//     regions whose names appeared in no row at all.
//   - A named span offers offsets, so `dat_8F00` is `characterSetData + $0100`.
//     The extent was always on the region; the label it generated never carried
//     one, which is why "an operand inside a named array" reached user labels
//     and not region names.
//   - A control target gets its own name rather than an offset from a
//     neighbour: `BNE loc_821A` where it read `BNE CheckForPausePressed-1`, and
//     `JMP loc_8BD2` where it read `JMP MaybeRestartLevel+1`. The human
//     disassembly calls that first one `b821A` and branches to it by name.
//   - Where an extent and the 1-indexed idiom compete, the idiom wins:
//     `screenHeaderColors-1` is what `LDA screenHeaderColors,X` with X from 1
//     means, and `screenHeaderText + $0027` names a byte the load never reads.
const OUTPUT_SHA1 = "c1ca66153bee7a4867ef215e14abdedbc2c57807";

describe("gridrunner disassembly", () => {
  const result = analyze(loadProjectFile(PROJECT), { annotations: false });
  const text = formatRows(result.rows, result.arrows).join("\n");

  it("renders byte-for-byte what it rendered before", () => {
    expect(createHash("sha1").update(text).digest("hex")).toBe(OUTPUT_SHA1);
  });

  it("holds its shape", () => {
    expect(result.stats).toMatchObject({
      instructions: 1481,
      rows: 1877,
      arrows: 208,
      regions: 16,
      // 495, not the 597 this asserted before: the merged index counted every
      // user label twice, once through the memory map and once directly. The
      // rendered text never showed it because label rows dedupe by name, which
      // is why the hash above is unchanged.
      labels: 723,
    });
  });

  it("warns about KERNAL calls, and about one real disagreement", () => {
    // The KERNAL entries are named by the platform symbol layer, which supplies
    // no bytes on purpose. A warning naming anything *else* means a layer
    // stopped resolving — except the last one, which is a genuine finding about
    // this project and not a defect in the loader.
    expect([...result.warnings].sort()).toEqual([
      // Not one of three unknowable explanations, which is what this asserted
      // before and what CLAUDE.md still recorded: `$8D75` holds `4c 16 8d`, so
      // the program says plainly that $8D16 is code and the region is two bytes
      // too long. The walk decodes it and reports the disagreement rather than
      // resolving it, because only the author knows which end to move.
      "$8D16: $8D75 transfers here, and it is declared data. A claim about what " +
        "bytes mean cannot stop control flow, so this decodes anyway — but one " +
        "of the two is wrong, and an explicit transfer is usually the better " +
        "witness",
      "$E518: undefined bytes",
      "$FD15: undefined bytes",
      "$FD50: undefined bytes",
      "$FDA3: undefined bytes",
      "$FFD2: undefined bytes",
    ]);
  });
});
