/**
 * Builds the renderable document: one row per line, carrying the semantic spans
 * a consumer needs.
 *
 * Renderer-agnostic on purpose. The CLI prints `row.text` and ignores the
 * spans; the web UI turns the same spans into clickable decorations. Neither
 * parses assembler text back into meaning — see "UI Design Decisions" in
 * CLAUDE.md.
 */

import {
  LabelIndex,
  Label,
  LabelType,
  createAutoLabel,
  disassemble,
  formatOperand,
  InstructionIndex,
  LoadedProject,
  parseProjectAddress,
  RegionKind,
  derivedId,
} from "../index.js";
import { ArrowSpan, allocateArrowLanes, renderArrowGutter } from "./arrows.js";

/** A clickable span within a row's text, as character offsets into `text`. */
export interface RowToken {
  start: number;
  end: number;
  kind: "operand" | "label" | "xref" | "mnemonic" | "labeltype";
  /** Address this token navigates to, when clicked. */
  target?: number;
  /** Label name, for rename actions. */
  name?: string;
  /** Label type, for the type tag and for cycling it. */
  labelType?: LabelType;
}

/**
 * Short tags for the label types that change disassembly behaviour. Entry,
 * function, and code labels are queued as entry points; "address" is not, and
 * is left untagged since it is the default.
 */
export const LABEL_TYPE_TAGS: Record<LabelType, string> = {
  entry: "entry",
  function: "fn",
  code: "code",
  address: "addr",
};

export type RowKind = "label" | "instruction" | "data" | "text" | "word";

/** One rendered line of the disassembly view. */
export interface Row {
  address: number;
  kind: RowKind;
  text: string;
  tokens: RowToken[];
  /** True for illegal/undocumented opcodes. */
  illegal?: boolean;
}

export interface AnalysisResult {
  rows: Row[];
  /** Line index (0-based) of the first row at each address, for navigation. */
  lineForAddress: Record<number, number>;
  /**
   * Pre-rendered nested arrow gutter, one string per row, all the same width.
   * Empty when no local control flow qualified.
   */
  arrows: string[];
  warnings: string[];
  stats: {
    instructions: number;
    labels: number;
    regions: number;
    rows: number;
    arrows: number;
    arrowsDemoted: number;
  };
}


const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");
const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");


/**
 * Disassemble a loaded project into renderable rows.
 *
 * Mirrors the CLI's walk over the address range, but emits structured rows with
 * click targets rather than printing.
 */
/** What a consumer wants out of the view model. */
export interface AnalyzeOptions {
  /** Max offset for fuzzy label matching. */
  labelTolerance?: number;
  /**
   * Include interaction affordances in row text: label type tags and inbound
   * xref stubs.
   *
   * On for the web UI, where they are clickable. Off for plain text output,
   * where nothing can be clicked and they would only be noise.
   */
  annotations?: boolean;
  /**
   * Entry points to disassemble from, overriding the ones derived from the
   * project and its layers. The CLI exposes this as -e.
   */
  entryPoints?: number[];
}

