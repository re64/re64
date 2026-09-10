/**
 * Editing `.re64` project text without reformatting it.
 *
 * Project files are hand-edited and tracked in git, so writes must preserve the
 * house style: one label/region per line, compact objects, and the blank lines
 * used to group related labels. `JSON.stringify` with plain indentation would
 * explode every entry across five lines and turn a one-label rename into a
 * whole-file diff.
 *
 * Pure text in, text out. The client edits its own copy and re-analyses locally;
 * the server only writes the result. Every edit is re-parsed before being
 * returned, so a botched splice throws instead of producing a corrupt file.
 */

import {
  ProjectType,
  ProjectScenario,
  ProjectCapture,
  ProjectEvidence,
  fieldsOfType,
  ProjectMessage,
  ProjectLink,
  Project,
  ProjectComment,
  ProjectConstant,
  ProjectDecoder,
  ProjectClaim,
  ProjectConstantUse,
  ProjectLabel,
  ProjectLabelUse,
  ProjectLayer,
} from "./project.js";
import { parseProject, parseProjectAddress } from "./project.js";

/** Serialize one object compactly on a single line: `{ "a": 1, "b": 2 }`. */
function compactObject(obj: Record<string, unknown>): string {
  const parts = Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return `{ ${parts.join(", ")} }`;
}

/**
 * An entity's keys in the order the file writes them; anything unknown follows.
 *
 * `compactObject` writes keys as it finds them, and the paths that build an
 * object do not agree on an order: `field.add` and the offset migration spelled
 * one field two ways, and `evidence.set` deletes and reinserts the three
 * provenance keys, so setting a value back to what it was moved `author`,
 * `method` and `when` after `note`. Equal state, unequal text. The order is
 * fixed here, per entity, because the file is where it shows.
 */
function inOrder(entity: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (entity[key] !== undefined) out[key] = entity[key];
  }
  for (const [key, value] of Object.entries(entity)) {
    if (!(key in out) && value !== undefined) out[key] = value;
  }
  return out;
}

