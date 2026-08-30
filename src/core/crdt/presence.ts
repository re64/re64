/**
 * Presence for a participant that holds no socket.
 *
 * A browser announces itself: it has a document, an awareness instance and a
 * client id of its own, and its state reaches everyone by being relayed. An
 * agent over stateless HTTP has none of those, so without this it works
 * invisibly — a person watching names change in front of them sees nobody
 * there, which is the one thing a live view must not do.
 *
 * So the server announces on its behalf. Building the update needs an awareness
 * instance carrying the client id being announced, which is why this lives
 * beside the adapter: the wire format is `y-protocols`, and nothing outside
 * here may import it.
 */

import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";

/**
 * An awareness update announcing `clientId` in `state`.
 *
 * The scratch document exists only to carry the client id — awareness reads it
 * from the document it is given — and never holds content, is never synced and
 * is destroyed immediately. Assigning `clientID` is safe precisely because of
 * that: the hazard with a reassigned client id is two peers sharing one while
 * both create structs, and this one creates none.
 */
export function presenceUpdateFor(clientId: number, state: Record<string, unknown>): Uint8Array {
  const carrier = new Y.Doc();
  carrier.clientID = clientId;

  const awareness = new awarenessProtocol.Awareness(carrier);
  try {
    awareness.setLocalState(state);
    return awarenessProtocol.encodeAwarenessUpdate(awareness, [clientId]);
  } finally {
    awareness.destroy();
    carrier.destroy();
  }
}

/**
 * A client id for a participant that was never given one by a document.
 *
 * Yjs client ids must be unique among peers, and this one is minted rather than
 * derived, so it is drawn from the same 32-bit space Yjs uses and left to
 * chance — the same bet Yjs itself makes for every document it creates.
 */
export function newPresenceClientId(): number {
  return Math.floor(Math.random() * 0xffffffff);
}