export function analyze(
  loaded: LoadedProject,
  options: AnalyzeOptions | number = {}
): AnalysisResult {
  // A bare number is the old labelTolerance argument.
  const {
    labelTolerance = 1,
    annotations = true,
    entryPoints: entryPointOverride,
  } = typeof options === "number" ? { labelTolerance: options } : options;


  const { project, map, prgEntries, userLabels } = loaded;

  const labelEntryPoints = userLabels
    .getAllLabels()
    .filter((l) => l.type === "entry" || l.type === "function" || l.type === "code")
    .map((l) => l.address);

  const projectEntryPoints = project.entryPoints?.map(parseProjectAddress) ?? [];

  let entryPoints: number[];
  if (entryPointOverride?.length) {
    entryPoints = entryPointOverride;
  } else if (projectEntryPoints.length > 0) {
    entryPoints = [...projectEntryPoints, ...labelEntryPoints];
  } else if (prgEntries.length > 0) {
    entryPoints = [...prgEntries, ...labelEntryPoints];
  } else {
    entryPoints = labelEntryPoints;
  }

  const result = disassemble(map, { entryPoints, regions: map });
  const index = new InstructionIndex(result.instructions);

  const allLabels = new LabelIndex();
  allLabels.addLabels(map.getLabels().getAllLabels());
  allLabels.addLabels(userLabels.getAllLabels());

  // Auto-labels for otherwise-unnamed reference targets (lowest priority).
  const autoLabels: Label[] = [];
  for (const [targetAddr, refs] of result.references) {
    if (allLabels.resolve(targetAddr, labelTolerance)) continue;
    const addrStr = hex4(targetAddr);
    if (refs.some((r) => r.type === "call")) {
      autoLabels.push(createAutoLabel(derivedId("lbl", "auto", targetAddr), targetAddr, `sub_${addrStr}`, "function"));
    } else if (refs.some((r) => r.type === "jump" || r.type === "branch")) {
      autoLabels.push(createAutoLabel(derivedId("lbl", "auto", targetAddr), targetAddr, `loc_${addrStr}`, "code"));
    } else {
      autoLabels.push(createAutoLabel(derivedId("lbl", "auto", targetAddr), targetAddr, `dat_${addrStr}`, "address"));
    }
  }
  allLabels.addLabels(autoLabels);

  const resolveLabel = (addr: number) => {
    const resolved = allLabels.resolve(addr, labelTolerance);
    return resolved
      ? { name: resolved.label.name, offset: resolved.offset }
      : undefined;
  };

  // Symbol layers describe the address space but occupy none of it, so the
  // rendered range comes only from layers that actually supply bytes.
  const byteLayers = map.getLayers().filter((l) => l.hasBytes);
  const rangeStart = byteLayers.length ? Math.min(...byteLayers.map((l) => l.start)) : 0;
  const rangeEnd = byteLayers.length ? Math.max(...byteLayers.map((l) => l.end)) : 0;

  const rows: Row[] = [];
  const lineForAddress: Record<number, number> = {};
  // Arrow sources must anchor on the instruction itself, not on a label row
  // that happens to share the address.
  const instructionLine: Record<number, number> = {};

  const push = (row: Row) => {
    if (lineForAddress[row.address] === undefined) {
      lineForAddress[row.address] = rows.length;
    }
    if (row.kind === "instruction") {
      instructionLine[row.address] = rows.length;
    }
    rows.push(row);
  };

  /** Emit label rows, plus an inbound xref stub when references exist. */
  const emitLabels = (addr: number) => {
    const here = allLabels.getLabelsAt(addr);
    // The built-in name is redundant wherever the project supplied one, and
    // rendering both would show CHROUT and ROM_CHROUT on consecutive rows.
    const shown = here.some((l) => l.source.kind !== "platform")
      ? here.filter((l) => l.source.kind !== "platform")
      : here;

    const seen = new Set<string>();
    for (const label of shown) {
      if (seen.has(label.name)) continue;
      seen.add(label.name);

      const prefix = `${hex4(addr)}  `;
      let text = `${prefix}${label.name}:`;
      const tokens: RowToken[] = [
        {
          start: prefix.length,
          end: prefix.length + label.name.length,
          kind: "label",
          target: addr,
          name: label.name,
          labelType: label.type,
        },
      ];

      // "address" is the default and by far the most common, so tagging it
      // would add noise to most rows without saying anything.
      if (annotations && label.type !== "address") {
        const tag = ` [${LABEL_TYPE_TAGS[label.type]}]`;
        tokens.push({
          start: text.length + 1,
          end: text.length + tag.length,
          kind: "labeltype",
          target: addr,
          name: label.name,
          labelType: label.type,
        });
        text += tag;
      }

      const refs = annotations ? result.references.get(addr) : undefined;
      if (refs && refs.length > 0) {
        const stub = `  ◂ ${refs.length} ref${refs.length === 1 ? "" : "s"}`;
        tokens.push({
          start: text.length + 2,
          end: text.length + stub.length,
          kind: "xref",
          target: refs[0].from,
        });
        text += stub;
      }

      push({ address: addr, kind: "label", text, tokens });
    }
  };

  const bytesColumn = (bytes: number[]) => bytes.map(hex2).join(" ");

  /** Raised where the walk fails to advance; see the guard at the loop foot. */
  const walkWarnings: string[] = [];

  let addr = rangeStart;
  while (addr < rangeEnd) {
    const addrAtStart = addr;
    const instr = index.get(addr);

    if (instr) {
      emitLabels(addr);

      const prefix = `${hex4(addr)}  ${bytesColumn([...instr.bytes]).padEnd(8)}  `;
      const marker = instr.illegal ? "*" : " ";
      const operandStr = formatOperand(instr.operand, resolveLabel);
      const mnemonicStart = prefix.length + marker.length;

      let text = `${prefix}${marker}${instr.mnemonic}`;
      const tokens: RowToken[] = [
        {
          start: mnemonicStart,
          end: mnemonicStart + instr.mnemonic.length,
          kind: "mnemonic",
        },
      ];

      if (operandStr) {
        const operandStart = mnemonicStart + instr.mnemonic.length + 1;
        text += ` ${operandStr}`;
        const target = operandTarget(instr.operand);
        if (target !== undefined) {
          tokens.push({
            start: operandStart,
            end: operandStart + operandStr.length,
            kind: "operand",
            target,
          });
        }
      }

      push({ address: addr, kind: "instruction", text, tokens, illegal: instr.illegal });
      addr += instr.bytes.length;
      continue;
    }

    const kind = map.getKindAt(addr) ?? "data";
    const strategy = rowStrategy(kind);

    if (strategy === "word") {
      emitLabels(addr);
      const lo = map.readByte(addr);
      const hi = map.readByte(addr + 1);
      if (lo !== undefined && hi !== undefined) {
        const target = lo | (hi << 8);
        const resolved = resolveLabel(target);
        const shown = resolved
          ? resolved.offset === 0
            ? resolved.name
            : `${resolved.name}${resolved.offset > 0 ? "+" : ""}${resolved.offset}`
          : `$${hex4(target)}`;
        const prefix = `${hex4(addr)}  ${bytesColumn([lo, hi]).padEnd(8)}  .WORD `;
        push({
          address: addr,
          kind: "word",
          text: `${prefix}${shown}`,
          tokens: [
            { start: prefix.length, end: prefix.length + shown.length, kind: "operand", target },
          ],
        });
      }
      addr += 2;
      continue;
    }

    // Data and text regions: accumulate up to 8 bytes per row, breaking at
    // labels, region boundaries, and decoded instructions.
    const isText = strategy === "text";
    const bytes: number[] = [];
    let lineStart = addr;

    const flush = () => {
      if (bytes.length === 0) return;
      emitLabels(lineStart);
      const cols = bytesColumn(bytes).padEnd(23);
      const text = isText
        ? `${hex4(lineStart)}  ${cols}  .TEXT`
        : `${hex4(lineStart)}  ${cols}  |${bytes
            .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : "."))
            .join("")}|`;
      push({ address: lineStart, kind: isText ? "text" : "data", text, tokens: [] });
      bytes.length = 0;
    };

    while (addr < rangeEnd && !index.has(addr)) {
      // Stop where a different strategy takes over, so every byte in the range
      // is claimed by exactly one branch of the outer dispatch.
      if (rowStrategy(map.getKindAt(addr) ?? "data") !== strategy) break;
      if (bytes.length > 0 && allLabels.hasLabelAt(addr)) break;

      const byte = map.readByte(addr);
      if (byte === undefined) {
        flush();
        addr++;
        lineStart = addr;
        continue;
      }

      bytes.push(byte);
      addr++;
      if (bytes.length === 8) {
        flush();
        lineStart = addr;
      }
    }
    flush();

    // Every branch above is meant to consume at least one byte. If none did,
    // something is unhandled: step over it rather than spinning forever, and
    // say so, because silence here would look like a hang.
    if (addr === addrAtStart) {
      walkWarnings.push(
        `${hex4(addr)}: could not render (region kind "${kind}"); skipped one byte`
      );
      addr++;
    }
  }

  const warnings = result.warnings.map((w) => {
    switch (w.type) {
      case "undefined":
        return `$${hex4(w.address)}: undefined bytes`;
      case "truncated":
        return `$${hex4(w.address)}: truncated instruction (needed ${w.needed}, got ${w.available})`;
      case "overlap":
        return `$${hex4(w.address)}: overlaps instruction at $${hex4(w.existingAddress)}`;
    }
  });

  warnings.push(...walkWarnings);

  const { arrows: arrowSpans, demoted } = allocateArrowLanes(
    result.references,
    lineForAddress,
    instructionLine
  );

  return {
    rows,
    lineForAddress,
    arrows: renderArrowGutter(arrowSpans, rows.length),
    warnings,
    stats: {
      instructions: result.instructions.size,
      labels: allLabels.getAllLabels().length,
      regions: map.getAllRegions().length,
      rows: rows.length,
      arrows: arrowSpans.length,
      arrowsDemoted: demoted,
    },
  };
}

