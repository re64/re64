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
): { layerId: string; create?: Op } {
  try {
    return { layerId: owningLayerId(loaded, address) };
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
export function commentSetOp(
  loaded: LoadedProject,
  address: number,
  placement: CommentPlacement,
  text: string
): Op {
  const layerId = owningLayerId(loaded, address);
  const layer = loaded.project.layers.find((l) => l.id === layerId);
  const existing = layer?.comments?.find(
    (c) => parseProjectAddress(c.address) === address && (c.placement ?? "before") === placement
  );

  return {
    op: "comment.set",
    id: existing?.id ?? newId("cmt"),
    layerId,
    address,
    placement,
    text,
  };
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
  encoding?: TextEncoding
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
  const existing = layer?.regions?.find((r) => parseProjectAddress(r.start) === start);
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
  };
}

/** Searches every layer, since a region's owner is not implied by its start. */
export function regionDeleteOp(loaded: LoadedProject, start: number): Op | undefined {
  for (const layer of loaded.project.layers) {
    const found = layer.regions?.find((r) => parseProjectAddress(r.start) === start);
    if (found?.id && layer.id) {
      return { op: "region.delete", id: found.id, layerId: layer.id };
    }
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
