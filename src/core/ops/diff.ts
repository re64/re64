/**
 * The operations that turn one project into another.
 *
 * This is how a session is flattened. A shared document knows the *content* two
 * people converged on, but nothing about how the file was laid out — which
 * labels a blank line grouped, what order regions were declared in. Writing the
 * document out directly would replace a one-line edit with a whole-file diff.
 *
 * So instead the document is diffed against the file, and the resulting
 * operations are applied through the line-editing serializer, which touches
 * only the lines that actually changed.
 */

import {
  Project,
  ProjectComment,
  ProjectLabel,
  ProjectRegion,
  parseProjectAddress,
} from "../project/project.js";
import { Op } from "./types.js";

interface Owned<T> {
  layerId: string;
  entry: T;
}

function labelsById(project: Project): Map<string, Owned<ProjectLabel>> {
  const out = new Map<string, Owned<ProjectLabel>>();
  for (const layer of project.layers) {
    for (const entry of layer.labels ?? []) {
      if (entry.id) out.set(entry.id, { layerId: layer.id!, entry });
    }
  }
  return out;
}

function regionsById(project: Project): Map<string, Owned<ProjectRegion>> {
  const out = new Map<string, Owned<ProjectRegion>>();
  for (const layer of project.layers) {
    for (const entry of layer.regions ?? []) {
      if (entry.id) out.set(entry.id, { layerId: layer.id!, entry });
    }
  }
  return out;
}

function commentsById(project: Project): Map<string, Owned<ProjectComment>> {
  const out = new Map<string, Owned<ProjectComment>>();
  for (const layer of project.layers) {
    for (const entry of layer.comments ?? []) {
      if (entry.id) out.set(entry.id, { layerId: layer.id!, entry });
    }
  }
  return out;
}

const sameLabel = (a: ProjectLabel, b: ProjectLabel) =>
  parseProjectAddress(a.address) === parseProjectAddress(b.address) &&
  a.name === b.name &&
  (a.type ?? "address") === (b.type ?? "address");

const sameComment = (a: ProjectComment, b: ProjectComment) =>
  parseProjectAddress(a.address) === parseProjectAddress(b.address) &&
  (a.placement ?? "before") === (b.placement ?? "before") &&
  a.text === b.text;

const sameRegion = (a: ProjectRegion, b: ProjectRegion) =>
  parseProjectAddress(a.start) === parseProjectAddress(b.start) &&
  parseProjectAddress(a.end) === parseProjectAddress(b.end) &&
  a.kind === b.kind &&
  a.name === b.name &&
  a.comment === b.comment;

/**
 * Operations that take `from` to `to`.
 *
 * Deletions come first so a label that moved between layers is removed before
 * it is re-added, rather than existing twice in between.
 */
export function diffProjects(from: Project, to: Project): Op[] {
  const ops: Op[] = [];

  const beforeLabels = labelsById(from);
  const afterLabels = labelsById(to);
  const beforeRegions = regionsById(from);
  const afterRegions = regionsById(to);
  const beforeComments = commentsById(from);
  const afterComments = commentsById(to);

  for (const [id, owned] of beforeLabels) {
    if (!afterLabels.has(id)) ops.push({ op: "label.delete", id, layerId: owned.layerId });
  }
  for (const [id, owned] of beforeRegions) {
    if (!afterRegions.has(id)) ops.push({ op: "region.delete", id, layerId: owned.layerId });
  }
  for (const [id, owned] of beforeComments) {
    if (!afterComments.has(id)) ops.push({ op: "comment.delete", id, layerId: owned.layerId });
  }

  for (const [id, owned] of afterLabels) {
    const before = beforeLabels.get(id);
    if (before && before.layerId === owned.layerId && sameLabel(before.entry, owned.entry)) continue;
    ops.push({
      op: "label.set",
      id,
      layerId: owned.layerId,
      address: parseProjectAddress(owned.entry.address),
      name: owned.entry.name,
      type: owned.entry.type,
    });
  }

  for (const [id, owned] of afterComments) {
    const before = beforeComments.get(id);
    if (before && before.layerId === owned.layerId && sameComment(before.entry, owned.entry)) {
      continue;
    }
    ops.push({
      op: "comment.set",
      id,
      layerId: owned.layerId,
      address: parseProjectAddress(owned.entry.address),
      placement: owned.entry.placement ?? "before",
      text: owned.entry.text,
    });
  }

  for (const [id, owned] of afterRegions) {
    const before = beforeRegions.get(id);
    if (before && before.layerId === owned.layerId && sameRegion(before.entry, owned.entry)) continue;
    ops.push({
      op: "region.set",
      id,
      layerId: owned.layerId,
      start: parseProjectAddress(owned.entry.start),
      end: parseProjectAddress(owned.entry.end),
      kind: owned.entry.kind,
      name: owned.entry.name,
      comment: owned.entry.comment,
    });
  }

  const beforePrimary = from.primaryLabels ?? {};
  const afterPrimary = to.primaryLabels ?? {};
  for (const address of Object.keys(beforePrimary)) {
    if (!(address in afterPrimary)) {
      ops.push({ op: "primary.clear", address: parseProjectAddress(address) });
    }
  }
  for (const [address, labelId] of Object.entries(afterPrimary)) {
    if (beforePrimary[address] !== labelId) {
      ops.push({ op: "primary.set", address: parseProjectAddress(address), labelId });
    }
  }

  return ops;
}