/**
 * How a region kind is rendered.
 *
 * Exhaustive on purpose: adding a `RegionKind` without deciding how to render
 * it fails to compile rather than falling through at runtime. The walk below
 * dispatches on the strategy rather than on the kind, so the outer branch and
 * the inner accumulator cannot disagree about who handles what — which is
 * exactly how an unhandled kind used to leave the address un-advanced.
 */
type RowStrategy = "word" | "text" | "bytes";

function rowStrategy(kind: RegionKind): RowStrategy {
  switch (kind) {
    case "jumptable":
      return "word";
    case "text":
      return "text";
    case "data":
    case "code":
    case "unknown":
      return "bytes";
    default: {
      const unhandled: never = kind;
      throw new Error(`unhandled region kind: ${String(unhandled)}`);
    }
  }
}

/** The address an operand refers to, if it refers to one at all. */
function operandTarget(operand: { type: string } & Record<string, unknown>): number | undefined {
  switch (operand.type) {
    case "zeroPage":
    case "zeroPageX":
    case "zeroPageY":
    case "absolute":
    case "absoluteX":
    case "absoluteY":
    case "indirect":
    case "indexedIndirect":
    case "indirectIndexed":
      return operand.address as number;
    case "relative":
      return operand.target as number;
    default:
      return undefined;
  }
}

