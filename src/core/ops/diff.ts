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
} from "../project/project.js";
import { ClaimEdit, LayerAddOp, Op, TypeField } from "./types.js";
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
  for (const key of ["name", "description"] as const) {
    if (from[key] !== to[key]) ops.push({ op: "meta.set", key, value: to[key] });
  }

  // Targets name layers, so they follow the layers rather than lead them; the
  // removals go last for the same reason removals always do here.
  const fromTargets = new Map((from.targets ?? []).filter((t) => t.id).map((t) => [t.id!, t]));
  const toTargets = new Map((to.targets ?? []).filter((t) => t.id).map((t) => [t.id!, t]));

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
    // Every kind, keyed by the *file* type so the compiler notices when the two
    // vocabularies drift. This was a list of three from when `layer.add` could
    // only make a symbols layer, and the filter outlived the limit twice: a byte
    // layer reached the document and never the exported file, so the next write
    // naming it failed against a text project that had never heard of it — and
    // when that was fixed for `prg` and `raw` the same hole stayed open under
    // `rom`, which is the one kind the `machine` target cannot do without.
    const layerType: LayerAddOp["layerType"] = layer.type;
    ops.push({
      op: "layer.add",
      id,
      layerType,
      name: layer.name ?? id,
      ...(layer.rom === undefined ? {} : { rom: layer.rom }),
      ...(layer.path === undefined ? {} : { path: layer.path }),
      ...(layer.address === undefined
        ? {}
        : { address: parseProjectAddress(layer.address) }),
      ...(layer.bytes === undefined ? {} : { bytes: layer.bytes }),
      ...(layer.length === undefined ? {} : { length: layer.length }),
      index: to.layers.findIndex((l) => l.id === id),
    });
  }

  // A layer's name is the one field of it somebody chose, and the only thing
  // `layer.set` carries — the rest is what the layer *is*.
  const renamedFrom = new Map(from.layers.filter((l) => l.id).map((l) => [l.id!, l]));
  for (const layer of to.layers) {
    if (!layer.id) continue;
    const before = renamedFrom.get(layer.id);
    if (!before || before.name === layer.name) continue;
    ops.push({ op: "layer.set", id: layer.id, fields: { name: layer.name ?? "" } });
  }

  for (const [id, target] of toTargets) {
    const before = fromTargets.get(id);
    if (before && JSON.stringify(before) === JSON.stringify(target)) continue;
    const points =
      target.entryPoints === undefined
        ? undefined
        : target.entryPoints.map((a) => parseProjectAddress(a));
    if (!before) {
      ops.push({
        op: "target.add",
        id,
        name: target.name,
        layers: targetLinks(target),
        ...(points === undefined ? {} : { entryPoints: points }),
        ...(target.order === undefined ? {} : { order: target.order }),
        ...(target.description === undefined ? {} : { description: target.description }),
      });
      continue;
    }
    // Only what differs, so replaying a diff does not reassert a field the two
    // states agree on.
    const beforePoints = before.entryPoints?.map((a) => parseProjectAddress(a));
    ops.push({
      op: "target.set",
      id,
      fields: {
        ...(before.name === target.name ? {} : { name: target.name }),
        ...(JSON.stringify(targetLinks(before)) === JSON.stringify(targetLinks(target))
          ? {}
          : { layers: targetLinks(target) }),
        ...(JSON.stringify(beforePoints) === JSON.stringify(points) || points === undefined
          ? {}
          : { entryPoints: points }),
        ...(before.order === target.order ? {} : { order: target.order ?? 0 }),
        ...(before.description === target.description
          ? {}
          : { description: target.description ?? "" }),
      },
    });
  }
  for (const id of fromTargets.keys()) {
    if (!toTargets.has(id)) ops.push({ op: "target.remove", id });
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
    if (!afterComments.has(id)) ops.push({ op: "comment.remove", id, layerId: owned.layerId });
  }
  for (const [id, owned] of beforeUses) {
    if (!afterUses.has(id)) {
      ops.push({
        op: "constantUse.unbind",
        id,
        layerId: owned.layerId,
        address: parseProjectAddress(owned.entry.address),
      });
    }
  }
  for (const [id, owned] of beforeLabelUses) {
    if (!afterLabelUses.has(id)) {
      ops.push({
        op: "labelUse.unbind",
        id,
        layerId: owned.layerId,
        address: parseProjectAddress(owned.entry.address),
      });
    }
  }
  // Declarations go after the sites that meant them, so nothing is left
  // pointing at a constant that has already gone.
  for (const id of beforeConstants.keys()) {
    if (!afterConstants.has(id)) ops.push({ op: "constant.remove", id });
  }
  for (const id of beforeClaims.keys()) {
    if (!afterClaims.has(id)) ops.push({ op: "claim.remove", id });
  }


  // Removals before additions, as everywhere else here.
  for (const id of beforeDecoders.keys()) {
    if (!afterDecoders.has(id)) ops.push({ op: "decoder.remove", id });
  }
  for (const [id, decoder] of afterDecoders) {
    const before = beforeDecoders.get(id);
    if (!before) {
      ops.push({ op: "decoder.add", id, name: decoder.name, source: decoder.source });
      continue;
    }
    // Only what differs, which is what a partial `set` is for: replaying this
    // diff must not overwrite a field the two states agree on.
    const fields = {
      ...(before.name === decoder.name ? {} : { name: decoder.name }),
      ...(before.source === decoder.source ? {} : { source: decoder.source }),
    };
    if (Object.keys(fields).length) ops.push({ op: "decoder.set", id, fields });
  }

  // Removals first, again: a claim referencing a type that has gone renders its
  // bytes, so ordering is a tidiness rather than a correctness matter here —
  // but doing it the same way everywhere is what stops somebody having to
  // check which of them is which.
  for (const id of beforeTypes.keys()) {
    if (!afterTypes.has(id)) ops.push({ op: "type.remove", id });
  }
  for (const [id, type] of afterTypes) {
    const before = beforeTypes.get(id);
    const size = typeof type.size === "string" ? parseProjectAddress(type.size) : type.size;
    // The list as it stands. An offset-keyed object here kept one field per
    // offset, so a type holding two at one offset — a legal state — reached a
    // peer that had never seen it with one of them missing.
    const asFields: TypeField[] = type.fields.map((field) => ({ ...field, id: field.id! }));
    if (!before) {
      ops.push({
        op: "type.add",
        id,
        name: type.name,
        size,
        ...(type.unit === undefined ? {} : { unit: type.unit }),
        fields: asFields,
      });
      continue;
    }
    if (sameType(before, type)) continue;
    const beforeSize =
      typeof before.size === "string" ? parseProjectAddress(before.size) : before.size;
    const revised = {
      ...(before.name === type.name ? {} : { name: type.name }),
      ...(beforeSize === size ? {} : { size }),
      ...(before.unit === type.unit || type.unit === undefined ? {} : { unit: type.unit }),
    };
    if (Object.keys(revised).length) ops.push({ op: "type.set", id, fields: revised });

    // **The fields, by id, through the three operations that own them.** This
    // reconciles a *file* against a document, and the file used to be the reason
    // `type.set` carried an offset-keyed patch of its own: a field in a file had
    // no identity to name. It has one now — `fieldsOfType` derives it on the way
    // in — so the reconciler stops being a second writer for the same storage.
    const was = new Map(before.fields.map((f) => [f.id!, f] as const));
    const now = new Map(type.fields.map((f) => [f.id!, f] as const));
    for (const fieldId of was.keys()) {
      if (!now.has(fieldId)) ops.push({ op: "field.remove", id: fieldId, typeId: id });
    }
    for (const [fieldId, field] of now) {
      const had = was.get(fieldId);
      if (!had) {
        ops.push({
          op: "field.add",
          id: fieldId,
          typeId: id,
          offset: field.offset,
          name: field.name,
          type: field.type,
          ...(field.description === undefined ? {} : { description: field.description }),
        });
        continue;
      }
      const patch = {
        ...(had.name === field.name ? {} : { name: field.name }),
        ...(had.type === field.type ? {} : { type: field.type }),
        ...(had.offset === field.offset ? {} : { offset: field.offset }),
        ...(had.description === field.description
          ? {}
          : { description: field.description ?? null }),
      };
      if (Object.keys(patch).length) {
        ops.push({ op: "field.set", id: fieldId, typeId: id, fields: patch });
      }
    }
  }

  const beforeEvidence = new Map((from.evidence ?? []).filter((e) => e.id).map((e) => [e.id!, e]));
  const afterEvidence = new Map((to.evidence ?? []).filter((e) => e.id).map((e) => [e.id!, e]));
  for (const id of beforeEvidence.keys()) {
    if (!afterEvidence.has(id)) ops.push({ op: "evidence.remove", id });
  }
  for (const [id, item] of afterEvidence) {
    const before = beforeEvidence.get(id);
    if (!before) {
      ops.push({
        op: "evidence.add",
        id,
        claim: item.claim,
        kind: item.kind,
        ...(item.author === undefined && item.method === undefined && item.when === undefined
          ? {}
          : {
              by: {
                author: item.author ?? "unknown",
                ...(item.method === undefined ? {} : { method: item.method }),
                ...(item.when === undefined ? {} : { when: item.when }),
              },
            }),
        ...(item.scenario === undefined ? {} : { scenario: item.scenario }),
        ...(item.capture === undefined ? {} : { capture: item.capture }),
        ...(item.other === undefined ? {} : { other: item.other }),
        ...(item.note === undefined ? {} : { note: item.note }),
      });
      continue;
    }
    if (JSON.stringify(before) === JSON.stringify(item)) continue;
    ops.push({
      op: "evidence.set",
      id,
      fields: {
        ...(before.kind === item.kind ? {} : { kind: item.kind }),
        // Flat in the file, nested in the operation. Emitted whenever any of
        // the three moved, because `by` is one value to the op even though it
        // is three keys here.
        ...(before.author === item.author &&
        before.method === item.method &&
        before.when === item.when
          ? {}
          : {
              by: {
                author: item.author ?? "unknown",
                ...(item.method === undefined ? {} : { method: item.method }),
                ...(item.when === undefined ? {} : { when: item.when }),
              },
            }),
        ...(before.scenario === item.scenario ? {} : { scenario: item.scenario ?? null }),
        ...(before.capture === item.capture ? {} : { capture: item.capture ?? null }),
        ...(before.other === item.other ? {} : { other: item.other ?? null }),
        ...(before.note === item.note ? {} : { note: item.note ?? null }),
      },
    });
  }

  // **Chat, which the diff could not see until a message became an entity.**
  // By id like every other collection, even though the storage is a list: the
  // sequence is what the array CRDT converges, and a diff is about which things
  // exist and what they say, not about where they sit.
  const beforeSaid = new Map((from.messages ?? []).filter((m) => m.id).map((m) => [m.id!, m]));
  const afterSaid = new Map((to.messages ?? []).filter((m) => m.id).map((m) => [m.id!, m]));
  for (const id of beforeSaid.keys()) {
    if (!afterSaid.has(id)) ops.push({ op: "message.remove", id });
  }
  for (const [id, message] of afterSaid) {
    const before = beforeSaid.get(id);
    if (!before) {
      ops.push({
        op: "message.add",
        id,
        at: message.at,
        author: message.author,
        name: message.name,
        text: message.text,
      });
      continue;
    }
    // Only the text can move. Who said it and when are what was true then, and
    // rewriting either would rewrite history rather than correct it.
    if (before.text !== message.text) {
      ops.push({ op: "message.set", id, fields: { text: message.text } });
    }
  }

  // Scenarios and captures, removals before additions like everything else.
  const beforeScenarios = new Map((from.scenarios ?? []).filter((x) => x.id).map((x) => [x.id!, x]));
  const afterScenarios = new Map((to.scenarios ?? []).filter((x) => x.id).map((x) => [x.id!, x]));
  for (const id of beforeScenarios.keys()) {
    if (!afterScenarios.has(id)) ops.push({ op: "scenario.remove", id });
  }
  for (const [id, scenario] of afterScenarios) {
    const before = beforeScenarios.get(id);
    if (!before) {
      ops.push({
        op: "scenario.add",
        id,
        name: scenario.name,
        ...(scenario.description === undefined ? {} : { description: scenario.description }),
        steps: scenario.steps,
      });
      continue;
    }
    if (JSON.stringify(before) === JSON.stringify(scenario)) continue;
    ops.push({
      op: "scenario.set",
      id,
      fields: {
        ...(before.name === scenario.name ? {} : { name: scenario.name }),
        ...(before.description === scenario.description
          ? {}
          : { description: scenario.description ?? null }),
        ...(JSON.stringify(before.steps) === JSON.stringify(scenario.steps)
          ? {}
          : { steps: scenario.steps }),
      },
    });
  }

  const beforeCaptures = new Map((from.captures ?? []).filter((c) => c.id).map((c) => [c.id!, c]));
  const afterCaptures = new Map((to.captures ?? []).filter((c) => c.id).map((c) => [c.id!, c]));
  for (const id of beforeCaptures.keys()) {
    if (!afterCaptures.has(id)) ops.push({ op: "capture.remove", id });
  }
  for (const [id, capture] of afterCaptures) {
    const before = beforeCaptures.get(id);
    if (!before) {
      ops.push({
        op: "capture.add",
        id,
        scenario: capture.scenario,
        step: capture.step,
        kind: capture.kind,
        file: capture.file,
        ...(capture.when === undefined ? {} : { when: capture.when }),
      });
      continue;
    }
    if (JSON.stringify(before) === JSON.stringify(capture)) continue;
    ops.push({
      op: "capture.set",
      id,
      fields: {
        ...(before.file === capture.file ? {} : { file: capture.file }),
        ...(before.when === capture.when ? {} : { when: capture.when ?? null }),
      },
    });
  }

  for (const [id, constant] of afterConstants) {
    const before = beforeConstants.get(id);
    const value = parseProjectAddress(constant.value);
    if (!before) {
      ops.push({ op: "constant.add", id, name: constant.name, value });
      continue;
    }
    if (sameConstant(before, constant)) continue;
    ops.push({
      op: "constant.set",
      id,
      fields: {
        ...(before.name === constant.name ? {} : { name: constant.name }),
        ...(parseProjectAddress(before.value) === value ? {} : { value }),
      },
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
      op: "labelUse.bind",
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
      op: "constantUse.bind",
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
    const address = parseProjectAddress(owned.entry.address);
    const placement = owned.entry.placement ?? "before";
    if (!before) {
      ops.push({
        op: "comment.add",
        id,
        layerId: owned.layerId,
        address,
        placement,
        text: owned.entry.text,
        ...(owned.entry.order === undefined ? {} : { order: owned.entry.order }),
      });
      continue;
    }
    ops.push({
      op: "comment.set",
      id,
      layerId: owned.layerId,
      fields: {
        ...(parseProjectAddress(before.entry.address) === address ? {} : { address }),
        ...((before.entry.placement ?? "before") === placement ? {} : { placement }),
        ...(before.entry.text === owned.entry.text ? {} : { text: owned.entry.text }),
        ...(before.entry.order === owned.entry.order
          ? {}
          : { order: owned.entry.order ?? null }),
      },
    });
  }


  const beforePrimary = from.primaryLabels ?? {};
  const afterPrimary = to.primaryLabels ?? {};
  for (const address of Object.keys(beforePrimary)) {
    if (!(address in afterPrimary)) {
      ops.push({ op: "primary.unbind", address: parseProjectAddress(address) });
    }
  }
  for (const [address, labelId] of Object.entries(afterPrimary)) {
    if (beforePrimary[address] !== labelId) {
      ops.push({ op: "primary.bind", address: parseProjectAddress(address), labelId });
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
    (a.unit ?? "bytes") === (b.unit ?? "bytes") &&
    JSON.stringify(normaliseFields(a.fields)) === JSON.stringify(normaliseFields(b.fields))
  );
}

/** Fields in offset order, so a re-ordered but identical map compares equal. */
function normaliseFields(fields: ProjectType["fields"]): [number, unknown][] {
  return Object.entries(fields)
    .map(([offset, field]) => [Number(offset), field] as [number, unknown])
    .sort((a, b) => a[0] - b[0]);
}
