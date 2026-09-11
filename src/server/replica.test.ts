import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workspace, Caller, SessionReplica } from "./workspace.js";
import { ProjectStore, SqliteStorage } from "../store/index.js";
import { applyUpdate, emptyDoc, encodeDoc, projectFromDoc } from "../core/crdt/index.js";

/**
 * Two sessions over one store, each with its own copy, exercised without a
 * transport so that the copies' client ids can be chosen — which is what
 * decides who wins in the room when both touch one key.
 */
const PROJECT = JSON.stringify({
  name: "replica",
  layers: [{ id: "lay_a", type: "bytes", address: "$8000", bytes: "a9016000" }],
  types: [{ id: "typ_a", name: "Original", size: 4, fields: {} }],
});

function open() {
  const dir = mkdtempSync(join(tmpdir(), "re64-replica-"));
  const storage = new SqliteStorage(join(dir, "p.re64db"), "p");
  storage.initialize(PROJECT, Date.now(), "replica");
  const opened: { storage: SqliteStorage; store: ProjectStore; close(): void; session(name: string, clientID: number): { space: Workspace; caller: Caller; replica: SessionReplica } } = {
    storage,
    store: new ProjectStore(storage),
    close: () => {
      storage.close();
      rmSync(dir, { recursive: true, force: true });
    },
    session(name, clientID) {
      const doc = emptyDoc();
      applyUpdate(doc, encodeDoc(opened.store.document()), "seed");
      doc.clientID = clientID;
      const replica: SessionReplica = { doc, cursor: storage.opsCursor(), session: name, changed: 0 };
      doc.on("update", () => {
        replica.changed++;
      });
      const space = new Workspace({
        store: opened.store,
        storage,
        projectId: "p",
        projectPath: join(dir, "p.re64db"),
        replica,
      });
      return { space, caller: { userId: `usr_${name}`, label: name, sessionId: name }, replica };
    },
  };
  return opened;
}

const nameIn = (space: Workspace) => space.document().types![0].name;

describe("undo is session-local", () => {
  /**
   * **An inverse is what the writer saw, and "does it still hold" is asked of
   * the writer's view.** Both were answered from the room. With another
   * session's unmerged rename in the room, Alice's undo either restored *that*
   * value — importing what she had never merged — or refused her own edit as
   * "changed by someone else since", depending only on which client id the
   * room's last-writer-wins favoured. Either way it was not her undo.
   */
  for (const [aliceId, bobId] of [
    [200, 100],
    [100, 200],
  ] as const) {
    it(`restores what Alice saw, whichever of them the room favours (alice=${aliceId}, bob=${bobId})`, () => {
      const f = open();
      try {
        const alice = f.session("alice", aliceId);
        const bob = f.session("bob", bobId);

        bob.space.reviseType(bob.caller, "typ_a", { name: "BobUnmerged" });
        alice.space.reviseType(alice.caller, "typ_a", { name: "Alice" });
        expect(nameIn(alice.space)).toBe("Alice");

        const undone = alice.space.undo(alice.caller);
        expect(undone.undone).toBeTruthy();
        expect(undone.skipped).toEqual([]);

        // Her own view: back to what she started from, not to Bob's value.
        expect(nameIn(alice.space)).toBe("Original");
        // Bob's view: untouched.
        expect(nameIn(bob.space)).toBe("BobUnmerged");

        // And once both merge, everybody — including the room — agrees on one
        // answer, which is one of the two values somebody actually wrote.
        alice.space.merge();
        bob.space.merge();
        const room = projectFromDoc(f.store.document()).types![0].name;
        expect(nameIn(alice.space)).toBe(room);
        expect(nameIn(bob.space)).toBe(room);
        expect(["Original", "BobUnmerged"]).toContain(room);
      } finally {
        f.close();
      }
    });
  }
});

describe("a write that fails to commit leaves the session's copy as it was", () => {
  /**
   * **The copy was mutated before the transaction committed.** On a rollback
   * the room was rebuilt from what committed and the copy kept the items — so
   * the session went on serving the uncommitted value, and the *next* write's
   * items referenced structs the room would never hold, so it could not
   * integrate them either. One failed write broke every write after it.
   */
  it("serves the committed state, and the next write still lands everywhere", () => {
    const dir = mkdtempSync(join(tmpdir(), "re64-replica-fail-"));
    const storage = new SqliteStorage(join(dir, "p.re64db"), "p");
    storage.initialize(PROJECT, Date.now(), "replica");
    let fail = true;
    const failing = Object.create(storage) as SqliteStorage;
    failing.appendOps = (changes) => {
      if (fail) throw new Error("injected appendOps failure");
      return SqliteStorage.prototype.appendOps.call(storage, changes);
    };
    const store = new ProjectStore(failing);
    const doc = emptyDoc();
    applyUpdate(doc, encodeDoc(store.document()), "seed");
    const replica: SessionReplica = { doc, cursor: storage.opsCursor(), session: "alice", changed: 0 };
    doc.on("update", () => {
      replica.changed++;
    });
    const space = new Workspace({ store, storage: failing, projectId: "p", projectPath: join(dir, "p.re64db"), replica });
    const caller: Caller = { userId: "usr_alice", label: "alice", sessionId: "alice" };

    try {
      expect(() => space.reviseType(caller, "typ_a", { name: "Uncommitted" })).toThrow(/injected/);
      expect(nameIn(space)).toBe("Original");
      expect(projectFromDoc(store.document()).types![0].name).toBe("Original");

      fail = false;
      space.reviseType(caller, "typ_a", { name: "Next" });
      expect(nameIn(space)).toBe("Next");
      expect(projectFromDoc(store.document()).types![0].name).toBe("Next");
      expect(projectFromDoc(new ProjectStore(storage).document()).types![0].name).toBe("Next");
    } finally {
      storage.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
