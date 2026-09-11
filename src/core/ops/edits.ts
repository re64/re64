/**
 * Building the operations that express an edit.
 *
 * One place, because there were two and they disagreed. The browser reused the
 * id of whatever label resolved at an address — including a built-in platform
 * label, so naming `$FFD2` would adopt `CHROUT`'s derived id and mint a project
 * label carrying a fake identity. The CLI reused only a project label in the
 * owning layer. A third consumer was about to invent a third rule.
 *
 * The rule, stated once: **reuse the id of an existing project label at that
 * address in the layer that owns it, and never any other kind.** Platform,
 * region and auto labels all have derived ids that describe where they came
 * from, not something a project may claim.
 */

import { CommentPlacement } from "../memory/comment.js";
import { LabelType } from "../memory/label-type.js";
import { TextEncoding } from "../c64/text.js";
import { LoadedProject } from "../project/loader.js";
import { newId } from "../project/identity.js";
import { parseProjectAddress } from "../project/project.js";
import { resolveOwningLayer } from "../project/ownership.js";
import { ClaimEdit, Op } from "./types.js";
import {
  Claim,
  ClaimMethod,
  Frame,
  Interpretation,
  Provenance,
  RootKind,
  scopeFor,
} from "../claims/model.js";

/**
 * Make sure some layer can own an annotation at this address.
 *
 * Returns the operation that creates a symbols layer when nothing owns the
 * address and no symbols layer exists to take it, and the id to write into.
 *
 * The refusal this replaces named the fix and gave no way to perform it: "add a
 * layer of type symbols" with no tool that could. On a 6502 program every
 * variable lives in zero page, so it made naming roughly half of what a person
 * contributes impossible.
 *
 * Creating rather than relaxing ownership. The rule that annotations belong to
 * the layer supplying their bytes is what makes reordering the stack move them
 * with the content they describe; loosening it to let anything hold anything
 * would bring back exactly the bug it prevents. A symbols layer is the model's
 * own answer for an address with no bytes, and it already exists — the built-in
 * C64 table is one.
 */
export function ensureOwningLayer(
  loaded: LoadedProject,
  address: number,
  projectName?: string
): { layerId: string; create?: Op } {
  try {
    return { layerId: owningLayerId(loaded, address) };
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith("No layer owns")) throw err;
  }

  const id = newId("lay");
  return {
    layerId: id,
    create: {
      op: "layer.add",
      id,
      layerType: "symbols",
      name: `${projectName ?? "project"} symbols`,
      // The bottom of the stack: it supplies no bytes so it shadows nothing,
      // and ownership resolves to the first symbols layer declared.
      index: 0,
    },
  };
}

/** Whether any layer already owns this address, without throwing to find out. */
export function ownsAddress(loaded: LoadedProject, address: number): boolean {
  return resolveOwningLayer(loaded, address) !== undefined;
}

/** The layer an annotation at this address belongs to. */
export function owningLayerId(loaded: LoadedProject, address: number): string {
  const index = resolveOwningLayer(loaded, address);
  if (index === undefined) {
    throw new Error(
      `No layer owns $${hex4(address)}. Add a layer of type "symbols" to name ` +
        `addresses outside the loaded bytes.`
    );
  }
  const id = loaded.project.layers[index].id;
  if (!id) throw new Error("This project has no ids; run: re64 migrate");
  return id;
}

/** The project label at an address, if the owning layer declares one. */
export function projectLabelAt(
  loaded: LoadedProject,
  layerId: string,
  address: number
): { id: string; name: string; type?: LabelType } | undefined {
  const layer = loaded.project.layers.find((l) => l.id === layerId);
  const found = layer?.labels?.find((l) => parseProjectAddress(l.address) === address);
  return found?.id ? { id: found.id, name: found.name, type: found.type } : undefined;
}

/**
 * Every project label at an address, in the layer that owns it.
 *
 * `projectLabelAt` returns the first, which is right for a revise and wrong for
 * a delete: with two labels there, "remove the label at $C065" has no single
 * answer, and answering anyway removed one of them silently and left the other
 * unreachable. Both builders in experiment 5 hit that.
 */
