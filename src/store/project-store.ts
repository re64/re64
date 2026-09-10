/**
 * The live document for a project, shared by everyone editing it.
 *
 * The server holds one `Y.Doc` per project. Clients merge into it over a
 * socket; it merges back. Periodically — and whenever the last participant
 * leaves — the accumulated changes are flattened into the project file as a
 * single history entry.
 *
 * Two jobs that look alike but are not:
 *
 * - **Crash safety.** Updates are appended to a log as they arrive, so a lost
 *   browser or a killed server costs nothing. Transient; dropped after flatten.
 * - **History hygiene.** A flatten writes the file and records one entry per
 *   session, not one per keystroke.
 *
 * The flatten diffs the document against the file and applies the resulting
 * operations through the line-editing serializer. Writing the document out
 * directly would discard the blank lines that group labels and reorder
 * hand-declared regions — a whole-file diff standing in for a one-line edit.
 */

import { createHash } from "node:crypto";
import { needsMigration, migrateToClaims } from "../core/claims/migrate.js";
import { HistoryEntry, ProjectStorage, StoredChange, revOf } from "./storage.js";

/**
 * What taking an action back actually did.
 *
 * More than a description, because it can be partial: an op whose target
 * somebody else has since changed is left alone, and a caller that was told
 * only "undone" would believe the whole action had gone.
 */
export interface UndoOutcome {
  /** What was taken back, or null when nothing could be. */
  undone: string | null;
  /** How many operations were reverted. */
  applied: number;
  /** Operations left alone, and why. */
  skipped: { description: string; reason: string }[];
}
import {
  Change,
  Op,
  Project,
  applyOp,
  applyOps,
  diffProjects,
  describeOp,
  formatProject,
  invertOp,
  parseProject,
  AddressResolver,
  buildMemoryMap,
} from "../core/index.js";
import {
  CrdtDoc,
  applyOpToDoc,
  applyUpdate,
  docFromProject,
  docFromUpdates,
  migrateDoc,
  encodeDoc,
  projectFromDoc,
  programFromDoc,
} from "../core/crdt/index.js";

/**
 * A project in the form the document holds.
 *
 * Text may arrive in either form — a file written before the migration, or one
 * an older tool produced — and comparing claims against layer labels emits
 * removals for everything and additions for nothing, which is a silent wipe.
 */
const asClaims = (project: Project): Project =>
  needsMigration(project) ? migrateToClaims(project).project : project;

/**
 * A project's text with every object's keys sorted, for deciding whether two
 * spellings are one state. Arrays keep their order, because there it is state.
 */
function canonical(text: string): string {
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value as Record<string, unknown>)
          .sort()
          .map((k) => [k, sorted((value as Record<string, unknown>)[k])])
      );
    }
    return value;
  };
  return JSON.stringify(sorted(JSON.parse(text)));
}

export class ProjectStore {
  private doc: CrdtDoc | undefined;
  private readonly authors = new Set<string>();
  private readonly listeners: ((update: Uint8Array, origin: unknown) => void)[] = [];
  /**
   * Updates made inside a transaction, waiting for it to commit.
   *
   * Publication is the one thing a rollback cannot take back, so it is the one
   * thing that waits for the commit.
   */
  private readonly held: [Uint8Array, unknown][] = [];
  private publishing = false;
  /** Inside `storage.transaction`, so a write from within joins that transaction. */
  private transacting = false;
  /**
   * How many times the document has changed in this process.
   *
   * A cache key, and deliberately not `version()`: that hashes the whole
   * projection, so it charges real work on every *hit* to discover nothing
   * happened. This is conservative in the safe direction — a change that turns
   * out to be a no-op invalidates unnecessarily, but nothing is ever missed.
   *
   * Process-local, which is all a process-local cache needs. `version()`
   * remains the content-addressed identity for anything crossing a boundary.
   */
  private changed = 0;
  /** The projection as of the last recorded change, for diffing the next one. */
  private lastProjection: Project | undefined;
  /** Set while `runOps` is writing its own record, so it is not written twice. */
  private recording = false;
  private authorOf: ((origin: unknown) => string | undefined) | undefined;
  /**
   * What this session has changed so far.
   *
   * Accumulated as the file is written rather than derived at the end: the file
   * is kept current during a session, so a diff taken at flatten time would be
   * empty and the history entry would be lost.
   */
  private sessionOps: Op[] = [];
  /** Counts actions, so two in the same millisecond get different ids. */
  private changesets = 0;
  private dirty = false;
  /**
   * The text this store last wrote.
   *
   * Used to tell its own writes apart from someone else's. Comparing content
   * rather than trusting watch events, which fire spuriously, coalesce, and
   * differ between platforms.
   */
  private lastWritten: string | undefined;
  private unwatch: (() => void) | undefined;

