/**
 * What a program actually is, separately from how it is drawn.
 *
 * This used to live inside the row builder, which computed all of it and then
 * returned only rendered text. Everything an agent wants to know — which
 * branch targets are still auto-named, what calls this address, what has been
 * decoded at all — was computed and thrown away on every render.
 *
 * The rendering path calls this and then formats it. Anything asking a question
 * about the program calls it and stops here, paying nothing for rows it will
 * not read.
 */

import { InstructionIndex, disassemble } from "../arch/mos6502/disassembler.js";
import { DisassemblyWarning } from "../arch/mos6502/disassembler.js";
import { Label, LabelIndex, createAutoLabel } from "../memory/label.js";
import { LoadedProject } from "../project/loader.js";
import { parseProjectAddress } from "../project/project.js";
import { derivedId } from "../project/identity.js";
import { OutboundIndex, XrefIndex } from "./xrefs.js";

export interface ProgramOptions {
  /** How far a reference may be from a label before it stops resolving to it. */
  labelTolerance?: number;
  /** Disassemble from here instead of the project's own entry points. */
  entryPoints?: number[];
}

export interface ProgramAnalysis {
  loaded: LoadedProject;
  /** Where disassembly started, after resolving project and label sources. */
  entryPoints: readonly number[];
  /**
   * Every decoded instruction.
   *
   * Also the reachability oracle: `has(address)` means the work queue got there
   * *and* decoded it. Deliberately not the queue's own visited set, which
   * includes addresses that were reached and then rejected.
   */
  instructions: InstructionIndex;
  /** Who references an address. */
  xrefs: XrefIndex;
  /** What an address references. */
  outbound: OutboundIndex;
  /** Every label, including the auto-generated ones the disassembly invented. */
  labels: LabelIndex;
  /**
   * The labels nobody chose.
   *
   * `sub_`/`loc_`/`dat_` by what refers to them. This is the agent's work
   * queue: an auto-named address is one nothing has been understood about yet.
   */
  autoLabels: readonly Label[];
  warnings: readonly DisassemblyWarning[];
}

const hex4 = (address: number) => address.toString(16).toUpperCase().padStart(4, "0");

/** Where to start, in order of authority. */
function entryPointsFor(loaded: LoadedProject, override?: number[]): number[] {
  const { project, prgEntries, userLabels } = loaded;

  const fromLabels = userLabels
    .getAllLabels()
    .filter((l) => l.type === "entry" || l.type === "function" || l.type === "code")
    .map((l) => l.address);

  // Declaring a span "code" starts decoding at its first address.
  //
  // It used to do nothing unless the region also carried a name, because only
  // a named region generated the entry-typed label that seeds the queue. So
  // "this is code" was inert exactly when it was most needed — on a span
  // nothing reaches — and the only way through was to declare it a subroutine,
  // which forces a fabricated sub_ name onto an address nobody wanted to name.
  //
  // An entry point rather than a label, so nothing appears in the listing that
  // a person did not put there.
  const fromCodeRegions = loaded.map
    .getAllRegions()
    .filter((r) => r.kind === "code")
    .map((r) => r.start);

  if (override?.length) return override;

  const declared = project.entryPoints?.map(parseProjectAddress) ?? [];
  if (declared.length > 0) return [...declared, ...fromLabels, ...fromCodeRegions];
  if (prgEntries.length > 0) return [...prgEntries, ...fromLabels, ...fromCodeRegions];
  return [...fromLabels, ...fromCodeRegions];
}

/**
 * Name the reference targets nobody has named.
 *
 * The prefix says what the disassembly could tell: something called it, jumped
 * to it, or only read it. Rewriting one of these is the fundamental unit of
 * progress, which is why the naming rule and the work queue are the same thing.
 */
function autoLabelsFor(
  references: ReadonlyMap<number, { type: string }[]>,
  known: LabelIndex,
  labelTolerance: number
): Label[] {
  const invented: Label[] = [];

  for (const [address, refs] of references) {
    if (known.resolve(address, labelTolerance)) continue;
    const id = derivedId("lbl", "auto", address);
    const name = hex4(address);

    if (refs.some((r) => r.type === "call")) {
      invented.push(createAutoLabel(id, address, `sub_${name}`, "function"));
    } else if (refs.some((r) => r.type === "jump" || r.type === "branch")) {
      invented.push(createAutoLabel(id, address, `loc_${name}`, "code"));
    } else {
      invented.push(createAutoLabel(id, address, `dat_${name}`, "address"));
    }
  }

  return invented;
}

export function analyzeProgram(
  loaded: LoadedProject,
  options: ProgramOptions = {}
): ProgramAnalysis {
  const { labelTolerance = 1, entryPoints: override } = options;
  const { map, userLabels } = loaded;

  const entryPoints = entryPointsFor(loaded, override);
  const result = disassemble(map, { entryPoints, regions: map });

  const labels = new LabelIndex();
  labels.addLabels(map.getLabels().getAllLabels());
  labels.addLabels(userLabels.getAllLabels());
  // Carried across explicitly. This index is built fresh from labels alone, so
  // both of these were being dropped — which meant promoting a label changed
  // what `getLabels()` returned and nothing about what anyone saw.
  labels.setPrimaryLabels(map.primaryLabels);
  for (const [site, labelId] of map.labelUses) labels.bindUse(site, labelId);

  const autoLabels = autoLabelsFor(result.references, labels, labelTolerance);
  labels.addLabels(autoLabels);

  const instructions = new InstructionIndex(result.instructions);

  return {
    loaded,
    entryPoints,
    instructions,
    xrefs: new XrefIndex(result.references),
    outbound: OutboundIndex.from(instructions),
    labels,
    autoLabels,
    warnings: result.warnings,
  };
}
