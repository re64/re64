import { describe, it, expect } from "vitest";
import { analyzeProgram } from "./program.js";
import { loadProjectFile } from "../../node-files.js";

/**
 * The questions an agent asks about a project.
 *
 * Every one of these was computed on every render and thrown away — the row
 * builder produced them, used them to draw text, and returned only the text.
 * These tests are the record of which are now answerable and which are not.
 */

const gridrunner = () => analyzeProgram(loadProjectFile("assets/gridrunner.re64"));

describe("what an agent can now ask", () => {
  it("which branch targets are still auto-named", () => {
    const program = gridrunner();
    const auto = program.labels.filter({ source: "auto" });

    expect(auto.length).toBeGreaterThan(0);
    // The prefix says what the disassembly could tell about each.
    expect(auto.every((l) => /^(sub|loc|dat)_[0-9A-F]{4}$/.test(l.name))).toBe(true);
    expect(auto.some((l) => l.name.startsWith("loc_"))).toBe(true);
  });

  it("what calls this address", () => {
    const program = gridrunner();
    const called = program.xrefs.callTargets();
    expect(called.length).toBeGreaterThan(0);

    const target = called[0];
    const callers = program.xrefs.to(target).filter((r) => r.type === "call");
    expect(callers.length).toBeGreaterThan(0);
    // Every caller is itself a decoded instruction.
    expect(callers.every((r) => program.instructions.has(r.from))).toBe(true);
  });

  it("what this instruction references", () => {
    const program = gridrunner();
    const jsr = program.instructions.all().find((i) => i.flow === "call");
    expect(jsr).toBeDefined();

    const out = program.outbound.from(jsr!.address);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("call");
  });

  it("sees zero-page references the reference map does not", () => {
    // Only absolute modes are recorded as references, so a `LDA $02` naming a
    // variable is invisible there. The outbound index reads the operand.
    const program = gridrunner();
    const zeroPage = program.instructions
      .all()
      .filter((i) => i.operand.type === "zeroPage")
      .map((i) => program.outbound.from(i.address))
      .filter((refs) => refs.length > 0);

    expect(zeroPage.length).toBeGreaterThan(0);
  });

  it("which code has actually been decoded", () => {
    const program = gridrunner();
    // $8000 is a jump table entry, so it is data and never decoded — which is
    // itself the point: this reports what was decoded, not what was reached.
    expect(program.instructions.has(0x8000)).toBe(false);
    expect(program.instructions.has(0x8011)).toBe(true);
    // Deliberately the decoded set, not the queue's visited set — that includes
    // addresses reached and then rejected.
    expect(program.instructions.size).toBe(1480);
  });

  it("where disassembly started", () => {
    // Declared in the project file, which outranks the PRG load address.
    expect(gridrunner().entryPoints).toContain(0x8011);
  });

  it("which regions are still unclassified", () => {
    const program = gridrunner();
    const unknown = program.loaded.map.getAllRegions().filter((r) => r.kind === "unknown");
    // None here, but the query resolves. Note this finds only regions declared
    // as unknown — an address covered only by a layer default is not a region
    // at all, so there is no "unclassified extent" behind this.
    expect(Array.isArray(unknown)).toBe(true);
  });

  it("how much is named by a person rather than by the disassembler", () => {
    const program = gridrunner();
    const auto = program.labels.filter({ source: "auto" }).length;
    const chosen = program.labels.getAllLabels().length - auto;

    expect(chosen).toBeGreaterThan(0);
    expect(auto).toBeGreaterThan(0);
  });
});

describe("what an agent still cannot ask", () => {
  it("has no notion of where a function ends", () => {
    // So "what does this routine call" and "what data does it touch" are not
    // answerable — both need an extent, and there are no basic blocks, no
    // dominators and no call graph. An honest gap beats a tool that guesses.
    const program = gridrunner();
    expect(program).not.toHaveProperty("functions");
    expect(program).not.toHaveProperty("blocks");
  });
});

describe("filtering labels", () => {
  it("narrows by type", () => {
    const functions = gridrunner().labels.filter({ type: "function" });
    expect(functions.length).toBeGreaterThan(0);
    expect(functions.every((l) => l.type === "function")).toBe(true);
  });

  it("narrows by name, case-insensitively", () => {
    const found = gridrunner().labels.filter({ namePattern: "grid" });
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((l) => l.name.toLowerCase().includes("grid"))).toBe(true);
  });

  it("narrows by address range, half-open", () => {
    const inRange = gridrunner().labels.filter({ range: { start: 0x8000, end: 0x8100 } });
    expect(inRange.length).toBeGreaterThan(0);
    expect(inRange.every((l) => l.address >= 0x8000 && l.address < 0x8100)).toBe(true);
  });

  it("combines criteria", () => {
    const autoCode = gridrunner().labels.filter({ source: "auto", type: "code" });
    expect(autoCode.every((l) => l.name.startsWith("loc_"))).toBe(true);
  });
});
