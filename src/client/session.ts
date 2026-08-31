/**
 * The project as the browser holds it.
 *
 * A `Y.Doc` is the truth here, exactly as it is on the server — the two are the
 * same document, kept in step by the transport. The model is derived from it
 * (`projectFromDoc` → `buildMemoryMap`) and re-derived whenever it changes,
 * whoever changed it.
 *
 * There is no save. An edit is applied to the document and is already
 * everyone's; the whole-document PUT this replaces could only ever refuse a
 * concurrent edit, never merge one.
 *
 * The exported project text is derived on demand for the read-only view. It is
 * not the edit surface, and nothing here parses it.
 */

import {
  LoadedProject,
  Op,
  ProjectLabel,
  Project,
  blobPaths,
  buildMemoryMap,
  describeOp,
  labelDeleteOp,
  labelSetOp,
  makeFileLoader,
  RegionKind,
  regionDeleteOp,
  regionSetOp,
  resolveOwningLayer,
} from "../core/index.js";
import { ChatMessage, projectFromDoc } from "../core/crdt/index.js";
import { ConnectionStatus, DocClient, OpenOptions } from "./doc-client.js";

/** What the debug view reports. Read-only; nothing acts on it. */
export interface SessionDebug {
  sessionId: string;
  status: ConnectionStatus;
  blobs: { path: string; bytes: number }[];
  /** How long the last rebuild took: projection, map, and layer construction. */
  lastBuildMs: number;
  /** How many document changes this session has seen, local or remote. */
  changes: number;
  participants: number;
  undo: { canUndo: boolean; canRedo: boolean; next: string | undefined };
}

export class ProjectSession {
  private lastBuildMs = 0;
  private changeCount = 0;
  /** The last projection acted on, so a change invisible to it can be skipped. */
  private lastProjection = "";
  private readonly listeners: (() => void)[] = [];
  private refreshing: Promise<void> | undefined;

  private constructor(
    private readonly client: DocClient,
    public loaded: LoadedProject,
    private readonly blobs: Map<string, Uint8Array>,
    private readonly origin: string,
    private readonly project: string
  ) {}

  /**
   * Connect, wait for the document, then fetch the bytes it refers to.
   *
   * The order matters and is the opposite of what it was. The browser cannot
   * know which binaries a project needs until the document has arrived, so the
   * first paint waits on a socket round trip rather than on a fetch.
   */
  static async open(options: OpenOptions = {}): Promise<ProjectSession> {
    const client = await DocClient.open(options);
    const blobs = new Map<string, Uint8Array>();
    const session = new ProjectSession(
      client,
      null as never,
      blobs,
      options.origin ?? "",
      options.project ?? ""
    );

    await session.fetchMissingBlobs(projectFromDoc(client.doc));
    session.loaded = session.build();

    // From here the model follows the document by itself. Refreshes are
    // serialised because rebuilding is async — a burst of updates would
    // otherwise interleave two rebuilds and leave the later one's result
    // overwritten by the earlier one's.
    session.lastProjection = JSON.stringify(projectFromDoc(client.doc));

    client.onChange(() => {
      session.changeCount++;

      // Not every document change is a change to the *project*. Chat lives at
      // its own root, so a message is an update that the projection cannot see
      // — and rebuilding for one would re-derive the model and re-analyse the
      // whole program per line of conversation.
      //
      // Compared by projection rather than by asking which Yjs types moved,
      // because that catches anything invisible to the project rather than only
      // the one case known today, and it keeps the check on this side of the
      // CRDT boundary. `projectFromDoc` is a fraction of a millisecond; a
      // rebuild is tens.
      const projection = JSON.stringify(projectFromDoc(client.doc));
      if (projection === session.lastProjection) return;
      session.lastProjection = projection;

      session.refreshing = (session.refreshing ?? Promise.resolve())
        .then(() => session.refresh())
        .then(() => {
          for (const listener of session.listeners) listener();
        })
        .catch(() => {
          // A rebuild can fail if a referenced blob cannot be fetched. The
          // model keeps its last good state rather than being torn down.
        });
    });

    return session;
  }

  /**
   * Re-derive the model from the document.
   *
   * Called automatically whenever the document changes, so `loaded` is normally
   * current without anyone asking. It stays public because a caller that has
   * just made an edit may want to read the result on the next line rather than
   * wait for the notification.
   */
  async refresh(): Promise<void> {
    const project = projectFromDoc(this.client.doc);
    this.lastProjection = JSON.stringify(project);
    // A remote edit can introduce a layer whose bytes are not here yet.
    await this.fetchMissingBlobs(project);
    this.loaded = this.build();
  }

