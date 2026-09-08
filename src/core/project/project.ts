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
import { derivedId } from "./identity.js";
import { Claim, Interpretation, Provenance, RootKind } from "../claims/model.js";

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
  /** File path (for prg/raw) */
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
  constantUses?: ProjectConstantUse[];
  /** Operands in this layer that mean one particular label */
  labelUses?: ProjectLabelUse[];
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
  address: number | string;
  label: string;
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
  address: number | string;
  /** The declared constant's id. Dangling means "render the literal". */
  constant: string;
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

/** Project file structure */
/**
 * A file the project uses, by the name its layers refer to.
 *
 * Bytes live in the blob store, content-addressed and shared between projects;
 * this is the project-local name for one, and the hash is what makes the
 * export say *which* bytes the annotations were made against. Without it a
 * `.re64` reads `"path": "gridrunner.prg"` and cannot tell you whether the
 * binary beside it is the one somebody named these addresses in.
 *
 * Project level rather than per-layer, for the same reason a constant
 * declaration is: several layers can read the same disk image, and a file
 * describes no addresses of its own.
 */
export interface ProjectFile {
  /** What layers call it: `revenge.d64`, and `revenge.d64:NAME` inside one. */
  name: string;
  /** Content hash of the bytes, as the blob store holds them. */
  hash: string;
  size: number;
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
   * Manual entry points (addresses).
   *
   * The default target's list. A project that declares targets puts them there
   * instead, so the same field does not mean two things.
   */
  entryPoints?: (number | string)[];
  /** Named views over the layer stack. */
  targets?: ProjectTarget[];
  /** Which target is selected; every layer when unset. */
  defaultTarget?: string;
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
  fields: Record<string, ProjectField>;
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
 * **Withdrawing is not deleting.** `remove_claim` destroys; a claim that was
 * superseded is worth keeping with the reason, because *"the wrong model that
 * led to the right place is worth keeping, and prose deliverables silently
 * discard it."*
 */
export interface ProjectEvidence {
  id?: string;
  /** The claim this is about. */
  claim: string;
  kind: EvidenceKind;
  /** A scenario that can be re-run to check it — the strongest form. */
  scenario?: string;
  /** A capture it produced, so the check does not have to be re-run to be read. */
  capture?: string;
  /** Another claim, for `refutes` and `supersedes`. */
  other?: string;
  /** Why, in prose, for the part no reference carries. */
  note?: string;
}

/** What a piece of evidence does to the claim it names. */
export type EvidenceKind =
  /** Backs it up. */
  | "supports"
  /** Says it is wrong, and by what. */
  | "refutes"
  /** Replaces it: an earlier reading that led somewhere, kept rather than deleted. */
  | "supersedes";

export interface ProjectField {
  /**
   * Stable identity, derived from content when a file omits it.
   *
   * Fields used to be keyed by offset alone, argued on the grounds that two
   * fields cannot share one so the key *is* the identity. True of the storage,
   * and not enough for the API: an offset is a **property** of a field and a
   * reader who has just worked out that a record is laid out differently is
   * changing it, which under offset-keying is a delete plus a create — losing
   * the description and everything else somebody wrote.
   *
   * The cost is stated rather than hidden: offset keys made two readers adding
   * different fields merge for free, and two adding a field at the *same*
   * offset now both stand. That is a hygiene finding, exactly as two claims at
   * one address are, and it is the trade this project makes everywhere else.
   */
  id?: string;
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
  /** Who made it: a user id, an agent codename, or `cli`. */
  author?: string;
  /** How it arose. */
  source?: Provenance["source"];
  /** Milliseconds since the epoch. */
  when?: number;
  /** How strongly it is meant. Absent means asserted. */
  method?: Provenance["method"];
  /** The layer `at` is an offset into, for a claim that follows its bytes. */
  layer?: string;
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
      by: {
        author: c.author ?? "project",
        source: c.source ?? "user",
        ...(c.when !== undefined ? { when: c.when } : {}),
        ...(c.method !== undefined ? { method: c.method } : {}),
      },
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
const PROVENANCE_SOURCES: readonly Provenance["source"][] = [
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
      by: { author: "project", source: "user" as const },
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

/** Convert a layer's constant uses to ConstantUse objects. */
export function projectConstantUses(layer: ProjectLayer, layerId: string): ConstantUse[] {
  return (layer.constantUses ?? []).map((u) => {
    const address = parseProjectAddress(u.address);
    return createConstantUse(u.id ?? derivedId("cst", layerId, address, "use"), address, u.constant);
  });
}

/** Convert project constants to Constant objects. */
/** Convert a layer's label uses to LabelUse objects. */
export function projectLabelUses(layer: ProjectLayer, layerId: string): LabelUse[] {
  return (layer.labelUses ?? []).map((u) => {
    const address = parseProjectAddress(u.address);
    return createLabelUse(u.id ?? derivedId("lbl", layerId, address, "use"), address, u.label);
  });
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
      by: { author: "project", source: "user" as const },
    };
  });
}

/** Load and parse a project file */
export function parseProject(json: string): Project {
  const project = JSON.parse(json) as Project;

  // Validate required fields
  if (!project.layers || !Array.isArray(project.layers)) {
    throw new Error("Project must have a 'layers' array");
  }

  for (const layer of project.layers) {
    if (!layer.type) {
      throw new Error("Each layer must have a 'type' field");
    }
    if (layer.type === "prg" || layer.type === "raw") {
      if (!layer.path) {
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
    if (claim.source !== undefined && !PROVENANCE_SOURCES.includes(claim.source)) {
      throw new Error(
        `Unknown source "${claim.source}" on ${where}. ` +
          `Expected one of: ${PROVENANCE_SOURCES.join(", ")}`
      );
    }
  }

  return project;
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

