import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { Op } from "../ops/types.js";
import { applyOp, invertOp } from "../ops/apply.js";
import { diffProjects } from "../ops/diff.js";
import { parseProject, formatProject } from "../project/index.js";
import { docFromProject, projectFromDoc } from "./doc.js";
import { applyOpToDoc, undoManagerFor } from "./ops.js";

/**
 * Every operation, through every path that has ever silently dropped one.
 *
 * This codebase has a specific failure shape, and it has occurred four times:
 * an operation that exists, type-checks, is accepted, reports success — and does
 * not arrive. `meta.set` had no emitter in `diffProjects`; `layer.add` was
 * filtered to symbols layers; `constants` was missing from the undo manager's
 * roots; `decoders` was missing from `withIds`. Each was found by an experiment
 * or by accident, months later, and each was invisible to a green suite because
 * every layer worked correctly in isolation.
 *
 * The table below is **exhaustive by construction**: it is keyed by `Op["op"]`,
 * so adding an operation to the vocabulary and not to this file is a compile
 * error. That is the property worth having — not the assertions themselves, which
 * are ordinary, but that a new root cannot quietly skip them.
 *
 * It lives beside the merge library rather than beside the operations, because
 * it imports both and `boundary.test.ts` holds `src/core/ops/**` free of yjs —
 * tests included. That is the second time in one session the allowlist has
 * redirected a file, and it was right both times.
 *
 * The strongest assertion is the first, and it is one property rather than a
 * list: **the text path and the document path must agree.** An operation applied
 * to a `.re64` and the same operation applied to a `Y.Doc` must produce the same
 * project. That single equality catches a missing `applyOpInTransaction` case, a
 * root `projectFromDoc` forgot to touch, and a `formatProject` block nobody
 * wrote — three of the four historical failures — because each makes one side
 * of it stand still.
 */

const BASE = `{
  "name": "harness",
  "layers": [
    {
      "id": "lay_a",
      "type": "prg",
      "path": "game.prg",
      "address": "$8000",
      "comments": [
        { "id": "cmt_1", "address": "$8000", "text": "the entry point" }
      ],
      "labelUses": [
        { "id": "lbl_u1", "address": "$8100", "label": "clm_3" }
      ],
      "constantUses": [
        { "id": "cst_u1", "address": "$8000", "constant": "cst_1" }
      ]
    },
    { "id": "lay_b", "type": "symbols", "name": "zp" }
  ],
  "claims": [
    {
      "id": "clm_framed",
      "at": "$0002",
      "layer": "lay_a",
      "name": "insideTheLayer",
      "author": "m",
      "source": "user"
    },
    { "id": "clm_1", "at": "$8000", "name": "Start", "root": "routine", "author": "marcus", "source": "user" },
    { "id": "clm_2", "at": "$8080", "extent": 32, "name": "copyright", "is": "text", "encoding": "petscii", "root": "data", "author": "marcus", "source": "user" },
    { "id": "clm_3", "at": "$8100", "name": "Loop", "author": "marcus", "source": "user" }
  ],
  "constants": [{ "id": "cst_1", "name": "WHITE", "value": "$01" }],
  "decoders": [{ "id": "dec_1", "name": "plain", "source": "return [...bytes];" }],
  "types": [
    {
      "id": "typ_1",
      "name": "Sprite",
      "size": 4,
      "fields": {
        "0": { "name": "x", "type": "u8" },
        "2": { "name": "frame", "type": "u16" }
      }
    }
  ],
  "files": [{ "name": "game.prg", "hash": "abc123", "size": 16 }],
  "targets": [{ "name": "loader", "layers": ["lay_a"] }],
  "primaryLabels": { "$8000": "clm_1" }
}
`;

/** One operation, and whether each path is expected to carry it. */
interface Case {
  readonly op: Op;
  /**
   * Skipped from the text/document agreement check, with the reason.
   *
   * Only for operations whose effect genuinely is not part of a `Project` —
   * never as a way past a failure.
   */
  readonly notInProject?: string;
}

/**
 * Keyed by `Op["op"]`, so the vocabulary and this table cannot drift.
 *
 * A missing key is a compile error naming the operation that lacks coverage.
 */
