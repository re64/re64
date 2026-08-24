/**
 * Plain-text rendering of the view model.
 *
 * The CLI and the web UI share one walk over the address range; they differ
 * only in what they do with the result. Here the semantic spans on each row are
 * simply ignored — nothing in a terminal is clickable — while the web UI turns
 * the same spans into decorations.
 */

import { Row } from "./rows.js";

/** Render rows as lines of text. */
export function formatRows(rows: readonly Row[]): string[] {
  return rows.map((row) => row.text);
}

/** Render disassembly warnings the way the CLI reports them. */
export function formatWarnings(warnings: readonly string[]): string[] {
  return warnings.map((w) => `  ${w}`);
}
