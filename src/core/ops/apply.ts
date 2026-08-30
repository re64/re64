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
  ProjectLabel,
  ProjectRegion,
  parseProject,
  parseProjectAddress,
} from "../project/project.js";
import {
  deleteComment,
  deleteLabel,
  deleteRegion,
  setPrimaryLabel,
  upsertComment,
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

function findComment(project: Project, id: string): Found<ProjectComment> | undefined {
  for (const [layerIndex, layer] of project.layers.entries()) {
    const entry = layer.comments?.find((c) => c.id === id);
    if (entry) return { layerIndex, entry };
  }
  return undefined;
}

const addressHex = (n: number) => "$" + n.toString(16).toUpperCase().padStart(4, "0");

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
        layerIndexOf(project, op.layerId)
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
      });

    case "comment.delete":
      return deleteComment(raw, layerIndexOf(project, op.layerId), op.id);

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
