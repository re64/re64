/**
 * Write commands.
 *
 * The headless edit surface: an agent drives these — or `apply` with a batch of
 * operations — without a browser. Every change goes through the same operation
 * layer the UI uses, and is recorded beside the project so `undo` works across
 * invocations.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { writeFileAtomic } from "../fsutil.js";
import {
  Change,
  LabelType,
  Op,
  RegionKind,
  applyOp,
  decodeChanges,
  describeOp,
  encodeChanges,
  invertOp,
  newId,
  parseProject,
  parseProjectAddress,
  resolveOwningLayer,
} from "../core/index.js";
import { loadProjectFile } from "../node-files.js";

/** Where a project's edit log lives. */
export const logPathFor = (projectPath: string) => `${projectPath}.log`;

function readLog(projectPath: string): Change[] {
  const path = logPathFor(projectPath);
  return existsSync(path) ? decodeChanges(readFileSync(path, "utf-8")) : [];
}

function writeLog(projectPath: string, changes: readonly Change[]): void {
  writeFileSync(logPathFor(projectPath), encodeChanges(changes), "utf-8");
}

/**
 * Apply operations, record them, and write both files.
 *
 * Inverses are computed as the batch runs, because each one has to see the
 * state its operation saw — computing them all up front would invert against
 * the wrong document.
 */
export function runOps(
  projectPath: string,
  ops: readonly Op[],
  author: string,
  now: number
): { applied: number; descriptions: string[] } {
  let text = readFileSync(projectPath, "utf-8");
  const log = readLog(projectPath);
  const descriptions: string[] = [];

  for (const op of ops) {
    const inverse = invertOp(text, op);
    text = applyOp(text, op);
    log.push({ op, inverse, author, at: now });
    descriptions.push(describeOp(op));
  }

  writeFileAtomic(projectPath, text);
  writeLog(projectPath, log);
  return { applied: ops.length, descriptions };
}

/** Undo the most recent change that has not been undone. */
export function undoLast(projectPath: string): string | null {
  const log = readLog(projectPath);
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].undone) continue;
    const text = applyOp(readFileSync(projectPath, "utf-8"), log[i].inverse);
    writeFileAtomic(projectPath, text);
    log[i].undone = true;
    writeLog(projectPath, log);
    return describeOp(log[i].op);
  }
  return null;
}

/** Redo the most recently undone change. */
export function redoLast(projectPath: string): string | null {
  const log = readLog(projectPath);
  for (let i = log.length - 1; i >= 0; i--) {
    if (!log[i].undone) continue;
    const text = applyOp(readFileSync(projectPath, "utf-8"), log[i].op);
    writeFileAtomic(projectPath, text);
    log[i].undone = false;
    writeLog(projectPath, log);
    return describeOp(log[i].op);
  }
  return null;
}

/**
 * The layer that should own an annotation at an address, by id.
 *
 * Loads the project properly rather than guessing from the schema: a PRG
 * layer's range comes from the file's load header, not from any declared
 * address, so nothing in the JSON alone says where it sits.
 */
export function owningLayerId(projectPath: string, address: number): string {
  const loaded = loadProjectFile(projectPath);
  const index = resolveOwningLayer(loaded, address);
  if (index === undefined) {
    throw new Error(
      `No layer owns ${address.toString(16).toUpperCase()}. Add a layer of ` +
        `type "symbols" to name addresses outside the loaded bytes.`
    );
  }
  const id = loaded.project.layers[index].id;
  if (!id) throw new Error(`Layer ${index} has no id; run: re64 migrate ${projectPath}`);
  return id;
}

/** Build a label.set op, reusing the id already at that address if there is one. */
export function labelSetOp(
  projectPath: string,
  layerId: string,
  address: number,
  name: string,
  type?: LabelType,
  comment?: string
): Op {
  const project = parseProject(readFileSync(projectPath, "utf-8"));
  const layer = project.layers.find((l) => l.id === layerId);
  const existing = layer?.labels?.find((l) => parseProjectAddress(l.address) === address);

  return {
    op: "label.set",
    id: existing?.id ?? newId("lbl"),
    layerId,
    address,
    name,
    type,
    comment,
  };
}

/** Build a region.set op, reusing the id of a region with the same start. */
export function regionSetOp(
  projectPath: string,
  layerId: string,
  start: number,
  end: number,
  kind: RegionKind,
  name?: string
): Op {
  const project = parseProject(readFileSync(projectPath, "utf-8"));
  const layer = project.layers.find((l) => l.id === layerId);
  const existing = layer?.regions?.find((r) => parseProjectAddress(r.start) === start);

  return {
    op: "region.set",
    id: existing?.id ?? newId("rgn"),
    layerId,
    start,
    end,
    kind,
    name,
  };
}
