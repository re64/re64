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

import { NameIndex } from "../claims/names.js";
import { CommentIndex } from "../memory/comment.js";
import { ConstantIndex } from "../memory/constant.js";
import { InstructionIndex } from "../arch/mos6502/disassembler.js";
import { LoadedProject } from "../project/loader.js";

export type HygieneKind =
  /** Several labels hold one name, so `name+4` identifies nothing. */
  | "label.nameShared"
  /** One address carries the same chosen name twice, and only one of them renders. */
  | "label.duplicated"
  /** Several constants hold one name with different values. */
  | "constant.nameShared"
  /** An annotation inside an instruction: stored, and rendered nowhere. */
  | "annotation.insideInstruction"
  /** A claim asks for a decoder the project does not have. */
  | "claim.missingDecoder"
  /** An interpretation over bytes nothing supplies, which renders nowhere. */
  | "claim.noBytes"
  /** Two inline comments on one row, the second indented under the first. */
  | "comment.inlineDuplicated"
  /** A claim is an array of a layout the project does not declare. */
  | "type.missing"
  /** A record claim's extent is not a whole number of records. */
  | "type.extentMismatch"
  /** A claim describes bytes a record layout already describes. */
  | "type.redundantClaim"
  /** One span says these bytes are X and a span inside it says they are Y. */
  | "claim.interpretationsDiffer";

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
  labels: NameIndex,
  instructions: InstructionIndex
): HygieneFinding[] {
  const found: HygieneFinding[] = [];
  const comments: CommentIndex = loaded.comments;
  const constants: ConstantIndex = loaded.constants;

  // A name two labels hold identifies neither, and the offset form is worse
  // than useless: `scoreDigits+4` means one address against one label and a
  // different one against the other.
  // The same name twice at one address. Not ambiguity — the name still reaches
  // exactly one address — but the row builder shows each name here once, so the
  // second renders nowhere and is dead weight that looks like work.
  //
  // Only reachable since naming became additive: the write that would have made
  // one used to refuse, and a retry is now the ordinary way to get one.
  for (const { address, name, labels: twins } of labels.duplicates()) {
    // **Whether the methods differ**, which is the difference between two
    // people confirming each other and one account written down twice. Both
    // experiment-0 agents concluded glyphs $03/$04 were never drawn, both were
    // wrong, and they agreed because they used the *same* static reasoning and
    // shared its blind spot — so "two accounts agree" was read as corroboration
    // when it was one account arriving twice. See invariant E10.
    const methods = new Set(twins.map((label) => label.by.method ?? "unstated"));
    const corroborated =
      methods.size > 1
        ? ` They were reached ${methods.size} different ways (${[...methods].join(", ")}), so ` +
          `they do corroborate each other.`
        : ` All ${twins.length} were reached the same way (${[...methods][0]}), so this is one ` +
          `account written down twice rather than two that agree.`;
    found.push({
      kind: "label.duplicated",
      message:
        `${hex4(address)} is called "${name}" ${twins.length} times over. Only one of ` +
        `them renders, so the rest are invisible — remove_claim takes one by id, ` +
        `or edit_claim makes it say something different.` +
        corroborated,
      subjects: twins.map((label) => ({ address: hex4(label.at), id: label.id })),
    });
  }

  for (const { name, labels: holders } of labels.collisions()) {
    found.push({
      kind: "label.nameShared",
      message:
        `${holders.length} labels are called "${name}" (${holders
          .map((l) => hex4(l.at))
          .join(", ")}), so the name identifies none of them. They render ` +
        `qualified — "${name}@<id>" — until one is renamed or removed.`,
      subjects: holders.map((l) => ({ id: l.id, address: hex4(l.at) })),
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
    if (label.by.source === "platform" || label.by.source === "auto") continue;
    const inside = insideInstruction(instructions, label.at);
    if (inside === undefined) continue;
    found.push({
      kind: "annotation.insideInstruction",
      message:
        `The label "${label.name}" is at ${hex4(label.at)}, inside the ` +
        `instruction at ${hex4(inside)}. It resolves in operands but has no row.`,
      subjects: [{ id: label.id, address: hex4(label.at) }],
    });
  }

  // Saying how to *read* bytes that are not there says nothing: there is no
  // row to render `is: "data"` on, so the claim is inert and invisible.
  //
  // **Reported rather than refused, and the refusal is the interesting part.**
  // The legacy region write refused this outright — "a region needs bytes; a
  // label does not" — and that guard fails this project's own offline/online
  // rule: whether a layer supplies an address is a property of what you have
  // *synced*, so the same call would be accepted by a peer holding the layer
  // and refused by one who had not got it yet. A write must not depend on that.
  //
  // It is also legitimate ahead of time — annotate now, link the layer later,
  // and the claim starts rendering — which is exactly why this is hygiene and
  // not an error. A *name* over byteless memory is ordinary and not reported:
  // zero page and the I/O registers are where half of what anybody says lives.
  for (const claim of loaded.claims) {
    if (!claim.says) continue;
    const span = claim.extent ?? 1;
    let supplied = false;
    for (let at = claim.at; at < claim.at + span; at++) {
      if (loaded.map.readByte(at) !== undefined) {
        supplied = true;
        break;
      }
    }
    if (supplied) continue;
    found.push({
      kind: "claim.noBytes",
      message:
        `The claim at ${hex4(claim.at)} says these bytes are ${claim.says.is}, and ` +
        `no layer in this view supplies any of them — so it renders nowhere. ` +
        `Link the layer that holds them, or read it in a target that has it.`,
      subjects: [{ id: claim.id, address: hex4(claim.at) }],
    });
  }

  // A view naming a decoder that is not there falls back to the declared
  // encoding, which makes a listing plainer rather than absent — so nothing
  // else would ever say the decoder went missing.
  const known = new Set((loaded.project.decoders ?? []).map((d) => d.id).filter(Boolean));
  for (const claim of loaded.claims) {
    // Only two interpretations carry one, so the narrowing is the check.
    const says = claim.says;
    const view = says && (says.is === "bitmap" || says.is === "text") ? says.view : undefined;
    if (!view?.startsWith("snippet:")) continue;
    const id = view.slice("snippet:".length);
    if (known.has(id)) continue;
    found.push({
      kind: "claim.missingDecoder",
      message:
        `The claim at ${hex4(claim.at)} asks for decoder ${id}, which this ` +
        `project does not have, so it renders with its declared encoding instead.`,
      subjects: [{ id: claim.id, address: hex4(claim.at) }],
    });
  }

  // A record claim whose layout has gone renders its bytes rather than
  // breaking, which is the right behaviour and is also invisible — so the one
  // place it becomes visible is here.
  const declared = new Map((loaded.project.types ?? []).map((t) => [t.id, t]));
  for (const claim of loaded.claims) {
    if (claim.says?.is !== "record") continue;
    const type = declared.get(claim.says.typeId);
    if (!type) {
      found.push({
        kind: "type.missing",
        message:
          `The claim at ${hex4(claim.at)} is an array of ${claim.says.typeId}, which this ` +
          `project does not declare, so it renders as plain bytes instead.`,
        subjects: [{ id: claim.id, address: hex4(claim.at) }],
      });
      continue;
    }

    // Not a fact about the layout but about this claim's span: an extent that
    // is not a whole number of records leaves a partial one at the end, which
    // renders as a record with its tail missing.
    const size = typeof type.size === "string" ? Number(type.size) : type.size;
    const extent = claim.extent ?? 1;
    if (size > 0 && extent % size !== 0) {
      found.push({
        kind: "type.extentMismatch",
        message:
          `The claim at ${hex4(claim.at)} covers ${extent} bytes of ${size}-byte ` +
          `${type.name} records, which leaves ${extent % size} bytes in a partial ` +
          `record at the end.`,
        subjects: [{ id: claim.id, address: hex4(claim.at) }],
      });
    }

    // What happens to work somebody did before the layout existed. Camels has
    // 42 `text` claims that are each one field of a record — the only field the
    // old model could express — and they **stay**. They carry an author, and
    // silently deleting somebody's forty-two recovered claims is exactly what
    // this redesign exists to stop; a migration that removed them would be a
    // destructive operation built from an inference, which is the shape that
    // has bitten three times. So it is reported, and whoever sees it decides.
    const span = { start: claim.at, end: claim.at + extent };
    for (const other of loaded.claims) {
      if (other.id === claim.id || other.says === undefined) continue;
      if (other.at < span.start || other.at >= span.end) continue;
      const offset = (other.at - claim.at) % size;
      if (!Object.prototype.hasOwnProperty.call(type.fields, String(offset))) continue;
      found.push({
        kind: "type.redundantClaim",
        message:
          `The claim at ${hex4(other.at)} describes bytes that ${type.name} already ` +
          `describes as "${type.fields[String(offset)].name}" at +$` +
          `${offset.toString(16).toUpperCase().padStart(2, "0")}. Both render; ` +
          `removing one is a judgement, so nothing has removed it.`,
        subjects: [{ id: other.id, address: hex4(other.at) }],
      });
    }
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

  /**
   * A span inside another, where the two say the bytes are different things.
   *
   * **This reverses a rule, and the numbers are why.** `docs/decisions/claims.md`
   * says containment is refinement and only partial overlap is contradiction,
   * on the strength of a measurement: reporting nesting as a conflict fired 43
   * times on one real project. That was true, and its justification has since
   * expired.
   *
   * Counted again on the same project: **44 of those 45 contained pairs are one
   * shape** — forty-two level names carved out of `zoneDataTable` as `text`
   * inside `data`, because in that model there was nowhere else to put them. A
   * record field is where they go now, and `add_type` did not exist when the
   * rule was written.
   *
   * On every project built since types arrived it fires **zero** times, which
   * is the resting state a hygiene check has to have. Gridrunner has no
   * contained pairs at all; experiment 10 has three, and all three are a *name*
   * inside a span, which is somebody naming a place rather than contradicting
   * anyone.
   *
   * That is the line: an inner claim saying **nothing** about the bytes is
   * naming a place inside a structure. An inner claim saying they are something
   * **else** is a disagreement, and two people annotating one document will
   * produce those. Reported rather than refused — a write that refuses has
   * taken a decision it was not entitled to, and this one converges, is
   * visible, and is somebody's to tidy.
   */
  const spans = loaded.claims.filter((c) => c.says && c.extent !== undefined);
  for (const outer of spans) {
    const end = outer.at + outer.extent!;
    for (const inner of loaded.claims) {
      if (inner.id === outer.id || inner.says === undefined) continue;
      if (inner.at < outer.at || inner.at + (inner.extent ?? 1) > end) continue;
      // The same span twice is duplication, which is a different finding.
      if (inner.at === outer.at && inner.extent === outer.extent) continue;
      if (inner.says.is === outer.says!.is) continue;

      found.push({
        kind: "claim.interpretationsDiffer",
        message:
          `${hex4(inner.at)} says these bytes are ${inner.says.is}, inside ` +
          `${hex4(outer.at)} which says they are ${outer.says!.is}. Both render. ` +
          `If the inner one is part of the outer's layout, add_type says so as a ` +
          `field and the overlap goes away; if the two of you disagree, this is ` +
          `where to settle it.`,
        subjects: [
          { id: inner.id, address: hex4(inner.at) },
          { id: outer.id, address: hex4(outer.at) },
        ],
      });
    }
  }

  return found;
}