  constructor(private readonly storage: ProjectStorage) {}

  /**
   * The shared document, built on first use.
   *
   * Recovers from the update log if one survived a crash, so an interrupted
   * session resumes rather than silently losing its edits.
   */
  document(): CrdtDoc {
    if (this.doc) return this.doc;

    this.doc = this.load();
    this.lastWritten = this.storage.readText();
    this.lastProjection = projectFromDoc(this.doc);

    // Every change is appended as it happens. This is the write that matters —
    // the exported text is derived from it, not the other way round — so a
    // process that dies here has lost nothing.
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === "load") return;
      this.changed++;
      // A migration is appended like any change — a later operation names
      // items it created, and a load that cannot find them holds that operation
      // pending for ever — but it is nobody's action, so it is not recorded as
      // one and does not reach the changes feed.
      if (origin !== "migrate") this.record(update, origin);
      this.storage.appendUpdate(update);
      this.dirty = true;

      // **Held until the write commits.** This published straight to every peer
      // and to the export, from inside a transaction that could still roll back
      // — so a caller could be handed an error while readers and other clients
      // had already been told the edit happened, and a restart then rebuilt a
      // document that disagreed with both.
      //
      // A rollback cannot un-notify. So nothing is notified until there is
      // something durable to notify about.
      if (this.transacting || this.publishing) this.held.push([update, origin]);
      else for (const listener of this.listeners) listener(update, origin);
    });

    // After the observer, so that it is persisted; see `migrateDoc` for why a
    // migration that is not is worse than none.
    if (migrateDoc(this.doc)) this.lastProjection = projectFromDoc(this.doc);

    return this.doc;
  }

  /**
   * Rebuild the document from what was stored.
   *
   * A snapshot, if there is one, plus every update recorded after it. The
   * snapshot is only a shortcut: replaying the whole log reaches the same
   * state, because updates are commutative and idempotent.
   *
   * A project written before the document was canonical has text but no
   * updates. It is converted once, here, and the result kept as the first
   * snapshot — which is the only place `docFromProject` is still reached from,
   * and why its determinism no longer has to hold across clients.
   */
  private load(): CrdtDoc {
    const snapshot = this.storage.readSnapshot();
    const tail = this.storage.readUpdates(snapshot?.seqUpto ?? 0);

    if (!snapshot && tail.length === 0) {
      const converted = docFromProject(parseProject(this.storage.readText()));
      this.storage.writeSnapshot({ seqUpto: 0, update: encodeDoc(converted) });
      return converted;
    }

    // Updates past the snapshot are work that has not been recorded in the
    // history yet — a session that ended without one, usually because the
    // process died. Marking it lets the next flatten account for it.
    if (tail.length > 0) this.dirty = true;

    return docFromUpdates([
      ...(snapshot ? [snapshot.update] : []),
      ...tail.map((stored) => stored.update),
    ]);
  }

  /**
   * Watch every change to the shared document.
   *
   * Registered before the document exists, so a listener added at construction
   * still sees the first edit.
   */
  onUpdate(listener: (update: Uint8Array, origin: unknown) => void): void {
    this.listeners.push(listener);
  }

  /**
   * Identifies the content the document currently holds.
   *
   * Not the file: during a live session the file is stale by design, so a
   * caller checking it would think nothing had changed and overwrite work that
   * had merged in the meantime.
   */
  version(): string {
    return createHash("sha256")
      // The *program*, not the conversation: a message is a document change
      // and not a program change, so it must not read as one.
      .update(JSON.stringify(programFromDoc(this.document())))
      .digest("hex")
      .slice(0, 12);
  }

  /**
   * What the server knows about this project, for the debug view.
   *
   * Nothing here is load-bearing; it exists because the interesting state — the
   * CRDT document, the crash log, the undo record — lives on this side and is
   * otherwise invisible from a browser.
   */
  debug(): {
    version: string;
    storedRev: string;
    dirty: boolean;
    authors: string[];
    pendingOps: number;
    updates: { count: number; snapshotAt: number };
    ops: { total: number; undone: number };
    history: number;
  } {
    const updates = this.storage.readUpdates();
    const ops = this.storage.readOps();
    return {
      version: this.version(),
      storedRev: this.storage.rev(),
      dirty: this.dirty,
      authors: [...this.authors].sort(),
      pendingOps: this.sessionOps.length,
      updates: { count: updates.length, snapshotAt: this.storage.readSnapshot()?.seqUpto ?? 0 },
      ops: { total: ops.length, undone: ops.filter((c) => c.undone).length },
      history: this.storage.history().length,
    };
  }

  /**
   * Write down what an edit did, and who did it.
   *
   * Only `runOps` used to record anything, so an edit made in a browser left no
   * trace: the history could say a session happened but not what changed in it,
   * and `re64 undo` could not reach it. That asymmetry is wrong in the
   * direction that matters — the edits with the least ceremony around them are
   * the ones most in need of a record.
   *
   * The change is derived by diffing the projection rather than by reading the
   * update, which carries structs and not intent. Measured at a third of a
   * millisecond on the reference project, once per action rather than per
   * keystroke, so the cost is not worth avoiding.
   */
  private sessionOf?: (origin: unknown) => string | undefined;

  private record(_update: Uint8Array, origin: unknown): void {
    // `runOps` records its own, with inverses computed before it applied them.
    if (this.recording || origin === "recorded") return;

    // Constructing the document from a file is not somebody editing it.
    if (origin === "load") return;

    // **An unattributed change is still a change.** This asked the relay who an
    // origin belonged to and dropped the change when it did not know — and the
    // relay knows sockets, so a `PUT /api/project` reached the document, moved
    // the export, returned 200 and added *no* rows. An agent holding a cursor
    // across one was told nothing had happened. The origin is an author's name
    // where the relay has none to offer, and "unknown" where there is not even
    // that, because the feed being complete matters more than every row being
    // attributed.
    const author =
      this.authorOf?.(origin) ?? (typeof origin === "string" ? origin : "unknown");
    const session = this.sessionOf?.(origin);

    const before = this.lastProjection;
    const after = projectFromDoc(this.doc!);
    this.lastProjection = after;
    if (!before) return;

    const ops = diffProjects(before, after);
    if (ops.length === 0) return;

    // **Each inverse against the state its own operation saw**, walking forward
    // — the same thing `runOps` does, and for the same reason.
    //
    // This took the reverse diff and paired it with the forward one *by array
    // position*. Both diffs order operations by entity and category, and neither
    // promises the matching inverse lands at the same index: one update that
    // removed `clm_a` and added `clm_b` paired "remove clm_a" with "remove
    // clm_b", and "add clm_b" with "add clm_a". Undoing either restored or
    // deleted the wrong entity, and the log looked entirely reasonable.
    //
    // The layout of this text does not matter; it is only ever read to derive an
    // inverse from.
    let text = formatProject(before);
    const at = Date.now();
    // One update is one action, so one changeset covers all of its operations.
    const changeset = `chg_${at.toString(36)}${(this.changesets++).toString(36)}`;
    const changes: Change[] = [];
    for (const op of ops) {
      changes.push({
        op,
        inverse: invertOp(text, op),
        author,
        at,
        // **One update is one action.** The relay knows which session a socket
        // belongs to, and these rows carried neither it nor a changeset — so
        // group boundaries vanished on this path and undo took back a single
        // operation of a multi-operation click.
        ...(session === undefined ? {} : { session }),
        changeset,
      });
      text = applyOp(text, op);
    }
    this.storage.appendOps(changes);
  }

  /**
   * Tells the store which participant an update came from.
   *
   * Supplied by the relay, which is the only layer that knows a connection
   * belongs to a session and a session to a person. Resolved from the update's
   * origin rather than its contents, so it does not depend on anything else
   * having run first.
   */
  attributeWith(
    resolve: (origin: unknown) => string | undefined,
    /**
     * Which session an update came from, where the relay knows.
     *
     * It always did — it holds the socket and the socket carries a session — and
     * simply was not asked. Without it a socket edit reached the history with no
     * session and no changeset, so undo could not tell one click's operations
     * from another's and took back part of a decision.
     */
    resolveSession?: (origin: unknown) => string | undefined
  ): void {
    this.sessionOf = resolveSession;
    this.authorOf = resolve;
  }

  /** A counter that moves whenever the document does. See `changed`. */
  get docVersion(): number {
    this.document();
    return this.changed;
  }

  /** The project as stored, without going through the document. */
  text(): string {
    return this.storage.readText();
  }

  /** Note who is editing, for the history entry. */
  addAuthor(author: string): void {
    this.authors.add(author);
  }

  get hasChanges(): boolean {
    return this.dirty;
  }

  /**
   * Apply an operation to the shared document.
   *
   * Tagged as coming from the file so it is not mistaken for a participant's
   * edit — an undo stack should not offer to revert someone's use of the CLI.
   */
  applyExternalOp(op: Op): void {
    applyOpToDoc(this.document(), op, "file");
  }

  /** Everything a joining client is missing. */
  snapshot(): Uint8Array {
    return encodeDoc(this.document());
  }

  merge(update: Uint8Array, origin: unknown): void {
    applyUpdate(this.document(), update, origin);
  }

  /**
   * Bring the project file up to date with the document.
   *
   * The file is written from the *whole* document rather than from any one
   * caller's changes, so it never lands in a mixed state where an HTTP write
   * is on disk but a socket edit merged a moment earlier is not.
   *
   * The operations are applied line by line rather than the document being
   * written out: the document knows the content, not which labels a blank line
   * grouped or what order regions were declared in.
   *
   * Returns what changed, so a caller can decide whether it is worth recording.
   */
  /**
   * The last export write that failed, until one succeeds.
   *
   * Not an error to throw at the next caller — the write that failed was not
   * theirs, and the document is unharmed. It is a fact about the project that
   * anyone asking about it deserves to be told.
   */
  private writeFailure?: { at: number; message: string };

  /** Whether the export is behind the document, and why, when it is. */
  exportStatus(): { current: boolean; failedAt?: number; error?: string } {
    if (!this.writeFailure) return { current: true };
    return {
      current: false,
      failedAt: this.writeFailure.at,
      error: this.writeFailure.message,
    };
  }

  writeFile(): Op[] {
    const doc = this.document();
    // The file can disappear under a live session — moved, deleted, or on a
    // volume that went away. There is nothing to diff against, and recreating
    // it would resurrect something the user removed on purpose. The session's
    // work stays in the sidecar log, which is what it is for.
    if (!this.storage.exists()) return [];
    const text = this.storage.readText();
    this.absorb(text);

    // The ops are the *record* of what this write carries — they feed
    // `sessionOps`, which becomes the history entry. The file itself is a full
    // dump regenerated from the document.
    //
    // It used to be produced by applying those ops to the text on disk, so a
    // one-label rename stayed a one-line diff. That stopped being worth its
    // weight once the export became something to hand somebody rather than
    // something to maintain — and it was actively wrong here, because the ops
    // are computed against the migrated text and were being applied to the raw
    // one, so a write to a file still in the old shape landed nowhere at all.
    const ops = diffProjects(asClaims(parseProject(text)), projectFromDoc(doc));
    if (ops.length > 0) {
      let updated: string;
      try {
        updated = formatProject(projectFromDoc(doc));
      } catch (error) {
        // Recorded before rethrowing, because the only caller on the live path
        // is a detached timer that swallows this to keep the server up. Without
        // a record the failure reaches nobody: every tool answers `ok`, the
        // document keeps the work, and the export silently stops moving —
        // which is exactly what happened for a quarter of experiment 4.
        this.writeFailure = {
          at: Date.now(),
          message: error instanceof Error ? error.message : String(error),
        };
        throw error;
      }
      this.storage.writeText(updated);
      this.lastWritten = updated;
      this.sessionOps.push(...ops);
    }
    this.writeFailure = undefined;
    // Note what is *not* here: the update log is not cleared. It was, when the
    // text was canonical and a write meant the log had served its purpose. Now
    // the log is the project and the text is the export, so clearing it here
    // would delete the project on every debounce tick.
    return ops;
  }

  /**
   * Fold in what another writer changed, before deciding what to write.
   *
   * Without this a write is a claim that the document is the whole truth, and
   * anything a second writer put in the text since gets diffed straight back
   * out — the silent revert this store exists to prevent. A watcher normally
   * absorbs first, but correctness cannot depend on one running.
   *
   * Three-way, not two: the diff is taken from the text as we last knew it, so
   * it describes what *they* did. Diffing our document against theirs has no
   * common ancestor and cannot tell "they added this" from "we deleted it".
   */
  private absorb(text: string): void {
    if (this.lastWritten === undefined || text === this.lastWritten) {
      this.lastWritten = text;
      return;
    }

    const external = diffProjects(
      asClaims(parseProject(this.lastWritten)),
      asClaims(parseProject(text))
    );
    for (const op of external) applyOpToDoc(this.document(), op, "external");
    this.lastWritten = text;
    if (external.length > 0) {
      this.sessionOps.push(...external);
      this.authors.add("file");
      this.dirty = true;
    }
  }

  /**
   * Apply operations and record them so they can be undone.
   *
   * This is the only way anything mutates a project. Both the CLI and the
   * server's own writes come through here, which is what makes the hazard it
   * replaces structurally impossible rather than merely guarded against: when a
   * second writer edited the text directly, the next write diffed the document
   * against it and emitted operations reverting that edit.
   *
   * Inverses are computed as the batch runs. Each has to see the state its own
   * operation saw, so computing them up front would invert against the wrong
   * document.
   */
  /**
   * Run a durable write, and publish only if it commits.
   *
   * The document is mutated inside the transaction — a `Y.Doc` has no rollback,
   * and staging one on a copy costs more than it buys while the failure being
   * guarded is a storage error rather than a conflict. What is deferred is the
   * part a rollback genuinely cannot undo: telling everybody.
   *
   * On failure the in-memory document is discarded and rebuilt from what
   * actually committed, so the server never keeps serving state that no restart
   * would reproduce.
   *
   * **Two failures, and they are not the same failure.** Before the commit,
   * nothing happened and the caller must be told so. After it, the write is
   * durable and a restart would find it — so a listener that throws is a
   * *delivery* problem, and reporting it as a failed write invites the caller to
   * retry an action that already landed. This is the shape a check that cannot
   * see something must not skip: the write succeeded, one subscriber did not
   * hear about it, and both halves get said.
   */
  private committing<T>(work: () => T): T {
    // Inside another transaction's own work: `storage.transaction` joins the
    // one already open by calling the work directly, so this shares its
    // outcome and the outer boundary owns it. Nothing here is a publication
    // question.
    if (this.transacting) return this.storage.transaction(work);

    // **Two flags, because nesting and draining are different things.** One flag
    // served both, and a listener's write — made while a committed update was
    // being delivered — took the nested shortcut: no cleanup when its own
    // transaction rolled back, so the live document kept the rolled-back edit
    // and the drain delivered its queued update to every peer. R9 again, in the
    // one path this boundary explicitly supports.
    const mark = this.held.length;
    this.transacting = true;
    let committed: T;
    try {
      committed = this.storage.transaction(work);
    } catch (error) {
      // Only this transaction's updates are discarded; anything queued before
      // it belongs to work that committed and is still delivered. The document
      // is dropped: `document()` rebuilds from the snapshot and the updates that
      // committed, which is the state a restart would find.
      this.held.splice(mark);
      this.doc = undefined;
      this.lastProjection = undefined;
      throw error;
    } finally {
      this.transacting = false;
    }

    // A listener's write, made during a drain: its updates are queued and the
    // drain in progress delivers them. Nothing to start here.
    if (this.publishing) return committed;

    // Committed. From here the write stands whatever happens, so the document is
    // never dropped and nothing is rethrown to the caller.
    //
    // **Drained rather than snapshotted**, because a listener may write. Its
    // write commits in its own transaction and queues its own update here — which
    // a snapshot taken before the loop would leave behind, published to nobody.
    // A listener that writes on every notification does not terminate, which is
    // true of any observer that feeds itself.
    this.publishing = true;
    try {
      while (this.held.length) {
        for (const [update, origin] of this.held.splice(0, this.held.length)) {
          for (const listener of this.listeners) {
            try {
              listener(update, origin);
            } catch (error) {
              // Said rather than swallowed, and one listener's failure does not
              // cost the others their notification.
              this.reportPublishError(error, origin);
            }
          }
        }
      }
    } finally {
      this.held.length = 0;
      this.publishing = false;
    }
    return committed;
  }

  /**
   * The reporter is somebody else's code too. One that throws must not turn a
   * committed write into a reported failure or cost the next listener its
   * update — so it is isolated exactly as a listener is, and its own failure
   * goes to the one place left.
   */
  private reportPublishError(error: unknown, origin: unknown): void {
    try {
      this.onPublishError?.(error, origin);
    } catch (reporterError) {
      console.error("re64: the publish-error reporter threw", reporterError, "while reporting", error);
    }
  }

  /**
   * Told when a listener throws on a write that has already committed.
   *
   * Not an argument to `committing`, because the failure belongs to whoever
   * subscribed rather than to whoever wrote. Unset, a throwing listener is
   * silent — which is the wrong default and is why the server sets it.
   */
  onPublishError?: (error: unknown, origin: unknown) => void;

  runOps(
    ops: readonly Op[],
    author: string,
    now: number,
    session?: string,
    /**
     * Where each layer starts, from a caller that already knows.
     *
     * **A description resolves a layer-framed claim to an address, and could
     * not.** `addressesOf` derives the starts by building a memory map with a
     * loader that refuses to read files — and a `.prg` layer's load address is
     * in the first two bytes of its file, so on every real project that throws,
     * the starts stay empty, and every write receipt reports the *offset*
     * instead: `name +$87FF` for a claim written at `$9000`.
     *
     * That is the one place a writer looks to confirm a write, and
     * `docs/model.md` says offsets never appear in an answer. It hid a
     * systematic displacement of eighty claims through three sessions and an
     * import, and the reviewer that found it named this as the reason nobody
     * had: the receipt agreed with the mistake.
     */
    layerStarts?: ReadonlyMap<string, number>
  ): { applied: number; descriptions: string[]; changeset: string } {
    // One call is one changeset, however many ops it takes. The boundary is
    // this function; it simply went unrecorded, which is why undo used to take
    // back part of a decision and report the whole thing.
    const changeset = `chg_${now.toString(36)}${(this.changesets++).toString(36)}`;
    if (ops.length === 0) return { applied: 0, descriptions: [], changeset };

    return this.committing(() => {
      // Learn what anyone else did *before* applying ours, not after. Applying
      // first and reconciling second lets their change land on top of the edit
      // being made, because reconciliation cannot tell it from anything else
      // the document is missing. It also means inverses are computed against
      // the state the operation is actually applied to.
      this.absorb(this.storage.readText());

      // Against the *document*, not the export. The export trails by up to the
      // write debounce, so an inverse computed from it can name a value that is
      // already stale — and undo would then restore something nobody chose.
      // The layout does not matter here: an inverse is an operation, and this
      // text is only ever read to derive one.
      let text = formatProject(projectFromDoc(this.document()));
      const changes: Change[] = [];
      for (const op of ops) {
        changes.push({ op, inverse: invertOp(text, op), author, at: now, session, changeset });
        text = applyOp(text, op);
      }

      this.addAuthor(author);
      this.recording = true;
      try {
        this.applyThroughDocument(ops, author);
      } finally {
        this.recording = false;
        this.lastProjection = projectFromDoc(this.document());
      }
      this.storage.appendOps(changes);

      // Resolved against the project the ops were just applied to, so a
      // description speaks the addresses the caller used rather than the
      // offsets a layer-framed claim is stored as.
      const absolute = addressesOf(text, layerStarts);
      return {
        applied: ops.length,
        descriptions: ops.map((op) => describeOp(op, absolute)),
        changeset,
      };
    });
  }

  /**
   * Undo the most recent action, by default one of the caller's own.
   *
   * An *action*, not an operation: one tool call or one click is taken back
   * whole, however many ops it produced. Before changesets were recorded this
   * reverted a third of a decision and reported success, while the browser —
   * whose ops share a Yjs transaction — took back the whole thing.
   *
   * Scoped to the session when one is known, and to the author otherwise. The
   * session is the narrower and better rule, and the one the browser already
   * follows: two agents under one identity are two peers and neither may
   * revert the other. `re64 undo --any` passes neither and reaches anything.
   */
  undo(author?: string, session?: string): UndoOutcome {
    return this.step(
      // Edits only. An undo is in the feed as its own entry, and undoing that
      // would put back what was just taken back rather than walking further.
      (c) => !c.undone && (c.kind ?? "edit") === "edit",
      (c) => c.inverse,
      true,
      { author, session }
    );
  }

  /** Redo the most recently undone action, by the same scoping rule. */
  redo(author?: string, session?: string): UndoOutcome {
    return this.step(
      (c) => c.undone === true && (c.kind ?? "edit") === "edit",
      (c) => c.op,
      false,
      { author, session }
    );
  }

  /**
   * Walk one action back, or forward.
   *
   * Partial by design. A stored inverse says what the state was when the op was
   * recorded, so applying one after somebody else has touched the same field
   * silently reverts their work — the CRDT converges, and converges on the
   * wrong thing. So each op is checked first: if replaying it forward would
   * change nothing, its effect is still present and the inverse is safe. If it
   * would, someone has been here since and it is left alone and reported.
   *
   * Reporting rather than refusing, because taking back three of four renames
   * and saying which one was kept is more useful than declining the lot.
   */
  private step(
    wanted: (change: StoredChange) => boolean,
    direction: (change: StoredChange) => Op,
    undone: boolean,
    scope: { author?: string; session?: string }
  ): UndoOutcome {
    const inScope = (c: StoredChange): boolean => {
      if (scope.session !== undefined) return c.session === scope.session;
      if (scope.author !== undefined) return c.author === scope.author;
      return true;
    };

    return this.committing(() => {
      const log = this.storage.readOps();

      // **Which action, and the two directions do not ask it the same way.**
      //
      // Undoing wants the newest edit still standing, which is a search over the
      // edits themselves. Redoing wants the action undone *most recently*, and
      // that is not the highest-numbered undone row: undo Second then First and
      // both are flagged, while the one to put back is First. Reading it off the
      // sequence number chose Second, whose precondition no longer held, so redo
      // reported "changed by someone else since" with no collaborator in sight
      // and did nothing — for ever.
      //
      // The undo entries the feed now carries answer it exactly: the newest one
      // names the action that was taken back.
      const newest = undone
        ? [...log].reverse().find((c) => wanted(c) && inScope(c))
        : (() => {
            // Newest first, and skipping the ones already put back: redoing
            // twice must walk two actions, and an undo entry whose action is no
            // longer flagged has been redone already.
            for (const entry of [...log].reverse()) {
              if (entry.kind !== "undo" || !inScope(entry)) continue;
              const action = [...log]
                .reverse()
                .find(
                  (c) =>
                    wanted(c) &&
                    inScope(c) &&
                    (entry.changeset === undefined
                      ? true
                      : c.changeset === entry.changeset)
                );
              if (action) return action;
            }
            return undefined;
          })();
      if (!newest) return { undone: null, applied: 0, skipped: [] };

      // A row written before changesets existed is its own action.
      const group = newest.changeset
        ? log.filter((c) => c.changeset === newest.changeset && wanted(c) && inScope(c))
        : [newest];

      let text = formatProject(projectFromDoc(this.document()));
      // Addresses, not offsets — an undo report is read for the same reason a
      // write's `did` is: to check that what happened is what was meant.
      const absolute = addressesOf(text);
      const skipped: UndoOutcome["skipped"] = [];
      const applying: StoredChange[] = [];

      // **Backwards to undo, forwards to redo.** An action's operations depend
      // on each other in the order they were made, so putting them back in
      // reverse asks a later one to apply before the thing it needs. Undo is the
      // mirror and does want reverse.
      for (const change of undone ? [...group].reverse() : group) {
        // The op whose effect must still be present for the stored inverse to
        // mean anything: what was applied last time round. Undoing checks the
        // original op, redoing checks the inverse that undid it.
        const settled = undone ? change.op : change.inverse;
        // **Compared as state, not as text.** Key order is not state, and a
        // writer that deletes and reinserts a key moves it — so replaying an
        // operation whose values already held could change the bytes and
        // nothing else, and this refused an undo as "changed by someone else"
        // with nobody else in the room. The file's own order is fixed in
        // `formatProject`; this is the check's half of the same rule.
        if (canonical(applyOp(text, settled)) !== canonical(text)) {
          skipped.push({
            description: describeOp(change.op, absolute),
            reason: "changed by someone else since",
          });
          continue;
        }
        applying.push(change);
        text = applyOp(text, direction(change));
      }

      if (applying.length > 0) {
        // **Appended, as well as flagged.** The `undone` column is what redo
        // walks; it is not history. A reader catching up needs to know that a
        // rename was reverted, and a flag flipped on an old row says nothing to
        // a cursor already past it — so the reversal is recorded as its own
        // entry, with `kind` marking it as one so a second undo walks further
        // back rather than undoing this.
        //
        // Recorded before applying, because `applyThroughDocument` routes
        // through the document and the projection diff would otherwise append a
        // second, unmarked copy of the same thing.
        this.recording = true;
        try {
          const at = Date.now();
          this.storage.appendOps(
            applying.map((change) => ({
              op: direction(change),
              inverse: undone ? change.op : change.inverse,
              kind: undone ? ("undo" as const) : ("redo" as const),
              ...(change.author === undefined ? {} : { author: change.author }),
              ...(change.session === undefined ? {} : { session: change.session }),
              ...(change.changeset === undefined ? {} : { changeset: change.changeset }),
              at,
            }))
          );
          this.applyThroughDocument(
            applying.map(direction),
            newest.author ?? "unknown"
          );
        } finally {
          this.recording = false;
        }
        for (const change of applying) this.storage.markUndone(change.seq, undone);
      }

      return {
        // **What the action was, not its last side effect.** `newest` is the
        // final op of the changeset, and since a claim now mints the vouching
        // that says who made it, that op is "supports clm_x" rather than the
        // naming somebody actually did. The group is in log order, so its first
        // entry is the one that started the action and is what a reader means.
        undone:
          applying.length > 0
            ? describeOp((group[0] ?? newest).op, absolute)
            : null,
        applied: applying.length,
        skipped,
      };
    });
  }

  /**
   * Route operations into the document, then let the document produce the text.
   *
   * Never applied to the text directly. The document is what merges, so a write
   * that skipped it would be invisible to everyone else holding one.
   */
  private applyThroughDocument(ops: readonly Op[], author: string): void {
    const doc = this.document();
    this.absorb(this.storage.readText());
    for (const op of ops) applyOpToDoc(doc, op, author);
    this.reconcileBlobNames();
    this.writeFile();
  }

  /**
   * Point each file name at the hash the **document** says it means.
   *
   * The `files` table is a derived index for reading by name, and it drifted:
   * `putBlob` rewrites it whenever a name is reused, so recording a replacement
   * and then undoing the record restored the document's hash and left every read
   * of that name serving the replacement's bytes. A capture recorded earlier
   * then fetched somebody else's output under its own name.
   *
   * Derived, therefore follows — including through undo, which is the case that
   * exposed it.
   */
  private reconcileBlobNames(): void {
    const point = (this.storage as { setBlobName?: (name: string, hash: string) => void })
      .setBlobName;
    if (!point) return;
    for (const file of projectFromDoc(this.document()).files ?? []) {
      if (file.name && file.hash) point.call(this.storage, file.name, file.hash);
    }
  }

  /**
   * End the session: write the file and record one history entry.
   *
   * Returns the entry, or undefined when nothing changed — an idle session
   * should leave no trace.
   *
   * Building the document rather than assuming it exists matters: a process
   * that starts only to flatten a crashed session has never touched it, and
   * returning early would discard the very work the log was keeping safe.
   */
  flatten(now: number): HistoryEntry | undefined {
    this.document();
    if (!this.dirty) return undefined;

    // Catch anything the debounce had not yet written, then record everything
    // the session did — not just what was still outstanding at the end.
    this.writeFile();
    if (this.sessionOps.length === 0) {
      this.discardLog();
      return undefined;
    }

    const entry: HistoryEntry = {
      at: now,
      authors: [...this.authors].sort(),
      summary: this.sessionOps.map((op) => describeOp(op)),
    };
    this.storage.appendHistory(entry);

    this.discardLog();
    return entry;
  }

  /** Crash-safety log has served its purpose once the file is written. */
  private discardLog(): void {
    this.dirty = false;
    this.authors.clear();
    this.sessionOps = [];
  }

  /**
   * Merge changes made to the file by someone else.
   *
   * The CLI writes the project directly, as does any editor. Without this the
   * document would never learn of those edits, and the next write — which
   * applies the difference between the document and the file — would compute
   * that difference in the wrong direction and silently revert them.
   *
   * The change is applied as operations, so it merges like any other edit and
   * reaches connected sessions rather than only landing on disk.
   */
  watchFile(): void {
    if (this.unwatch) return;
    this.unwatch = this.storage.watch(() => this.absorbExternalChange());
  }

  private absorbExternalChange(): void {
    this.document();
    try {
      this.absorb(this.storage.readText());
    } catch {
      // The project is being replaced, or is mid-save and not valid JSON yet.
      // The next event brings the finished content.
    }
  }


  stopWatching(): void {
    this.unwatch?.();
    this.unwatch = undefined;
  }

  /** Past sessions, oldest first. */
  history(): HistoryEntry[] {
    return this.storage.history();
  }

}

