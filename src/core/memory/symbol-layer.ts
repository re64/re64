import { Layer } from "./layer.js";
import { Label } from "./label.js";
import { RegionIndex, RegionKind } from "./region.js";
import { newId } from "../project/identity.js";

/**
 * A layer that carries names but no bytes.
 *
 * Not every annotation describes loaded content. Zero-page variables, I/O
 * registers and KERNAL entry points are facts about the *address space*, and
 * must not move when the layer stack is reordered. Making them a layer keeps
 * "every annotation is owned by a layer" universal instead of carving out a
 * special case for unowned labels.
 *
 * `readByte` always returns undefined, so a symbol layer never shadows another
 * layer and never contributes a region kind. It is excluded from the map's
 * address range for the same reason — it describes everywhere and nowhere.
 */
export class SymbolLayer implements Layer {
  public readonly hasBytes = false;
  /** Never consulted: the layer supplies no bytes, so no address resolves to it. */
  public readonly defaultRegionKind: RegionKind = "unknown";
  public readonly regions = new RegionIndex();
  /** Empty range — a symbol layer occupies no address space of its own. */
  public readonly start = 0;
  public readonly end = 0;

  constructor(
    public readonly name: string,
    public readonly labels: Label[] = [],
    public readonly id: string = newId("lay")
  ) {}

  readByte(): number | undefined {
    return undefined;
  }

  getLabels(): readonly Label[] {
    return this.labels;
  }
}
