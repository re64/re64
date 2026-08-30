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
  Project,
  ProjectComment,
  ProjectConstant,
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

/**
 * Locate a top-level array's entry lines by bracket depth.
 *
 * Text-level rather than JSON-level because the file is hand-maintained: it
 * carries blank lines that group related labels, and those survive only if
 * edits touch individual lines instead of re-serializing the document.
 */
function findArraySpan(lines: string[], key: string, from = 0, until = lines.length): ArraySpan | null {
  const pattern = new RegExp(`"${key}"\\s*:\\s*\\[`);
  let open = -1;
  for (let i = from; i < until; i++) {
    if (pattern.test(lines[i])) {
      open = i;
      break;
    }
  }
  if (open === -1) return null;

  let depth = 0;
  for (let i = open; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) return { open, close: i };
      }
    }
  }
  return null;
}

/**
 * The line range of the Nth entry in the top-level "layers" array.
 *
 * Labels now nest inside their owning layer, so an edit has to be scoped to
 * that layer's block before its "labels" array can be found — otherwise a
 * write would land in whichever layer happens to declare one first.
 */
function findLayerSpan(lines: string[], layerIndex: number): ArraySpan | null {
  const layers = findArraySpan(lines, "layers");
  if (!layers) return null;

  let depth = 0;
  let index = -1;
  let open = -1;

  for (let i = layers.open; i <= layers.close; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") {
        if (depth === 0) {
          index++;
          if (index === layerIndex) open = i;
        }
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0 && index === layerIndex) {
          return { open, close: i };
        }
      }
    }
  }
  return null;
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
  encoding?: string
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
  return `${indent}{ ${parts.join(", ")} }`;
}

/**
 * Insert an entry line into an array span, in ascending order of a sort key.
 *
 * Shared by labels and regions: both lists are kept roughly sorted by address,
 * and appending out of order would make diffs harder to read than they need to
 * be.
 */
function insertEntry(
  lines: string[],
  span: ArraySpan,
  line: string,
  sortKey: number,
  keyOf: (line: string) => number | null
): void {
  let insertAt = -1;
  for (let i = span.open + 1; i < span.close; i++) {
    const key = keyOf(lines[i]);
    if (key !== null && key > sortKey) {
      insertAt = i;
      break;
    }
  }

  if (insertAt !== -1) {
    // Step back over blank lines so the entry joins the group above rather
    // than jumping the separator. Without this, undoing the deletion of an
    // entry that sat just above a blank line puts it back on the wrong side.
    while (insertAt > span.open + 1 && !lines[insertAt - 1].trim()) insertAt--;
    lines.splice(insertAt, 0, line + ",");
    return;
  }

  const last = lastEntryLine(lines, span);
  if (last === span.open) {
    // The array is empty: appending a comma to its opening bracket would
    // produce "[,". Insert straight after it instead.
    lines.splice(span.open + 1, 0, line);
    return;
  }
  lines[last] = lines[last].replace(/,?\s*$/, ",");
  lines.splice(last + 1, 0, line);
}

/** Index of the last line in the span that is an actual entry, not blank. */
function lastEntryLine(lines: string[], span: ArraySpan): number {
  for (let i = span.close - 1; i > span.open; i--) {
    if (lines[i].trim()) return i;
  }
  return span.open;
}

/**
 * Insert or rename a label, editing the raw text line-by-line.
 *
 * New labels go in address order where the surrounding list is sorted, which it
 * mostly is; otherwise they land at the end. Existing entries keep their
 * position so a rename produces a one-line diff.
 */
