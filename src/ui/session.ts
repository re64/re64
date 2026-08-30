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
  Change,
  LoadedProject,
  Op,
  applyOp,
  blobPaths,
  buildMemoryMap,
  describeOp,
  invertOp,
  makeFileLoader,
  newId,
  parseProject,
  ProjectLabel,
  resolveOwningLayer,
} from "../core/index.js";

/** What the debug view reports. Read-only; nothing acts on it. */
export interface SessionDebug {
  version: string;
  bytes: number;
  blobs: { path: string; bytes: number }[];
  /** How long the last rebuild took: parse, map, and layer construction. */
  lastBuildMs: number;
  savedAt: number | undefined;
  lastSaveError: string | undefined;
  unsavedEdits: number;
  changes: {
    description: string;
    undone: boolean;
    at: number | undefined;
    /** True for the entry undo would revert next. */
    next: boolean;
  }[];
}

export class ProjectSession {
  private lastBuildMs = 0;
  private savedAt: number | undefined;
  private lastSaveError: string | undefined;
  private savedRaw: string;

  private constructor(
    public raw: string,
    private version: string,
    public loaded: LoadedProject,
    private readonly blobs: Map<string, Uint8Array>,
    /** Edits made this session, each with the operation that undoes it. */
    private changes: Change[] = []
  ) {
    this.savedRaw = raw;
  }

  /**
   * A snapshot for the debug view.
   *
   * Deliberately a copy: a panel that could reach into the live arrays would
   * be able to corrupt an undo stack by being looked at.
   */
  debug(): SessionDebug {
    const nextUndo = [...this.changes].reverse().find((c) => !c.undone);
    return {
      version: this.version,
      bytes: this.raw.length,
      blobs: [...this.blobs].map(([path, data]) => ({ path, bytes: data.length })),
      lastBuildMs: this.lastBuildMs,
      savedAt: this.savedAt,
      lastSaveError: this.lastSaveError,
      unsavedEdits: this.raw === this.savedRaw ? 0 : 1,
      changes: this.changes.map((c) => ({
        description: describeOp(c.op),
        undone: c.undone === true,
        at: c.at,
        next: c === nextUndo,
      })),
    };
  }

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
    const started = performance.now();
    try {
      return this.buildNow(raw);
    } finally {
      this.lastBuildMs = performance.now() - started;
    }
  }

  private buildNow(raw: string): LoadedProject {
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

  /** The id of the layer that owns an address. */
  private layerIdFor(address: number): string {
    const index = this.layerFor(address);
    if (index === undefined) {
      throw new Error(
        `No layer owns $${address.toString(16).toUpperCase()}. Add a layer of ` +
          `type "symbols" to name addresses outside the loaded bytes.`
      );
    }
    const id = this.loaded.project.layers[index].id;
    if (!id) throw new Error("Project has no ids; run: re64 migrate");
    return id;
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

  /**
   * Run operations, recording each with the inverse that undoes it.
   *
   * Inverses are computed as the batch runs, because each has to see the state
   * its own operation saw.
   */
  async run(ops: readonly Op[]): Promise<void> {
    let text = this.raw;
    const recorded: Change[] = [];
    for (const op of ops) {
      recorded.push({ op, inverse: invertOp(text, op), at: Date.now() });
      text = applyOp(text, op);
    }
    await this.apply(text);
    // A fresh edit discards anything that was undone, as every editor does.
    this.changes = this.changes.filter((c) => !c.undone).concat(recorded);
  }

  /** What undo would revert, or undefined if there is nothing. */
  undoDescription(): string | undefined {
    const next = [...this.changes].reverse().find((c) => !c.undone);
    return next && describeOp(next.op);
  }

  /** What redo would reapply. */
  redoDescription(): string | undefined {
    const next = [...this.changes].reverse().find((c) => c.undone);
    return next && describeOp(next.op);
  }

  async undo(): Promise<string | undefined> {
    for (let i = this.changes.length - 1; i >= 0; i--) {
      if (this.changes[i].undone) continue;
      await this.apply(applyOp(this.raw, this.changes[i].inverse));
      this.changes[i].undone = true;
      return describeOp(this.changes[i].op);
    }
    return undefined;
  }

  async redo(): Promise<string | undefined> {
    for (let i = this.changes.length - 1; i >= 0; i--) {
      if (!this.changes[i].undone) continue;
      await this.apply(applyOp(this.raw, this.changes[i].op));
      this.changes[i].undone = false;
      return describeOp(this.changes[i].op);
    }
    return undefined;
  }

  async setLabel(
    address: number,
    name: string,
    type: ProjectLabel["type"] | undefined
  ): Promise<void> {
    // Reuse the id already at this address so a rename keeps its identity
    // rather than replacing the label with a new one.
    const existing = this.loaded.map.getLabels().getLabelsAt(address)[0];
    await this.run([
      {
        op: "label.set",
        id: existing?.id ?? newId("lbl"),
        layerId: this.layerIdFor(address),
        address,
        name,
        type,
      },
    ]);
  }

  async removeLabel(address: number): Promise<void> {
    const existing = this.loaded.map.getLabels().getLabelsAt(address)[0];
    if (!existing) return;
    await this.run([
      { op: "label.delete", id: existing.id, layerId: this.layerIdFor(address) },
    ]);
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
    if (!res.ok) {
      this.lastSaveError = body.error ?? "could not save the project";
      throw new Error(this.lastSaveError);
    }
    this.version = body.version;
    this.savedAt = Date.now();
    this.savedRaw = this.raw;
    this.lastSaveError = undefined;
  }
}
