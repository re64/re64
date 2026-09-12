import { Comment, CommentPlacement, createComment } from "../memory/comment.js";
import {
  Constant,
  ConstantUse,
  createConstant,
  createConstantUse,
} from "../memory/constant.js";
import { LabelType } from "../memory/label-type.js";
import { LabelUse, createLabelUse } from "../claims/names.js";
import { TEXT_ENCODINGS, TextEncoding } from "../c64/text.js";
import { LayerDefault } from "../memory/region.js";
import { filesWithIds } from "./files.js";
import { derivedId, layerIdOf } from "./identity.js";
import {
  Claim,
  Frame,
  resolveAt,
  ClaimMethod,
  ClaimOrigin,
  Interpretation,
  RootKind,
} from "../claims/model.js";

/**
 * The old `RegionKind`, as it appears in a file that still has one.
 *
 * Spelled here rather than imported because it no longer exists in the model:
 * `code` became a root and `unknown` became nothing at all. This is the shape
 * of a legacy file, not of anything the code holds.
 */
export type LegacyRegionKind = "code" | "data" | "text" | "jumptable" | "bitmap" | "unknown";

/**
 * Layer definition in a project file.
 *
 * Labels and regions nest inside the layer that owns them, so reordering the
 * stack moves annotations with the content they describe rather than leaving
 * them pointing at whatever else lands at that address.
 */
export interface ProjectLayer {
  /**
   * Stable identity. Optional in the file: a project written before ids
   * existed gets one derived from its content, and the next write persists it.
   */
  id?: string;
  /** Layer type. "symbols" carries names for addresses with no loaded bytes. */
  type: "prg" | "raw" | "bytes" | "symbols" | "rom";
  /**
   * Which machine ROM, for a `rom` layer.
   *
   * Resolved from wherever the host keeps them rather than from the project's
   * own files, because they are the machine's and not this project's — and
   * because they are not in this repository and never will be. A project that
   * asks for one it cannot get loads with the layer supplying no bytes and a
   * warning, rather than failing: the request is committed even though the
   * bytes are not, so a project stays openable by somebody who has no ROMs.
   */
  rom?: "basic" | "kernal" | "characters";
  /**
   * Bytes to resolve *through*, not bytes to read.
   *
   * A ROM is reference material: you want its names, its effects and the ability
   * to see what a program reads out of it, and you emphatically do not want
   * eight kilobytes of it in your disassembly. So a reference layer supplies
   * bytes to every question and is left out of the rendered range.
   *
   * One step along from what a symbols layer already is — that describes the
   * address space without occupying any of it; this occupies it without being
   * what you are reading. Defaults to true for a `rom` layer, since that is what
   * a ROM is for here, and false for everything else.
   */
  reference?: boolean;
  /** Immutable file reference; member selects an entry within a D64. */
  file?: string;
  member?: string;
  /** Legacy import only. */
  path?: string;
  /** Load address (for raw, optional override for prg) */
  address?: number | string;
  /** Hex bytes (for bytes type) */
  bytes?: string;
  /** Length for fill/repeat */
  length?: number;
  /** Suppress automatic entry point for PRG files */
  noAutoEntry?: boolean;
  /** Display name, defaulting to the file basename or a generated one */
  name?: string;
  /** Labels owned by this layer */
  labels?: ProjectLabel[];
  /** Regions carved out of this layer, overriding its default kind */
  regions?: ProjectRegion[];
  /** Comments about addresses this layer owns */
  comments?: ProjectComment[];
  /** Operands in this layer that mean a named constant */
  constantUses?: LegacyConstantUse[];
  /** Operands in this layer that mean one particular label */
  labelUses?: LegacyLabelUse[];
}

/**
 * A binding as it was nested in the layer that supplied its bytes, at an
 * absolute address.
 *
 * **Read everywhere, written by no tool.** The record said two things: the
 * site, and the *owner* — the layer decided whether the binding showed at all,
 * and kept it apart from another layer's binding at the same address. Both
 * survive only as a layer-framed use with the offset `address - placement`,
 * and the placement is not known at every boundary, so the nested form stays
 * a form the document can hold until a boundary that knows it converts it.
 * See `usesToRoot`.
 */
export interface LegacyConstantUse {
  id?: string;
  address: number | string;
  constant: string;
}

export interface LegacyLabelUse {
  id?: string;
  address: number | string;
  label: string;
}

/**
 * An operand that means one of several labels at an address.
 *
 * Keyed by the site — the instruction doing the referring — because the point
 * is that two instructions touching one address can mean different names for
 * it. Dangling means "fall back to the primary".
 */
export interface ProjectLabelUse {
  id?: string;
  /**
   * Where the operand is, **in the use's frame** — an offset into the layer
   * for a layer-framed use, an absolute address otherwise. Exactly as a claim's
   * `at`, and for the same reason: a binding names an instruction's operand,
   * and an instruction moves with its bytes.
   */
  at: number | string;
  /** The layer this use is an offset into, or... */
  layer?: string;
  /** ...the target it is a fact about. Neither: the address space. */
  target?: string;
  label: string;
  /** Legacy input only: an absolute address, from before uses carried a frame. */
  address?: number | string;
}

/**
 * An operand that means a constant, rather than the number it literally is.
 *
 * Owned by the layer holding the instruction. The declaration it points at is
 * project-level, because a name for a value describes no bytes and so has
 * nothing to move with when the stack is reordered.
 */
export interface ProjectDecoder {
  id?: string;
  /** What it is for, in a listing and in a menu. */
  name: string;
  /**
   * The body of a function taking `(bytes, params)` and returning a `Decoded`.
   *
   * Stored as source rather than compiled anything, so a `.re64` stays a text
   * file somebody can read and diff — and so what runs is what you can see.
   */
  source: string;
}

export interface ProjectConstantUse {
  id?: string;
  /** See `ProjectLabelUse.at`. */
  at: number | string;
  layer?: string;
  target?: string;
  /** The declared constant's id. Dangling means "render the literal". */
  constant: string;
  /** Legacy input only. */
  address?: number | string;
}

/**
 * A comment in a project file.
 *
 * Owned by a layer for the same reason labels are: reordering the stack has to
 * move an annotation with the bytes it describes.
 */
export interface ProjectComment {
  /** Stable identity; derived from content when the file omits it. */
  id?: string;
  address: number | string;
  /** Default "before". An inline comment shares the instruction's row. */
  placement?: CommentPlacement;
  text: string;
  /** Position among the comments sharing this address; unset until arranged. */
  order?: number;
}

/** Label definition in a project file */
export interface ProjectLabel {
  /** Stable identity; derived from content when the file omits it. */
  id?: string;
  /** Address (hex string like "$83C1" or number) */
  address: number | string;
  /** Label name */
  name: string;
  /** Label type (default: "address") */
  type?: LabelType;
  /**
   * How many bytes this name covers, when it names an array.
   *
   * An operand inside it renders as `SCREEN_RAM + $000F` rather than a bare
   * address — which is what makes a screen coordinate readable without doing
   * hex arithmetic on every line.
   */
  extent?: number;
  /**
   * Superseded by first-class comments, and read only so an older file does not
   * lose one: the loader turns it into a `before` comment at the same address.
   *
   * It was stored, carried through the model, and rendered nowhere, so a
   * comment could not exist anywhere a label did not — which made commenting an
   * instruction mean inventing a name for it.
   */
  comment?: string;
}

