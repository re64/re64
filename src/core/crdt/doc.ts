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
import { derivedId } from "../project/identity.js";
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
  ProjectField,
  fieldsOfType,
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
 * Code units, never `localeCompare`, for anything the document derives.
 *
 * Two peers must project one document to the same bytes and the version hash is
 * taken over that projection. `localeCompare` answers by the reader's locale —
 * `fld_ä` before `fld_z` in one, after it in another — and by ICU's equivalence
 * rules, under which the distinct ids `fld_\u00e9` and `fld_e\u0301` compare
 * *equal*, so two peers holding both kept them in opposite insertion orders for
 * ever. The root comparator was fixed first; the tiebreak inside a record's
 * fields is the same invariant one level down.
 */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

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
    for (const target of [...(project.targets ?? [])].sort((a, b) => byCodeUnit(a.name, b.name))) {
      targets.set(target.id!, mapFrom(target as unknown as Record<string, unknown>));
    }

    const files = doc.getMap<Y.Map<unknown>>(ROOT_FILES);
    for (const file of [...(project.files ?? [])].sort((a, b) => byCodeUnit(a.name, b.name))) {
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
 * A type, with its fields as a map of their own, **keyed by field id**.
 *
 * The nesting is the whole point and is not incidental: two readers adding
 * different fields to one record touch different keys of the inner map and both
 * survive, where a flattened field list would be one value that
 * last-writer-wins throws half of away.
 *
 * The *key* took two goes. It was the offset, argued on the grounds that two
 * fields cannot share one — true of one writer. Under two it made a move a
 * delete plus a create, so moving one field to two different offsets produced
 * two entries carrying one id, and removing it by that id took away one and left
 * the other. An offset is a property; the id is the identity.
 */
function typeMapFrom(type: ProjectType): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set("id", type.id);
  map.set("name", type.name);
  map.set("size", type.size);
  if (type.unit !== undefined) map.set("unit", type.unit);

  // **Each field is a map of its own**, not a plain object at a key. A whole
  // object is one value, so two readers changing different properties of one
  // field made the later write win over a property it never read — the same
  // defect `claim.set` had one level up. Nested, a rename and a description
  // touch different keys and both survive.
  const fields = new Y.Map<unknown>();
  for (const field of fieldList(type).sort(byOffset)) {
    if (!field.id) continue;
    const inner = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(field)) {
      if (value !== undefined) inner.set(key, value);
    }
    fields.set(field.id, inner);
  }
  map.set("fields", fields);
  return map;
}