const FIELD_KEYS = ["id", "offset", "name", "type", "description"] as const;
/** As the document projects a piece of evidence; see `EVIDENCE_FIELDS` in `crdt/doc.ts`. */
const EVIDENCE_KEYS = [
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

/** Serialize a project in the hand-maintained house style. */
export function formatProject(project: Project): string {
  const lines: string[] = ["{"];
  const body: string[] = [];

  if (project.name !== undefined) body.push(`  "name": ${JSON.stringify(project.name)}`);
  if (project.description !== undefined) {
    body.push(`  "description": ${JSON.stringify(project.description)}`);
  }

  // Layer scalars expanded, its labels and regions one per line.
  const layers = project.layers
    .map((layer) => {
      const { labels, regions, comments, constantUses, labelUses, ...scalars } = layer;
      const parts = Object.entries(scalars)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `      ${JSON.stringify(k)}: ${JSON.stringify(v)}`);

      if (regions?.length) {
        const body = regions
          .map((r) => `        ${compactObject(r as unknown as Record<string, unknown>)}`)
          .join(",\n");
        parts.push(`      "regions": [\n${body}\n      ]`);
      }
      if (labels?.length) {
        const body = labels
          .map((l) => `        ${compactObject(l as unknown as Record<string, unknown>)}`)
          .join(",\n");
        parts.push(`      "labels": [\n${body}\n      ]`);
      }
      if (comments?.length) {
        const body = comments
          .map((c) => `        ${compactObject(c as unknown as Record<string, unknown>)}`)
          .join(",\n");
        parts.push(`      "comments": [\n${body}\n      ]`);
      }
      if (labelUses?.length) {
        const body = labelUses
          .map((u) => `        ${compactObject(u as unknown as Record<string, unknown>)}`)
          .join(",\n");
        parts.push(`      "labelUses": [\n${body}\n      ]`);
      }
      if (constantUses?.length) {
        const body = constantUses
          .map((u) => `        ${compactObject(u as unknown as Record<string, unknown>)}`)
          .join(",\n");
        parts.push(`      "constantUses": [\n${body}\n      ]`);
      }

      return `    {\n${parts.join(",\n")}\n    }`;
    })
    .join(",\n");
  body.push(`  "layers": [\n${layers}\n  ]`);

  if (project.entryPoints?.length) {
    body.push(`  "entryPoints": [${project.entryPoints.map((e) => JSON.stringify(e)).join(", ")}]`);
  }

  if (project.constants?.length) {
    const entries = project.constants
      .map((c) => `    ${compactObject(c as unknown as Record<string, unknown>)}`)
      .join(",\n");
    body.push(`  "constants": [\n${entries}\n  ]`);
  }

  if (project.targets?.length) {
    const entries = project.targets
      .map((t) => `    ${compactObject(t as unknown as Record<string, unknown>)}`)
      .join(",\n");
    body.push(`  "targets": [\n${entries}\n  ]`);
  }

  if (project.files?.length) {
    // Before layers in the file, because a layer's `path` refers to one by
    // name: a reader meets the binary and its hash before anything points at
    // them.
    const entries = project.files
      .map((f) => `    ${compactObject(f as unknown as Record<string, unknown>)}`)
      .join(",\n");
    body.push(`  "files": [\n${entries}\n  ]`);
  }

  if (project.claims?.length) {
    // One per line, sorted by address then id: the projection has to pick an
    // order, and address is the one a reader scans by. Id breaks the tie so two
    // peers flattening the same document produce the same text.
    const entries = [...project.claims]
      .sort((a, b) => {
        const at = parseProjectAddress(a.at) - parseProjectAddress(b.at);
        return at !== 0 ? at : (a.id ?? "").localeCompare(b.id ?? "");
      })
      .map((c) => `    ${compactObject(c as unknown as Record<string, unknown>)}`)
      .join(",\n");
    body.push(`  "claims": [\n${entries}\n  ]`);
  }

  if (project.decoders?.length) {
    // One per line like everything else, so a decoder's source shows up as one
    // changed line in a diff rather than as a reformatted block.
    const entries = project.decoders
      .map((d) => `    ${compactObject(d as unknown as Record<string, unknown>)}`)
      .join(",\n");
    body.push(`  "decoders": [\n${entries}\n  ]`);
  }

  if (project.types?.length) {
    // A field per line, in offset order, so adding one is a one-line diff and a
    // reader sees the layout laid out the way memory is.
    //
    // **A list, not an offset-keyed object.** The offset was the key, which read
    // well and could not represent two fields at one offset — a state the model
    // now tolerates and reports rather than prevents. Each entry carries its own
    // offset, and the order is still layout order because that is how a record
    // is read.
    const entries = project.types
      .map((t) => {
        // Tolerant of the offset-keyed shape, like every other entry point: a
        // project handed here in memory has not been through `parseProject`.
        // **One key order, whatever path built the field.** `field.add` spells
        // one `{id, offset, name, type}`, the offset migration `{id, name, type,
        // offset}`, and the document whatever order its map was filled in — and
        // `compactObject` writes keys as it finds them. Equal state was
        // producing unequal text, and undo compares text to decide whether a
        // recorded operation still holds.
        const fields = [...fieldsOfType(t)]
          .sort((a, b) => a.offset - b.offset || (a.id ?? "").localeCompare(b.id ?? ""))
          .map((f) => `        ${compactObject(inOrder(f as unknown as Record<string, unknown>, FIELD_KEYS))}`)
          .join(",\n");
        const head = [
          `      "id": ${JSON.stringify(t.id)}`,
          `      "name": ${JSON.stringify(t.name)}`,
          `      "size": ${JSON.stringify(t.size)}`,
          // A hand-written list of keys, which is why this is spelled out with
          // the rest rather than left implicit: `unit` reached the operation,
          // the document and the diff and stopped here, silently, exactly as
          // `layer.add` did twice. Anything added to `ProjectType` needs a line.
          ...(t.unit === undefined ? [] : [`      "unit": ${JSON.stringify(t.unit)}`]),
        ].join(",\n");
        return `    {\n${head},\n      "fields": [\n${fields}\n      ]\n    }`;
      })
      .join(",\n");
    body.push(`  "types": [\n${entries}\n  ]`);
  }

  if (project.scenarios?.length) {
    const entries = project.scenarios
      .map((x) => {
        const steps = x.steps
          .map((step) => `        ${compactObject(step as unknown as Record<string, unknown>)}`)
          .join(",\n");
        const head = [
          `      "id": ${JSON.stringify(x.id)}`,
          `      "name": ${JSON.stringify(x.name)}`,
          ...(x.description === undefined
            ? []
            : [`      "description": ${JSON.stringify(x.description)}`]),
        ].join(",\n");
        return `    {\n${head},\n      "steps": [\n${steps}\n      ]\n    }`;
      })
      .join(",\n");
    body.push(`  "scenarios": [\n${entries}\n  ]`);
  }

  if (project.evidence?.length) {
    const entries = project.evidence
      .map((x) => `    ${compactObject(inOrder(x as unknown as Record<string, unknown>, EVIDENCE_KEYS))}`)
      .join(",\n");
    body.push(`  "evidence": [\n${entries}\n  ]`);
  }

  if (project.captures?.length) {
    const entries = project.captures
      .map((c) => `    ${compactObject(c as unknown as Record<string, unknown>)}`)
      .join(",\n");
    body.push(`  "captures": [\n${entries}\n  ]`);
  }

  // Last, and in the order they were said. A conversation reads worst sorted,
  // and it is the one root whose sequence is its content.
  if (project.messages?.length) {
    const entries = project.messages
      .map((m) => `    ${compactObject(m as unknown as Record<string, unknown>)}`)
      .join(",\n");
    body.push(`  "messages": [\n${entries}\n  ]`);
  }

  const primary = Object.entries(project.primaryLabels ?? {});
  if (primary.length) {
    const entries = primary
      .map(([address, id]) => `    ${JSON.stringify(address)}: ${JSON.stringify(id)}`)
      .join(",\n");
    body.push(`  "primaryLabels": {\n${entries}\n  }`);
  }

  lines.push(body.join(",\n"));
  lines.push("}");
  return lines.join("\n") + "\n";
}

