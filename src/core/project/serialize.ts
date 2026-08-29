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

import { Project, ProjectLabel } from "./project.js";
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
      const { labels, regions, ...scalars } = layer;
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

      return `    {\n${parts.join(",\n")}\n    }`;
    })
    .join(",\n");
  body.push(`  "layers": [\n${layers}\n  ]`);

  if (project.entryPoints?.length) {
    body.push(`  "entryPoints": [${project.entryPoints.map((e) => JSON.stringify(e)).join(", ")}]`);
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
  type?: ProjectLabel["type"]
): string {
  const addr = "$" + address.toString(16).toUpperCase().padStart(4, "0");
  // "address" is the default; recorded by absence, not written out.
  const typePart =
    type && type !== "address" ? `, "type": ${JSON.stringify(type)}` : "";
  return (
    `${indent}{ "id": ${JSON.stringify(id)}, "address": ${JSON.stringify(addr)}, ` +
    `"name": ${JSON.stringify(name)}${typePart} }`
  );
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
  layerIndex: number
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
    });
    return formatProject(project);
  }

  let done = false;
  for (let i = span.open; i <= span.close && !done; i++) {
    if (addressOfLine(lines[i]) !== address) continue;

    let line = lines[i].replace(/"name"\s*:\s*"(?:[^"\\]|\\.)*"/, `"name": ${JSON.stringify(name)}`);
    // A file written before ids existed self-migrates on its first edit.
    if (!/"id"\s*:/.test(line)) {
      line = line.replace(/\{\s*/, `{ "id": ${JSON.stringify(id)}, `);
    }
    if (type === "address") {
      // "address" is the default, so record it by absence rather than writing
      // it onto every label in the file.
      line = line.replace(/\s*,\s*"type"\s*:\s*"[^"]*"/, "");
    } else if (type !== undefined) {
      line = /"type"\s*:/.test(line)
        ? line.replace(/"type"\s*:\s*"[^"]*"/, `"type": ${JSON.stringify(type)}`)
        : line.replace(/\s*\}/, `, "type": ${JSON.stringify(type)} }`);
    }
    lines[i] = line;
    done = true;
  }

  if (!done) {
    const last = lastEntryLine(lines, span);
    const indent = /^(\s*)/.exec(lines[last] === lines[span.open] ? "    {" : lines[last])![1];

    // Insert before the first entry with a higher address, if the list is
    // ordered around here; otherwise append after the final entry.
    let insertAt = -1;
    for (let i = span.open + 1; i < span.close; i++) {
      const addr = addressOfLine(lines[i]);
      if (addr !== null && addr > address) {
        insertAt = i;
        break;
      }
    }

    if (insertAt === -1) {
      lines[last] = lines[last].replace(/,?\s*$/, ",");
      lines.splice(last + 1, 0, labelEntryLine(indent, id, address, name, type));
    } else {
      lines.splice(insertAt, 0, labelEntryLine(indent, id, address, name, type) + ",");
    }
  }

  const updated = lines.join("\n");
  parseProject(updated); // throws rather than returning something corrupt
  return updated;
}

/** Remove the label at an address, if present. */
export function deleteLabel(raw: string, address: number, layerIndex: number): string {
  const lines = raw.split("\n");
  const layer = findLayerSpan(lines, layerIndex);
  if (!layer) return raw;
  const span = findArraySpan(lines, "labels", layer.open, layer.close);
  if (!span) return raw;

  for (let i = span.open + 1; i < span.close; i++) {
    if (addressOfLine(lines[i]) !== address) continue;

    const wasLast = i === lastEntryLine(lines, span);
    lines.splice(i, 1);
    // Removing the final entry leaves a trailing comma on its predecessor.
    if (wasLast) {
      const newLast = lastEntryLine(lines, { open: span.open, close: span.close - 1 });
      if (newLast > span.open) lines[newLast] = lines[newLast].replace(/,\s*$/, "");
    }
    break;
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
