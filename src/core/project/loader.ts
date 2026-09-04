/**
 * Builds a MemoryMap from a parsed project.
 *
 * Shared by the CLI and the server, which previously each carried their own
 * copy of this logic and had already drifted apart in small ways.
 *
 * Layers are added bottom-up: the platform symbol layer first, then project
 * layers in declaration order, so a layer declared later shadows earlier ones.
 * Each layer takes ownership of its own labels and regions as it is built.
 */

import { BytesLayer, Layer } from "../memory/layer.js";
import { FileLayer } from "../memory/file-layer.js";
import { SymbolLayer } from "../memory/symbol-layer.js";
import { MemoryMap } from "../memory/memory-map.js";
import { LabelIndex, LabelUse } from "../memory/label.js";
import { CommentIndex } from "../memory/comment.js";
import { ConstantIndex } from "../memory/constant.js";
import { createC64PlatformLayer } from "../c64/symbols.js";
import {
  Project,
  ProjectLayer,
  parseProjectAddress,
  projectCommentsToComments,
  projectConstantUses,
  projectConstants,
  projectLabelUses,
  projectLabelsToLabels,
  projectRegionsToRegions,
} from "./project.js";
import { derivedId } from "./identity.js";

/** How the loader gets at file bytes, so core stays free of node:fs. */
export interface FileLoader {
  (path: string, explicitStart?: number): {
    start: number;
    data: Uint8Array;
    isPrg: boolean;
  };
}

export interface LoadedProject {
  project: Project;
  map: MemoryMap;
  /** Load addresses of PRG layers that did not suppress their entry point. */
  prgEntries: number[];
  /** Every user label across all layers, for entry point collection. */
  userLabels: LabelIndex;
  /**
   * Everything written about an address, across all layers.
   *
   * Flat rather than per-layer because rendering asks "what is said about this
   * address", and the answer does not depend on which layer holds it.
   */
  comments: CommentIndex;
  /** Names for values, and which operands mean them. */
  constants: ConstantIndex;
  /**
   * Built layers in *declaration* order, so index i corresponds to
   * project.layers[i]. The map itself stores them in z-order (reversed, with
   * the platform layer at the bottom), which is no use for writing edits back.
   */
  layers: Layer[];
}

function parseHexBytes(hex: string): Uint8Array {
  return new Uint8Array(hex.match(/.{2}/g)?.map((b) => parseInt(b, 16)) ?? []);
}

/** A readable layer name: the declared one, else the file basename, else an index. */
function layerName(layer: ProjectLayer, index: number): string {
  if (layer.name) return layer.name;
  if (layer.path) {
    const base = layer.path.split("/").pop() ?? layer.path;
    return base.replace(/\.[^.]+$/, "");
  }
  return `layer${index + 1}`;
}

/**
 * Build a memory map from a parsed project.
 *
 * `loadFile` supplies bytes; `platform` can be disabled for tests that want a
 * map containing nothing but the project's own layers.
 */
/**
 * The project as the selected target sees it.
 *
 * A target is a *view*: it narrows the layer stack and supplies the entry
 * points, and everything downstream — ownership, annotations, analysis — then
 * works on a project that simply has fewer layers. Filtering here rather than
 * inside the build keeps `layers[i]` corresponding to `project.layers[i]`,
 * which several things rely on.
 *
 * No target selected means every layer and the project's own entry points,
 * so a one-layer project declares nothing and behaves exactly as before.
 */
export function projectForTarget(project: Project): Project {
  const target = project.targets?.find((t) => t.name === project.activeTarget);
  if (!target) return project;

  const active = new Set(target.layers);
  return {
    ...project,
    // A symbols layer is never filtered out. It supplies no bytes, so it shadows
    // nothing and occupies no range, and a target is a view over *which bytes
    // you are reading* — there is nothing for it to say about a layer that has
    // none. Keeping it is also the only version that survives the offline test:
    // adding it to each target meant writing each target's whole layer list, so
    // two people naming an address at the same time would drop one another's
    // layers out of the view, and a name written offline would land in a target
    // made since.
    layers: project.layers.filter((l) => l.id && (l.type === "symbols" || active.has(l.id))),
    // The target's own list replaces the project's: the same field meaning two
    // things depending on whether a target is selected is how "entryPoints said
    // 2 while decodeStartsFrom said 19" happened.
    ...(target.entryPoints === undefined
      ? { entryPoints: undefined }
      : { entryPoints: target.entryPoints }),
  };
}

export function buildMemoryMap(
  project: Project,
  loadFile: FileLoader,
  options: { platform?: boolean } = {}
): LoadedProject {
  const map = new MemoryMap();
  const prgEntries: number[] = [];
  const userLabels = new LabelIndex();
  const comments = new CommentIndex();
  const constants = new ConstantIndex();
  // Held until the merged index exists: a site can name a label in any layer.
  const labelUses: LabelUse[] = [];
  constants.declareAll(projectConstants(project.constants));
  const layers: Layer[] = [];

  if (options.platform !== false) {
    map.addLayer(createC64PlatformLayer());
  }

  project.layers.forEach((decl, index) => {
    const name = layerName(decl, index);
    // Derived from position and source when absent: stable for a given file,
    // replaced by a real id on the next write.
    const layerId = decl.id ?? derivedId("lay", index, decl.type, decl.path ?? decl.name ?? "");
    let layer: Layer;

    if (decl.type === "prg") {
      const { start, data, isPrg } = loadFile(
        decl.path!,
        decl.address === undefined ? undefined : parseProjectAddress(decl.address)
      );
      const suppressEntry = decl.noAutoEntry ?? false;
      layer = new FileLayer(name, decl.path!, start, data, undefined, isPrg, suppressEntry, layerId);
      if (isPrg && !suppressEntry) prgEntries.push(start);
    } else if (decl.type === "raw") {
      const addr = parseProjectAddress(decl.address!);
      const { data } = loadFile(decl.path!, addr);
      layer = new FileLayer(name, decl.path!, addr, data, decl.length, false, false, layerId);
    } else if (decl.type === "bytes") {
      const addr = parseProjectAddress(decl.address!);
      layer = new BytesLayer(name, addr, parseHexBytes(decl.bytes!), decl.length, layerId);
    } else {
      layer = new SymbolLayer(name, projectLabelsToLabels(decl.labels ?? [], layerId), layerId);
    }

    if (decl.regions?.length) {
      layer.regions.addRegions(projectRegionsToRegions(decl.regions, layerId));
    }

    // A symbol layer receives its labels via the constructor; every other kind
    // takes ownership here, so they move with the layer on reorder.
    const labels = projectLabelsToLabels(decl.labels ?? [], layerId);
    if (decl.type !== "symbols") {
      layer.labels.push(...labels);
    }
    userLabels.addLabels(labels);
    comments.addAll(projectCommentsToComments(decl, layerId));
    constants.bindAll(projectConstantUses(decl, layerId));
    for (const use of projectLabelUses(decl, layerId)) {
      userLabels.bindUse(use.address, use.labelId);
      labelUses.push(use);
    }

    layers.push(layer);
    map.addLayer(layer);
  });

  for (const [address, labelId] of Object.entries(project.primaryLabels ?? {})) {
    map.primaryLabels.set(parseProjectAddress(address), labelId);
  }

  // Onto the map, not onto an index it hands out: `getLabels()` builds a fresh
  // one each call, so a binding set on the result would be thrown away.
  for (const use of labelUses) map.labelUses.set(use.address, use.labelId);

  return { project, map, prgEntries, userLabels, comments, constants, layers };
}