/** Claim definition in a project file */
export interface ProjectRegion {
  /** Stable identity; derived from content when the file omits it. */
  id?: string;
  /** Start address (hex string like "$8000" or number) */
  start: number | string;
  /** End address (exclusive) or length with + prefix */
  end: number | string;
  /** Claim kind */
  kind: LayerDefault;
  /** How to read a `text` region's bytes. Default "ascii". */
  encoding?: TextEncoding;
  /** Optional name/label for the region */
  name?: string;
  /** Optional comment */
  comment?: string;
  /** How to draw a `bitmap` region: `char:8`, `bits:3`, `sprite`. */
  view?: string;
}

/**
 * Project-local identity for immutable content. Layers and captures reference
 * the id; the name is editable metadata and need not be unique.
 */
export interface ProjectFile {
  /** Optional only on legacy imports; all new files carry an id. */
  id?: string;
  /** Display name and filesystem import location; never a document reference. */
  name: string;
  /** Immutable content hash; absent only for unresolved legacy imports. */
  hash?: string;
  size?: number;
}

/**
 * A named view over the layer stack.
 *
 * The answer to a problem that arrived far earlier than expected: a project
 * holding a crunched file *and* the decrunched image it produces can show the
 * bytes as they load or the program as it runs, never both, because the second
 * must shadow the first. Both builders in experiment 5 hit that on roughly
 * their fifth call, and both lost their loader annotations to the shadow.
 *
 * A target is a *view*, not a change to what a layer is. Annotations keep
 * belonging to layers, so they follow activation — which turns a mysterious
 * disappearance into something a reader can name and switch back to.
 *
 * Keyed by name, like a tag and unlike everything in the document that carries
 * an id. The reason ids exist there is that a rename must not change what a
 * thing *is*; a target is chosen by name and referenced by nothing else, so
 * that does not arise.
 */
/** A layer, linked into a target, optionally somewhere other than its own address. */
export interface ProjectLink {
  /**
   * Stable identity, derived from content when a file omits it.
   *
   * A link is a thing the API addresses on its own — "put this layer at $0100
   * in the runtime view", "take it out of the stack" — so editing one must not
   * mean rewriting the list. Without an id the only way to move one layer was a
   * whole-array write, which is last-writer-wins over every other layer in the
   * target.
   */
  id?: string;
  layer: string;
  /** Where it lands in this target. Absent means the layer's own address. */
  at?: number | string;
}

export interface ProjectTarget {
  /**
   * Stable identity, like every other entity here; derived from content when a
   * file omits it.
   *
   * A target used to be keyed by its name, which made it the one thing in this
   * model whose identity could be edited — and a name is a field somebody chose,
   * never an identity. Lookup by name still works and is what tools take, the
   * same way `remove_constant` accepts an unambiguous name; two targets sharing
   * one name is a hygiene finding rather than something the write prevents.
   */
  id?: string;
  name: string;
  /**
   * The layers linked into this target, bottom-up, and where each one lands.
   *
   * A **link**, not an allowlist. The order here is the z-order: the last entry
   * shadows the ones before it, exactly as the project file's own `layers`
   * array reads bottom-up. That is what makes a layer a dumb byte resource —
   * it holds bytes and knows nothing about where it sits, and a target says
   * where.
   *
   * Two things fall out. Reordering the stack becomes `target.set` with a
   * reordered list, which is the operation this file has long documented the
   * *behaviour* of without anything being able to perform it. And a layer can
   * be linked into two targets at two addresses — which is not hypothetical on
   * this machine, since Revenge of the Mutant Camels moves its decruncher onto
   * the stack page and runs the same bytes from somewhere else.
   *
   * A bare string is a link at the layer's own address — the PRG header, or
   * what the layer declares. The object form is for the case where this target
   * puts it somewhere else. Almost every entry is a bare string, which is why
   * that spelling is the short one.
   */
  layers: (string | ProjectLink)[];
  /**
   * Where disassembly starts, beyond what the active layers contribute.
   *
   * This is the project-level `entryPoints` list, moved. A PRG layer's load
   * address stays on the layer, because it is inherent to that file rather
   * than a choice about how to read it; `function` and `code` labels are
   * already layer-owned and follow activation for free.
   */
  entryPoints?: (number | string)[];
  /**
   * Where this sits in the program's life.
   *
   * A target list is a history: the loader, the runtime image it expands into,
   * and on a larger game the levels it pulls in later. The order is the point,
   * and the position in the array was incidental. A plain number, like a
   * comment's, so saying where something goes does not depend on what anybody
   * believed the order was.
   */
  order?: number;
  /**
   * What this phase *is*, in prose.
   *
   * A name carries none of it, and the audience is whoever opens the project
   * next and has to work out why there are three views of the same addresses.
   */
  description?: string;
}

export interface Project {
  /** Project name */
  name?: string;
  /** Project description */
  description?: string;
  /** Memory layers, each owning its labels and regions */
  layers: ProjectLayer[];
  /** The binaries this project reads, by the name its layers use. */
  files?: ProjectFile[];
  /**
   * **Never stored.** Entry points belong to a target; this is where they lived
   * before targets existed, and a file or document still carrying a list here
   * is migrated on the way in — `entryPointsIntoTarget` gives a project with no
   * targets one that holds them, and drops the list where explicit targets
   * already own theirs. In memory it is the *selected* target's list, set by
   * `projectForTarget` for analysis to read, and nothing writes it back out.
   */
  entryPoints?: (number | string)[];
  /** Named views over the layer stack. */
  targets?: ProjectTarget[];
  /** Which target is selected; every layer when unset. */
  /**
   * Which label to show where several share an address, by label id.
   *
   * Keyed by address, so "one primary per address" is structural rather than a
   * flag several labels could each set. Project level rather than per-layer,
   * because two layers can hold labels at the same address.
   *
   * An id that no longer exists means "no primary" and falls back to rank, so
   * deleting a promoted label needs no cleanup.
   */
  primaryLabels?: Record<string, string>;
  /**
   * Names for values, project-wide.
   *
   * A value has no address and no single meaning — the reference disassembly
   * names $01 both LEFT_ZAPPER and WHITE — so these are declarations only.
   * Which one an operand means is recorded per site, in the owning layer.
   */
  constants?: ProjectConstant[];
  /**
   * Which constant each operand site means, and which label. **At the root,
   * framed like a claim.** They lived inside the layer that supplied the
   * bytes, with absolute addresses, so relocating a layer left every binding
   * behind at the old address — and a use that is a fact about one arrangement
   * had no layer to live in at all. A layer-nested list is legacy input now,
   * migrated by `usesToRoot` on the way in.
   */
  constantUses?: ProjectConstantUse[];
  labelUses?: ProjectLabelUse[];
  /**
   * Claims, at project level rather than nested in a layer.
   *
   * Flat because a claim is one entry edited independently: two people revising
   * different claims touch different keys and neither reorders the other's. It
   * is also what lets a claim name an address no layer supplies, which is the
   * whole of what the symbols-layer apparatus existed to work around.
   */
  claims?: ProjectClaim[];
  /**
   * Decoders somebody wrote, for data whose layout is not one of the built-in
   * ones.
   *
   * At project level for the same reason a constant declaration is: it
   * describes no bytes, so there is no layer for it to move with when the stack
   * is reordered. Where it is *used* — a region's `view: "snippet:<id>"` — does
   * belong to a layer, because that is about those bytes.
   */
  decoders?: ProjectDecoder[];
  types?: ProjectType[];
  scenarios?: ProjectScenario[];
  captures?: ProjectCapture[];
  evidence?: ProjectEvidence[];
  /**
   * What was said while the work was done.
   *
   * **In the file, and that is a decision that was made twice.** Chat began as a
   * fifth root the project could not see — "a message describes no bytes,
   * belongs to no layer, and has no place in a `.re64`" — and stayed out of the
   * projection, the export and the operation log by an explicit whitelist.
   *
   * It comes in because a message stopped being a stray and became an entity.
   * The changes feed is built from the operation log, and the socket path
   * derives operations by diffing *projections*; a root outside the projection
   * can reach neither. So a session could not be told that discussion was
   * waiting for it without either putting chat here or building a second
   * mechanism for the one root that is small — and a project handed to somebody
   * else would arrive with its reasoning and without the argument that produced
   * it.
   *
   * Ordering is the content of a conversation, so this is a list and stays a
   * list. In the document it is a `Y.Array`, whose CRDT converges an order
   * without anyone agreeing a clock — the opposite of a field or a binding,
   * where position was masquerading as identity.
   */
  messages?: ProjectMessage[];
}

