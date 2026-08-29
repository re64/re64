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

    it("keeps updates in order, each with the revision it was built against", () => {
      store.appendUpdate(update(1), "aaaaaaaaaaaa");
      store.appendUpdate(update(9), "bbbbbbbbbbbb");

      const stored = store.readUpdates();
      expect(stored.map((s) => s.baseRev)).toEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
      expect([...stored[0].update]).toEqual([1, 2, 3]);
      expect([...stored[1].update]).toEqual([9, 10, 11]);
    });

    it("does not run updates together", () => {
      // Yjs updates are not concatenative; two appended blobs cannot be applied
      // as one. Each has to come back separately or a crash is unrecoverable.
      store.appendUpdate(new Uint8Array([1]), "r");
      store.appendUpdate(new Uint8Array([2]), "r");
      expect(store.readUpdates()).toHaveLength(2);
    });

    it("forgets them on request", () => {
      store.appendUpdate(update(1), "r");
      store.clearUpdates();
      expect(store.readUpdates()).toEqual([]);
      expect(store.hasUpdates()).toBe(false);
    });

    it("tolerates being cleared when there is nothing to clear", () => {
      expect(() => store.clearUpdates()).not.toThrow();
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

    store.appendUpdate(new Uint8Array([1, 2, 3]), "aaaaaaaaaaaa");
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
