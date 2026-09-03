/**
 * Project hygiene: what is wrong with the annotations, not with the program.
 *
 * A deliberately separate collection from `warnings`, because the two have
 * different subjects and different readers. A warning is a fact about the
 * program — *"flow reaches $8D16, which is declared data"* — and you
 * investigate it. A hygiene finding is a fact about your own annotation set —
 * *"two labels are called scoreDigits"* — and you tidy it. Mixing them makes a
 * reader triage prose to work out which kind they are looking at.
 *
 * **Two rules decide what belongs here**, and the second is the one that keeps
 * the list worth reading:
 *
 * - It **renders wrong, renders nowhere, or renders ambiguously.** Tied to a
 *   consequence in the listing rather than to taste — which is what excludes
 *   two constants sharing a value under different names, since that is
 *   `LEFT_ZAPPER`/`WHITE` and the model working as designed.
 * - **A check that fires on a healthy project is not a check.** Zero is the
 *   resting state. `find_undecoded` counts incompleteness — it starts at the
 *   whole binary and shrinks as work proceeds — so it is a work queue and
 *   belongs nowhere near here. A list that always has entries gets ignored,
 *   and the one entry that mattered gets ignored with it.
 *
 * Every check is O(n) over structures the analysis already built, so this costs
 * nothing measurable beside the disassembly itself. Anything needing its own
 * traversal — "is this named routine reachable" — belongs in a separate
 * on-demand function rather than here.
 *
 * Derived and never stored, like the region tree. It disappears the moment the
 * thing it describes is fixed.
 */

import { LabelIndex } from "../memory/label.js";
import { CommentIndex } from "../memory/comment.js";
import { ConstantIndex } from "../memory/constant.js";
import { InstructionIndex } from "../arch/mos6502/disassembler.js";
import { LoadedProject } from "../project/loader.js";

export type HygieneKind =
  /** Several labels hold one name, so `name+4` identifies nothing. */
  | "label.nameShared"
  /** Several constants hold one name with different values. */
  | "constant.nameShared"
  /** An annotation inside an instruction: stored, and rendered nowhere. */
  | "annotation.insideInstruction"
  /** A region asks for a decoder the project does not have. */
  | "region.missingDecoder"
  /** Two inline comments on one row, the second indented under the first. */
  | "comment.inlineDuplicated";

export interface HygieneFinding {
  kind: HygieneKind;
  message: string;
  /** What to look at: ids where the thing has one, addresses otherwise. */
  subjects: { id?: string; address?: string }[];
}

const hex4 = (address: number) => `$${address.toString(16).toUpperCase().padStart(4, "0")}`;

/**
 * The instruction an address falls inside, when it is not the start of one.
 *
 * No 6502 instruction exceeds three bytes, so two steps back is exact rather
 * than a heuristic.
 */
function insideInstruction(
  instructions: InstructionIndex,
  address: number
): number | undefined {
  if (instructions.has(address)) return undefined;
  for (let back = 1; back <= 2; back++) {
    const found = instructions.get(address - back);
    if (found && found.address + found.bytes.length > address) return found.address;
  }
  return undefined;
}

export function checkHygiene(
  loaded: LoadedProject,
  labels: LabelIndex,
  instructions: InstructionIndex
): HygieneFinding[] {
  const found: HygieneFinding[] = [];
  const comments: CommentIndex = loaded.comments;
  const constants: ConstantIndex = loaded.constants;

  // A name two labels hold identifies neither, and the offset form is worse
  // than useless: `scoreDigits+4` means one address against one label and a
  // different one against the other.
  for (const { name, labels: holders } of labels.collisions()) {
    found.push({
      kind: "label.nameShared",
      message:
        `${holders.length} labels are called "${name}" (${holders
          .map((l) => hex4(l.address))
          .join(", ")}), so the name identifies none of them. They render ` +
        `qualified — "${name}@<id>" — until one is renamed or removed.`,
      subjects: holders.map((l) => ({ id: l.id, address: hex4(l.address) })),
    });
  }

  // Two names for one value is deliberate — LEFT_ZAPPER and WHITE are both $01
  // and the reference does exactly that. One name for two values is not: the
  // equate block prints the name twice with different values.
  const byName = new Map<string, { id: string; value: number }[]>();
  for (const constant of constants.all()) {
    const held = byName.get(constant.name);
    if (held) held.push(constant);
    else byName.set(constant.name, [constant]);
  }
  for (const [name, held] of byName) {
    const values = new Set(held.map((c) => c.value));
    if (values.size < 2) continue;
    found.push({
      kind: "constant.nameShared",
      message:
        `"${name}" is declared with ${values.size} different values ` +
        `(${[...values].map((v) => `$${v.toString(16).toUpperCase().padStart(2, "0")}`).join(", ")}), ` +
        `so an equate block prints it more than once.`,
      subjects: held.map((c) => ({ id: c.id })),
    });
  }

  // Stored, returned by list_comments, and rendered nowhere, because the row
  // model is keyed by instruction start. Two comments were lost this way in
  // experiment 4 before anybody noticed.
  for (const comment of comments.all()) {
    const inside = insideInstruction(instructions, comment.address);
    if (inside === undefined) continue;
    found.push({
      kind: "annotation.insideInstruction",
      message:
        `A comment sits at ${hex4(comment.address)}, inside the instruction at ` +
        `${hex4(inside)}, so it is stored but never rendered.`,
      subjects: [{ id: comment.id, address: hex4(comment.address) }],
    });
  }
  for (const label of labels.getAllLabels()) {
    if (label.source.kind === "platform" || label.source.kind === "auto") continue;
    const inside = insideInstruction(instructions, label.address);
    if (inside === undefined) continue;
    found.push({
      kind: "annotation.insideInstruction",
      message:
        `The label "${label.name}" is at ${hex4(label.address)}, inside the ` +
        `instruction at ${hex4(inside)}. It resolves in operands but has no row.`,
      subjects: [{ id: label.id, address: hex4(label.address) }],
    });
  }

  // A view naming a decoder that is not there falls back to the declared
  // encoding, which makes a listing plainer rather than absent — so nothing
  // else would ever say the decoder went missing.
  const known = new Set((loaded.project.decoders ?? []).map((d) => d.id).filter(Boolean));
  for (const region of loaded.map.getAllRegions()) {
    const view = region.view;
    if (!view?.startsWith("snippet:")) continue;
    const id = view.slice("snippet:".length);
    if (known.has(id)) continue;
    found.push({
      kind: "region.missingDecoder",
      message:
        `The region at ${hex4(region.start)} asks for decoder ${id}, which this ` +
        `project does not have, so it renders with its declared encoding instead.`,
      subjects: [{ id: region.id, address: hex4(region.start) }],
    });
  }

  // The model indents the second under the first deliberately, "where the
  // redundancy is visible enough that whoever sees it removes one". Reporting
  // it is the same intent by a route that does not require anyone to be looking
  // at that row.
  const inlineAt = new Map<number, string[]>();
  for (const comment of comments.all()) {
    if (comment.placement !== "inline") continue;
    const held = inlineAt.get(comment.address);
    if (held) held.push(comment.id);
    else inlineAt.set(comment.address, [comment.id]);
  }
  for (const [address, ids] of inlineAt) {
    if (ids.length < 2) continue;
    found.push({
      kind: "comment.inlineDuplicated",
      message:
        `${ids.length} inline comments share the row at ${hex4(address)}; ` +
        `the second and later ones are indented under the first.`,
      subjects: ids.map((id) => ({ id, address: hex4(address) })),
    });
  }

  return found;
}