export function projectLabelsAt(
  loaded: LoadedProject,
  layerId: string,
  address: number
): { id: string; name: string; type?: LabelType }[] {
  const layer = loaded.project.layers.find((l) => l.id === layerId);
  return (layer?.labels ?? [])
    .filter((l) => l.id && parseProjectAddress(l.address) === address)
    .map((l) => ({ id: l.id!, name: l.name, type: l.type }));
}

/** Delete a label by id, wherever it lives. */
export function labelDeleteByIdOp(loaded: LoadedProject, id: string): Op | undefined {
  return claimById(loaded, id) ? { op: "claim.remove", id } : undefined;
}

/**
 * The root a label type declares.
 *
 * `address` maps to nothing: it was only ever "just a name", which is a claim
 * with no root at all.
 */
export const ROOT_FOR_TYPE: Partial<Record<LabelType, RootKind>> = {
  entry: "entry",
  function: "routine",
  code: "location",
};
const TYPE_FOR_ROOT: Partial<Record<RootKind, LabelType>> = {
  entry: "entry",
  routine: "function",
  location: "code",
};


/**
 * Who a claim records as its author.
 *
 * A placeholder, and knowingly so: the op builders are not handed the caller,
 * while `runOps` is — so an edit *is* attributed, in the ops log, and the claim
 * itself is not yet. Threading the caller through every builder is a mechanical
 * change across some thirty call sites and is deliberately not in this step.
 */
/**
 * What these builders make: somebody's judgement, not machinery.
 *
 * The author used to live here too and now belongs to the evidence that vouches
 * for a claim. These builders mint no evidence — an edit is attributed in the
 * ops log, which is where it always was — so what a claim built here records is
 * that a person decided it, and who is a question for the log.
 */
const ORIGIN = "user" as const;

/**
 * Where a claim about this address belongs, as the file and document store it.
 *
 * The other half of the loader's resolution, and the only other place the two
 * forms meet. Every builder below goes through it, so no writer has to know
 * that a layer-framed claim holds an offset — and none of them can forget,
 * which is the failure mode of a relocation step that lives in each consumer.
 */
export function placed(loaded: LoadedProject, address: number): { frame: Frame; at: number } {
  const owner = loaded.map.layerAt(address);
  return scopeFor(
    address,
    // A symbols layer supplies no bytes and has no address, so nothing can be
    // an offset into one — `layerAt` already returns only byte layers.
    owner ? { id: owner.id, start: owner.start } : undefined,
    // **Deliberately not the selected target**, and this is the interesting
    // half.
    //
    // A byte no layer supplies is zero page, or an I/O register, or a KERNAL
    // vector. Scoping such a claim to the view it happened to be written in is
    // measurably wrong on the one project that has several: Camels' 68
    // hand-named zero-page addresses were written while reading `runtime`, and
    // `patched` is the same program with eleven byte patches over it while
    // `machine` is the same program with the ROMs banked in. `$02` is
    // `printColumn` in all of them. Framed on `runtime` and honestly filtered,
    // 68 names disappear from four views out of five.
    //
    // So the default scope for an unowned byte is **the address space** — a fact
    // about the machine this program runs on, true in every arrangement of it.
    // The target frame is for a claim that really is about one arrangement, it
    // is honoured on the way in and filtered on the way out, and nothing emits
    // one by default. Which writes should be able to ask for one is open; see
    // `docs/05-model.md`.
    undefined
  );
}

export const claimById = (loaded: LoadedProject, id: string): Claim | undefined =>
  loaded.claims.find((c) => c.id === id);

/** Claims that name an address without saying what its bytes are. */
const namesAt = (loaded: LoadedProject, address: number): Claim[] =>
  loaded.claims.filter((c) => c.at === address && c.name !== undefined && c.says === undefined);

/** Every field of a claim, for a revision that keeps what it does not name. */
const editOf = (claim: Claim): ClaimEdit => {
  const { id: _id, ...rest } = claim;
  return rest as ClaimEdit;
};

