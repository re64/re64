import { describe, it } from "vitest";
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
  it("how often a claim was swallowing reachable code", () => {
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
