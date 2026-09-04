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
import { BasicBlock, buildBlocks } from "./blocks.js";
import { DisassemblyWarning } from "../arch/mos6502/disassembler.js";
import { Label, LabelIndex, createAutoLabel } from "../memory/label.js";
import { HygieneFinding, checkHygiene } from "./hygiene.js";
import { decimalSites } from "./flags.js";
import { ValueAnalysis, proveValues } from "./values.js";
import { classifyOrigins, kernalClobbers } from "../c64/entry-vectors.js";
import type { DecimalMode } from "../il/lift.js";
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
   * Where execution begins, as opposed to where decoding does.
   *
   * A strict subset of `entryPoints`: the declared entry points, the load
   * addresses, and `entry`-typed labels. A dataflow pass seeds from these,
   * because an origin means "nothing is known here" and a routine label is not
   * that — it is called, and gets its state from whoever calls it.
   */
  origins: readonly number[];
  /**
   * What is known about the machine at each instruction, computed on demand.
   *
   * Deliberately lazy: the fixpoint costs about as much as the disassembly it
   * follows, and nothing on the read path needs it until a question about a
   * flag is asked.
   */
  readonly values: ValueAnalysis;
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
  /**
   * Straight-line runs, which may intersect where a byte is read two ways.
   *
   * The model an instruction map cannot hold, and what function extents, the
   * call graph and per-block reachability all wait on.
   */
  blocks: BasicBlock[];
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
  /**
   * What is wrong with the *annotations*, as opposed to with the program.
   *
   * Kept apart from `warnings` because the subjects differ: a warning is a
   * fact about 1982 that you investigate, a hygiene finding is a fact about
   * your own project that you tidy. See `hygiene.ts` for what qualifies — the
   * short version is that it must have a rendering consequence, and that zero
   * is the resting state, which is what keeps `find_undecoded`'s kind of
   * "incompleteness" out of it.
   */
  hygiene: readonly HygieneFinding[];
  /**
   * Every `ADC` or `SBC` the analysis could not prove runs in binary.
   *
   * Empty on both real targets: Gridrunner clears `D` once and never sets it,
   * and the KERNAL does the same in its reset routine with no reachable `SED`
   * in 8KB. So this is a short list by construction, and a lead when it is not
   * — BCD arithmetic on this machine almost always means a score, a clock, or a
   * number being shown to somebody.
   */
  decimalSites: readonly { address: number; mode: DecimalMode }[];
}

const hex4 = (address: number) => address.toString(16).toUpperCase().padStart(4, "0");

/** Where to start, in order of authority. */
/**
 * Where execution *begins*, which is not where decoding begins.
 *
 * `entryPointsFor` returns decode roots — every `entry`, `function` and `code`
 * label, plus the start of every code region — because all of them are places
 * the disassembler must look. A dataflow analysis needs something narrower: an
 * origin is an address reached from outside the program, where nothing can be
 * assumed about the machine's state.
 *
 * This file's own guidance predicted the moment the two would have to part:
 *
 * > Do not collapse these because they behave alike today. That sameness is an
 * > artifact of the disassembler only ever queueing them; they diverge as soon
 * > as there is call-graph or basic-block analysis.
 *
 * Treating a `function` label as an origin is not merely imprecise, it is
 * *contaminating*: an origin asserts "the flags are unknown here", and joining
 * that into code the real start had already proved something about destroys the
 * proof. On the reference project it is the difference between `D` proved binary
 * at every arithmetic site and at none of them.
 */
function executionOrigins(loaded: LoadedProject, override?: number[]): number[] {
  if (override?.length) return override;
  const { project, prgEntries, userLabels } = loaded;
  const declared = project.entryPoints?.map(parseProjectAddress) ?? [];
  const entryLabels = userLabels
    .getAllLabels()
    .filter((l) => l.type === "entry")
    .map((l) => l.address);
  return [...new Set([...declared, ...prgEntries, ...entryLabels])];
}

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
  const origins = executionOrigins(loaded, override);
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
  let cachedValues: ValueAnalysis | undefined;
  let cachedDecimal: ReturnType<typeof decimalSites> | undefined;
  labels.addLabels(autoLabels);

  const instructions = new InstructionIndex(result.instructions);
  // Blocks from the main reading, plus one set per alternate reading of a
  // contested byte. Each stream is decoded against its own occupancy, so each
  // set is internally consistent; between sets they intersect, which is the
  // whole point and what `overlappingBlocks` then finds.
  const blocks = [
    ...buildBlocks(instructions, entryPoints),
    ...result.shadows.flatMap((stream) =>
      buildBlocks(new InstructionIndex(stream.instructions), [stream.from], {
        alternate: true,
      })
    ),
  ];

  return {
    loaded,
    blocks,
    entryPoints,
    origins,
    instructions,
    xrefs: new XrefIndex(result.references),
    outbound: OutboundIndex.from(instructions),
    labels,
    autoLabels,
    warnings: result.warnings,
    hygiene: checkHygiene(loaded, labels, instructions),
    // Lazy, and it has to be. The value fixpoint costs about as much again as
    // the whole disassembly, and `analyze()` runs on every document update with
    // a budget of roughly 30ms before the browser stutters under a
    // collaborator. Nothing on the read path asks for this until something asks
    // about a flag.
    get values(): ValueAnalysis {
      return (cachedValues ??= proveValues(blocks, origins, {
        cover: entryPoints,
        kinds: classifyOrigins(map),
        externalWrites: kernalClobbers(map),
      }));
    },
    get decimalSites() {
      return (cachedDecimal ??= decimalSites(blocks, entryPoints, this.values));
    },
  };
}