/**
 * Name an address. Never replace a name.
 *
 * This used to reuse the id of whatever label was already there, so it *renamed*
 * it — and an address cannot identify a label, which is the first identity rule
 * this project states. The document was always able to hold several names at one
 * address with `primaryLabels` deciding which renders; the API was what refused,
 * and experiment 7 measured the cost: three readers, **123 names replaced across
 * 74 addresses**, and the losses were judgements rather than duplicates —
 * `jumpTimer` against `jumpVelocity`, `shotInFlight` against `laserSoundActive`.
 *
 * So there is no "set" for a label at all: naming an address adds a name, and the
 * only thing anybody sets is which of them renders. Correcting a name is
 * `claim.set` by id, exactly as revising a comment is — there is no separate
 * rename builder, because a name is one field of a claim like any other.
 *
 * An invented `dat_XXXX` is not a chosen name and not a stored object, so naming
 * such an address still mints, which is the overwhelmingly common act.
 */
/**
 * Say something about an address. **Always adds.**
 *
 * The whole vocabulary goes through this now, and it did not: a claim carrying
 * an `is` or a `root` used to route through `regionSetOp`, which infers an
 * existing claim from a start address and reuses its id — an upsert, under a
 * tool whose own description promises it never replaces. The first pair of
 * readers to meet it found it by deliberately probing, and it ate a name.
 *
 * That is `set_label`'s history repeating for the third time, on the noun this
 * project rewrote its model around specifically to stop it. The rule is stated
 * in `CLAUDE.md` in as many words — *an address cannot identify a claim* — and
 * the write path kept one path that did.
 */
export function claimAddOps(
  loaded: LoadedProject,
  address: number,
  claim: {
    name?: string;
    says?: Interpretation;
    root?: RootKind;
    extent?: number;
    /** How the claimer knows. See `ClaimMethod`. */
    method?: ClaimMethod;
  },
  /**
   * Who is saying it, when the caller knows.
   *
   * Given, an evidence record is minted beside the claim carrying the author
   * and the method — because that is where provenance lives now, and a claim
   * with nobody vouching for it is a statement nobody made. Omitted for the
   * builders that have no caller to hand (the browser session, the CLI), which
   * is honest: the ops log attributes the edit either way.
   */
  by?: Provenance
): { ops: Op[]; addedBeside?: string } {
  const index = loaded.map.getLabels();
  // Only a name a *person* chose is somebody's judgement to be joined rather
  // than quietly doubled. An invented `dat_XXXX`, a PRG layer's entry label
  // named after its file, and a region's name are all machinery — naming such an
  // address is the ordinary act of naming an unnamed one.
  const chosenHere = index.getLabelsAt(address).filter((l) => l.origin === "user");

  // Always adds — even the same name twice. Two labels are told apart by id,
  // and two people each making one is simpler than making the second react to a
  // merge they did not ask for. Duplication at one address is already a state
  // this project tolerates: it is not ambiguity, since the name still reaches
  // exactly one address, and the reference project ships ten such pairs.
  const showing = index.resolve(address)?.label;
  const chosen = loaded.map.primaryLabels.has(address);
  const id = newId("clm");
  return {
    ops: [
      // Pin what is showing, unless somebody has chosen. Two user labels tie on
      // rank so the winner falls to id order, which is random: without this a
      // second name silently renames every reference to the address.
      ...(claim.name !== undefined && chosenHere.length > 0 && showing && !chosen
        ? [{ op: "primary.bind", address, labelId: showing.id } as Op]
        : []),
      {
        op: "claim.add",
        claim: {
          id,
          ...placed(loaded, address),
          ...(claim.name === undefined ? {} : { name: claim.name }),
          ...(claim.says === undefined ? {} : { says: claim.says }),
          ...(claim.root === undefined ? {} : { root: claim.root }),
          ...(claim.extent === undefined ? {} : { extent: claim.extent }),
          origin: ORIGIN,
        },
      } as Op,
      // Who said it, and how they know. One `supports` beside the claim rather
      // than fields on it, so a second reader reaching the same finding adds a
      // second record to the *same* claim instead of a claim nobody can merge.
      ...(by === undefined
        ? []
        : [
            {
              op: "evidence.add",
              id: newId("evd"),
              claim: id,
              kind: "supports",
              by: {
                ...by,
                ...(claim.method === undefined ? {} : { method: claim.method }),
              },
            } as Op,
          ]),
    ],
    ...(chosenHere.length > 0 ? { addedBeside: chosenHere[0].name } : {}),
  };
}

