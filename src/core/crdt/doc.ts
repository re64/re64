/**
 * The CRDT adapter: a project as a Yjs document.
 *
 * **Nothing outside this directory may import Yjs.** Everything else — the
 * disassembler, the view model, the UI — works with plain project objects, so
 * the merge library stays swappable. A `Y.Map` leaking into `analyze()` would
 * end that, and a test asserts it has not happened.
 *
 * Readable JSON stays canonical. A document is built from it at the start of a
 * session and flattened back at the end; the CRDT exists for the window in
 * between, where concurrent edits have to merge.
 *
 * Flattening a session back to a file must go through the operation layer and
 * the line-editing serializer, **not** `formatProject`. Regenerating the text
 * discards the blank lines that group related labels, and reorders regions that
 * were declared by hand — a whole-file diff in place of the one-line edit that
 * actually happened. `projectFromDoc` gives content, not formatting.
 *
 * That only works because construction is **deterministic**: two clients
 * loading the same JSON produce byte-identical documents, giving their edits a
 * common ancestor to merge onto. Without it, identical content would get
 * different internal ids and merging would duplicate rather than combine.
 */

import * as Y from "yjs";
import { needsMigration, migrateToClaims } from "../claims/migrate.js";
import {
  ProjectType,
  Project,
  ProjectComment,
  ProjectConstant,
  ProjectClaim,
  ProjectDecoder,
  ProjectFile,
  ProjectTarget,
  ProjectScenario,
  ProjectCapture,
  ProjectEvidence,
  ProjectMessage,
  ProjectConstantUse,
  ProjectLabel,
  ProjectLabelUse,
  ProjectLayer,
  ProjectRegion,
  parseProjectAddress,
} from "../project/project.js";

/**
 * Client id used while building the shared base.
 *
 * Fixed, and set before any content, so the base is identical everywhere. Each
 * participant switches to its own id before making edits, which is what keeps
 * their changes distinguishable.
 */
export const BASE_CLIENT_ID = 0;

/**
 * A document, named without exposing the library.
 *
 * Consumers hold one and pass it back; they never reach inside. That is what
 * keeps every file outside this directory free of Yjs imports.
 */
export type CrdtDoc = Y.Doc;

/**
 * Options every document is built with, without exception.
 *
 * `gc: false` keeps deleted content rather than only its tombstone, which is
 * what makes point-in-time reconstruction possible at all. It must match on
 * every peer: two documents that disagree about garbage collection can reach
 * different conclusions about the same history, which is a corruption class
 * rather than a merge conflict.
 *
 * The cost is that the document only grows. That is accepted for now — the
 * growth warnings in the Yjs literature are written for text editing, where
 * every character ever typed is a struct, and this document holds maps of
 * scalars.
 */
const DOC_OPTIONS = { gc: false } as const;

/** Root names. Declared up front because `Doc.toJSON()` only reports roots that have been accessed. */
const ROOT_LAYERS = "layers";
const ROOT_META = "meta";
const ROOT_PRIMARY = "primaryLabels";
const ROOT_CONSTANTS = "constants";
const ROOT_DECODERS = "decoders";
const ROOT_TYPES = "types";
const ROOT_SCENARIOS = "scenarios";
const ROOT_CAPTURES = "captures";
const ROOT_EVIDENCE = "evidence";
const ROOT_FILES = "files";
const ROOT_TARGETS = "targets";
const ROOT_CLAIMS = "claims";
const ROOT_CHAT = "chat";

/** Scalars a project carries outside its layers. */
const META_KEYS = ["name", "description", "entryPoints"] as const;

function mapFrom(record: Record<string, unknown>): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  // Sorted, so two clients insert in the same order and produce the same bytes.
  for (const key of Object.keys(record).sort()) {
    if (record[key] !== undefined) map.set(key, record[key]);
  }
  return map;
}

/**
 * Build a document from a project.
 *
 * Deterministic: same input, same bytes, on every client.
 */
