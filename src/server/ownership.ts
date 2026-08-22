/**
 * Deciding which layer should own an annotation.
 *
 * Labels nest inside their layer in the project file, so a write has to pick
 * one. The rule mirrors how the address resolves at read time.
 */

import { loadProject } from "./analysis.js";

/**
 * Index into `project.layers` of the layer that should own a label here.
 *
 * The topmost layer supplying a byte at the address wins, matching how the
 * label will resolve once written. Addresses with no bytes — zero page, I/O
 * registers — fall to the first declared symbol layer, which is exactly what
 * that layer type exists for. Returns undefined when neither applies, so the
 * caller can say so rather than writing the label somewhere arbitrary.
 */
export function resolveOwningLayer(
  projectPath: string,
  address: number
): number | undefined {
  const loaded = loadProject(projectPath);

  const owner = loaded.map.layerAt(address);
  if (owner) {
    const index = loaded.layers.indexOf(owner);
    if (index >= 0) return index;
  }

  const symbols = loaded.project.layers.findIndex((l) => l.type === "symbols");
  return symbols >= 0 ? symbols : undefined;
}
