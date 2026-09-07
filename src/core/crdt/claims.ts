/**
 * Claims as a top-level CRDT root.
 *
 * Flat and keyed by id, one level shallower than labels and regions, which nest
 * inside the layer that owns them. That nesting is what the redesign removes, and
 * the merge consequences are the reason to prototype it rather than argue it:
 *
 * - **A claim is one map entry, edited independently.** Two people revising
 *   different claims touch different keys and neither reorders the other's — the
 *   property the existing label and region maps already have, now applying to the
 *   pair as one.
 * - **Moving a claim between targets is a field write**, not a move between
 *   containers. Yjs has no move primitive; a move is a delete and an insert, and
 *   two peers moving one thing concurrently produce two.
 * - **A claim can name an address no layer supplies**, because it does not have
 *   to find an owner first. That is what deletes the symbols-layer apparatus.
 *
 * It lives here rather than beside the claim model because the boundary test says
 * so, and the test was right: `src/core/claims/` is domain and must never see a
 * CRDT type, while persisting a claim is a CRDT concern. The prototype was
 * written in the wrong directory and the allowlist caught it — which is the
 * assertion earning its keep rather than an inconvenience.
 *
 * Nothing here reaches the live document yet.
 */

import * as Y from "yjs";
import { Claim, Interpretation, Provenance, RootKind } from "../claims/model.js";
import { parseProjectAddress } from "../project/project.js";

export const ROOT_CLAIMS = "claims";

/** The operations a claim needs. Three, where labels and regions needed four. */
export type ClaimOp =
  | { readonly op: "claim.add"; readonly claim: Claim }
  | {
      /**
       * Revise fields of an existing claim.
       *
       * Partial by construction: an omitted field is left alone, so two peers
       * revising different fields of one claim both survive. `set_region`
       * replaced the whole region, which is why describing one silently reverted
       * somebody's layer list until that was found and fixed — the same shape,
       * one object along.
       */
      readonly op: "claim.set";
      readonly id: string;
      readonly fields: Partial<Omit<Claim, "id">>;
    }
  | { readonly op: "claim.remove"; readonly id: string };

export function claimsRoot(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(ROOT_CLAIMS);
}

/** Flatten a claim to scalars a Y.Map can hold. Nested objects go as JSON-safe values. */
export function encodeClaim(claim: Claim): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: claim.id,
    // As the file writes it, which is the convention every other root here
    // follows — `constant.set` stores `"$01"` rather than `1`. The document is
    // flattened straight into a `.re64`, so a number here would produce
    // `"at": 33792` in a file whose every other address is `$8400`, and two
    // write paths would disagree about the same claim.
    at: `$${claim.at.toString(16).toUpperCase().padStart(4, "0")}`,
    author: claim.by.author,
    source: claim.by.source,
  };
  if (claim.extent !== undefined) out.extent = claim.extent;
  if (claim.name !== undefined) out.name = claim.name;
  if (claim.description !== undefined) out.description = claim.description;
  if (claim.root !== undefined) out.root = claim.root;
  if (claim.by.when !== undefined) out.when = claim.by.when;
  if (claim.by.method !== undefined) out.method = claim.by.method;
  if (claim.frame?.space === "layer") out.layer = claim.frame.layer;
  if (claim.frame?.space === "target") out.target = claim.frame.target;
  if (claim.says !== undefined) {
    out.is = claim.says.is;
    if (claim.says.is === "text" && claim.says.encoding) out.encoding = claim.says.encoding;
    if (claim.says.is === "bitmap" && claim.says.view) out.view = claim.says.view;
    // Text carries a view too: a program's own character set is unreadable by
    // any built-in encoding, and `snippet:<id>` is the only way such a span is
    // legible at all.
    if (claim.says.is === "text" && claim.says.view) out.view = claim.says.view;
    if (claim.says.is === "record") out.typeId = claim.says.typeId;
  }
  return out;
}