/**
 * A record layout, as a `.re64` writes it.
 *
 * Fields are an object keyed by offset — `"0"`, `"160"` — which is what the
 * model holds and what JSON can carry directly. No ids on them: two fields
 * cannot share an offset, so the key *is* the identity, and two people adding
 * different fields touch different keys. That is the whole merge property ids
 * exist for elsewhere.
 *
 * Offsets are decimal or hex strings like every other address here.
 */
export interface ProjectType {
  id?: string;
  name: string;
  /** Bytes per record. Holes are legal, so this is declared, not derived. */
  size: number | string;
  /**
   * What a field's offset counts. Bytes unless said otherwise.
   *
   * `size` stays in bytes either way, so a bit record of `size: 1` is one byte
   * with eight offsets in it. Nothing that already reads a size has to know.
   */
  unit?: "bytes" | "bits";
  /**
   * In layout order in the file, keyed by id in the document.
   *
   * A list here because a `.re64` should read the way somebody would have
   * written one — top of the record downwards — and because an offset-keyed
   * object cannot represent two fields at one offset, which is now a state the
   * model tolerates.
   */
  fields: ProjectField[];
}

/**
 * A workflow for the machine: what to do, in order.
 *
 * **A list of typed steps rather than a script**, and that is what makes prefix
 * caching possible at all — you cannot checkpoint inside a running function. It
 * also makes the thing diffable and mergeable, and deterministic by
 * construction. Snippets stay for `bytes → data`, where arbitrary code is the
 * point.
 *
 * The machine a scenario describes is **never stored**. A machine state is
 * derived from these steps and the project's bytes, and this project does not
 * store derived things — so the script is the truth and the machine is a cache
 * keyed on a prefix of it. See `docs/decisions/machine.md`.
 */
export interface ProjectScenario {
  id?: string;
  name: string;
  description?: string;
  /**
   * In order, each carrying an id.
   *
   * Written as one list rather than as separately addressable objects, and the
   * trade is stated rather than hidden: two people revising different steps of
   * one scenario is last-writer-wins over the list. That is right for a script,
   * which is one author's sequence of intentions, and would be wrong for
   * annotations — which is why claims went the other way.
   */
  steps: ProjectStep[];
}

/** One thing to do. The whole vocabulary the machine understands. */
export type ProjectStep =
  /** Begin at an address, or at the address a vector holds. */
  | { id?: string; kind: "start"; at: number | string; vector?: boolean }
  /** Pin registers or memory before running. */
  | {
      id?: string;
      kind: "set";
      registers?: Record<string, number>;
      memory?: Record<string, number>;
    }
  /** Point a joystick. Held until another `input` step changes it. */
  | {
      id?: string;
      kind: "input";
      port: 1 | 2;
      up?: boolean;
      down?: boolean;
      left?: boolean;
      right?: boolean;
      fire?: boolean;
    }
  /**
   * Hold these keys, and release everything else.
   *
   * Its own step rather than a field on `input`, because a keypress has no
   * port: `input` names one of two joystick sockets and every one of its fields
   * is about that socket, where the keyboard is a single matrix the whole
   * machine shares. Folding them together would make `port` meaningless half
   * the time, which is the "passing both, passing neither" pair that `extent`
   * exists to have removed.
   *
   * **Held, not typed**, exactly as a joystick is pointed: the set replaces
   * whatever was down, and `[]` releases. So a keystroke is a press, a run, and
   * a release — which is not ceremony, it is what a program's own debounce is
   * written against. Revenge of the Mutant Camels ignores a key matching the one
   * it has already accepted, so four presses with no releases between them
   * advance its cheat counter exactly once.
   *
   * Names, from `KEY_MATRIX` — `"o"`, `"f1"`, `"run-stop"`. A bare matrix code
   * is accepted for a key the table does not name, and nothing else is: an
   * unknown name is refused rather than pressing nothing, because a typo that
   * quietly held no key looks exactly like a program that ignores the keyboard.
   */
  | {
      id?: string;
      kind: "key";
      keys: (string | number)[];
    }
  /** Run until one of these, whichever comes first. */
  | {
      id?: string;
      kind: "run";
      frames?: number;
      cycles?: number;
      breakpoints?: (number | string)[];
      watchpoints?: { from: number | string; to: number | string; on?: "read" | "write" | "any" }[];
      /** Stop where control leaves the program — what a loader finishes by doing. */
      leaves?: boolean;
      maxInstructions?: number;
    }
  /**
   * Check something, and say whether it held.
   *
   * **This is what makes a scenario a probe.** Both experiment-0 agents asked
   * for the same thing in the same words — evidence as a named, re-runnable
   * check rather than prose:
   *
   * > *"Every check should have been a named, re-runnable probe kept alongside
   * > the artifacts: `probe_scoring.py` asserting the three award values."*
   *
   * > *"The claims and the experiments that back them should have been the same
   * > object... Then 'how I know' is a filename and a line number, the whole
   * > thing re-verifies after any change to the emulator, and my colleague can
   * > trust the emulator because the checks pass rather than because I said so."*
   *
   * Both had run the checks and lost them to shell history, so `findings.md`
   * said "verified in emulation" and the instrumentation was gone. A claim can
   * point at one of these as evidence, and it re-verifies.
   */
  | {
      id?: string;
      kind: "assert";
      /** Addresses that must hold these bytes. */
      memory?: Record<string, number>;
      /** Registers that must hold these values: `A`, `X`, `Y`, `C`, `Z`… */
      registers?: Record<string, number>;
      /** What this is checking, in words, for the report. */
      note?: string;
    }
  /** Keep something. The bytes go to the blob store; a `capture` records it. */
  | {
      id?: string;
      kind: "capture";
      what: "ram" | "screen" | "frames" | "trace" | "sid" | "devices";
      /** For `ram`, the span to keep. */
      from?: number | string;
      to?: number | string;
      /** For `frames`, how many and how far apart. */
      count?: number;
      every?: number;
      /** What to call the file it produces. */
      name: string;
    };

