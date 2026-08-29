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

/** Prefix marks what an id refers to, so a stray id in a diff is readable. */
export type IdPrefix = "lbl" | "rgn" | "lay";

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
