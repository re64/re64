/**
 * Chat: the root that used to be the one the project could not see.
 *
 * People and agents working the same document need somewhere to talk, and a
 * message is not an annotation — it describes no bytes and belongs to no layer.
 * For a long time that was expressed by keeping it out of everything:
 * `projectFromDoc` whitelisted four roots and never looked here, so a message
 * reached no `Project`, no exported file, no version and no `ops` row, and the
 * argument was that "unsay that" has no computable inverse.
 *
 * **Two of those three reasons held and one did not.** `message.add` inverts to
 * `message.remove` perfectly well; the real objection was that Ctrl-Z must not
 * eat what somebody said, which is a question about what *undo* replays rather
 * than about what the vocabulary covers. So chat has three operations now, and
 * stays outside the undo manager's tracked roots on purpose.
 *
 * It is in the projection because a session has to be able to learn that
 * discussion is waiting for it. The changes feed is built from the operation
 * log and the socket path derives operations by diffing projections, so a root
 * outside the projection can reach neither. And a project handed to somebody
 * else should arrive with the argument that produced its conclusions.
 *
 * What the old shape was protecting is kept and made explicit instead:
 * `programFromDoc` is the projection *without* the conversation, and that is
 * what `version()` hashes and what a client compares before rebuilding. A
 * message therefore still re-derives nothing and stales no cache — the property
 * that mattered, held by a stated rule rather than by omission.
 *
 * Messages stay a `Y.Array`. Ordering is the content of a conversation and the
 * array CRDT converges it without anyone agreeing a clock — the opposite of a
 * field or a binding, where position was masquerading as identity. Each entry
 * carries an id all the same, because being addressable and being ordered are
 * different properties and chat wants both.
 *
 * Messages are plain scalars in a `Y.Map`, never `Y.Text`. The document runs
 * with `gc: false`, which is justified on the grounds that it holds maps of
 * scalars rather than character-by-character text; collaborative rich text here
 * would undermine that argument for the whole document, to make a chat box
 * marginally nicer.
 *
 * Worth knowing and not fixed: because collection is off, a removed message
 * stays recoverable in the update log forever. Chat is not private.
 */

import * as Y from "yjs";
import { newId } from "../project/identity.js";

/** Root name, alongside `layers`, `meta`, `primaryLabels` and `constants`. */
const ROOT_CHAT = "chat";

export interface ChatMessage {
  readonly id: string;
  /** Unix milliseconds, taken on the poster's machine. */
  readonly at: number;
  /** The identity that posted, for filtering and attribution. */
  readonly author: string;
  /**
   * How that identity was named at the time.
   *
   * Stored rather than resolved on read, because a chat log records what was
   * said and who said it *then*. Looking the name up later would rewrite history
   * every time somebody was renamed.
   */
  readonly name: string;
  readonly text: string;
}

/** What a caller supplies; the rest is minted here. */
export interface OutgoingMessage {
  author: string;
  name: string;
  text: string;
}

const chatRoot = (doc: Y.Doc): Y.Array<Y.Map<unknown>> =>
  doc.getArray<Y.Map<unknown>>(ROOT_CHAT);

/** Longest message accepted, so one paste cannot dominate the document. */
export const MAX_MESSAGE_LENGTH = 2000;

/**
 * Everything said, oldest first.
 *
 * A `Y.Array` rather than an id-keyed map because ordering is the whole point of
 * a conversation and an array merges it without anyone agreeing a clock.
 * Concurrent messages interleave by Yjs's own rule, which is arbitrary but
 * identical on every peer — the same standard the comment index already holds
 * itself to.
 */
export function chatMessages(doc: Y.Doc): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const entry of chatRoot(doc)) {
    const id = entry.get("id");
    const text = entry.get("text");
    // A message from a future version with a shape this one cannot read is
    // skipped rather than rendered as undefined.
    if (typeof id !== "string" || typeof text !== "string") continue;
    out.push({
      id,
      at: typeof entry.get("at") === "number" ? (entry.get("at") as number) : 0,
      author: String(entry.get("author") ?? "anonymous"),
      name: String(entry.get("name") ?? entry.get("author") ?? "anonymous"),
      text,
    });
  }
  return out;
}

/**
 * Say something.
 *
 * Returns the message as stored, so a caller can show it without re-reading.
 * An empty or whitespace-only message is refused rather than posted, since the
 * only thing it can do is take up a row.
 */
export function postChatMessage(
  doc: Y.Doc,
  outgoing: OutgoingMessage,
  origin?: unknown
): ChatMessage | undefined {
  const text = outgoing.text.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!text) return undefined;

  const message: ChatMessage = {
    id: newId("msg"),
    at: Date.now(),
    author: outgoing.author,
    name: outgoing.name,
    text,
  };

  doc.transact(() => {
    const entry = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(message)) entry.set(key, value);
    chatRoot(doc).push([entry]);
  }, origin);

  return message;
}

/** Called when anything is said, locally or remotely. */
export function onChatChange(doc: Y.Doc, listener: () => void): () => void {
  const observer = () => listener();
  chatRoot(doc).observeDeep(observer);
  return () => chatRoot(doc).unobserveDeep(observer);
}

/** How many messages the document holds, without materialising them. */
export const chatLength = (doc: Y.Doc): number => chatRoot(doc).length;