export function upsertLabel(
  raw: string,
  id: string,
  address: number,
  name: string,
  type: ProjectLabel["type"] | undefined,
  layerIndex: number,
  extent?: number
): string {
  const lines = raw.split("\n");
  const layer = findLayerSpan(lines, layerIndex);
  if (!layer) {
    throw new Error(`No layer at index ${layerIndex} to own a label at ${address.toString(16)}`);
  }
  const span = findArraySpan(lines, "labels", layer.open, layer.close);

  // The layer has no labels array yet — a structural write adds one. This
  // reformats the file, but only happens once per layer.
  if (!span) {
    const project = parseProject(raw);
    const decl = project.layers[layerIndex];
    (decl.labels ??= []).push({
      id,
      address: "$" + address.toString(16).toUpperCase().padStart(4, "0"),
      name,
      ...(type && type !== "address" ? { type } : {}),
      ...(extent === undefined ? {} : { extent }),
    });
    return formatProject(project);
  }

  // Identify by id: a rename changes the name, and several labels can share an
  // address, so neither identifies the line. An entry written before ids
  // existed is matched by address instead, and gains an id here.
  let target = findEntryById(lines, span, id);
  if (target < 0) {
    for (let i = span.open + 1; i < span.close; i++) {
      if (idOfLine(lines[i]) === null && addressOfLine(lines[i]) === address) {
        target = i;
        break;
      }
    }
  }

  if (target >= 0) {
    let line = lines[target].replace(
      /"name"\s*:\s*"(?:[^"\\]|\\.)*"/,
      `"name": ${JSON.stringify(name)}`
    );
    if (!/"id"\s*:/.test(line)) {
      line = line.replace(/\{\s*/, `{ "id": ${JSON.stringify(id)}, `);
    }
    if (type === "address") {
      // The default is recorded by absence, not written onto every label.
      line = line.replace(/\s*,\s*"type"\s*:\s*"[^"]*"/, "");
    } else if (type !== undefined) {
      line = /"type"\s*:/.test(line)
        ? line.replace(/"type"\s*:\s*"[^"]*"/, `"type": ${JSON.stringify(type)}`)
        : line.replace(/\s*\}/, `, "type": ${JSON.stringify(type)} }`);
    }
    // Absent extent is absent from the line, the way an "address" type is.
    if (extent === undefined) {
      line = line.replace(/\s*,\s*"extent"\s*:\s*\d+/, "");
    } else {
      line = /"extent"\s*:/.test(line)
        ? line.replace(/"extent"\s*:\s*\d+/, `"extent": ${extent}`)
        : line.replace(/\s*\}/, `, "extent": ${extent} }`);
    }
    lines[target] = line;
  } else {
    const last = lastEntryLine(lines, span);
    const indent = /^(\s*)/.exec(lines[last] === lines[span.open] ? "        {" : lines[last])![1];
    insertEntry(
      lines,
      span,
      labelEntryLine(indent, id, address, name, type, extent),
      address,
      addressOfLine
    );
  }

  const updated = lines.join("\n");
  parseProject(updated); // throws rather than returning something corrupt
  return updated;
}

/** Remove the label at an address, if present. */
export function deleteLabel(raw: string, id: string, layerIndex: number): string {
  const lines = raw.split("\n");
  const layer = findLayerSpan(lines, layerIndex);
  if (!layer) return raw;
  const span = findArraySpan(lines, "labels", layer.open, layer.close);
  if (!span) return raw;

  // By id only. An un-migrated entry has no id to match, and deleting "the
  // first line without one" would remove an arbitrary label — the caller
  // migrates first instead.
  const at = findEntryById(lines, span, id);
  if (at < 0) return raw;

  const wasLast = at === lastEntryLine(lines, span);
  lines.splice(at, 1);
  if (wasLast) {
    const newLast = lastEntryLine(lines, { open: span.open, close: span.close - 1 });
    if (newLast > span.open) lines[newLast] = lines[newLast].replace(/,\s*$/, "");
  }

  const updated = lines.join("\n");
  parseProject(updated);
  return updated;
}

const START_IN_LINE = /"start"\s*:\s*(?:"(\$|0x)?([0-9A-Fa-f]+)"|(\d+))/;

/** The start address an entry line declares, or null. */
function startOfLine(line: string): number | null {
  const m = START_IN_LINE.exec(line);
  if (!m) return null;
  if (m[3] !== undefined) return parseInt(m[3], 10);
  return parseInt(m[2], m[1] === undefined ? 10 : 16);
}

