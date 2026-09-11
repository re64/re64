/**
 * Stable identity for annotations.
 *
 * Addresses cannot serve as identity: several labels can share one, regions can
 * be moved or extended, and a rename changes the very field you would otherwise
 * key on. Without ids, "extend this region" is indistinguishable from
 * delete-plus-create, and `label.set {address, name}` is ambiguous wherever two
 * labels sit together.
 *
 * Ids are random rather than sequential because two clients — or an agent and a
 * person — must be able to mint them without coordinating.
 */

import type { Project } from "./project.js";

/** Prefix marks what an id refers to, so a stray id in a diff is readable. */
export type IdPrefix = "lbl" | "rgn" | "cmt" | "cst" | "lay" | "fil" | "msg" | "dec" | "clm" | "typ" | "tgt" | "lnk" | "fld" | "scn" | "stp" | "cap" | "evd";

const ID_CHARS = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Enough entropy that collisions are not a practical concern at project scale. */
const ID_LENGTH = 6;

/** Mint a fresh id. */
export function newId(prefix: IdPrefix): string {
  let out = "";
  for (let i = 0; i < ID_LENGTH; i++) {
    out += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  }
  return `${prefix}_${out}`;
}

/**
 * The id a legacy entry gets when the file does not carry one.
 *
 * Derived from content rather than minted, so every client that loads the same
 * un-migrated file agrees on it — otherwise two clients would assign different
 * ids to the same label and merge would see two labels instead of one.
 *
 * Only a bridge. The first write persists real ids, after which they are stable
 * and independent of the fields they were derived from.
 */
export function derivedId(prefix: IdPrefix, ...parts: (string | number)[]): string {
  // FNV-1a: small, dependency-free, and stable across platforms and versions.
  let hash = 0x811c9dc5;
  for (const part of parts) {
    for (const ch of String(part)) {
      hash ^= ch.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash ^= 0x2f; // separator, so ("ab","c") and ("a","bc") differ
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${prefix}_${hash.toString(36).padStart(ID_LENGTH, "0").slice(-ID_LENGTH)}`;
}

/**
 * A layer's id, or the one every client derives for a layer that has none.
 *
 * Shared by the loader and the entry-point migration, so a target made for a
 * legacy file links the same layer ids the loader will hand out for it.
 */
export function layerIdOf(
  decl: { id?: string; type: string; path?: string; name?: string },
  index: number
): string {
  return decl.id ?? derivedId("lay", index, decl.type, decl.path ?? decl.name ?? "");
}

/** True for ids this module could have produced. */
export function isId(value: unknown): value is string {
  return typeof value === "string" && /^(lbl|rgn|lay|cmt|cst|fil|dec|clm|typ)_[0-9a-z]+$/.test(value);
}

/**
 * The same project with an id on everything that lacked one.
 *
 * Works on the parsed object rather than the text, so it does not care how the
 * file was formatted. `migrateIds` edits the raw JSON line by line to keep a
 * hand-authored layout intact, which is right for `re64 migrate` and silently
 * does nothing to a file written on one line — the shape a generated project
 * usually arrives in.
 *
 * Returns the original object untouched when nothing was missing, so a caller
 * can tell whether reserialising is warranted.
 */
export function withIds(project: Project, mint: (prefix: IdPrefix) => string = newId): Project {
  let minted = false;
  const give = <T extends { id?: string }>(item: T, prefix: IdPrefix): T => {
    if (item.id) return item;
    minted = true;
    return { ...item, id: mint(prefix) };
  };

  const layers = project.layers.map((layer) => {
    const withId = give(layer, "lay");
    return {
      ...withId,
      ...(layer.labels ? { labels: layer.labels.map((l) => give(l, "lbl")) } : {}),
      ...(layer.regions ? { regions: layer.regions.map((r) => give(r, "rgn")) } : {}),
      ...(layer.comments ? { comments: layer.comments.map((c) => give(c, "cmt")) } : {}),
      ...(layer.constantUses
        ? { constantUses: layer.constantUses.map((u) => give(u, "cst")) }
        : {}),
      ...(layer.labelUses ? { labelUses: layer.labelUses.map((u) => give(u, "lbl")) } : {}),
    };
  });

  const constants = project.constants?.map((c) => give(c, "cst"));
  const claims = project.claims?.map((c) => give(c, "clm"));
  // Decoders were skipped here, so an id-less one never got one — and
  // `diffProjects` drops entries without ids, which means such a decoder was
  // silently absent from every export.
  const decoders = project.decoders?.map((d) => give(d, "dec"));
  const types = project.types?.map((t) => {
    const withId = give(t, "typ");
    return {
      ...withId,
      // A list, and each entry keeps or is given an id — which is what the
      // document keys it under, so a file that omits one still loads and the
      // next write persists a real one.
      fields: withId.fields.map((field) => give(field, "fld")),
    };
  });
  // Targets were skipped for the same reason decoders were — they were keyed by
  // name, so nothing needed an id until identity stopped being editable.
  const scenarios = project.scenarios?.map((x) => {
    const withId = give(x, "scn");
    return { ...withId, steps: withId.steps.map((step) => give(step, "stp")) };
  });
  const captures = project.captures?.map((c) => give(c, "cap"));
  const evidence = project.evidence?.map((e) => give(e, "evd"));

  const targets = project.targets?.map((t) => {
    const withId = give(t, "tgt");
    return {
      ...withId,
      layers: withId.layers.map((link) =>
        typeof link === "string" ? { id: mint("lnk"), layer: link } : give(link, "lnk")
      ),
    };
  });

  return minted
    ? {
        ...project,
        layers,
        ...(constants ? { constants } : {}),
        ...(decoders ? { decoders } : {}),
        ...(types ? { types } : {}),
        ...(claims ? { claims } : {}),
        ...(targets ? { targets } : {}),
        ...(scenarios ? { scenarios } : {}),
        ...(captures ? { captures } : {}),
        ...(evidence ? { evidence } : {}),
      }
    : project;
}

/**
 * Whether a string is one of this project's ids.
 *
 * **The invariant that makes names usable as aliases.** An id is a three-letter
 * prefix, an underscore and six characters of `[0-9a-z]`; no field type this
 * model spells can take that shape — `u8`, `i8`, `u16`, `u16be`, `ptr`, `ptrbe`,
 * `char(n)`, `bytes(n)` and `bits(n)` contain no underscore and none is nine
 * characters of that form. So a reference stored in the document is never
 * ambiguous between an id and a built-in type, and the alias layer above it can
 * accept either without a rule about which wins.
 *
 * It is checked rather than assumed, because it holds by construction today and
 * would stop holding the moment somebody added a type spelling with an
 * underscore in it.
 */
export function isEntityId(text: string): boolean {
  return /^[a-z]{3}_[0-9a-z]{6}$/.test(text.trim());
}
