/**
 * The layer stack and region tree, shaped for display.
 *
 * Two different relationships, so two different shapes: layers stack by
 * z-order, which is a list; regions contain one another by address range,
 * which is a tree. The tree is derived here rather than stored, because a
 * stored hierarchy would make concurrent edits reparent nodes — the flat model
 * exists precisely to avoid that.
 */

import { Layer } from "../index.js";
import { Claim } from "../claims/model.js";
import { LoadedProject } from "../index.js";
import { splitD64Path } from "../project/file-source.js";

export interface RegionNode {
  id: string;
  start: number;
  end: number;
  /**
   * What the claim says these bytes are, or `"code"` where it says nothing.
   *
   * A claim with a root and no interpretation is somewhere the program is
   * decoded from, which is what the old `code` region kind meant — so the
   * sidebar still has a word for it even though the model does not.
   */
  kind: string;
  name?: string;
  /**
   * What somebody wrote about where this claim starts.
   *
   * A comment is its own object now rather than a field on the span — so this
   * is looked up rather than carried, and it is the same text the listing shows
   * above that address. The sidebar showing one thing and the listing another
   * would be two answers to one question.
   */
  comment?: string;
  /** Claims wholly contained in this one. */
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
 * Nest claims by containment.
 *
 * Sorted widest-first so a container is always seen before the claims inside
 * it; each then attaches to the innermost open ancestor. Claims that merely
 * overlap without containment stay siblings, which is the honest rendering —
 * the model permits it and hiding it would mislead.
 *
 * Containment is refinement and is exactly what the sidebar should show: an 8K
 * table and a 40-byte name inside it are both true, and the nesting is what
 * makes that legible rather than looking like a contradiction.
 */
export function buildRegionTree(
  claims: readonly Claim[],
  commentAt?: (address: number) => string | undefined
): RegionNode[] {
  const spanOf = (c: Claim) => ({ start: c.at, end: c.at + (c.extent ?? 1) });
  const sorted = [...claims].sort((a, b) => {
    const [x, y] = [spanOf(a), spanOf(b)];
    return y.end - y.start - (x.end - x.start) || x.start - y.start;
  });

  const roots: RegionNode[] = [];

  for (const claim of sorted) {
    const { start, end } = spanOf(claim);
    const node: RegionNode = {
      id: claim.id,
      start,
      end,
      kind: claim.says?.is ?? "code",
      name: claim.name,
      ...(commentAt?.(claim.at) ? { comment: commentAt(claim.at) } : {}),
      children: [],
    };

    let siblings = roots;
    for (;;) {
      const parent = siblings.find((c) => start >= c.start && end <= c.end);
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
      return declared.path !== undefined && splitD64Path(declared.path)
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
  // Claims belong to no layer, so the sidebar routes each to the layer that
  // supplies its bytes — the same z-order rule `readByte` follows, and the
  // reason reordering the stack moves annotations with the content they
  // describe. A claim covering an address nothing supplies belongs to no layer
  // and appears under none, which is honest: there is no byte for it to sit on.
  const firstComment = (address: number): string | undefined =>
    loaded.comments.at(address, "before")[0]?.text;

  const claimsByLayer = new Map<Layer, Claim[]>();
  for (const claim of loaded.claims) {
    // A claim that says nothing about a span — a bare name — is not a region
    // and has no business in a containment tree.
    if (claim.says === undefined && claim.root === undefined) continue;
    const layer = loaded.map.layerAt(claim.at);
    if (!layer) continue;
    const held = claimsByLayer.get(layer);
    if (held) held.push(claim);
    else claimsByLayer.set(layer, [claim]);
  }

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
      regions: buildRegionTree(claimsByLayer.get(layer) ?? [], firstComment),
    };
  });

  return { layers };
}
