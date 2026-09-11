import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { LayerAddOp, Op } from "../ops/types.js";
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
      "file": "fil_game",
      "member": "GAME",
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
      "origin": "user"
    },
    { "id": "clm_1", "at": "$8000", "name": "Start", "root": "routine", "origin": "user" },
    { "id": "clm_2", "at": "$8080", "extent": 32, "name": "copyright", "is": "text", "encoding": "petscii", "root": "data", "origin": "user" },
    { "id": "clm_3", "at": "$8100", "name": "Loop", "origin": "user" }
  ],
  "constants": [{ "id": "cst_1", "name": "WHITE", "value": "$01" }],
  "decoders": [{ "id": "dec_1", "name": "plain", "source": "return [...bytes];" }],
  "types": [
    {
      "id": "typ_1",
      "name": "Sprite",
      "size": 4,
      "fields": {
        "0": { "id": "fld_x", "name": "x", "type": "u8" },
        "2": { "id": "fld_f", "name": "frame", "type": "u16" }
      }
    }
  ],
  "files": [{ "id": "fil_game", "name": "game.prg", "hash": "abc123", "size": 16 }],
  "targets": [{ "id": "tgt_1", "name": "loader", "layers": [{ "id": "lnk_1", "layer": "lay_a" }] }],
  "scenarios": [
    {
      "id": "scn_1",
      "name": "boot",
      "steps": [{ "id": "stp_1", "kind": "start", "at": "$8000", "vector": true }]
    }
  ],
  "captures": [
    { "id": "cap_1", "scenario": "scn_1", "step": "stp_1", "kind": "screen", "file": "title.prg" }
  ],
  "evidence": [
    { "id": "evd_1", "claim": "clm_1", "kind": "supports", "note": "watched it" }
  ],
  "messages": [
    { "id": "msg_1", "at": 1720000000000, "author": "usr_a", "name": "amber", "text": "starting on the loader" }
  ],
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
  /**
   * Skipped from the undo check, with the reason.
   *
   * One user so far, and it is a decision rather than a gap: **Ctrl-Z must not
   * eat what somebody said.** Chat is outside the undo manager's tracked roots,
   * which is a statement about what undo replays and not about what the algebra
   * covers — the operations exist, invert, diff and round-trip like everything
   * else, and taking a message back is `remove_message`, an explicit act.
   */
  readonly notUndoable?: string;
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
        origin: "user",
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
  "comment.add": {
    op: {
      op: "comment.add",
      id: "cmt_2",
      layerId: "lay_a",
      address: 0x8100,
      placement: "before",
      text: "loops here",
    },
  },
  // Names one field and clears another, which is what a partial `set` is for:
  // the inverse must restore the text and put `order` back to absent, and it
  // must leave the address alone because this op never mentioned it.
  "comment.set": {
    op: {
      op: "comment.set",
      id: "cmt_1",
      layerId: "lay_a",
      fields: { text: "reworded", order: null },
    },
  },
  "comment.remove": { op: { op: "comment.remove", id: "cmt_1", layerId: "lay_a" } },
  "meta.set": { op: { op: "meta.set", key: "description", value: "a harness project" } },
  "labelUse.bind": {
    op: { op: "labelUse.bind", id: "lbl_u2", layerId: "lay_a", address: 0x8000, labelId: "clm_1" },
  },
  "labelUse.unbind": {
    op: { op: "labelUse.unbind", id: "lbl_u1", layerId: "lay_a", address: 0x8100 },
  },
  "constant.add": { op: { op: "constant.add", id: "cst_2", name: "RED", value: 0x02 } },
  "constant.set": { op: { op: "constant.set", id: "cst_1", fields: { name: "RENAMED" } } },
  "constant.remove": { op: { op: "constant.remove", id: "cst_1" } },
  "constantUse.bind": {
    op: { op: "constantUse.bind", id: "cst_u2", layerId: "lay_a", address: 0x8100, constantId: "cst_1" },
  },
  "constantUse.unbind": {
    op: { op: "constantUse.unbind", id: "cst_u1", layerId: "lay_a", address: 0x8000 },
  },
  "decoder.add": { op: { op: "decoder.add", id: "dec_2", name: "swap", source: "return bytes;" } },
  "decoder.set": { op: { op: "decoder.set", id: "dec_1", fields: { name: "renamed" } } },
  "decoder.remove": { op: { op: "decoder.remove", id: "dec_1" } },
  "type.add": {
    op: {
      op: "type.add",
      id: "typ_2",
      name: "Zone",
      size: 200,
      // A hole between the fields, which is the point of declaring `size`
      // rather than deriving it: a reader who has proved two fields of a
      // 200-byte record should not have to invent padding for the rest.
      fields: [
        { id: "fld_a", offset: 0, name: "kind", type: "u8" },
        // An array field, so the notation goes through all seven paths: it is
        // one string like every other field type, and that is exactly why it
        // needed no schema change anywhere below this line.
        { id: "fld_c", offset: 8, name: "slots", type: "u8[8]" },
        { id: "fld_b", offset: 160, name: "label", type: "char(40,screen)" },
      ],
    },
  },
  // The record, and not its parts: revising a type leaves every field it holds
  // where it is. Changing one is `field.set`, by the field's own id.
  "type.set": {
    op: { op: "type.set", id: "typ_1", fields: { name: "Renamed", size: 32 } },
  },
  "type.remove": { op: { op: "type.remove", id: "typ_1" } },

  // **A field, by its own id.** It has carried one since offsets stopped being
  // its identity, and had no verbs of its own until experiment 11 found the
  // consequence: nothing could remove a field, by anybody, ever.
  "field.add": {
    op: {
      op: "field.add",
      id: "fld_new",
      typeId: "typ_1",
      offset: 4,
      name: "speed",
      type: "u8",
      description: "pixels per frame",
    },
  },
  // A rename *and* a move together, because moving one is the change that
  // offset-as-identity could not express without losing everything else on it.
  "field.set": {
    op: {
      op: "field.set",
      id: "fld_f",
      typeId: "typ_1",
      fields: { name: "renamedField", offset: 3 },
    },
  },
  "field.remove": { op: { op: "field.remove", id: "fld_f", typeId: "typ_1" } },
  // The widest variant, because it is the one that carries fields: `bytes` and
  // `length` reach the document, the file and back only if every path knows
  // about them. The narrow variants are covered below, one per layer kind.
  "layer.add": {
    op: {
      op: "layer.add",
      id: "lay_c",
      layerType: "bytes",
      name: "patch",
      address: 0x9000,
      bytes: "A9018D20D0",
    },
  },
  "layer.set": { op: { op: "layer.set", id: "lay_b", fields: { name: "renamed" } } },
  "layer.remove": { op: { op: "layer.remove", id: "lay_b" } },
  "primary.bind": { op: { op: "primary.bind", address: 0x8100, labelId: "lbl_2" } },
  "primary.unbind": { op: { op: "primary.unbind", address: 0x8000 } },
  "file.add": {
    op: { op: "file.add", id: "fil_extra", name: "extra.prg", hash: "def456", size: 32 },
  },
  "file.set": { op: { op: "file.set", id: "fil_game", fields: { name: "renamed.prg" } } },
  "file.remove": { op: { op: "file.remove", id: "fil_game" } },
  "target.add": {
    op: {
      op: "target.add",
      id: "tgt_2",
      name: "runtime",
      layers: [{ id: "lnk_x", layer: "lay_a" }, { id: "lnk_y", layer: "lay_b" }],
    },
  },
  "target.set": {
    op: { op: "target.set", id: "tgt_1", fields: { description: "the loader" } },
  },
  "target.remove": { op: { op: "target.remove", id: "tgt_1" } },
  "scenario.add": {
    op: {
      op: "scenario.add",
      id: "scn_2",
      name: "play",
      steps: [
        { id: "stp_a", kind: "start", at: 0x8000, vector: true },
        { id: "stp_b", kind: "run", frames: 220 },
        { id: "stp_c", kind: "input", port: 1, fire: true },
        { id: "stp_d", kind: "capture", what: "screen", name: "playing.prg" },
      ],
    },
  },
  // A rename and a rewritten step list at once. Steps go whole rather than
  // merging by key, which is what `ProjectScenario` argues for and what this
  // asserts stays true.
  "scenario.set": {
    op: {
      op: "scenario.set",
      id: "scn_1",
      fields: { name: "renamed", steps: [{ id: "stp_1", kind: "run", frames: 5 }] },
    },
  },
  "scenario.remove": { op: { op: "scenario.remove", id: "scn_1" } },
  "capture.add": {
    op: {
      op: "capture.add",
      id: "cap_2",
      scenario: "scn_1",
      step: "stp_1",
      kind: "frames",
      file: "fil_playing",
    },
  },
  "capture.set": { op: { op: "capture.set", id: "cap_1", fields: { file: "fil_renamed" } } },
  "capture.remove": { op: { op: "capture.remove", id: "cap_1" } },
  // A refutation that shares no bytes with what it refutes — the shape
  // `disagreements()` sweeps for and can never find, because `$8DF9` holding
  // `$3B` is about the *glyph* `$3B`, somewhere else entirely.
  // Carrying `by`, because that is where a claim's provenance lives now and
  // this is the path it has to survive. The nested shape is spread into flat
  // keys on the way into the document, exactly as `says` is on a claim, so a
  // revision touches only the halves it names.
  "evidence.add": {
    op: {
      op: "evidence.add",
      id: "evd_2",
      claim: "clm_2",
      kind: "refutes",
      by: { author: "beryl", method: "ran", when: 1720000000000 },
      other: "clm_1",
      note: "$8DF9 holds $3B, so it is drawn",
    },
  },
  "evidence.set": {
    op: {
      op: "evidence.set",
      id: "evd_1",
      fields: { note: "reworded", capture: "cap_1", by: { author: "amber", method: "read" } },
    },
  },
  "evidence.remove": { op: { op: "evidence.remove", id: "evd_1" } },

  // **Chat, which used to be outside this vocabulary on purpose.** The ground
  // was that `src/core/ops` holds things with computable inverses and "unsay
  // that" is not one — but `message.add` inverts to `message.remove`, and the
  // real objection was that undo must not eat what somebody said, which is a
  // question about what undo replays rather than about what the algebra covers.
  //
  // Appended, not keyed: ordering is the content of a conversation, so this is
  // the one entity whose storage is a list. The id still makes it addressable,
  // which is a separate property.
  "message.add": {
    op: {
      op: "message.add",
      id: "msg_2",
      at: 1720000001000,
      author: "usr_b",
      name: "beryl",
      text: "the zone table is 42 records of 200",
    },
    notUndoable: "undo must not eat what somebody said",
  },
  "message.set": {
    op: { op: "message.set", id: "msg_1", fields: { text: "reworded" } },
    notUndoable: "undo must not eat what somebody said",
  },
  "message.remove": {
    op: { op: "message.remove", id: "msg_1" },
    notUndoable: "undo must not eat what somebody said",
  },
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
      ...(project.files ? { files: byKey(project.files, (f) => f.id!) } : {}),
      ...(project.targets ? { targets: byKey(project.targets, (t) => t.name) } : {}),
      // The rest of the roots, normalised for the same reason. They were left
      // out because they *happened* to agree: both paths kept insertion order,
      // one deliberately and one because the projection's comparator returned
      // `NaN` for a non-numeric sort key and never sorted anything. Fixing the
      // comparator made the document sort captures by filename while the line
      // editor kept them where they were — a layout difference by design, which
      // is exactly what this function exists to absorb.
      ...(project.claims ? { claims: byKey(project.claims, (c) => c.id ?? "") } : {}),
      ...(project.scenarios ? { scenarios: byKey(project.scenarios, (x) => x.id ?? "") } : {}),
      ...(project.captures ? { captures: byKey(project.captures, (c) => c.id ?? "") } : {}),
      ...(project.evidence ? { evidence: byKey(project.evidence, (e) => e.id ?? "") } : {}),
    }),
    null,
    1
  );
}