export function docFromProject(declared: Project): Y.Doc {
  // Migrated here as well as in `buildMemoryMap`, and it has to be both: this is
  // the other boundary where a `.re64` becomes live state. With only the loader
  // converting, the document held legacy layers while the loaded view held
  // claims, so an edit naming a migrated claim's id found nothing in the
  // document and did nothing at all — accepted, reported, and lost.
  const project = needsMigration(declared) ? migrateToClaims(declared).project : declared;

  const doc = new Y.Doc(DOC_OPTIONS);
  doc.clientID = BASE_CLIENT_ID;

  doc.transact(() => {
    const layers = doc.getArray<Y.Map<unknown>>(ROOT_LAYERS);
    for (const layer of project.layers) {
      const { labels, regions, comments, constantUses, labelUses, ...scalars } = layer;
      const entry = mapFrom(scalars as Record<string, unknown>);

      // Keyed by id rather than held in an array: two people editing different
      // labels then touch different keys, and neither reorders the other's.
      const labelMap = new Y.Map<Y.Map<unknown>>();
      for (const label of [...(labels ?? [])].sort(byId)) {
        labelMap.set(label.id!, mapFrom(label as unknown as Record<string, unknown>));
      }
      entry.set("labels", labelMap);

      const regionMap = new Y.Map<Y.Map<unknown>>();
      for (const region of [...(regions ?? [])].sort(byId)) {
        regionMap.set(region.id!, mapFrom(region as unknown as Record<string, unknown>));
      }
      entry.set("regions", regionMap);

      const commentMap = new Y.Map<Y.Map<unknown>>();
      for (const comment of [...(comments ?? [])].sort(byId)) {
        commentMap.set(comment.id!, mapFrom(comment as unknown as Record<string, unknown>));
      }
      entry.set("comments", commentMap);

      // **Keyed by the site, not by a minted use id.** A binding is an
      // address-to-id map — binding again is how one is updated — and keying by
      // the record's own id made every bind add a competitor instead. Two uses
      // then sat at one address and the loaded index kept whichever sorted last,
      // by an id that is random.
      const useMap = new Y.Map<Y.Map<unknown>>();
      for (const use of [...(constantUses ?? [])].sort(byId)) {
        useMap.set(siteKey(use.address), mapFrom(use as unknown as Record<string, unknown>));
      }
      entry.set("constantUses", useMap);

      const labelUseMap = new Y.Map<Y.Map<unknown>>();
      for (const use of [...(labelUses ?? [])].sort(byId)) {
        labelUseMap.set(siteKey(use.address), mapFrom(use as unknown as Record<string, unknown>));
      }
      entry.set("labelUses", labelUseMap);

      layers.push([entry]);
    }

    const meta = doc.getMap<unknown>(ROOT_META);
    for (const key of META_KEYS) {
      if (project[key] !== undefined) meta.set(key, project[key]);
    }

    const primary = doc.getMap<string>(ROOT_PRIMARY);
    for (const address of Object.keys(project.primaryLabels ?? {}).sort()) {
      primary.set(address, project.primaryLabels![address]);
    }

    // Keyed by id, like labels: two people declaring different constants touch
    // different keys. Project level because a name for a value describes no
    // bytes, so there is no layer for it to belong to.
    const constants = doc.getMap<Y.Map<unknown>>(ROOT_CONSTANTS);
    for (const constant of [...(project.constants ?? [])].sort(byId)) {
      constants.set(constant.id!, mapFrom(constant as unknown as Record<string, unknown>));
    }

    // Project level for the same reason: a way of *reading* bytes describes
    // none of its own, so there is no layer for it to move with.
    const targets = doc.getMap<Y.Map<unknown>>(ROOT_TARGETS);
    // Keyed by id, like every other collection here. It was keyed by name,
    // which made a target the one entity whose identity could be edited.
    for (const target of [...(project.targets ?? [])].sort((a, b) => a.name.localeCompare(b.name))) {
      targets.set(target.id!, mapFrom(target as unknown as Record<string, unknown>));
    }

    const files = doc.getMap<Y.Map<unknown>>(ROOT_FILES);
    for (const file of [...(project.files ?? [])].sort((a, b) => a.name.localeCompare(b.name))) {
      files.set(file.name, mapFrom(file as unknown as Record<string, unknown>));
    }

    // Keyed by id and flat, not nested in a layer: a claim is one entry edited
    // independently, and it must be able to name an address no layer supplies.
    const claims = doc.getMap<Y.Map<unknown>>(ROOT_CLAIMS);
    for (const claim of [...(project.claims ?? [])].sort(byId)) {
      claims.set(claim.id!, mapFrom(claim as unknown as Record<string, unknown>));
    }

    const decoders = doc.getMap<Y.Map<unknown>>(ROOT_DECODERS);
    for (const decoder of [...(project.decoders ?? [])].sort(byId)) {
      decoders.set(decoder.id!, mapFrom(decoder as unknown as Record<string, unknown>));
    }

    const types = doc.getMap<Y.Map<unknown>>(ROOT_TYPES);
    for (const type of [...(project.types ?? [])].sort(byId)) {
      types.set(type.id!, typeMapFrom(type));
    }

    // Steps as one JSON value, matching the operation: a scenario is one
    // author's sequence, so there is no key for two writers to merge on.
    const scenarios = doc.getMap<Y.Map<unknown>>(ROOT_SCENARIOS);
    for (const scenario of [...(project.scenarios ?? [])].sort(byId)) {
      scenarios.set(
        scenario.id!,
        mapFrom({
          ...(scenario as unknown as Record<string, unknown>),
          steps: JSON.stringify(scenario.steps),
        })
      );
    }

    const captures = doc.getMap<Y.Map<unknown>>(ROOT_CAPTURES);
    for (const capture of [...(project.captures ?? [])].sort(byId)) {
      captures.set(capture.id!, mapFrom(capture as unknown as Record<string, unknown>));
    }

    const evidence = doc.getMap<Y.Map<unknown>>(ROOT_EVIDENCE);
    for (const item of [...(project.evidence ?? [])].sort(byId)) {
      evidence.set(item.id!, mapFrom(item as unknown as Record<string, unknown>));
    }

    // A list, not a map: ordering is the content of a conversation, and the
    // array CRDT converges it without anyone agreeing a clock. Each entry still
    // carries an id, so a message is addressable — the two properties are
    // independent and chat wants both.
    const chat = doc.getArray<Y.Map<unknown>>(ROOT_CHAT);
    if (chat.length === 0 && project.messages?.length) {
      chat.push(
        project.messages.map((m) => mapFrom(m as unknown as Record<string, unknown>))
      );
    }
  }, "load");

  return doc;
}

