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
  ProjectClaim,
  ProjectComment,
  ProjectConstant,
  ProjectConstantUse,
  ProjectLabel,
  ProjectLabelUse,
  ProjectRegion,
  parseProjectAddress,
  projectClaims,
  ProjectType,
  targetLinks,
  linksAsWritten,
} from "../project/project.js";
import { ClaimEdit, Op } from "./types.js";
import { Claim } from "../claims/model.js";

/** A stored claim as the model sees it, via the loader's own parser. */
const claimFromProject = (stored: ProjectClaim): Claim => projectClaims([stored])[0];

/** Its settable fields, for a partial revision. */
const claimFields = (stored: ProjectClaim): ClaimEdit => {
  const { id: _id, ...rest } = claimFromProject(stored);
  return rest as ClaimEdit;
};

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
/** Two stored claims, field for field. */
const sameClaim = (a: ProjectClaim, b: ProjectClaim) => JSON.stringify(a) === JSON.stringify(b);

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

  const beforeClaims = new Map((from.claims ?? []).map((c) => [c.id!, c]));
  const afterClaims = new Map((to.claims ?? []).map((c) => [c.id!, c]));

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
      layers: linksAsWritten(targetLinks(target)),
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
  const beforeTypes = new Map((from.types ?? []).filter((t) => t.id).map((t) => [t.id!, t]));
  const afterTypes = new Map((to.types ?? []).filter((t) => t.id).map((t) => [t.id!, t]));

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
  for (const id of beforeClaims.keys()) {
    if (!afterClaims.has(id)) ops.push({ op: "claim.remove", id });
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

  // Removals first, again: a claim referencing a type that has gone renders its
  // bytes, so ordering is a tidiness rather than a correctness matter here —
  // but doing it the same way everywhere is what stops somebody having to
  // check which of them is which.
  for (const id of beforeTypes.keys()) {
    if (!afterTypes.has(id)) ops.push({ op: "type.delete", id });
  }
  for (const [id, type] of afterTypes) {
    const before = beforeTypes.get(id);
    if (before && sameType(before, type)) continue;
    ops.push({
      op: "type.set",
      id,
      name: type.name,
      size: typeof type.size === "string" ? parseProjectAddress(type.size) : type.size,
      fields: Object.fromEntries(
        Object.entries(type.fields).map(([offset, field]) => [Number(offset), field])
      ),
    });
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

  // Claims after the declarations they may name and before the binds that may
  // reference them, on the rule this file already follows: creates before
  // references, references before their targets are deleted.
  //
  // `claim.add` for a new one and `claim.set` for a revised one, so a revision
  // is a partial write and two peers changing different fields of one claim do
  // not clobber each other. A whole-object emit would be the `target.set` bug.
  for (const [id, claim] of afterClaims) {
    const before = beforeClaims.get(id);
    if (before && sameClaim(before, claim)) continue;
    if (!before) {
      ops.push({ op: "claim.add", claim: claimFromProject(claim) });
      continue;
    }
    const fields: ClaimEdit = {};
    const wasFields = claimFields(before);
    const nowFields = claimFields(claim);
    for (const key of new Set([...Object.keys(wasFields), ...Object.keys(nowFields)])) {
      const now = (nowFields as Record<string, unknown>)[key];
      const was = (wasFields as Record<string, unknown>)[key];
      if (JSON.stringify(now) === JSON.stringify(was)) continue;
      (fields as Record<string, unknown>)[key] = now === undefined ? null : now;
    }
    if (Object.keys(fields).length) ops.push({ op: "claim.set", id, fields });
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

/**
 * Whether two layouts say the same thing.
 *
 * Structural, because a type is a small whole value and comparing field by
 * field here would duplicate what the CRDT already does per key. `size` is
 * normalised first: a file may write `200` or `"$C8"` and they are the same
 * record.
 */
function sameType(a: ProjectType, b: ProjectType): boolean {
  const size = (v: number | string) => (typeof v === "string" ? parseProjectAddress(v) : v);
  return (
    a.name === b.name &&
    size(a.size) === size(b.size) &&
    JSON.stringify(normaliseFields(a.fields)) === JSON.stringify(normaliseFields(b.fields))
  );
}

/** Fields in offset order, so a re-ordered but identical map compares equal. */
function normaliseFields(fields: ProjectType["fields"]): [number, unknown][] {
  return Object.entries(fields)
    .map(([offset, field]) => [Number(offset), field] as [number, unknown])
    .sort((a, b) => a[0] - b[0]);
}