/** A binding's key: the site it is about, spelled the way the file spells one. */
function siteKey(address: number | string): string {
  const at = typeof address === "number" ? address : parseProjectAddress(address);
  return `$${at.toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * A type's fields as a list, whatever shape they arrived in.
 *
 * `parseProject` converts the offset-keyed object every file written before ids
 * uses, but this is also reached with a project built in memory — the CRDT entry
 * points take whatever a caller hands them, which is why the migration lives in
 * both places rather than only at the file boundary.
 */
function fieldList(type: ProjectType): ProjectField[] {
  return [...fieldsOfType(type)];
}

/** Layout order, then id, so a projection is the same on every peer. */
const byOffset = (a: ProjectField, b: ProjectField): number =>
  a.offset - b.offset || byCodeUnit(a.id ?? "", b.id ?? "");

const byId = (a: { id?: string }, b: { id?: string }) => byCodeUnit(a.id ?? "", b.id ?? "");

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
        ? sortedValues<ProjectLabel>(labels, "address", "number").map((l) =>
            inOrder<ProjectLabel>(l as unknown as Record<string, unknown>, LABEL_FIELDS)
          )
        : [];
      const regionList = regions
        ? sortedValues<ProjectRegion>(regions, "start", "number").map((r) =>
            inOrder<ProjectRegion>(r as unknown as Record<string, unknown>, REGION_FIELDS)
          )
        : [];
      // By address, then by id within one: several comments can share an
      // address, and the order has to be identical on every peer without
      // anyone coordinating.
      const commentList = comments
        ? sortedValues<ProjectComment>(comments, "address", "number").map((c) =>
            inOrder<ProjectComment>(c as unknown as Record<string, unknown>, COMMENT_FIELDS)
          )
        : [];

      if (labelList.length) layer.labels = labelList;
      if (regionList.length) layer.regions = regionList;
      const useList = uses
        ? sortedValues<ProjectConstantUse>(uses, "address", "number").map((u) =>
            inOrder<ProjectConstantUse>(u as unknown as Record<string, unknown>, USE_FIELDS)
          )
        : [];

      if (commentList.length) layer.comments = commentList;
      const labelUseList = labelUses
        ? sortedValues<ProjectLabelUse>(labelUses, "address", "number").map((u) =>
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

  // Sorted, for the same reason and by the same rule as every list above: an
  // object's keys come out in insertion order, so two peers that bound the same
  // two addresses in different orders would serialise differently and hash
  // differently while holding identical state.
  const primaryJson = primary.toJSON() as Record<string, string>;
  const primaryKeys = Object.keys(primaryJson).sort();
  if (primaryKeys.length) {
    project.primaryLabels = Object.fromEntries(primaryKeys.map((k) => [k, primaryJson[k]]));
  }

  const constantList = sortedValues<ProjectConstant>(constants, "value", "number").map((c) =>
    inOrder<ProjectConstant>(c as unknown as Record<string, unknown>, CONSTANT_FIELDS)
  );
  if (constantList.length) project.constants = constantList;

  const claimList = sortedValues<ProjectClaim>(claims, "at", "number").map((c) =>
    inOrder<ProjectClaim>(c as unknown as Record<string, unknown>, CLAIM_FIELDS)
  );
  if (claimList.length) project.claims = claimList;

  const decoderList = sortedValues<ProjectDecoder>(decoders, "name", "text").map((d) =>
    inOrder<ProjectDecoder>(d as unknown as Record<string, unknown>, DECODER_FIELDS)
  );
  if (decoderList.length) project.decoders = decoderList;

  // By name, like decoders and constants: an id sorts by nothing a reader cares
  // about, and a `.re64` should read the way somebody would have written it.
  const typeList = sortedValues<ProjectType>(types, "name", "text").map((t) => {
    const ordered = inOrder<ProjectType>(t as unknown as Record<string, unknown>, TYPE_FIELDS);
    // The document keys fields by id; the projection is a list in layout order,
    // because that is how a record reads and because an offset-keyed object
    // cannot hold two fields at one offset — which is now a legal state.
    // `toJSON` on the outer map already turned each nested field map into a
    // plain object, so this only has to drop the keying and put them in order.
    const held = ordered.fields as unknown as Record<string, ProjectField>;
    return { ...ordered, fields: Object.values(held ?? {}).sort(byOffset) };
  });
  if (typeList.length) project.types = typeList;

  const fileList = sortedValues<ProjectFile>(files, "name", "text").map((f) =>
    inOrder<ProjectFile>(f as unknown as Record<string, unknown>, FILE_FIELDS)
  );
  if (fileList.length) project.files = fileList;

  const targetList = sortedValues<ProjectTarget>(targets, "name", "text").map((t) =>
    inOrder<ProjectTarget>(t as unknown as Record<string, unknown>, TARGET_FIELDS)
  );
  if (targetList.length) project.targets = targetList;

  // Steps come back out of the one JSON value they went in as.
  const scenarioList = sortedValues<Record<string, unknown>>(
    doc.getMap<Y.Map<unknown>>(ROOT_SCENARIOS),
    "name",
    "text"
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
    "file",
    "text"
  ).map((c) => inOrder<ProjectCapture>(c as unknown as Record<string, unknown>, CAPTURE_FIELDS));
  if (captureList.length) project.captures = captureList;

  const evidenceList = sortedValues<ProjectEvidence>(
    doc.getMap<Y.Map<unknown>>(ROOT_EVIDENCE),
    "claim",
    "text"
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
/**
 * How a root's sort key is read: as a number, or as text.
 *
 * **Declared per root rather than decided per pair**, which is the whole of the
 * fix. Choosing from the values in hand makes the comparator non-transitive as
 * soon as one of them does not parse — `"9"` before `"$10"` numerically, `"$10"`
 * before `"$ZZ"` as text, `"$ZZ"` before `"9"` as text — and a comparator with a
 * cycle in it sorts to whatever order it started from, which is the defect this
 * is repairing rather than a smaller version of it.
 *
 * A root knows which it is: an address, a start, a value and a claim's `at` are
 * numbers, and a name, a filename and a referenced id are text. Nothing has to
 * guess.
 */
type SortKind = "number" | "text";

function sortedValues<T>(
  map: Y.Map<Y.Map<unknown>>,
  key: string,
  kind: SortKind
): T[] {
  const parseAddress = (value: unknown): number => {
    if (typeof value === "number") return value;
    const text = String(value ?? "").trim();
    if (text.startsWith("$")) return parseInt(text.slice(1), 16);
    if (text.startsWith("0x")) return parseInt(text.slice(2), 16);
    return parseInt(text, 10);
  };

  // **Code units, not `localeCompare`.** Two peers must project a document to
  // the same bytes, and the version hash is taken over that projection — so an
  // order that depends on the reader's locale, or on which ICU their runtime
  // ships, makes equal state produce unequal versions on different machines.
  const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

  return [...map.values()]
    .map((entry) => entry.toJSON() as T)
    .sort((a, b) => {
      const left = (a as Record<string, unknown>)[key];
      const right = (b as Record<string, unknown>)[key];

      // This parsed every sort key as a number, and seven of the roots sort by
      // one that is not: decoder, type, target and scenario names, a capture's
      // filename, a piece of evidence's claim id. `parseInt("Alpha")` is `NaN`,
      // `NaN - NaN` is `NaN`, and `NaN !== 0` is **true** — so the comparator
      // returned `NaN`, the id tiebreaker below was never reached, and those
      // arrays kept whatever order the map happened to be built in. Two peers
      // that added the same two decoders in different orders projected them
      // differently, for ever.
      //
      // That is not only a cosmetic difference in the file. The version hash is
      // taken over the projection, so equal logical state did not determine
      // equal versions.
      let delta: number;
      if (kind === "number") {
        const byNumber = parseAddress(left) - parseAddress(right);
        // A number that does not parse cannot order against one that does. It
        // sorts as text among its own kind and after every real number, rather
        // than silently landing wherever `NaN` puts it.
        delta = Number.isNaN(byNumber)
          ? Number.isNaN(parseAddress(left)) && Number.isNaN(parseAddress(right))
            ? byText(String(left ?? ""), String(right ?? ""))
            : Number.isNaN(parseAddress(left))
              ? 1
              : -1
          : byNumber;
      } else {
        delta = byText(String(left ?? ""), String(right ?? ""));
      }

      return delta !== 0 ? delta : byText(String((a as { id?: string }).id), String((b as { id?: string }).id));
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

/**
 * Bring a stored document up to the shape the operations expect.
 *
/**
 * Bring a stored document up to the shape the operations expect.
 *
 * `docFromProject` never sees a stored document — a store restores a snapshot
 * plus its updates directly — so a migration done at the file boundary does
 * nothing for it, and a `.re64db` written yesterday keeps yesterday's shape and
 * yesterday's defects. Two shapes have changed:
 *
 * **Fields were keyed by offset, as plain objects.** The projection dropped the
 * offsets, and `field.set` and `field.remove` looked up ids that were not keys
 * and did nothing. Each becomes a map of its own under its id, carrying the
 * offset it was keyed by; one without an id is derived from the type id and the
 * offset, the way `fieldsOfType` derives it, so the same legacy field reached
 * through the file and through the store is one identity.
 *
 * **Bindings were keyed by use id.** Binding again added a second entry beside
 * the id-keyed one, and unbinding removed the new entry and left the old — the
 * R4 behaviour exactly, on every upgraded project. Each use moves under the
 * site it names. Where a legacy map holds two at one site, **the use whose id
 * sorts last is kept**, because that is the one every view was already showing:
 * the loaded index kept whichever sorted last by id. The migration preserves
 * the answer readers had rather than changing it, and it is the only
 * deterministic choice available, since the records carry no time.
 *
 * Idempotent: anything already in the new shape is left exactly where it is.
 * Returns whether anything moved, because the caller has to persist a migration
 * that did — a later operation names items this created, and if they are not in
 * the log the next load cannot find them.
 */
export function migrateDoc(doc: Y.Doc): boolean {
  let moved = false;
  const asMap = (held: Record<string, unknown>): Y.Map<unknown> => {
    const inner = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(held)) if (v !== undefined) inner.set(k, v);
    return inner;
  };

  doc.transact(() => {
    for (const [typeId, entry] of doc.getMap<Y.Map<unknown>>(ROOT_TYPES).entries()) {
      const fields = entry.get("fields");
      if (!(fields instanceof Y.Map)) continue;
      const legacy = [...fields.entries()].filter(([key, value]) => {
        if (!(value instanceof Y.Map)) return true;
        return value.get("id") !== key || typeof value.get("offset") !== "number";
      });
      for (const [key, value] of legacy) {
        const held = (value instanceof Y.Map ? value.toJSON() : value) as Record<string, unknown>;
        const offset = typeof held.offset === "number" ? held.offset : Number(key);
        const id = typeof held.id === "string" ? held.id : derivedId("fld", typeId, offset);
        fields.delete(key);
        fields.set(id, asMap({ ...held, id, offset }));
        moved = true;
      }
    }

    for (const layer of doc.getArray<Y.Map<unknown>>(ROOT_LAYERS).toArray()) {
      for (const root of ["constantUses", "labelUses"] as const) {
        const uses = layer.get(root);
        if (!(uses instanceof Y.Map)) continue;
        const idOf = (v: unknown): string =>
          String(v instanceof Y.Map ? v.get("id") : ((v as { id?: string })?.id ?? ""));
        const legacy = [...uses.entries()]
          .filter(([key, value]) => {
            if (!(value instanceof Y.Map)) return true;
            const address = value.get("address") as number | string | undefined;
            return address === undefined || key !== siteKey(address);
          })
          // Set in id order, so where two share a site the last id wins.
          .sort(([, a], [, b]) => (idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0));
        for (const [key, value] of legacy) {
          const held = (value instanceof Y.Map ? value.toJSON() : value) as Record<string, unknown>;
          uses.delete(key);
          if (held.address === undefined) continue;
          uses.set(siteKey(held.address as number | string), asMap(held));
          moved = true;
        }
      }
    }
  }, "migrate");
  return moved;
}

/** The whole document as one update, for sending or storing. */
export function encodeDoc(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

/**
 * Where a document has got to, for asking what has happened since.
 *
 * The pair below is how a replica gets **its own echo**: take a state vector,
 * make the write, then apply the delta. Re-applying the same operation to two
 * documents instead would make two independent CRDT items for one map key, and
 * a delete of one would not touch the other — which is exactly how an undo
 * stopped reaching a session's own copy.
 */
export function stateVectorOf(doc: Y.Doc): Uint8Array {
  return Y.encodeStateVector(doc);
}

/** Everything this document has that the given state vector does not. */
export function updateSince(doc: Y.Doc, since: Uint8Array): Uint8Array {
  return Y.encodeStateAsUpdate(doc, since);
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
