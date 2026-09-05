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
import { Label, LabelType } from "../memory/label.js";
import { TextEncoding } from "../c64/text.js";
import { RegionKind } from "../memory/region.js";
import { LoadedProject } from "../project/loader.js";
import { newId } from "../project/identity.js";
import { parseProjectAddress } from "../project/project.js";
import { resolveOwningLayer } from "../project/ownership.js";
import { ClaimEdit, Op } from "./types.js";
import { Claim, Interpretation, Provenance, RootKind } from "../claims/model.js";

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
const ROOT_FOR_TYPE: Partial<Record<LabelType, RootKind>> = {
  entry: "entry",
  function: "routine",
  code: "location",
};
const TYPE_FOR_ROOT: Partial<Record<RootKind, LabelType>> = {
  entry: "entry",
  routine: "function",
  location: "code",
};

const SAYS_FOR_KIND: Partial<Record<RegionKind, Interpretation["is"]>> = {
  data: "data",
  text: "text",
  bitmap: "bitmap",
  jumptable: "jumptable",
};

/**
 * Who a claim records as its author.
 *
 * A placeholder, and knowingly so: the op builders are not handed the caller,
 * while `runOps` is — so an edit *is* attributed, in the ops log, and the claim
 * itself is not yet. Threading the caller through every builder is a mechanical
 * change across some thirty call sites and is deliberately not in this step.
 */
const AUTHOR: Provenance = { author: "project", source: "user" };

const claimById = (loaded: LoadedProject, id: string): Claim | undefined =>
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
 * `renameLabelOp`, by id, exactly as revising a comment is.
 *
 * An invented `dat_XXXX` is not a chosen name and not a stored object, so naming
 * such an address still mints, which is the overwhelmingly common act.
 */
export function labelSetOps(
  loaded: LoadedProject,
  address: number,
  name: string,
  type?: LabelType,
  extent?: number
): { ops: Op[]; addedBeside?: string } {
  const index = loaded.map.getLabels();
  // Only a name a *person* chose is somebody's judgement to be joined rather
  // than quietly doubled. An invented `dat_XXXX`, a PRG layer's entry label
  // named after its file, and a region's name are all machinery — naming such an
  // address is the ordinary act of naming an unnamed one.
  const chosenHere = index.getLabelsAt(address).filter((l) => l.source.kind === "user");

  // Always adds — even the same name twice. Two labels are told apart by id,
  // and two people each making one is simpler than making the second react to a
  // merge they did not ask for. Duplication at one address is already a state
  // this project tolerates: it is not ambiguity, since the name still reaches
  // exactly one address, and the reference project ships ten such pairs.
  const showing = index.resolve(address)?.label;
  const chosen = loaded.map.primaryLabels.has(address);
  return {
    ops: [
      // Pin what is showing, unless somebody has chosen. Two user labels tie on
      // rank so the winner falls to id order, which is random: without this a
      // second name silently renames every reference to the address.
      ...(chosenHere.length > 0 && showing && !chosen
        ? [{ op: "primary.set", address, labelId: showing.id } as Op]
        : []),
      {
        op: "claim.add",
        claim: {
          id: newId("clm"),
          at: address,
          name,
          ...(type && ROOT_FOR_TYPE[type] ? { root: ROOT_FOR_TYPE[type] } : {}),
          ...(extent !== undefined ? { extent } : {}),
          by: AUTHOR,
        },
      } as Op,
    ],
    ...(chosenHere.length > 0 ? { addedBeside: chosenHere[0].name } : {}),
  };
}

/** Change a label's name, by the only thing that identifies it. */
export function renameLabelOp(
  loaded: LoadedProject,
  id: string,
  name: string,
  type?: LabelType,
  extent?: number
): Op {
  const found = claimById(loaded, id);
  if (found) {
    return {
      op: "claim.set",
      id,
      fields: {
        name,
        // Named fields only, so a revision leaves alone what it does not
        // mention — and `null` is how it clears, which an omitted key cannot.
        ...(type === undefined ? {} : { root: ROOT_FOR_TYPE[type] ?? null }),
        ...(extent === undefined ? {} : { extent }),
      },
    };
  }
  throw new Error(
    `No label has id ${id}. list_labels reports the id of every label a project ` +
      `owns; an invented name has none, because nothing stored it.`
  );
}