/**
 * Something a run produced, and where it went.
 *
 * An entity because it is addressable — and because a claim's *evidence* will
 * point at one. The bytes are not here: they go through `putBlob`, which is
 * content-addressed and deduped, so the document holds the reference and a
 * capture travels wherever the project travels.
 */
export interface ProjectCapture {
  id?: string;
  /** The scenario that made it, and the step within it. */
  scenario: string;
  step: string;
  kind: "ram" | "screen" | "frames" | "trace" | "sid" | "devices";
  /** The file in this project's store, which is how the bytes are reached. */
  file: string;
  /** Milliseconds since the epoch, supplied by the writer. */
  when?: number;
}

/**
 * Something said *about a claim* rather than about an address.
 *
 * The gap both experiment-0 agents hit and neither could work around. One of
 * them wrote out what they wanted and could not have:
 *
 * > *"I wanted to write `COMMENTS[0x8DF9] = ("contains $3B — so $3B IS drawn",
 * > contradicts="findings.md §7", confidence="certain", by="A")`. Nothing in
 * > either toolchain accepts that shape."*
 *
 * Three things follow from that example and none of them was expressible:
 *
 * **A refutation need not overlap.** `$8DF9` holding `$3B` refutes a claim about
 * the *glyph* `$3B`, at a different address entirely — so `disagreements()`,
 * which sweeps for claims covering the same bytes, could never find it.
 *
 * **A refutation attaches to a claim, not to an address.** The other agent said
 * it exactly: *"it isn't a comment on an address, it's a comment on an
 * interpretation."* A comment at `$19` cannot say "I already tried `SC` and it
 * is wrong", because the thing being refuted is a reading, not a location.
 *
 * **Withdrawing is not deleting.** `remove_claim` destroys; a claim somebody has
 * moved on from is worth keeping with the reason, because *"the wrong model that
 * led to the right place is worth keeping, and prose deliverables silently
 * discard it."* A refutation is how that is said — both claims stand, and the
 * correction is the part with the value.
 */
export interface ProjectEvidence {
  id?: string;
  /** The claim this is about. */
  claim: string;
  kind: EvidenceKind;
  /**
   * Who vouched, and how they know.
   *
   * Flat here, like every other provenance field this file has ever spelled,
   * and on the evidence rather than on the claim because that is what it
   * describes. A claim made by one person is a claim with one of these; a
   * finding two readers reached separately is **one claim with two**, which is
   * the fact the old shape could not hold.
   */
  author?: string;
  /** Milliseconds since the epoch. */
  when?: number;
  /** How this vouching was done — see `ClaimMethod`. */
  method?: ClaimMethod;
  /** A scenario that can be re-run to check it — the strongest form. */
  scenario?: string;
  /** A capture it produced, so the check does not have to be re-run to be read. */
  capture?: string;
  /** Another claim, for a refutation that names what it contradicts. */
  other?: string;
  /** Why, in prose, for the part no reference carries. */
  note?: string;
}

/**
 * What a piece of evidence does to the claim it names.
 *
 * **Three, and one of them is not a judgement about the claim but about the
 * document.** `supports` and `refutes` say whether a reading is right;
 * `retires` says it is no longer part of the working set.
 *
 * `retires` exists because refutation did not solve the problem it looked like
 * it solved. A refuted claim still renders, still competes for the name at its
 * address, still shows up in `claims_at` — so a reader arriving later meets the
 * contradiction with no way to tell which half is live. And making refutation
 * *itself* hide its target would be worse: `disagreements()` reports
 * contradiction and never picks a winner, and one writer refuting another's
 * reading is exactly the case where nobody has won yet.
 *
 * So the two acts are separate. Refuting is "this is wrong, and here is why",
 * and both claims stand and are reported. Retiring is "this is out", and it is
 * an editorial act somebody takes and signs.
 *
 * **Anyone may retire anything.** This was nearly called `withdraws`, and that
 * is wrong for a reason worth keeping: only the author of a claim can withdraw
 * it, and the whole point is that a second reader who finds a claim wrong can
 * take it out of the way without the first one being present.
 *
 * **Retiring is not deleting, and deleting is not destroying.** A retired claim
 * stays in the document with its evidence and its history, so it exports, and
 * review can show it and what took it out. A *removed* claim is gone from the
 * document and lives on in the operations log, where `claim.remove`'s inverse
 * carries the whole of it — which is the right answer for a claim entered by
 * mistake, and the wrong one for a reading somebody honestly held.
 *
 * **This is not `supersedes` coming back.** That one was removed rather than
 * fixed: it stored an *ordering* between two claims, and an ordering is the one
 * thing a conflict-free merge cannot supply — two peers offline could each
 * supersede the same claim with a different replacement and the document
 * converged on two parallel supersessions with nothing to break the tie. And
 * that key already existed: **`primaryLabels` is "which reading is current"**,
 * one entry per address, last writer wins, and read by the renderer, which
 * `supersedes` never was. `retires` is a *unary* predicate on one claim. Two
 * peers retiring the same claim converge on two records that agree, and a
 * retirement names no order, no chain and no replacement it has to be
 * consistent with. It may carry `other` to point at what replaced it, but
 * nothing reads that as a ranking.
 *
 * Retirement is **derived, never stored**: a claim is retired when a live
 * `retires` record names it, and restoring it is removing that record. There is
 * no flag to keep in sync with the evidence, which is the same rule the rest of
 * the model follows — nothing resolves at rest.
 */
export type EvidenceKind =
  /** Backs it up. */
  | "supports"
  /** Says it is wrong, and by what. */
  | "refutes"
  /** Takes it out of the working set, keeping it and the reason in the document. */
  | "retires";

/**
 * One thing somebody said, with an id like everything else here.
 *
 * `author` is who, `name` is how they were called *then* — stored rather than
 * resolved on read, because a log records what was said and who said it at the
 * time, and looking the name up later would rewrite history on every rename.
 */
export interface ProjectMessage {
  id?: string;
  /** Milliseconds since the epoch, taken on the poster's machine. */
  at: number;
  author: string;
  name: string;
  text: string;
}

