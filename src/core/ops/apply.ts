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
  linksAsWritten,
} from "../project/project.js";
import {
  bindConstant,
  bindLabel,
  deleteComment,
  deleteConstant,
  deleteDecoder,
  deleteType,
  insertLayer,
  removeLayer,
  setPrimaryLabel,
  setProjectMeta,
  unbindConstant,
  unbindLabel,
  upsertComment,
  upsertFile,
  deleteFile,
  upsertTarget,
  deleteTarget,
  upsertConstant,
  upsertDecoder,
  upsertType,
  upsertClaim,
  deleteClaim,
} from "../project/serialize.js";
import { ClaimEdit, Op, TypeSetOp } from "./types.js";
import { Claim } from "../claims/model.js";
import { ProjectClaim, projectClaims } from "../project/project.js";

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
    ...(claim.by.confidence !== undefined ? { confidence: claim.by.confidence } : {}),
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
export function applyOp(raw: string, op: Op): string {
  const project = parseProject(raw);

  switch (op.op) {
    case "comment.set":
      return upsertComment(raw, layerIndexOf(project, op.layerId), {
        id: op.id,
        address: addressHex(op.address),
        // "before" is the default and is written by absence, so a flatten
        // produces the same text a hand-written file would.
        ...(op.placement === "before" ? {} : { placement: op.placement }),
        text: op.text,
        ...(op.order === undefined ? {} : { order: op.order }),
      });

    case "comment.delete":
      return deleteComment(raw, layerIndexOf(project, op.layerId), op.id);

    case "meta.set":
      return setProjectMeta(raw, op.key, op.value);

    case "file.add":
      return upsertFile(raw, { name: op.name, hash: op.hash, size: op.size });

    case "file.remove":
      return deleteFile(raw, op.name);

    case "target.set":
      return upsertTarget(raw, {
        name: op.name,
        layers: op.layers,
        ...(op.entryPoints === undefined ? {} : { entryPoints: op.entryPoints }),
      });

    case "target.remove":
      return deleteTarget(raw, op.name);

    case "label.bind":
      return bindLabel(raw, layerIndexOf(project, op.layerId), {
        id: op.id,
        address: addressHex(op.address),
        label: op.labelId,
      });

    case "label.unbind":
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

    case "constant.set":
      return upsertConstant(raw, { id: op.id, name: op.name, value: addressHex8(op.value) });

    case "constant.delete":
      return deleteConstant(raw, op.id);

    case "decoder.set":
      return upsertDecoder(raw, { id: op.id, name: op.name, source: op.source });

    case "decoder.delete":
      return deleteDecoder(raw, op.id);

    case "type.set":
      return upsertType(raw, {
        id: op.id,
        name: op.name,
        size: op.size,
        fields: Object.fromEntries(
          Object.entries(op.fields).map(([offset, field]) => [String(offset), field])
        ),
      });

    case "type.delete":
      return deleteType(raw, op.id);

    case "constant.bind":
      return bindConstant(raw, layerIndexOf(project, op.layerId), {
        id: op.id,
        address: addressHex(op.address),
        constant: op.constantId,
      });

    case "constant.unbind":
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
        },
        op.index
      );

    case "layer.remove":
      return removeLayer(raw, op.id);

    case "primary.set":
      return setPrimaryLabel(raw, op.address, op.labelId);

    case "primary.clear":
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
    case "comment.set": {
      const found = findComment(project, op.id);
      // Setting an id that does not exist creates it, so its inverse deletes.
      if (!found) return { op: "comment.delete", id: op.id, layerId: op.layerId };
      return {
        op: "comment.set",
        id: op.id,
        layerId: project.layers[found.layerIndex].id!,
        address: parseProjectAddress(found.entry.address),
        placement: found.entry.placement ?? "before",
        text: found.entry.text,
      };
    }

    case "comment.delete": {
      const found = findComment(project, op.id);
      // Deleting something absent is a no-op, and so is undoing it.
      if (!found) return op;
      return {
        op: "comment.set",
        id: op.id,
        layerId: project.layers[found.layerIndex].id!,
        address: parseProjectAddress(found.entry.address),
        placement: found.entry.placement ?? "before",
        text: found.entry.text,
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

    case "target.set": {
      const held = project.targets?.find((t) => t.name === op.name);
      return held
        ? {
            op: "target.set",
            name: held.name,
            layers: linksAsWritten(targetLinks(held)),
            ...(held.entryPoints === undefined
              ? {}
              : { entryPoints: held.entryPoints.map((a) => parseProjectAddress(a)) }),
          }
        : { op: "target.remove", name: op.name };
    }

    case "target.remove": {
      const held = project.targets?.find((t) => t.name === op.name);
      if (!held) return { op: "target.remove", name: op.name };
      return {
        op: "target.set",
        name: held.name,
        layers: linksAsWritten(targetLinks(held)),
        ...(held.entryPoints === undefined
          ? {}
          : { entryPoints: held.entryPoints.map((a) => parseProjectAddress(a)) }),
      };
    }

    case "label.bind": {
      const found = findLabelUse(project, op.id);
      if (!found) return { op: "label.unbind", id: op.id, layerId: op.layerId };
      return {
        op: "label.bind",
        id: op.id,
        layerId: project.layers[found.layerIndex].id!,
        address: parseProjectAddress(found.entry.address),
        labelId: found.entry.label,
      };
    }

    case "label.unbind": {
      const found = findLabelUse(project, op.id);
      if (!found) return op;
      return {
        op: "label.bind",
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

    case "constant.set": {
      const found = project.constants?.find((c) => c.id === op.id);
      if (!found) return { op: "constant.delete", id: op.id };
      return {
        op: "constant.set",
        id: op.id,
        name: found.name,
        value: parseProjectAddress(found.value),
      };
    }

    case "constant.delete": {
      const found = project.constants?.find((c) => c.id === op.id);
      if (!found) return op;
      return {
        op: "constant.set",
        id: op.id,
        name: found.name,
        value: parseProjectAddress(found.value),
      };
    }

    case "decoder.set": {
      const found = project.decoders?.find((d) => d.id === op.id);
      // Undoing the creation of a decoder is removing it; undoing an edit is
      // putting the old source back.
      if (!found) return { op: "decoder.delete", id: op.id };
      return { op: "decoder.set", id: op.id, name: found.name, source: found.source };
    }

    case "decoder.delete": {
      const found = project.decoders?.find((d) => d.id === op.id);
      if (!found) return op;
      return { op: "decoder.set", id: op.id, name: found.name, source: found.source };
    }

    case "type.set": {
      const found = project.types?.find((t) => t.id === op.id);
      // Undoing a declaration is removing it; undoing a revision is putting the
      // previous layout back.
      if (!found) return { op: "type.delete", id: op.id };
      return typeSetOpFor(found);
    }

    case "type.delete": {
      const found = project.types?.find((t) => t.id === op.id);
      if (!found) return op;
      return typeSetOpFor(found);
    }

    case "constant.bind": {
      const found = findConstantUse(project, op.id);
      if (!found) return { op: "constant.unbind", id: op.id, layerId: op.layerId };
      return {
        op: "constant.bind",
        id: op.id,
        layerId: project.layers[found.layerIndex].id!,
        address: parseProjectAddress(found.entry.address),
        constantId: found.entry.constant,
      };
    }

    case "constant.unbind": {
      const found = findConstantUse(project, op.id);
      if (!found) return op;
      return {
        op: "constant.bind",
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

    case "primary.set":
    case "primary.clear": {
      const previous = project.primaryLabels?.[addressHex(op.address)];
      return previous === undefined
        ? { op: "primary.clear", address: op.address }
        : { op: "primary.set", address: op.address, labelId: previous };
    }
  }
}

/** Apply a list of operations in order. */
export function applyOps(raw: string, ops: readonly Op[]): string {
  return ops.reduce(applyOp, raw);
}

/** A stored type, as the operation that would recreate it. */
function typeSetOpFor(found: ProjectType): Op {
  return {
    op: "type.set",
    id: found.id!,
    size: typeof found.size === "string" ? parseProjectAddress(found.size) : found.size,
    name: found.name,
    fields: Object.fromEntries(
      Object.entries(found.fields).map(([offset, field]) => [Number(offset), field])
    ) as TypeSetOp["fields"],
  };
}