/** The span of lines holding the entries of a top-level array. */
interface ArraySpan {
  /** Index of the line containing `"key": [`. */
  open: number;
  /** Index of the line containing the closing `]`. */
  close: number;
}



const ADDRESS_IN_LINE = /"address"\s*:\s*(?:"(\$|0x)?([0-9A-Fa-f]+)"|(\d+))/;

/** The address an entry line declares, or null if it declares none. */
function addressOfLine(line: string): number | null {
  const m = ADDRESS_IN_LINE.exec(line);
  if (!m) return null;
  if (m[3] !== undefined) return parseInt(m[3], 10);
  return parseInt(m[2], m[1] === undefined ? 10 : 16);
}

function labelEntryLine(
  indent: string,
  id: string,
  address: number,
  name: string,
  type?: ProjectLabel["type"],
  extent?: number
): string {
  const addr = "$" + address.toString(16).toUpperCase().padStart(4, "0");
  // "address" is the default; recorded by absence, not written out.
  const typePart =
    type && type !== "address" ? `, "type": ${JSON.stringify(type)}` : "";
  const extentPart = extent === undefined ? "" : `, "extent": ${extent}`;
  return (
    `${indent}{ "id": ${JSON.stringify(id)}, "address": ${JSON.stringify(addr)}, ` +
    `"name": ${JSON.stringify(name)}${typePart}${extentPart} }`
  );
}

const ID_IN_LINE = /"id"\s*:\s*"([^"]+)"/;

/** The id an entry line declares, or null. */
function idOfLine(line: string): string | null {
  return ID_IN_LINE.exec(line)?.[1] ?? null;
}

/** Line index of the entry with this id inside a span, or -1. */
function findEntryById(lines: string[], span: ArraySpan, id: string): number {
  for (let i = span.open + 1; i < span.close; i++) {
    if (idOfLine(lines[i]) === id) return i;
  }
  return -1;
}