export function decodeClaim(entry: Y.Map<unknown>): Claim {
  const get = <T>(key: string) => entry.get(key) as T | undefined;
  const is = get<Interpretation["is"]>("is");

  let says: Interpretation | undefined;
  if (is === "text") says = { is, encoding: get("encoding"), view: get("view") };
  else if (is === "bitmap") says = { is, view: get("view") };
  else if (is === "record") says = { is, typeId: get("typeId") ?? "" };
  else if (is === "data" || is === "jumptable") says = { is };

  const by: Provenance = {
    author: get<string>("author") ?? "unknown",
    source: get<Provenance["source"]>("source") ?? "user",
    ...(get<number>("when") !== undefined ? { when: get<number>("when") } : {}),
    ...(get<Provenance["method"]>("method")
      ? { method: get<Provenance["method"]>("method") }
      : {}),
  };

  const layer = get<string>("layer");
  const target = get<string>("target");
  const at = get<number | string>("at")!;
  return {
    id: get<string>("id")!,
    at: typeof at === "number" ? at : parseProjectAddress(at),
    ...(get<number>("extent") !== undefined ? { extent: get<number>("extent") } : {}),
    ...(get<string>("name") !== undefined ? { name: get<string>("name") } : {}),
    ...(get<string>("description") !== undefined
      ? { description: get<string>("description") }
      : {}),
    ...(says ? { says } : {}),
    ...(get<RootKind>("root") ? { root: get<RootKind>("root") } : {}),
    ...(layer
      ? { frame: { space: "layer" as const, layer } }
      : target
        ? { frame: { space: "target" as const, target } }
        : {}),
    by,
  };
}

/** Seed a document's claims root. One-time, at import. */
export function writeClaims(doc: Y.Doc, claims: readonly Claim[]): void {
  doc.transact(() => {
    const root = claimsRoot(doc);
    // Sorted, so two clients importing the same project insert in the same order.
    for (const claim of [...claims].sort((a, b) => a.id.localeCompare(b.id))) {
      const entry = new Y.Map<unknown>();
      const fields = encodeClaim(claim);
      for (const key of Object.keys(fields).sort()) entry.set(key, fields[key]);
      root.set(claim.id, entry);
    }
  });
}

export function readClaims(doc: Y.Doc): Claim[] {
  const out: Claim[] = [];
  for (const entry of claimsRoot(doc).values()) out.push(decodeClaim(entry));
  return out;
}

/**
 * Apply one operation.
 *
 * `origin` identifies who is editing and decides whose undo stack it lands on,
 * exactly as `applyOpToDoc` does today.
 */
export function applyClaimOp(doc: Y.Doc, op: ClaimOp, origin: unknown = "local"): void {
  doc.transact(() => {
    const root = claimsRoot(doc);
    switch (op.op) {
      case "claim.add": {
        // Always adds. An id already present means the same claim arriving twice
        // — a retry, or a replayed op — never two people meaning different
        // things, because ids are minted by the writer.
        const entry = new Y.Map<unknown>();
        const fields = encodeClaim(op.claim);
        for (const key of Object.keys(fields).sort()) entry.set(key, fields[key]);
        root.set(op.claim.id, entry);
        break;
      }
      case "claim.set": {
        const entry = root.get(op.id);
        // A revision of a claim somebody else deleted concurrently does nothing,
        // rather than resurrecting it with half its fields. Same rule as a
        // dangling primaryLabels entry: the delete wins and nothing needs a sweep.
        if (!entry) break;

        // Scalars go straight through. The three structured fields are spread
        // into the flat keys `encode` uses, so a revision touches exactly the
        // keys it names and no others — which is what lets two peers revise
        // different fields of one claim without either reverting the other.
        const { says, frame, by, ...scalars } = op.fields;
        for (const [key, value] of Object.entries(scalars)) {
          if (value !== undefined) entry.set(key, value as unknown);
        }
        if (says !== undefined) {
          entry.set("is", says.is);
          entry.set("encoding", says.is === "text" ? says.encoding : undefined);
          entry.set("view", says.is === "bitmap" ? says.view : undefined);
          for (const key of ["encoding", "view"]) {
            if (entry.get(key) === undefined) entry.delete(key);
          }
        }
        if (frame !== undefined) {
          if (frame.space === "layer") entry.set("layer", frame.layer);
          else if (frame.space === "target") entry.set("target", frame.target);
          else entry.delete("layer");
        }
        if (by !== undefined) {
          entry.set("author", by.author);
          entry.set("source", by.source);
          if (by.when !== undefined) entry.set("when", by.when);
          if (by.method !== undefined) entry.set("method", by.method);
        }
        break;
      }
      case "claim.remove":
        root.delete(op.id);
        break;
    }
  }, origin);
}
