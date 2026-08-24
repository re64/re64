/**
 * Loading a project in the browser.
 *
 * The client owns the model: it fetches the project file and the raw bytes of
 * each layer, then builds the memory map and analyses locally. The server never
 * disassembles anything.
 *
 * Blobs are fetched up front because `buildMemoryMap` reads synchronously —
 * by the time it runs, every byte it might ask for is already in hand.
 */

import {
  LoadedProject,
  blobPaths,
  buildMemoryMap,
  makeFileLoader,
  parseProject,
} from "../core/index.js";

export interface LoadedFromServer {
  loaded: LoadedProject;
  /** The project file as written on disk, for the raw JSON editor. */
  raw: string;
}

async function fetchBlob(path: string): Promise<Uint8Array> {
  const res = await fetch(`/api/blob?path=${encodeURIComponent(path)}`);
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error ?? `could not load ${path}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** Fetch the project and everything it references, then build the memory map. */
export async function loadProjectFromServer(): Promise<LoadedFromServer> {
  const res = await fetch("/api/project");
  if (!res.ok) throw new Error("could not load the project file");
  const { raw } = (await res.json()) as { raw: string };

  const project = parseProject(raw);

  const paths = blobPaths(project);
  const blobs = new Map<string, Uint8Array>();
  await Promise.all(
    paths.map(async (path) => blobs.set(path, await fetchBlob(path)))
  );

  const loaded = buildMemoryMap(
    project,
    makeFileLoader((path) => {
      const bytes = blobs.get(path);
      if (!bytes) throw new Error(`no bytes fetched for ${path}`);
      return bytes;
    })
  );

  return { loaded, raw };
}