function regionEntryLine(
  indent: string,
  id: string,
  start: number,
  end: number,
  kind: string,
  name?: string,
  comment?: string,
  encoding?: string,
  view?: string
): string {
  const hex = (n: number) => "$" + n.toString(16).toUpperCase().padStart(4, "0");
  const parts = [
    `"id": ${JSON.stringify(id)}`,
    `"start": ${JSON.stringify(hex(start))}`,
    `"end": ${JSON.stringify(hex(end))}`,
    `"kind": ${JSON.stringify(kind)}`,
  ];
  if (name !== undefined) parts.push(`"name": ${JSON.stringify(name)}`);
  if (comment !== undefined) parts.push(`"comment": ${JSON.stringify(comment)}`);
  // Absent means ASCII, recorded by absence like every other default here.
  if (encoding !== undefined && encoding !== "ascii") {
    parts.push(`"encoding": ${JSON.stringify(encoding)}`);
  }
  if (view !== undefined) {
    parts.push(`"view": ${JSON.stringify(view)}`);
  }
  return `${indent}{ ${parts.join(", ")} }`;
}


/** Index of the last line in the span that is an actual entry, not blank. */
function lastEntryLine(lines: string[], span: ArraySpan): number {
  for (let i = span.close - 1; i > span.open; i--) {
    if (lines[i].trim()) return i;
  }
  return span.open;
}




const START_IN_LINE = /"start"\s*:\s*(?:"(\$|0x)?([0-9A-Fa-f]+)"|(\d+))/;

/** The start address an entry line declares, or null. */
function startOfLine(line: string): number | null {
  const m = START_IN_LINE.exec(line);
  if (!m) return null;
  if (m[3] !== undefined) return parseInt(m[3], 10);
  return parseInt(m[2], m[1] === undefined ? 10 : 16);
}




const HEX4 = (n: number) => "$" + n.toString(16).toUpperCase().padStart(4, "0");

/**
 * Promote a label at an address, or clear the choice.
 *
 * Reserialising, like every writer here now. It used to splice the
 * `primaryLabels` block line by line to preserve a hand-authored layout, and
 * assumed its own output while doing it: given the equally valid
 * `"primaryLabels": { "$8000": "lbl_1" }` on one line, every splice addressed
 * lines *between* two indices that were equal, so it wrote into whatever
 * preceded the block and produced invalid JSON.
 *
 * That whole class of bug goes with the line editors, because the layout they
 * protected is regenerated from the document on every write anyway.
 */
export function setPrimaryLabel(
  raw: string,
  address: number,
  labelId: string | undefined
): string {
  const project = parseProject(raw);
  const key = HEX4(address);
  const primary = { ...(project.primaryLabels ?? {}) };

  if (labelId === undefined) {
    if (!(key in primary)) return raw;
    delete primary[key];
  } else {
    if (primary[key] === labelId) return raw;
    primary[key] = labelId;
  }

  if (Object.keys(primary).length) project.primaryLabels = primary;
  else delete project.primaryLabels;
  return formatProject(project);
}


/** Normalise trailing whitespace the way a written file should look. */
export function normalizeProjectText(raw: string): string {
  return raw.endsWith("\n") ? raw : raw + "\n";
}


/**
 * Add or update a comment, and delete one.
 *
 * These reserialise rather than editing lines in place, which is what the label
 * and region equivalents do to keep a one-field change a one-line diff. Worth
 * being explicit that the difference is deliberate and not an omission: the
 * export is regenerated from the document on every write anyway, and the only
 * caller that applies an operation to *text* reads the result to derive an
 * inverse and throws it away. There is no layout here for anyone to lose.
 */
export function upsertComment(
  raw: string,
  layerIndex: number,
  comment: ProjectComment
): string {
  const project = parseProject(raw);
  const layer = project.layers[layerIndex];
  if (!layer) {
    throw new Error(`No layer at index ${layerIndex} to own a comment`);
  }

  const comments = (layer.comments ??= []);
  const at = comments.findIndex((c) => c.id === comment.id);
  if (at >= 0) comments[at] = comment;
  else comments.push(comment);

  return formatProject(project);
}

export function deleteComment(raw: string, layerIndex: number, id: string): string {
  const project = parseProject(raw);
  const layer = project.layers[layerIndex];
  if (!layer?.comments) return raw;

  layer.comments = layer.comments.filter((c) => c.id !== id);
  if (layer.comments.length === 0) delete layer.comments;

  return formatProject(project);
}


