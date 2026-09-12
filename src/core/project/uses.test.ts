import { describe, it, expect } from "vitest";
import { buildMemoryMap } from "./loader.js";
import { makeFileLoader } from "./file-source.js";
import { Project, parseProject, resolvedUses, useKey, usesToRoot } from "./project.js";
import { formatProject } from "./serialize.js";
import { applyOpToDoc, docFromProject, migrateDoc, projectFromDoc } from "../crdt/index.js";
import { applyOp, invertOp } from "../ops/apply.js";

/**
 * **A binding carries a frame, like a claim.** It names an instruction's
 * operand, and an instruction moves with its bytes — so a use on owned bytes is
 * an offset into its layer and travels when the layer is placed elsewhere. A
 * use that is a fact about one arrangement is framed on that target and appears
 * nowhere else: the escape hatch for when relocation is wrong. One on an unowned
 * byte is a fact about the address space and is where it says, everywhere.
 */
describe("a binding's frame decides where it is, and in which view", () => {
  const project: Project = {
    name: "frames",
    // `A9 01` at +0, `A9 01` at +2, `A9 01` at +4: three sites loading one.
    layers: [{ id: "lay_a", type: "bytes", address: "$8000", bytes: "a901a901a90160" }],
    constants: [{ id: "cst_one", name: "ONE", value: "$01" }],
    constantUses: [
      { id: "cst_u_layer", at: "$0001", layer: "lay_a", constant: "cst_one" },
      { id: "cst_u_addr", at: "$8003", constant: "cst_one" },
      { id: "cst_u_tgt", at: "$8005", target: "tgt_moved", constant: "cst_one" },
    ],
    targets: [
      { id: "tgt_home", name: "home", layers: ["lay_a"] },
      { id: "tgt_moved", name: "moved", layers: [{ id: "lnk_1", layer: "lay_a", at: 0x9000 }] },
    ],
  };
  const load = (target: string) => buildMemoryMap(project, makeFileLoader(() => new Uint8Array()), { target });

  it("moves a layer-framed use with its layer, and leaves the others where they say", () => {
    const home = load("home");
    expect(home.constants.nameAt(0x8001)).toBe("ONE"); // layer-framed, at +1
    expect(home.constants.nameAt(0x8003)).toBe("ONE"); // address-framed
    expect(home.constants.nameAt(0x8005)).toBeUndefined(); // target-framed on the other view

    const moved = load("moved");
    expect(moved.constants.nameAt(0x9001)).toBe("ONE"); // travelled with the bytes
    expect(moved.constants.nameAt(0x8001)).toBeUndefined();
    expect(moved.constants.nameAt(0x8003)).toBe("ONE"); // stayed: a fact about the machine
    expect(moved.constants.nameAt(0x8005)).toBe("ONE"); // only here: a fact about this arrangement
  });
});

