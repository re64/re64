/**
 * The layer stack and region tree, shaped for display.
 *
 * Two different relationships, so two different shapes: layers stack by
 * z-order, which is a list; regions contain one another by address range,
 * which is a tree. The tree is derived here rather than stored, because a
 * stored hierarchy would make concurrent edits reparent nodes — the flat model
 * exists precisely to avoid that.
 */

import { Layer, Region } from "../index.js";
import { LoadedProject } from "../index.js";

export interface RegionNode {
  start: number;
  end: number;
  kind: string;
  name?: string;
  comment?: string;
  /** Regions wholly contained in this one. */
  children: RegionNode[];
}

export interface LayerView {
  /**
   * Height in the stack: 0 is the bottom, higher numbers sit on top and
   * shadow what is below.
   *
   * Deliberately not `MemoryMap`'s array index, which counts from the top
   * because that is the order bytes are searched. Exposing that would put the
   * platform layer — the foundation everything rests on — at the highest
   * number, and would read in the opposite order to the project file, where
   * layers are declared bottom-up.
   */
  level: number;
  name: string;
  start: number;
  end: number;
  hasBytes: boolean;
  defaultKind: string;
  /** Where the bytes came from, for display. */
  source: string;
  labelCount: number;
  regions: RegionNode[];
}

export interface MapView {
  layers: LayerView[];
}

/**
 * Nest regions by containment.
 *
 * Sorted widest-first so a container is always seen before the regions inside
 * it; each region then attaches to the innermost open ancestor. Regions that
 * merely overlap without containment stay siblings, which is the honest
 * rendering — the model permits it and hiding it would mislead.
 */
export function buildRegionTree(regions: readonly Region[]): RegionNode[] {
  const sorted = [...regions].sort(
    (a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start
  );

  const roots: RegionNode[] = [];

  for (const region of sorted) {
    const node: RegionNode = {
      start: region.start,
      end: region.end,
      kind: region.kind,
      name: region.name,
      comment: region.comment,
      children: [],
    };

    let siblings = roots;
    for (;;) {
      const parent = siblings.find(
        (c) => region.start >= c.start && region.end <= c.end
      );
      if (!parent) break;
      siblings = parent.children;
    }
    siblings.push(node);
  }

  const byAddress = (nodes: RegionNode[]): RegionNode[] => {
    nodes.sort((a, b) => a.start - b.start);
    nodes.forEach((n) => byAddress(n.children));
    return nodes;
  };

  return byAddress(roots);
}

/** How a layer's content was obtained, in one line. */
function describeSource(layer: Layer, declared?: { type: string; path?: string }): string {
  if (!declared) return "built-in";
  switch (declared.type) {
    case "prg":
      return declared.path?.includes(".d64:")
        ? `disk image · ${declared.path}`
        : `PRG · ${declared.path ?? "?"}`;
    case "raw":
      return `raw file · ${declared.path ?? "?"}`;
    case "bytes":
      return "inline bytes";
    case "symbols":
      return "symbols · no bytes";
    default:
      return declared.type;
  }
}

/** Build the display model for a loaded project. */
export function buildMapView(loaded: LoadedProject): MapView {
  // The map holds layers in z-order; the project declares them bottom-up, and
  // the platform layer is in the map but not in the declarations.
  const declarationIndex = new Map(loaded.layers.map((l, i) => [l, i]));

  // Bottom-up, matching the project file's declaration order.
  const stack = [...loaded.map.getLayers()].reverse();

  const layers = stack.map((layer, level) => {
    const declared = declarationIndex.has(layer)
      ? loaded.project.layers[declarationIndex.get(layer)!]
      : undefined;

    return {
      level,
      name: layer.name,
      start: layer.start,
      end: layer.end,
      hasBytes: layer.hasBytes,
      defaultKind: layer.defaultRegionKind,
      source: describeSource(layer, declared),
      labelCount: layer.getLabels().length,
      regions: buildRegionTree(layer.regions.getAllRegions()),
    };
  });

  return { layers };
}
