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
import type { TypeAddOp, TypeField, TypeSetOp } from "./types.js";
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
 * A current operation carries a frame and a coordinate. One recorded before
 * uses had frames carries `layerId` and an absolute `address` — and it meant
 * "this site, wherever the bytes came from", which is the address frame. One
 * older still carries only an id, which `siteKeyFor` in the adapters resolves
 * by scanning for it.
 */
export function bindSite(op: {
  frame?: Frame;
  at?: number;
  address?: number;
}): { frame: Frame; at: number } | undefined {
  if (op.frame !== undefined && op.at !== undefined) return { frame: op.frame, at: op.at };
  if (op.address !== undefined) return { frame: { space: "address" }, at: op.address };
  return undefined;
}