describe("bindings written before they had a frame", () => {
  /**
   * They were nested in the layer that supplied the bytes, with absolute
   * addresses — and the layer was the **owner**: it decided whether the
   * binding showed, and kept it apart from another layer's at the same
   * address. Lifting them to the address space would keep the site and lose
   * the owner, so a nested use becomes a **layer-framed** one at
   * `address - placement`, which says both — and only where the placement is
   * known. See `usesToRoot`.
   */
  const ONE = "a901a90160"; // LDA #$01 at +0 and +2
  const TWO = "a902a90260";
  const legacy: Project = {
    name: "legacy",
    layers: [
      // Two owners of one address: a base and a patch over it.
      {
        id: "lay_a",
        type: "bytes",
        address: "$8000",
        bytes: ONE,
        constantUses: [{ id: "cst_ua", address: "$8002", constant: "cst_one" }],
        labelUses: [{ id: "lbl_ua", address: 0x8000, label: "clm_1" }],
      },
      {
        id: "lay_b",
        type: "bytes",
        address: "$8000",
        bytes: TWO,
        constantUses: [{ id: "cst_ub", address: "$8002", constant: "cst_two" }],
      },
      // A symbols layer owns no bytes: its uses are facts about the address space.
      { id: "lay_s", type: "symbols", constantUses: [{ id: "cst_us", address: "$00FB", constant: "cst_one" }] },
    ],
    constants: [
      { id: "cst_one", name: "ONE", value: "$01" },
      { id: "cst_two", name: "TWO", value: "$02" },
    ],
    targets: [
      { id: "tgt_a", name: "base", layers: ["lay_a", "lay_s"] },
      { id: "tgt_b", name: "patched", layers: ["lay_b", "lay_s"] },
    ],
  };
  const placed = (id: string) => (id === "lay_a" || id === "lay_b" ? 0x8000 : undefined);
  const sites = (p: Project) => (p.constantUses ?? []).map((u) => `${u.id}:${useKey(u)}`).sort();

  it("frames a nested use on its owner at the offset its placement gives, and keeps two owners apart", () => {
    const converted = usesToRoot(legacy, placed);
    expect(sites(converted)).toEqual([
      "cst_ua:layer:lay_a:$0002",
      "cst_ub:layer:lay_b:$0002",
      "cst_us:address::$00FB",
    ]);
    expect(converted.labelUses).toEqual([{ id: "lbl_ua", at: 0, layer: "lay_a", label: "clm_1" }]);
    for (const layer of converted.layers) {
      expect(layer.constantUses).toBeUndefined();
      expect(layer.labelUses).toBeUndefined();
    }
  });

  it("leaves a use whose layer it cannot place exactly where it was", () => {
    const partial = usesToRoot(legacy, (id) => (id === "lay_a" ? 0x8000 : undefined));
    expect(sites(partial)).toEqual(["cst_ua:layer:lay_a:$0002", "cst_us:address::$00FB"]);
    expect(partial.layers[1].constantUses).toEqual(legacy.layers[1].constantUses);
    // Nothing placeable: the project comes back as it went in. (Without the
    // symbols layer, whose uses need no placement and always move.)
    const owned = { ...legacy, layers: legacy.layers.slice(0, 2) };
    expect(usesToRoot(owned, () => undefined)).toBe(owned);
  });

  it("shows each owner's binding in the view its owner is in, and nowhere else", () => {
    const load = (target: string) => buildMemoryMap(legacy, makeFileLoader(() => new Uint8Array()), { target });
    expect(load("base").constants.nameAt(0x8002)).toBe("ONE");
    expect(load("patched").constants.nameAt(0x8002)).toBe("TWO");
    // The zero-page binding, on no layer's bytes, is a fact about the machine.
    expect(load("base").constants.nameAt(0x00fb)).toBe("ONE");
    expect(load("patched").constants.nameAt(0x00fb)).toBe("ONE");
  });

  it("moves with its owner once framed there", () => {
    const relocated: Project = {
      ...legacy,
      targets: [{ id: "tgt_m", name: "moved", layers: [{ id: "lnk_1", layer: "lay_a", at: 0x9000 }] }],
    };
    const moved = buildMemoryMap(relocated, makeFileLoader(() => new Uint8Array()), { target: "moved" });
    expect(moved.constants.nameAt(0x9002)).toBe("ONE");
    expect(moved.constants.nameAt(0x8002)).toBeUndefined();
    // What the loader hands on is the converted project: the use is on its layer.
    expect(moved.project.constantUses?.find((u) => u.id === "cst_ua")).toEqual({
      id: "cst_ua",
      at: 2,
      layer: "lay_a",
      constant: "cst_one",
    });
  });

  it("is written and read nested by the text, which knows no placement", () => {
    const text = formatProject(legacy);
    expect(text).toMatch(/^      "constantUses"/m);
    expect(text).not.toMatch(/^  "constantUses"/m);
    const back = parseProject(text);
    expect(back.layers[0].constantUses).toEqual(legacy.layers[0].constantUses);
    expect(back.layers[1].constantUses).toEqual(legacy.layers[1].constantUses);
    expect(back.constantUses).toBeUndefined();
  });

  it("survives direct document construction, and is moved there only with the placements", () => {
    // `docFromProject` is the boundary a store snapshot and a merge go through;
    // the parsed-input case above is not the only way in.
    const doc = docFromProject(legacy);
    const held = projectFromDoc(doc);
    expect(held.layers[0].constantUses).toEqual(legacy.layers[0].constantUses);
    expect(held.layers[1].constantUses).toEqual(legacy.layers[1].constantUses);
    expect(held.layers[0].labelUses).toEqual([{ id: "lbl_ua", address: 32768, label: "clm_1" }]);
    expect(held.constantUses).toBeUndefined();

    expect(migrateDoc(doc, placed)).toBe(true);
    const migrated = projectFromDoc(doc);
    expect(sites(migrated)).toEqual([
      "cst_ua:layer:lay_a:$0002",
      "cst_ub:layer:lay_b:$0002",
      "cst_us:address::$00FB",
    ]);
    expect(migrated.layers.some((l) => l.constantUses || l.labelUses)).toBe(false);
  });

  it("applies an operation recorded before frames to the nested form it was recorded against", () => {
    const doc = docFromProject(legacy);
    // As main recorded a bind: a layer and an absolute address, no frame.
    applyOpToDoc(doc, { op: "constantUse.bind", id: "cst_u2", layerId: "lay_a", address: 0x8000, constantId: "cst_one" });
    expect(projectFromDoc(doc).layers[0].constantUses?.map((u) => `${u.id}@${u.address}`)).toEqual([
      "cst_u2@$8000",
      "cst_ua@$8002",
    ]);
    expect(projectFromDoc(doc).constantUses).toBeUndefined();
    // Its unbind, recorded the same way, clears the same site — and the text
    // adapter agrees with the document.
    const text = applyOp(formatProject(legacy), {
      op: "constantUse.bind",
      id: "cst_u2",
      layerId: "lay_a",
      address: 0x8000,
      constantId: "cst_one",
    });
    expect(parseProject(text).layers[0].constantUses?.map((u) => u.id)).toEqual(["cst_ua", "cst_u2"]);
    const inverse = invertOp(text, { op: "constantUse.unbind", id: "cst_u2", layerId: "lay_a", address: 0x8000 });
    expect(inverse).toEqual({ op: "constantUse.bind", id: "cst_u2", layerId: "lay_a", address: 0x8000, constantId: "cst_one" });
    applyOpToDoc(doc, { op: "constantUse.unbind", id: "cst_u2", layerId: "lay_a", address: 0x8000 });
    expect(projectFromDoc(doc).layers[0].constantUses?.map((u) => u.id)).toEqual(["cst_ua"]);
  });
});