export interface ProjectField {
  /**
   * Stable identity, derived from content when a file omits it.
   *
   * **And the key the document stores it under**, which took two goes. Fields
   * were keyed by offset, argued on the grounds that two cannot share one so the
   * key *is* the identity. That is true of one writer and false of two: giving
   * the object an `id` while the storage stayed offset-keyed meant a move was
   * still a delete plus a create, so two readers moving one field to different
   * offsets produced **two fields carrying one id** — and `field.remove` then
   * took away one of them and left the other.
   *
   * Keyed by id, an offset is what it always was: a property. Two fields at one
   * offset both stand and are a hygiene finding, exactly as two claims at one
   * address are, and different readings of the same bytes is a thing this model
   * keeps rather than prevents.
   */
  id?: string;
  /** Into the record, in its own unit: bytes, or bits when the type says so. */
  offset: number;
  name: string;
  /**
   * `u8`, `i8`, `u16`, `u16be`, `ptr`, `ptrbe`, `char(n)`, `char(n,screen)`,
   * `bytes(n)`, or the name of another type.
   *
   * One string rather than a discriminated object, for the reason `view` is one
   * string: a format and its parameters are one rendering choice, and splitting
   * them would thread three fields through the schema, the serializer, the CRDT
   * assignment, the op, the diff, the inverse and four signatures.
   */
  type: string;
  description?: string;
}

export interface ProjectConstant {
  id?: string;
  name: string;
  /** 8-bit value, as a number or "$1F". */
  value: number | string;
}

/**
 * A claim, as a `.re64` writes it.
 *
 * Flat rather than nested, for two reasons. It matches how every other entry in
 * this format is written — a region is `{start, end, kind, encoding?, view?}`,
 * not `{span: {...}, reads: {...}}` — and it is the same shape the CRDT already
 * encodes, so one representation serves the file and the document instead of two
 * that can drift.
 *
 * The cost is that `says` and `by` are spelled across several keys, which a
 * diff actually prefers: changing an encoding touches one line.
 */
export interface ProjectClaim {
  id?: string;
  /** Where. An address, or an offset into a layer when `layer` is set. */
  at: number | string;
  /** How many bytes it covers. Absent means a point. */
  extent?: number;
  name?: string;
  /** What the bytes are. Absent says nothing about them; never "code". */
  is?: Interpretation["is"];
  /** How to read a `text` claim's bytes. */
  encoding?: TextEncoding;
  /** How to draw a `bitmap` claim: `char:8`, `bits:3`, `sprite`, `snippet:<id>`. */
  view?: string;
  /**
   * Which layout a `record` claim is an array of.
   *
   * Spelled flat beside `is`, like `encoding` and `view`, for the reason this
   * whole shape exists: `says` is several keys in the file so that changing one
   * touches one line of a diff.
   */
  typeId?: string;
  /** Surface this regardless of what reaches it. */
  root?: RootKind;
  /** What the name means, where somebody other than this project decided. */
  description?: string;
  /**
   * The target this claim belongs to, when no layer supplies its bytes.
   *
   * Zero-page variables, I/O registers, anything about an address the program
   * uses but no file provides. Absolute, because a target *is* an address
   * space — only a layer frame is relocatable.
   */
  target?: string;
  /**
   * Machinery or judgement.
   *
   * All that is left of the old flat provenance here. **Who** made it and
   * **how they know** are properties of an act of vouching rather than of the
   * claim, so they live on an evidence entry that names this claim — which is
   * what lets two readers who reached the same finding share one claim instead
   * of producing two that cannot be merged without losing an author.
   */
  origin?: ClaimOrigin;
  /** The layer `at` is an offset into, for a claim that follows its bytes. */
  layer?: string;
}

/**
 * The claims a live `retires` record names.
 *
 * Derived on every read rather than cached, which is affordable because the
 * evidence root is small and correct because there is then nothing to
 * invalidate. Restoring a claim is removing the record, and this sees that
 * immediately with no second place to update.
 */
export function retiredClaimIds(
  evidence: readonly Pick<ProjectEvidence, "claim" | "kind">[] = []
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const item of evidence) if (item.kind === "retires") out.add(item.claim);
  return out;
}

/**
 * `ProjectClaim[]` to `Claim[]`.
 *
 * Ids are derived from content when absent, like every other entry here, so all
 * clients loading the same un-migrated file agree — and the next write persists
 * real ones.
 */
export function projectClaims(claims: readonly ProjectClaim[] = []): Claim[] {
  return claims.map((c) => {
    const at = parseProjectAddress(c.at);
    const says: Interpretation | undefined =
      c.is === "text"
        ? // A text claim carries a view too: a program with its own character
          // set is unreadable by any built-in encoding, so `snippet:<id>` is the
          // only way such a span is legible. Dropped here, a decoder could be
          // defined and run and never attached to the text it decodes.
          { is: "text", encoding: c.encoding, view: c.view }
        : c.is === "bitmap"
          ? { is: "bitmap", view: c.view }
          : c.is === "record" && c.typeId
            ? { is: "record", typeId: c.typeId }
            : c.is === "data" || c.is === "jumptable"
              ? { is: c.is }
              : undefined;

    return {
      id: c.id ?? derivedId("clm", String(at), c.name ?? "", c.is ?? ""),
      at,
      ...(c.extent !== undefined ? { extent: c.extent } : {}),
      ...(c.name !== undefined ? { name: c.name } : {}),
      ...(says ? { says } : {}),
      ...(c.root !== undefined ? { root: c.root } : {}),
      ...(c.description !== undefined ? { description: c.description } : {}),
      ...(c.layer !== undefined
        ? { frame: { space: "layer" as const, layer: c.layer } }
        : c.target !== undefined
          ? { frame: { space: "target" as const, target: c.target } }
          : {}),
      origin: c.origin ?? "user",
    };
  });
}

/**
 * Valid values for the string-typed fields a project file can set.
 *
 * These are user-written, so they are checked here rather than deeper down:
 * a typo should name the offending region, not surface as a crash inside the
 * render walk.
 */
/** What a legacy region's kind says about its bytes, where it says anything. */
const IS_FOR_LEGACY_KIND: Partial<Record<LegacyRegionKind, Interpretation["is"]>> = {
  data: "data",
  text: "text",
  jumptable: "jumptable",
  bitmap: "bitmap",
};

const REGION_KINDS: readonly LegacyRegionKind[] = [
  "code",
  "data",
  "text",
  "jumptable",
  "bitmap",
  "unknown",
];
const LABEL_TYPES: readonly LabelType[] = ["entry", "function", "code", "address"];
const INTERPRETATIONS: readonly Interpretation["is"][] = [
  "data",
  "text",
  "bitmap",
  "jumptable",
  "record",
];
const ROOT_KINDS: readonly RootKind[] = ["entry", "routine", "location", "data"];
const CLAIM_ORIGINS: readonly ClaimOrigin[] = [
  "user",
  "layer",
  "platform",
  "auto",
  "analysis",
];

/** Parse an address that may be a number or hex string */
export function parseProjectAddress(value: number | string): number {
  if (typeof value === "number") {
    return value;
  }
  const str = value.trim();
  if (str.startsWith("$")) {
    return parseInt(str.slice(1), 16);
  }
  if (str.startsWith("0x")) {
    return parseInt(str.slice(2), 16);
  }
  return parseInt(str, 10);
}