/**
 * Promote the name at an address, or add one if there is nothing to promote.
 *
 * **Deliberately not exported.** This is the address-keyed upsert every other
 * write path was cured of, and it survives for exactly one caller:
 * `markFunctionOps`, where "promote what is already here" is what the edit
 * means. Anywhere else it is the bug — an address cannot identify a claim, so
 * naming adds and correcting goes by id.
 */
function labelSetOp(
  loaded: LoadedProject,
  address: number,
  name: string,
  type?: LabelType,
  extent?: number
): Op {
  const here = namesAt(loaded, address);
  // One name here: revise it. None, or several: add, because an address cannot
  // identify a claim and picking one of two would be the upsert this replaced.
  if (here.length === 1) {
    return {
      op: "claim.set",
      id: here[0].id,
      fields: {
        name,
        ...(type === undefined ? {} : { root: ROOT_FOR_TYPE[type] ?? null }),
        ...(extent === undefined ? {} : { extent }),
      },
    };
  }
  return labelAddOp(loaded, address, name, type, extent);
}

/**
 * Add a name at an address without replacing the one already there.
 *
 * `labelSetOp` reuses the id of the project label at that address, so it
 * renames — which is right for correcting a name and wrong for the case the
 * reference disassembly actually has, where `$08` is `randomValue` generally
 * and `gridXPos` inside one routine. This is how a second name gets made.
 */
export function labelAddOp(
  loaded: LoadedProject,
  address: number,
  name: string,
  type?: LabelType,
  extent?: number
): Op {
  return {
    op: "claim.add",
    claim: {
      id: newId("clm"),
      ...placed(loaded, address),
      name,
      ...(type && ROOT_FOR_TYPE[type] ? { root: ROOT_FOR_TYPE[type] } : {}),
      ...(extent !== undefined ? { extent } : {}),
      origin: ORIGIN,
    },
  };
}

/**
 * Write a comment, replacing the one already in this slot if there is one.
 *
 * A slot is an address and a placement. Several comments may share an address
 * — nothing forces a single choice the way operand rendering does for labels —
 * but `set_comment` at the same place twice is one person revising, not two
 * comments, so it targets the existing id rather than stacking a second.
 * Adding a deliberate second is `placement` or another address.
 */
/**
 * Add a comment. Always a new one.
 *
 * There used to be a single `commentSetOp` that matched an existing comment by
 * `(address, placement)` and reused its id — an upsert keyed by *slot*. That was
 * justified as "one person changing their mind rather than two comments", which
 * is true of one author and false the moment there are two: in experiment 3 an
 * agent's `before` comment silently replaced another's, and three of the four
 * readers across two runs invented the same bad workaround, using `inline` as a
 * second slot to avoid the collision. One asked for `append_comment` by name.
 *
 * The model always supported several comments at an address — they are all
 * rendered, ordered deliberately. Only the write path could not reach it. So
 * this mints, `commentEditOp` revises by id, and slot-keyed upsert is gone: an
 * address cannot identify a comment for exactly the reason it cannot identify a
 * label.
 */
export function commentAddOp(
  loaded: LoadedProject,
  address: number,
  placement: CommentPlacement,
  text: string,
  /** The layer to hold it, where the caller has just created one. */
  layerId?: string
): Op {
  return {
    op: "comment.add",
    id: newId("cmt"),
    layerId: layerId ?? owningLayerId(loaded, address),
    address,
    placement,
    text,
  };
}

/** Revise a comment by id: its text, its placement, or where it sits. */
export function commentEditOp(
  loaded: LoadedProject,
  id: string,
  changes: { text?: string; placement?: CommentPlacement; order?: number }
): Op {
  for (const layer of loaded.project.layers) {
    const existing = layer.comments?.find((c) => c.id === id);
    if (!existing || !layer.id) continue;
    // Only what the caller asked to change. This used to resend the address,
    // the placement and the text on every edit, because the operation was a
    // whole-value write — so revising a comment's order silently reasserted
    // text a collaborator had just corrected.
    return {
      op: "comment.set",
      id,
      layerId: layer.id,
      fields: {
        ...(changes.text === undefined ? {} : { text: changes.text }),
        ...(changes.placement === undefined ? {} : { placement: changes.placement }),
        ...(changes.order === undefined ? {} : { order: changes.order }),
      },
    };
  }
  throw new Error(`No comment ${id}. list_comments shows what this project has.`);
}

