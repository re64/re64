/**
 * Plain-text rendering of the view model.
 *
 * The CLI and the web UI share one walk over the address range and differ only
 * in what they do with the result. The semantic spans on each row are ignored
 * here — nothing in a terminal is clickable — while the web UI turns those same
 * spans into decorations.
 *
 * The arrow gutter, though, is worth having in both. It is plain text already,
 * and box-drawing glyphs render in a terminal without any of the line-height
 * trouble they cause in the browser.
 */

import { Row } from "./rows.js";

/**
 * Render rows as lines of text, optionally prefixed with the arrow gutter.
 *
 * `arrows` must be index-aligned with `rows`; every entry is the same width, so
 * rows with no arrow through them still line up. Pass an empty array to leave
 * the gutter off.
 */
export function formatRows(rows: readonly Row[], arrows: readonly string[] = []): string[] {
  return rows.map((row, i) => {
    const gutter = arrows[i];
    return gutter === undefined ? row.text : `${gutter} ${row.text}`;
  });
}

/** Render disassembly warnings the way the CLI reports them. */
export function formatWarnings(warnings: readonly string[]): string[] {
  return warnings.map((w) => `  ${w}`);
}