/**
 * A type, with its fields as a map of their own.
 *
 * The nesting is the whole point and is not incidental: two readers adding
 * different fields to one record touch different keys of the inner map and both
 * survive, where a flattened field list would be one value that
 * last-writer-wins throws half of away. It is what makes fields need no ids —
 * an offset cannot be shared, so the key is the identity.
 */
function typeMapFrom(type: ProjectType): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set("id", type.id);
  map.set("name", type.name);
  map.set("size", type.size);
  if (type.unit !== undefined) map.set("unit", type.unit);

  const fields = new Y.Map<unknown>();
  for (const key of Object.keys(type.fields).sort((a, b) => Number(a) - Number(b))) {
    fields.set(key, type.fields[key]);
  }
  map.set("fields", fields);
  return map;
}

/** A binding's key: the site it is about, spelled the way the file spells one. */
function siteKey(address: number | string): string {
  const at = typeof address === "number" ? address : parseProjectAddress(address);
  return `$${at.toString(16).toUpperCase().padStart(4, "0")}`;
}

const byId = (a: { id?: string }, b: { id?: string }) =>
  (a.id ?? "").localeCompare(b.id ?? "");

/** Read a document back as a plain project. */
export function projectFromDoc(doc: Y.Doc): Project {
  // Touch every root: an untouched one is missing from the document's view,
  // even when updates carrying it have been applied.
  const layers = doc.getArray<Y.Map<unknown>>(ROOT_LAYERS);
  const meta = doc.getMap<unknown>(ROOT_META);
  const primary = doc.getMap<string>(ROOT_PRIMARY);
  const constants = doc.getMap<Y.Map<unknown>>(ROOT_CONSTANTS);
  const decoders = doc.getMap<Y.Map<unknown>>(ROOT_DECODERS);
  const files = doc.getMap<Y.Map<unknown>>(ROOT_FILES);
  const targets = doc.getMap<Y.Map<unknown>>(ROOT_TARGETS);
  const claims = doc.getMap<Y.Map<unknown>>(ROOT_CLAIMS);
  const types = doc.getMap<Y.Map<unknown>>(ROOT_TYPES);

  const project: Project = {
    layers: layers.toArray().map((entry) => {
      const scalars = { ...(entry.toJSON() as Record<string, unknown>) };
      delete scalars.labels;
      delete scalars.regions;
      delete scalars.comments;
      delete scalars.constantUses;
      delete scalars.labelUses;

      const labels = entry.get("labels") as Y.Map<Y.Map<unknown>> | undefined;
      const regions = entry.get("regions") as Y.Map<Y.Map<unknown>> | undefined;
      const comments = entry.get("comments") as Y.Map<Y.Map<unknown>> | undefined;
      const uses = entry.get("constantUses") as Y.Map<Y.Map<unknown>> | undefined;
      const labelUses = entry.get("labelUses") as Y.Map<Y.Map<unknown>> | undefined;

      const layer = inOrder<ProjectLayer>(scalars, LAYER_FIELDS);
      const labelList = labels
        ? sortedValues<ProjectLabel>(labels, "address").map((l) =>
            inOrder<ProjectLabel>(l as unknown as Record<string, unknown>, LABEL_FIELDS)
          )
        : [];
      const regionList = regions
        ? sortedValues<ProjectRegion>(regions, "start").map((r) =>
            inOrder<ProjectRegion>(r as unknown as Record<string, unknown>, REGION_FIELDS)
          )
        : [];
      // By address, then by id within one: several comments can share an
      // address, and the order has to be identical on every peer without
      // anyone coordinating.
      const commentList = comments
        ? sortedValues<ProjectComment>(comments, "address").map((c) =>
            inOrder<ProjectComment>(c as unknown as Record<string, unknown>, COMMENT_FIELDS)
          )
        : [];

      if (labelList.length) layer.labels = labelList;
      if (regionList.length) layer.regions = regionList;
      const useList = uses
        ? sortedValues<ProjectConstantUse>(uses, "address").map((u) =>
            inOrder<ProjectConstantUse>(u as unknown as Record<string, unknown>, USE_FIELDS)
          )
        : [];

      if (commentList.length) layer.comments = commentList;
      const labelUseList = labelUses
        ? sortedValues<ProjectLabelUse>(labelUses, "address").map((u) =>
            inOrder<ProjectLabelUse>(u as unknown as Record<string, unknown>, LABEL_USE_FIELDS)
          )
        : [];

      if (useList.length) layer.constantUses = useList;
      if (labelUseList.length) layer.labelUses = labelUseList;
      return layer;
    }),
  };

  for (const key of META_KEYS) {
    const value = meta.get(key);
    if (value !== undefined) (project as unknown as Record<string, unknown>)[key] = value;
  }

  const primaryJson = primary.toJSON() as Record<string, string>;
  if (Object.keys(primaryJson).length) project.primaryLabels = primaryJson;

  const constantList = sortedValues<ProjectConstant>(constants, "value").map((c) =>
    inOrder<ProjectConstant>(c as unknown as Record<string, unknown>, CONSTANT_FIELDS)
  );
  if (constantList.length) project.constants = constantList;

  const claimList = sortedValues<ProjectClaim>(claims, "at").map((c) =>
    inOrder<ProjectClaim>(c as unknown as Record<string, unknown>, CLAIM_FIELDS)
  );
  if (claimList.length) project.claims = claimList;

  const decoderList = sortedValues<ProjectDecoder>(decoders, "name").map((d) =>
    inOrder<ProjectDecoder>(d as unknown as Record<string, unknown>, DECODER_FIELDS)
  );
  if (decoderList.length) project.decoders = decoderList;

  // By name, like decoders and constants: an id sorts by nothing a reader cares
  // about, and a `.re64` should read the way somebody would have written it.
  const typeList = sortedValues<ProjectType>(types, "name").map((t) =>
    inOrder<ProjectType>(t as unknown as Record<string, unknown>, TYPE_FIELDS)
  );
  if (typeList.length) project.types = typeList;

  const fileList = sortedValues<ProjectFile>(files, "name").map((f) =>
    inOrder<ProjectFile>(f as unknown as Record<string, unknown>, FILE_FIELDS)
  );
  if (fileList.length) project.files = fileList;

  const targetList = sortedValues<ProjectTarget>(targets, "name").map((t) =>
    inOrder<ProjectTarget>(t as unknown as Record<string, unknown>, TARGET_FIELDS)
  );
  if (targetList.length) project.targets = targetList;

  // Steps come back out of the one JSON value they went in as.
  const scenarioList = sortedValues<Record<string, unknown>>(
    doc.getMap<Y.Map<unknown>>(ROOT_SCENARIOS),
    "name"
  ).map((entry) => {
    const ordered = inOrder<Record<string, unknown>>(entry, SCENARIO_FIELDS);
    return {
      ...ordered,
      steps: JSON.parse(String(ordered.steps ?? "[]")),
    } as unknown as ProjectScenario;
  });
  if (scenarioList.length) project.scenarios = scenarioList;

  const captureList = sortedValues<ProjectCapture>(
    doc.getMap<Y.Map<unknown>>(ROOT_CAPTURES),
    "file"
  ).map((c) => inOrder<ProjectCapture>(c as unknown as Record<string, unknown>, CAPTURE_FIELDS));
  if (captureList.length) project.captures = captureList;

  const evidenceList = sortedValues<ProjectEvidence>(
    doc.getMap<Y.Map<unknown>>(ROOT_EVIDENCE),
    "claim"
  ).map((e) => inOrder<ProjectEvidence>(e as unknown as Record<string, unknown>, EVIDENCE_FIELDS));
  if (evidenceList.length) project.evidence = evidenceList;

  // In the order the array holds them, which is the order they were said in.
  // Not `sortedValues`: every other root is a map and sorting it is what makes a
  // projection deterministic, where here the sequence *is* the state.
  const messageList = doc
    .getArray<Y.Map<unknown>>(ROOT_CHAT)
    .toArray()
    .map((m) => inOrder<ProjectMessage>(m.toJSON() as Record<string, unknown>, MESSAGE_FIELDS))
    .filter((m) => typeof m.text === "string");
  if (messageList.length) project.messages = messageList;

  return project;
}

