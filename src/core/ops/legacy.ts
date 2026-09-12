/**
 * History written in shapes the vocabulary no longer declares.
 *
 * Operation rows are JSON that nothing rewrites, and their inverses were computed
 * against the shapes of their day. Two of those shapes have gone: `type.add`
 * carried its fields as an object keyed by offset, and `type.set` carried an
 * offset-keyed child patch beside the record's own scalars. The document is
 * migrated when a store opens it; the rows are not, because a row is applied to
 * whatever state it meets and cannot be rewritten without that state.
 *
 * So both adapters read the old shapes through these two functions and nothing
 * else does. The public operation types do not declare them — a fresh
 * operation in an old shape is a bug, not a spelling — and undo and redo of
 * work recorded before the change keep meaning what they meant.
 */

import { derivedId } from "../project/identity.js";
import type { Op, TypeAddOp, TypeField, TypeSetOp } from "./types.js";
import type { Frame } from "../claims/model.js";

/** A child as an old `type.set` patch spelled it: id optional, offset in the key. */
export interface LegacyChild {
  id?: string;
  name: string;
  type: string;
  description?: string;
}

/**
 * The fields a `type.add` declares, whichever shape it arrived in.
 *
 * The old object form keyed each field by offset and did not always carry an
 * id; one without gets the same derived id the text migration gives it, so a
 * field declared through old history and the same field read from an old file
 * are one identity.
 */
export function typeAddFields(op: TypeAddOp): TypeField[] {
  if (Array.isArray(op.fields)) return op.fields;
  return Object.entries(op.fields as unknown as Record<string, LegacyChild>).map(
    ([offset, field]) => ({
      ...field,
      offset: Number(offset),
      id: field.id ?? derivedId("fld", op.id, Number(offset)),
    })
  );
}

/**
 * The child patch an old `type.set` carried, or nothing for a current one.
 *
 * `null` at an offset removed whatever sat there; an entry revised the field at
 * that offset, or the one carrying the entry's id, or declared one.
 */
export function legacyTypeSetChildren(
  op: TypeSetOp
): Record<string, LegacyChild | null> | undefined {
  const held = (op.fields as { fields?: Record<string, LegacyChild | null> }).fields;
  return held && typeof held === "object" ? held : undefined;
}

/**
 * Which stored field an old child patch means.
 *
 * By the id it carries where it carries one; otherwise the field at its offset.
 * Two fields at one offset is a state old history could not have produced, so
 * an ambiguous offset resolves to nothing rather than to whichever comes first
 * — the guess the old adapters made and the reason the route was removed.
 */
export function legacyChildTarget<F extends { id?: string; offset: number }>(
  fields: readonly F[],
  offset: number,
  child: LegacyChild | null
): F | undefined {
  if (child?.id) {
    const byId = fields.find((f) => f.id === child.id);
    if (byId) return byId;
  }
  const here = fields.filter((f) => f.offset === offset);
  return here.length === 1 ? here[0] : undefined;
}

/**
 * The site a bind or unbind means, whichever spelling it arrived in.
 *
 * A current operation carries a frame and a coordinate, and lives at the root.
 * One recorded before uses had frames carries the owning `layerId` and an
 * absolute `address` — and it meant "this operand, *in this layer*", which is
 * not the address frame: the owner decided whether the binding showed, and
 * kept it apart from another layer's at the same address. So it goes where it
 * always went, nested in its layer, until a boundary that knows the layer's
 * placement converts it (`usesToRoot`). One older still carries an id and no
 * site at all, and is resolved by scanning for the id.
 */
export type BindSite =
  | { kind: "framed"; frame: Frame; at: number }
  | { kind: "nested"; layerId: string; address?: number };

export function bindSite(op: {
  frame?: Frame;
  at?: number;
  layerId?: string;
  address?: number;
}): BindSite | undefined {
  if (op.frame !== undefined && op.at !== undefined) return { kind: "framed", frame: op.frame, at: op.at };
  if (op.layerId !== undefined) {
    return op.address === undefined
      ? { kind: "nested", layerId: op.layerId }
      : { kind: "nested", layerId: op.layerId, address: op.address };
  }
  return undefined;
}

/**
 * A binding operation recorded before frames, spelled as it would be today.
 *
 * The store replays history — undo, redo — against a document whose nested
 * bindings have moved to the root, and an operation still saying `layerId` and
 * `address` would either miss the site it meant or put a binding back nested
 * where nothing current can reach it. The store is the boundary that knows the
 * placements, so it is where the spelling is brought forward: the site is the
 * one `usesToRoot` gave the same record, and the operation keeps its
 * replacement semantics on it. Where the layer cannot be placed the operation
 * is returned as it was, and lands nested, which is where the document still
 * holds that layer's bindings. One carrying only an id is left alone too; it is
 * found by the id wherever the use is now.
 */
export function framedLegacy(
  op: Op,
  siteOf: (layerId: string, address: number) => { frame: Frame; at: number } | undefined
): Op {
  switch (op.op) {
    case "constantUse.bind":
    case "labelUse.bind":
    case "constantUse.unbind":
    case "labelUse.unbind": {
      if (op.layerId === undefined || op.address === undefined) return op;
      const site = siteOf(op.layerId, op.address);
      if (!site) return op;
      const { layerId, address, ...rest } = op;
      void layerId;
      void address;
      return { ...rest, ...site } as Op;
    }
    default:
      return op;
  }
}