describe("two frames resolving to one address", () => {
  /**
   * The more specific one shows: a target-framed use is about this arrangement
   * and overrides the layer's, which overrides the address space's. The index
   * the listing reads keeps the last binding at an address, so `resolvedUses`
   * orders least specific first — and the workspace's unbind takes the last,
   * so what it removes is what was showing.
   */
  it("breaks a tie between two layers' bindings by the view's stack, as bytes are", () => {
    // A base and a patch over it, each binding the same site; whichever is on
    // top in the selected target is the one that shows — and the answer must
    // not depend on the order the document happens to list the uses in, which
    // migration changes (nested lists came in target order; the root sorts by
    // site and id).
    const stacked = (order: ["lay_base", "lay_patch"] | ["lay_patch", "lay_base"]): Project => ({
      name: "stacked",
      layers: [
        {
          id: "lay_base",
          type: "bytes",
          address: "$8000",
          bytes: "a90160",
          constantUses: [{ id: "cst_uz", address: "$8000", constant: "cst_base" }],
        },
        {
          id: "lay_patch",
          type: "bytes",
          address: "$8000",
          bytes: "a90160",
          constantUses: [{ id: "cst_ua", address: "$8000", constant: "cst_patch" }],
        },
      ],
      constants: [
        { id: "cst_base", name: "BASE", value: "$01" },
        { id: "cst_patch", name: "PATCH", value: "$01" },
      ],
      targets: [{ id: "tgt_1", name: "view", layers: [...order] }],
    });
    const shown = (project: Project) =>
      buildMemoryMap(project, makeFileLoader(() => new Uint8Array()), { target: "view" }).constants.nameAt(0x8000);
    const migrated = (project: Project): Project => {
      const doc = docFromProject(project);
      migrateDoc(doc, () => 0x8000);
      return projectFromDoc(doc);
    };
    expect(shown(stacked(["lay_base", "lay_patch"]))).toBe("PATCH");
    expect(shown(stacked(["lay_patch", "lay_base"]))).toBe("BASE");
    expect(shown(migrated(stacked(["lay_base", "lay_patch"])))).toBe("PATCH");
    expect(shown(migrated(stacked(["lay_patch", "lay_base"])))).toBe("BASE");
  });

  it("orders least specific first, so the last at an address is the most specific", () => {
    const uses = [
      { id: "t", at: "$8000", target: "tgt_1", constant: "cst_t" },
      { id: "l", at: "$0000", layer: "lay_a", constant: "cst_l" },
      { id: "a", at: "$8000", constant: "cst_a" },
    ];
    const resolved = resolvedUses(uses, (id) => (id === "lay_a" ? 0x8000 : undefined), "tgt_1");
    expect(resolved.map((r) => r.use.id)).toEqual(["a", "l", "t"]);
    // Out of the target's view, the layer's is the most specific left.
    expect(resolvedUses(uses, () => 0x8000, "tgt_2").map((r) => r.use.id)).toEqual(["a", "l"]);
  });
});