/**
 * The projection without the conversation.
 *
 * **Two questions that were one answer while chat was invisible.** "What does
 * this project hold" now includes what was said; "has the program description
 * changed" does not, and neither does "must I re-analyse". A message is a
 * document change and not a program change, so it exports, merges and reaches
 * the changes feed — and it moves no version and triggers no re-derivation.
 *
 * Read the other way round: this is what `version()` hashes and what a client
 * compares before rebuilding. Hashing the full projection would re-analyse the
 * whole program once per line of conversation, which is the cost the fifth-root
 * design was avoiding and is worth keeping without it.
 */
export function programFromDoc(doc: Y.Doc): Project {
  const { messages: _said, ...program } = projectFromDoc(doc);
  return program;
}

/**
 * Field order as the project file writes it.
 *
 * Keys go into the document sorted, so construction is deterministic; they come
 * back out in the order the serializer expects. Without this, flattening a
 * session would rewrite every line just to reorder "id" and "address", turning
 * a one-label edit into a whole-file diff.
 */
// A label no longer carries a comment: comments are their own objects. Read
// from an older document, the key is simply absent.
const MESSAGE_FIELDS = ["id", "at", "author", "name", "text"] as const;
const LABEL_FIELDS = ["id", "address", "name", "type", "extent"] as const;
const REGION_FIELDS = [
  "id",
  "start",
  "end",
  "kind",
  "name",
  "comment",
  "encoding",
  "view",
] as const;
const COMMENT_FIELDS = ["id", "address", "placement", "text", "order"] as const;
const USE_FIELDS = ["id", "address", "constant"] as const;
const LABEL_USE_FIELDS = ["id", "address", "label"] as const;
const CONSTANT_FIELDS = ["id", "name", "value"] as const;
const DECODER_FIELDS = ["id", "name", "source"] as const;
const TYPE_FIELDS = ["id", "name", "size", "unit", "fields"] as const;
/**
 * Field order for a claim in the file.
 *
 * Identity, then where, then what it says, then who said it — which is the order
 * a reader scans and the order that keeps a diff's changed key next to what it
 * qualifies. A missing entry here is silent: `inOrder` keeps unknown keys, so it
 * produces a subtly reordered file rather than a failure.
 */
