import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { analyzeProgram } from "../analysis/program.js";
import { loadProjectFile } from "../../node-files.js";
import { describeWarning } from "../arch/mos6502/disassembler.js";

/**
 * How often was a claim deleting reachable code?
 *
 * Every `.re64` in the repository, which is the reference project plus what the
 * experiments produced — seven runs of agents annotating three programs. The
 * question is whether Gridrunner's two-byte region overrun was a one-off or the
 * visible instance of something systematic.
 */
function findProjects(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) findProjects(path, out);
    else if (entry.endsWith(".re64")) out.push(path);
  }
  return out;
}

describe("survey", () => {
  it("the reference project has exactly one contested address, and it is $8D16", () => {
    const program = analyzeProgram(loadProjectFile("assets/gridrunner/gridrunner.re64"));
    const contested = program.warnings.filter((w) => w.type === "codeInClaim");

    // `laserFrameRateForLevel` is declared two bytes too long and $8D75 jumps
    // past its end into `PlayNewLevelSounds`. Pinned so that a *second* one
    // appearing is noticed: a contested address is a real disagreement between
    // an annotation and the program, and the reference project should have one.
    expect(contested).toHaveLength(1);
    expect(contested[0]).toMatchObject({ address: 0x8d16, kind: "data", from: 0x8d75 });
  });

  it("no other project in the repository is losing code to a claim", () => {
    const losing: string[] = [];
    for (const path of findProjects(".").sort()) {
      if (path.includes("gridrunner.re64")) continue;
      let program;
      try {
        program = analyzeProgram(loadProjectFile(path));
      } catch {
        // A project whose binaries are not in the repository. Skipped rather
        // than failed: the experiment directories keep the annotations and
        // deliberately not the games.
        continue;
      }
      for (const w of program.warnings) {
        if (w.type === "codeInClaim") losing.push(`${path} ${w.address.toString(16)}`);
      }
    }
    // Experiment 4 forked the reference project, so it carries the same overrun.
    expect(losing.filter((l) => !l.includes("04-improvement"))).toEqual([]);
  });

  it("what every project says, for the record", () => {
    for (const path of findProjects(".").sort()) {
      let program;
      try {
        program = analyzeProgram(loadProjectFile(path));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.log(`${path}: SKIP ${(e as Error).message.slice(0, 60)}`);
        continue;
      }
      const contested = program.warnings.filter((w) => w.type === "codeInClaim");
      const stopped = program.warnings.filter((w) => w.type === "flowIntoData");
      if (contested.length === 0 && stopped.length === 0) continue;
      // eslint-disable-next-line no-console
      console.log(`\n${path}  (${program.instructions.size} instructions)`);
      for (const w of contested) console.log("  RECOVERED  " + describeWarning(w).slice(0, 120));
      for (const w of stopped) console.log("  STOPPED    " + describeWarning(w).slice(0, 100));
    }
  });
});