/**
 * A layer's own declared labels, as claims.
 *
 * Almost always empty: migration lifts a file's layer labels into project-level
 * claims before this is reached, which is why the conversion is one shape now
 * rather than two. It stays because a layer may still be constructed with them
 * directly, and because a label without an id gets one derived from its layer,
 * address and name — so every client loading the same un-migrated file agrees
 * on it, and the next write persists a real one.
 */
export function projectLabelsToLabels(
  projectLabels: ProjectLabel[],
  layerId: string
): Claim[] {
  return projectLabels.map((pl) => {
    const at = parseProjectAddress(pl.address);
    const root = ROOT_FOR_LABEL_TYPE[pl.type ?? "address"];
    return {
      id: pl.id ?? derivedId("lbl", layerId, at, pl.name),
      at,
      name: pl.name,
      ...(root ? { root } : {}),
      ...(pl.extent === undefined ? {} : { extent: pl.extent }),
      origin: "user" as const,
    };
  });
}

/** The root a declared label type asks for; `address` asks for none. */
const ROOT_FOR_LABEL_TYPE: Partial<Record<LabelType, RootKind>> = {
  entry: "entry",
  function: "routine",
  code: "location",
};

/**
 * Convert project comments to Comment objects.
 *
 * A legacy `comment` on a label becomes a `before` comment at its address, so
 * an older file keeps what it said rather than dropping it silently.
 */
export function projectCommentsToComments(
  layer: ProjectLayer,
  layerId: string
): Comment[] {
  const comments = (layer.comments ?? []).map((pc) => {
    const address = parseProjectAddress(pc.address);
    const placement = pc.placement ?? "before";
    const id = pc.id ?? derivedId("cmt", layerId, address, placement);
    return createComment(id, address, placement, pc.text, pc.order);
  });

  for (const label of layer.labels ?? []) {
    if (!label.comment) continue;
    const address = parseProjectAddress(label.address);
    comments.push(
      createComment(
        derivedId("cmt", layerId, address, "from-label"),
        address,
        "before",
        label.comment
      )
    );
  }

  return comments;
}

/** The constant uses in a view, as the index takes them: absolute. */
export function projectConstantUses(
  project: Project,
  layerStart: (id: string) => number | undefined,
  selectedTarget: string | undefined,
  layerRank?: (id: string) => number | undefined
): ConstantUse[] {
  return resolvedUses(project.constantUses ?? [], layerStart, selectedTarget, layerRank).map(
    ({ use, address }) =>
      createConstantUse(use.id ?? derivedId("cst", useKey(use), "use"), address, use.constant)
  );
}

/** The label uses in a view, as the index takes them: absolute. */
export function projectLabelUses(
  project: Project,
  layerStart: (id: string) => number | undefined,
  selectedTarget: string | undefined,
  layerRank?: (id: string) => number | undefined
): LabelUse[] {
  return resolvedUses(project.labelUses ?? [], layerStart, selectedTarget, layerRank).map(
    ({ use, address }) =>
      createLabelUse(use.id ?? derivedId("lbl", useKey(use), "use"), address, use.label)
  );
}

/**
 * A use's site, frame included: `layer:lay_a:$0123`, `target:tgt_b:$8123`,
 * `address::$8123`. A layer offset and a target address with the same number
 * are not one site, which is why the frame is part of the key.
 */
export function useKey(use: { at: number | string; layer?: string; target?: string }): string {
  const frame = useFrame(use);
  const at = parseProjectAddress(use.at);
  const hex = `$${at.toString(16).toUpperCase().padStart(4, "0")}`;
  if (frame.space === "layer") return `layer:${frame.layer}:${hex}`;
  if (frame.space === "target") return `target:${frame.target}:${hex}`;
  return `address::${hex}`;
}

export function projectConstants(constants: readonly ProjectConstant[] = []): Constant[] {
  return constants.map((c) => {
    const value = parseProjectAddress(c.value);
    return createConstant(c.id ?? derivedId("cst", c.name, value), c.name, value);
  });
}

/** Convert project regions to Claim objects */
export function projectRegionsToRegions(
  projectRegions: ProjectRegion[],
  layerId: string
): Claim[] {
  return projectRegions.map((pr) => {
    const start = parseProjectAddress(pr.start);
    let end: number;

    // Support "end" as either absolute address or "+length" format
    if (typeof pr.end === "string" && pr.end.startsWith("+")) {
      const length = parseProjectAddress(pr.end.slice(1));
      end = start + length;
    } else {
      end = parseProjectAddress(pr.end);
    }

    const id = pr.id ?? derivedId("rgn", layerId, start, pr.kind);
    const is = IS_FOR_LEGACY_KIND[pr.kind];
    return {
      id,
      at: start,
      extent: end - start,
      ...(pr.name === undefined ? {} : { name: pr.name }),
      // `code` and `unknown` are not things a claim says. A `code` region asked
      // for its bytes to be decoded, which is a root; `unknown` asked for
      // nothing, which is a claim that says nothing at all.
      ...(is === undefined
        ? pr.kind === "code"
          ? { root: "location" as const }
          : {}
        : {
            says: {
              is,
              ...(is === "text" && pr.encoding ? { encoding: pr.encoding } : {}),
              ...((is === "text" || is === "bitmap") && pr.view ? { view: pr.view } : {}),
            } as Interpretation,
            root: "data" as const,
          }),
      origin: "user" as const,
    };
  });
}

/** Load and parse a project file */
/**
 * A type's fields as a list, whatever shape they arrived in.
 *
 * **One migration, reached from four places.** Every file written before fields
 * were keyed by id spells them as an object keyed by offset, and the entry
 * points take a project from a file *and* from memory — `parseProject`,
 * `docFromProject`, `formatProject` and the loader. The key becomes the `offset`
 * property it always described; the next write persists a list.
 *
 * **And it gives the field an id**, which is the half that was missing and cost
 * every field in such a file: `typeMapFrom` keys the inner map by id and skipped
 * anything without one, so a legacy record reached the document with no fields at
 * all. Converting the shape is not the migration — the identity is.
 *
 * Derived rather than minted, for the reason `derivedId` exists: two clients
 * loading one un-migrated file must agree, or merge sees two fields where the
 * file has one. `type.add` and the loader already derive `fld` from the same
 * two parts, so a field converted here and the same field declared there are
 * one identity rather than two.
 */
export function fieldsOfType(type: { id?: string; fields: unknown }): ProjectField[] {
  const held = type.fields;
  const withId = (field: ProjectField): ProjectField =>
    field.id ? field : { ...field, id: derivedId("fld", type.id ?? "", field.offset) };
  if (Array.isArray(held)) return (held as ProjectField[]).map(withId);
  return Object.entries((held ?? {}) as Record<string, ProjectField>)
    .map(([offset, field]) => withId({ ...field, offset: Number(offset) }))
    .sort((a, b) => a.offset - b.offset);
}