export const CLAIM_FIELDS = [
  "id",
  "at",
  "extent",
  "layer",
  "target",
  "name",
  "is",
  "encoding",
  "view",
  "typeId",
  "root",
  "description",
  "origin",
] as const;
const FILE_FIELDS = ["name", "hash", "size"] as const;
export const TARGET_FIELDS = ["id", "name", "layers", "entryPoints", "order", "description"] as const;
const SCENARIO_FIELDS = ["id", "name", "description", "steps"] as const;
const CAPTURE_FIELDS = ["id", "scenario", "step", "kind", "file", "when"] as const;
const EVIDENCE_FIELDS = [
  "id",
  "claim",
  "kind",
  "author",
  "method",
  "when",
  "scenario",
  "capture",
  "other",
  "note",
] as const;
const LAYER_FIELDS = [
  "id",
  "type",
  "rom",
  "reference",
  "path",
  "address",
  "bytes",
  "length",
  "noAutoEntry",
  "name",
] as const;

function inOrder<T>(source: Record<string, unknown>, fields: readonly string[]): T {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (source[field] !== undefined) out[field] = source[field];
  }
  // Anything the schema gained since is kept rather than silently dropped.
  for (const key of Object.keys(source)) {
    if (!fields.includes(key) && source[key] !== undefined) out[key] = source[key];
  }
  return out as T;
}

