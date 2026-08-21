/**
 * Reading and writing `.re64` project files from the server.
 *
 * Project files are hand-edited and tracked in git, so writes must preserve the
 * house style: one label/region per line, compact objects. `JSON.stringify`
 * with plain indentation would explode every entry across five lines and turn
 * any single-label edit into a whole-file diff.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { Project, ProjectLabel, parseProject, parseProjectAddress } from "../core/index.js";

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

  // Layers stay in expanded form; there are few of them and they read better.
  const layers = project.layers
    .map((l) =>
      JSON.stringify(l, null, 2)
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n")
    )
    .join(",\n");
  body.push(`  "layers": [\n${layers}\n  ]`);

  if (project.entryPoints?.length) {
    body.push(`  "entryPoints": [${project.entryPoints.map((e) => JSON.stringify(e)).join(", ")}]`);
  }

  if (project.regions?.length) {
    const regions = project.regions
      .map((r) => `    ${compactObject(r as unknown as Record<string, unknown>)}`)
      .join(",\n");
    body.push(`  "regions": [\n${regions}\n  ]`);
  }

  if (project.labels?.length) {
    const labels = project.labels
      .map((l) => `    ${compactObject(l as unknown as Record<string, unknown>)}`)
      .join(",\n");
    body.push(`  "labels": [\n${labels}\n  ]`);
  }

  lines.push(body.join(",\n"));
  lines.push("}");
  return lines.join("\n") + "\n";
}

export function readProjectFile(path: string): { project: Project; raw: string } {
  const raw = readFileSync(path, "utf-8");
  return { project: parseProject(raw), raw };
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
function findArraySpan(lines: string[], key: string): ArraySpan | null {
  const open = lines.findIndex((l) => new RegExp(`"${key}"\\s*:\\s*\\[`).test(l));
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
  address: number,
  name: string,
  type?: ProjectLabel["type"]
): string {
  const addr = `$${address.toString(16).toUpperCase().padStart(4, "0")}`;
  // "address" is the default; recorded by absence, not written out.
  const typePart =
    type && type !== "address" ? `, "type": ${JSON.stringify(type)}` : "";
  return `${indent}{ "address": ${JSON.stringify(addr)}, "name": ${JSON.stringify(name)}${typePart} }`;
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
  path: string,
  address: number,
  name: string,
  type?: ProjectLabel["type"]
): Project {
  const raw = readFileSync(path, "utf-8");
  const lines = raw.split("\n");
  const span = findArraySpan(lines, "labels");

  // No labels array yet — fall back to a structural write.
  if (!span) {
    const project = parseProject(raw);
    (project.labels ??= []).push({
      address: `$${address.toString(16).toUpperCase().padStart(4, "0")}`,
      name,
      ...(type ? { type } : {}),
    });
    writeFileSync(path, formatProject(project), "utf-8");
    return project;
  }

  let done = false;
  for (let i = span.open; i <= span.close && !done; i++) {
    if (addressOfLine(lines[i]) !== address) continue;

    let line = lines[i].replace(/"name"\s*:\s*"(?:[^"\\]|\\.)*"/, `"name": ${JSON.stringify(name)}`);
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
      lines.splice(last + 1, 0, labelEntryLine(indent, address, name, type));
    } else {
      lines.splice(insertAt, 0, labelEntryLine(indent, address, name, type) + ",");
    }
  }

  const updated = lines.join("\n");
  const project = parseProject(updated); // throws before writing if we corrupted it
  writeFileSync(path, updated, "utf-8");
  return project;
}

/** Remove the label at an address, if present. */
export function deleteLabel(path: string, address: number): Project {
  const raw = readFileSync(path, "utf-8");
  const lines = raw.split("\n");
  const span = findArraySpan(lines, "labels");
  if (!span) return parseProject(raw);

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
  const project = parseProject(updated);
  writeFileSync(path, updated, "utf-8");
  return project;
}

/** Replace the whole project file, validating that it parses first. */
export function writeProjectRaw(path: string, raw: string): Project {
  const project = parseProject(raw);
  writeFileSync(path, raw.endsWith("\n") ? raw : raw + "\n", "utf-8");
  return project;
}