const CASES: { [K in Op["op"]]: Case } = {
  "claim.add": {
    op: {
      op: "claim.add",
      // Framed on a layer, so `at` is an offset into its bytes rather than an
      // address. Nothing in this table carried a frame until claims were
      // scoped, and a field written in the wrong position then went unnoticed
      // through every assertion here — which broke undo, since replaying an
      // operation forward stopped being a no-op.
      claim: {
        id: "clm_2",
        at: 4,
        extent: 0x40,
        frame: { space: "layer", layer: "lay_a" },
        name: "spriteBank",
        says: { is: "bitmap", view: "sprite" },
        by: { author: "gfx", source: "user" },
      },
    },
  },
  "claim.set": {
    // Names three fields at once, and one of them is a `null`: the inverse of
    // this must restore `extent` and clear `name`, which is the case that
    // cannot be written without `ClaimEdit` distinguishing absent from cleared.
    op: {
      op: "claim.set",
      id: "clm_1",
      fields: { name: null, extent: 0x20, says: { is: "data" } },
    },
  },
  "claim.remove": { op: { op: "claim.remove", id: "clm_1" } },
  "comment.set": {
    op: {
      op: "comment.set",
      id: "cmt_2",
      layerId: "lay_a",
      address: 0x8100,
      placement: "before",
      text: "loops here",
    },
  },
  "comment.delete": { op: { op: "comment.delete", id: "cmt_1", layerId: "lay_a" } },
  "meta.set": { op: { op: "meta.set", key: "description", value: "a harness project" } },
  "label.bind": {
    op: { op: "label.bind", id: "lbl_u2", layerId: "lay_a", address: 0x8000, labelId: "clm_1" },
  },
  "label.unbind": { op: { op: "label.unbind", id: "lbl_u1", layerId: "lay_a" } },
  "constant.set": { op: { op: "constant.set", id: "cst_2", name: "RED", value: 0x02 } },
  "constant.delete": { op: { op: "constant.delete", id: "cst_1" } },
  "constant.bind": {
    op: { op: "constant.bind", id: "cst_u2", layerId: "lay_a", address: 0x8100, constantId: "cst_1" },
  },
  "constant.unbind": { op: { op: "constant.unbind", id: "cst_u1", layerId: "lay_a" } },
  "decoder.set": { op: { op: "decoder.set", id: "dec_2", name: "swap", source: "return bytes;" } },
  "decoder.delete": { op: { op: "decoder.delete", id: "dec_1" } },
  "type.set": {
    op: {
      op: "type.set",
      id: "typ_2",
      name: "Zone",
      size: 200,
      // A hole between the fields, which is the point of declaring `size`
      // rather than deriving it: a reader who has proved two fields of a
      // 200-byte record should not have to invent padding for the rest.
      fields: { 0: { name: "kind", type: "u8" }, 160: { name: "label", type: "char(40,screen)" } },
    },
  },
  "type.delete": { op: { op: "type.delete", id: "typ_1" } },
  "layer.add": {
    op: { op: "layer.add", id: "lay_c", layerType: "symbols", name: "io" },
  },
  "layer.remove": { op: { op: "layer.remove", id: "lay_b" } },
  "primary.set": { op: { op: "primary.set", address: 0x8100, labelId: "lbl_2" } },
  "primary.clear": { op: { op: "primary.clear", address: 0x8000 } },
  "file.add": {
    op: { op: "file.add", name: "extra.prg", hash: "def456", size: 32 },
  },
  "file.remove": { op: { op: "file.remove", name: "game.prg" } },
  "target.set": { op: { op: "target.set", name: "runtime", layers: ["lay_a", "lay_b"] } },
  "target.remove": { op: { op: "target.remove", name: "loader" } },
};

const kinds = Object.keys(CASES) as Op["op"][];

/**
 * The same project, with every array in a defined order.
 *
 * The two paths legitimately disagree about *layout*. The line editor preserves
 * what the file had, because that is its whole purpose — a one-label rename must
 * be a one-line diff. The document projection has to pick an order and sorts.
 * This file already accepts that: "hand authored layout in a `.re64` no longer
 * survives a round trip. It is still diffable, because the projection has a
 * defined order."
 *
 * So comparing rendered text would fail on a difference that is by design, and
 * the assertion below is about *content*: an operation that did not arrive shows
 * up as a missing entry, never as a reordered one.
 */
