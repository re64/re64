import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStorage, pathsFor } from "./file-storage.js";
import { SqliteStorage } from "./sqlite-storage.js";
import { ProjectStorage, revOf } from "./storage.js";

/**
 * The contract every backing store owes.
 *
 * Written against the interface rather than one implementation so a second
 * backend runs the identical suite: add it to `BACKENDS` and any divergence
 * shows up as a failure instead of as a subtle difference in behaviour.
 */

const PROJECT = `{ "layers": [ { "id": "lay_a", "type": "symbols",
  "labels": [ { "id": "lbl_1", "address": "$02", "name": "Start" } ] } ] }
`;

interface Backend {
  name: string;
  open(dir: string): ProjectStorage;
}

const BACKENDS: Backend[] = [
  {
    name: "FileStorage",
    open: (dir) => {
      const path = join(dir, "test.re64");
      writeFileSync(path, PROJECT, "utf-8");
      return new FileStorage(pathsFor(path));
    },
  },
  {
    name: "SqliteStorage",
    open: (dir) => {
      const store = new SqliteStorage(join(dir, "test.re64db"));
      store.initialize(PROJECT, 0);
      return store;
    },
  },
];

describe.each(BACKENDS)("$name", ({ open }) => {
  let dir: string;
  let store: ProjectStorage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "re64-storage-"));
    store = open(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  describe("the project text", () => {
    it("reads back exactly what was written, byte for byte", () => {
      const odd = '{ "layers": [] }\n\n\n   trailing space   \n';
      store.writeText(odd);
      expect(store.readText()).toBe(odd);
    });

    it("reports that it exists", () => {
      expect(store.exists()).toBe(true);
    });
  });

  describe("revisions", () => {
    it("names the content, so identical text gets an identical name", () => {
      const before = store.rev();
      store.writeText(store.readText());
      expect(store.rev()).toBe(before);
    });

    it("changes when the content does", () => {
      const before = store.rev();
      store.writeText(PROJECT.replace("Start", "Renamed"));
      expect(store.rev()).not.toBe(before);
    });

    it("agrees with the free function, so a caller can compute one ahead", () => {
      expect(store.rev()).toBe(revOf(store.readText()));
    });
  });

  describe("the update log", () => {
    const update = (n: number) => new Uint8Array([n, n + 1, n + 2]);

    it("is empty to begin with", () => {
      expect(store.readUpdates()).toEqual([]);
      expect(store.hasUpdates()).toBe(false);
    });

    it("gives back what was put in, whole", () => {
      store.appendUpdate(update(1));
      store.appendUpdate(update(9));

      const stored = store.readUpdates();
      expect(stored).toHaveLength(2);
      expect([...stored[0].update]).toEqual([1, 2, 3]);
      expect([...stored[1].update]).toEqual([9, 10, 11]);
    });

    it("does not run updates together", () => {
      // Yjs updates are not concatenative; two appended blobs cannot be applied
      // as one. Each has to come back separately or a replay is impossible.
      store.appendUpdate(new Uint8Array([1]));
      store.appendUpdate(new Uint8Array([2]));
      expect(store.readUpdates()).toHaveLength(2);
    });

    it("can be read from a cursor, so a snapshot need not be replayed twice", () => {
      store.appendUpdate(update(1));
      store.appendUpdate(update(4));
      store.appendUpdate(update(7));

      const all = store.readUpdates();
      const tail = store.readUpdates(all[0].seq);
      expect(tail).toHaveLength(2);
      expect([...tail[0].update]).toEqual([4, 5, 6]);
    });

    it("hands out increasing cursors", () => {
      store.appendUpdate(update(1));
      store.appendUpdate(update(2));
      const [first, second] = store.readUpdates();
      expect(second.seq).toBeGreaterThan(first.seq);
    });
  });

  describe("snapshots", () => {
    it("are optional", () => {
      // A store may decline them. They are a shortcut for loading, never a
      // requirement, because replaying the whole log reaches the same state.
      expect(() => store.readSnapshot()).not.toThrow();
      expect(() =>
        store.writeSnapshot({ seqUpto: 1, update: new Uint8Array([1]) })
      ).not.toThrow();
    });
  });

  describe("history", () => {
    it("returns nothing before a session has ended", () => {
      expect(store.history()).toEqual([]);
    });

    it("accumulates entries oldest first", () => {
      store.appendHistory({ at: 1, authors: ["alice"], summary: ["one"] });
      store.appendHistory({ at: 2, authors: ["bob"], summary: ["two"] });

      expect(store.history().map((e) => e.at)).toEqual([1, 2]);
      expect(store.history()[1].authors).toEqual(["bob"]);
    });
  });

  describe("watching", () => {
    it("stops reporting once unwatched", () => {
      const stop = store.watch(() => {
        throw new Error("should not fire after stopping");
      });
      stop();
      store.writeText(PROJECT.replace("Start", "Changed"));
    });
  });
});

describe("SqliteStorage snapshots", () => {
  let dir: string;
  let store: SqliteStorage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "re64-storage-"));
    store = new SqliteStorage(join(dir, "t.re64db"));
    store.initialize(PROJECT, 0);
  });
  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("has none until one is taken", () => {
    expect(store.readSnapshot()).toBeUndefined();
  });

  it("keeps the updates it covers, because it is not compaction", () => {
    store.appendUpdate(new Uint8Array([1]));
    store.appendUpdate(new Uint8Array([2]));
    const upto = store.readUpdates().at(-1)!.seq;

    store.writeSnapshot({ seqUpto: upto, update: new Uint8Array([9, 9]) });

    expect(store.readSnapshot()?.seqUpto).toBe(upto);
    expect(store.readUpdates()).toHaveLength(2);
  });

  it("reports the newest when there are several", () => {
    store.writeSnapshot({ seqUpto: 1, update: new Uint8Array([1]) });
    store.writeSnapshot({ seqUpto: 5, update: new Uint8Array([5]) });
    expect(store.readSnapshot()?.seqUpto).toBe(5);
  });

  it("reads the tail after a snapshot without replaying what it covers", () => {
    store.appendUpdate(new Uint8Array([1]));
    const covered = store.readUpdates().at(-1)!.seq;
    store.writeSnapshot({ seqUpto: covered, update: new Uint8Array([9]) });
    store.appendUpdate(new Uint8Array([2]));

    const tail = store.readUpdates(covered);
    expect(tail).toHaveLength(1);
    expect([...tail[0].update]).toEqual([2]);
  });
});

describe("FileStorage crash tolerance", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "re64-storage-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps the updates it can read when the last one was cut short", () => {
    const path = join(dir, "test.re64");
    writeFileSync(path, PROJECT, "utf-8");
    const store = new FileStorage(pathsFor(path));

    store.appendUpdate(new Uint8Array([1, 2, 3]));
    // A process killed mid-append leaves a header promising more than follows.
    appendFileSync(pathsFor(path).log, Buffer.from([0, 0, 0, 8, 99]));

    expect(store.readUpdates()).toHaveLength(1);
  });

  it("reports a project that has been deleted underneath it", () => {
    const path = join(dir, "gone.re64");
    writeFileSync(path, PROJECT, "utf-8");
    const store = new FileStorage(pathsFor(path));
    rmSync(path);
    expect(store.exists()).toBe(false);
  });
});
