import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStorage, ProjectStorage, ProjectStore, SqliteStorage, pathsFor } from "./index.js";
import {
  applyOpToDoc,
  docFromProject,
  encodeDoc,
  migrateDoc,
  projectFromDoc,
} from "../core/crdt/index.js";
import { diffProjects, parseProject } from "../core/index.js";
import { derivedId } from "../core/project/identity.js";

const PROJECT = `{
  "name": "Test",
  "layers": [
    {
      "id": "lay_a",
      "type": "bytes",
      "address": "$8000",
      "bytes": "ea",
      "length": 16
    }
  ],
  "claims": [
    { "id": "lbl_1", "at": "$8000", "name": "Start", "root": "routine", "origin": "user" },
    { "id": "lbl_2", "at": "$8004", "name": "Loop", "origin": "user" }
  ]
}
`;

/**
 * Every behaviour below is run against both backing stores.
 *
 * They are meant to be indistinguishable from here: anything that is not shows
 * up as a failure rather than as a difference discovered later in production.
 */
interface Backend {
  name: string;
  /** Put a fresh project there. */
  create(dir: string): void;
  /** Another handle on what is already there — a second process would get one. */
  open(dir: string): ProjectStorage;
}

const BACKENDS: Backend[] = [
  {
    name: "on a file",
    create: (dir) => writeFileSync(join(dir, "test.re64"), PROJECT, "utf-8"),
    open: (dir) => new FileStorage(pathsFor(join(dir, "test.re64"))),
  },
  {
    name: "in SQLite",
    create: (dir) => new SqliteStorage(join(dir, "test.re64db")).initialize(PROJECT, 0),
    open: (dir) => new SqliteStorage(join(dir, "test.re64db")),
  },
];

let dir: string;
let backend: Backend;

/** What is stored, read the way the store reads it. */
const storage = () => backend.open(dir);
const currentText = () => storage().readText();
const store = () => new ProjectStore(storage());

