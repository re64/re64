/**
 * The sync relay.
 *
 * A minimal Yjs sync protocol over WebSocket: a joining client sends what it
 * has, the server sends back what it lacks, and from then on each update is
 * broadcast to everyone else on the same project.
 *
 * The relay does not understand the schema. It moves opaque updates and lets
 * the CRDT decide what merging means — the server still does not know what a
 * 6502 is. Only the flatten step needs the project format, and that lives in
 * the session store.
 *
 * The protocol is deliberately small rather than reusing y-websocket, because
 * the server also has to know when a session ends in order to flatten it.
 */

import { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { ProjectStore } from "../store/index.js";

/** First byte of every frame. */
const enum Message {
  /** "Here is what I have" — sent on join, answered with the difference. */
  Sync = 0,
  /** "Here is a change." */
  Update = 1,
}

export interface SyncOptions {
  store: ProjectStore;
  /**
   * How long after the last participant leaves before the session is flattened.
   *
   * A timeout rather than an explicit end: a browser tab closes without warning
   * and an agent simply stops, so waiting for a clean goodbye would mean often
   * never flattening. It also lets a reload rejoin the same session instead of
   * splitting one piece of work across two history entries.
   */
  idleMs: number;
  /**
   * How long after the last edit before the project file is brought up to date.
   *
   * Separate from flattening, and much shorter. Without it the file would sit
   * stale for as long as anyone stayed connected — `git diff` would show
   * nothing, the CLI would read old content, and an editor open on the same
   * file would never see the work. Debounced rather than per-edit so a burst of
   * renames costs one write.
   */
  writeMs: number;
  onFlatten?: (summary: string[]) => void;
}

export class SyncServer {
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly clients = new Set<WebSocket>();
  private idleTimer: NodeJS.Timeout | undefined;
  private writeTimer: NodeJS.Timeout | undefined;

  constructor(private readonly options: SyncOptions) {
    this.wss.on("connection", (socket, request) => this.join(socket, request));

    // Relay every change to the shared document, not only the ones that
    // arrived over a socket. An HTTP write is applied to the same document as
    // a synthetic client, and connected sessions have to see it or they carry
    // on from a state the server has already moved past.
    options.store.onUpdate((update, origin) => {
      const from = origin instanceof WebSocket ? origin : undefined;
      this.broadcast(frame(Message.Update, update), from);
      this.scheduleWrite();
    });

    // Someone editing the file directly — the CLI, or an editor — is a
    // participant too. Their changes become operations on the shared document
    // and reach connected sessions, instead of being reverted by the next
    // write.
    options.store.watchFile();
  }

  /** Adopt an HTTP upgrade for the sync endpoint. */
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit("connection", ws, request);
    });
  }

  private join(socket: WebSocket, request: IncomingMessage): void {
    const author =
      new URL(request.url ?? "/", "http://localhost").searchParams.get("author") ?? "anonymous";

    this.clients.add(socket);
    this.options.store.addAuthor(author);
    this.cancelIdleFlatten();

    // Hand the newcomer the current state; it replies with anything we lack.
    socket.send(frame(Message.Sync, this.options.store.snapshot()));

    socket.on("message", (data: Buffer) => {
      if (data.length < 1) return;
      const payload = new Uint8Array(data.subarray(1));

      // Merging tags the update with this socket, and the document observer
      // relays it onward to everyone else. One broadcast path, so an HTTP
      // write and a socket edit are treated the same.
      if (data[0] === Message.Sync || data[0] === Message.Update) {
        this.options.store.merge(payload, socket);
      }
    });

    socket.on("close", () => {
      this.clients.delete(socket);
      if (this.clients.size === 0) this.scheduleIdleFlatten();
    });

    socket.on("error", () => socket.close());
  }

  private broadcast(data: Buffer, except?: WebSocket): void {
    for (const client of this.clients) {
      if (client !== except && client.readyState === WebSocket.OPEN) client.send(data);
    }
  }

  /** Bring the file up to date shortly after edits stop. */
  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined;
      this.detached(() => this.options.store.writeFile());
    }, this.options.writeMs);
    this.writeTimer.unref?.();
  }

  private scheduleIdleFlatten(): void {
    this.cancelIdleFlatten();
    this.idleTimer = setTimeout(() => this.detached(() => this.flattenNow()), this.options.idleMs);
    // Do not hold the process open just to wait for a flatten.
    this.idleTimer.unref?.();
  }

  /**
   * Run persistence work that no caller is waiting on.
   *
   * A timer that throws takes the process down with it, and the file these
   * touch is outside the server's control: it can be deleted, replaced, or
   * hand-edited into invalid JSON mid-session. Losing the write is recoverable
   * — the session state is still in the document and the sidecar log — while
   * losing the server is not.
   */
  private detached(work: () => void): void {
    try {
      work();
    } catch (error) {
      console.error("re64: could not persist the session:", error);
    }
  }

  private cancelIdleFlatten(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  /** How many participants are connected right now. */
  get clientCount(): number {
    return this.clients.size;
  }

  /** Bring the file up to date now, without ending the session. */
  writeNow(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = undefined;
    this.options.store.writeFile();
  }

  /** Flatten immediately — on shutdown, or when a client asks explicitly. */
  flattenNow(): void {
    const entry = this.options.store.flatten(Date.now());
    if (entry) this.options.onFlatten?.(entry.summary);
  }

  close(): void {
    this.options.store.stopWatching();
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = undefined;
    this.cancelIdleFlatten();
    for (const client of this.clients) client.close();
    this.wss.close();
  }
}

function frame(kind: Message, payload: Uint8Array): Buffer {
  const out = Buffer.allocUnsafe(payload.length + 1);
  out[0] = kind;
  Buffer.from(payload).copy(out, 1);
  return out;
}
