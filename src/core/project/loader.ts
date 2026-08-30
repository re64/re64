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
import { LabelIndex } from "../memory/label.js";
import { CommentIndex } from "../memory/comment.js";
import { createC64PlatformLayer } from "../c64/symbols.js";
import {
  Project,
  ProjectLayer,
  parseProjectAddress,
  projectCommentsToComments,
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
export function buildMemoryMap(
  project: Project,
  loadFile: FileLoader,
  options: { platform?: boolean } = {}
): LoadedProject {
  const map = new MemoryMap();
  const prgEntries: number[] = [];
  const userLabels = new LabelIndex();
  const comments = new CommentIndex();
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

    layers.push(layer);
    map.addLayer(layer);
  });

  for (const [address, labelId] of Object.entries(project.primaryLabels ?? {})) {
    map.primaryLabels.set(parseProjectAddress(address), labelId);
  }

  return { project, map, prgEntries, userLabels, comments, layers };
}