/**
 * Insert a layer into the declaration order, and remove one.
 *
 * Reserialises, like the comment writers and for the same reason: a structural
 * change to the layer array has no small diff to preserve, and every caller
 * that applies operations to text is reading the result to derive an inverse.
 */
export function insertLayer(raw: string, layer: ProjectLayer, index?: number): string {
  const project = parseProject(raw);
  // Idempotent, like every other write here. Undo checks whether replaying an
  // operation forward changes anything: if it does, something else has been
  // here since and the stored inverse no longer means what it said. A layer
  // insert that appended a duplicate instead of doing nothing failed that
  // check, so creating a layer could never be undone.
  if (project.layers.some((l) => l.id === layer.id)) return raw;

  const at = index ?? 0;
  project.layers.splice(Math.max(0, Math.min(at, project.layers.length)), 0, layer);
  return formatProject(project);
}

/**
 * Rename a layer.
 *
 * The one field of a layer somebody chose. `path`, `address` and `type` are
 * what the layer *is* — they come from the file it carries — and z-order is a
 * property of a target's link list rather than of the layer, which is why this
 * is the whole of `layer.set` and not the start of it.
 */
export function renameLayer(raw: string, index: number, name: string): string {
  const project = parseProject(raw);
  const layer = project.layers[index];
  if (!layer || layer.name === name) return raw;
  layer.name = name;
  return formatProject(project);
}

export function removeLayer(raw: string, id: string): string {
  const project = parseProject(raw);
  project.layers = project.layers.filter((l) => l.id !== id);
  return formatProject(project);
}

/**
 * Declare a constant, forget one, bind a site, and unbind it.
 *
 * Reserialising, like the comment and layer writers: these are the same kind of
 * structural change with no small diff to preserve, and the only caller that
 * applies operations to text reads the result to derive an inverse.
 *
 * Every one is idempotent. Undo replays an operation forward to check that its
 * effect is still present, so a writer that appended a duplicate instead of
 * doing nothing would make its own operation impossible to take back.
 */
export function addTarget(
  raw: string,
  target: {
    id: string;
    name: string;
    layers?: ProjectLink[];
    entryPoints?: number[];
    order?: number;
    description?: string;
  }
): string {
  const project = parseProject(raw);
  const targets = (project.targets ??= []);
  // Idempotent, like every other write here: undo replays an operation forward
  // to check its effect is still present, so appending a duplicate would make
  // the operation impossible to take back.
  if (targets.some((t) => t.id === target.id)) return raw;
  targets.push({
    id: target.id,
    name: target.name,
    layers: target.layers ?? [],
    ...(target.entryPoints === undefined ? {} : { entryPoints: target.entryPoints.map(hexAddr) }),
    ...(target.order === undefined ? {} : { order: target.order }),
    ...(target.description === undefined ? {} : { description: target.description }),
  });
  return formatProject(project);
}

/**
 * Revise a target by id. Omitted fields keep what they had.
 *
 * Writing the whole object would make revising a description revert somebody
 * else's layer list — the same edit working alone and failing together.
 */
export function setTarget(
  raw: string,
  id: string,
  fields: {
    name?: string;
    layers?: ProjectLink[];
    entryPoints?: number[] | null;
    order?: number | null;
    description?: string | null;
  }
): string {
  const project = parseProject(raw);
  const at = (project.targets ?? []).findIndex((t) => t.id === id);
  if (at < 0) return raw;
  const before = project.targets![at];
  project.targets![at] = {
    ...before,
    ...(fields.name === undefined ? {} : { name: fields.name }),
    ...(fields.layers === undefined ? {} : { layers: fields.layers }),
  };
  const entry = project.targets![at] as unknown as Record<string, unknown>;
  // `null` clears, which an omitted field cannot say — so a description put on
  // by mistake can be taken off, and undoing "describe this" removes it rather
  // than leaving an empty string behind.
  for (const [key, value] of [
    ["entryPoints", fields.entryPoints === null ? null : fields.entryPoints?.map(hexAddr)],
    ["order", fields.order],
    ["description", fields.description],
  ] as const) {
    if (value === undefined) continue;
    if (value === null) delete entry[key];
    else entry[key] = value;
  }
  return formatProject(project);
}