/** Undefined when there is no comment in that slot to remove. */
export function commentDeleteOp(
  loaded: LoadedProject,
  address: number,
  placement?: CommentPlacement
): Op | undefined {
  const layerId = owningLayerId(loaded, address);
  const layer = loaded.project.layers.find((l) => l.id === layerId);
  const existing = layer?.comments?.find(
    (c) =>
      parseProjectAddress(c.address) === address &&
      (placement === undefined || (c.placement ?? "before") === placement)
  );

  return existing?.id ? { op: "comment.remove", id: existing.id, layerId } : undefined;
}

/** Undefined when there is no project label to delete; a built-in is not one. */
export function labelDeleteOp(loaded: LoadedProject, address: number): Op | undefined {
  const here = namesAt(loaded, address);
  return here.length === 1 ? { op: "claim.remove", id: here[0].id } : undefined;
}

export function regionDeleteOp(
  loaded: LoadedProject,
  start: number,
  id?: string
): Op | undefined {
  if (id !== undefined) {
    return claimById(loaded, id) ? { op: "claim.remove", id } : undefined;
  }

  // Claims about bytes starting here. Several may, since one nesting inside
  // another is the ordinary way of refining a span — so a start address does
  // not identify one, and answering anyway would remove the wrong one silently.
  const here = loaded.claims.filter((c) => c.at === start && c.says !== undefined);
  if (here.length === 0) return undefined;
  if (here.length > 1) {
    const shown = here
      .map(
        (c) =>
          `${c.id} (${c.says!.is}${c.name ? ` "${c.name}"` : ""} to $${hex4(
            c.at + (c.extent ?? 1)
          )})`
      )
      .join(", ");
    throw new Error(
      `Several claims start at $${hex4(start)}, so that does not say which to ` +
        `remove: ${shown}. Pass the id of the one you mean.`
    );
  }
  return { op: "claim.remove", id: here[0].id };
}

/**
 * Whether a name was invented by the disassembler rather than chosen.
 *
 * The prefix encodes the type, so promoting one has to rewrite it — leaving
 * `loc_8100` tagged as a function would contradict itself.
 */
export function isAutoGeneratedName(name: string): boolean {
  return /^(sub|loc|dat)_[0-9A-F]{4}$/.test(name);
}

/**
 * Mark an address as a function, creating the label if there is none.
 *
 * This is how code that nothing references gets decoded at all, so it is the
 * single most consequential edit available.
 */
export function markFunctionOps(loaded: LoadedProject, address: number, name?: string): Op[] {
  const here = namesAt(loaded, address);
  const current = name ?? here[0]?.name ?? `sub_${hex4(address)}`;
  const promoted = isAutoGeneratedName(current) ? `sub_${hex4(address)}` : current;

  return [labelSetOp(loaded, address, promoted, "function")];
}

/**
 * Stop treating an address as a function.
 *
 * A name the disassembler invented is deleted outright rather than left behind
 * as an untyped duplicate of what it would generate anyway; a name someone
 * chose is kept and only its type is cleared.
 */
export function unmarkFunctionOps(loaded: LoadedProject, address: number): Op[] {
  const here = namesAt(loaded, address);
  const existing = here.find((c) => c.root === "routine") ?? here[0];
  if (!existing) return [];

  // A name the analysis invented carries no judgement, so clearing the type
  // leaves a redundant untyped entry rather than anything anybody wrote.
  if (isAutoGeneratedName(existing.name!)) {
    return [{ op: "claim.remove", id: existing.id }];
  }
  // A name somebody chose is kept; only its root is cleared, which is what
  // `null` is for.
  return [{ op: "claim.set", id: existing.id, fields: { root: null } }];
}

const hex4 = (address: number) => address.toString(16).toUpperCase().padStart(4, "0");