  /**
   * Called after the model has been brought up to date, not merely when the
   * document changed.
   *
   * The distinction matters for anything acting on the result: a listener that
   * fired on the raw update would see the old disassembly, and a listener that
   * re-derived for itself would do the work twice.
   */
  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  /**
   * Resolve once nothing has changed for a moment.
   *
   * What an agent usually wants after making an edit, or before reading: it
   * lets a burst of remote changes land as one instead of reacting to each.
   */
  async settled(quietMs = 150): Promise<void> {
    let seen = this.changeCount;
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, quietMs));
      if (this.changeCount === seen) return;
      seen = this.changeCount;
    }
  }

  onPresence(listener: () => void): void {
    this.client.onPresence(listener);
  }

  announce(user: { name: string; colour: string }): void {
    this.client.announce(user);
  }

  participants(): { clientId: number; name: string; colour: string; isMe: boolean }[] {
    return this.client.participants();
  }

  /** Everything said in this project, oldest first. */
  chat(): ChatMessage[] {
    return this.client.chat();
  }

  /**
   * Say something.
   *
   * Not an operation: `src/core/ops` is a closed vocabulary of edits with
   * computable inverses, and "unsay that" is not one. So this does not go
   * through `runOps`, leaves no `ops` row, and is not reachable by undo.
   */
  postChat(author: string, name: string, text: string): ChatMessage | undefined {
    return this.client.postChat(author, name, text);
  }

  /**
   * Called when anything is said.
   *
   * Separate from `onChange`, which fires when the *model* has been rebuilt — a
   * message changes no model, so it must not wait on one and must not cause one.
   */
  onChat(listener: () => void): () => void {
    return this.client.onChat(listener);
  }

  private async fetchMissingBlobs(project: Project): Promise<void> {
    const wanted = blobPaths(project).filter((p) => !this.blobs.has(p));
    await Promise.all(
      wanted.map(async (path) => {
        const res = await fetch(
          `${this.origin}/api/blob?path=${encodeURIComponent(path)}` +
            (this.project ? `&project=${encodeURIComponent(this.project)}` : "")
        );
        if (!res.ok) {
          const detail = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(detail.error ?? `could not load ${path}`);
        }
        this.blobs.set(path, new Uint8Array(await res.arrayBuffer()));
      })
    );
  }

  private build(): LoadedProject {
    const started = performance.now();
    try {
      return buildMemoryMap(
        projectFromDoc(this.client.doc),
        makeFileLoader((path) => {
          const bytes = this.blobs.get(path);
          if (!bytes) throw new Error(`no bytes fetched for ${path}`);
          return bytes;
        })
      );
    } finally {
      this.lastBuildMs = performance.now() - started;
    }
  }

  /** The project as it would be exported, for the read-only view. */
  exportedText(): string {
    return JSON.stringify(projectFromDoc(this.client.doc), null, 2) + "\n";
  }

  /** Which layer owns an address, or undefined if nothing does. */
  layerFor(address: number): number | undefined {
    return resolveOwningLayer(this.loaded, address);
  }

  /** Apply operations as one undoable action. */
  private run(ops: readonly Op[]): void {
    if (ops.length === 0) return;
    this.client.labelNextChange(ops.map(describeOp).join(", "));
    this.client.apply(ops);
  }

  setLabel(address: number, name: string, type: ProjectLabel["type"] | undefined): void {
    // The identity rule lives in core/ops/edits, because it used to live here
    // *and* in the CLI and the two disagreed: this one reused whatever label
    // resolved at the address, which includes the built-in platform names.
    this.run([labelSetOp(this.loaded, address, name, type)]);
  }

  removeLabel(address: number): void {
    const op = labelDeleteOp(this.loaded, address);
    if (op) this.run([op]);
  }

  setRegion(
    start: number,
    end: number,
    kind: RegionKind,
    name?: string,
    view?: string
  ): void {
    this.run([regionSetOp(this.loaded, start, end, kind, name, undefined, undefined, view)]);
  }

  removeRegion(start: number): void {
    const op = regionDeleteOp(this.loaded, start);
    if (op) this.run([op]);
  }

  undo(): string | undefined {
    const description = this.client.describeUndo();
    if (!this.client.canUndo) return undefined;
    this.client.undo();
    return description ?? "the last change";
  }

  redo(): string | undefined {
    const description = this.client.describeRedo();
    if (!this.client.canRedo) return undefined;
    this.client.redo();
    return description ?? "the last change";
  }

  undoDescription(): string | undefined {
    return this.client.canUndo ? (this.client.describeUndo() ?? "the last change") : undefined;
  }

  redoDescription(): string | undefined {
    return this.client.canRedo ? (this.client.describeRedo() ?? "the last change") : undefined;
  }

  debug(): SessionDebug {
    return {
      sessionId: this.client.sessionId,
      status: this.client.status,
      blobs: [...this.blobs].map(([path, data]) => ({ path, bytes: data.length })),
      lastBuildMs: this.lastBuildMs,
      changes: this.changeCount,
      participants: this.client.participants().length,
      undo: {
        canUndo: this.client.canUndo,
        canRedo: this.client.canRedo,
        next: this.undoDescription(),
      },
    };
  }

  close(): void {
    this.client.destroy();
  }
}
