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
  labelAddOp,
  markFunctionOps,
  unmarkFunctionOps,
  makeFileLoader,
  regionDeleteOp,
  claimAddOps,
  resolveOwningLayer,
} from "../core/index.js";
import { Claim, Interpretation, RootKind } from "../core/claims/model.js";
import { ChatMessage, Participant, projectFromDoc } from "../core/crdt/index.js";
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

  /** Who is in this project, from the document — the same list an agent reads. */
  members(): Participant[] {
    return this.client.members();
  }

  onMembers(listener: () => void): () => void {
    return this.client.onMembers(listener);
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

  /**
   * Which target this session is reading, if not the project's own default.
   *
   * **Held here and never written to the document.** Which targets exist, and
   * which one a project opens with, are facts about the project; which one *I*
   * am looking at right now is a cursor — the same distinction presence draws,
   * and the one the shared `select_target` got wrong. Experiment 7 measured the
   * cost of getting it wrong: a whole target went unread for a run, because
   * changing what everybody sees to glance at the packed loader is a price
   * nobody would pay.
   *
   * A split view showing two targets at once is the case that settles it: two
   * panes over one document, neither allowed to move the other.
   */
  private viewTarget?: string;

  /** Every target the project declares, whichever one is being read. */
  targets(): { name: string; description?: string; order?: number; isDefault: boolean }[] {
    const project = projectFromDoc(this.client.doc);
    return (project.targets ?? [])
      .map((target) => ({
        name: target.name,
        ...(target.description === undefined ? {} : { description: target.description }),
        ...(target.order === undefined ? {} : { order: target.order }),
        isDefault: target.name === project.defaultTarget,
      }))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
  }

  /** The target being read, which is the project's default until one is chosen. */
  get target(): string | undefined {
    return this.viewTarget ?? projectFromDoc(this.client.doc).defaultTarget;
  }

  /**
   * Read a different target. Rebuilds the model; writes nothing.
   *
   * Naming one that does not exist is refused rather than falling back to the
   * default, for the reason every other surface refuses it: answering with a
   * different stack than the caller asked for, with no way to tell, is worse
   * than an error.
   */
  selectTarget(name: string | undefined): void {
    if (name !== undefined && !this.targets().some((target) => target.name === name)) {
      throw new Error(`no target called ${name}`);
    }
    this.viewTarget = name;
    this.loaded = this.build();
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
        }),
        // The supported seam, and the same one every tool uses — so the browser
        // narrows a view exactly as an agent does, including refusing a name
        // that reaches nothing.
        this.viewTarget === undefined ? {} : { target: this.viewTarget }
      );
    } finally {
      this.lastBuildMs = performance.now() - started;
    }
  }

  /** The project as it would be exported, for the read-only view. */
  exportedText(): string {
    return JSON.stringify(projectFromDoc(this.client.doc), null, 2) + "\n";
  }

  /**
   * Every claim covering an address, resolving nothing.
   *
   * The read that makes the writes usable: correcting and removing are both by
   * id, so there has to be a way to find out what the ids are. Several claims
   * cover any interesting address and this returns all of them, in the order
   * `ClaimSet` holds them.
   */
  claimsAt(address: number): readonly Claim[] {
    return this.loaded.claims.filter(
      (c) => address >= c.at && address < c.at + (c.extent ?? 1)
    );
  }

  /** Which layer owns an address, or undefined if nothing does. */
  layerFor(address: number): number | undefined {
    return resolveOwningLayer(this.loaded, address);
  }

  /** Apply operations as one undoable action. */
  private run(ops: readonly Op[]): void {
    if (ops.length === 0) return;
    this.client.labelNextChange(ops.map((op) => describeOp(op)).join(", "));
    this.client.apply(ops);
  }

  /**
   * Name an address. **Always adds**, like every other write here.
   *
   * It used to be an address-keyed upsert, which is how the browser performed a
   * rename — and it is the write that destroyed 123 names across 74 addresses in
   * experiment 7, on the object this project states the identity rule for first.
   * An address cannot identify a claim, so renaming is `setClaim`, by id.
   */
  addLabel(address: number, name: string, type: ProjectLabel["type"] | undefined): void {
    this.run([labelAddOp(this.loaded, address, name, type)]);
  }

  /**
   * Say what a span of bytes is. **Always adds.**
   *
   * Takes an `Interpretation` rather than a legacy region kind, so the browser
   * speaks the model's own vocabulary — there is no `code` and no `unknown` to
   * pass, which is the whole redesign in one signature.
   */
  addClaim(
    at: number,
    claim: { name?: string; says?: Interpretation; extent?: number }
  ): void {
    this.run(claimAddOps(this.loaded, at, claim).ops);
  }

  /**
   * Correct a claim, by the only thing that identifies it.
   *
   * `undefined` leaves a field alone; `null` clears it — the distinction an
   * optional field cannot make, and without it a root could be declared and
   * never taken off.
   */
  setClaim(
    id: string,
    fields: { name?: string; root?: RootKind | null; extent?: number | null }
  ): void {
    this.run([{ op: "claim.set", id, fields }]);
  }

  /**
   * Declare an address a routine, promoting the name already there if it can.
   *
   * The one place an address-keyed write is still right: "make *this* a
   * function" means the claim already here, and the core builder is what knows
   * that a promoted `loc_8100` has to become `sub_8100`.
   */
  markFunction(address: number, name?: string): void {
    this.run(markFunctionOps(this.loaded, address, name));
  }

  /** Stop treating an address as a routine, by id. */
  unmarkFunction(address: number): void {
    this.run(unmarkFunctionOps(this.loaded, address));
  }

  /**
   * Take a claim back, by id.
   *
   * It took an address, which cannot identify a claim — several share one, and
   * the browser had no way to say which it meant.
   */
  removeClaim(id: string): void {
    this.run([{ op: "claim.remove", id }]);
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
