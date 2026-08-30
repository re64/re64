/**
 * Builds the renderable document: one row per line, carrying the semantic spans
 * a consumer needs.
 *
 * Renderer-agnostic on purpose. The CLI prints `row.text` and ignores the
 * spans; the web UI turns the same spans into clickable decorations. Neither
 * parses assembler text back into meaning — see "UI Design Decisions" in
 * CLAUDE.md.
 */

import { analyzeProgram } from "../analysis/program.js";
import { describeWarning } from "../arch/mos6502/disassembler.js";
import { decodeText } from "../c64/text.js";
import {
  LabelIndex,
  Label,
  LabelType,
  formatOperand,
  LoadedProject,
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

export type RowKind = "label" | "instruction" | "data" | "text" | "word" | "comment";

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


  const { map } = loaded;

  // What the program *is*, computed once and no longer thrown away — see
  // core/analysis/program.ts. This function's job from here is rendering it.
  const program = analyzeProgram(loaded, { labelTolerance, entryPoints: entryPointOverride });
  const { instructions: index, labels: allLabels } = program;
  const result = { references: program.xrefs.raw(), warnings: program.warnings };

  const resolveLabel = (addr: number) => {
    // Never fuzzy in zero page. Every byte there is its own variable, so a
    // neighbour's name is not a near miss but a different thing entirely:
    // `$0B` rendered as `previousYPosition-1`, and `$02` as `dat_0003-1`,
    // which is less readable than the address it replaced. Above the first
    // page an offset usually means "just inside this table", which is worth
    // showing.
    const tolerance = addr < 0x0100 ? 0 : labelTolerance;
    const resolved = allLabels.resolve(addr, tolerance);
    return resolved
      ? { name: resolved.label.name, offset: resolved.offset, within: resolved.within }
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
  /**
   * What was written about this address, on its own rows above the label.
   *
   * Above the label rather than below it, because a comment introduces the
   * routine and the label is its name — which is how the reference disassembly
   * this is measured against reads.
   *
   * Every comment at the address is shown. There is no primary comment and no
   * index choosing one: that machinery exists for labels because operand
   * rendering must substitute exactly one name for an address, and nothing
   * forces a choice here. Two comments are both shown, in id order, and the
   * duplication is visible enough that whoever sees it removes one.
   */
  const emitComments = (addr: number) => {
    // A region's own comment, where the region begins. It is a description of
    // the span — the same thing a header comment is — and it was rendered only
    // in the memory map, so `set_region comment:` looked like it had worked and
    // then appeared nowhere a reader would look.
    const region = map.getRegionAt(addr);
    if (region?.comment && region.start === addr) {
      for (const line of region.comment.split("\n")) {
        push({ address: addr, kind: "comment", text: `${hex4(addr)}  ; ${line}`, tokens: [] });
      }
    }

    for (const comment of loaded.comments.at(addr, "before")) {
      for (const line of comment.text.split("\n")) {
        const text = `${hex4(addr)}  ; ${line}`;
        push({ address: addr, kind: "comment", text, tokens: [] });
      }
    }
  };

  /**
   * Comments that belong below a row rather than beside it.
   *
   * The reference writes `;Returns` on its own line under a `JMP`, which is an
   * observation about what happens *after* the jump. Inline would put it on the
   * jump's row and say something slightly untrue about what it is about.
   */
  const emitAfter = (addr: number) => {
    for (const comment of loaded.comments.at(addr, "after")) {
      for (const line of comment.text.split("\n")) {
        push({ address: addr, kind: "comment", text: `${hex4(addr)}  ; ${line}`, tokens: [] });
      }
    }
  };

  /**
   * Append an inline comment to a row, whatever kind of row it is.
   *
   * These used to be handled only where instructions are emitted, so a comment
   * written on a data or text row was stored and rendered nowhere — a comment
   * someone wrote that nobody would ever see, with nothing saying so.
   */
  const withInline = (addr: number, text: string): string => {
    const inline = loaded.comments.at(addr, "inline");
    return inline.length > 0 ? `${text}  ; ${inline[0].text}` : text;
  };

  /** Any further inline comments, underneath and aligned to the first. */
  const emitExtraInline = (addr: number, text: string) => {
    for (const extra of loaded.comments.at(addr, "inline").slice(1)) {
      const indent = " ".repeat(Math.max(0, text.length - extra.text.length - 2));
      push({ address: addr, kind: "comment", text: `${indent}; ${extra.text}`, tokens: [] });
    }
  };

  const emitLabels = (addr: number) => {
    emitComments(addr);
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
      // An immediate the reader has said means something. Nothing is inferred
      // from the value: the same number carries different names at different
      // sites, so only an explicit binding puts a name here.
      const constant =
        instr.operand.type === "immediate" ? loaded.constants.nameAt(addr) : undefined;
      // A site may say which of several labels at an address it means — the
      // same zero-page byte is `randomValue` in one routine and `gridXPos` in
      // another, and on a machine that switches banks under a fixed address
      // that is the difference between two unrelated things.
      const bound = allLabels.labelForSite(addr);
      const resolveHere = bound
        ? (target: number) =>
            target === bound.address
              ? { name: bound.name, offset: 0 }
              : resolveLabel(target)
        : resolveLabel;

      const operandStr = constant
        ? `#${constant}`
        : formatOperand(instr.operand, resolveHere);
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

      text = withInline(addr, text);
      push({ address: addr, kind: "instruction", text, tokens, illegal: instr.illegal });
      emitAfter(addr);
      // A second inline comment has no room on the row it belongs to, so it
      // goes underneath, indented to where the first one starts. Redundant by
      // construction and meant to look it.
      emitExtraInline(addr, text);

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
        const wordText = withInline(addr, `${prefix}${shown}`);
        push({
          address: addr,
          kind: "word",
          text: wordText,
          tokens: [
            { start: prefix.length, end: prefix.length + shown.length, kind: "operand", target },
          ],
        });
        emitExtraInline(addr, wordText);
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
      // A text row used to render the directive and nothing else, so declaring
      // a span text made it strictly less readable than leaving it as data —
      // which at least printed an ASCII column. It now shows the decoded
      // string, in whatever encoding the region declares.
      const text = isText
        ? `${hex4(lineStart)}  ${cols}  .TEXT "${decodeText(
            bytes,
            map.getRegionAt(lineStart)?.encoding ?? "ascii"
          )}"`
        : `${hex4(lineStart)}  ${cols}  |${bytes
            .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : "."))
            .join("")}|`;
      push({
        address: lineStart,
        kind: isText ? "text" : "data",
        text: withInline(lineStart, text),
        tokens: [],
      });
      emitExtraInline(lineStart, withInline(lineStart, text));
      bytes.length = 0;
    };

    while (addr < rangeEnd && !index.has(addr)) {
      // Stop where a different strategy takes over, so every byte in the range
      // is claimed by exactly one branch of the outer dispatch.
      if (rowStrategy(map.getKindAt(addr) ?? "data") !== strategy) break;
      // Break for a comment as well as a label, or one written about an
      // address inside a data run would be swallowed by the row and never
      // appear anywhere.
      if (bytes.length > 0 && (allLabels.hasLabelAt(addr) || loaded.comments.has(addr))) break;
      // And at a region boundary. Rows chunk in eights, so two adjacent data
      // regions used to share a row and the distinction between them — which
      // is the whole reason someone declared two — became invisible.
      if (bytes.length > 0 && map.getRegionAt(addr)?.id !== map.getRegionAt(lineStart)?.id) break;

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

  const warnings = result.warnings.map(describeWarning);

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
      instructions: index.size,
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

