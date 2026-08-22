/**
 * Builds a structured, renderable view of a project's disassembly.
 *
 * Unlike the CLI, which prints text directly, this produces rows carrying the
 * spans the UI needs to make operands and labels clickable. This is the
 * "model-is-truth" half of the UI design: the frontend renders these rows, it
 * never parses assembler text back into meaning.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  LabelIndex,
  Label,
  LabelType,
  createAutoLabel,
  findFile,
  extractFile,
  listDirectory,
  disassemble,
  formatOperand,
  InstructionIndex,
  Reference,
  LoadedProject,
  buildMemoryMap,
  parseProject,
  parseProjectAddress,
} from "../core/index.js";

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

/** Nested arrows are capped; anything deeper falls back to an xref stub. */
const MAX_ARROW_LANES = 5;

/**
 * Maximum rows an arrow may span. Classification is by distance rather than by
 * what is on screen: a viewport-dependent rule would make arrows change style
 * mid-scroll, reflowing the gutter under the cursor.
 */
const MAX_ARROW_ROWS = 100;

export interface ArrowSpan {
  fromLine: number;
  toLine: number;
  top: number;
  bottom: number;
  lane: number;
}

/**
 * Assign local control-flow references to gutter lanes.
 *
 * Arrows are placed shortest-span-first, each taking the innermost lane that no
 * overlapping arrow already holds. Ordering by span length is what produces
 * correct nesting: an arrow contained inside another is necessarily shorter, so
 * it is placed first and claims the inner lane, forcing its container outward.
 *
 * Sorting by span *start* instead — the usual interval-graph greedy — uses
 * fewer lanes but inverts nesting, because an enclosing arrow that merely
 * begins earlier steals the inner lane from the short arrow inside it.
 *
 * Lanes are still reused once an arrow ends, which keeps the gutter narrow
 * through long stretches of straight-line code.
 */
export function allocateArrowLanes(
  references: Map<number, Reference[]>,
  targetLine: Record<number, number>,
  instructionLine: Record<number, number>
): { arrows: ArrowSpan[]; demoted: number } {
  const candidates: Omit<ArrowSpan, "lane">[] = [];
  let demoted = 0;

  for (const [target, refs] of references) {
    const toLine = targetLine[target];
    if (toLine === undefined) continue;

    for (const ref of refs) {
      // Data references would fill the margin with noise; only control flow
      // gets an arrow. Branches are inherently local on 6502 (-128..+127) and
      // effectively always qualify; the distance test arbitrates the rest.
      if (ref.type === "data") continue;

      const fromLine = instructionLine[ref.from];
      if (fromLine === undefined || fromLine === toLine) continue;

      const top = Math.min(fromLine, toLine);
      const bottom = Math.max(fromLine, toLine);
      if (bottom - top > MAX_ARROW_ROWS) {
        demoted++;
        continue;
      }
      candidates.push({ fromLine, toLine, top, bottom });
    }
  }

  candidates.sort((a, b) => a.bottom - a.top - (b.bottom - b.top) || a.top - b.top);

  // Occupied spans per lane. Touching counts as overlapping: two arrows whose
  // endpoints share a row would draw corners into the same cell.
  const laneSpans: { top: number; bottom: number }[][] = Array.from(
    { length: MAX_ARROW_LANES },
    () => []
  );
  const arrows: ArrowSpan[] = [];

  for (const c of candidates) {
    const lane = laneSpans.findIndex(
      (spans) => !spans.some((s) => c.top <= s.bottom && s.top <= c.bottom)
    );

    if (lane === -1) {
      demoted++;
      continue;
    }

    laneSpans[lane].push({ top: c.top, bottom: c.bottom });
    arrows.push({ ...c, lane });
  }

  return { arrows, demoted };
}

/**
 * Render allocated arrows into one fixed-width gutter string per row.
 *
 * Lane 0 sits nearest the code, with outer lanes to the left, and the rightmost
 * column is reserved for arrowheads so a lane-0 corner is never overwritten.
 */
