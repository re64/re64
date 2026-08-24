/**
 * Turning raw bytes into layer content.
 *
 * The *policy* — `disk.d64:name` extraction, the two-byte PRG load header — is
 * identical everywhere. Only byte access differs: `readFileSync` under Node,
 * prefetched blobs in the browser. So the policy lives here and callers supply
 * the reader.
 *
 * Reading is synchronous because `buildMemoryMap` is. A browser caller fetches
 * the blobs first (see `blobPaths`) and reads from that map.
 */

import { extractFile, findFile, listDirectory } from "../c64/d64.js";
import { FileLoader } from "./loader.js";
import { Project } from "./project.js";

/** Supplies the raw bytes of a whole file, however the caller gets them. */
export type FileBytes = (path: string) => Uint8Array;

/** Split `disk.d64:filename` into its parts, or return null for a plain path. */
export function splitD64Path(path: string): { image: string; entry: string } | null {
  const colon = path.lastIndexOf(":");
  if (colon <= 0) return null;
  const image = path.substring(0, colon);
  return image.toLowerCase().endsWith(".d64")
    ? { image, entry: path.substring(colon + 1) }
    : null;
}

/**
 * The actual files a project needs, with `disk.d64:name` collapsed to the image.
 *
 * A browser client fetches these before building the map, since reading has to
 * be synchronous by then.
 */
export function blobPaths(project: Project): string[] {
  const paths = new Set<string>();
  for (const layer of project.layers) {
    if (!layer.path) continue;
    paths.add(splitD64Path(layer.path)?.image ?? layer.path);
  }
  return [...paths];
}

/** Build a `FileLoader` over a byte reader. */
export function makeFileLoader(read: FileBytes): FileLoader {
  return (path, explicitStart) => {
    const d64 = splitD64Path(path);
    let fullData: Uint8Array;

    if (d64) {
      const image = read(d64.image);
      const entry = findFile(image, d64.entry);
      if (!entry) {
        const available = listDirectory(image)
          .map((e) => e.filename)
          .join(", ");
        throw new Error(
          `File "${d64.entry}" not found in ${d64.image}. Available: ${available}`
        );
      }
      fullData = extractFile(image, entry);
    } else {
      fullData = read(path);
    }

    if (explicitStart !== undefined) {
      // A raw file at an explicit address: no PRG header to strip.
      return { start: explicitStart, data: fullData, isPrg: false };
    }
    if (fullData.length < 3) {
      throw new Error(`File too small to be a PRG: ${path}`);
    }
    return {
      start: fullData[0] | (fullData[1] << 8),
      data: fullData.slice(2),
      isPrg: true,
    };
  };
}
