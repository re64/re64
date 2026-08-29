/**
 * The project as the browser holds it.
 *
 * The client owns the model: edits apply to its own copy of the project text,
 * the map is rebuilt and re-analysed locally (~16ms), and only the save crosses
 * the wire. Nothing waits on the network to show a rename.
 *
 * The text is the edit surface rather than the parsed object because the
 * serialiser edits lines in place — that is what keeps a one-label rename to a
 * one-line diff in git.
 */

import {
  LoadedProject,
  blobPaths,
  buildMemoryMap,
  deleteLabel,
  makeFileLoader,
  parseProject,
  ProjectLabel,
  resolveOwningLayer,
  upsertLabel,
  newId,
} from "../core/index.js";

export class ProjectSession {
  private constructor(
    public raw: string,
    private version: string,
    public loaded: LoadedProject,
    private readonly blobs: Map<string, Uint8Array>
  ) {}

  /** Fetch the project and every byte it references, then build the map. */
  static async open(): Promise<ProjectSession> {
    const res = await fetch("/api/project");
    if (!res.ok) throw new Error("could not load the project file");
    const { raw, version } = (await res.json()) as { raw: string; version: string };

    const blobs = new Map<string, Uint8Array>();
    const session = new ProjectSession(raw, version, null as never, blobs);
    await session.fetchMissingBlobs(parseProject(raw));
    session.loaded = session.build(raw);
    return session;
  }

  private async fetchMissingBlobs(project: ReturnType<typeof parseProject>): Promise<void> {
    const wanted = blobPaths(project).filter((p) => !this.blobs.has(p));
    await Promise.all(
      wanted.map(async (path) => {
        const res = await fetch(`/api/blob?path=${encodeURIComponent(path)}`);
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}));
          throw new Error(detail.error ?? `could not load ${path}`);
        }
        this.blobs.set(path, new Uint8Array(await res.arrayBuffer()));
      })
    );
  }

  private build(raw: string): LoadedProject {
    return buildMemoryMap(
      parseProject(raw),
      makeFileLoader((path) => {
        const bytes = this.blobs.get(path);
        if (!bytes) throw new Error(`no bytes fetched for ${path}`);
        return bytes;
      })
    );
  }

  /** Which layer owns an address, or undefined if nothing does. */
  layerFor(address: number): number | undefined {
    return resolveOwningLayer(this.loaded, address);
  }

  /**
   * Apply a text edit and rebuild the model.
   *
   * Rebuilding is synchronous unless the edit introduced a layer whose bytes
   * have not been fetched yet, which only a hand-edit of the raw JSON can do.
   */
  private async apply(next: string): Promise<void> {
    await this.fetchMissingBlobs(parseProject(next));
    this.loaded = this.build(next);
    this.raw = next;
  }

  async setLabel(
    address: number,
    name: string,
    type: ProjectLabel["type"] | undefined
  ): Promise<void> {
    const layer = this.layerFor(address);
    if (layer === undefined) {
      throw new Error(
        `No layer owns $${address.toString(16).toUpperCase()}. Add a layer of ` +
          `type "symbols" to name addresses outside the loaded bytes.`
      );
    }
    // Reuse the id of the label already at this address; mint one otherwise, so
    // a rename keeps the same identity rather than replacing the label.
    const existing = this.loaded.map.getLabels().getLabelsAt(address)[0];
    const id = existing?.id ?? newId("lbl");
    await this.apply(upsertLabel(this.raw, id, address, name, type, layer));
  }

  async removeLabel(address: number): Promise<void> {
    const layer = this.layerFor(address);
    if (layer === undefined) return;
    await this.apply(deleteLabel(this.raw, address, layer));
  }

  /** Replace the whole document, as the raw JSON editor does. */
  async replaceText(next: string): Promise<void> {
    await this.apply(next);
  }

  /**
   * Persist. A stale base version means the file changed underneath — someone
   * edited it in another editor — so the server refuses rather than clobbering.
   */
  async save(): Promise<void> {
    const res = await fetch("/api/project", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ raw: this.raw, baseVersion: this.version }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? "could not save the project");
    this.version = body.version;
  }
}
