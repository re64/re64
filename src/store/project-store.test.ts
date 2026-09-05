import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStorage, ProjectStorage, ProjectStore, SqliteStorage, pathsFor } from "./index.js";
import { applyOpToDoc, encodeDoc, projectFromDoc } from "../core/crdt/index.js";
import { diffProjects, parseProject } from "../core/index.js";

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
    { "id": "lbl_1", "at": "$8000", "name": "Start", "root": "routine", "author": "marcus", "source": "user" },
    { "id": "lbl_2", "at": "$8004", "name": "Loop", "author": "marcus", "source": "user" }
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
      applyOpToDoc(s.document(), { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "MainLoop", by: { author: "test", source: "user" } } });
      applyOpToDoc(s.document(), { op: "claim.add", claim: { id: "lbl_1", at: 0x8000, name: "Begin", by: { author: "test", source: "user" } } });

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
      applyOpToDoc(s.document(), { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "MainLoop", by: { author: "test", source: "user" } } });
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
      applyOpToDoc(first.document(), { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Survived", by: { author: "test", source: "user" } } });
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
      applyOpToDoc(s.document(), { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Done", by: { author: "test", source: "user" } } });
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
      applyOpToDoc(s.document(), { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Kept", by: { author: "test", source: "user" } } });
      s.writeFile();

      expect(storage().hasUpdates()).toBe(true);
      const names = (projectFromDoc(store().document()).claims ?? []).map(
        (l) => l.name
      );
      expect(names).toContain("Kept");
    });

    it("comes back after the process dies mid-edit", () => {
      const s = store();
      applyOpToDoc(s.document(), { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Survived", by: { author: "test", source: "user" } } });
      // No write, no flatten, no clean exit — just gone.

      const reopened = store();
      const names = (projectFromDoc(reopened.document()).claims ?? []).map(
        (l) => l.name
      );
      expect(names).toContain("Survived");
    });

    it("reaches the same state however many times it is reopened", () => {
      const s = store();
      applyOpToDoc(s.document(), { op: "claim.add", claim: { id: "lbl_1", at: 0x8000, name: "One", root: "routine", by: { author: "test", source: "user" } } });
      applyOpToDoc(s.document(), { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Two", by: { author: "test", source: "user" } } });

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
      applyOpToDoc(s.document(), { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "ByAHuman", by: { author: "test", source: "user" } } });
      s.runOps(
        [{ op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "ByAnAgent", by: { author: "test", source: "user" } } }],
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
      applyOpToDoc(s.document(), { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Renamed", by: { author: "test", source: "user" } } });

      s.writeFile();
      expect(diffProjects(parseProject(currentText()), projectFromDoc(s.document()))).toEqual([]);
    });

    it("stops writing once there is nothing left to say", () => {
      const s = store();
      applyOpToDoc(s.document(), { op: "claim.add", claim: { id: "lbl_1", at: 0x8000, name: "Once", root: "routine", by: { author: "test", source: "user" } } });

      expect(s.writeFile().length).toBeGreaterThan(0);
      expect(s.writeFile()).toEqual([]);
      expect(s.writeFile()).toEqual([]);
    });

    it("holds for regions and the primary index too, not just labels", () => {
      const s = store();
      applyOpToDoc(s.document(), { op: "claim.add", claim: { id: "rgn_x", at: 0x8008, extent: 0x800c - 0x8008, name: "blurb", says: { is: "text" }, root: "data", by: { author: "test", source: "user" } } });
      applyOpToDoc(s.document(), { op: "primary.set", address: 0x8000, labelId: "lbl_1" });

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
      applyOpToDoc(server.document(), { op: "claim.add", claim: { id: "lbl_1", at: 0x8000, name: "FromWeb", root: "routine", by: { author: "test", source: "user" } } });

      cli.runOps(
        [{ op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "FromCli", by: { author: "test", source: "user" } } }],
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
      applyOpToDoc(server.document(), { op: "claim.add", claim: { id: "lbl_1", at: 0x8000, name: "NotYetWritten", root: "routine", by: { author: "test", source: "user" } } });
      expect(currentText()).not.toContain("NotYetWritten");

      cli.runOps(
        [{ op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Cli", by: { author: "test", source: "user" } } }],
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
        [{ op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Renamed", by: { author: "test", source: "user" } } }],
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
        [{ op: "claim.add", claim: { id: "lbl_1", at: 0x8000, name: "ByAlice", root: "routine", by: { author: "test", source: "user" } } }],
        "alice",
        1
      );
      s.runOps(
        [{ op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "ByBob", by: { author: "test", source: "user" } } }],
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
        [{ op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "ByBob", by: { author: "test", source: "user" } } }],
        "bob",
        1
      );
      expect(s.undo().undone).toBe("name $8004 ByBob");
    });

    it("has nothing to undo when the author did nothing", () => {
      const s = store();
      s.runOps(
        [{ op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "ByBob", by: { author: "test", source: "user" } } }],
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
          { op: "claim.add", claim: { id: "lbl_1", at: 0x8000, name: "First", by: { author: "test", source: "user" } } },
          { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Second", by: { author: "test", source: "user" } } },
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
        [{ op: "claim.add", claim: { id: "lbl_1", at: 0x8000, name: "ByOne", by: { author: "test", source: "user" } } }],
        "usr_agent",
        1,
        "ses_one"
      );
      s.runOps(
        [{ op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "ByTwo", by: { author: "test", source: "user" } } }],
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
          { op: "claim.add", claim: { id: "lbl_1", at: 0x8000, name: "Mine", by: { author: "test", source: "user" } } },
          { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "AlsoMine", by: { author: "test", source: "user" } } },
        ],
        "alice",
        1
      );
      s.runOps(
        [{ op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "BobWasHere", by: { author: "test", source: "user" } } }],
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
        [{ op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Renamed", by: { author: "test", source: "user" } } }],
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
        [{ op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Renamed", by: { author: "test", source: "user" } } }],
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
        [{ op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Renamed", by: { author: "test", source: "user" } } }],
        "alice",
        1
      );
      s.undo("alice");

      expect(s.debug().ops).toEqual({ total: 1, undone: 1 });
    });

    it("says where the snapshot reaches, so a long log is visible", () => {
      const s = store();
      s.document();
      applyOpToDoc(s.document(), { op: "claim.add", claim: { id: "lbl_2", at: 0x8004, name: "Edited", by: { author: "test", source: "user" } } });
      expect(s.debug().updates.count).toBeGreaterThan(0);
      expect(s.debug().updates.snapshotAt).toBe(0);
    });
  });

  describe("joining", () => {
    it("hands a newcomer the state it is missing", () => {
      const s = store();
      applyOpToDoc(s.document(), { op: "claim.add", claim: { id: "lbl_new", at: 0x8008, name: "Added", by: { author: "test", source: "user" } } });

      expect(s.snapshot().length).toBeGreaterThan(0);
      expect(Buffer.from(s.snapshot())).toEqual(Buffer.from(encodeDoc(s.document())));
    });
  });
});
