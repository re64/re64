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
export type IdPrefix = "lbl" | "rgn" | "cmt" | "cst" | "lay" | "fil";

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

/** True for ids this module could have produced. */
export function isId(value: unknown): value is string {
  return typeof value === "string" && /^(lbl|rgn|lay)_[0-9a-z]+$/.test(value);
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

  return minted ? { ...project, layers, ...(constants ? { constants } : {}) } : project;
}