describe("every operation reaches every path", () => {
  it("covers the whole vocabulary", () => {
    // The table is exhaustive by type; this only reports the count, so a
    // vocabulary that grows is visible in the output rather than only in a diff.
    expect(kinds.length).toBe(46);
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
        if (notInProject || CASES[kind].notUndoable) return;

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

/**
 * Every layer kind, through the diff.
 *
 * The table above proves one variant of `layer.add`; this proves the *set*. The
 * filter in `diffProjects` was a hand-written list of layer kinds, and it went
 * stale twice — first excluding every byte layer, then, once that was fixed for
 * `prg` and `raw`, still excluding `rom`, which is the one kind the machine view
 * cannot do without. A ROM layer reached the document, was reported by
 * `describe_project`, and vanished on export.
 */
/**
 * A record whose offsets count bits, through every path.
 *
 * `unit` was dropped in **four** places on the way out — the text serializer's
 * hand-written key list, the loader's hand-written field list, the CRDT's
 * `type.add`, and `list_types` — while the operation, the diff and the document
 * schema all carried it. Nothing failed; a bit record simply became a byte
 * record on the next load, and every offset in it silently meant something
 * else. F1 again, and the reason this case exists rather than a note.
 */
describe("a bit record survives the round trip", () => {
  const op: Op = {
    op: "type.add",
    id: "typ_bits",
    name: "VicControl1",
    size: 1,
    unit: "bits",
    fields: [
      { id: "fld_scroll", offset: 0, name: "yScroll", type: "bits(3)" },
      { id: "fld_raster", offset: 7, name: "rasterBit8", type: "bits(1)" },
    ],
  };

  it("keeps its unit through the text and the document alike", () => {
    const throughText = parseProject(applyOp(BASE, op));
    expect(throughText.types?.find((t) => t.id === "typ_bits")?.unit).toBe("bits");

    const doc = docFromProject(parseProject(BASE));
    applyOpToDoc(doc, op);
    expect(projectFromDoc(doc).types?.find((t) => t.id === "typ_bits")?.unit).toBe("bits");
  });

  it("is emitted by the diff, so it reaches the file it was made in", () => {
    const before = parseProject(BASE);
    const after = parseProject(applyOp(BASE, op));
    const emitted = diffProjects(before, after);
    expect(emitted).toContainEqual(expect.objectContaining({ op: "type.add", unit: "bits" }));
  });
});

describe("a layer of every kind reaches the file", () => {
  const LAYERS: Record<LayerAddOp["layerType"], Omit<LayerAddOp, "op" | "id">> = {
    symbols: { layerType: "symbols", name: "io" },
    prg: { layerType: "prg", name: "game", path: "game.prg" },
    raw: { layerType: "raw", name: "chars", path: "game.prg", address: 0x3000 },
    rom: { layerType: "rom", rom: "kernal", name: "kernal rom" },
    bytes: { layerType: "bytes", name: "patch", address: 0x9000, bytes: "EAEA" },
  };

  for (const [kind, fields] of Object.entries(LAYERS)) {
    it(`emits a \`layer.add\` for a ${kind} layer`, () => {
      const op: Op = { op: "layer.add", id: "lay_new", ...fields };
      const before = parseProject(BASE);
      const after = parseProject(applyOp(BASE, op));

      const emitted = diffProjects(before, after);
      expect(emitted.filter((o) => o.op === "layer.add")).toHaveLength(1);

      const replayed = emitted.reduce((text, o) => applyOp(text, o), BASE);
      expect(canonical(parseProject(replayed))).toBe(canonical(after));
    });
  }
});

/**
 * The algebra itself, asserted rather than described.
 *
 * `docs/06-algebra.md` says every low-level type is one of two shapes and each
 * shape has exactly one set of verbs. That held by care until this existed, and
 * care is what let three different update semantics live in one vocabulary
 * without anybody noticing: a full PUT for four types, a partial write for
 * claims, a partial-by-name for targets, and nothing at all for layers.
 *
 * `kinds` comes from `CASES`, which is keyed by `Op["op"]` and therefore
 * exhaustive by construction — so a new operation cannot reach the vocabulary
 * without passing through here.
 */
describe("the operation algebra", () => {
  /** Has an id, lives in a collection: add mints, set revises, remove takes back. */
  const ENTITIES = [
    "file",
    "claim",
    "comment",
    "constant",
    "decoder",
    "type",
    // Nested inside a record, and an entity all the same: it has an id, and an
    // offset is a property of it rather than its name. It had no verbs of its
    // own until experiment 11 found what that cost — nothing could remove a
    // field, by anybody, ever, and the tool description claimed otherwise.
    "field",
    "layer",
    "target",
    "scenario",
    "capture",
    "evidence",
    // A conversation is not an edit, and a message is still an entity: it has
    // an id and three verbs like the rest. What stays true is that undo does not
    // reach it — a different question, answered where undo is.
    "message",
  ] as const;

  /** A key-to-id map. Binding a key again is how a binding is updated. */
  const BINDINGS = ["labelUse", "constantUse", "primary"] as const;


  const verbsOf = (noun: string) =>
    kinds.filter((k) => k.startsWith(`${noun}.`)).map((k) => k.split(".")[1]).sort();

  it("spells every operation as noun.verb", () => {
    for (const kind of kinds) expect(kind).toMatch(/^[a-z][a-zA-Z]*\.[a-z]+$/);
  });

  it("gives every entity exactly add, set and remove", () => {
    for (const noun of ENTITIES) {
      expect({ noun, verbs: verbsOf(noun) }).toEqual({
        noun,
        verbs: ["add", "remove", "set"],
      });
    }
  });

  it("gives every binding exactly bind and unbind", () => {
    for (const noun of BINDINGS) {
      expect({ noun, verbs: verbsOf(noun) }).toEqual({ noun, verbs: ["bind", "unbind"] });
    }
  });

  it("keeps a declaration and a use under different nouns", () => {
    // They were both `constant.*`, so `constant.set` and `constant.bind` were
    // about different objects under one name — and `label.bind` named an entity
    // that no longer exists at all, since a label is a claim.
    expect(verbsOf("constant")).toEqual(["add", "remove", "set"]);
    expect(verbsOf("constantUse")).toEqual(["bind", "unbind"]);
    expect(verbsOf("label")).toEqual([]);
    expect(verbsOf("labelUse")).toEqual(["bind", "unbind"]);
  });

  it("uses one word for taking something back, not two", () => {
    // `claim.remove` and `comment.delete` were the same verb spelled two ways,
    // split down no principle at all.
    expect(kinds.filter((k) => k.endsWith(".delete"))).toEqual([]);
    expect(kinds.filter((k) => k.endsWith(".clear"))).toEqual([]);
  });

  it("accounts for every operation, so nothing sits outside the shapes", () => {
    const claimed = new Set<string>();
    for (const noun of [...ENTITIES, ...BINDINGS]) {
      for (const kind of kinds) if (kind.startsWith(`${noun}.`)) claimed.add(kind);
    }
    // `meta.set` is the project's own scalars — a closed key set rather than a
    // collection, and the one deliberate singleton.
    const unaccounted = kinds.filter((k) => !claimed.has(k) && k !== "meta.set");
    expect(unaccounted).toEqual([]);
  });

  it("carries the fields of a partial write under `fields`, never inline", () => {
    // The shape that distinguishes a revision from a whole-value PUT: a `set`
    // names what changed, so an omitted field is left alone and a merge does
    // not revert what the writer never read.
    for (const kind of kinds.filter((k) => k.endsWith(".set") && k !== "meta.set")) {
      const { op } = CASES[kind];
      expect({ kind, hasFields: "fields" in op }).toEqual({ kind, hasFields: true });
    }
  });

  it("mints an identity on every add", () => {
    for (const kind of kinds.filter((k) => k.endsWith(".add"))) {
      const op = CASES[kind].op as unknown as Record<string, unknown>;
      // Where the identity sits. `file` is keyed by the name layers reference
      // it as — it is content-addressed and has nothing else to be. `claim.add`
      // nests its id inside the payload because the payload *is* the domain
      // `Claim`, which every reader already knows the shape of; that is a
      // spelling, not a second rule, and it is asserted here rather than left
      // to be discovered.
      const identity =
        kind === "claim.add"
            ? (op.claim as { id?: string }).id
            : op.id;
      expect({ kind, keyed: typeof identity === "string" }).toEqual({ kind, keyed: true });
    }
  });
});

describe("provenance means the same thing on both paths", () => {
  /**
   * **`by` is one value, not a patch of three, and the adapters disagreed.**
   *
   * `Provenance` cannot exist without an author, so naming it at all means
   * replacing it: an absent `method` is a method cleared, and `by: null` is the
   * whole account withdrawn. The text adapter read it that way. The CRDT adapter
   * mapped `by: null` to `undefined` for each key — and `revise` *skips*
   * undefined, since that is how it tells "leave alone" from "clear". So the
   * same operation cleared three fields on one path and none on the other.
   *
   * The round-trip table above proves one payload per operation, which
   * establishes that an operation *arrives*. It cannot establish that every
   * patch variant means the same thing on both sides, and this is the variant
   * that did not.
   */
  const withEvidence = (): string =>
    applyOp(
      BASE,
      {
        op: "evidence.set",
        id: "evd_1",
        fields: { by: { author: "amber", method: "guessed", when: 1720000000000 } },
      } as Op
    );

  const bothPaths = (from: string, op: Op) => {
    const throughText = parseProject(applyOp(from, op));
    const doc = docFromProject(parseProject(from));
    applyOpToDoc(doc, op, "harness");
    return { text: throughText.evidence![0], crdt: projectFromDoc(doc).evidence![0] };
  };

  it("clears author, method and when on both paths when `by` is null", () => {
    const { text, crdt } = bothPaths(withEvidence(), {
      op: "evidence.set",
      id: "evd_1",
      fields: { by: null },
    } as Op);

    for (const [where, held] of [["text", text], ["crdt", crdt]] as const) {
      expect(held.author, where).toBeUndefined();
      expect(held.method, where).toBeUndefined();
      expect(held.when, where).toBeUndefined();
      // And the record itself survives: withdrawing an account is not
      // withdrawing the evidence.
      expect(held.kind, where).toBe("supports");
    }
  });

  it("replaces rather than merges, so an omitted method is a cleared one", () => {
    const { text, crdt } = bothPaths(withEvidence(), {
      op: "evidence.set",
      id: "evd_1",
      fields: { by: { author: "beryl" } },
    } as Op);

    for (const [where, held] of [["text", text], ["crdt", crdt]] as const) {
      expect(held.author, where).toBe("beryl");
      expect(held.method, where).toBeUndefined();
    }
  });

  it("leaves provenance alone when the patch does not name it", () => {
    const { text, crdt } = bothPaths(withEvidence(), {
      op: "evidence.set",
      id: "evd_1",
      fields: { note: "reworded" },
    } as Op);

    for (const [where, held] of [["text", text], ["crdt", crdt]] as const) {
      expect(held.note, where).toBe("reworded");
      expect(held.author, where).toBe("amber");
      expect(held.method, where).toBe("guessed");
    }
  });
});
