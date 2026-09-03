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
  Project,
  ProjectComment,
  ProjectConstantUse,
  ProjectLabel,
  ProjectLabelUse,
  ProjectRegion,
  parseProject,
  parseProjectAddress,
} from "../project/project.js";
import {
  bindConstant,
  bindLabel,
  deleteComment,
  deleteConstant,
  deleteDecoder,
  deleteLabel,
  deleteRegion,
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
  upsertLabel,
  upsertRegion,
} from "../project/serialize.js";
import { Op } from "./types.js";

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

/** Apply one operation, returning the updated project text. */
export function applyOp(raw: string, op: Op): string {
  const project = parseProject(raw);

  switch (op.op) {
    case "label.set":
      return upsertLabel(
        raw,
        op.id,
        op.address,
        op.name,
        op.type,
        layerIndexOf(project, op.layerId),
        op.extent
      );

    case "label.delete":
      return deleteLabel(raw, op.id, layerIndexOf(project, op.layerId));

    case "region.set":
      return upsertRegion(raw, layerIndexOf(project, op.layerId), {
        id: op.id,
        start: op.start,
        end: op.end,
        kind: op.kind,
        name: op.name,
        comment: op.comment,
        encoding: op.encoding,
        view: op.view,
      });

    case "region.delete":
      return deleteRegion(raw, layerIndexOf(project, op.layerId), op.id);

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

    case "constant.set":
      return upsertConstant(raw, { id: op.id, name: op.name, value: addressHex8(op.value) });

    case "constant.delete":
      return deleteConstant(raw, op.id);

    case "decoder.set":
      return upsertDecoder(raw, { id: op.id, name: op.name, source: op.source });

    case "decoder.delete":
      return deleteDecoder(raw, op.id);

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
    case "label.set": {
      const found = findLabel(project, op.id);
      // Setting an id that does not exist creates it, so its inverse deletes.
      if (!found) return { op: "label.delete", id: op.id, layerId: op.layerId };
      return {
        op: "label.set",
        id: op.id,
        layerId: project.layers[found.layerIndex].id!,
        address: parseProjectAddress(found.entry.address),
        name: found.entry.name,
        // Absent means "address"; passing undefined would leave whatever type
        // the op set in place instead of clearing it.
        type: found.entry.type ?? "address",
        extent: found.entry.extent,
      };
    }

    case "label.delete": {
      const found = findLabel(project, op.id);
      // Deleting something absent is a no-op, and so is undoing it.
      if (!found) return op;
      return {
        op: "label.set",
        id: op.id,
        layerId: project.layers[found.layerIndex].id!,
        address: parseProjectAddress(found.entry.address),
        name: found.entry.name,
        // Absent means "address"; passing undefined would leave whatever type
        // the op set in place instead of clearing it.
        type: found.entry.type ?? "address",
      };
    }

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
            layers: held.layers,
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
        layers: held.layers,
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

    case "region.set": {
      const found = findRegion(project, op.id);
      if (!found) return { op: "region.delete", id: op.id, layerId: op.layerId };
      return {
        op: "region.set",
        id: op.id,
        layerId: project.layers[found.layerIndex].id!,
        start: parseProjectAddress(found.entry.start),
        end: parseProjectAddress(found.entry.end),
        kind: found.entry.kind,
        name: found.entry.name,
        comment: found.entry.comment,
        encoding: found.entry.encoding,
        view: found.entry.view,
      };
    }

    case "region.delete": {
      const found = findRegion(project, op.id);
      if (!found) return op;
      return {
        op: "region.set",
        id: op.id,
        layerId: project.layers[found.layerIndex].id!,
        start: parseProjectAddress(found.entry.start),
        end: parseProjectAddress(found.entry.end),
        kind: found.entry.kind,
        name: found.entry.name,
        comment: found.entry.comment,
        encoding: found.entry.encoding,
        view: found.entry.view,
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