export function labelSetOp(
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
      at: address,
      name,
      ...(type && ROOT_FOR_TYPE[type] ? { root: ROOT_FOR_TYPE[type] } : {}),
      ...(extent !== undefined ? { extent } : {}),
      by: AUTHOR,
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
  text: string
): Op {
  return {
    op: "comment.set",
    id: newId("cmt"),
    layerId: owningLayerId(loaded, address),
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
    return {
      op: "comment.set",
      id,
      layerId: layer.id,
      address: parseProjectAddress(existing.address),
      placement: changes.placement ?? existing.placement ?? "before",
      text: changes.text ?? existing.text,
      ...(changes.order ?? existing.order) === undefined
        ? {}
        : { order: changes.order ?? existing.order },
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

  return existing?.id ? { op: "comment.delete", id: existing.id, layerId } : undefined;
}

/** Undefined when there is no project label to delete; a built-in is not one. */
export function labelDeleteOp(loaded: LoadedProject, address: number): Op | undefined {
  const here = namesAt(loaded, address);
  return here.length === 1 ? { op: "claim.remove", id: here[0].id } : undefined;
}

/**
 * A region needs bytes; a label does not.
 *
 * Ownership resolution falls back to a symbols layer for an address nothing
 * supplies, which is right for a label — that is what symbols layers are for —
 * and wrong for a region, which says how to *interpret* bytes that are not
 * there. The two shared one resolver, so declaring a region over `$0400` on a
 * project with a symbols layer attached it to that layer, wrote a document the
 * loader refuses, and left the project unwritable through every interface.
 */
export function regionSetOp(
  loaded: LoadedProject,
  start: number,
  end: number,
  kind: RegionKind,
  name?: string,
  comment?: string,
  encoding?: TextEncoding,
  view?: string,
  /**
   * The region being revised, when the caller knows which.
   *
   * Everything below this is a guess made because it usually is not given, and
   * an id makes the guess unnecessary: it says *this* region, whatever its span
   * is now. `describe_project` reports them for exactly this.
   */
  id?: string
): Op {
  // No inference at all, which is the whole change.
  //
  // This used to guess which region a declaration *revised* from its span, in
  // three cases: the same span exactly, the only region starting here, or a new
  // nested one. That made a write's identity depend on what the caller had
  // synced — a reader who had seen somebody else's region silently replaced it,
  // one who had not produced a second — and the same call therefore had two
  // outcomes. It is this project's own offline/online test failing, and the last
  // of the four instances of upsert-by-inference, after `set_comment` keyed by
  // slot, `set_label` keyed by address, and `set_constant` keyed by name.
  //
  // An id revises. No id adds. Two people declaring the same span now both
  // stand, and `disagreements()` reports it rather than one of them losing.
  if (id !== undefined) {
    const found = claimById(loaded, id);
    if (!found) {
      throw new Error(
        `No claim ${id} in this project. ` +
          `describe_project lists what is declared, with ids.`
      );
    }
    return {
      op: "claim.set",
      id,
      fields: {
        at: start,
        extent: end - start,
        says: interpretationOf(kind, encoding, view),
        ...(name === undefined ? {} : { name }),
      },
    };
  }

  // `code` is not an interpretation, it is a decode root — the whole of what a
  // code region ever did was seed the queue at its start, since for the walk it
  // was indistinguishable from `unknown` and from silence. So declaring one
  // makes a root rather than refusing, and the span it came with is dropped
  // because it never meant anything.
  if (kind === "code") {
    return {
      op: "claim.add",
      claim: {
        id: newId("clm"),
        at: start,
        ...(name === undefined ? {} : { name }),
        root: "entry",
        by: AUTHOR,
      },
    };
  }

  // A span still needs bytes to interpret. Unlike a *name*, which may reach an
  // address nothing supplies, saying "these bytes are text" about bytes that do
  // not exist describes nothing.
  // Bytes, not ownership. `ownsAddress` asks which layer an annotation would
  // belong to, and a symbols layer owns zero page while supplying nothing — so
  // it answered yes for addresses with nothing to read. What matters here is
  // whether any layer actually puts a byte there.
  if (loaded.map.layerAt(start) === undefined) {
    throw new Error(
      `No loaded bytes at $${hex4(start)}, so there is nothing there to ` +
        `interpret. A claim about bytes says how to read them; to name an ` +
        `address outside the loaded ranges, add a label instead.`
    );
  }

  return {
    op: "claim.add",
    claim: {
      id: newId("clm"),
      at: start,
      extent: end - start,
      says: interpretationOf(kind, encoding, view),
      ...(name === undefined ? {} : { name }),
      // Rooted, because inclusion is reachability: a span nothing names would
      // otherwise be declared and never rendered.
      root: "data",
      by: AUTHOR,
    },
  };
}

/** The interpretation a region kind and its rendering options project to. */
function interpretationOf(
  kind: RegionKind,
  encoding?: TextEncoding,
  view?: string
): Interpretation {
  const is = SAYS_FOR_KIND[kind];
  if (!is) {
    // `code` and `unknown` are not interpretations: code is what bytes are when
    // nobody has said otherwise, and `unknown` is the absence of a claim.
    throw new Error(
      `"${kind}" is not something a claim can say about bytes. ` +
        `Declare a root to have an address decoded, and remove a claim to leave ` +
        `its bytes unexplained.`
    );
  }
  if (is === "text") return { is, ...(encoding !== undefined ? { encoding } : {}) };
  if (is === "bitmap") return { is, ...(view !== undefined ? { view } : {}) };
  return { is };
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
