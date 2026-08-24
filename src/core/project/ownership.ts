/**
 * Which layer should own an annotation.
 *
 * Labels nest inside their layer in the project file, so a write has to pick
 * one. The rule mirrors how the address resolves at read time.
 */

import { LoadedProject } from "./loader.js";

/**
 * Index into `project.layers` of the layer that should own a label here.
 *
 * The topmost layer supplying a byte at the address wins, matching how the
 * label will resolve once written. Addresses with no bytes — zero page, I/O
 * registers — fall to the first declared symbol layer, which is what that layer
 * type exists for. Undefined when neither applies, so the caller can say so
 * rather than writing the label somewhere arbitrary.
 */
export function resolveOwningLayer(
  loaded: LoadedProject,
  address: number
): number | undefined {
  const owner = loaded.map.layerAt(address);
  if (owner) {
    const index = loaded.layers.indexOf(owner);
    if (index >= 0) return index;
  }

  const symbols = loaded.project.layers.findIndex((l) => l.type === "symbols");
  return symbols >= 0 ? symbols : undefined;
}
