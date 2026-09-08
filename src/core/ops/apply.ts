/**
 * Applying operations to project text, and computing their inverses.
 *
 * Text rather than the parsed object, so the line-preserving serializer keeps
 * doing its job: a rename stays a one-line diff and the blank lines that group
 * labels survive. Round-tripping through `JSON.stringify` would undo all of it.
 *
 * An inverse is computed against the state *before* the op is applied, because
 * that is the only moment the previous value still exists. Applying an op and
 * its inverse in sequence returns the exact original text — which is what makes
 * undo trustworthy rather than approximate.
 */

import {
  ProjectType,
  Project,
  ProjectComment,
  ProjectConstantUse,
  ProjectLabel,
  ProjectLabelUse,
  ProjectRegion,
  parseProject,
  parseProjectAddress,
  targetLinks,
} from "../project/project.js";
import {
  bindConstant,
  bindLabel,
  deleteComment,
  deleteConstant,
  deleteDecoder,
  deleteType,
  upsertScenario,
  deleteScenario,
  upsertCapture,
  deleteCapture,
  upsertEvidence,
  deleteEvidence,
  insertLayer,
  removeLayer,
  renameLayer,
  setPrimaryLabel,
  setProjectMeta,
  unbindConstant,
  unbindLabel,
  upsertComment,
  upsertFile,
  deleteFile,
  addTarget,
  setTarget,
  deleteTarget,
  upsertConstant,
  upsertDecoder,
  upsertType,
  upsertClaim,
  deleteClaim,
} from "../project/serialize.js";
import { ClaimEdit, EvidenceSetOp, Op, TypeAddOp, TypeField } from "./types.js";
import { Claim } from "../claims/model.js";
import { ProjectClaim, ProjectEvidence, ProjectField, projectClaims } from "../project/project.js";

/** Position of a layer in the project, by id. */
function layerIndexOf(project: Project, layerId: string): number {
  const index = project.layers.findIndex((l) => l.id === layerId);
  if (index < 0) throw new Error(`No layer with id ${layerId}`);
  return index;
}

interface Found<T> {
  layerIndex: number;
  entry: T;
}

function findLabel(project: Project, id: string): Found<ProjectLabel> | undefined {
  for (const [layerIndex, layer] of project.layers.entries()) {
    const entry = layer.labels?.find((l) => l.id === id);
    if (entry) return { layerIndex, entry };
  }
  return undefined;
}

function findRegion(project: Project, id: string): Found<ProjectRegion> | undefined {
  for (const [layerIndex, layer] of project.layers.entries()) {
    const entry = layer.regions?.find((r) => r.id === id);
    if (entry) return { layerIndex, entry };
  }
  return undefined;
}

function findLabelUse(project: Project, id: string): Found<ProjectLabelUse> | undefined {
  for (const [layerIndex, layer] of project.layers.entries()) {
    const entry = layer.labelUses?.find((u) => u.id === id);
    if (entry) return { layerIndex, entry };
  }
  return undefined;
}

function findConstantUse(
  project: Project,
  id: string
): Found<ProjectConstantUse> | undefined {
  for (const [layerIndex, layer] of project.layers.entries()) {
    const entry = layer.constantUses?.find((u) => u.id === id);
    if (entry) return { layerIndex, entry };
  }
  return undefined;
}

function findComment(project: Project, id: string): Found<ProjectComment> | undefined {
  for (const [layerIndex, layer] of project.layers.entries()) {
    const entry = layer.comments?.find((c) => c.id === id);
    if (entry) return { layerIndex, entry };
  }
  return undefined;
}

const addressHex = (n: number) => "$" + n.toString(16).toUpperCase().padStart(4, "0");
/** A constant's value is one byte, so it reads as two digits rather than four. */
const addressHex8 = (n: number) => "$" + n.toString(16).toUpperCase().padStart(2, "0");

/**
 * A claim as the file writes it: flat, so a diff touches one key.
 *
 * The same shape the CRDT encodes, deliberately — one representation for the
 * file and the document is one that cannot drift.
 */
