/**
 * What a claim's root means for the disassembler.
 *
 * Its own file because it outlived the record it was a field on. The four are
 * genuinely distinct concepts even though the disassembler currently queues
 * three of them identically — that sameness is an artifact of the walk, and
 * they diverge the moment anything reasons about call graphs, which is where
 * the information would be needed and no longer recoverable.
 *
 * - `entry` — where execution *starts*. No caller, no return contract.
 * - `function` — a subroutine. Has callers and a return contract.
 * - `code` — a branch or jump target found by analysis. Intra-function.
 * - `address` — a named address, not queued. The default.
 */
export type LabelType = "entry" | "function" | "code" | "address";
