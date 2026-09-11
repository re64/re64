import { describe, it, expect } from "vitest";
import { buildMemoryMap } from "./loader.js";
import { makeFileLoader } from "./file-source.js";
import { Project, parseProject, usesToRoot } from "./project.js";
import { formatProject } from "./serialize.js";
import { applyOpToDoc, docFromProject, projectFromDoc } from "../crdt/index.js";

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
   * addresses. Lifted to the root and framed on the **address space** — which
   * is exactly what the record said, since converting to a layer offset needs
   * the layer's placement, which for a `.prg` is inside bytes this boundary
   * does not have. See `usesToRoot`.
   */
  const legacy = {
    layers: [
      {
        id: "lay_a",
        type: "prg",
        path: "game.prg",
        constantUses: [{ id: "cst_u1", address: "$8010", constant: "cst_one" }],
        labelUses: [{ id: "lbl_u1", address: 32784, label: "clm_1" }],
      },
    ],
    constants: [{ id: "cst_one", name: "ONE", value: "$01" }],
  };

  it("lifts nested uses to the root, address-framed, and never writes them nested again", () => {
    const lifted = usesToRoot(legacy as unknown as Project);
    expect(lifted.layers[0].constantUses).toBeUndefined();
    expect(lifted.constantUses).toEqual([{ id: "cst_u1", at: "$8010", constant: "cst_one" }]);
    expect(lifted.labelUses).toEqual([{ id: "lbl_u1", at: 32784, label: "clm_1" }]);

    const text = formatProject(legacy as unknown as Project);
    expect(text).not.toMatch(/^      "constantUses"/m);
    expect(parseProject(text).constantUses).toEqual([{ id: "cst_u1", at: "$8010", constant: "cst_one" }]);
  });

  it("reads an operation recorded before frames as an address-framed site", () => {
    const doc = docFromProject(parseProject(JSON.stringify(legacy)));
    // As main recorded a bind: a layer and an absolute address, no frame.
    applyOpToDoc(doc, {
      op: "constantUse.bind",
      id: "cst_u2",
      layerId: "lay_a",
      address: 0x8020,
      constantId: "cst_one",
    } as never);
    expect(projectFromDoc(doc).constantUses?.map((u) => `${u.at}${u.layer ? "@" + u.layer : ""}`)).toEqual([
      "$8010",
      "$8020",
    ]);
    // And its unbind, recorded the same way, clears the same site.
    applyOpToDoc(doc, { op: "constantUse.unbind", id: "cst_u2", layerId: "lay_a", address: 0x8020 } as never);
    expect(projectFromDoc(doc).constantUses?.map((u) => u.at)).toEqual(["$8010"]);
  });
});
