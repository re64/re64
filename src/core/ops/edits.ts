/**
 * Building the operations that express an edit.
 *
 * One place, because there were two and they disagreed. The browser reused the
 * id of whatever label resolved at an address — including a built-in platform
 * label, so naming `$FFD2` would adopt `CHROUT`'s derived id and mint a project
 * label carrying a fake identity. The CLI reused only a project label in the
 * owning layer. A third consumer was about to invent a third rule.
 *
 * The rule, stated once: **reuse the id of an existing project label at that
 * address in the layer that owns it, and never any other kind.** Platform,
 * region and auto labels all have derived ids that describe where they came
 * from, not something a project may claim.
 */

import { CommentPlacement } from "../memory/comment.js";
import { Label, LabelType } from "../memory/label.js";
import { TextEncoding } from "../c64/text.js";
import { RegionKind } from "../memory/region.js";
import { LoadedProject } from "../project/loader.js";
import { newId } from "../project/identity.js";
import { parseProjectAddress } from "../project/project.js";
import { resolveOwningLayer } from "../project/ownership.js";
import { Op } from "./types.js";

/**
 * Make sure some layer can own an annotation at this address.
 *
 * Returns the operation that creates a symbols layer when nothing owns the
 * address and no symbols layer exists to take it, and the id to write into.
 *
 * The refusal this replaces named the fix and gave no way to perform it: "add a
 * layer of type symbols" with no tool that could. On a 6502 program every
 * variable lives in zero page, so it made naming roughly half of what a person
 * contributes impossible.
 *
 * Creating rather than relaxing ownership. The rule that annotations belong to
 * the layer supplying their bytes is what makes reordering the stack move them
 * with the content they describe; loosening it to let anything hold anything
 * would bring back exactly the bug it prevents. A symbols layer is the model's
 * own answer for an address with no bytes, and it already exists — the built-in
 * C64 table is one.
 */
export function ensureOwningLayer(
  loaded: LoadedProject,
  address: number,
  projectName?: string
): { layerId: string; create?: Op; joins: Op[] } {
  try {
    return { layerId: owningLayerId(loaded, address), joins: [] };
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith("No layer owns")) throw err;
  }

  const id = newId("lay");
  return {
    layerId: id,
    create: {
      op: "layer.add",
      id,
      layerType: "symbols",
      name: `${projectName ?? "project"} symbols`,
      // The bottom of the stack: it supplies no bytes so it shadows nothing,
      // and ownership resolves to the first symbols layer declared.
      index: 0,
    },
    // Into every target, or the name renders nowhere and the write still says
    // `ok`.
    //
    // A target is an allowlist of layer ids, so a layer made after one exists is
    // outside it — and this layer is made *by* the write that needed it. In
    // experiment 5 a builder named byteless addresses, was told the writes
    // succeeded, and found `list_labels` still returning the auto `dat_0340`.
    //
    // Every target rather than the active one, because a symbols layer supplies
    // no bytes and describes the machine rather than a phase of the program:
    // zero page is zero page whether you are reading the loader or the runtime,
    // and a name that appears only in the view you happened to have selected
    // when you wrote it is the same failure one step further on.
    joins: (loaded.project.targets ?? []).map((target) => ({
      op: "target.set",
      name: target.name,
      layers: [...target.layers, id],
      ...(target.entryPoints === undefined
        ? {}
        : { entryPoints: target.entryPoints.map(parseProjectAddress) }),
    })),
  };
}

/** Whether any layer already owns this address, without throwing to find out. */
export function ownsAddress(loaded: LoadedProject, address: number): boolean {
  return resolveOwningLayer(loaded, address) !== undefined;
}

/** The layer an annotation at this address belongs to. */
export function owningLayerId(loaded: LoadedProject, address: number): string {
  const index = resolveOwningLayer(loaded, address);
  if (index === undefined) {
    throw new Error(
      `No layer owns $${hex4(address)}. Add a layer of type "symbols" to name ` +
        `addresses outside the loaded bytes.`
    );
  }
  const id = loaded.project.layers[index].id;
  if (!id) throw new Error("This project has no ids; run: re64 migrate");
  return id;
}