/**
 * Convert a change log into a history entry, for edits that bypassed a session.
 *
 * Free-standing, so it has no project to resolve a claim's position against —
 * a layer-framed one is described as the offset it is rather than as an address
 * it is not. The callers that *do* have the project pass a resolver.
 */
export function entryFromChanges(
  changes: readonly Change[],
  now: number,
  resolve?: AddressResolver
): HistoryEntry {
  return {
    at: now,
    authors: [...new Set(changes.map((c) => c.author ?? "unknown"))].sort(),
    summary: changes.map((c) => describeOp(c.op, resolve)),
  };
}

/**
 * How to turn a stored claim position back into an address, for this project.
 *
 * Built from the text the ops were applied to, so it knows where each layer
 * landed — which is the whole of what resolving an offset needs.
 */
function addressesOf(
  text: string,
  known?: ReadonlyMap<string, number>
): AddressResolver {
  let starts: Map<string, number> | undefined = known === undefined ? undefined : new Map(known);
  return (claim) => {
    if (claim.frame?.space !== "layer") return claim.at;
    if (!starts) {
      starts = new Map();
      try {
        const loaded = buildMemoryMap(parseProject(text), () => {
          throw new Error("a description needs no file bytes");
        });
        for (const layer of loaded.layers) starts.set(layer.id, layer.start);
      } catch {
        // A project whose bytes are not reachable from here still gets a
        // description; it just says the offset it has rather than an address
        // it cannot work out.
      }
    }
    const start = starts.get(claim.frame.layer);
    return start === undefined ? undefined : start + claim.at;
  };
}