/**
 * A project-level `entryPoints` list becomes a target's.
 *
 * The root list predates targets. `withSyntheticTarget` copied it into the
 * implied target on every load, `describe_project` read it, and no operation
 * could write it — data with readers and no verb, which is F1 from the other
 * end. It was a target's field stored in the wrong place, so this puts it in the
 * right one rather than giving it a second home: a project with no targets gains
 * one holding the list, linking every byte layer in declaration order under the
 * same derived ids the loader hands out; a project that declares targets keeps
 * theirs and the root list is dropped, since an explicit target already used its
 * own. Reached from every boundary a project enters through, like the field
 * migration, so an in-memory project built by a test gets the same treatment as
 * a file.
 */
export function entryPointsIntoTarget(project: Project): Project {
  const { entryPoints, ...rest } = project;
  if (!entryPoints?.length) return entryPoints === undefined ? project : rest;
  if (project.targets?.length) return rest;
  const name = project.name ?? "project";
  return {
    ...rest,
    targets: [
      {
        id: derivedId("tgt", "entryPoints", name),
        name,
        layers: project.layers
          .map((l, index) => ({ decl: l, id: layerIdOf(l, index) }))
          .filter(({ decl }) => decl.type !== "symbols")
          .map(({ id }) => id),
        entryPoints,
      },
    ],
  };
}

/** The frame a stored use carries, spelled flat in the file like a claim's. */
export function useFrame(use: { layer?: string; target?: string }): Frame {
  if (use.layer !== undefined) return { space: "layer", layer: use.layer };
  if (use.target !== undefined) return { space: "target", target: use.target };
  return { space: "address" };
}

/** The flat spelling of a frame on a use, the way the file and document hold it. */
export function useFrameFields(frame: Frame): { layer?: string; target?: string } {
  if (frame.space === "layer") return { layer: frame.layer };
  if (frame.space === "target") return { target: frame.target };
  return {};
}

/**
 * Bindings move to the root and gain a frame — **where their layer's placement
 * is known**, and not before.
 *
 * A use nested in a layer, with an absolute address, is the legacy form and it
 * carried two facts: the site, and the *owner* — the layer it lived in decided
 * whether it showed at all, and kept it apart from another layer's binding at
 * the same address. Lifting it to the address space would keep the first fact
 * and lose the second, so a nested use becomes a **layer-framed** use with the
 * offset `address - placement`, which says both things the old record said. A
 * use in a symbols layer — the layers `ensureOwningLayer` made to hold
 * zero-page bindings — owns no bytes and becomes address-framed, which is what
 * `placed()` gives an unowned byte today.
 *
 * The placement is the one thing this needs, and for a `.prg` it is inside the
 * file's bytes: `parseProject` does not have them, a stored snapshot's
 * migration does not have them, and converting where they happen to be
 * available would make one document mean two things depending on which
 * boundary opened it first. So this takes a resolver, converts what it can, and
 * **leaves the rest nested** for a boundary that knows more — the loader, which
 * has every placement once the layers have landed, and the store, which reads
 * the recorded bytes when it opens. A root record still spelled with a legacy
 * `address` is address-framed, as it always was.
 */
/**
 * Where a nested binding is, in frames: the site a legacy `layerId` and
 * absolute `address` mean once the layer's placement is known. Undefined where
 * it is not, and the caller leaves the record — or the operation — as it was.
 * One rule for `usesToRoot`, the store's migration and the operations recorded
 * before frames, so the three agree on which site a moved binding became.
 */
export function legacySiteOf(
  project: Project,
  layerStart: (id: string) => number | undefined
): (layerId: string, address: number) => { frame: Frame; at: number } | undefined {
  const types = new Map(project.layers.map((layer, index) => [layerIdOf(layer, index), layer.type] as const));
  return (layerId, address) => {
    const type = types.get(layerId);
    if (type === undefined) return undefined;
    if (type === "symbols") return { frame: { space: "address" }, at: address };
    const start = layerStart(layerId);
    return start === undefined ? undefined : { frame: { space: "layer", layer: layerId }, at: address - start };
  };
}

export function usesToRoot(
  project: Project,
  layerStart: (id: string) => number | undefined
): Project {
  const siteOf = legacySiteOf(project, layerStart);
  let changed = false;
  const lifted = <T extends { address?: number | string; at?: number | string }>(
    use: T
  ): Omit<T, "address"> & { at: number | string } => {
    if (use.address === undefined) return use as Omit<T, "address"> & { at: number | string };
    changed = true;
    const { address, ...rest } = use;
    return { ...rest, at: rest.at ?? address } as Omit<T, "address"> & { at: number | string };
  };
  const constantUses = [...(project.constantUses ?? []).map(lifted)];
  const labelUses = [...(project.labelUses ?? []).map(lifted)];
  const layers = project.layers.map((layer, index) => {
    if (!layer.constantUses && !layer.labelUses) return layer;
    const id = layerIdOf(layer, index);
    if (siteOf(id, 0) === undefined) return layer; // not placeable here: stays nested
    changed = true;
    const framed = <T extends { address: number | string }>(use: T) => {
      const site = siteOf(id, parseProjectAddress(use.address))!;
      const { address, ...rest } = use;
      void address;
      return { ...rest, at: site.at, ...useFrameFields(site.frame) } as unknown as Omit<T, "address"> & {
        at: number;
        layer?: string;
      };
    };
    const { constantUses: nested, labelUses: nestedLabels, ...rest } = layer;
    for (const use of nested ?? []) constantUses.push(framed(use) as ProjectConstantUse);
    for (const use of nestedLabels ?? []) labelUses.push(framed(use) as ProjectLabelUse);
    return rest;
  });
  if (!changed) return project;
  return {
    ...project,
    layers,
    ...(constantUses.length ? { constantUses } : {}),
    ...(labelUses.length ? { labelUses } : {}),
  };
}

/**
 * How specific a use's frame is: the address space, then a layer, then one
 * arrangement. Where two uses resolve to one address in a view, the more
 * specific one is what the view shows — and it is what `unbind` takes away,
 * so the two cannot disagree.
 */
export function frameSpecificity(use: { layer?: string; target?: string }): number {
  return use.target !== undefined ? 2 : use.layer !== undefined ? 1 : 0;
}

/**
 * The uses that are in a view, at the addresses they resolve to there.
 *
 * The same rule a claim follows, through the same `resolveAt`: a layer-framed
 * use is at its layer's placement plus its offset and is absent when the layer
 * is not linked; a target-framed use is present only in that target; an
 * address-framed use is where it says.
 */