/** The project label at an address, if the owning layer declares one. */
export function projectLabelAt(
  loaded: LoadedProject,
  layerId: string,
  address: number
): { id: string; name: string; type?: LabelType } | undefined {
  const layer = loaded.project.layers.find((l) => l.id === layerId);
  const found = layer?.labels?.find((l) => parseProjectAddress(l.address) === address);
  return found?.id ? { id: found.id, name: found.name, type: found.type } : undefined;
}

/**
 * Every project label at an address, in the layer that owns it.
 *
 * `projectLabelAt` returns the first, which is right for a revise and wrong for
 * a delete: with two labels there, "remove the label at $C065" has no single
 * answer, and answering anyway removed one of them silently and left the other
 * unreachable. Both builders in experiment 5 hit that.
 */
export function projectLabelsAt(
  loaded: LoadedProject,
  layerId: string,
  address: number
): { id: string; name: string; type?: LabelType }[] {
  const layer = loaded.project.layers.find((l) => l.id === layerId);
  return (layer?.labels ?? [])
    .filter((l) => l.id && parseProjectAddress(l.address) === address)
    .map((l) => ({ id: l.id!, name: l.name, type: l.type }));
}

/** Delete a label by id, wherever it lives. */
export function labelDeleteByIdOp(loaded: LoadedProject, id: string): Op | undefined {
  for (const layer of loaded.project.layers) {
    if (layer.id && layer.labels?.some((l) => l.id === id)) {
      return { op: "label.delete", id, layerId: layer.id };
    }
  }
  return undefined;
}

export function labelSetOp(
  loaded: LoadedProject,
  address: number,
  name: string,
  type?: LabelType,
  extent?: number
): Op {
  const layerId = owningLayerId(loaded, address);
  const existing = projectLabelAt(loaded, layerId, address);
  return {
    op: "label.set",
    id: existing?.id ?? newId("lbl"),
    layerId,
    address,
    name,
    type,
    extent,
  };
}

/**
 * Add a name at an address without replacing the one already there.
 *
 * `labelSetOp` reuses the id of the project label at that address, so it
 * renames — which is right for correcting a name and wrong for the case the
 * reference disassembly actually has, where `$08` is `randomValue` generally
 * and `gridXPos` inside one routine. This is how a second name gets made.
 */
export function labelAddOp(
  loaded: LoadedProject,
  address: number,
  name: string,
  type?: LabelType,
  extent?: number
): Op {
  const layerId = owningLayerId(loaded, address);
  return { op: "label.set", id: newId("lbl"), layerId, address, name, type, extent };
}

/**
 * Write a comment, replacing the one already in this slot if there is one.
 *
 * A slot is an address and a placement. Several comments may share an address
 * — nothing forces a single choice the way operand rendering does for labels —
 * but `set_comment` at the same place twice is one person revising, not two
 * comments, so it targets the existing id rather than stacking a second.
 * Adding a deliberate second is `placement` or another address.
 */
/**
 * Add a comment. Always a new one.
 *
 * There used to be a single `commentSetOp` that matched an existing comment by
 * `(address, placement)` and reused its id — an upsert keyed by *slot*. That was
 * justified as "one person changing their mind rather than two comments", which
 * is true of one author and false the moment there are two: in experiment 3 an
 * agent's `before` comment silently replaced another's, and three of the four
 * readers across two runs invented the same bad workaround, using `inline` as a
 * second slot to avoid the collision. One asked for `append_comment` by name.
 *
 * The model always supported several comments at an address — they are all
 * rendered, ordered deliberately. Only the write path could not reach it. So
 * this mints, `commentEditOp` revises by id, and slot-keyed upsert is gone: an
 * address cannot identify a comment for exactly the reason it cannot identify a
 * label.
 */
export function commentAddOp(
  loaded: LoadedProject,
  address: number,
  placement: CommentPlacement,
  text: string
): Op {
  return {
    op: "comment.set",
    id: newId("cmt"),
    layerId: owningLayerId(loaded, address),
    address,
    placement,
    text,
  };
}

