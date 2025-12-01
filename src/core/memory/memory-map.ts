import { Layer } from "./layer.js";
import { Label, LabelIndex, createLayerLabel } from "./label.js";
import { Region, RegionIndex, createLayerRegion } from "./region.js";

export interface ReadResult {
  value: number;
  layer: Layer;
}

/**
 * A stack of memory layers. Index 0 is the top (highest priority).
 * When reading, the first layer containing the address wins.
 */
export class MemoryMap {
  private layers: Layer[] = [];

  getLayers(): readonly Layer[] {
    return this.layers;
  }

  getLayerCount(): number {
    return this.layers.length;
  }

  /** Adds a layer. Defaults to top (index 0) if index not specified. */
  addLayer(layer: Layer, index?: number): void {
    if (index === undefined) {
      this.layers.unshift(layer);
    } else {
      if (index < 0 || index > this.layers.length) {
        throw new Error("Index out of bounds");
      }
      this.layers.splice(index, 0, layer);
    }
  }

  removeLayer(index: number): Layer {
    if (index < 0 || index >= this.layers.length) {
      throw new Error("Index out of bounds");
    }
    return this.layers.splice(index, 1)[0];
  }

  moveLayer(fromIndex: number, toIndex: number): void {
    if (fromIndex < 0 || fromIndex >= this.layers.length) {
      throw new Error("fromIndex out of bounds");
    }
    if (toIndex < 0 || toIndex >= this.layers.length) {
      throw new Error("toIndex out of bounds");
    }
    const [layer] = this.layers.splice(fromIndex, 1);
    this.layers.splice(toIndex, 0, layer);
  }

  readByte(address: number): number | undefined {
    for (const layer of this.layers) {
      const value = layer.readByte(address);
      if (value !== undefined) {
        return value;
      }
    }
    return undefined;
  }

  readByteWithSource(address: number): ReadResult | undefined {
    for (const layer of this.layers) {
      const value = layer.readByte(address);
      if (value !== undefined) {
        return { value, layer };
      }
    }
    return undefined;
  }

  readBytes(address: number, length: number): (number | undefined)[] {
    const result: (number | undefined)[] = [];
    for (let i = 0; i < length; i++) {
      result.push(this.readByte(address + i));
    }
    return result;
  }

  /**
   * Get all labels from all layers plus auto-generated span labels.
   * Span labels mark where the effective layer changes in the flattened memory map.
   */
  getLabels(): LabelIndex {
    const index = new LabelIndex();

    // Collect labels from all layers
    for (const layer of this.layers) {
      index.addLabels(layer.getLabels());
    }

    // Generate span labels for layer boundaries in the flattened view
    const spanLabels = this.generateSpanLabels();
    index.addLabels(spanLabels);

    return index;
  }

  /**
   * Generate labels for each address where the effective layer changes.
   * This helps identify layer boundaries in hex dumps.
   */
  private generateSpanLabels(): Label[] {
    const labels: Label[] = [];
    const regions = this.generateRegions();

    for (const region of regions) {
      if (region.name) {
        labels.push(
          createLayerLabel(
            region.start,
            region.name,
            "address",
            region.source.layerName ?? "unknown"
          )
        );
      }
    }

    return labels;
  }

  /**
   * Get auto-generated regions from layer coverage.
   * Each contiguous span from a single layer becomes a region.
   */
  getRegions(): RegionIndex {
    const index = new RegionIndex();
    const regions = this.generateRegions();
    index.addRegions(regions);
    return index;
  }

  /**
   * Generate regions for each contiguous span from a single layer.
   */
  private generateRegions(): Region[] {
    const regions: Region[] = [];

    if (this.layers.length === 0) {
      return regions;
    }

    const minStart = Math.min(...this.layers.map((l) => l.start));
    const maxEnd = Math.max(...this.layers.map((l) => l.end));

    let regionStart: number | undefined;
    let prevLayer: Layer | undefined;

    for (let addr = minStart; addr <= maxEnd; addr++) {
      const result = addr < maxEnd ? this.readByteWithSource(addr) : undefined;
      const currentLayer = result?.layer;

      if (currentLayer !== prevLayer) {
        // End previous region
        if (prevLayer && regionStart !== undefined) {
          const offset = regionStart - prevLayer.start;
          const offsetHex = offset.toString(16).toUpperCase().padStart(4, "0");
          regions.push(
            createLayerRegion(
              regionStart,
              addr,
              prevLayer.defaultRegionKind,
              prevLayer.name,
              `${prevLayer.name}+$${offsetHex}`
            )
          );
        }

        // Start new region
        if (currentLayer) {
          regionStart = addr;
        } else {
          regionStart = undefined;
        }
        prevLayer = currentLayer;
      }
    }

    return regions;
  }
}