export function deleteTarget(raw: string, id: string): string {
  const project = parseProject(raw);
  if (!project.targets?.some((t) => t.id === id)) return raw;
  project.targets = project.targets.filter((t) => t.id !== id);
  if (project.targets.length === 0) delete project.targets;
  return formatProject(project);
}

const hexAddr = (a: number) => "$" + a.toString(16).toUpperCase().padStart(4, "0");

export function upsertFile(raw: string, file: { name: string; hash: string; size: number }): string {
  const project = parseProject(raw);
  const files = (project.files ??= []);
  const at = files.findIndex((f) => f.name === file.name);
  if (at >= 0) {
    if (files[at].hash === file.hash && files[at].size === file.size) return raw;
    files[at] = file;
  } else {
    files.push(file);
  }
  return formatProject(project);
}

export function deleteFile(raw: string, name: string): string {
  const project = parseProject(raw);
  if (!project.files?.some((f) => f.name === name)) return raw;
  project.files = project.files.filter((f) => f.name !== name);
  if (project.files.length === 0) delete project.files;
  return formatProject(project);
}

export function upsertConstant(raw: string, constant: ProjectConstant): string {
  const project = parseProject(raw);
  const constants = (project.constants ??= []);
  const at = constants.findIndex((c) => c.id === constant.id);
  if (at >= 0) {
    if (constants[at].name === constant.name && constants[at].value === constant.value) return raw;
    constants[at] = constant;
  } else {
    constants.push(constant);
  }
  return formatProject(project);
}

export function upsertDecoder(raw: string, decoder: ProjectDecoder): string {
  const project = parseProject(raw);
  const decoders = (project.decoders ??= []);
  const at = decoders.findIndex((d) => d.id === decoder.id);
  if (at >= 0) {
    if (decoders[at].name === decoder.name && decoders[at].source === decoder.source) return raw;
    decoders[at] = decoder;
  } else {
    decoders.push(decoder);
  }
  return formatProject(project);
}

/**
 * Declare or revise a type.
 *
 * Idempotent, like every writer here: undo checks whether replaying an
 * operation forward changes anything, and one that rewrote an identical value
 * would fail that check and become un-undoable — which is exactly how creating
 * a layer stopped being undoable once.
 */
export function upsertType(raw: string, type: ProjectType): string {
  const project = parseProject(raw);
  const types = (project.types ??= []);
  const at = types.findIndex((t) => t.id === type.id);
  if (at >= 0) {
    if (JSON.stringify(types[at]) === JSON.stringify(type)) return raw;
    types[at] = type;
  } else {
    types.push(type);
  }
  return formatProject(project);
}

/**
 * Scenarios and captures, written the way every other collection here is.
 *
 * Reserialising rather than line-editing, like the types and constants above: a
 * structural change to an array has no small diff to preserve, and every caller
 * that applies operations to text reads the result back to derive an inverse.
 */
export function upsertScenario(raw: string, scenario: ProjectScenario): string {
  const project = parseProject(raw);
  const scenarios = (project.scenarios ??= []);
  const at = scenarios.findIndex((x) => x.id === scenario.id);
  if (at >= 0) {
    if (JSON.stringify(scenarios[at]) === JSON.stringify(scenario)) return raw;
    scenarios[at] = scenario;
  } else {
    scenarios.push(scenario);
  }
  return formatProject(project);
}

export function deleteScenario(raw: string, id: string): string {
  const project = parseProject(raw);
  if (!project.scenarios?.some((x) => x.id === id)) return raw;
  project.scenarios = project.scenarios.filter((x) => x.id !== id);
  if (project.scenarios.length === 0) delete project.scenarios;
  return formatProject(project);
}

export function upsertCapture(raw: string, capture: ProjectCapture): string {
  const project = parseProject(raw);
  const captures = (project.captures ??= []);
  const at = captures.findIndex((x) => x.id === capture.id);
  if (at >= 0) {
    if (JSON.stringify(captures[at]) === JSON.stringify(capture)) return raw;
    captures[at] = capture;
  } else {
    captures.push(capture);
  }
  return formatProject(project);
}