/** Create or replace a region, identified by id. */
export function upsertRegion(
  raw: string,
  layerIndex: number,
  region: {
    id: string;
    start: number;
    end: number;
    kind: string;
    name?: string;
    comment?: string;
    encoding?: string;
  }
): string {
  const lines = raw.split("\n");
  const layer = findLayerSpan(lines, layerIndex);
  if (!layer) throw new Error(`No layer at index ${layerIndex}`);

  const span = findArraySpan(lines, "regions", layer.open, layer.close);

  // No regions array yet: a structural write adds one. Reformats the file, but
  // only ever once per layer.
  if (!span) {
    const project = parseProject(raw);
    const decl = project.layers[layerIndex];
    (decl.regions ??= []).push({
      id: region.id,
      start: "$" + region.start.toString(16).toUpperCase().padStart(4, "0"),
      end: "$" + region.end.toString(16).toUpperCase().padStart(4, "0"),
      kind: region.kind as never,
      ...(region.name !== undefined ? { name: region.name } : {}),
      ...(region.comment !== undefined ? { comment: region.comment } : {}),
    });
    return formatProject(project);
  }

  // With no entries left, the bracket line's indent is the array's, not an
  // entry's — nest one level in from it.
  const last = lastEntryLine(lines, span);
  const indent =
    last === span.open
      ? /^(\s*)/.exec(lines[span.open])![1] + "  "
      : /^(\s*)/.exec(lines[last])![1];

  const line = regionEntryLine(
    indent,
    region.id,
    region.start,
    region.end,
    region.kind,
    region.name,
    region.comment,
    region.encoding
  );

  const at = findEntryById(lines, span, region.id);
  if (at >= 0) {
    // Keep whatever separator the line already carried.
    lines[at] = line + (lines[at].trimEnd().endsWith(",") ? "," : "");
  } else {
    insertEntry(lines, span, line, region.start, startOfLine);
  }

  const updated = lines.join("\n");
  parseProject(updated);
  return updated;
}

/** Remove a region by id. */
export function deleteRegion(raw: string, layerIndex: number, id: string): string {
  const lines = raw.split("\n");
  const layer = findLayerSpan(lines, layerIndex);
  if (!layer) return raw;
  const span = findArraySpan(lines, "regions", layer.open, layer.close);
  if (!span) return raw;

  const at = findEntryById(lines, span, id);
  if (at < 0) return raw;

  const wasLast = at === lastEntryLine(lines, span);
  lines.splice(at, 1);
  if (wasLast) {
    const newLast = lastEntryLine(lines, { open: span.open, close: span.close - 1 });
    if (newLast > span.open) lines[newLast] = lines[newLast].replace(/,\s*$/, "");
  }

  const updated = lines.join("\n");
  parseProject(updated);
  return updated;
}

const HEX4 = (n: number) => "$" + n.toString(16).toUpperCase().padStart(4, "0");

/**
 * Promote a label at an address, or clear the choice by passing undefined.
 *
 * The block is created on first use and removed when it empties, so a project
 * that never promotes anything carries no trace of the feature.
 */
export function setPrimaryLabel(
  raw: string,
  address: number,
  labelId: string | undefined
): string {
  const lines = raw.split("\n");
  const key = HEX4(address);
  const open = lines.findIndex((l) => /"primaryLabels"\s*:\s*\{/.test(l));

  if (open === -1) {
    if (labelId === undefined) return raw;
    // No block yet: add one before the closing brace of the document.
    const close = lines.length - 1 - [...lines].reverse().findIndex((l) => l.trim() === "}");
    lines[close - 1] = lines[close - 1].replace(/,?\s*$/, ",");
    lines.splice(close, 0,
      `  "primaryLabels": {`,
      `    ${JSON.stringify(key)}: ${JSON.stringify(labelId)}`,
      `  }`);
    const created = lines.join("\n");
    parseProject(created);
    return created;
  }

  let close = open;
  let depth = 0;
  for (let i = open; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    if (depth === 0) { close = i; break; }
  }

  const at = lines.findIndex(
    (l, i) => i > open && i < close && l.includes(JSON.stringify(key) + ":")
  );

  if (labelId === undefined) {
    if (at === -1) return raw;
    lines.splice(at, 1);
    // An empty block is noise; drop it entirely.
    const remaining = lines.slice(open + 1, close - 1).filter((l) => l.trim());
    if (remaining.length === 0) {
      lines.splice(open, 2);
      const prev = open - 1;
      if (prev >= 0) lines[prev] = lines[prev].replace(/,\s*$/, "");
    } else {
      const last = close - 2;
      if (lines[last]) lines[last] = lines[last].replace(/,\s*$/, "");
    }
  } else if (at >= 0) {
    lines[at] = lines[at].replace(
      /:\s*"[^"]*"/,
      `: ${JSON.stringify(labelId)}`
    );
  } else {
    const last = close - 1;
    lines[last] = lines[last].replace(/,?\s*$/, ",");
    lines.splice(last + 1, 0, `    ${JSON.stringify(key)}: ${JSON.stringify(labelId)}`);
  }

  const updated = lines.join("\n");
  parseProject(updated);
  return updated;
}