describe.each(BACKENDS)("$name", (b) => {
  beforeEach(() => {
    // Assigned per test, not at collection time: doing it in the describe body
    // would leave every test holding whichever backend was registered last.
    backend = b;
    dir = mkdtempSync(join(tmpdir(), "re64-session-"));
    backend.create(dir);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  describe("flattening a session", () => {
    it("writes the file and records one entry, not one per edit", () => {
      const s = store();
      s.addAuthor("alice");
      applyOpToDoc(s.document(), { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "MainLoop", origin: "user" } });
      applyOpToDoc(s.document(), { op: "claim.add", claim: { id: "lbl_1", at: 0x8000, name: "Begin", origin: "user" } });

      const entry = s.flatten(1000);

      expect(entry?.authors).toEqual(["alice"]);
      expect(entry?.summary).toHaveLength(2);
      expect(s.history()).toHaveLength(1);
      expect(currentText()).toContain(`"name": "MainLoop"`);
    });

    it("touches only the lines that changed, keeping the grouping blank", () => {
      // The reason flatten diffs rather than writing the document out: the
      // document knows the content, not how the file was laid out.
      const s = store();
      applyOpToDoc(s.document(), { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "MainLoop", origin: "user" } });
      s.flatten(1000);

      const after = currentText();
      const before = PROJECT.split("\n");
      const now = after.split("\n");

      expect(before.filter((l, i) => l !== now[i])).toHaveLength(1);
      // Compared against the original rather than a literal: splitting on "\n"
      // also yields the empty string after the trailing newline.
      expect(now.filter((l) => !l.trim())).toHaveLength(before.filter((l) => !l.trim()).length);
    });

    it("leaves no trace when nothing changed", () => {
      const s = store();
      s.document();

      expect(s.flatten(1000)).toBeUndefined();
      expect(currentText()).toBe(PROJECT);
      expect(s.history()).toEqual([]);
    });

    it("names everyone who contributed", () => {
      const s = store();
      s.addAuthor("bob");
      s.addAuthor("agent-1");
      s.addAuthor("bob");
      applyOpToDoc(s.document(), { op: "claim.remove", id: "lbl_2" });

      expect(s.flatten(1000)?.authors).toEqual(["agent-1", "bob"]);
    });

    it("accumulates history across sessions", () => {
      // Distinct edits, or the second is an idempotent no-op and there is
      // nothing for the second session to record.
      for (const name of ["A", "B"]) {
        const s = store();
        applyOpToDoc(s.document(), { op: "claim.set", id: "lbl_2", fields: { name } });
        s.flatten(1000);
      }

      expect(store().history()).toHaveLength(2);
    });
  });

  describe("crash safety", () => {
    it("recovers edits from the update log", () => {
      // A killed browser or server must not lose work that was never flattened.
      const first = store();
      applyOpToDoc(first.document(), { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Survived", origin: "user" } });
      // No flatten: simulate the process dying here.

      expect(storage().hasUpdates()).toBe(true);

      const recovered = store();
      const entry = recovered.flatten(2000);

      expect(entry?.summary).toHaveLength(1);
      expect(currentText()).toContain(`"name": "Survived"`);
    });

    it("keeps the log after recording history, because the log is the project", () => {
      // The inverse of what this asserted when the text was canonical. Then a
      // flatten meant the log had served its purpose; now discarding it would
      // discard the work itself.
      const s = store();
      applyOpToDoc(s.document(), { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Done", origin: "user" } });
      s.flatten(1000);

      expect(storage().hasUpdates()).toBe(true);
      const names = (projectFromDoc(store().document()).claims ?? []).map(
        (l) => l.name
      );
      expect(names).toContain("Done");
    });
  });

  describe("the document is the project", () => {
    it("survives a write, which must not clear the log it came from", () => {
      // The log used to be crash-safety for a canonical text, so a write meant
      // it had served its purpose and could go. Now the log *is* the project
      // and the text is the export, so clearing it here deletes everything.
      const s = store();
      applyOpToDoc(s.document(), { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Kept", origin: "user" } });
      s.writeFile();

      expect(storage().hasUpdates()).toBe(true);
      const names = (projectFromDoc(store().document()).claims ?? []).map(
        (l) => l.name
      );
      expect(names).toContain("Kept");
    });

    it("comes back after the process dies mid-edit", () => {
      const s = store();
      applyOpToDoc(s.document(), { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Survived", origin: "user" } });
      // No write, no flatten, no clean exit — just gone.

      const reopened = store();
      const names = (projectFromDoc(reopened.document()).claims ?? []).map(
        (l) => l.name
      );
      expect(names).toContain("Survived");
    });

    it("reaches the same state however many times it is reopened", () => {
      const s = store();
      applyOpToDoc(s.document(), { op: "claim.add", claim: { id: "lbl_1", at: 0x8000, name: "One", root: "routine", origin: "user" } });
      applyOpToDoc(s.document(), { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Two", origin: "user" } });

      const first = JSON.stringify(projectFromDoc(store().document()));
      const second = JSON.stringify(projectFromDoc(store().document()));
      expect(second).toBe(first);
    });

    it("converts a project that predates the document, once", () => {
      // Text but no updates: written before the document was canonical.
      const s = store();
      expect(storage().readSnapshot()).toBeUndefined();
      s.document();
      expect(storage().readSnapshot()?.seqUpto).toBe(0);
    });
  });

  describe("what undo will restore", () => {
    it("records the value the document holds, not the one the export lags at", () => {
      // The export trails the document by up to the write debounce. An inverse
      // computed against it names a value that may already be stale — so a
      // human renames a label, an agent touches it moments later, and undo
      // restores something neither of them ever chose.
      const s = store();
      applyOpToDoc(s.document(), { op: "claim.set", id: "lbl_2", fields: { name: "ByAHuman" } });
      // Deliberately no writeFile(): this is the window the debounce leaves open.
      expect(currentText()).not.toContain("ByAHuman");

      s.runOps([{ op: "claim.set", id: "lbl_2", fields: { name: "ByAnAgent" } }], "agent", 1);

      // The document's value, not the export's stale one.
      const recorded = storage().readOps().at(-1)!;
      expect(recorded.inverse).toMatchObject({
        op: "claim.set",
        id: "lbl_2",
        fields: { name: "ByAHuman" },
      });
    });

    it("restores that value when undone", () => {
      const s = store();
      applyOpToDoc(s.document(), { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "ByAHuman", origin: "user" } });
      s.runOps(
        [{ op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "ByAnAgent", origin: "user" } }],
        "agent",
        1
      );

      s.undo("agent");
      const names = (projectFromDoc(s.document()).claims ?? []).map((l) => l.name);
      expect(names).toContain("ByAHuman");
    });
  });

  describe("the export settles", () => {
    it("agrees with the document, so a write does not provoke another", () => {
      // If the exported text does not round-trip back to the same document,
      // every write finds a difference and writes again. It would look like a
      // phantom collaborator editing in a loop rather than like a bug here.
      const s = store();
      applyOpToDoc(s.document(), { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Renamed", origin: "user" } });

      s.writeFile();
      expect(diffProjects(parseProject(currentText()), projectFromDoc(s.document()))).toEqual([]);
    });

    it("stops writing once there is nothing left to say", () => {
      const s = store();
      applyOpToDoc(s.document(), { op: "claim.add", claim: { id: "lbl_1", at: 0x8000, name: "Once", root: "routine", origin: "user" } });

      expect(s.writeFile().length).toBeGreaterThan(0);
      expect(s.writeFile()).toEqual([]);
      expect(s.writeFile()).toEqual([]);
    });

    it("holds for regions and the primary index too, not just labels", () => {
      const s = store();
      applyOpToDoc(s.document(), { op: "claim.add", claim: { id: "rgn_x", at: 0x8008, extent: 0x800c - 0x8008, name: "blurb", says: { is: "text" }, root: "data", origin: "user" } });
      applyOpToDoc(s.document(), { op: "primary.bind", address: 0x8000, labelId: "lbl_1" });

      s.writeFile();
      expect(diffProjects(parseProject(currentText()), projectFromDoc(s.document()))).toEqual([]);
    });
  });

  describe("two writers on one project", () => {
    // Separate stores over one backing store: the CLI in one process while a
    // server holds a live session in another.
    const two = () => [store(), store()] as const;

    it("does not revert an edit the other made", () => {
      const [server, cli] = two();
      applyOpToDoc(server.document(), { op: "claim.add", claim: { id: "lbl_1", at: 0x8000, name: "FromWeb", root: "routine", origin: "user" } });

      cli.runOps(
        [{ op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "FromCli", origin: "user" } }],
        "cli",
        1
      );

      // The write that used to revert it: the server diffing its document
      // against a text that had changed underneath.
      server.writeFile();

      expect(currentText()).toContain("FromWeb");
      expect(currentText()).toContain("FromCli");
    });

    it("carries the other's pending edit into its own write", () => {
      // The update log is the channel. An edit the server has not yet written is
      // still in the log, and the base revision says it applies to the text the
      // CLI is about to read — so the CLI replays it rather than writing a text
      // that silently drops it.
      const [server, cli] = two();
      applyOpToDoc(server.document(), { op: "claim.add", claim: { id: "lbl_1", at: 0x8000, name: "NotYetWritten", root: "routine", origin: "user" } });
      expect(currentText()).not.toContain("NotYetWritten");

      cli.runOps(
        [{ op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Cli", origin: "user" } }],
        "cli",
        1
      );

      expect(currentText()).toContain("NotYetWritten");
    });
  });

  describe("undo", () => {
    it("restores the exact bytes it started from", () => {
      const s = store();
      s.runOps(
        [{ op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Renamed", origin: "user" } }],
        "cli",
        1
      );
      expect(currentText()).not.toBe(PROJECT);

      s.undo("cli");
      expect(currentText()).toBe(PROJECT);
    });

    it("leaves a collaborator's edit alone and takes its own", () => {
      // The record is shared, so an unscoped undo would let someone at the CLI
      // silently revert what a browser user just did.
      const s = store();
      s.runOps(
        [{ op: "claim.add", claim: { id: "lbl_1", at: 0x8000, name: "ByAlice", root: "routine", origin: "user" } }],
        "alice",
        1
      );
      s.runOps(
        [{ op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "ByBob", origin: "user" } }],
        "bob",
        2
      );

      expect(s.undo("alice").undone).toBe("mark $8000 a routine (ByAlice)");
      expect(currentText()).toContain("ByBob");
      expect(currentText()).not.toContain("ByAlice");
    });

    it("reaches anyone's edit when asked to", () => {
      const s = store();
      s.runOps(
        [{ op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "ByBob", origin: "user" } }],
        "bob",
        1
      );
      expect(s.undo().undone).toBe("name $8004 ByBob");
    });

    it("has nothing to undo when the author did nothing", () => {
      const s = store();
      s.runOps(
        [{ op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "ByBob", origin: "user" } }],
        "bob",
        1
      );
      expect(s.undo("carol").undone).toBeNull();
    });

    it("takes back a whole action, not one operation of it", () => {
      // Two ops, one call, one decision. Before changesets were recorded this
      // reverted the last op and reported the action, so a caller was told
      // something had been taken back that mostly had not.
      const s = store();
      s.runOps(
        [
          { op: "claim.add", claim: { id: "lbl_1", at: 0x8000, name: "First", origin: "user" } },
          { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Second", origin: "user" } },
        ],
        "cli",
        1
      );

      const outcome = s.undo("cli");
      expect(outcome.applied).toBe(2);
      expect(outcome.skipped).toEqual([]);
      expect(currentText()).not.toContain("First");
      expect(currentText()).not.toContain("Second");
    });

    it("scopes to the session, so one identity is not one undo stack", () => {
      // Two agents claiming the same user are two peers, exactly as two
      // browser tabs are, and neither may take back the other's work.
      const s = store();
      s.runOps(
        [{ op: "claim.add", claim: { id: "lbl_1", at: 0x8000, name: "ByOne", origin: "user" } }],
        "usr_agent",
        1,
        "ses_one"
      );
      s.runOps(
        [{ op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "ByTwo", origin: "user" } }],
        "usr_agent",
        2,
        "ses_two"
      );

      expect(s.undo("usr_agent", "ses_one").undone).toBe("name $8000 ByOne");
      expect(currentText()).toContain("ByTwo");
      expect(currentText()).not.toContain("ByOne");
    });

    it("leaves alone what somebody else has changed since, and says so", () => {
      // A stored inverse says what the state was when it was recorded. Applying
      // one after someone else has touched the same field reverts their work,
      // and the CRDT converges on it perfectly happily.
      const s = store();
      s.runOps(
        [
          { op: "claim.add", claim: { id: "lbl_1", at: 0x8000, name: "Mine", origin: "user" } },
          { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "AlsoMine", origin: "user" } },
        ],
        "alice",
        1
      );
      s.runOps(
        [{ op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "BobWasHere", origin: "user" } }],
        "bob",
        2
      );

      const outcome = s.undo("alice");
      expect(outcome.applied).toBe(1);
      expect(outcome.skipped).toEqual([
        { description: "name $8004 AlsoMine", reason: "changed by someone else since" },
      ]);
      // Alice's own untouched edit came back; Bob's survived.
      expect(currentText()).not.toContain("Mine\"");
      expect(currentText()).toContain("BobWasHere");
    });

    it("redoes what it undid, and stops there", () => {
      const s = store();
      s.runOps(
        [{ op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Renamed", origin: "user" } }],
        "cli",
        1
      );
      s.undo("cli");
      expect(s.redo("cli").undone).toBe("name $8004 Renamed");
      expect(currentText()).toContain("Renamed");
      expect(s.redo("cli").undone).toBeNull();
    });
  });

  describe("what the debug view is told", () => {
    it("starts with nothing recorded", () => {
      const s = store();
      s.document();
      const d = s.debug();
      expect(d.dirty).toBe(false);
      expect(d.updates.count).toBe(0);
    });

    it("counts what is waiting to be flattened", () => {
      const s = store();
      s.addAuthor("alice");
      s.runOps(
        [{ op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Renamed", origin: "user" } }],
        "alice",
        1
      );

      const d = s.debug();
      expect(d.dirty).toBe(true);
      expect(d.authors).toEqual(["alice"]);
      expect(d.pendingOps).toBe(1);
      expect(d.ops).toEqual({ total: 1, undone: 0 });
    });

    it("distinguishes an undone operation from a missing one", () => {
      const s = store();
      s.runOps(
        [{ op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Renamed", origin: "user" } }],
        "alice",
        1
      );
      s.undo("alice");

      // Two rows: the edit, now flagged undone, and the entry recording that it
      // was taken back. The flag is what redo walks; the entry is what a reader
      // catching up sees, and a flag flipped on an old row says nothing to a
      // cursor already past it.
      expect(s.debug().ops).toEqual({ total: 2, undone: 1 });
    });

    it("says where the snapshot reaches, so a long log is visible", () => {
      const s = store();
      s.document();
      applyOpToDoc(s.document(), { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Edited", origin: "user" } });
      expect(s.debug().updates.count).toBeGreaterThan(0);
      expect(s.debug().updates.snapshotAt).toBe(0);
    });
  });

  describe("joining", () => {
    it("hands a newcomer the state it is missing", () => {
      const s = store();
      applyOpToDoc(s.document(), { op: "claim.add", claim: { id: "lbl_new", at: 0x8008, name: "Added", origin: "user" } });

      expect(s.snapshot().length).toBeGreaterThan(0);
      expect(Buffer.from(s.snapshot())).toEqual(Buffer.from(encodeDoc(s.document())));
    });
  });
});

describe("history is append-only, and redo walks it", () => {
  /**
   * **Two findings the Codex review reproduced, and they are one subject.**
   *
   * The feed was not append-only: undo flipped an `undone` flag on an old row
   * and added nothing, so an agent holding a cursor past that row saw the state
   * change and no entry explaining it. And redo picked the highest-numbered
   * undone row rather than the action undone most recently — undo `Second` then
   * `First` and both are flagged, while the one to put back is `First`. Redo
   * chose `Second`, found its precondition gone, reported "changed by someone
   * else since" with nobody else in sight, and stayed stuck for ever.
   *
   * The fix for the first is what makes the second answerable: the newest undo
   * entry *names* the action that was taken back.
   */
  const project = JSON.stringify({
    name: "history",
    layers: [{ id: "lay_a", type: "bytes", address: "$8000", bytes: "a9016000" }],
    claims: [{ id: "clm_a", at: "$8000", name: "Original", origin: "user" }],
  });

  const open = () => {
    const dir = mkdtempSync(join(tmpdir(), "re64-history-"));
    const storage = new SqliteStorage(join(dir, "p.re64db"), "p");
    storage.initialize(project, Date.now(), "history");
    return {
      storage,
      store: new ProjectStore(storage),
      name: () => JSON.parse(storage.readText()).claims[0].name as string,
      close: () => {
        storage.close();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  };

  it("appends an entry for an undo, so a cursor past the edit still sees it", () => {
    const f = open();
    try {
      f.store.runOps([{ op: "claim.set", id: "clm_a", fields: { name: "First" } }], "alice", 1, "s");
      const cursor = f.storage.opsCursor();
      f.store.undo("alice", "s");

      expect(f.storage.opsCursor()).toBeGreaterThan(cursor);
      const since = f.storage.readOps(cursor);
      expect(since).toHaveLength(1);
      expect(since[0].kind).toBe("undo");
    } finally {
      f.close();
    }
  });

  it("redoes two undos in the order they were undone", () => {
    const f = open();
    try {
      f.store.runOps([{ op: "claim.set", id: "clm_a", fields: { name: "First" } }], "alice", 1, "s1");
      f.store.runOps([{ op: "claim.set", id: "clm_a", fields: { name: "Second" } }], "alice", 2, "s1");
      expect(f.name()).toBe("Second");

      f.store.undo("alice", "s1");
      f.store.undo("alice", "s1");
      expect(f.name()).toBe("Original");

      expect(f.store.redo("alice", "s1").applied).toBe(1);
      expect(f.name()).toBe("First");
      expect(f.store.redo("alice", "s1").applied).toBe(1);
      expect(f.name()).toBe("Second");
    } finally {
      f.close();
    }
  });

  it("does not let a second undo take back the first", () => {
    // The hazard the `kind` column exists for. An undo is in the feed as its own
    // entry; if undo treated that as a candidate, undoing twice would put the
    // rename back rather than walking further into the past.
    const f = open();
    try {
      f.store.runOps([{ op: "claim.set", id: "clm_a", fields: { name: "First" } }], "alice", 1, "s1");
      f.store.runOps([{ op: "claim.set", id: "clm_a", fields: { name: "Second" } }], "alice", 2, "s1");
      f.store.undo("alice", "s1");
      expect(f.name()).toBe("First");
      f.store.undo("alice", "s1");
      expect(f.name()).toBe("Original");
    } finally {
      f.close();
    }
  });
});

describe("a socket update is one action, and each inverse undoes its own op", () => {
  /**
   * **The socket path paired forward and reverse diffs by array position.**
   *
   * Both diffs order operations by entity and category, and neither promises
   * the matching inverse lands at the same index. One update that removed
   * `clm_a` and added `clm_b` paired *remove clm_a* with *remove clm_b*, and
   * *add clm_b* with *add clm_a* — so undoing either restored or deleted the
   * wrong entity, and nothing about the log looked wrong.
   *
   * Each inverse is now computed against the state its own operation saw,
   * walking forward: the same thing `runOps` does, for the same reason.
   *
   * The rows also carried no session and no changeset, though the relay knows
   * both — so a multi-operation click could not be undone as one thing.
   */
  const project = JSON.stringify({
    name: "socket",
    layers: [{ id: "lay_a", type: "bytes", address: "$8000", bytes: "a9016000" }],
    claims: [{ id: "clm_a", at: "$8000", name: "Original", root: "routine", origin: "user" }],
  });

  const open = () => {
    const dir = mkdtempSync(join(tmpdir(), "re64-socket-"));
    const storage = new SqliteStorage(join(dir, "p.re64db"), "p");
    storage.initialize(project, Date.now(), "socket");
    return {
      storage,
      store: new ProjectStore(storage),
      close: () => {
        storage.close();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  };

  it("gives each operation the inverse that undoes it", () => {
    const f = open();
    try {
      f.store.attributeWith(
        (origin) => (origin === "socket" ? "alice" : undefined),
        (origin) => (origin === "socket" ? "ses_socket" : undefined)
      );
      const peer = docFromProject(parseProject(project));
      applyOpToDoc(peer, { op: "claim.remove", id: "clm_a" });
      applyOpToDoc(peer, {
        op: "claim.add",
        claim: { id: "clm_b", at: 0x8000, name: "Replacement", origin: "user" },
      });
      f.store.merge(encodeDoc(peer), "socket");

      const log = f.storage.readOps();
      expect(log.length).toBe(2);

      // Every pair is self-consistent: the inverse names the entity its own
      // operation named. Pairing by index gave two rows that each named the
      // other's.
      for (const change of log) {
        const named = (op: (typeof change)["op"]): string =>
          "id" in op ? op.id : "claim" in op ? op.claim.id : "";
        expect(named(change.inverse)).toBe(named(change.op));
      }
    } finally {
      f.close();
    }
  });

  it("records the session and groups the update as one changeset", () => {
    const f = open();
    try {
      f.store.attributeWith(
        (origin) => (origin === "socket" ? "alice" : undefined),
        (origin) => (origin === "socket" ? "ses_socket" : undefined)
      );
      const peer = docFromProject(parseProject(project));
      applyOpToDoc(peer, { op: "claim.set", id: "clm_a", fields: { name: "Renamed" } });
      applyOpToDoc(peer, {
        op: "claim.add",
        claim: { id: "clm_c", at: 0x8002, name: "Second", origin: "user" },
      });
      f.store.merge(encodeDoc(peer), "socket");

      const log = f.storage.readOps();
      expect(log.every((c) => c.session === "ses_socket")).toBe(true);
      expect(new Set(log.map((c) => c.changeset)).size).toBe(1);
    } finally {
      f.close();
    }
  });
});

describe("a document stored before bindings were keyed by site", () => {
  /**
   * **Rekeying the text import never reached a stored document.** A store
   * restores a snapshot plus its updates through `docFromUpdates`, so a
   * `.re64db` written yesterday still held uses keyed by use id — and an
   * upgraded project kept the R4 behaviour exactly: binding again added a second
   * entry beside the id-keyed one, and unbinding removed the new entry and left
   * the old.
   *
   * And its **history** was written in the old shape too. An inverse stored for
   * a bind was `unbind {id, layerId}` with no address, and the rows are JSON
   * that nothing rewrites, so undo formatted an address that was not there and
   * threw. The document can be migrated; the history has to be understood.
   *
   * Bytes as `main` wrote them at `c0eeb4b`, cross-checked against its
   * `docFromProject`: uses keyed by id as nested maps. Two constants at `$8000`
   * — the accumulation itself — one at `$8004` for labels, and a tail update
   * adding one at `$8010`.
   */
  const SNAPSHOT = Buffer.from(
    "ARa1/Z3LCAAHAQZsYXllcnMBKAC1/Z3LCAACaWQBdwVsYXlfYSgAtf2dywgABHR5cGUBdwVieXRlcygAtf2dywgAB2FkZHJlc3MBdwUkODAwMCgAtf2dywgABWJ5dGVzAXcQYTkwMTYwMDBhOTAyNjAwMCcAtf2dywgABmxhYmVscwEnALX9ncsIAAdyZWdpb25zAScAtf2dywgACGNvbW1lbnRzAScAtf2dywgADGNvbnN0YW50VXNlcwEnALX9ncsICAZjc3RfdTABKAC1/Z3LCAkCaWQBdwZjc3RfdTAoALX9ncsICQdhZGRyZXNzAXcFJDgwMDAoALX9ncsICQhjb25zdGFudAF3BWNzdF9iJwC1/Z3LCAgGY3N0X3UxASgAtf2dywgNAmlkAXcGY3N0X3UxKAC1/Z3LCA0HYWRkcmVzcwF3BSQ4MDAwKAC1/Z3LCA0IY29uc3RhbnQBdwVjc3RfYScAtf2dywgACWxhYmVsVXNlcwEnALX9ncsIEQZsYmxfdTEBKAC1/Z3LCBICaWQBdwZsYmxfdTEoALX9ncsIEgdhZGRyZXNzAXcFJDgwMDQoALX9ncsIEgVsYWJlbAF3BWNsbV8xAA==",
    "base64"
  );
  const LATER = Buffer.from(
    "AQS1/Z3LCBYnALX9ncsICAZjc3RfdTIBKAC1/Z3LCBYCaWQBdwZjc3RfdTIoALX9ncsIFgdhZGRyZXNzAXcFJDgwMTAoALX9ncsIFghjb25zdGFudAF3BWNzdF9iAA==",
    "base64"
  );
  const text = JSON.stringify({
    name: "legacy",
    layers: [{ id: "lay_a", type: "bytes", address: "$8000", bytes: "a9016000a9026000" }],
    constants: [
      { id: "cst_a", name: "ONE", value: "$01" },
      { id: "cst_b", name: "WHITE", value: "$01" },
    ],
    claims: [{ id: "clm_1", at: "$8004", name: "Start", root: "routine", origin: "user" }],
  });

  const bindings = (store: ProjectStore) => {
    const layer = projectFromDoc(store.document()).layers[0];
    return {
      constants: (layer.constantUses ?? []).map((u) => `${u.address}=${u.constant}`).sort(),
      labels: (layer.labelUses ?? []).map((u) => `${u.address}=${u.label}`).sort(),
    };
  };

  const opened = () => {
    const dir = mkdtempSync(join(tmpdir(), "re64-legacy-uses-"));
    const storage = new SqliteStorage(join(dir, "p.re64db"), "p");
    storage.initialize(text, Date.now(), "legacy");
    storage.writeSnapshot({ seqUpto: 0, update: new Uint8Array(SNAPSHOT) });
    storage.appendUpdate(new Uint8Array(LATER));
    return { dir, storage, store: new ProjectStore(storage) };
  };

  it("keys every use by its site, keeping the reading views already showed", () => {
    const f = opened();
    try {
      // Two were at $8000; the one whose id sorts last is the one the loaded
      // index had been showing, so it is the one kept.
      expect(bindings(f.store)).toEqual({
        constants: ["$8000=cst_a", "$8010=cst_b"],
        labels: ["$8004=clm_1"],
      });

      // Rebinding replaces and unbinding clears — the R4 contract, on an
      // upgraded project.
      f.store.runOps(
        [{ op: "constantUse.bind", id: "cst_new", layerId: "lay_a", address: 0x8000, constantId: "cst_b" }],
        "alice",
        1
      );
      expect(bindings(f.store).constants).toEqual(["$8000=cst_b", "$8010=cst_b"]);
      f.store.runOps(
        [{ op: "constantUse.unbind", id: "cst_new", layerId: "lay_a", address: 0x8000 }],
        "alice",
        2
      );
      expect(bindings(f.store).constants).toEqual(["$8010=cst_b"]);

      // Reopened: the migration was persisted, so the edits that named the
      // migrated items are found again.
      const again = new ProjectStore(f.storage);
      expect(bindings(again).constants).toEqual(["$8010=cst_b"]);
      expect(migrateDoc(again.document())).toBe(false);
    } finally {
      f.storage.close();
      rmSync(f.dir, { recursive: true, force: true });
    }
  });

  it("undoes and redoes history whose inverses carry no address", () => {
    const f = opened();
    try {
      f.store.document();
      // A row as main recorded it: the bind that produced `cst_u1`, with the
      // inverse main computed for it — an unbind by id, no site.
      f.storage.appendOps([
        {
          op: { op: "constantUse.bind", id: "cst_u1", layerId: "lay_a", address: 0x8000, constantId: "cst_a" },
          inverse: { op: "constantUse.unbind", id: "cst_u1", layerId: "lay_a" },
          author: "alice",
          session: "ses_old",
          at: 1,
          changeset: "cs_old",
        },
      ]);

      const undone = f.store.undo("alice", "ses_old");
      expect(undone.undone).toBeTruthy();
      expect(bindings(f.store).constants).toEqual(["$8010=cst_b"]);

      const redone = f.store.redo("alice", "ses_old");
      expect(redone.undone).toBeTruthy();
      expect(bindings(f.store).constants).toEqual(["$8000=cst_a", "$8010=cst_b"]);
    } finally {
      f.storage.close();
      rmSync(f.dir, { recursive: true, force: true });
    }
  });
});

describe("a document stored before fields had ids", () => {
  /**
   * **The text migration never reached a stored document.** A store restores a
   * snapshot plus its updates through `docFromUpdates`, and neither path visits
   * `fieldsOfType` or `docFromProject` — so a `.re64db` written yesterday still
   * held fields keyed by offset as plain objects. The projection dropped the
   * offsets, and `field.set` and `field.remove` looked up ids that were not
   * keys and did nothing: a field that could be renamed and removed yesterday
   * could be neither today, and nothing said so.
   *
   * Built by hand in the old shape rather than from a fixture on disk, because
   * the shape is the point and a binary fixture goes stale in silence.
   */
  const text = JSON.stringify({
    name: "legacy",
    layers: [{ id: "lay_a", type: "bytes", address: "$8000", bytes: "a9016000" }],
    types: [{ id: "typ_a", name: "Sprite", size: 16, fields: {} }],
  });

  // **Two updates in the old shape, as `main` wrote them at `c0eeb4b`.** The
  // first is a snapshot holding `fld_a` under the key `"4"` as a plain object;
  // the second, recorded after it, adds a field under `"12"` with no id at all,
  // as the earliest files did. Bytes rather than a builder, because this test
  // cannot name Yjs — the boundary test keeps it inside `src/core/crdt` — and
  // the old shape is frozen history that no builder in this tree still writes.
  // Cross-checked against `typeMapFrom` at that commit:
  // `fields.set(key, type.fields[key])`, keyed by offset, values plain.
  const SNAPSHOT = Buffer.from(
    "AQaa0+7nCgAnAQV0eXBlcwV0eXBfYQEoAJrT7ucKAAJpZAF3BXR5cF9hKACa0+7nCgAEbmFtZQF3BlNwcml0ZSgAmtPu5woABHNpemUBfRAnAJrT7ucKAAZmaWVsZHMBKACa0+7nCgQBNAF2AwJpZHcFZmxkX2EEbmFtZXcBeAR0eXBldwJ1OAA=",
    "base64"
  );
  const LATER = Buffer.from("AQGa0+7nCgYoAJrT7ucKBAIxMgF2AgRuYW1ldwF5BHR5cGV3AnU4AA==", "base64");

  const fieldsOf = (store: ProjectStore) =>
    projectFromDoc(store.document()).types![0].fields.map((f) => ({
      id: f.id,
      offset: f.offset,
      name: f.name,
    }));

  it("keeps ids, offsets and later work, and takes edits by id again", () => {
    const dir = mkdtempSync(join(tmpdir(), "re64-legacy-fields-"));
    const storage = new SqliteStorage(join(dir, "p.re64db"), "p");
    try {
      storage.initialize(text, Date.now(), "legacy");
      storage.writeSnapshot({ seqUpto: 0, update: new Uint8Array(SNAPSHOT) });
      storage.appendUpdate(new Uint8Array(LATER));

      const store = new ProjectStore(storage);
      expect(fieldsOf(store)).toEqual([
        { id: "fld_a", offset: 4, name: "x" },
        { id: expect.stringMatching(/^fld_/), offset: 12, name: "y" },
      ]);
      const derived = fieldsOf(store)[1].id!;

      store.runOps(
        [{ op: "field.set", id: "fld_a", typeId: "typ_a", fields: { name: "renamed" } }],
        "alice",
        1
      );
      store.runOps([{ op: "field.remove", id: derived, typeId: "typ_a" }], "alice", 2);
      expect(fieldsOf(store)).toEqual([{ id: "fld_a", offset: 4, name: "renamed" }]);

      // Reopened: the migration was persisted, so the edits that named the
      // migrated items are found again rather than held pending for ever.
      const again = new ProjectStore(storage);
      expect(fieldsOf(again)).toEqual([{ id: "fld_a", offset: 4, name: "renamed" }]);
      expect(migrateDoc(again.document())).toBe(false);
    } finally {
      storage.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("history written in the old type shapes", () => {
  /**
   * **The rows are JSON that nothing rewrites.** The document is migrated when
   * the store opens it; the operations and inverses recorded against yesterday's
   * shapes are not, because a row is applied to whatever state it meets. Two
   * shapes have gone — `type.add` keyed its fields by offset, and `type.set`
   * carried an offset-keyed child patch — and undo of either threw, or worse,
   * reported success and changed nothing.
   *
   * Rows here are spelled exactly as `main` recorded them at `c0eeb4b`,
   * including the inverses its `invertOp` computed. The document itself is
   * built fresh from text, so this exercises the history boundary alone.
   */
  const text = (fields: Record<string, { id: string; name: string; type: string }>) =>
    JSON.stringify({
      name: "history",
      layers: [{ id: "lay_a", type: "bytes", address: "$8000", bytes: "a9016000" }],
      types: [{ id: "typ_a", name: "Sprite", size: 8, fields }],
    });
  const OLD_ADD = {
    op: "type.add",
    id: "typ_a",
    name: "Sprite",
    size: 8,
    fields: {
      0: { id: "fld_a", name: "x", type: "u8" },
      4: { id: "fld_b", name: "y", type: "u8" },
    },
  };
  const row = (op: unknown, inverse: unknown) =>
    [{ op, inverse, author: "alice", session: "ses_old", at: 1, changeset: "cs_old" }] as unknown as Parameters<
      SqliteStorage["appendOps"]
    >[0];

  const opened = (project: string) => {
    const dir = mkdtempSync(join(tmpdir(), "re64-old-history-"));
    const storage = new SqliteStorage(join(dir, "p.re64db"), "p");
    storage.initialize(project, Date.now(), "history");
    const store = new ProjectStore(storage);
    store.document();
    const fields = () =>
      (projectFromDoc(store.document()).types?.[0]?.fields ?? []).map(
        (f) => `${f.id}@${f.offset}:${f.name}`
      );
    const close = () => {
      storage.close();
      rmSync(dir, { recursive: true, force: true });
    };
    return { storage, store, fields, close };
  };

  it("undoes and redoes an old type.add", () => {
    const f = opened(text({ 0: { id: "fld_a", name: "x", type: "u8" }, 4: { id: "fld_b", name: "y", type: "u8" } }));
    try {
      f.storage.appendOps(row(OLD_ADD, { op: "type.remove", id: "typ_a" }));
      expect(f.store.undo("alice", "ses_old").undone).toBeTruthy();
      expect(projectFromDoc(f.store.document()).types ?? []).toHaveLength(0);
      expect(f.store.redo("alice", "ses_old").undone).toBeTruthy();
      expect(f.fields()).toEqual(["fld_a@0:x", "fld_b@4:y"]);
    } finally {
      f.close();
    }
  });

  it("undoes an old type.remove, whose inverse is an old type.add", () => {
    const f = opened(JSON.stringify({ name: "h", layers: [{ id: "lay_a", type: "bytes", address: "$8000", bytes: "a9016000" }] }));
    try {
      f.storage.appendOps(row({ op: "type.remove", id: "typ_a" }, OLD_ADD));
      expect(f.store.undo("alice", "ses_old").undone).toBeTruthy();
      expect(f.fields()).toEqual(["fld_a@0:x", "fld_b@4:y"]);
      expect(f.store.redo("alice", "ses_old").undone).toBeTruthy();
      expect(projectFromDoc(f.store.document()).types ?? []).toHaveLength(0);
    } finally {
      f.close();
    }
  });

  it("undoes an old type.set child patch, rather than reporting it done", () => {
    const f = opened(text({ 0: { id: "fld_a", name: "changed", type: "u8" } }));
    try {
      f.storage.appendOps(
        row(
          { op: "type.set", id: "typ_a", fields: { fields: { 0: { id: "fld_a", name: "changed", type: "u8" } } } },
          { op: "type.set", id: "typ_a", fields: { fields: { 0: { id: "fld_a", name: "old", type: "u8" } } } }
        )
      );
      const undone = f.store.undo("alice", "ses_old");
      expect(undone.undone).toBeTruthy();
      expect(undone.skipped).toEqual([]);
      expect(f.fields()).toEqual(["fld_a@0:old"]);
      expect(f.store.redo("alice", "ses_old").undone).toBeTruthy();
      expect(f.fields()).toEqual(["fld_a@0:changed"]);

      // A `null` child removed whatever sat at the offset, and an entry with no
      // id declared a field there; both still mean that. Its own changeset,
      // and a state that matches it — the row records an action already done.
      const declared = derivedId("fld", "typ_a", 4);
      f.store.runOps(
        [
          { op: "field.remove", id: "fld_a", typeId: "typ_a" },
          { op: "field.add", id: declared, typeId: "typ_a", offset: 4, name: "y", type: "u8" },
        ],
        "bob",
        5
      );
      f.storage.appendOps(
        [
          {
            op: { op: "type.set", id: "typ_a", fields: { fields: { 0: null, 4: { name: "y", type: "u8" } } } },
            inverse: { op: "type.set", id: "typ_a", fields: { fields: { 0: { id: "fld_a", name: "changed", type: "u8" }, 4: null } } },
            author: "alice",
            session: "ses_two",
            at: 6,
            changeset: "cs_two",
          },
        ] as unknown as Parameters<SqliteStorage["appendOps"]>[0]
      );
      const second = f.store.undo("alice", "ses_two");
      expect(second.skipped).toEqual([]);
      expect(f.fields()).toEqual(["fld_a@0:changed"]);
    } finally {
      f.close();
    }
  });

  /**
   * **A legacy child value was a replacement, not a patch.** The old adapter
   * wrote `fields[offset] = field`, so a child that omitted `description`
   * removed one — and the inverses it recorded rely on that. Reading the child
   * as a patch kept a description the row meant to clear, while reporting the
   * row applied. Checked on the description itself, not on the outcome count.
   */
  const described = (store: ProjectStore) =>
    projectFromDoc(store.document()).types![0].fields[0].description;
  const child = (description?: string) => ({
    op: "type.set",
    id: "typ_a",
    fields: { fields: { 0: { id: "fld_a", name: "x", type: "u8", ...(description === undefined ? {} : { description }) } } },
  });

  it("takes back a description an old child patch added", () => {
    const f = opened(
      JSON.stringify({
        name: "h",
        layers: [{ id: "lay_a", type: "bytes", address: "$8000", bytes: "a9016000" }],
        types: [{ id: "typ_a", name: "Sprite", size: 8, fields: { 0: { id: "fld_a", name: "x", type: "u8", description: "new description" } } }],
      })
    );
    try {
      // The row: the field had no description, and the child gave it one.
      f.storage.appendOps(row(child("new description"), child()));
      expect(f.store.undo("alice", "ses_old").skipped).toEqual([]);
      expect(described(f.store)).toBeUndefined();
      expect(f.store.redo("alice", "ses_old").skipped).toEqual([]);
      expect(described(f.store)).toBe("new description");
    } finally {
      f.close();
    }
  });

  it("clears a description again when an old child patch that cleared it is redone", () => {
    const f = opened(
      JSON.stringify({
        name: "h",
        layers: [{ id: "lay_a", type: "bytes", address: "$8000", bytes: "a9016000" }],
        types: [{ id: "typ_a", name: "Sprite", size: 8, fields: { 0: { id: "fld_a", name: "x", type: "u8" } } }],
      })
    );
    try {
      // The row: the field said "old description", and the child omitted it.
      f.storage.appendOps(row(child(), child("old description")));
      expect(f.store.undo("alice", "ses_old").skipped).toEqual([]);
      expect(described(f.store)).toBe("old description");
      expect(f.store.redo("alice", "ses_old").skipped).toEqual([]);
      expect(described(f.store)).toBeUndefined();
    } finally {
      f.close();
  });
});

describe("a failed write is not served", () => {
  /**
   * **`runOps` published before it committed.**
   *
   * It mutated the live document, persisted the update event and notified every
   * listener, and only then appended the operation log and committed. A SQL
   * rollback cannot un-mutate a `Y.Doc` and cannot recall a notification — so a
   * caller could be handed an error while readers and other clients had already
   * been told the edit happened, and a restart then rebuilt a document that
   * disagreed with both.
   *
   * Invariant A5 disclaims *distributed* transaction atomicity, and rightly.
   * This is a local commit-ordering defect and a different thing.
   *
   * Publication now waits for the commit, because that is the one part a
   * rollback genuinely cannot take back. On failure the in-memory document is
   * dropped and rebuilt from what actually committed, so the server never keeps
   * serving state no restart would reproduce.
   */
  const project = JSON.stringify({
    name: "commit",
    layers: [{ id: "lay_a", type: "bytes", address: "$8000", bytes: "a9016000" }],
    claims: [{ id: "clm_a", at: "$8000", name: "Original", origin: "user" }],
  });

  it("neither serves nor publishes an edit whose write failed", () => {
    const dir = mkdtempSync(join(tmpdir(), "re64-commit-"));
    const storage = new SqliteStorage(join(dir, "p.re64db"), "p");
    storage.initialize(project, Date.now(), "commit");

    // Fails at the last durable step, which is exactly where the ordering used
    // to matter: everything before it had already been published.
    const failing = Object.create(storage) as SqliteStorage;
    failing.appendOps = () => {
      throw new Error("injected appendOps failure");
    };

    const store = new ProjectStore(failing);
    const seen: unknown[] = [];
    store.document();
    store.onUpdate(() => seen.push(1));

    try {
      expect(() =>
        store.runOps([{ op: "claim.set", id: "clm_a", fields: { name: "Uncommitted" } }], "alice", 1)
      ).toThrow(/injected/);

      // Nobody was told.
      expect(seen).toHaveLength(0);
      // What is served is what committed...
      expect(projectFromDoc(store.document()).claims![0].name).toBe("Original");
      // ...and so is what a restart would rebuild.
      expect(
        projectFromDoc(new ProjectStore(storage).document()).claims![0].name
      ).toBe("Original");
    } finally {
      storage.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