export function deleteCapture(raw: string, id: string): string {
  const project = parseProject(raw);
  if (!project.captures?.some((x) => x.id === id)) return raw;
  project.captures = project.captures.filter((x) => x.id !== id);
  if (project.captures.length === 0) delete project.captures;
  return formatProject(project);
}

export function upsertEvidence(raw: string, evidence: ProjectEvidence): string {
  const project = parseProject(raw);
  const all = (project.evidence ??= []);
  const at = all.findIndex((x) => x.id === evidence.id);
  if (at >= 0) {
    if (JSON.stringify(all[at]) === JSON.stringify(evidence)) return raw;
    all[at] = evidence;
  } else {
    all.push(evidence);
  }
  return formatProject(project);
}

export function deleteEvidence(raw: string, id: string): string {
  const project = parseProject(raw);
  if (!project.evidence?.some((x) => x.id === id)) return raw;
  project.evidence = project.evidence.filter((x) => x.id !== id);
  if (project.evidence.length === 0) delete project.evidence;
  return formatProject(project);
}

/**
 * Append what somebody said.
 *
 * Appended, never keyed: a conversation's order is its content. The text path
 * and the document path therefore agree on sequence rather than on a sort, which
 * is the one root where that is true.
 */
export function addMessage(raw: string, message: ProjectMessage): string {
  const project = parseProject(raw);
  const messages = project.messages ?? [];
  if (messages.some((m) => m.id === message.id)) return raw;
  project.messages = [...messages, message];
  return formatProject(project);
}

export function reviseMessage(raw: string, id: string, text: string): string {
  const project = parseProject(raw);
  if (!project.messages?.some((m) => m.id === id)) return raw;
  project.messages = project.messages.map((m) => (m.id === id ? { ...m, text } : m));
  return formatProject(project);
}

export function deleteMessage(raw: string, id: string): string {
  const project = parseProject(raw);
  if (!project.messages?.some((m) => m.id === id)) return raw;
  project.messages = project.messages.filter((m) => m.id !== id);
  if (project.messages.length === 0) delete project.messages;
  return formatProject(project);
}

export function deleteType(raw: string, id: string): string {
  const project = parseProject(raw);
  if (!project.types?.some((t) => t.id === id)) return raw;

  project.types = project.types.filter((t) => t.id !== id);
  // The key goes when the array empties, or undo's replay-forward check sees a
  // difference where there is none.
  if (project.types.length === 0) delete project.types;
  return formatProject(project);
}

export function deleteDecoder(raw: string, id: string): string {
  const project = parseProject(raw);
  if (!project.decoders?.some((d) => d.id === id)) return raw;

  project.decoders = project.decoders.filter((d) => d.id !== id);
  if (project.decoders.length === 0) delete project.decoders;
  return formatProject(project);
}

/**
 * Add or revise a claim.
 *
 * Reserialising rather than line-editing, like the constant and decoder writers:
 * claims live at project level in a block this function owns, so there is no
 * hand-authored layout inside it to preserve.
 *
 * Idempotent, because undo replays an operation forward to check that its stored
 * inverse still means what it said — a writer that appended a duplicate would
 * make its own op un-undoable.
 */
export function upsertClaim(raw: string, claim: ProjectClaim): string {
  const project = parseProject(raw);
  const claims = (project.claims ??= []);
  const at = claims.findIndex((c) => c.id === claim.id);
  if (at >= 0) {
    if (JSON.stringify(claims[at]) === JSON.stringify(claim)) return raw;
    claims[at] = claim;
  } else {
    claims.push(claim);
  }
  return formatProject(project);
}

export function deleteClaim(raw: string, id: string): string {
  const project = parseProject(raw);
  if (!project.claims?.some((c) => c.id === id)) return raw;

  project.claims = project.claims.filter((c) => c.id !== id);
  // An empty block is noise; drop it entirely, as every other root here does.
  if (project.claims.length === 0) delete project.claims;
  return formatProject(project);
}

export function deleteConstant(raw: string, id: string): string {
  const project = parseProject(raw);
  if (!project.constants?.some((c) => c.id === id)) return raw;

  project.constants = project.constants.filter((c) => c.id !== id);
  if (project.constants.length === 0) delete project.constants;
  return formatProject(project);
}

