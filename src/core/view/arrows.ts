/**
 * Cross-reference arrows: which rows connect, and how they nest in the gutter.
 *
 * View model, not program analysis — this decides *layout* (which lane, which
 * glyph), given references that `disassemble()` already found. Pure, so
 * the same lanes are computed in the browser and on the command line.
 */

import { Reference } from "../arch/mos6502/disassembler.js";


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
  references: ReadonlyMap<number, readonly Reference[]>,
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