function canonical(project: ReturnType<typeof parseProject>): string {
  const byKey = <T>(items: readonly T[], key: (item: T) => string) =>
    [...items].sort((a, b) => key(a).localeCompare(key(b)));

  const layers = byKey(project.layers, (l) => l.id ?? "").map((layer) => ({
    ...layer,
    ...(layer.labels ? { labels: byKey(layer.labels, (l) => l.id ?? "") } : {}),
    ...(layer.regions ? { regions: byKey(layer.regions, (r) => r.id ?? "") } : {}),
    ...(layer.comments ? { comments: byKey(layer.comments, (c) => c.id ?? "") } : {}),
    ...(layer.labelUses ? { labelUses: byKey(layer.labelUses, (u) => u.id ?? "") } : {}),
    ...(layer.constantUses
      ? { constantUses: byKey(layer.constantUses, (u) => u.id ?? "") }
      : {}),
  }));

  // Keys sorted recursively as well as arrays: the two paths assemble the same
  // object with the same fields in different insertion order, and `JSON.stringify`
  // preserves that. Only content is being compared.
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") {
      const source = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(source).sort()) {
        // An empty array and an absent key are the same project — `formatProject`
        // says so by dropping empty blocks as noise, and `parseProject` reads an
        // absent one as empty. The line editor leaves `"regions": []` behind when
        // it removes the last entry and the projection omits the key, which is
        // spelling rather than content.
        const child = stable(source[key]);
        if (Array.isArray(child) && child.length === 0) continue;
        out[key] = child;
      }
      return out;
    }
    return value;
  };

  return JSON.stringify(
    stable({
      ...project,
      layers,
      ...(project.constants ? { constants: byKey(project.constants, (c) => c.id ?? "") } : {}),
      ...(project.decoders ? { decoders: byKey(project.decoders, (d) => d.id ?? "") } : {}),
      ...(project.types ? { types: byKey(project.types, (t) => t.id ?? "") } : {}),
      ...(project.files ? { files: byKey(project.files, (f) => f.name) } : {}),
      ...(project.targets ? { targets: byKey(project.targets, (t) => t.name) } : {}),
    }),
    null,
    1
  );
}

describe("every operation reaches every path", () => {
  it("covers the whole vocabulary", () => {
    // The table is exhaustive by type; this only reports the count, so a
    // vocabulary that grows is visible in the output rather than only in a diff.
    expect(kinds.length).toBe(24);
  });

  for (const kind of kinds) {
    const { op, notInProject } = CASES[kind];

    describe(kind, () => {
      it("the text path and the document path agree", () => {
        if (notInProject) return;

        const throughText = parseProject(applyOp(BASE, op));

        const doc = docFromProject(parseProject(BASE));
        applyOpToDoc(doc, op);
        const throughDoc = projectFromDoc(doc);

        expect(canonical(throughDoc)).toBe(canonical(throughText));
      });

      it("survives a round trip through the file", () => {
        // Formatting is idempotent, which is the property a diff depends on.
        // Not `parseProject(formatProject(p))` deep-equals `p`: `formatProject`
        // drops an empty array as noise, so a `region.delete` that removes the
        // last region leaves `regions: []` on one side and no key on the other —
        // the same project, differently spelled.
        const once = formatProject(parseProject(applyOp(BASE, op)));
        expect(formatProject(parseProject(once))).toBe(once);
      });

      it("is emitted by the diff that describes it", () => {
        if (notInProject) return;

        const before = parseProject(BASE);
        const after = parseProject(applyOp(BASE, op));
        const emitted = diffProjects(before, after);

        // Not an exact match on the op: a diff may legitimately express the same
        // change differently. What must hold is that replaying it reproduces the
        // state — an op nothing emits leaves this empty and the state behind.
        expect(emitted.length).toBeGreaterThan(0);
        const replayed = emitted.reduce((text, o) => applyOp(text, o), BASE);
        expect(canonical(parseProject(replayed))).toBe(canonical(after));
      });

      it("inverts back to where it started", () => {
        // `ProjectStore.runOps` computes the inverse against the pre-state and
        // stores it, so an operation whose inverse is wrong makes undo lie.
        const inverse = invertOp(BASE, op);
        const there = applyOp(BASE, op);
        const back = applyOp(there, inverse);
        expect(canonical(parseProject(back))).toBe(canonical(parseProject(BASE)));
      });

      it("is taken back by undo", () => {
        if (notInProject) return;

        const doc = docFromProject(parseProject(BASE));
        const undo = undoManagerFor(doc, "harness");
        const before = canonical(projectFromDoc(doc));

        applyOpToDoc(doc, op, "harness");
        expect(canonical(projectFromDoc(doc))).not.toBe(before);

        undo.undo();
        expect(canonical(projectFromDoc(doc))).toBe(before);
      });
    });
  }
});
