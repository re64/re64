/**
 * The browser's connection to a project.
 *
 * The only file that knows how synchronisation reaches the network. Everything
 * above it sees a document and a stream of changes, which is what makes the
 * transport replaceable — swapping this for Hocuspocus or y-sweet should not
 * reach `main.ts`.
 *
 * The document starts **empty** and is filled by the server. Building a base
 * locally from JSON both sides are assumed to share only works while those
 * bytes are provably identical, and fails silently when they are not, because
 * both bases claim the same client id for different content.
 */

import { WebsocketProvider } from "y-websocket";
import { CrdtDoc, applyOpsToDoc, emptyDoc, undoManagerFor } from "../core/crdt/index.js";
import { Op } from "../core/index.js";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface OpenOptions {
  project?: string;
  author?: string;
  /**
   * Where the server is. Defaults to wherever the page came from; tests supply
   * it explicitly because they run without a page.
   */
  origin?: string;
}

/**
 * One editing session.
 *
 * Not one user: two tabs are two sessions, two client ids, and two independent
 * undo stacks. They are genuinely concurrent peers who can conflict with each
 * other, and neither may undo the other's work — which falls out of scoping
 * undo to this id rather than to whoever is sitting there.
 */
export class DocClient {
  readonly doc: CrdtDoc;
  readonly sessionId: string;
  private readonly provider: WebsocketProvider;
  private readonly undoManager: ReturnType<typeof undoManagerFor>;

  private pendingDescription: string | undefined;

  private constructor(doc: CrdtDoc, provider: WebsocketProvider, sessionId: string) {
    this.doc = doc;
    this.provider = provider;
    this.sessionId = sessionId;
    this.undoManager = undoManagerFor(doc, sessionId);

    // The stack holds Yjs structs, which cannot say "renamed $8100" on their
    // own, so a description is attached as the change is made.
    //
    // Undoing does not move an entry across — it creates a *new* one on the
    // opposite stack, and `stack-item-added` fires **before**
    // `stack-item-popped`, so the description cannot be read off the entry
    // being retired. It is stashed before the call instead; see `undo`.
    this.undoManager.on("stack-item-added", ({ stackItem }: StackEvent) => {
      if (this.pendingDescription === undefined) return;
      stackItem.meta.set("description", this.pendingDescription);
      this.pendingDescription = undefined;
    });
  }

  /**
   * Say who is here.
   *
   * Presence, not authorship — it is client-controlled and not persisted, so
   * the history takes its author from the session record on the server
   * instead. This only decides what other people see in the participant list.
   */
  announce(user: { name: string; colour: string }): void {
    this.provider.awareness.setLocalStateField("user", user);
  }

  /** Everyone currently connected, this session included. */
  participants(): { clientId: number; name: string; colour: string; isMe: boolean }[] {
    const here: { clientId: number; name: string; colour: string; isMe: boolean }[] = [];
    for (const [clientId, state] of this.provider.awareness.getStates()) {
      const user = (state as { user?: { name?: string; colour?: string } }).user;
      if (!user?.name) continue;
      here.push({
        clientId,
        name: user.name,
        colour: user.colour ?? "#888",
        isMe: clientId === this.doc.clientID,
      });
    }
    return here.sort((a, b) => a.clientId - b.clientId);
  }

  onPresence(listener: () => void): void {
    this.provider.awareness.on("change", listener);
  }

  /** Whether the socket is up right now, not whether it once came up. */
  get status(): ConnectionStatus {
    if (this.provider.wsconnected) return "connected";
    return this.provider.wsconnecting ? "connecting" : "disconnected";
  }

  /** Connect and wait for the first sync, so callers start from real content. */
  static async open(options: OpenOptions = {}): Promise<DocClient> {
    const { project = "project", author = "anonymous", origin = location.origin } = options;
    const sessionId = newSessionId();
    const doc = emptyDoc();
    const url = `${origin.replace(/^http/, "ws")}/sync`;

    const provider = new WebsocketProvider(url, project, doc, {
      params: { author, session: sessionId },
      // BroadcastChannel would sync two tabs directly, behind the server's
      // back. That contradicts everything routing through the server, and it
      // would make a broken server look like a working one.
      disableBc: true,
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("the server did not respond")), 15_000);
      provider.once("sync", () => {
        clearTimeout(timer);
        resolve();
      });
      provider.once("connection-error", () => {
        clearTimeout(timer);
        reject(new Error("could not reach the server"));
      });
    });

    return new DocClient(doc, provider, sessionId);
  }

  /**
   * Apply operations as one change.
   *
   * One transaction, so an action made of several operations undoes as one.
   */
  apply(ops: readonly Op[]): void {
    applyOpsToDoc(this.doc, ops, this.sessionId);
  }

  /** Called whenever the document changes, local or remote. */
  onChange(listener: () => void): void {
    this.doc.on("update", listener);
  }

  onStatus(listener: (status: ConnectionStatus) => void): void {
    this.provider.on("status", ({ status }: { status: ConnectionStatus }) => listener(status));
  }

  undo(): void {
    // Carry the description onto the redo entry this is about to create.
    this.pendingDescription = this.describeUndo();
    this.undoManager.undo();
  }

  redo(): void {
    this.pendingDescription = this.describeRedo();
    this.undoManager.redo();
  }

  get canUndo(): boolean {
    return this.undoManager.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.undoManager.redoStack.length > 0;
  }

  /** What the next undo or redo would be, as recorded when it was applied. */
  describeUndo(): string | undefined {
    return describe(this.undoManager.undoStack.at(-1));
  }

  describeRedo(): string | undefined {
    return describe(this.undoManager.redoStack.at(-1));
  }

  /**
   * Label the change that is about to be pushed onto the stack.
   *
   * The stack holds Yjs structs, which cannot say "renamed $8100" on their own,
   * so the description is attached as it happens.
   */
  labelNextChange(description: string): void {
    this.pendingDescription = description;
  }

  destroy(): void {
    this.undoManager.destroy();
    this.provider.disconnect();
    this.provider.destroy();
  }
}

interface StackEvent {
  stackItem: { meta: Map<unknown, unknown> };
}

function describe(item: { meta: Map<unknown, unknown> } | undefined): string | undefined {
  const description = item?.meta.get("description");
  return typeof description === "string" ? description : undefined;
}

/** Identifies this tab for the life of the page; not persisted. */
function newSessionId(): string {
  return crypto.randomUUID();
}
