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
  ProjectConstant,
  ProjectConstantUse,
  ProjectLabel,
  ProjectLabelUse,
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
  (a.type ?? "address") === (b.type ?? "address") &&
  a.extent === b.extent;

function usesById(project: Project): Map<string, Owned<ProjectConstantUse>> {
  const out = new Map<string, Owned<ProjectConstantUse>>();
  for (const layer of project.layers) {
    for (const entry of layer.constantUses ?? []) {
      if (entry.id) out.set(entry.id, { layerId: layer.id!, entry });
    }
  }
  return out;
}

function labelUsesById(project: Project): Map<string, Owned<ProjectLabelUse>> {
  const out = new Map<string, Owned<ProjectLabelUse>>();
  for (const layer of project.layers) {
    for (const entry of layer.labelUses ?? []) {
      if (entry.id) out.set(entry.id, { layerId: layer.id!, entry });
    }
  }
  return out;
}

const sameLabelUse = (a: ProjectLabelUse, b: ProjectLabelUse) =>
  parseProjectAddress(a.address) === parseProjectAddress(b.address) && a.label === b.label;

const sameUse = (a: ProjectConstantUse, b: ProjectConstantUse) =>
  parseProjectAddress(a.address) === parseProjectAddress(b.address) &&
  a.constant === b.constant;

const sameConstant = (a: ProjectConstant, b: ProjectConstant) =>
  a.name === b.name && parseProjectAddress(a.value) === parseProjectAddress(b.value);

const sameComment = (a: ProjectComment, b: ProjectComment) =>
  parseProjectAddress(a.address) === parseProjectAddress(b.address) &&
  (a.placement ?? "before") === (b.placement ?? "before") &&
  a.text === b.text;

const sameRegion = (a: ProjectRegion, b: ProjectRegion) =>
  parseProjectAddress(a.start) === parseProjectAddress(b.start) &&
  parseProjectAddress(a.end) === parseProjectAddress(b.end) &&
  a.kind === b.kind &&
  a.name === b.name &&
  a.comment === b.comment &&
  (a.encoding ?? "ascii") === (b.encoding ?? "ascii") &&
  a.view === b.view;

/**
 * Operations that take `from` to `to`.
 *
 * Deletions come first so a label that moved between layers is removed before
 * it is re-added, rather than existing twice in between.
 */
