/**
 * Participants: a sixth root, holding who is in this project.
 *
 * Presence used to be `y-protocols/awareness` alone — relayed, never persisted,
 * on the grounds that who is looking at what is not part of the project. That
 * still holds for a *cursor*, which is momentary and worthless a second later.
 * It does not hold for **membership**, and the difference is what this root is:
 * awareness answers "where is their caret right now", this answers "who is in
 * here", and only the second is worth anyone else being able to ask about.
 *
 * The practical reason it had to change: awareness rides on the socket, and an
 * agent has no socket. So a browser could see every participant and an agent
 * could see none, for a project whose premise is four consumers and none of them
 * primary. Making membership a data structure in the document means both learn
 * it the same way — the browser by observing, an agent by asking — and neither
 * needs a mechanism the other lacks.
 *
 * **Joining and leaving are state changes, not insertions and deletions.** An
 * entry is created once and thereafter toggles `online`. That makes the initial
 * list and every subsequent change the same kind of event, so a client that
 * renders the list has nothing special to do when somebody leaves; it also keeps
 * the record of who has *ever* been here, which is the more interesting question
 * once a project has been worked on by several people.
 *
 * Like `chat`, this is outside `projectFromDoc`'s whitelist, so it never reaches
 * a `Project`, never reaches the exported `.re64`, never moves
 * `ProjectStore.version()`, and produces no `ops` row. Asserted by a test rather
 * than assumed, because a property that holds by omission is one a later edit
 * can quietly take away.
 *
 * Consequence worth knowing, and the same one chat carries: `gc: false` means
 * entries are never really gone, so this grows by one map per session that has
 * ever joined. That is bounded by sessions rather than by edits, which is a much
 * slower thing to grow by — but it is not nothing on a project worked for years.
 */

import * as Y from "yjs";

/** Root name, alongside `layers`, `meta`, `primaryLabels`, `constants` and `chat`. */
const ROOT_PARTICIPANTS = "participants";

/** What kind of consumer this is, since they behave differently enough to matter. */
export type ParticipantKind = "browser" | "agent" | "cli";

export interface Participant {
  /**
   * The session, which is the unit of participation.
   *
   * Not the user: two tabs are two sessions with two client ids and two undo
   * stacks, and a person watching needs to see that rather than one row that
   * flickers.
   */
  readonly session: string;
  /** The identity claimed, unverified exactly as everywhere else. */
  readonly user: string;
  /** How that identity was named when it joined. */
  readonly name: string;
  /** The short, human-trackable handle a session is issued. */
  readonly codename?: string;
  readonly kind: ParticipantKind;
  readonly online: boolean;
  /** Unix milliseconds, first seen. */
  readonly joinedAt: number;
  /** Unix milliseconds, last join or leave. */
  readonly lastSeen: number;
}

const root = (doc: Y.Doc): Y.Map<Y.Map<unknown>> =>
  doc.getMap<Y.Map<unknown>>(ROOT_PARTICIPANTS);

/** What a caller supplies on joining; the timestamps are taken here. */
export interface JoiningParticipant {
  session: string;
  user: string;
  name: string;
  codename?: string;
  kind: ParticipantKind;
}

/**
 * Announce a participant, or bring an existing one back online.
 *
 * Idempotent: joining twice with the same session updates `lastSeen` and
 * nothing else, which matters because an agent "joins" on every request it
 * makes rather than once at a connection it does not have.
 */
export function joinProject(
  doc: Y.Doc,
  joining: JoiningParticipant,
  now: number,
  origin?: unknown
): void {
  doc.transact(() => {
    const map = root(doc);
    const existing = map.get(joining.session);
    if (existing) {
      existing.set("online", true);
      existing.set("lastSeen", now);
      // A name can change between sessions of the same id; the latest wins,
      // unlike a chat message, which records what was true when it was said.
      existing.set("name", joining.name);
      if (joining.codename !== undefined) existing.set("codename", joining.codename);
      return;
    }

    const entry = new Y.Map<unknown>();
    entry.set("session", joining.session);
    entry.set("user", joining.user);
    entry.set("name", joining.name);
    if (joining.codename !== undefined) entry.set("codename", joining.codename);
    entry.set("kind", joining.kind);
    entry.set("online", true);
    entry.set("joinedAt", now);
    entry.set("lastSeen", now);
    map.set(joining.session, entry);
  }, origin);
}

/**
 * Mark a participant offline.
 *
 * Never a deletion. Leaving is a state change so that arriving and departing are
 * the same kind of event to anyone rendering the list, and so the record of who
 * has been here survives them going away.
 */
export function leaveProject(doc: Y.Doc, session: string, now: number, origin?: unknown): void {
  const entry = root(doc).get(session);
  if (!entry) return;
  doc.transact(() => {
    entry.set("online", false);
    entry.set("lastSeen", now);
  }, origin);
}

/** Everyone who has been in this project, online first, then most recent. */
export function participants(doc: Y.Doc): Participant[] {
  const out: Participant[] = [];
  for (const entry of root(doc).values()) {
    const session = entry.get("session");
    // An entry from a future version with a shape this one cannot read is
    // skipped rather than rendered as undefined.
    if (typeof session !== "string") continue;
    const codename = entry.get("codename");
    out.push({
      session,
      user: String(entry.get("user") ?? "anonymous"),
      name: String(entry.get("name") ?? entry.get("user") ?? "anonymous"),
      ...(typeof codename === "string" ? { codename } : {}),
      kind: (entry.get("kind") as ParticipantKind) ?? "agent",
      online: entry.get("online") === true,
      joinedAt: typeof entry.get("joinedAt") === "number" ? (entry.get("joinedAt") as number) : 0,
      lastSeen: typeof entry.get("lastSeen") === "number" ? (entry.get("lastSeen") as number) : 0,
    });
  }

  return out.sort(
    (a, b) => Number(b.online) - Number(a.online) || b.lastSeen - a.lastSeen
  );
}

/**
 * Mark everyone offline, because nobody is connected to a server that has just
 * started.
 *
 * Recording departures on shutdown cannot be the answer on its own: a process
 * that crashes never runs its close handler, and every session it held would
 * stay `online` forever. Doing it on the way *up* is correct in both cases and
 * needs no cooperation from the way down.
 *
 * Writes nothing when nobody is marked online, so an ordinary restart of an
 * idle project costs no update at all.
 */
export function markAllOffline(doc: Y.Doc, now: number, origin?: unknown): void {
  const map = root(doc);
  const stale = [...map.values()].filter((entry) => entry.get("online") === true);
  if (stale.length === 0) return;
  doc.transact(() => {
    for (const entry of stale) {
      entry.set("online", false);
      entry.set("lastSeen", now);
    }
  }, origin);
}

/** Called when anyone joins, leaves, or is renamed — locally or remotely. */
export function onParticipantsChange(doc: Y.Doc, listener: () => void): () => void {
  const observer = () => listener();
  root(doc).observeDeep(observer);
  return () => root(doc).unobserveDeep(observer);
}