export function renderArrowGutter(arrows: ArrowSpan[], rowCount: number): string[] {
  if (arrows.length === 0) return [];

  const lanes = Math.max(...arrows.map((a) => a.lane)) + 1;
  const width = lanes + 1;
  const headCol = lanes;
  const grid: string[][] = Array.from({ length: rowCount }, () =>
    Array.from({ length: width }, () => " ")
  );

  /** Draw a horizontal run without erasing verticals it crosses. */
  const cross = (row: string[], col: number) => {
    row[col] = row[col] === "│" ? "┼" : row[col] === " " ? "─" : row[col];
  };

  for (const arrow of arrows) {
    const col = lanes - 1 - arrow.lane;

    for (let line = arrow.top + 1; line < arrow.bottom; line++) {
      const row = grid[line];
      if (row[col] === " ") row[col] = "│";
    }

    for (const line of [arrow.top, arrow.bottom]) {
      const row = grid[line];
      row[col] = line === arrow.top ? "┌" : "└";
      for (let c = col + 1; c < headCol; c++) cross(row, c);
    }

    const head = grid[arrow.toLine];
    head[headCol] = "►";
    const source = grid[arrow.fromLine];
    if (source[headCol] === " ") source[headCol] = "─";
  }

  return grid.map((row) => row.join(""));
}

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");
const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");

/** Read a file's bytes, supporting the `disk.d64:filename` form. */
function loadFile(
  path: string,
  explicitStart?: number
): { start: number; data: Uint8Array; isPrg: boolean } {
  let fullData: Uint8Array;

  const colonIndex = path.lastIndexOf(":");
  const possibleD64 = colonIndex > 0 ? path.substring(0, colonIndex) : "";
  if (possibleD64.toLowerCase().endsWith(".d64")) {
    const innerFilename = path.substring(colonIndex + 1);
    const diskImage = new Uint8Array(readFileSync(possibleD64));
    const entry = findFile(diskImage, innerFilename);
    if (!entry) {
      const available = listDirectory(diskImage)
        .map((e) => e.filename)
        .join(", ");
      throw new Error(
        `File "${innerFilename}" not found in ${possibleD64}. Available: ${available}`
      );
    }
    fullData = extractFile(diskImage, entry);
  } else {
    fullData = new Uint8Array(readFileSync(path));
  }

  if (explicitStart !== undefined) {
    return { start: explicitStart, data: fullData, isPrg: false };
  }
  if (fullData.length < 3) {
    throw new Error(`File too small to be a PRG: ${path}`);
  }
  return {
    start: fullData[0] | (fullData[1] << 8),
    data: fullData.slice(2),
    isPrg: true,
  };
}

/** Load a project file and build its memory map. */
export function loadProject(projectPath: string): LoadedProject {
  const project = parseProject(readFileSync(projectPath, "utf-8"));
  const baseDir = dirname(projectPath);

  return buildMemoryMap(project, (path, explicitStart) =>
    loadFile(resolve(baseDir, path), explicitStart)
  );
}

/**
 * Disassemble a loaded project into renderable rows.
 *
 * Mirrors the CLI's walk over the address range, but emits structured rows with
 * click targets rather than printing.
 */
export function analyze(loaded: LoadedProject, labelTolerance = 1): AnalysisResult {
  const { project, map, prgEntries, userLabels } = loaded;

  const labelEntryPoints = userLabels
    .getAllLabels()
    .filter((l) => l.type === "entry" || l.type === "function" || l.type === "code")
    .map((l) => l.address);

  const projectEntryPoints = project.entryPoints?.map(parseProjectAddress) ?? [];

  let entryPoints: number[];
  if (projectEntryPoints.length > 0) {
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
      autoLabels.push(createAutoLabel(targetAddr, `sub_${addrStr}`, "function"));
    } else if (refs.some((r) => r.type === "jump" || r.type === "branch")) {
      autoLabels.push(createAutoLabel(targetAddr, `loc_${addrStr}`, "code"));
    } else {
      autoLabels.push(createAutoLabel(targetAddr, `dat_${addrStr}`, "address"));
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
      if (label.type !== "address") {
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

      const refs = result.references.get(addr);
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

  let addr = rangeStart;
  while (addr < rangeEnd) {
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

    if (kind === "jumptable") {
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
    const isText = kind === "text";
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
      const currentKind = map.getKindAt(addr) ?? "data";
      if (isText ? currentKind !== "text" : currentKind === "text" || currentKind === "jumptable") {
        break;
      }
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