export function diffProjects(from: Project, to: Project): Op[] {
  const ops: Op[] = [];

  // Name and description, which had an operation and an inverse and no way to
  // be emitted — so `set_project_description` reached the document, showed up
  // in `describe_project`, and was absent from every export. An op nothing
  // produces is a feature that exists only from the inside.
  for (const key of ["name", "description", "activeTarget"] as const) {
    if (from[key] !== to[key]) ops.push({ op: "meta.set", key, value: to[key] });
  }

  // Targets name layers, so they follow the layers rather than lead them; the
  // removals go last for the same reason removals always do here.
  const fromTargets = new Map((from.targets ?? []).map((t) => [t.name, t]));
  const toTargets = new Map((to.targets ?? []).map((t) => [t.name, t]));

  // Files, before layers: a layer may reference one by name, so the file has to
  // be in the export before anything points at it. The same ordering rule that
  // layers and their labels already follow.
  const fromFiles = new Map((from.files ?? []).map((f) => [f.name, f]));
  const toFiles = new Map((to.files ?? []).map((f) => [f.name, f]));
  for (const [name, file] of toFiles) {
    const before = fromFiles.get(name);
    if (before && before.hash === file.hash && before.size === file.size) continue;
    ops.push({ op: "file.add", name, hash: file.hash, size: file.size });
  }

  // Layers first, and only symbols layers, which are the only kind an
  // operation can add. A layer holding bytes is a change to what the project
  // *is*, not an annotation, and arrives by another route.
  //
  // Order matters in both directions: a new layer has to exist before a label
  // can be put in it, and a removed one has to be emptied before it goes. This
  // was missing entirely, so a label written into a freshly created layer
  // produced an operation naming a layer the file did not have.
  const fromLayers = new Map(from.layers.filter((l) => l.id).map((l) => [l.id!, l]));
  const toLayers = new Map(to.layers.filter((l) => l.id).map((l) => [l.id!, l]));

  for (const [id, layer] of toLayers) {
    if (fromLayers.has(id)) continue;
    // Every kind an operation can express, not only symbols. This said
    // `!== "symbols"` from when that was the only kind `layer.add` could make,
    // and the filter outlived the limit: a byte layer reached the document, was
    // reported by describe_project, and never reached the exported file — so
    // the next write naming that layer failed against a text project that had
    // never heard of it. The same shape as `meta.set`, which had an operation
    // and an inverse and nothing that emitted one.
    if (layer.type !== "symbols" && layer.type !== "prg" && layer.type !== "raw") continue;
    ops.push({
      op: "layer.add",
      id,
      layerType: layer.type,
      name: layer.name ?? id,
      ...(layer.path === undefined ? {} : { path: layer.path }),
      ...(layer.address === undefined
        ? {}
        : { address: parseProjectAddress(layer.address) }),
      index: to.layers.findIndex((l) => l.id === id),
    });
  }

  for (const [name, target] of toTargets) {
    const before = fromTargets.get(name);
    if (before && JSON.stringify(before) === JSON.stringify(target)) continue;
    ops.push({
      op: "target.set",
      name,
      layers: target.layers,
      ...(target.entryPoints === undefined
        ? {}
        : { entryPoints: target.entryPoints.map((a) => parseProjectAddress(a)) }),
      ...(target.order === undefined ? {} : { order: target.order }),
      ...(target.description === undefined ? {} : { description: target.description }),
    });
  }
  for (const name of fromTargets.keys()) {
    if (!toTargets.has(name)) ops.push({ op: "target.remove", name });
  }

  const beforeLabels = labelsById(from);
  const afterLabels = labelsById(to);
  const beforeRegions = regionsById(from);
  const afterRegions = regionsById(to);
  const beforeComments = commentsById(from);
  const afterComments = commentsById(to);
  const beforeUses = usesById(from);
  const afterUses = usesById(to);
  const beforeLabelUses = labelUsesById(from);
  const afterLabelUses = labelUsesById(to);
  const beforeConstants = new Map((from.constants ?? []).filter((c) => c.id).map((c) => [c.id!, c]));
  const afterConstants = new Map((to.constants ?? []).filter((c) => c.id).map((c) => [c.id!, c]));
  const beforeDecoders = new Map((from.decoders ?? []).filter((d) => d.id).map((d) => [d.id!, d]));
  const afterDecoders = new Map((to.decoders ?? []).filter((d) => d.id).map((d) => [d.id!, d]));

  for (const [id, owned] of beforeLabels) {
    if (!afterLabels.has(id)) ops.push({ op: "label.delete", id, layerId: owned.layerId });
  }
  for (const [id, owned] of beforeRegions) {
    if (!afterRegions.has(id)) ops.push({ op: "region.delete", id, layerId: owned.layerId });
  }
  for (const [id, owned] of beforeComments) {
    if (!afterComments.has(id)) ops.push({ op: "comment.delete", id, layerId: owned.layerId });
  }
  for (const [id, owned] of beforeUses) {
    if (!afterUses.has(id)) ops.push({ op: "constant.unbind", id, layerId: owned.layerId });
  }
  for (const [id, owned] of beforeLabelUses) {
    if (!afterLabelUses.has(id)) ops.push({ op: "label.unbind", id, layerId: owned.layerId });
  }
  // Declarations go after the sites that meant them, so nothing is left
  // pointing at a constant that has already gone.
  for (const id of beforeConstants.keys()) {
    if (!afterConstants.has(id)) ops.push({ op: "constant.delete", id });
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
      extent: owned.entry.extent,
    });
  }

  // Removals before additions, as everywhere else here.
  for (const id of beforeDecoders.keys()) {
    if (!afterDecoders.has(id)) ops.push({ op: "decoder.delete", id });
  }
  for (const [id, decoder] of afterDecoders) {
    const before = beforeDecoders.get(id);
    if (before && before.name === decoder.name && before.source === decoder.source) continue;
    ops.push({ op: "decoder.set", id, name: decoder.name, source: decoder.source });
  }

  for (const [id, constant] of afterConstants) {
    const before = beforeConstants.get(id);
    if (before && sameConstant(before, constant)) continue;
    ops.push({
      op: "constant.set",
      id,
      name: constant.name,
      value: parseProjectAddress(constant.value),
    });
  }

  for (const [id, owned] of afterLabelUses) {
    const before = beforeLabelUses.get(id);
    if (before && before.layerId === owned.layerId && sameLabelUse(before.entry, owned.entry)) {
      continue;
    }
    ops.push({
      op: "label.bind",
      id,
      layerId: owned.layerId,
      address: parseProjectAddress(owned.entry.address),
      labelId: owned.entry.label,
    });
  }

  for (const [id, owned] of afterUses) {
    const before = beforeUses.get(id);
    if (before && before.layerId === owned.layerId && sameUse(before.entry, owned.entry)) continue;
    ops.push({
      op: "constant.bind",
      id,
      layerId: owned.layerId,
      address: parseProjectAddress(owned.entry.address),
      constantId: owned.entry.constant,
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
      encoding: owned.entry.encoding,
      view: owned.entry.view,
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

  for (const name of fromFiles.keys()) {
    if (!toFiles.has(name)) ops.push({ op: "file.remove", name });
  }

  // Any kind, not only symbols. The filter here was the twin of the one on
  // `layer.add` above, left from when that was the only kind an operation could
  // make — and fixing the addition side did not fix this one, a dozen lines
  // apart. A byte layer removed from the document stayed in the export for ever:
  // experiment 5 produced a project whose document held five layers and whose
  // export emitted eight, three of them scratch layers whose `layer.add` had
  // been undone, while the export reported `changed: false`.
  for (const [id] of fromLayers) {
    if (toLayers.has(id)) continue;
    ops.push({ op: "layer.remove", id });
  }

  return ops;
}
