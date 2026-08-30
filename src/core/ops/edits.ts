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
import { RegionKind } from "../memory/region.js";
import { LoadedProject } from "../project/loader.js";
import { newId } from "../project/identity.js";
import { parseProjectAddress } from "../project/project.js";
import { resolveOwningLayer } from "../project/ownership.js";
import { Op } from "./types.js";

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
  type?: LabelType
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
  };
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

export function regionSetOp(
  loaded: LoadedProject,
  start: number,
  end: number,
  kind: RegionKind,
  name?: string,
  comment?: string
): Op {
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