/** Revise a comment by id: its text, its placement, or where it sits. */
export function commentEditOp(
  loaded: LoadedProject,
  id: string,
  changes: { text?: string; placement?: CommentPlacement; order?: number }
): Op {
  for (const layer of loaded.project.layers) {
    const existing = layer.comments?.find((c) => c.id === id);
    if (!existing || !layer.id) continue;
    return {
      op: "comment.set",
      id,
      layerId: layer.id,
      address: parseProjectAddress(existing.address),
      placement: changes.placement ?? existing.placement ?? "before",
      text: changes.text ?? existing.text,
      ...(changes.order ?? existing.order) === undefined
        ? {}
        : { order: changes.order ?? existing.order },
    };
  }
  throw new Error(`No comment ${id}. list_comments shows what this project has.`);
}

/** Undefined when there is no comment in that slot to remove. */
export function commentDeleteOp(
  loaded: LoadedProject,
  address: number,
  placement?: CommentPlacement
): Op | undefined {
  const layerId = owningLayerId(loaded, address);
  const layer = loaded.project.layers.find((l) => l.id === layerId);
  const existing = layer?.comments?.find(
    (c) =>
      parseProjectAddress(c.address) === address &&
      (placement === undefined || (c.placement ?? "before") === placement)
  );

  return existing?.id ? { op: "comment.delete", id: existing.id, layerId } : undefined;
}

/** Undefined when there is no project label to delete; a built-in is not one. */
export function labelDeleteOp(loaded: LoadedProject, address: number): Op | undefined {
  const layerId = owningLayerId(loaded, address);
  const existing = projectLabelAt(loaded, layerId, address);
  return existing ? { op: "label.delete", id: existing.id, layerId } : undefined;
}

/**
 * A region needs bytes; a label does not.
 *
 * Ownership resolution falls back to a symbols layer for an address nothing
 * supplies, which is right for a label — that is what symbols layers are for —
 * and wrong for a region, which says how to *interpret* bytes that are not
 * there. The two shared one resolver, so declaring a region over `$0400` on a
 * project with a symbols layer attached it to that layer, wrote a document the
 * loader refuses, and left the project unwritable through every interface.
 */
export function regionSetOp(
  loaded: LoadedProject,
  start: number,
  end: number,
  kind: RegionKind,
  name?: string,
  comment?: string,
  encoding?: TextEncoding,
  view?: string,
  /**
   * The region being revised, when the caller knows which.
   *
   * Everything below this is a guess made because it usually is not given, and
   * an id makes the guess unnecessary: it says *this* region, whatever its span
   * is now. `describe_project` reports them for exactly this.
   */
  id?: string
): Op {
  const owner = loaded.map.layerAt(start);
  if (!owner || !owner.hasBytes) {
    throw new Error(
      `No loaded bytes at $${hex4(start)}, so there is nothing there to ` +
        `interpret. A region says how to read bytes a layer supplies; to name ` +
        `an address outside the loaded ranges, use a label instead.`
    );
  }

  const layerId = owningLayerId(loaded, start);
  const layer = loaded.project.layers.find((l) => l.id === layerId);
  const regions = layer?.regions ?? [];
  const startsHere = regions.filter((r) => parseProjectAddress(r.start) === start);

  // Which region — if any — this declaration is a *revision of*, rather than a
  // new statement alongside it. Three cases, strongest signal first:
  //
  // 1. The same span exactly. One statement being corrected: reuse its id, so
  //    saying it twice does not stack up two regions.
  // 2. Exactly one region starts here and the new span is not strictly inside
  //    it. That is an extend or a move of the obvious candidate.
  // 3. Anything else — strictly inside, or ambiguous because several regions
  //    already start here — is a new region, which *nests*.
  //
  // Nesting matters because the model has always allowed it: regions may
  // overlap and `getRegionAt` resolves innermost-first, so the inner one
  // renders inside its span and the outer one either side, with nothing left
  // unexplained. Reusing an id whenever the starts matched made this a silent
  // *replacement* — declaring 32 bytes of a 512-byte `characterSetData` region
  // a bitmap shrank it to 32 bytes and left the other 480 explained by nothing.
  //
  // Case 1 has to be checked before case 2, and that is not a detail: without
  // it, re-declaring the same span inside a larger region nests again on every
  // call, and two identical spans then race to be the innermost.
  // Named outright: no inference, and it works however far the region has moved.
  const named = id === undefined ? undefined : regions.find((r) => r.id === id);
  if (id !== undefined && !named) {
    throw new Error(
      `No region ${id} in the layer holding $${hex4(start)}. ` +
        `describe_project lists the regions there with their ids.`
    );
  }

  const exact = startsHere.find((r) => parseProjectAddress(r.end) === end);
  const extending =
    startsHere.length === 1 && end >= parseProjectAddress(startsHere[0].end)
      ? startsHere[0]
      : undefined;
  const existing = named ?? exact ?? extending;

  return {
    op: "region.set",
    id: existing?.id ?? newId("rgn"),
    layerId,
    start,
    end,
    kind,
    name,
    comment,
    encoding,
    view,
  };
}