function projectClaimOf(claim: Claim): ProjectClaim {
  return {
    id: claim.id,
    at: addressHex(claim.at),
    ...(claim.extent !== undefined ? { extent: claim.extent } : {}),
    // In `CLAIM_FIELDS` order, which is what makes replaying an operation
    // forward a no-op — and undo checks exactly that before trusting a stored
    // inverse. `layer` sat after `name` here and nothing noticed, because
    // nothing set a frame until claims were scoped.
    ...(claim.frame?.space === "layer" ? { layer: claim.frame.layer } : {}),
    ...(claim.frame?.space === "target" ? { target: claim.frame.target } : {}),
    ...(claim.name !== undefined ? { name: claim.name } : {}),
    ...(claim.says ? { is: claim.says.is } : {}),
    ...(claim.says?.is === "text" && claim.says.encoding
      ? { encoding: claim.says.encoding }
      : {}),
    ...(claim.says?.is === "bitmap" && claim.says.view ? { view: claim.says.view } : {}),
    // Text carries a view too — a program's own character set is unreadable by
    // any built-in encoding, so `snippet:<id>` is the only way such a span is
    // legible — and this only ever wrote the bitmap one.
    ...(claim.says?.is === "text" && claim.says.view ? { view: claim.says.view } : {}),
    ...(claim.says?.is === "record" ? { typeId: claim.says.typeId } : {}),
    ...(claim.root !== undefined ? { root: claim.root } : {}),
    ...(claim.description !== undefined ? { description: claim.description } : {}),
    author: claim.by.author,
    source: claim.by.source,
    ...(claim.by.when !== undefined ? { when: claim.by.when } : {}),
    ...(claim.by.method !== undefined ? { method: claim.by.method } : {}),
  };
}

/** The other direction, reusing the loader's own parser so both agree. */
function claimOf(stored: ProjectClaim): Claim {
  return projectClaims([stored])[0];
}

/** Every settable field of a stored claim, in `ClaimEdit` terms. */
function fieldsOf(stored: ProjectClaim): ClaimEdit {
  const { id: _id, ...rest } = claimOf(stored);
  return rest as ClaimEdit;
}

/**
 * A stored claim with an edit applied.
 *
 * `null` clears, an absent key is left alone. Nothing else expresses both, and
 * both are needed: `runOps` inverts every write, and the inverse of setting a
 * field that was absent is clearing it.
 */
/**
 * Every editable field of a claim, with `null` where it has none.
 *
 * The exact-restore form. `fieldsOf` says "these are its fields", which is what
 * a partial revision needs; this says "this is the whole of it", which is what
 * replacing one and taking that back needs.
 */
function allFieldsOf(stored: ProjectClaim): ClaimEdit {
  const present = fieldsOf(stored) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of EDITABLE) out[key] = key in present ? present[key] : null;
  return out as ClaimEdit;
}

const EDITABLE = ["at", "frame", "extent", "name", "says", "root", "description", "by"] as const;

