/**
 * The sync relay.
 *
 * Speaks the standard Yjs protocol, so any y-websocket client can connect and
 * so this is replaceable by Hocuspocus or y-sweet without touching the browser.
 * The hand-rolled version it replaces was subtly wrong in a way that only
 * mattered once a real client existed: it pushed its whole state unasked and
 * never answered a client's own sync, which happens to work when both sides
 * already agree and not otherwise.
 *
 * The protocol as documented in `y-protocols/sync`: the client opens with
 * SyncStep1; the server answers SyncStep2 and then its own SyncStep1; the
 * client answers SyncStep2. The server only ever replies — it never initiates.
 *
 * The relay does not understand the schema. It moves opaque updates and lets
 * the CRDT decide what merging means; the server still does not know what a
 * 6502 is.
 */

import { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { ProjectStore } from "../store/index.js";

/**
 * The outer envelope, matching y-websocket so a stock client interoperates.
 *
 * Sync messages carry their own sub-type inside; awareness is a separate
 * channel because presence is not part of the document and must not be
 * persisted with it.
 */
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

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
  /** A participant has connected, claiming to be someone. */
  onSession?: (sessionId: string, userId: string) => void;
}

export class SyncServer {
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly clients = new Set<WebSocket>();
  private idleTimer: NodeJS.Timeout | undefined;
  private writeTimer: NodeJS.Timeout | undefined;
  private readonly awareness: awarenessProtocol.Awareness;
  /** Which socket is responsible for each awareness entry, so a close clears it. */
  private readonly awarenessOwners = new Map<number, WebSocket>();

  constructor(private readonly options: SyncOptions) {
    this.awareness = new awarenessProtocol.Awareness(options.store.document());
    // The server holds no presence of its own; it only relays.
    this.awareness.setLocalState(null);

    this.wss.on("connection", (socket, request) => this.join(socket, request));

    // Relay every change to the shared document, not only the ones that
    // arrived over a socket. An HTTP write is applied to the same document as
    // a synthetic client, and connected sessions have to see it or they carry
    // on from a state the server has already moved past.
    options.store.onUpdate((update, origin) => {
      const from = origin instanceof WebSocket ? origin : undefined;
      const message = encoding.createEncoder();
      encoding.writeVarUint(message, MESSAGE_SYNC);
      syncProtocol.writeUpdate(message, update);
      this.broadcast(encoding.toUint8Array(message), from);
      this.scheduleWrite();
    });

    // Presence, relayed but never persisted. Who is looking at what is not part
    // of the project and must not end up in its history.
    this.awareness.on(
      "update",
      ({ added, updated, removed }: AwarenessChange, origin: unknown) => {
        const changed = [...added, ...updated, ...removed];
        for (const clientId of added) {
          if (origin instanceof WebSocket) this.awarenessOwners.set(clientId, origin);
        }
        for (const clientId of removed) this.awarenessOwners.delete(clientId);

        const message = encoding.createEncoder();
        encoding.writeVarUint(message, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          message,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed)
        );
        this.broadcast(encoding.toUint8Array(message));
      }
    );

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
    const params = new URL(request.url ?? "/", "http://localhost").searchParams;
    const author = params.get("author") ?? "anonymous";
    const sessionId = params.get("session") ?? undefined;

    // Fake authentication: the connection says who it is and is believed. Real
    // accounts will change how a session is issued, not what one is.
    if (sessionId) this.options.onSession?.(sessionId, author);

    socket.binaryType = "arraybuffer";
    this.clients.add(socket);
    this.options.store.addAuthor(author);
    this.cancelIdleFlatten();

    // The server's own SyncStep1. It is a question, not an answer: "here is
    // what I have, send me what I lack." The client's SyncStep1 arrives
    // independently and is answered when it does.
    const opening = encoding.createEncoder();
    encoding.writeVarUint(opening, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(opening, this.options.store.document());
    send(socket, opening);

    if (this.awareness.getStates().size > 0) {
      const states = encoding.createEncoder();
      encoding.writeVarUint(states, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        states,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, [
          ...this.awareness.getStates().keys(),
        ])
      );
      send(socket, states);
    }

    socket.on("message", (data: ArrayBuffer | Buffer) => {
      this.receive(socket, new Uint8Array(data as ArrayBuffer));
    });

    socket.on("close", () => this.leave(socket));
    socket.on("error", () => socket.close());
  }

  private receive(socket: WebSocket, data: Uint8Array): void {
    if (data.length === 0) return;
    const decoder = decoding.createDecoder(data);
    const reply = encoding.createEncoder();

    switch (decoding.readVarUint(decoder)) {
      case MESSAGE_SYNC: {
        encoding.writeVarUint(reply, MESSAGE_SYNC);
        // Tagging the origin with this socket is what stops the update being
        // echoed back to its sender by the document observer.
        syncProtocol.readSyncMessage(decoder, reply, this.options.store.document(), socket);
        // An encoder holding only its type byte means there was nothing to say.
        if (encoding.length(reply) > 1) send(socket, reply);
        break;
      }
      case MESSAGE_AWARENESS: {
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness,
          decoding.readVarUint8Array(decoder),
          socket
        );
        break;
      }
      default:
        // An unknown envelope is a newer peer, not a broken one. Ignore it.
        break;
    }
  }

  private leave(socket: WebSocket): void {
    this.clients.delete(socket);
    // Presence outlives the socket by 30s otherwise, so a closed tab lingers in
    // the participant list.
    awarenessProtocol.removeAwarenessStates(
      this.awareness,
      [...this.controlledBy(socket)],
      null
    );
    if (this.clients.size === 0) this.scheduleIdleFlatten();
  }

  /** Which awareness entries a socket is responsible for. */
  private controlledBy(socket: WebSocket): number[] {
    const owned: number[] = [];
    for (const [clientId, meta] of this.awarenessOwners) {
      if (meta === socket) owned.push(clientId);
    }
    return owned;
  }

  private broadcast(data: Uint8Array, except?: WebSocket): void {
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
    this.awareness.destroy();
    this.options.store.stopWatching();
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = undefined;
    this.cancelIdleFlatten();
    for (const client of this.clients) client.close();
    this.wss.close();
  }
}

interface AwarenessChange {
  added: number[];
  updated: number[];
  removed: number[];
}

/** Send an encoder's bytes, if the socket is still there to receive them. */
function send(socket: WebSocket, encoder: encoding.Encoder): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(encoding.toUint8Array(encoder));
}