/**
 * Entries in a stable order.
 *
 * A `Y.Map` iterates in an order that reflects how it was built, which differs
 * between clients that inserted concurrently. Sorting by address keeps the
 * written file stable, so the same state always serialises the same way.
 */
function sortedValues<T>(map: Y.Map<Y.Map<unknown>>, key: string): T[] {
  const parseAddress = (value: unknown): number => {
    if (typeof value === "number") return value;
    const text = String(value ?? "").trim();
    if (text.startsWith("$")) return parseInt(text.slice(1), 16);
    if (text.startsWith("0x")) return parseInt(text.slice(2), 16);
    return parseInt(text, 10);
  };

  return [...map.values()]
    .map((entry) => entry.toJSON() as T)
    .sort((a, b) => {
      const delta =
        parseAddress((a as Record<string, unknown>)[key]) -
        parseAddress((b as Record<string, unknown>)[key]);
      return delta !== 0
        ? delta
        : String((a as { id?: string }).id).localeCompare(String((b as { id?: string }).id));
    });
}

/**
 * A document with nothing in it, to be filled by syncing with a peer.
 *
 * This is how a participant should join: start empty and let the protocol
 * deliver the state. Building a base locally instead — from JSON both sides
 * are assumed to share — only works while those bytes are provably identical,
 * and it fails silently when they are not, because both bases claim the same
 * client id for different content.
 */
export function emptyDoc(): Y.Doc {
  return new Y.Doc(DOC_OPTIONS);
}

/**
 * Rebuild a document from its stored updates.
 *
 * Order does not matter — updates are commutative and idempotent — so the
 * store owes no ordering guarantee and a replay may safely include duplicates.
 */
export function docFromUpdates(updates: readonly Uint8Array[]): Y.Doc {
  const doc = emptyDoc();
  for (const update of updates) Y.applyUpdate(doc, update, "load");
  return doc;
}

/** The whole document as one update, for sending or storing. */
export function encodeDoc(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

/** Merge an update into a document. */
export function applyUpdate(doc: Y.Doc, update: Uint8Array, origin?: unknown): void {
  Y.applyUpdate(doc, update, origin);
}

/** Squash a session's updates into one, for a single history entry. */
export function squashUpdates(updates: readonly Uint8Array[]): Uint8Array {
  return Y.mergeUpdates([...updates]);
}

/**
 * Who made the changes in an update.
 *
 * Every struct carries the client id of whoever created it, so this is the
 * whole basis of attribution: a client id maps to a session, and a session to a
 * person. Nothing else in an update says who did anything.
 *
 * Usually one id, but an update relayed from elsewhere can carry several.
 */
export function clientsInUpdate(update: Uint8Array): number[] {
  return [...Y.decodeStateVector(Y.encodeStateVectorFromUpdate(update)).keys()];
}

/** What this document has, so a peer can send only what it lacks. */
export function stateVector(doc: Y.Doc): Uint8Array {
  return Y.encodeStateVector(doc);
}

/** Everything in `doc` that a peer with `since` does not have. */
export function diffSince(doc: Y.Doc, since: Uint8Array): Uint8Array {
  return Y.encodeStateAsUpdate(doc, since);
}