/**
 * Bind a site to a constant, and release it.
 *
 * **Keyed by the site, in both adapters.** The document keys uses by address and
 * this keyed them by use id, so a rebind here appended a second record while the
 * same rebind through the CRDT replaced one — two adapters answering differently
 * for one operation, which is what R13 was one root over. Binding again is how a
 * binding is updated, so the record at the address is the one to overwrite.
 */
export function bindConstant(
  raw: string,
  layerIndex: number,
  use: ProjectConstantUse
): string {
  const project = parseProject(raw);
  const layer = project.layers[layerIndex];
  if (!layer) throw new Error(`No layer at index ${layerIndex} to own a constant use`);

  // **Compared as numbers, and every use at the site goes.** A use may spell
  // its address `32768` or `"$8000"` — both are legal in a file — and comparing
  // the spellings appended a second use at one site, which the document adapter
  // had just stopped doing. A file written while binds accumulated may hold
  // several at one site already; binding again is the update, so it replaces
  // all of them.
  const uses = (layer.constantUses ??= []);
  const here = uses.filter((u) => sameSite(u.address, use.address));
  if (here.length === 1 && here[0].constant === use.constant && here[0].id === use.id) return raw;
  layer.constantUses = [...uses.filter((u) => !sameSite(u.address, use.address)), use];
  return formatProject(project);
}

/**
 * Release a site, for the reason `bindConstant` gives — or one record, when the
 * operation predates sites and names only a use id. The distinction matters in
 * a file that still holds two uses at one site: an old unbind meant "this
 * record", and taking its neighbour with it would be a guess.
 */
export function unbindConstant(raw: string, layerIndex: number, site: UseSite): string {
  const project = parseProject(raw);
  const layer = project.layers[layerIndex];
  if (!layer?.constantUses?.some((u) => atSite(u, site))) return raw;

  layer.constantUses = layer.constantUses.filter((u) => !atSite(u, site));
  if (layer.constantUses.length === 0) delete layer.constantUses;
  return formatProject(project);
}

/** Which use an unbind means: every one at the address, or the one with the id. */
export type UseSite = { address: number; id?: string } | { address?: undefined; id: string };

const atSite = (use: { id?: string; address: number | string }, site: UseSite): boolean =>
  site.address !== undefined ? sameSite(use.address, site.address) : use.id === site.id;

/** One site under either spelling. */
const sameSite = (a: number | string, b: number | string): boolean =>
  parseProjectAddress(a) === parseProjectAddress(b);


/** Bind a site to a label, and release it. Idempotent, like the rest. */
export function bindLabel(raw: string, layerIndex: number, use: ProjectLabelUse): string {
  const project = parseProject(raw);
  const layer = project.layers[layerIndex];
  if (!layer) throw new Error(`No layer at index ${layerIndex} to own a label use`);

  const uses = (layer.labelUses ??= []);
  const here = uses.filter((u) => sameSite(u.address, use.address));
  if (here.length === 1 && here[0].label === use.label && here[0].id === use.id) return raw;
  layer.labelUses = [...uses.filter((u) => !sameSite(u.address, use.address)), use];
  return formatProject(project);
}

export function unbindLabel(raw: string, layerIndex: number, site: UseSite): string {
  const project = parseProject(raw);
  const layer = project.layers[layerIndex];
  if (!layer?.labelUses?.some((u) => atSite(u, site))) return raw;

  layer.labelUses = layer.labelUses.filter((u) => !atSite(u, site));
  if (layer.labelUses.length === 0) delete layer.labelUses;
  return formatProject(project);
}

/**
 * Set or clear a project-level field.
 *
 * Reserialises, like the other structural writers: there is no small diff to
 * preserve on a top-level scalar, and the only caller applying operations to
 * text reads the result to derive an inverse.
 */
export function setProjectMeta(
  raw: string,
  key: "name" | "description",
  value: string | undefined
): string {
  const project = parseProject(raw);
  if (project[key] === value) return raw;

  if (value === undefined) delete project[key];
  else project[key] = value;
  return formatProject(project);
}