/**
 * Write ids onto every layer, label, and region that lacks one.
 *
 * Files stay loadable without ids — the loader derives them — but derived ids
 * depend on position and content, so they shift if a label is renamed or a
 * layer reordered. Persisting them makes identity permanent, which is what
 * edits and merge rely on.
 *
 * Line-level like every other write here, so a migration diff shows exactly one
 * insertion per entry and leaves grouping and formatting untouched.
 */
export function migrateIds(
  raw: string,
  mint: (prefix: "lbl" | "rgn" | "lay") => string
): string {
  const lines = raw.split("\n");
  const layers = findArraySpan(lines, "layers");
  if (layers === null) return raw;

  const hasId = (line: string) => /"id"\s*:/.test(line);
  const indentOf = (line: string) => /^(\s*)/.exec(line)![1];

  const out: string[] = [];
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const inLayers = i >= layers.open && i <= layers.close;

    if (inLayers && !hasId(line)) {
      // A layer opens with a lone brace and its fields expanded one per line,
      // so its id goes on a line of its own to match. Labels and regions are
      // single-line objects, so theirs goes inline.
      // A layer's id sits on the line *after* its brace, so look ahead rather
      // than at the brace itself, or a second run would add a duplicate.
      if (line.trim() === "{" && depth === 1 && !hasId(lines[i + 1] ?? "")) {
        out.push(line);
        out.push(`${indentOf(line)}  "id": ${JSON.stringify(mint("lay"))},`);
        depth += 1;
        continue;
      }
      if (/"address"\s*:/.test(line)) {
        out.push(line.replace(/\{\s*/, `{ "id": ${JSON.stringify(mint("lbl"))}, `));
        for (const ch of line) depth += ch === "{" ? 1 : ch === "}" ? -1 : 0;
        continue;
      }
      if (/"start"\s*:/.test(line)) {
        out.push(line.replace(/\{\s*/, `{ "id": ${JSON.stringify(mint("rgn"))}, `));
        for (const ch of line) depth += ch === "{" ? 1 : ch === "}" ? -1 : 0;
        continue;
      }
    }

    out.push(line);
    for (const ch of line) depth += ch === "{" ? 1 : ch === "}" ? -1 : 0;
  }

  const updated = out.join("\n");
  parseProject(updated); // refuse to hand back something that will not load
  return updated;
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

export function deleteConstant(raw: string, id: string): string {
  const project = parseProject(raw);
  if (!project.constants?.some((c) => c.id === id)) return raw;

  project.constants = project.constants.filter((c) => c.id !== id);
  if (project.constants.length === 0) delete project.constants;
  return formatProject(project);
}

export function bindConstant(
  raw: string,
  layerIndex: number,
  use: ProjectConstantUse
): string {
  const project = parseProject(raw);
  const layer = project.layers[layerIndex];
  if (!layer) throw new Error(`No layer at index ${layerIndex} to own a constant use`);

  const uses = (layer.constantUses ??= []);
  const at = uses.findIndex((u) => u.id === use.id);
  if (at >= 0) {
    if (uses[at].constant === use.constant && uses[at].address === use.address) return raw;
    uses[at] = use;
  } else {
    uses.push(use);
  }
  return formatProject(project);
}

export function unbindConstant(raw: string, layerIndex: number, id: string): string {
  const project = parseProject(raw);
  const layer = project.layers[layerIndex];
  if (!layer?.constantUses?.some((u) => u.id === id)) return raw;

  layer.constantUses = layer.constantUses.filter((u) => u.id !== id);
  if (layer.constantUses.length === 0) delete layer.constantUses;
  return formatProject(project);
}


/** Bind a site to a label, and release it. Idempotent, like the rest. */
export function bindLabel(raw: string, layerIndex: number, use: ProjectLabelUse): string {
  const project = parseProject(raw);
  const layer = project.layers[layerIndex];
  if (!layer) throw new Error(`No layer at index ${layerIndex} to own a label use`);

  const uses = (layer.labelUses ??= []);
  const at = uses.findIndex((u) => u.id === use.id);
  if (at >= 0) {
    if (uses[at].label === use.label && uses[at].address === use.address) return raw;
    uses[at] = use;
  } else {
    uses.push(use);
  }
  return formatProject(project);
}

export function unbindLabel(raw: string, layerIndex: number, id: string): string {
  const project = parseProject(raw);
  const layer = project.layers[layerIndex];
  if (!layer?.labelUses?.some((u) => u.id === id)) return raw;

  layer.labelUses = layer.labelUses.filter((u) => u.id !== id);
  if (layer.labelUses.length === 0) delete layer.labelUses;
  return formatProject(project);
}
