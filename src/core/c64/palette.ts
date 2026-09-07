/**
 * The sixteen colours, in one place.
 *
 * **There were two, and they did not agree.** `bitmap-view.ts` carried Pepto's
 * measurements and `devices/vic.ts` carried Colodore's, so a captured
 * screenshot and a sprite plate of the same program came out in different
 * colours — visible side by side in anything that shows both, which is exactly
 * what an article does. Neither was wrong; having two was.
 *
 * Colodore is kept, because it is the later measurement of the same hardware
 * and because it is what every photograph taken so far already used. The values
 * live here rather than in `view/`, which is meant to know nothing about any
 * particular machine: this is a fact about a chip.
 *
 * The VIC-II has no palette register, so this is a constant rather than
 * something a project configures.
 */
export const C64_PALETTE: readonly string[] = [
  "#000000", // 0  black
  "#ffffff", // 1  white
  "#813338", // 2  red
  "#75cec8", // 3  cyan
  "#8e3c97", // 4  purple
  "#56ac4d", // 5  green
  "#2e2c9b", // 6  blue
  "#edf171", // 7  yellow
  "#8e5029", // 8  orange
  "#553800", // 9  brown
  "#c46c71", // 10 light red
  "#4a4a4a", // 11 dark grey
  "#7b7b7b", // 12 grey
  "#a9ff9f", // 13 light green
  "#706deb", // 14 light blue
  "#b2b2b2", // 15 light grey
];