/** Searches every layer, since a region's owner is not implied by its start. */
/**
 * Remove a region, by id or by where it starts.
 *
 * A start address stopped being a unique handle the moment regions could nest:
 * declaring part of a span leaves two regions beginning at the same place, and
 * picking whichever the array happened to list first would delete the wrong one
 * silently. So an ambiguous start is refused, and it names the candidates —
 * which is also how a caller learns the ids it should have passed.
 */
export function regionDeleteOp(
  loaded: LoadedProject,
  start: number,
  id?: string
): Op | undefined {
  for (const layer of loaded.project.layers) {
    if (!layer.id) continue;

    if (id !== undefined) {
      const named = layer.regions?.find((r) => r.id === id);
      if (named) return { op: "region.delete", id, layerId: layer.id };
      continue;
    }

    const here = (layer.regions ?? []).filter((r) => parseProjectAddress(r.start) === start);
    if (here.length === 0) continue;
    if (here.length > 1) {
      const shown = here
        .map((r) => `${r.id} (${r.kind}${r.name ? ` "${r.name}"` : ""} to $${String(r.end)})`)
        .join(", ");
      throw new Error(
        `Several regions start at $${hex4(start)}, so that does not say which to ` +
          `remove: ${shown}. Pass the id of the one you mean.`
      );
    }
    if (here[0].id) return { op: "region.delete", id: here[0].id, layerId: layer.id };
  }
  return undefined;
}

/**
 * Whether a name was invented by the disassembler rather than chosen.
 *
 * The prefix encodes the type, so promoting one has to rewrite it — leaving
 * `loc_8100` tagged as a function would contradict itself.
 */
export function isAutoGeneratedName(name: string): boolean {
  return /^(sub|loc|dat)_[0-9A-F]{4}$/.test(name);
}

/**
 * Mark an address as a function, creating the label if there is none.
 *
 * This is how code that nothing references gets decoded at all, so it is the
 * single most consequential edit available.
 */
export function markFunctionOps(loaded: LoadedProject, address: number, name?: string): Op[] {
  const layerId = owningLayerId(loaded, address);
  const existing = projectLabelAt(loaded, layerId, address);
  const current = name ?? existing?.name ?? `sub_${hex4(address)}`;
  const promoted = isAutoGeneratedName(current) ? `sub_${hex4(address)}` : current;

  return [labelSetOp(loaded, address, promoted, "function")];
}

/**
 * Stop treating an address as a function.
 *
 * A name the disassembler invented is deleted outright rather than left behind
 * as an untyped duplicate of what it would generate anyway; a name someone
 * chose is kept and only its type is cleared.
 */
export function unmarkFunctionOps(loaded: LoadedProject, address: number): Op[] {
  const layerId = owningLayerId(loaded, address);
  const existing = projectLabelAt(loaded, layerId, address);
  if (!existing) return [];

  if (isAutoGeneratedName(existing.name)) {
    return [{ op: "label.delete", id: existing.id, layerId }];
  }
  return [labelSetOp(loaded, address, existing.name, "address")];
}

const hex4 = (address: number) => address.toString(16).toUpperCase().padStart(4, "0");
