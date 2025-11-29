import { Layer } from "./layer.js";

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
}