function editedClaim(stored: ProjectClaim, fields: ClaimEdit): ProjectClaim {
  const next: Record<string, unknown> = { ...claimOf(stored) };
  for (const [key, value] of Object.entries(fields)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return projectClaimOf(next as unknown as Claim);
}

/** Apply one operation, returning the updated project text. */
/**
 * What a partial `set` is revising, or a refusal that says which id was wrong.
 *
 * The text path has to materialise a merge the document does structurally, so
 * every `set` reads the record first. A missing id is a fact about the request,
 * which is one of the two things a write may legitimately refuse on.
 */
function held0<T extends { id?: string }>(
  held: readonly T[] | undefined,
  id: string,
  noun: string,
  shown: string
): T {
  const found = held?.find((x) => x.id === id);
  if (!found) throw new Error(`No ${noun} ${shown} in this project.`);
  return found;
}

export function applyOp(raw: string, op: Op): string {
  const project = parseProject(raw);

  switch (op.op) {
    case "comment.add":
      return upsertComment(raw, layerIndexOf(project, op.layerId), {
        id: op.id,
        address: addressHex(op.address),
        // "before" is the default and is written by absence, so a flatten
        // produces the same text a hand-written file would.
        ...(op.placement === "before" ? {} : { placement: op.placement }),
        text: op.text,
        ...(op.order === undefined ? {} : { order: op.order }),
      });

    // A partial write, materialised. The op carries only what changed — which
    // is what lets two peers revise different fields of one comment and both
    // survive — so the text path reads what is there and merges. Every `set`
    // below has the same shape for the same reason.
    case "comment.set": {
      const index = layerIndexOf(project, op.layerId);
      const held = held0(project.layers[index].comments, op.id, "comment", op.id);
      const placement = op.fields.placement ?? held.placement ?? "before";
      const order = op.fields.order === null ? undefined : op.fields.order ?? held.order;
      return upsertComment(raw, index, {
        id: op.id,
        address: addressHex(
          op.fields.address ?? (typeof held.address === "number" ? held.address : parseInt(String(held.address).replace(/^\$/, ""), 16))
        ),
        ...(placement === "before" ? {} : { placement }),
        text: op.fields.text ?? held.text,
        ...(order === undefined ? {} : { order }),
      });
    }

    case "comment.remove":
      return deleteComment(raw, layerIndexOf(project, op.layerId), op.id);

    case "meta.set":
      return setProjectMeta(raw, op.key, op.value);

    case "file.add":
      return upsertFile(raw, { name: op.name, hash: op.hash, size: op.size });

    case "file.remove":
      return deleteFile(raw, op.name);

    case "target.add":
      return addTarget(raw, {
        id: op.id,
        name: op.name,
        ...(op.layers === undefined ? {} : { layers: op.layers }),
        ...(op.entryPoints === undefined ? {} : { entryPoints: op.entryPoints }),
        ...(op.order === undefined ? {} : { order: op.order }),
        ...(op.description === undefined ? {} : { description: op.description }),
      });

    case "target.set":
      return setTarget(raw, op.id, op.fields);

    case "target.remove":
      return deleteTarget(raw, op.id);

    case "labelUse.bind":
      return bindLabel(raw, layerIndexOf(project, op.layerId), {
        id: op.id,
        address: addressHex(op.address),
        label: op.labelId,
      });

    case "labelUse.unbind":
      return unbindLabel(raw, layerIndexOf(project, op.layerId), op.id);

    case "claim.add":
      return upsertClaim(raw, projectClaimOf(op.claim));

    case "claim.set": {
      const found = project.claims?.find((c) => c.id === op.id);
      if (!found) return raw;
      return upsertClaim(raw, editedClaim(found, op.fields));
    }

    case "claim.remove":
      return deleteClaim(raw, op.id);

    case "constant.add":
      return upsertConstant(raw, { id: op.id, name: op.name, value: addressHex8(op.value) });

    case "constant.set": {
      const held = held0(project.constants, op.id, "constant", op.id);
      const value =
        op.fields.value ??
        (typeof held.value === "number" ? held.value : parseInt(String(held.value).replace(/^\$/, ""), 16));
      return upsertConstant(raw, {
        id: op.id,
        name: op.fields.name ?? held.name,
        value: addressHex8(value),
      });
    }

    case "constant.remove":
      return deleteConstant(raw, op.id);

    case "decoder.add":
      return upsertDecoder(raw, { id: op.id, name: op.name, source: op.source });

    case "decoder.set": {
      const held = held0(project.decoders, op.id, "decoder", op.id);
      return upsertDecoder(raw, {
        id: op.id,
        name: op.fields.name ?? held.name,
        source: op.fields.source ?? held.source,
      });
    }

    case "decoder.remove":
      return deleteDecoder(raw, op.id);

    case "type.add":
      return upsertType(raw, {
        id: op.id,
        name: op.name,
        size: op.size,
        ...(op.unit === undefined ? {} : { unit: op.unit }),
        fields: Object.fromEntries(
          Object.entries(op.fields).map(([offset, field]) => [String(offset), field])
        ),
      });

    // Fields merge **by offset**, and `null` at an offset removes that one.
    // Never a whole-map write: two people adding different fields to one record
    // touch different keys and both survive, which is the merge property the
    // offset keys exist for.
    case "type.set": {
      const held = held0(project.types, op.id, "type", op.id);
      const fields = { ...held.fields };
      for (const [offset, field] of Object.entries(op.fields.fields ?? {})) {
        if (field === null) delete fields[String(offset)];
        else fields[String(offset)] = field;
      }
      return upsertType(raw, {
        id: op.id,
        name: op.fields.name ?? held.name,
        size: op.fields.size ?? held.size,
        ...((op.fields.unit ?? held.unit) === undefined
          ? {}
          : { unit: op.fields.unit ?? held.unit }),
        fields,
      });
    }

    case "type.remove":
      return deleteType(raw, op.id);

    case "scenario.add":
      return upsertScenario(raw, {
        id: op.id,
        name: op.name,
        ...(op.description === undefined ? {} : { description: op.description }),
        steps: op.steps,
      });

    case "scenario.set": {
      const held = held0(project.scenarios, op.id, "scenario", op.id);
      const description =
        op.fields.description === null ? undefined : op.fields.description ?? held.description;
      return upsertScenario(raw, {
        id: op.id,
        name: op.fields.name ?? held.name,
        ...(description === undefined ? {} : { description }),
        steps: op.fields.steps ?? held.steps,
      });
    }

    case "scenario.remove":
      return deleteScenario(raw, op.id);

    case "capture.add":
      return upsertCapture(raw, {
        id: op.id,
        scenario: op.scenario,
        step: op.step,
        kind: op.kind,
        file: op.file,
        ...(op.when === undefined ? {} : { when: op.when }),
      });

    case "capture.set": {
      const held = held0(project.captures, op.id, "capture", op.id);
      const when = op.fields.when === null ? undefined : op.fields.when ?? held.when;
      return upsertCapture(raw, {
        ...held,
        id: op.id,
        file: op.fields.file ?? held.file,
        ...(when === undefined ? {} : { when }),
      });
    }

    case "capture.remove":
      return deleteCapture(raw, op.id);

    case "evidence.add":
      return upsertEvidence(raw, {
        id: op.id,
        claim: op.claim,
        kind: op.kind,
        ...(op.scenario === undefined ? {} : { scenario: op.scenario }),
        ...(op.capture === undefined ? {} : { capture: op.capture }),
        ...(op.other === undefined ? {} : { other: op.other }),
        ...(op.note === undefined ? {} : { note: op.note }),
      });

    case "evidence.set": {
      const held = held0(project.evidence, op.id, "evidence", op.id);
      const merged: Record<string, unknown> = { ...held };
      for (const [key, value] of Object.entries(op.fields)) {
        if (value === undefined) continue;
        if (value === null) delete merged[key];
        else merged[key] = value;
      }
      return upsertEvidence(raw, merged as unknown as ProjectEvidence);
    }

    case "evidence.remove":
      return deleteEvidence(raw, op.id);

    case "constantUse.bind":
      return bindConstant(raw, layerIndexOf(project, op.layerId), {
        id: op.id,
        address: addressHex(op.address),
        constant: op.constantId,
      });

    case "constantUse.unbind":
      return unbindConstant(raw, layerIndexOf(project, op.layerId), op.id);

    case "layer.add":
      return insertLayer(
        raw,
        {
          id: op.id,
          type: op.layerType,
          name: op.name,
          ...(op.path === undefined ? {} : { path: op.path }),
          ...(op.address === undefined ? {} : { address: addressHex(op.address) }),
          // A byte layer's contents come from its file; only a symbols layer
          // starts with an empty label list to put names in.
          ...(op.layerType === "symbols" ? { labels: [] } : {}),
          ...(op.rom === undefined ? {} : { rom: op.rom }),
          ...(op.bytes === undefined ? {} : { bytes: op.bytes }),
          ...(op.length === undefined ? {} : { length: op.length }),
        },
        op.index
      );

    case "layer.set": {
      const index = project.layers.findIndex((l) => l.id === op.id);
      if (index < 0) throw new Error(`No layer ${op.id} in this project.`);
      return renameLayer(raw, index, op.fields.name ?? project.layers[index].name ?? "");
    }

    case "layer.remove":
      return removeLayer(raw, op.id);

    case "primary.bind":
      return setPrimaryLabel(raw, op.address, op.labelId);

    case "primary.unbind":
      return setPrimaryLabel(raw, op.address, undefined);
  }
}

/**
 * The operation that undoes `op`, computed against the current text.
 *
 * Must be called before applying `op`: it reads the values the op is about to
 * overwrite.
 */
export function invertOp(raw: string, op: Op): Op {
  const project = parseProject(raw);

  switch (op.op) {
    // Adding inverts to removing, and revising inverts to revising back the
    // *same fields* — not to a whole-value write, or an undo would revert
    // fields the edit never touched.
    case "comment.add":
      return { op: "comment.remove", id: op.id, layerId: op.layerId };

    case "comment.set": {
      const found = findComment(project, op.id);
      if (!found) return op;
      const was = found.entry;
      return {
        op: "comment.set",
        id: op.id,
        layerId: project.layers[found.layerIndex].id!,
        fields: {
          ...(op.fields.address === undefined
            ? {}
            : { address: parseProjectAddress(was.address) }),
          ...(op.fields.placement === undefined
            ? {}
            : { placement: was.placement ?? "before" }),
          ...(op.fields.text === undefined ? {} : { text: was.text }),
          ...(op.fields.order === undefined ? {} : { order: was.order ?? null }),
        },
      };
    }

    case "comment.remove": {
      const found = findComment(project, op.id);
      // Removing something absent is a no-op, and so is undoing it.
      if (!found) return op;
      return {
        op: "comment.add",
        id: op.id,
        layerId: project.layers[found.layerIndex].id!,
        address: parseProjectAddress(found.entry.address),
        placement: found.entry.placement ?? "before",
        text: found.entry.text,
        ...(found.entry.order === undefined ? {} : { order: found.entry.order }),
      };
    }

    case "meta.set":
      return { op: "meta.set", key: op.key, value: project[op.key] };

    case "file.add": {
      const held = project.files?.find((f) => f.name === op.name);
      // Restoring the previous entry rather than removing, so re-adding a file
      // under a name already in use is undone to what was there before.
      return held
        ? { op: "file.add", name: held.name, hash: held.hash, size: held.size }
        : { op: "file.remove", name: op.name };
    }

    case "file.remove": {
      const held = project.files?.find((f) => f.name === op.name);
      if (!held) return { op: "file.remove", name: op.name };
      return { op: "file.add", name: held.name, hash: held.hash, size: held.size };
    }

    case "target.add":
      return project.targets?.some((t) => t.id === op.id)
        ? op
        : { op: "target.remove", id: op.id };

    case "target.set": {
      const held = project.targets?.find((t) => t.id === op.id);
      if (!held) return op;
      const f = op.fields;
      return {
        op: "target.set",
        id: op.id,
        fields: {
          ...(f.name === undefined ? {} : { name: held.name }),
          ...(f.layers === undefined ? {} : { layers: targetLinks(held) }),
          // `null` where the field was absent, so undoing "describe this"
          // removes the description rather than leaving an empty string.
          ...(f.entryPoints === undefined
            ? {}
            : {
                entryPoints: held.entryPoints
                  ? held.entryPoints.map((a) => parseProjectAddress(a))
                  : null,
              }),
          ...(f.order === undefined ? {} : { order: held.order ?? null }),
          ...(f.description === undefined ? {} : { description: held.description ?? null }),
        },
      };
    }

    case "target.remove": {
      const held = project.targets?.find((t) => t.id === op.id);
      if (!held) return op;
      return {
        op: "target.add",
        id: op.id,
        name: held.name,
        layers: targetLinks(held),
        ...(held.entryPoints === undefined
          ? {}
          : { entryPoints: held.entryPoints.map((a) => parseProjectAddress(a)) }),
        ...(held.order === undefined ? {} : { order: held.order }),
        ...(held.description === undefined ? {} : { description: held.description }),
      };
    }

    case "labelUse.bind": {
      const found = findLabelUse(project, op.id);
      if (!found) return { op: "labelUse.unbind", id: op.id, layerId: op.layerId };
      return {
        op: "labelUse.bind",
        id: op.id,
        layerId: project.layers[found.layerIndex].id!,
        address: parseProjectAddress(found.entry.address),
        labelId: found.entry.label,
      };
    }

    case "labelUse.unbind": {
      const found = findLabelUse(project, op.id);
      if (!found) return op;
      return {
        op: "labelUse.bind",
        id: op.id,
        layerId: project.layers[found.layerIndex].id!,
        address: parseProjectAddress(found.entry.address),
        labelId: found.entry.label,
      };
    }

    case "claim.add": {
      const found = project.claims?.find((c) => c.id === op.claim.id);
      // Adding one that is already there is a retry; undoing it must put the
      // old fields back rather than remove somebody else's claim.
      if (!found) return { op: "claim.remove", id: op.claim.id };
      // Every field, not only the ones the old claim had — with `null` for the
      // ones it did not. Restoring only what was present leaves behind whatever
      // the add *introduced*, so undoing an add that gave a claim a frame left
      // the frame in place and the claim resolved somewhere new.
      return { op: "claim.set", id: op.claim.id, fields: allFieldsOf(found) };
    }

    case "claim.set": {
      const found = project.claims?.find((c) => c.id === op.id);
      if (!found) return op;
      // Only the fields this edit named, restored to what they were — and
      // `null` where they were absent, which is the whole reason `ClaimEdit`
      // distinguishes "clear this" from "leave it alone". Without it the inverse
      // of setting a root on a claim that had none is unwritable.
      const before = fieldsOf(found);
      const restored: ClaimEdit = {};
      for (const key of Object.keys(op.fields) as (keyof ClaimEdit)[]) {
        (restored as Record<string, unknown>)[key] =
          (before as Record<string, unknown>)[key] ?? null;
      }
      return { op: "claim.set", id: op.id, fields: restored };
    }

    case "claim.remove": {
      const found = project.claims?.find((c) => c.id === op.id);
      if (!found) return op;
      return { op: "claim.add", claim: claimOf(found) };
    }

    case "constant.add":
      return { op: "constant.remove", id: op.id };

    case "constant.set": {
      const found = project.constants?.find((c) => c.id === op.id);
      if (!found) return op;
      return {
        op: "constant.set",
        id: op.id,
        fields: {
          ...(op.fields.name === undefined ? {} : { name: found.name }),
          ...(op.fields.value === undefined
            ? {}
            : { value: parseProjectAddress(found.value) }),
        },
      };
    }

    case "constant.remove": {
      const found = project.constants?.find((c) => c.id === op.id);
      if (!found) return op;
      return {
        op: "constant.add",
        id: op.id,
        name: found.name,
        value: parseProjectAddress(found.value),
      };
    }

    case "decoder.add":
      return { op: "decoder.remove", id: op.id };

    case "decoder.set": {
      const found = project.decoders?.find((d) => d.id === op.id);
      if (!found) return op;
      return {
        op: "decoder.set",
        id: op.id,
        fields: {
          ...(op.fields.name === undefined ? {} : { name: found.name }),
          ...(op.fields.source === undefined ? {} : { source: found.source }),
        },
      };
    }

    case "decoder.remove": {
      const found = project.decoders?.find((d) => d.id === op.id);
      if (!found) return op;
      return { op: "decoder.add", id: op.id, name: found.name, source: found.source };
    }

    case "type.add":
      return { op: "type.remove", id: op.id };

    case "type.set": {
      const found = project.types?.find((t) => t.id === op.id);
      if (!found) return op;
      // Per offset, so undoing a merge restores exactly the fields it touched:
      // one that was there comes back, one that was not is removed with `null`.
      const fields: Record<number, TypeField | null> = {};
      for (const offset of Object.keys(op.fields.fields ?? {})) {
        const was = found.fields[String(offset)];
        fields[Number(offset)] = was ? { ...was, id: was.id! } : null;
      }
      return {
        op: "type.set",
        id: op.id,
        fields: {
          ...(op.fields.name === undefined ? {} : { name: found.name }),
          ...(op.fields.size === undefined
            ? {}
            : { size: parseProjectAddress(found.size) }),
          ...(op.fields.fields === undefined ? {} : { fields }),
        },
      };
    }

    case "type.remove": {
      const found = project.types?.find((t) => t.id === op.id);
      if (!found) return op;
      return typeAddOpFor(found);
    }

    case "scenario.add":
      return { op: "scenario.remove", id: op.id };

    case "scenario.set": {
      const found = project.scenarios?.find((x) => x.id === op.id);
      if (!found) return op;
      return {
        op: "scenario.set",
        id: op.id,
        fields: {
          ...(op.fields.name === undefined ? {} : { name: found.name }),
          ...(op.fields.description === undefined
            ? {}
            : { description: found.description ?? null }),
          ...(op.fields.steps === undefined ? {} : { steps: found.steps }),
        },
      };
    }

    case "scenario.remove": {
      const found = project.scenarios?.find((x) => x.id === op.id);
      if (!found) return op;
      return {
        op: "scenario.add",
        id: op.id,
        name: found.name,
        ...(found.description === undefined ? {} : { description: found.description }),
        steps: found.steps,
      };
    }

    case "capture.add":
      return { op: "capture.remove", id: op.id };

    case "capture.set": {
      const found = project.captures?.find((x) => x.id === op.id);
      if (!found) return op;
      return {
        op: "capture.set",
        id: op.id,
        fields: {
          ...(op.fields.file === undefined ? {} : { file: found.file }),
          ...(op.fields.when === undefined ? {} : { when: found.when ?? null }),
        },
      };
    }

    case "evidence.add":
      return { op: "evidence.remove", id: op.id };

    case "evidence.set": {
      const found = project.evidence?.find((x) => x.id === op.id);
      if (!found) return op;
      const was = found as unknown as Record<string, unknown>;
      const fields: Record<string, unknown> = {};
      for (const key of Object.keys(op.fields)) {
        fields[key] = was[key] ?? null;
      }
      return { op: "evidence.set", id: op.id, fields: fields as EvidenceSetOp["fields"] };
    }

    case "evidence.remove": {
      const found = project.evidence?.find((x) => x.id === op.id);
      if (!found) return op;
      return {
        op: "evidence.add",
        id: op.id,
        claim: found.claim,
        kind: found.kind,
        ...(found.scenario === undefined ? {} : { scenario: found.scenario }),
        ...(found.capture === undefined ? {} : { capture: found.capture }),
        ...(found.other === undefined ? {} : { other: found.other }),
        ...(found.note === undefined ? {} : { note: found.note }),
      };
    }

    case "capture.remove": {
      const found = project.captures?.find((x) => x.id === op.id);
      if (!found) return op;
      return {
        op: "capture.add",
        id: op.id,
        scenario: found.scenario,
        step: found.step,
        kind: found.kind,
        file: found.file,
        ...(found.when === undefined ? {} : { when: found.when }),
      };
    }

    case "constantUse.bind": {
      const found = findConstantUse(project, op.id);
      if (!found) return { op: "constantUse.unbind", id: op.id, layerId: op.layerId };
      return {
        op: "constantUse.bind",
        id: op.id,
        layerId: project.layers[found.layerIndex].id!,
        address: parseProjectAddress(found.entry.address),
        constantId: found.entry.constant,
      };
    }

    case "constantUse.unbind": {
      const found = findConstantUse(project, op.id);
      if (!found) return op;
      return {
        op: "constantUse.bind",
        id: op.id,
        layerId: project.layers[found.layerIndex].id!,
        address: parseProjectAddress(found.entry.address),
        constantId: found.entry.constant,
      };
    }

    case "layer.add":
      // Adding a layer that is already there is a no-op, and so is undoing it.
      return project.layers.some((l) => l.id === op.id)
        ? op
        : { op: "layer.remove", id: op.id };

    case "layer.remove": {
      const index = project.layers.findIndex((l) => l.id === op.id);
      if (index < 0) return op;
      const layer = project.layers[index];
      return {
        op: "layer.add",
        id: op.id,
        // Only symbols layers can be added, so only those can be put back.
        layerType: "symbols",
        name: layer.name ?? op.id,
        index,
      };
    }

    case "layer.set": {
      const held = project.layers.find((l) => l.id === op.id);
      if (!held) return op;
      return {
        op: "layer.set",
        id: op.id,
        fields: { ...(op.fields.name === undefined ? {} : { name: held.name ?? "" }) },
      };
    }

    // Re-binding a key is how a binding is updated, so both invert the same
    // way: put back whatever the key held, or clear it if it held nothing.
    case "primary.bind":
    case "primary.unbind": {
      const previous = project.primaryLabels?.[addressHex(op.address)];
      return previous === undefined
        ? { op: "primary.unbind", address: op.address }
        : { op: "primary.bind", address: op.address, labelId: previous };
    }
  }
}

/** Apply a list of operations in order. */
export function applyOps(raw: string, ops: readonly Op[]): string {
  return ops.reduce(applyOp, raw);
}

/** A stored type, as the operation that would recreate it. */
function typeAddOpFor(found: ProjectType): Op {
  return {
    op: "type.add",
    id: found.id!,
    size: typeof found.size === "string" ? parseProjectAddress(found.size) : found.size,
    name: found.name,
    fields: Object.fromEntries(
      Object.entries(found.fields).map(([offset, field]) => [Number(offset), field])
    ) as TypeAddOp["fields"],
  };
}