export function resolvedUses<T extends { at: number | string; layer?: string; target?: string }>(
  uses: readonly T[],
  layerStart: (id: string) => number | undefined,
  selectedTarget: string | undefined,
  /**
   * Where a layer sits in the view's stack, bottom first. Two layer-framed
   * uses at one address are two layers' bindings, and the one on top is what
   * shows — the rule bytes already follow — rather than whichever the
   * document happened to list first.
   */
  layerRank: (id: string) => number | undefined = () => undefined
): { use: T; address: number }[] {
  const out: { use: T; address: number }[] = [];
  for (const use of uses) {
    const frame = useFrame(use);
    if (frame.space === "target" && frame.target !== selectedTarget) continue;
    const address = resolveAt(parseProjectAddress(use.at), frame, layerStart);
    if (address !== undefined) out.push({ use, address });
  }
  // Least specific first, then lowest layer first, so an index that keeps the
  // last binding at an address keeps the most specific one on the topmost
  // layer, and a reader taking the last match agrees.
  const rank = (use: T): number => (use.layer === undefined ? 0 : (layerRank(use.layer) ?? 0));
  return out
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        frameSpecificity(a.entry.use) - frameSpecificity(b.entry.use) ||
        rank(a.entry.use) - rank(b.entry.use) ||
        a.index - b.index
    )
    .map(({ entry }) => entry);
}

export function parseProject(json: string): Project {
  const project = entryPointsIntoTarget(JSON.parse(json) as Project);

  // **A record's fields used to be an object keyed by offset.** Every file
  // written before they were keyed by id says so, and they stay loadable: the
  // key becomes the `offset` property it always described, and the next write
  // persists a list. The same latitude ids get everywhere here.
  for (const type of project.types ?? []) type.fields = fieldsOfType(type);

  // Validate required fields
  if (!project.layers || !Array.isArray(project.layers)) {
    throw new Error("Project must have a 'layers' array");
  }

  for (const layer of project.layers) {
    if (!layer.type) {
      throw new Error("Each layer must have a 'type' field");
    }
    if (layer.type === "prg" || layer.type === "raw") {
      if (!layer.path && !layer.file) {
        throw new Error(`Layer type '${layer.type}' requires a 'path' field`);
      }
    }
    if (layer.type === "raw" && layer.address === undefined) {
      throw new Error("Layer type 'raw' requires an 'address' field");
    }
    if (layer.type === "bytes") {
      if (!layer.bytes) {
        throw new Error("Layer type 'bytes' requires a 'bytes' field");
      }
      if (layer.address === undefined) {
        throw new Error("Layer type 'bytes' requires an 'address' field");
      }
    }
    if (layer.type === "symbols") {
      // An empty symbols layer used to be refused, on the grounds that a layer
      // contributing nothing is almost always a mistake. That stopped being
      // true once one could be created deliberately: `add_layer` makes an empty
      // one to be filled, and naming an address that no layer owns creates one
      // in the same action as the label going into it. It supplies no bytes and
      // no names, so it is inert rather than wrong.
      // A symbols layer supplies no bytes, so a region on one says how to read
      // something that is not there. Dropped rather than refused: this used to
      // throw, and a single accepted write could put a region here and leave
      // the project unopenable — unwritable through the agent API, the HTTP
      // API and the CLI alike, with no way back. Refusing the *write* is the
      // fix; refusing to load is how the damage became permanent.
      if (layer.regions?.length) delete layer.regions;
    }
  }

  for (const [index, layer] of project.layers.entries()) {
    const where = layer.path ?? layer.name ?? `layer ${index}`;

    for (const region of layer.regions ?? []) {
      if (!REGION_KINDS.includes(region.kind)) {
        throw new Error(
          `Unknown region kind "${region.kind}" at ${String(region.start)} in ${where}. ` +
            `Expected one of: ${REGION_KINDS.join(", ")}`
        );
      }
      // Unvalidated until now, and `decodeText` used to fall through to ASCII,
      // so a typo like "petsci" was accepted, written back, and rendered as
      // confident nonsense with nothing said anywhere.
      if (region.encoding !== undefined && !TEXT_ENCODINGS.includes(region.encoding)) {
        throw new Error(
          `Unknown text encoding "${region.encoding}" at ${String(region.start)} in ${where}. ` +
            `Expected one of: ${TEXT_ENCODINGS.join(", ")}`
        );
      }
    }

    for (const label of layer.labels ?? []) {
      if (label.type !== undefined && !LABEL_TYPES.includes(label.type)) {
        throw new Error(
          `Unknown label type "${label.type}" for "${label.name}" in ${where}. ` +
            `Expected one of: ${LABEL_TYPES.join(", ")}`
        );
      }
    }
  }

  // The flat top-level form was replaced by per-layer ownership. Fail loudly
  // rather than silently ignoring annotations the user expects to see.
  const legacy = project as { labels?: unknown; regions?: unknown };
  if (legacy.labels !== undefined || legacy.regions !== undefined) {
    throw new Error(
      "Top-level 'labels'/'regions' are no longer supported: move them into the " +
        "owning layer, or into a layer of type 'symbols' for addresses with no bytes"
    );
  }

  // Claims carry three enum-valued fields, and they are user-written. Checked
  // here for the reason the region kinds are: a typo should name the offending
  // claim, not surface as confident nonsense in a listing. `encoding: "petsci"`
  // was accepted, written back and rendered as ASCII for exactly as long as
  // nothing checked it.
  for (const claim of project.claims ?? []) {
    const where = `claim at ${String(claim.at)}`;
    if (claim.is !== undefined && !INTERPRETATIONS.includes(claim.is)) {
      throw new Error(
        `Unknown interpretation "${claim.is}" on ${where}. ` +
          `Expected one of: ${INTERPRETATIONS.join(", ")}. ` +
          `Note there is no "code": code is what bytes are when nobody has said otherwise.`
      );
    }
    // A record without a layout is a claim that says "these are records" and
    // cannot say of what, which renders nothing. Checked here rather than left
    // to the row builder, because a file is user-written and a typo should name
    // the claim rather than surface as an empty span.
    if (claim.is === "record" && !claim.typeId) {
      throw new Error(`A record ${where} needs a typeId: which layout it is an array of.`);
    }
    if (claim.root !== undefined && !ROOT_KINDS.includes(claim.root)) {
      throw new Error(
        `Unknown root "${claim.root}" on ${where}. Expected one of: ${ROOT_KINDS.join(", ")}`
      );
    }
    if (claim.encoding !== undefined && !TEXT_ENCODINGS.includes(claim.encoding)) {
      throw new Error(
        `Unknown text encoding "${claim.encoding}" on ${where}. ` +
          `Expected one of: ${TEXT_ENCODINGS.join(", ")}`
      );
    }
    if (claim.origin !== undefined && !CLAIM_ORIGINS.includes(claim.origin)) {
      throw new Error(
        `Unknown origin "${claim.origin}" on ${where}. ` +
          `Expected one of: ${CLAIM_ORIGINS.join(", ")}`
      );
    }
  }

  return filesWithIds(project);
}

/**
 * A target's links, in z-order, whatever spelling the file used.
 *
 * One reader for both forms, so nothing downstream has to know that a bare
 * string is the common case.
 */
export function targetLinks(
  target: ProjectTarget
): { id: string; layer: string; at?: number }[] {
  return target.layers.map((entry) =>
    typeof entry === "string"
      ? { id: derivedId("lnk", entry), layer: entry }
      : {
          id: entry.id ?? derivedId("lnk", entry.layer),
          layer: entry.layer,
          ...(entry.at === undefined ? {} : { at: parseProjectAddress(entry.at) }),
        }
  );
}

