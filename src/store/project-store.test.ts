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
      "length": 16,
      "labels": [
        { "id": "lbl_1", "address": "$8000", "name": "Start", "type": "function" },

        { "id": "lbl_2", "address": "$8004", "name": "Loop" }
      ]
    }
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
      applyOpToDoc(s.document(), {
        op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "MainLoop",
      });
      applyOpToDoc(s.document(), {
        op: "label.set", id: "lbl_1", layerId: "lay_a", address: 0x8000, name: "Begin",
      });

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
      applyOpToDoc(s.document(), {
        op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "MainLoop",
      });
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
      applyOpToDoc(s.document(), {
        op: "label.delete", id: "lbl_2", layerId: "lay_a",
      });

      expect(s.flatten(1000)?.authors).toEqual(["agent-1", "bob"]);
    });

    it("accumulates history across sessions", () => {
      for (const name of ["A", "B"]) {
        const s = store();
        applyOpToDoc(s.document(), {
          op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name,
        });
        s.flatten(1000);
      }

      expect(store().history()).toHaveLength(2);
    });
  });

  describe("crash safety", () => {
    it("recovers edits from the update log", () => {
      // A killed browser or server must not lose work that was never flattened.
      const first = store();
      applyOpToDoc(first.document(), {
        op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "Survived",
      });
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
      applyOpToDoc(s.document(), {
        op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "Done",
      });
      s.flatten(1000);

      expect(storage().hasUpdates()).toBe(true);
      const names = (projectFromDoc(store().document()).layers[0].labels ?? []).map(
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
      applyOpToDoc(s.document(), {
        op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "Kept",
      });
      s.writeFile();

      expect(storage().hasUpdates()).toBe(true);
      const names = (projectFromDoc(store().document()).layers[0].labels ?? []).map(
        (l) => l.name
      );
      expect(names).toContain("Kept");
    });

    it("comes back after the process dies mid-edit", () => {
      const s = store();
      applyOpToDoc(s.document(), {
        op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "Survived",
      });
      // No write, no flatten, no clean exit — just gone.

      const reopened = store();
      const names = (projectFromDoc(reopened.document()).layers[0].labels ?? []).map(
        (l) => l.name
      );
      expect(names).toContain("Survived");
    });

    it("reaches the same state however many times it is reopened", () => {
      const s = store();
      applyOpToDoc(s.document(), {
        op: "label.set", id: "lbl_1", layerId: "lay_a", address: 0x8000, name: "One",
        type: "function",
      });
      applyOpToDoc(s.document(), {
        op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "Two",
      });

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

  describe("the export settles", () => {
    it("agrees with the document, so a write does not provoke another", () => {
      // If the exported text does not round-trip back to the same document,
      // every write finds a difference and writes again. It would look like a
      // phantom collaborator editing in a loop rather than like a bug here.
      const s = store();
      applyOpToDoc(s.document(), {
        op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "Renamed",
      });

      s.writeFile();
      expect(diffProjects(parseProject(currentText()), projectFromDoc(s.document()))).toEqual([]);
    });

    it("stops writing once there is nothing left to say", () => {
      const s = store();
      applyOpToDoc(s.document(), {
        op: "label.set", id: "lbl_1", layerId: "lay_a", address: 0x8000, name: "Once",
        type: "function",
      });

      expect(s.writeFile().length).toBeGreaterThan(0);
      expect(s.writeFile()).toEqual([]);
      expect(s.writeFile()).toEqual([]);
    });

    it("holds for regions and the primary index too, not just labels", () => {
      const s = store();
      applyOpToDoc(s.document(), {
        op: "region.set", id: "rgn_x", layerId: "lay_a", start: 0x8008, end: 0x800c,
        kind: "text", name: "blurb",
      });
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
      applyOpToDoc(server.document(), {
        op: "label.set", id: "lbl_1", layerId: "lay_a", address: 0x8000, name: "FromWeb",
        type: "function",
      });

      cli.runOps(
        [{ op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "FromCli" }],
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
      applyOpToDoc(server.document(), {
        op: "label.set", id: "lbl_1", layerId: "lay_a", address: 0x8000, name: "NotYetWritten",
        type: "function",
      });
      expect(currentText()).not.toContain("NotYetWritten");

      cli.runOps(
        [{ op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "Cli" }],
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
        [{ op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "Renamed" }],
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
        [{ op: "label.set", id: "lbl_1", layerId: "lay_a", address: 0x8000, name: "ByAlice",
           type: "function" }],
        "alice",
        1
      );
      s.runOps(
        [{ op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "ByBob" }],
        "bob",
        2
      );

      expect(s.undo("alice")).toBe("set $8000 to ByAlice (function)");
      expect(currentText()).toContain("ByBob");
      expect(currentText()).not.toContain("ByAlice");
    });

    it("reaches anyone's edit when asked to", () => {
      const s = store();
      s.runOps(
        [{ op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "ByBob" }],
        "bob",
        1
      );
      expect(s.undo()).toBe("set $8004 to ByBob");
    });

    it("has nothing to undo when the author did nothing", () => {
      const s = store();
      s.runOps(
        [{ op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "ByBob" }],
        "bob",
        1
      );
      expect(s.undo("carol")).toBeNull();
    });

    it("redoes what it undid, and stops there", () => {
      const s = store();
      s.runOps(
        [{ op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "Renamed" }],
        "cli",
        1
      );
      s.undo("cli");
      expect(s.redo("cli")).toBe("set $8004 to Renamed");
      expect(currentText()).toContain("Renamed");
      expect(s.redo("cli")).toBeNull();
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
        [{ op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "Renamed" }],
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
        [{ op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "Renamed" }],
        "alice",
        1
      );
      s.undo("alice");

      expect(s.debug().ops).toEqual({ total: 1, undone: 1 });
    });

    it("says where the snapshot reaches, so a long log is visible", () => {
      const s = store();
      s.document();
      applyOpToDoc(s.document(), {
        op: "label.set", id: "lbl_2", layerId: "lay_a", address: 0x8004, name: "Edited",
      });
      expect(s.debug().updates.count).toBeGreaterThan(0);
      expect(s.debug().updates.snapshotAt).toBe(0);
    });
  });

  describe("joining", () => {
    it("hands a newcomer the state it is missing", () => {
      const s = store();
      applyOpToDoc(s.document(), {
        op: "label.set", id: "lbl_new", layerId: "lay_a", address: 0x8008, name: "Added",
      });

      expect(s.snapshot().length).toBeGreaterThan(0);
      expect(Buffer.from(s.snapshot())).toEqual(Buffer.from(encodeDoc(s.document())));
    });
  });
});
