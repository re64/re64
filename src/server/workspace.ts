/**
 * One project, analysed and editable, for consumers that are not a browser.
 *
 * The browser analyses locally so a rename is instant, and that stays true.
 * This exists for the agent-facing surface, which has no document of its own
 * and cannot hold a socket — so the server answers its questions instead.
 *
 * All the logic lives here and is tested without a network. Whatever protocol
 * sits above it should be schemas and shapes only.
 */

import { dirname } from "node:path";
import {
  AnalysisResult,
  LabelType,
  LoadedProject,
  Op,
  ProgramAnalysis,
  Reference,
  Row,
  BasicBlock,
  BlockRun,
  analyze,
  analyzeProgram,
  analyzeRoutines,
  routineAt,
  targetsOf,
  Effects,
  EffectGap,
  RoutineEffects,
  describeGap,
  blockAt,
  blockEffects,
  describeEffects,
  formatVarnode,
  runBlock,
  REGISTER_NAMES,
  Bitmap,
  bitmapToText,
  fieldValue,
  bytesPerCell,
  cellCount,
  decodeBitmap,
  parseBitmapView,
  encodePng,
  encodeApng,
  encodeWav,
  blobPaths,
  isBitmapView,
  buildMemoryMap,
  describeOp,
  labelDeleteOp,
  labelDeleteByIdOp,
  projectLabelsAt,
  commentDeleteOp,
  commentAddOp,
  commentEditOp,
  ensureOwningLayer,
  labelAddOp,
  claimAddOps,
  owningLayerId,
  ownsAddress,
  newId,
  makeFileLoader,
  claimById,
  placed,
  markFunctionOps,
  parseProject,
  parseProjectAddress,
  targetLinks,
  regionDeleteOp,
  ROOT_FOR_TYPE,
  unmarkFunctionOps,
} from "../core/index.js";
import {
  chatMessages,
  participants as participantsOf,
  postChatMessage,
  projectFromDoc,
} from "../core/crdt/index.js";
import { runDecoder } from "../sandbox/run.js";
import { renderTextWith } from "../sandbox/sync.js";
import { databaseFileBytes } from "../store/load.js";
import { CommentPlacement, TextEncoding, describeWarning } from "../core/index.js";
import { TypeField } from "../core/ops/types.js";
import {
  Claim,
  Interpretation,
  Provenance,
  RootKind,
  claimSpan,
  compareClaims,
  describeScope,
  ClaimMethod,
} from "../core/claims/model.js";
import { NamedClaim, labelTypeOf } from "../core/claims/names.js";
import {
  FieldType,
  fieldBits,
  fieldSize,
  formatFieldType,
  parseFieldType,
  pathAt,
} from "../core/memory/type.js";
import { ClaimEdit } from "../core/ops/types.js";
import { ClaimSet, disagreements, describeDisagreement } from "../core/claims/set.js";

/** The region kind an interpretation projects to, for the span writer. */
/**
 * What a caller says when it claims something.
 *
 * One shape for the single write and the batch, so the two cannot disagree
 * about their own contract — which is exactly how `bind_constants` and
 * `add_comments` ended up with different answers to "what happens to the rest".
 */
export interface ClaimInput {
  at: number;
  /** How the claimer knows. Not how sure they are — see `ClaimMethod`. */
  method?: Provenance["method"];
  name?: string;
  extent?: number;
  is?: Interpretation["is"];
  /** Which layout, when `is` is `record`. From `list_types`. */
  typeId?: string;
  encoding?: TextEncoding;
  view?: string;
  root?: RootKind;
  comment?: string;
}

/**
 * The legacy region kind an interpretation writes as.
 *
 * The write path still speaks the old vocabulary internally — `regionSetOp`
 * takes a kind — and this is the one place the two meet. There is no `code`
 * and no `unknown` on the left, which is the whole redesign in one mapping.
 *
 * `record` is excluded because it has no legacy spelling: there was never a
 * region kind for "an array of these", which is the whole reason a reader's
 * finished analysis of `zoneDataTable` had nowhere to go. It writes a claim op
 * directly, which is what the rest of this should eventually do too.
 */

import { FileStorage, ProjectStore, SqliteStorage } from "../store/index.js";
import { nodeFileBytes, nodeRomBytes } from "../node-files.js";
import { MAX_UPLOAD_BYTES, uploadTokens } from "./uploads.js";
import { runProgram } from "../core/il/program.js";
import { CheckpointCache, runScenario as coreRunScenario } from "../core/machine/scenario.js";
import { EvidenceKind, ProjectStep } from "../core/project/project.js";
import { listDirectory } from "../core/c64/d64.js";
import { renderSid } from "../core/c64/sid-audio.js";
import { decodeText } from "../core/c64/text.js";
import { decode as decodeInstruction } from "../core/arch/mos6502/decoder.js";
import { formatInstruction } from "../core/arch/mos6502/instruction.js";
import type { ByteReading } from "../core/memory/region.js";
import {
  DEFAULT_SCREEN_BASE,
  placeText,
  screenCell,
  spriteAt,
} from "../core/c64/geometry.js";
import { fieldsInMask, registerAt } from "../core/c64/registers.js";
import type { SidWrite } from "../core/c64/devices/sid.js";

/**
 * Who is asking, and under which lease.
 *
 * Resolved once per request, never taken as a tool argument. The session is
 * what scopes undo, so that two agents claiming one identity are two peers
 * rather than one — the same rule two browser tabs already follow.
 */
export interface Caller {
  userId: string;
  label: string;
  /**
   * Where the identity came from, stated rather than inferred.
   *
   * `user` matched a row in the users table, `claimed` was asserted and
   * believed, `anonymous` was never given. A caller cannot work this out by
   * comparing `userId` to `label` — a user row whose id equals its name would
   * read as unrecognised — and the difference is exactly what was invisible
   * when an unknown claim silently became somebody else.
   */
  identity?: "user" | "claimed" | "anonymous";
  sessionId?: string;
  codename?: string;
  /**
   * Set when no session handle was presented, so the lease had to be keyed by
   * identity alone and everyone under it shares one undo scope.
   */
  sharedSession?: boolean;
}

export interface Room {
  store: ProjectStore;
  storage: SqliteStorage | FileStorage;
  projectId: string;
  projectPath: string;
  /**
   * Machines part-way through a scenario, so "continue from step five" is cheap.
   *
   * A cache of a derived thing and nothing more: it is keyed on the project
   * version plus a step prefix, held per room, and lost on restart. A miss
   * re-runs from the beginning, which is always correct — which is why this is
   * optional and why nothing depends on it being there.
   */
  machines?: CheckpointCache;
  /**
   * Where this server answers, for handing out a URL a caller can PUT to.
   *
   * The server knows its own address; the MCP context does not carry the
   * request, so threading an origin down from each call would be ceremony for
   * a value that never changes.
   */
  baseUrl?: string;
  /**
   * Which view this workspace answers for, when the caller named one.
   *
   * A `Workspace` *is* a view over a project: layers, claims and analysis all
   * come out narrowed to one target. That is why the target lives here rather
   * than being threaded through seventy method signatures — and why there is no
   * "current" target anywhere on the server. A caller names one per request; a
   * browser showing two targets side by side is two requests, not a setting
   * that two panes have to fight over.
   */
  target?: string;
}

/** The claims an edit brought into being or revised, in the order it did. */
const claimIds = (ops: readonly Op[]): string[] =>
  ops
    .filter((op) => op.op === "claim.add" || op.op === "claim.set")
    .map((op) => (op.op === "claim.add" ? op.claim.id : op.id));

const hex4 = (address: number) => `$${address.toString(16).toUpperCase().padStart(4, "0")}`;
const hex2 = (value: number) => `$${value.toString(16).toUpperCase().padStart(2, "0")}`;

/**
 * Where an inline comment stops fitting beside an instruction.
 *
 * Comments wrap at column 100 and an instruction row takes roughly a third of
 * that, so past this the row runs long. A hint rather than a limit: what
 * actually fits depends on the instruction it shares the row with.
 */
const INLINE_COMMENT_HINT = 60;

/**
 * The row at an address that carries its *content*, not its decoration.
 *
 * `lineForAddress` maps an address to its **first** row, which is right for
 * navigation and wrong for quoting: at a labelled or commented address the first
 * row is the label or the comment, so "the line that calls this" came back as
 * the caller's own name — and at a well-annotated routine head, as somebody's
 * prose. The better a project was annotated, the less useful the answer got.
 */
function contentRowAt(
  rows: readonly Row[],
  lineForAddress: Record<number, number>,
  address: number
): Row | undefined {
  const first = lineForAddress[address];
  if (first === undefined) return undefined;

  for (let i = first; i < rows.length && rows[i].address === address; i++) {
    if (rows[i].kind !== "label" && rows[i].kind !== "comment") return rows[i];
  }
  return rows[first];
}

/**
 * Where a run ended, named rather than tagged.
 *
 * A block's exit is the answer to "and then what", which for a conditional
 * block is the whole reason to run it — reporting `goto $8100` for one input
 * and `fallthrough` for another is what turns a branch into a decision you can
 * see being made.
 */
function describeExit(
  exit: BlockRun["exit"],
  name: (address: number) => string | undefined
): Record<string, unknown> {
  const at = (address: number) => {
    const label = name(address);
    return label ? `${hex4(address)} (${label})` : hex4(address);
  };

  switch (exit.kind) {
    case "fallthrough":
      return { kind: "fallthrough", to: at(exit.to) };
    case "goto":
      return { kind: "goto", to: at(exit.to) };
    case "call":
      return { kind: "call", to: at(exit.to), returnsTo: at(exit.returnsTo) };
    case "return":
      return { kind: "return", ...(exit.to === undefined ? {} : { to: at(exit.to) }) };
    case "stopped":
      return { kind: "stopped", at: hex4(exit.at), reason: exit.reason };
  }
}

/**
 * How far an effects query looks.
 *
 * One axis rather than two tools: `block` is the straight-line block and is
 * exact; `routine` is the routine's own blocks; `calls` adds everything its
 * callees reach; `returning` is `calls` refusing to enter anything that never
 * comes back.
 */
export type EffectScope = "block" | "routine" | "calls" | "returning";

/**
 * One answer shape for all four scopes.
 *
 * `covers` is what was actually looked at and reads differently per scope — a
 * block has a start and an end, a routine has spans — which is the one place
 * the scopes genuinely differ rather than merely being wider.
 */
export interface EffectsAnswer {
  scope: EffectScope;
  /** Absent for `block`: there is no routine being named. */
  routine?: string;
  covers: Record<string, unknown>;
  reads: string[];
  writes: string[];
  flags: string[];
  /** `block` only: instructions with no modelled semantics. */
  unmodelled?: { at: string; mnemonic: string }[];
  calls?: string[];
  /** `returning` only: the callees it refused to enter. */
  stoppedAt?: string[];
  returns?: string[];
  incomplete?: (EffectGap & { why: string })[];
  note?: string;
}

export class Workspace {
  private cached?: { key: string; loaded: LoadedProject; program: ProgramAnalysis };
  private cachedRows?: { key: string; rows: AnalysisResult };
  private cachedRoutines?: { key: string; routines: Map<number, RoutineEffects> };
  /** The document counter last looked at, and what the project looked like then. */
  private seenVersion = -1;
  private seenProjection = "";
  /** Moves only when the *project* moves, which is what an analysis depends on. */
  private projectVersion = 0;

  constructor(private readonly room: Room) {}

  /**
   * The same project, read through another target.
   *
   * A workspace *is* a view, so asking for a different one hands you another
   * workspace rather than changing this one. That is the whole shape: nothing
   * on the server holds a "current" target, so two views of one project are two
   * objects and neither can move the other out from under it — which is what a
   * split-screen UI needs and what made `select_target` a shared setting nobody
   * was willing to touch.
   */
  view(target?: string): Workspace {
    if (target === this.room.target) return this;
    return new Workspace({ ...this.room, ...(target === undefined ? {} : { target }) });
  }

  // --- freshness ------------------------------------------------------

  /**
   * What the cache is keyed on.
   *
   * The document counter covers edits; the blob fingerprint covers the bytes
   * underneath, which the document knows nothing about. Under SQLite those are
   * content-addressed and immutable per name, so the hash is exact; on a plain
   * file someone can replace the PRG on disk, and mtime is the best available.
   */
  private key(): string {
    const { store, storage } = this.room;
    const project = projectFromDoc(store.document());

    const fingerprint = blobPaths(project)
      .map((name) =>
        storage instanceof SqliteStorage
          ? (storage.blobHash(name) ?? "?")
          : name
      )
      .join(",");

    // `docVersion` moves whenever the *document* does, and not everything that
    // moves the document moves the project: chat lives at a root the projection
    // cannot see, so keying on the counter alone would throw away the analysis
    // once per message and re-derive it on the next question anyone asked.
    //
    // Confirming costs a `JSON.stringify` of the projection, and only when the
    // counter has moved — the hit path stays free, which is the whole reason
    // the counter was preferred to a content hash in the first place.
    if (store.docVersion !== this.seenVersion) {
      this.seenVersion = store.docVersion;
      const projection = JSON.stringify(project);
      if (projection !== this.seenProjection) {
        this.seenProjection = projection;
        this.projectVersion++;
      }
    }

    return `${this.projectVersion}:${fingerprint}`;
  }

  /**
   * Every routine, cached with the analysis it is derived from.
   *
   * Cheap — about 7ms on the reference project — but `find_references` asks per
   * call site, so recomputing it each time would turn one answer into hundreds.
   */
  routines(): Map<number, RoutineEffects> {
    const key = this.key();
    if (this.cachedRoutines?.key === key) return this.cachedRoutines.routines;

    const program = this.program();
    const routines = analyzeRoutines(
      program.blocks,
      // `entry` as well as `function`: where a program *starts* is a routine
      // root just as much as something a JSR points at, and without it every
      // instruction reachable only from the entry point belongs to nothing —
      // which on this project was most of the initialisation code.
      //
      // And the origins themselves, not only the labels. That correction was
      // made once for `entry`-typed labels and stopped there, so a project that
      // declares where execution begins *structurally* — on a target, or in
      // `entryPoints`, with no label at all — had no routine there. Experiment
      // 7's project was exactly that, and `call_graph` refused its own first
      // entry point: the wrong answer to "show me the shape of this program",
      // which is the first thing anybody asks.
      [
        ...program.labels
          .filter({ type: "function" })
          .concat(program.labels.filter({ type: "entry" }))
          .map((l) => l.at),
        ...program.origins,
      ]
    );
    this.cachedRoutines = { key, routines };
    return routines;
  }

  /**
   * The routine an address is in, named, or undefined when nothing owns it.
   *
   * Asked of blocks rather than of merged spans, which is the difference
   * between an exact answer and a plausible one.
   */
  private routineNameAt(address: number): string | undefined {
    const program = this.program();
    const owning = routineAt(this.routines(), program.blocks, address);
    if (!owning) return undefined;
    const label = program.labels.resolve(owning.entry);
    return label && label.offset === 0 ? label.label.name : hex4(owning.entry);
  }

  /**
   * Which view this workspace answers for, resolved.
   *
   * Reported on answers rather than left implicit: a caller that named no
   * target got the project's declared default, and seeing which one it was is
   * the difference between learning the habit and silently reading the wrong
   * stack. The same move as `scope` on a claim write — derived, not chosen, and
   * never invisible.
   */
  targetName(): string | undefined {
    return this.program().loaded.project.defaultTarget;
  }

  /** The analysed program, rebuilt only when something it depends on moved. */
  program(): ProgramAnalysis {
    const key = this.key();
    if (this.cached?.key === key) return this.cached.program;

    const loaded = this.load();
    const program = analyzeProgram(loaded);
    this.cached = { key, loaded, program };
    return program;
  }

  /**
   * The rendered rows, built only when something actually asks to read code.
   *
   * Most questions — what calls this, what is still unnamed — never need them,
   * and rendering is the expensive half.
   */
  private rows(): AnalysisResult {
    const key = this.key();
    if (this.cachedRows?.key === key) return this.cachedRows.rows;

    const loaded = this.program().loaded;
    const rows = analyze(loaded, {
      // A text region may name a decoder, and this is where it gets to run.
      // Synchronous, because a listing is built in one pass — see
      // `src/sandbox/sync.ts` for what that costs and what it keeps.
      renderText: (id, bytes) => {
        const decoder = loaded.project.decoders?.find((d) => d.id === id);
        return decoder ? renderTextWith(decoder.source, bytes) : undefined;
      },
    });
    this.cachedRows = { key, rows };
    return rows;
  }


  private load(): LoadedProject {
    const { store, storage, projectPath } = this.room;
    // Blobs come from wherever this project keeps them; a plain project file
    // names files on disk beside it, a database carries them.
    const bytes =
      storage instanceof SqliteStorage
        ? databaseFileBytes(storage)
        : nodeFileBytes(dirname(projectPath));

    // Through the selected target, so analysis, ownership and annotations all
    // see the same narrowed stack. `describe_project` reads the unfiltered
    // project separately, since a caller needs to see the layers a target hides
    // in order to switch to one that shows them.
    return buildMemoryMap(projectFromDoc(store.document()), makeFileLoader(bytes), {
      loadRom: nodeRomBytes(),
      ...(this.room.target === undefined ? {} : { target: this.room.target }),
    });
  }

  /** Content-addressed, for anything crossing a process boundary. */
  version(): string {
    return this.room.store.version();
  }

  // --- reads ----------------------------------------------------------

  /** What this server holds, for a caller that knows nothing yet. */
  catalogue(): {
    projects: { id: string; name: string }[];
    users: { id: string; name: string }[];
    storage: "sqlite" | "file";
  } {
    const { storage } = this.room;
    const sqlite = storage instanceof SqliteStorage;
    return {
      projects: sqlite
        ? storage.projects()
        : [{ id: this.room.projectId, name: this.room.projectPath }],
      users: sqlite ? storage.users().map(({ id, name }) => ({ id, name })) : [],
      storage: sqlite ? "sqlite" : "file",
    };
  }

  describe(): {
    project: string;
    description?: string;
    version: string;
    /**
     * Where the program is *declared* to start — the project's own entry
     * points, or a PRG layer's load address.
     *
     * Not every address the walk begins from. Every `function`, `code` and
     * `entry` label seeds the queue too, so on an annotated project that list
     * runs to hundreds and stops answering the question the field is named for:
     * experiment 3 reached 155 of them and the reader said so.
     */
    entryPoints: string[];
    /** How many addresses decoding actually starts from, labels included. */
    decodeStartsFrom: number;
    layers: { level: number; name: string; start: string; end: string; labels: number }[];
    regions: { id?: string; start: string; end: string; kind: string; name?: string }[];
    counts: {
      instructions: number;
      namedByHand: number;
      namedAutomatically: number;
      namedByPlatform: number;
    };
    warnings: number;
    /**
     * What is wrong with the annotations, as opposed to with the program.
     *
     * Present only when there is something: zero is the resting state, which is
     * the property that makes the list worth reading at all.
     */
    hygiene?: { kind: string; message: string; subjects: { id?: string; address?: string }[] }[];
    /**
     * Said only when it is bad news: the export is behind the document and why.
     *
     * A write failure reaches nobody otherwise — the live writer is a detached
     * timer that swallows the error to keep the server up, so every tool keeps
     * answering `ok` while nothing leaves the document.
     */
    exportStale?: { failedAt: string; error: string };
    /**
     * ROMs this project asked for and this host does not have.
     *
     * Present only when something is missing. Every answer that would have used
     * those bytes is short by an unknown amount, and an unexplained short answer
     * is what this project keeps being caught by — so it is said here rather
     * than left to be inferred from a layer that supplies nothing.
     */
    romsMissing?: string[];
  } {
    const program = this.program();
    const { loaded } = program;
    const exportStatus = this.room.store.exportStatus();
    const auto = program.labels.filter({ source: "auto" });
    // Supplied by re64 rather than decided by anyone: the built-in C64 symbol
    // table, and the entry point a PRG layer labels from its load address.
    const supplied = [
      ...program.labels.filter({ source: "platform" }),
      ...program.labels.filter({ source: "layer" }),
    ];

    return {
      project: this.room.projectId,
      ...(loaded.project.description ? { description: loaded.project.description } : {}),
      version: this.version(),
      entryPoints: (loaded.project.entryPoints?.length
        ? loaded.project.entryPoints.map((e) => parseProjectAddress(e))
        : loaded.prgEntries
      ).map(hex4),
      decodeStartsFrom: program.entryPoints.length,
      layers: loaded.layers.map((layer, index) => ({
        level: index,
        name: layer.name,
        start: hex4(layer.start),
        end: hex4(layer.end),
        labels: layer.getLabels().length,
      })),
      regions: loaded.map.getAllRegions().map((r) => {
        // Reported so a caller can name one. Without this, a write had to infer
        // which claim was meant from its start address — which stopped being
        // unique the moment they could nest, and an address could never
        // identify one anyway.
        const { start, end } = claimSpan(r);
        return {
          id: r.id,
          start: hex4(start),
          end: hex4(end),
          // A claim with no interpretation and a root is a place to decode
          // from, which is what a `code` region was.
          kind: r.says?.is ?? "code",
          name: r.name,
        };
      }),
      counts: {
        instructions: program.instructions.size,
        // The distinction that says how far along a project is: a name someone
        // chose means something was understood, an invented one means it was not.
        //
        // Platform and layer labels are neither. Counting them as chosen made a
        // project with no annotations at all report 161 of them, which is the
        // opposite of what this number exists to say.
        namedByHand: program.labels.getAllLabels().length - auto.length - supplied.length,
        namedAutomatically: auto.length,
        namedByPlatform: supplied.length,
      },
      warnings: program.warnings.length,
      ...(program.hygiene.length ? { hygiene: [...program.hygiene] } : {}),
      // Said rather than left to be inferred from a layer that supplies nothing:
      // every answer that would have used those bytes is short by an unknown
      // amount, and an unexplained short answer is the failure this project
      // keeps recording.
      ...(program.loaded.romsMissing.length
        ? { romsMissing: [...program.loaded.romsMissing] }
        : {}),
      ...(exportStatus.current
        ? {}
        : {
            exportStale: {
              failedAt: new Date(exportStatus.failedAt!).toISOString(),
              error: exportStatus.error!,
            },
          }),
    };
  }

  /**
   * Write the export, and hand back what it says.
   *
   * An agent had no way to save a project and no way to learn it had not been
   * saved: the live writer is a debounced timer, the failure path is silent,
   * and `POST /api/export` is an HTTP route the tool surface never mentions.
   * Reaching past the tools to find it meant reading the server's source.
   *
   * The text comes back rather than a path being written, because where a
   * project lives is the caller's business and differs by storage mode: under
   * SQLite the export target is a column, not a file on disk, which is the
   * other thing nobody was told.
   */
  exportProject(): { changed: boolean; text: string; bytes: number } {
    const ops = this.room.store.writeFile();
    const text = this.room.storage.readText();
    return { changed: ops.length > 0, text, bytes: Buffer.byteLength(text) };
  }

  /**
   * Name this point, so it can be come back to and asked about.
   *
   * A tag, and cheap enough to be worth having for that reason alone: it copies
   * nothing. The cursor is an `ops.seq`, which `changes_since` already takes, so
   * "what has happened since" works the moment a tag exists.
   *
   * It is not a save. The document took every edit as it landed; this marks a
   * point in a record that was already being kept — which is the distinction
   * experiment 4's agent could not find anywhere and got wrong.
   */
  tagProject(caller: Caller, name: string, note?: string): {
    name: string;
    cursor: number;
    version: string;
    at: string;
    author?: string;
  } {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("A tag needs a name.");

    const storage = this.room.storage;
    if (!(storage instanceof SqliteStorage)) {
      throw new Error("Tags need a database; this project is a plain file.");
    }
    if (storage.tags().some((t) => t.name === trimmed)) {
      throw new Error(
        `There is already a tag called "${trimmed}". Tags name a point that ` +
          `happened, so they are not moved; remove it first if you meant to.`
      );
    }

    const tag = {
      name: trimmed,
      cursor: storage.opsCursor(),
      version: this.room.store.version(),
      at: Date.now(),
      ...(caller.label ? { author: caller.label } : {}),
      ...(note ? { note } : {}),
    };
    storage.addTag(tag);

    return {
      name: tag.name,
      cursor: tag.cursor,
      version: tag.version,
      at: new Date(tag.at).toISOString(),
      ...(tag.author ? { author: tag.author } : {}),
    };
  }

  /** Every tag, oldest first, with how far the project has moved since each. */
  listTags(): {
    total: number;
    tags: {
      name: string;
      at: string;
      version: string;
      cursor: number;
      author?: string;
      note?: string;
      changesSince: number;
      current: boolean;
    }[];
  } {
    const storage = this.room.storage;
    if (!(storage instanceof SqliteStorage)) return { total: 0, tags: [] };

    const now = storage.opsCursor();
    const version = this.room.store.version();
    const tags = storage.tags().map((tag) => ({
      name: tag.name,
      at: new Date(tag.at).toISOString(),
      version: tag.version,
      cursor: tag.cursor,
      ...(tag.author ? { author: tag.author } : {}),
      ...(tag.note ? { note: tag.note } : {}),
      changesSince: Math.max(0, now - tag.cursor),
      // Operations can be recorded without the projection moving — an edit and
      // its undo, say — so these are different questions and both are answered.
      current: tag.version === version,
    }));
    return { total: tags.length, tags };
  }

  /** Forget a tag. The operations it pointed at are untouched. */
  removeTag(name: string): { removed: boolean } {
    const storage = this.room.storage;
    if (!(storage instanceof SqliteStorage)) return { removed: false };
    const removed = storage.removeTag(name);
    if (!removed) throw new Error(`No tag called "${name}".`);
    return { removed };
  }

  /** The cursor a tag names, for the tools that take one. */
  private cursorOfTag(name: string): number {
    const storage = this.room.storage;
    const tag =
      storage instanceof SqliteStorage ? storage.tags().find((t) => t.name === name) : undefined;
    if (!tag) throw new Error(`No tag called "${name}". list_tags shows what there is.`);
    return tag.cursor;
  }

  /**
   * Who is in this project, online first.
   *
   * Read from the document rather than from awareness, so this is the same list
   * a browser renders. An agent has no socket and therefore no awareness; making
   * membership part of the document is what lets both consumers learn it the
   * same way instead of one of them having a mechanism the other lacks.
   */
  participants(): {
    total: number;
    online: number;
    participants: {
      session: string;
      name: string;
      codename?: string;
      kind: string;
      online: boolean;
      joinedAt: string;
      lastSeen: string;
    }[];
  } {
    const found = participantsOf(this.room.store.document());
    return {
      total: found.length,
      online: found.filter((p) => p.online).length,
      participants: found.map((p) => ({
        session: p.session,
        name: p.name,
        ...(p.codename ? { codename: p.codename } : {}),
        kind: p.kind,
        online: p.online,
        joinedAt: new Date(p.joinedAt).toISOString(),
        lastSeen: new Date(p.lastSeen).toISOString(),
      })),
    };
  }

  /**
   * Start a project with nothing in it.
   *
   * The first thing an agent handed a bare disk image needs, and the only tool
   * here that reaches outside its own project: it opens a second connection to
   * the same database rather than going through the room, because the room it
   * would need does not exist yet.
   */
  createProject(name: string): { project: string; note: string } {
    if (!(this.room.storage instanceof SqliteStorage)) {
      throw new Error("Projects can only be created in a database; this server holds one file.");
    }
    const id = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-|-$/g, "");
    if (!id) throw new Error("Give the project a name.");

    const storage = new SqliteStorage(this.room.projectPath, id);
    if (storage.exists()) {
      storage.close();
      throw new Error(`A project called "${id}" is already here. list_projects shows them.`);
    }
    storage.initialize(JSON.stringify({ name, layers: [] }, null, 2), Date.now(), name);
    storage.close();

    return {
      project: id,
      note:
        "Empty: no layers and no bytes. prepare_upload puts a binary in, " +
        "list_disk_files reads a .d64's directory, and add_layer makes a layer " +
        "over one of them.",
    };
  }

  /**
   * A URL to send a binary to, and the token that authorises this one upload.
   *
   * Bytes go over HTTP rather than through a tool argument: a D64 is 175KB,
   * which is roughly 58k tokens as base64, for a file nothing needs to read.
   * The token carries the project, the name and the caller, so the upload
   * *completes* the link and an unowned blob cannot be created.
   */
  prepareUpload(
    caller: Caller,
    name: string
  ): { url: string; token: string; expiresAt: string; maxBytes: number; method: string; note: string } {
    const clean = name.trim();
    if (!clean) throw new Error("Give the file a name — the one layers will use for it.");

    const prepared = uploadTokens.issue(this.room.projectId, clean, caller.label ?? caller.userId);
    return {
      method: "PUT",
      url: `${this.room.baseUrl ?? ""}/api/upload/${prepared.token}`,
      token: prepared.token,
      expiresAt: new Date(prepared.expiresAt).toISOString(),
      maxBytes: MAX_UPLOAD_BYTES,
      note:
        `PUT the raw bytes to that URL — not base64, not JSON. It is good once. ` +
        `The file is recorded as "${clean}" in this project when the bytes land.`,
    };
  }

  /** Record an uploaded binary in the document, so it is attributed and exported. */
  noteUploadedFile(caller: Caller, name: string, hash: string, size: number): EditResult {
    return this.edit(caller, () => [{ op: "file.add", name, hash, size } as Op]);
  }

  /**
   * What a D64 holds.
   *
   * `d64.ts` has read disk images since early on and only the CLI could reach
   * it, which is why every experiment so far started from a `.prg` somebody had
   * already extracted by hand.
   */
  diskFiles(name: string): {
    image: string;
    total: number;
    files: { name: string; type: string; blocks: number; approxBytes: number; path: string }[];
  } {
    const storage = this.room.storage;
    const bytes = storage instanceof SqliteStorage ? storage.blob(name) : undefined;
    if (!bytes) {
      throw new Error(
        `No file called "${name}" in this project. prepare_upload puts one here.`
      );
    }

    const entries = listDirectory(bytes).filter((e) => e.type !== "del");
    return {
      image: name,
      total: entries.length,
      files: entries.map((entry) => ({
        name: entry.filename,
        type: entry.type,
        blocks: entry.sizeInSectors,
        // A sector holds 256 bytes, 254 of them data; the rest is the link to
        // the next one. Approximate because the last sector is partly used.
        approxBytes: entry.sizeInSectors * 254,
        // What a layer's `path` takes, so the next call can be copied from here.
        path: `${name}:${entry.filename}`,
      })),
    };
  }

  /**
   * The views this project declares, and which is selected.
   *
   * Reads the *unfiltered* project on purpose: a caller needs to see the layers
   * the current target hides in order to choose one that shows them.
   */
  targets(): {
    active?: string;
    total: number;
    targets: {
      name: string;
      /** The linked layers, bottom-up: the last one shadows the ones before. */
      layers: { id: string; layer: string; name?: string; at?: string }[];
      entryPoints?: string[];
      order?: number;
      description?: string;
      active: boolean;
    }[];
    layers: { id: string; name: string; type: string }[];
  } {
    const project = projectFromDoc(this.room.store.document());
    const byId = new Map(
      project.layers.filter((l) => l.id).map((l) => [l.id!, l] as const)
    );
    return {
      ...(project.defaultTarget ? { active: project.defaultTarget } : {}),
      total: (project.targets ?? []).length,
      // In the order the program lives them, where anybody has said: a loader
      // precedes the image it expands, which precedes the levels. Unordered
      // targets keep their declared order after the ones that are placed.
      targets: [...(project.targets ?? [])]
        .sort(
          (a, b) =>
            (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
        )
        .map((t) => ({
          name: t.name,
          // Links rather than a list of ids, in z-order, with `at` present only
          // where this target puts a layer somewhere other than its own
          // address. Reported because it is what decides shadowing, and because
          // a layer-scoped claim's absolute address is this plus its offset.
          layers: targetLinks(t).map((link) => ({
            // The link's own id, because a link is addressed on its own and a
            // write you cannot name again is one the caller has to go looking
            // for.
            id: link.id,
            layer: link.layer,
            ...(byId.get(link.layer) ? { name: byId.get(link.layer)!.name } : {}),
            ...(link.at === undefined ? {} : { at: hex4(link.at) }),
          })),
          ...(t.entryPoints
            ? { entryPoints: t.entryPoints.map((a) => hex4(parseProjectAddress(a))) }
            : {}),
          ...(t.order === undefined ? {} : { order: t.order }),
          ...(t.description === undefined ? {} : { description: t.description }),
          active: t.name === project.defaultTarget,
        })),
      // Every layer, including ones the selection hides, with the ids a target
      // is defined in terms of.
      layers: project.layers
        .filter((l) => l.id)
        .map((l) => ({ id: l.id!, name: l.name ?? l.path ?? l.id!, type: l.type })),
    };
  }

  /**
   * Check the layer links a caller gave, and mint an id for each.
   *
   * A link is addressed on its own — "move this layer to $0100" — so it carries
   * an id like everything else. Minted here rather than taken from the caller,
   * which is the rule for every `add` on this surface.
   */
  private checkedLinks(
    layers: readonly { layer: string; at?: number }[]
  ): { id: string; layer: string; at?: number }[] {
    const known = new Set(
      projectFromDoc(this.room.store.document())
        .layers.filter((l) => l.id)
        .map((l) => l.id!)
    );
    const named = layers.map((l) => l.layer);
    const unknown = named.filter((id) => !known.has(id));
    if (unknown.length) {
      throw new Error(
        `No layer ${unknown.join(", ")} in this project. list_targets shows the ` +
          `ids a target is defined in terms of.`
      );
    }
    if (layers.length === 0) throw new Error("A target with no layers shows nothing.");
    // A layer linked twice is a stack that shadows itself, which has no reading
    // — and unlike most things here it is a fact about the request rather than
    // a judgement about the result, so refusing is right.
    if (new Set(named).size !== named.length) {
      throw new Error(
        "A layer can be linked into a target once. Listing one twice would have " +
          "it shadow itself, which has no reading."
      );
    }
    return layers.map((l) => ({
      id: newId("lnk"),
      layer: l.layer,
      ...(l.at === undefined ? {} : { at: l.at }),
    }));
  }

  /** Declare a view over the layer stack. **Always adds**, and returns the id. */
  addTarget(
    caller: Caller,
    name: string,
    layers: readonly { layer: string; at?: number }[],
    entryPoints?: readonly number[],
    order?: number,
    description?: string
  ): EditResult & { target: string } {
    const links = this.checkedLinks(layers);
    const id = newId("tgt");
    const result = this.edit(caller, () => [
      {
        op: "target.add",
        id,
        name,
        layers: links,
        ...(entryPoints === undefined ? {} : { entryPoints: [...entryPoints] }),
        ...(order === undefined ? {} : { order }),
        ...(description === undefined ? {} : { description }),
      },
    ]);

    // What this view can and cannot see, said at the moment it is made.
    //
    // A target that links no ROM boots into zeros, because its vectors read as
    // zero. Two editors in a row hit that from the other side — declaring ROM
    // layers and never linking them — so the write that makes a view says which
    // declared layers it left out. (A view linking *nothing* is refused by the
    // schema, so there is no branch for it here.)
    //
    // Deliberately *not* linking anything automatically. A project asks for its
    // ROMs and the request is committed even though the bytes never are;
    // loading them whenever the files happen to be present would make the
    // analysis depend on a gitignored file, which is a suite that means
    // different things on different machines. And a loader target legitimately
    // wants no ROM at all.
    // The *declared* project, not `loaded.project` — which is narrowed to the
    // current view, so the very layers this is about would be filtered out of
    // it. The same reason `list_targets` reads from the document directly.
    const project = projectFromDoc(this.room.store.document());
    const linked = new Set(links.map((l) => (typeof l === "string" ? l : l.layer)));
    const unlinked = (project.layers ?? []).filter(
      (l) => l.id !== undefined && !linked.has(l.id) && l.type !== "symbols"
    );
    const roms = unlinked.filter((l) => l.type === "rom");

    return {
      ...result,
      target: id,
      ...(roms.length === 0
        ? {}
        : {
            romsNotLinked: roms.map((l) => l.name ?? l.rom ?? l.id!),
            romNote:
              "This project declares ROM layers that this view does not link. A " +
              "machine started here reads its reset and interrupt vectors as zero " +
              "and boots into $0000. Link them with set_target if this view is for " +
              "running rather than for reading.",
          }),
    };
  }

  /** Revise a view by id. An id nothing holds is not found; it never creates. */
  editTarget(
    caller: Caller,
    id: string,
    fields: {
      name?: string;
      layers?: readonly { layer: string; at?: number }[];
      entryPoints?: readonly number[];
      order?: number;
      description?: string;
    }
  ): EditResult & { target: string } {
    this.mustHold(projectFromDoc(this.room.store.document()).targets ?? [], id, "target", "list_targets");
    if (Object.values(fields).every((v) => v === undefined)) {
      throw new Error("Give at least one field to change: name, layers, entryPoints, order, description.");
    }
    // Only when the caller is saying what the layers are. Revising a target's
    // description must not have to restate its layers, or two people editing
    // one target would revert each other.
    const links = fields.layers === undefined ? undefined : this.checkedLinks(fields.layers);
    const result = this.edit(caller, () => [
      {
        op: "target.set",
        id,
        fields: {
          ...(fields.name === undefined ? {} : { name: fields.name }),
          ...(links === undefined ? {} : { layers: links }),
          ...(fields.entryPoints === undefined
            ? {}
            : { entryPoints: [...fields.entryPoints] }),
          ...(fields.order === undefined ? {} : { order: fields.order }),
          ...(fields.description === undefined ? {} : { description: fields.description }),
        },
      },
    ]);
    return { ...result, target: id };
  }

  removeTarget(caller: Caller, id: string): EditResult {
    this.mustHold(projectFromDoc(this.room.store.document()).targets ?? [], id, "target", "list_targets");
    return this.edit(caller, () => [{ op: "target.remove", id }]);
  }



  /**
   * Run the program from an address, and optionally keep what it produced.
   *
   * The step that had to happen outside re64. Both builders in experiment 5
   * wrote their own 6502 interpreter to get past a decruncher, because
   * `run_block` is scoped to a straight line by design and static analysis of a
   * crunched disk stops at 141 instructions. re64 already owned a CPU that
   * passes the functional suite; this is the driver it lacked.
   *
   * Capturing is a separate decision from running, and both happen in one call
   * so nothing has to be held between requests: run it, read what it says, run
   * it again with `capture` when you know which range you want. A run is under
   * a second.
   */
  runProgram(
    caller: Caller,
    from: number,
    options: {
      stopAt?: number;
      maxInstructions?: number;
      capture?: { name: string; from: number; to: number };
    } = {}
  ): Record<string, unknown> {
    const program = this.program();
    const run = runProgram(program.loaded.map, {
      from,
      ...(options.stopAt === undefined ? {} : { stopAt: options.stopAt }),
      ...(options.maxInstructions === undefined
        ? {}
        : { maxInstructions: options.maxInstructions }),
    });

    const { memory, ...reported } = run;
    const notes: string[] = [];

    // A run that never started is not a run that left.
    //
    // `run_program` runs over the *selected target*, so a start address in a
    // layer that target hides supplies no first instruction — and the stop rule,
    // which is "the program counter reached an address no layer supplies", is
    // then true immediately. It came back `instructions: 0`, `reason: "left the
    // program"` and a cheerful capture hash, which reads as a completed run.
    if (run.instructions === 0 && program.loaded.map.readByte(from) === undefined) {
      const target = program.loaded.project.defaultTarget;
      throw new Error(
        `Nothing supplies ${hex4(from)}, so there is no instruction to start at` +
          (target
            ? `. The target "${target}" is selected, and it may be hiding the layer ` +
              `that holds it — list_targets shows every layer, including the ones ` +
              `the selection excludes.`
            : `. No layer in this project covers that address.`)
      );
    }

    if (run.reason === "budget") {
      notes.push(
        "Ran out of budget rather than finishing, so this is the program " +
          "mid-flight and anything captured from it is a partial result."
      );
    }
    if (run.ioTouched.length) {
      notes.push(
        `Touched ${run.ioTouched.length} hardware address(es); this runs over flat ` +
          `memory and does not emulate the VIC, SID or CIA, so a program that ` +
          `depends on one will not behave as it would on a machine.`
      );
    }

    if (!options.capture) {
      return { ...reported, ...(notes.length ? { notes } : {}) };
    }

    const { name, from: start, to } = options.capture;
    if (to <= start) throw new Error(`A capture needs at least one byte; ${hex4(start)}-${hex4(to)} has none.`);

    // Stored as a .prg — load address first — so the captured image is an
    // ordinary file the project can lay a layer over, rather than a new kind of
    // thing that only this tool understands.
    const bytes = new Uint8Array(2 + (to - start));
    bytes[0] = start & 0xff;
    bytes[1] = (start >> 8) & 0xff;
    bytes.set(memory.slice(start, to), 2);

    // How much of what is being captured the run actually produced.
    //
    // Capturing a range the run never touched succeeds, hashes, and yields a
    // plausible file of whatever was already there — in experiment 5 a
    // correct-looking 20KB of nothing. The bytes are real, so refusing would be
    // wrong; saying so is not.
    const wroteWithin = run.wrote.reduce((total, range) => {
      const low = Math.max(start, parseInt(range.start.slice(1), 16));
      const high = Math.min(to - 1, parseInt(range.end.slice(1), 16));
      return total + Math.max(0, high - low + 1);
    }, 0);
    if (wroteWithin === 0) {
      notes.push(
        `The run wrote nothing in ${hex4(start)}-${hex4(to - 1)}, so this capture is ` +
          `the memory as it already stood rather than anything the run produced. ` +
          `\`wrote\` says where it did write.`
      );
    } else if (wroteWithin < (to - start) / 2) {
      notes.push(
        `The run wrote ${wroteWithin} of the ${to - start} bytes captured; the rest is ` +
          `memory as it already stood.`
      );
    }

    const storage = this.room.storage;
    if (!(storage instanceof SqliteStorage)) {
      throw new Error("Capturing needs a database; this server holds one file.");
    }
    const hash = storage.putBlob(name, bytes);
    const noted = this.noteUploadedFile(caller, name, hash, bytes.length);

    return {
      ...reported,
      ...(notes.length ? { notes } : {}),
      captured: {
        file: name,
        start: hex4(start),
        end: hex4(to - 1),
        bytes: bytes.length,
        hash,
        version: noted.version,
        next: `add_byte_layer type:"prg" path:"${name}" — then mark_function where it starts.`,
      },
    };
  }

  /** Disassembly as lines, capped, with a cursor when there is more. */
  disassembly(
    start: number,
    limit = 80
  ): { start: string; lines: DisassemblyLine[]; truncated: boolean; nextStart?: string } {
    const { rows, lineForAddress } = this.rows();
    const program = this.program();

    // Fall back to the nearest preceding row, as the UI does, so an address
    // landing mid-instruction still resolves.
    let from = lineForAddress[start];
    if (from === undefined) {
      let best = -1;
      let bestAddress = -1;
      for (const [addressText, index] of Object.entries(lineForAddress)) {
        const address = Number(addressText);
        if (address <= start && address > bestAddress) {
          bestAddress = address;
          best = index;
        }
      }
      if (best < 0) throw new Error(`${hex4(start)} is outside the loaded memory map`);
      from = best;
    }

    // One address can own many rows — a label, a comment running to several
    // lines, the instruction. `lineForAddress` points at the *first* of them, so
    // a cursor landing inside such a run resolves backwards and the walk stops
    // advancing: `nextStart` comes back equal to `start`, forever. Extending the
    // page to the end of whatever address it stops inside makes the next address
    // a guaranteed step forward.
    //
    // Found by an agent writing a 47-line comment about a character set and then
    // being unable to page past it — so the failure arrived through following
    // the instructions well, which is the worst way for a bug to be reachable.
    let end = Math.min(from + limit, rows.length);
    while (end < rows.length && rows[end].address === rows[end - 1].address) end++;

    const slice = rows.slice(from, end);
    const truncated = end < rows.length;

    return {
      start: hex4(slice[0]?.address ?? start),
      truncated,
      nextStart: truncated ? hex4(rows[end].address) : undefined,
      lines: slice.map((row) => {
        const instruction = program.instructions.get(row.address);
        const outbound = program.outbound.from(row.address)[0];
        const label = row.kind === "label"
          ? program.labels.getLabelsAt(row.address)[0]
          : undefined;

        return {
          address: hex4(row.address),
          kind: row.kind,
          text: row.text,
          ...(instruction ? { mnemonic: instruction.mnemonic, flow: instruction.flow } : {}),
          ...(outbound ? { target: hex4(outbound.to), targetType: outbound.type } : {}),
          ...(label
            ? { name: label.name, labelType: labelTypeOf(label), source: label.by.source }
            : {}),
          ...(row.illegal ? { illegal: true } : {}),
        };
      }),
    };
  }

  references(
    address: number,
    direction: "in" | "out" | "both" = "both"
  ): {
    address: string;
    inbound?: { from: string; type: string; inRoutine?: string; text?: string }[];
    outbound?: { to: string; type: string; name?: string }[];
    incomplete: string;
  } {
    const program = this.program();
    const { rows, lineForAddress } = this.rows();
    const lineAt = (a: number) => contentRowAt(rows, lineForAddress, a)?.text;

    // The nearest named address at or before this one, which is as close to
    // "the routine containing it" as anything gets without a call graph. Only
    // labels that mark somewhere execution can start count: a data name above
    // the call site would be a confident wrong answer.
    const enclosing = (from: number): string | undefined => {
      // Which routine a call site sits in, worked out from control flow.
      //
      // This used to need a *declared* extent and fell back, without one, to the
      // nearest preceding flow label — which on a real routine is a local branch
      // target, so "who calls this" answered `b81BC` for two call sites both
      // inside one routine, and 20 of 35 callers of one routine came back named
      // `loc_XXXX`. Deriving it needs nobody to have declared anything, and
      // handles the 20 of 50 routines here whose code is not one contiguous
      // span and which no declared extent could have described.
      const named = this.routineNameAt(from);
      if (named) return named;

      for (let at = from; at >= from - 0x400 && at >= 0; at--) {
        const label = program.labels
          .getLabelsAt(at)
          .find((l) => labelTypeOf(l) === "function" || labelTypeOf(l) === "entry" || labelTypeOf(l) === "code");
        if (label) return label.name;
      }
      return undefined;
    };

    return {
      address: hex4(address),
      ...(direction !== "out"
        ? {
            inbound: [...program.xrefs.to(address)]
              .sort((a: Reference, b: Reference) => a.from - b.from)
              .map((r: Reference) => ({
                from: hex4(r.from),
                type: r.type,
                // Which routine the call is *in*. "Who calls this" is a
                // question about names, and the answer used to be a bag of
                // addresses in no particular order.
                inRoutine: enclosing(r.from),
                text: lineAt(r.from),
              })),
          }
        : {}),
      ...(direction !== "in"
        ? {
            outbound: program.outbound.from(address).map((r) => ({
              to: hex4(r.to),
              type: r.type,
              name: program.labels.getLabelsAt(r.to)[0]?.name,
            })),
          }
        : {}),
      // Stated on every answer rather than buried in documentation, because a
      // reader that trusts this will otherwise conclude a routine has no
      // callers when it has several.
      incomplete:
        "Inbound references cover absolute addressing only. Zero-page targets, " +
        "indirect jumps, and addresses stored in data — a pointer read by " +
        "JMP ($8000), or a split lo/hi table — are not recorded, so something " +
        "reached that way appears to have no callers at all. " +
        // Naming the tool that works, because reading "not recorded" as
        // "unanswerable" is the mistake this sentence exists to prevent, and a
        // reader who has just been told a zero-page variable has no users will
        // otherwise believe it.
        "For a zero-page address, find_instructions with from and to set to it " +
        "gives the complete answer, including through a pointer where the " +
        "pointer can be resolved.",
    };
  }

  labels(
    criteria: {
      source?: Claim["by"]["source"];
      type?: LabelType;
      namePattern?: string;
      range?: { start: number; end: number };
    } = {},
    limit = 200
  ): { total: number; labels: LabelSummary[]; truncated: boolean } {
    const program = this.program();
    const found = program.labels.filter(criteria);

    return {
      total: found.length,
      truncated: found.length > limit,
      labels: found.slice(0, limit).map((label) => this.summarise(label)),
    };
  }

  /**
   * What has not been understood yet, most-referenced first.
   *
   * The single most useful question here: it turns "reverse engineer this" into
   * a ranked queue. An auto-named address is one the disassembly found and
   * nobody has explained.
   */
  unnamed(
    kind: "calls" | "jumps" | "data" | "any" = "any",
    limit = 50
  ): { total: number; targets: LabelSummary[] } {
    const program = this.program();
    const prefix = { calls: "sub_", jumps: "loc_", data: "dat_", any: "" }[kind];

    const found = program.labels
      .filter({ source: "auto" })
      .filter((l) => l.name.startsWith(prefix))
      .map((label) => this.summarise(label))
      .sort((a, b) => b.references - a.references);

    return { total: found.length, targets: found.slice(0, limit) };
  }

  private summarise(label: NamedClaim): LabelSummary {
    const program = this.program();
    // An auto label's id is derived from the fact that nothing named it, and
    // handing one out invites an edit claiming an identity that means nothing.
    // A platform label belongs to the built-in symbol layer, which no project
    // owns, so a write to one is refused a layer down.
    //
    // Both were reported writable, which is worse than either gap: it is the
    // field a reader uses to decide what it may edit, so it was planned
    // against and then refused.
    // Three sources have no stored claim behind them, so their ids are derived
    // and a write carrying one names nothing. `layer` was missing here and
    // reported `writable: true` — a PRG layer names its own load address, and
    // the project cannot edit that any more than it can edit a platform name.
    const invented = label.by.source === "auto";
    const builtIn = label.by.source === "platform" || label.by.source === "layer";
    return {
      ...(invented || builtIn ? {} : { id: label.id }),
      address: hex4(label.at),
      name: label.name,
      type: labelTypeOf(label),
      source: label.by.source,
      // What it belongs to, so a reader can see whether it follows its bytes.
      scope: describeScope(label.frame),
      references: program.xrefs.count(label.at),
      writable: !invented && !builtIn,
      // An extent reshapes every operand in its range and any writer can set
      // one, and no read tool reported it — so it was shared state nobody could
      // see. Two readers in experiment 7 each hit the same 2K extent on $1800
      // and each blamed the other.
      ...(label.extent === undefined ? {} : { extent: label.extent }),
      ...(label.description === undefined ? {} : { description: label.description }),
    };
  }

  /**
   * The block covering an address, or a refusal that says where to go instead.
   *
   * "No decoded block covers $8000" is true and useless — the address may be
   * data, may be unreachable, or may simply be one byte before a block start.
   * Naming the nearest block turns a dead end into the next call.
   */
  private blockCovering(address: number): BasicBlock {
    const program = this.program();
    const found = blockAt(program.blocks, address);
    if (found) return found;

    const nearest = program.blocks
      .map((b) => ({ b, distance: Math.abs(b.start - address) }))
      .sort((a, b) => a.distance - b.distance)[0];

    throw new Error(
      `No decoded block covers ${hex4(address)}` +
        (nearest ? `; the nearest starts at ${hex4(nearest.b.start)}` : "; nothing decoded at all") +
        `. It may be data, or reached by nothing this walk follows — find_undecoded says which.`
    );
  }

  /**
   * Everything said in this project, newest last.
   *
   * Not an operation and not part of the project: chat lives at its own root in
   * the shared document, so it reaches every participant over the same socket
   * and never lands in the exported `.re64`. It leaves no `ops` row, is not
   * undoable, and does not invalidate the analysis — a conversation is not an
   * edit.
   */
  messages(limit = 50): {
    total: number;
    messages: { at: string; from: string; text: string }[];
  } {
    const all = chatMessages(this.room.store.document());
    const shown = all.slice(Math.max(0, all.length - limit));
    return {
      total: all.length,
      messages: shown.map((m) => ({
        at: new Date(m.at).toISOString(),
        from: m.name,
        text: m.text,
      })),
    };
  }

  /** Say something to whoever else is in this project. */
  postMessage(caller: Caller, text: string): { posted: boolean; at?: string; as?: string } {
    const posted = postChatMessage(
      this.room.store.document(),
      // The codename is how a person watching a live transcript tells two
      // agents apart; the user id alone would be the same string for both.
      { author: caller.userId, name: caller.codename ?? caller.label, text },
      caller.sessionId
    );
    return posted
      ? { posted: true, at: new Date(posted.at).toISOString(), as: posted.name }
      : { posted: false };
  }

  /**
   * The bytes at an address, as the analysis sees them.
   *
   * There was no way to get these, and it showed: every reader in experiment 2
   * ended up scraping the hex column out of `export_listing`'s rendered text
   * with a regular expression, which is a lot of work to undo formatting that
   * only existed for a human.
   *
   * "As the analysis sees them" is the point, and the reason reading the `.prg`
   * yourself is not the same thing: a project is a *stack* of layers and the
   * topmost one supplying an address wins, so a patch layer or a second file
   * changes what is really there. These are the bytes every other answer here
   * was computed from.
   *
   * Addresses nothing supplies are reported rather than zero-filled. A gap in
   * the map is a fact about the project, and a decoder handed silent zeroes
   * would draw something that looks like data.
   */

  /**
   * Bytes from the memory map, through this workspace's own view.
   *
   * This took a `target` argument once, added so a reader could glance at
   * another view without moving a shared selection — experiment 7 measured not
   * contention over that selection but **avoidance**: changing what two other
   * people are reading so you can look at the packed loader is a cost nobody
   * would pay, so the loader went unread for a whole run.
   *
   * The patch became the mechanism. A view is a parameter of the request, so
   * every call names one and a workspace *is* the view — reading another is
   * `view(name).bytes(...)`, a different object rather than a different
   * argument, and nothing on the server remembers a current anything.
   */
  bytes(start: number, length: number): {
    start: string;
    length: number;
    hex: string;
    base64: string;
    target?: string;
    unmapped?: { from: string; to: string }[];
  } {
    // This workspace's own view, because a workspace *is* one. Reading another
    // is `view(name).bytes(...)`, which is a different object rather than a
    // different argument.
    const read = this.program().loaded.map.readBytes(start, length);

    const gaps: { from: string; to: string }[] = [];
    let run: number | undefined;
    read.forEach((byte, index) => {
      if (byte === undefined && run === undefined) run = index;
      if (byte !== undefined && run !== undefined) {
        gaps.push({ from: hex4(start + run), to: hex4(start + index - 1) });
        run = undefined;
      }
    });
    if (run !== undefined) gaps.push({ from: hex4(start + run), to: hex4(start + read.length - 1) });

    const filled = Uint8Array.from(read, (b) => b ?? 0);
    return {
      start: hex4(start),
      length: read.length,
      // Both, because they answer different questions: hex is readable in a
      // transcript, base64 is what you paste into your own tooling.
      hex: [...filled].map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" "),
      base64: Buffer.from(filled).toString("base64"),
      ...(gaps.length ? { unmapped: gaps } : {}),
    };
  }

  /**
   * Instructions matching a mnemonic, an operand range, or both.
   *
   * Two agents in experiment 2 invented this, one as `find_instructions` and one
   * as `find_hardware_access` over `$D000-$DFFF` — the same question with the
   * range filled in, which is why it is one tool and not two. On this machine
   * the range *is* the meaning: `$D000` is the VIC, `$D400` the SID, `$DC00` the
   * CIA, so "what touches the sound chip" is a search for stores into a span.
   *
   * Each site says which routine it is in, which is the part that makes a list
   * of forty addresses usable.
   */
  instructions(criteria: {
    mnemonic?: string;
    from?: number;
    to?: number;
    limit?: number;
  }): {
    total: number;
    truncated: boolean;
    /** Indexed instructions based below the range, which an index may carry into it. */
    indexedNearby?: { address: string; text: string; base: string; inRoutine?: string }[];
    indexedNote?: string;
    sites: {
      address: string;
      text: string;
      inRoutine?: string;
      /** Where an indirect access goes, when running the path that built it says so. */
      reaches?: string;
      pointerSetAt?: string[];
      stores?: string;
      /** `reaches` is the pointer, not the address: nothing assigned the index. */
      indexUnknown?: true;
    }[];
  } {
    const program = this.program();
    const { rows, lineForAddress } = this.rows();
    const wanted = criteria.mnemonic?.toUpperCase();
    const limit = criteria.limit ?? 100;

    let unresolvedIndirect = 0;

    const matches = [...program.instructions.all()].filter((instruction) => {
      if (wanted && instruction.mnemonic.toUpperCase() !== wanted) return false;
      if (criteria.from === undefined && criteria.to === undefined) return true;

      // Whatever address it touches — including through a pointer, where that
      // pointer was built from immediate loads this can follow back. Gridrunner
      // writes the VIC *only* through `STA ($02),Y`, so without this a search of
      // $D000-$D02E returned one dead instruction and missed everything real.
      const target = targetsOf(instruction, program.blocks);
      if (!target) {
        // An indirect access whose pointer is computed at runtime — a table
        // read, arithmetic — is genuinely unknowable here, and counted so the
        // answer can say how much it could not see.
        const operand = instruction.operand.type;
        if (operand === "indirectIndexed" || operand === "indexedIndirect") unresolvedIndirect++;
        return false;
      }
      return (
        target.address >= (criteria.from ?? 0) && target.address <= (criteria.to ?? 0xffff)
      );
    });

    // **Indexed instructions whose base sits below the range.**
    //
    // `find_instructions $07F8-$07FF` came back empty on a program that writes
    // all eight sprite pointers, because the instruction is `STA $07F7,X` with X
    // running 1 to 8: the operand is one byte below the range and the addresses
    // written are inside it. A reader's comment recorded the dead end and the
    // editor found the instruction by accident, reading that listing for another
    // reason.
    //
    // The renderer already knows this idiom — `table-1,X` is why the ±1 window
    // in operand resolution exists — and the search did not. An index is one
    // byte, so "could reach" is exact rather than a guessed window: base plus
    // 0..255. Reported separately from the matches, because *may* and *does* are
    // different answers and collapsing them is how a search starts lying.
    const nearby: { address: string; text: string; base: string; inRoutine?: string }[] = [];
    if (criteria.from !== undefined || criteria.to !== undefined) {
      const from = criteria.from ?? 0;
      const to = criteria.to ?? 0xffff;
      for (const instruction of program.instructions.all()) {
        if (wanted && instruction.mnemonic.toUpperCase() !== wanted) continue;
        const operand = instruction.operand;
        if (operand.type !== "absoluteX" && operand.type !== "absoluteY") continue;
        const base = operand.address;
        if (base >= from) continue; // already matched, or above the range
        if (base + 0xff < from) continue; // no index can reach
        nearby.push({
          address: hex4(instruction.address),
          text: contentRowAt(rows, lineForAddress, instruction.address)?.text ?? "",
          base: hex4(base),
          ...(this.routineNameAt(instruction.address)
            ? { inRoutine: this.routineNameAt(instruction.address)! }
            : {}),
        });
      }
    }

    // Closest base first: an instruction one byte below the range is far more
    // likely to be the one you are looking for than one two hundred below.
    nearby.sort(
      (a, b) => parseInt(b.base.slice(1), 16) - parseInt(a.base.slice(1), 16)
    );

    return {
      total: matches.length,
      truncated: matches.length > limit,
      ...(nearby.length === 0
        ? {}
        : {
            indexedNearby: nearby.slice(0, 20),
            indexedNote:
              `${nearby.length} indexed instruction(s) have a base below this range and ` +
              `could reach into it — an index is one byte, so anything within 255 below ` +
              `may write here. These are not matches; check whether the index reaches.`,
          }),
      sites: matches.slice(0, limit).map((instruction) => {
        const target = targetsOf(instruction, program.blocks);
        return {
          address: hex4(instruction.address),
          text: contentRowAt(rows, lineForAddress, instruction.address)?.text ?? "",
          ...(this.routineNameAt(instruction.address)
            ? { inRoutine: this.routineNameAt(instruction.address)! }
            : {}),
          // Said explicitly, because `STA ($02),Y` does not look like a write to
          // $D018 and a reader is entitled to check the claim.
          ...(target?.indirect
            ? {
                reaches: hex4(target.address),
                pointerSetAt: target.setAt?.map(hex4),
                // The byte actually stored, which is often the whole answer:
                // $D018 = $18 says the character base is $2000, and that is how
                // you find out what a span of unexplained bytes is for.
                ...(target.value === undefined
                  ? {}
                  : { stores: `$${target.value.toString(16).toUpperCase().padStart(2, "0")}` }),
                // An index nothing assigned on this path means the pointer is
                // known and the offset into it is not. Reported rather than
                // dropped, because the pointer still says which chip is being
                // written; reported rather than presented as the address,
                // because it is not one.
                ...(target.exact ? {} : { indexUnknown: true }),
              }
            : {}),
        };
      }),
      // The blind spot, on the answer rather than in the documentation — the
      // same rule `find_references` follows.
      ...(unresolvedIndirect > 0
        ? {
            incomplete:
              `${unresolvedIndirect} indirect access${unresolvedIndirect === 1 ? "" : "es"} ` +
              `could not be resolved: the pointer is built at runtime, from a table or ` +
              `arithmetic, so nothing here can say where it goes. Those are not in this ` +
              `answer whether or not they touch the range.`,
          }
        : {}),
    };
  }

  /**
   * Every place a sequence of bytes occurs.
   *
   * Two readers invented this independently, which is usually the sign that a
   * general tool is missing rather than a special one wanted. It is the search
   * that does not care what anything *means*: find the other copies of a table,
   * find where a magic value is written, find whether a pattern recurs before
   * there is any theory about why.
   *
   * `??` matches any byte, because the useful searches are nearly always
   * partial — an instruction with an operand you do not know yet, or a table
   * row with a varying field.
   */
  bytesLike(pattern: string, limit = 100): {
    pattern: string;
    total: number;
    truncated: boolean;
    at: { address: string; inRegion?: string; inRoutine?: string }[];
  } {
    const wanted = pattern
      .trim()
      .split(/[\s,]+/)
      .filter((t) => t.length > 0)
      .map((token) => {
        if (/^(\?\?|\?)$/.test(token)) return undefined;
        const value = Number.parseInt(token.replace(/^\$|^0x/i, ""), 16);
        if (!Number.isInteger(value) || value < 0 || value > 0xff) {
          throw new Error(
            `"${token}" is not a byte. Give hex bytes separated by spaces, with ?? ` +
              `for any byte — for example "A9 ?? 8D 20 D0".`
          );
        }
        return value;
      });

    if (wanted.length === 0) throw new Error("Give at least one byte to look for.");
    if (wanted.every((b) => b === undefined)) {
      throw new Error("A pattern of nothing but wildcards matches every address.");
    }

    const { map } = this.program().loaded;
    const found: { address: string; inRegion?: string; inRoutine?: string }[] = [];
    let total = 0;

    for (const layer of map.getLayers().filter((l) => l.hasBytes)) {
      for (let at = layer.start; at + wanted.length <= layer.end + 1; at++) {
        let hit = true;
        for (let i = 0; i < wanted.length && hit; i++) {
          if (wanted[i] === undefined) continue;
          hit = map.readByte(at + i) === wanted[i];
        }
        if (!hit) continue;

        total++;
        if (found.length >= limit) continue;
        const region = map.getRegionAt(at);
        found.push({
          address: hex4(at),
          ...(region?.name ? { inRegion: region.name } : {}),
          ...(this.routineNameAt(at) ? { inRoutine: this.routineNameAt(at)! } : {}),
        });
      }
    }

    return { pattern, total, truncated: total > limit, at: found };
  }

  /**
   * Who calls a routine, and what it calls, to a depth.
   *
   * Invented by an agent in experiment 2 and refused. It needed the routine
   * analysis to exist first: callers come from the reference index, but
   * *callees* are a property of a routine's whole body, which is scattered
   * across several spans on 20 of the 50 routines here.
   */
  callGraph(address: number, depth = 2): Record<string, unknown> {
    const program = this.program();
    const routines = this.routines();

    const name = (at: number) => {
      const label = program.labels.resolve(at);
      return label && label.offset === 0 ? `${hex4(at)} (${label.label.name})` : hex4(at);
    };

    const owning = routines.get(address) ?? routineAt(routines, program.blocks, address);
    if (!owning) {
      throw new Error(
        `${hex4(address)} is not in a routine this can see — nothing calls it and ` +
          `nothing declares it one.`
      );
    }

    const below = (entry: number, left: number, seen: Set<number>): unknown[] =>
      left <= 0
        ? []
        : (routines.get(entry)?.calls ?? []).map((target) =>
            seen.has(target)
              ? { routine: name(target), note: "already shown above" }
              : {
                  routine: name(target),
                  calls: below(target, left - 1, new Set([...seen, target])),
                }
          );

    return {
      routine: name(owning.entry),
      calledBy: program.xrefs
        .to(owning.entry)
        .filter((r) => r.type === "call")
        .map((r) => {
          const from = routineAt(routines, program.blocks, r.from);
          return { from: hex4(r.from), inRoutine: from ? name(from.entry) : undefined };
        }),
      calls: below(owning.entry, depth, new Set([owning.entry])),
      incomplete:
        "Calls seen here are absolute JSRs. A routine reached through a computed " +
        "jump or an RTS dispatch appears to call nothing and to be called by nobody.",
    };
  }

  /** Everything written about this project, in address order. */
  comments(limit = 200): {
    total: number;
    truncated: boolean;
    comments: { id: string; address: string; placement: string; text: string; order?: number }[];
  } {
    const all = [...this.program().loaded.comments.all()].sort((a, b) => a.address - b.address);
    return {
      total: all.length,
      truncated: all.length > limit,
      comments: all.slice(0, limit).map((c) => ({
        // Without the id nothing downstream is reachable: editing, moving and
        // removing are all by id, because an address identifies no single one.
        id: c.id,
        address: hex4(c.address),
        placement: c.placement,
        text: c.text,
        ...(c.order === undefined ? {} : { order: c.order }),
      })),
    };
  }

  /** The decoders this project carries, with their source. */
  /**
   * Where a captured file's bytes actually are.
   *
   * The route has existed since the browser needed binaries; nothing told a
   * caller about it. That is experiment 4's finding repeating — an agent went
   * looking for `save_project`, found nothing, and located `POST /api/export`
   * by reading the server's source — so a capture now says where to GET it
   * rather than leaving it to be discovered.
   *
   * A URL rather than the bytes, for the reason `prepare_upload` takes one: a
   * captured screen is a few hundred kilobytes of pixel data, and base64 of it
   * through a tool result is tens of thousands of tokens for something the
   * caller is going to hand to an image library anyway.
   */
  private blobUrl(name: string): string {
    return (
      `${this.room.baseUrl ?? ""}/api/blob?project=${encodeURIComponent(this.room.projectId)}` +
      `&path=${encodeURIComponent(name)}`
    );
  }

  /**
   * What has been said about a claim: evidence for it, against it, or replacing it.
   *
   * The read half of the thing experiment-0's agents could not express. Filtered
   * by claim, because "what backs this" is the question — "everything anybody
   * has ever noted" is not.
   */
  evidenceFor(claim?: string): {
    total: number;
    evidence: {
      id: string;
      claim: string;
      kind: string;
      scenario?: string;
      capture?: string;
      other?: string;
      note?: string;
    }[];
  } {
    const all = this.program().loaded.project.evidence ?? [];
    const found = claim === undefined ? all : all.filter((e) => e.claim === claim);
    return {
      total: found.length,
      evidence: found.map((e) => ({
        id: e.id ?? "",
        claim: e.claim,
        kind: e.kind,
        ...(e.scenario === undefined ? {} : { scenario: e.scenario }),
        ...(e.capture === undefined ? {} : { capture: e.capture }),
        ...(e.other === undefined ? {} : { other: e.other }),
        ...(e.note === undefined ? {} : { note: e.note }),
      })),
    };
  }

  addEvidence(
    caller: Caller,
    claim: string,
    kind: EvidenceKind,
    about: { scenario?: string; capture?: string; other?: string; note?: string }
  ): EditResult & { evidence: string } {
    const loaded = this.program().loaded;
    if (!claimById(loaded, claim)) {
      throw new Error(`No claim ${claim}. claims_at reports what covers an address, with ids.`);
    }
    if (about.other !== undefined && !claimById(loaded, about.other)) {
      throw new Error(`No claim ${about.other} to point at. list_claims shows the ids.`);
    }
    if (
      about.scenario !== undefined &&
      !(loaded.project.scenarios ?? []).some((x) => x.id === about.scenario)
    ) {
      throw new Error(`No scenario ${about.scenario}. list_scenarios shows what there is.`);
    }
    // A refutation or a supersession that names nothing is an opinion with no
    // handle on it: the whole point is that a reader can follow it.
    if (
      (kind === "refutes" || kind === "supersedes") &&
      about.other === undefined &&
      about.note === undefined
    ) {
      throw new Error(
        `A ${kind} needs something to point at: another claim (\`other\`), or a note ` +
          `saying why. Otherwise nobody reading it can tell what was wrong.`
      );
    }

    const id = newId("evd");
    const result = this.edit(caller, () => [
      {
        op: "evidence.add",
        id,
        claim,
        kind,
        ...(about.scenario === undefined ? {} : { scenario: about.scenario }),
        ...(about.capture === undefined ? {} : { capture: about.capture }),
        ...(about.other === undefined ? {} : { other: about.other }),
        ...(about.note === undefined ? {} : { note: about.note }),
      },
    ]);
    return { ...result, evidence: id };
  }

  editEvidence(
    caller: Caller,
    id: string,
    fields: {
      kind?: EvidenceKind;
      scenario?: string | null;
      capture?: string | null;
      other?: string | null;
      note?: string | null;
    }
  ): EditResult & { evidence: string } {
    this.mustHold(this.program().loaded.project.evidence ?? [], id, "evidence", "list_evidence");
    if (Object.values(fields).every((v) => v === undefined)) {
      throw new Error("Give at least one field to change: kind, scenario, capture, other, note.");
    }
    const result = this.edit(caller, () => [{ op: "evidence.set", id, fields }]);
    return { ...result, evidence: id };
  }

  removeEvidence(caller: Caller, id: string): EditResult {
    this.mustHold(this.program().loaded.project.evidence ?? [], id, "evidence", "list_evidence");
    return this.edit(caller, () => [{ op: "evidence.remove", id }]);
  }

  /** Every workflow this project carries, and what each produced. */
  scenarios(): {
    total: number;
    scenarios: {
      id: string;
      name: string;
      description?: string;
      steps: ProjectStep[];
      captures: { id: string; step: string; kind: string; file: string; url: string }[];
    }[];
  } {
    const project = this.program().loaded.project;
    const captures = project.captures ?? [];
    const all = project.scenarios ?? [];
    return {
      total: all.length,
      scenarios: all.map((x) => ({
        id: x.id ?? "",
        name: x.name,
        ...(x.description === undefined ? {} : { description: x.description }),
        steps: x.steps,
        // The captures beside the scenario that made them, because a workflow
        // whose output you have to go looking for is one nobody re-runs.
        captures: captures
          .filter((c) => c.scenario === x.id)
          .map((c) => ({
            id: c.id ?? "",
            step: c.step,
            kind: c.kind,
            file: c.file,
            url: this.blobUrl(c.file),
          })),
      })),
    };
  }

  addScenario(
    caller: Caller,
    name: string,
    steps: ProjectStep[],
    description?: string
  ): EditResult & { scenario: string } {
    if (steps.length === 0) throw new Error("A scenario with no steps does nothing.");
    const id = newId("scn");
    // Steps are minted here, like every other id on this surface: a caller
    // never supplies one for a thing that does not exist.
    const withIds = steps.map((step) => ({ ...step, id: step.id ?? newId("stp") }));
    const result = this.edit(caller, () => [
      {
        op: "scenario.add",
        id,
        name,
        ...(description === undefined ? {} : { description }),
        steps: withIds,
      },
    ]);
    return { ...result, scenario: id };
  }

  editScenario(
    caller: Caller,
    id: string,
    fields: { name?: string; description?: string | null; steps?: ProjectStep[] }
  ): EditResult & { scenario: string } {
    this.mustHold(this.program().loaded.project.scenarios ?? [], id, "scenario", "list_scenarios");
    if (Object.values(fields).every((v) => v === undefined)) {
      throw new Error("Give at least one field to change: name, description, steps.");
    }
    const result = this.edit(caller, () => [
      {
        op: "scenario.set",
        id,
        fields: {
          ...(fields.name === undefined ? {} : { name: fields.name }),
          ...(fields.description === undefined ? {} : { description: fields.description }),
          ...(fields.steps === undefined
            ? {}
            : { steps: fields.steps.map((step) => ({ ...step, id: step.id ?? newId("stp") })) }),
        },
      },
    ]);
    return { ...result, scenario: id };
  }

  removeScenario(caller: Caller, id: string): EditResult {
    this.mustHold(this.program().loaded.project.scenarios ?? [], id, "scenario", "list_scenarios");
    return this.edit(caller, () => [{ op: "scenario.remove", id }]);
  }

  /**
   * Run a scenario, and keep what it produced.
   *
   * **One method, not twenty.** Everything the machine can be asked to do is a
   * step in the scenario rather than a tool of its own, which is what stops this
   * surface growing a call per capability — and it is why the scenario had to be
   * a list of typed steps rather than a script.
   *
   * The bytes of a capture go through `putBlob`, exactly as `run_program`'s
   * capture already does, so the document holds a reference and the blob store
   * dedups. A `capture` record then says which step made which file.
   */
  runScenario(caller: Caller, id: string): Record<string, unknown> {
    const loaded = this.program().loaded;
    const scenario = this.mustHold(
      loaded.project.scenarios ?? [],
      id,
      "scenario",
      "list_scenarios"
    );

    const storage = this.room.storage;
    const characters =
      storage instanceof SqliteStorage ? nodeRomBytes()("characters") : undefined;

    const run = coreRunScenario(loaded.map, scenario, {
      // The same fingerprint the analysis cache keys on, so a changed project
      // can never read a stale machine.
      fingerprint: this.version(),
      cache: this.room.machines,
      ...(characters ? { characters } : {}),
    });

    const kept: {
      id: string;
      step: string;
      kind: string;
      file: string;
      bytes: number;
      url: string;
    }[] = [];
    if (run.captures.length) {
      if (!(storage instanceof SqliteStorage)) {
        throw new Error("Capturing needs a database; this server holds one file.");
      }
      const ops: Op[] = [];
      for (const capture of run.captures) {
        const hash = storage.putBlob(capture.name, capture.bytes);
        const captureId = newId("cap");
        ops.push(
          { op: "file.add", name: capture.name, hash, size: capture.bytes.length },
          {
            op: "capture.add",
            id: captureId,
            scenario: id,
            step: capture.step,
            kind: capture.kind,
            file: capture.name,
            when: Date.now(),
          }
        );
        kept.push({
          id: captureId,
          step: capture.step,
          kind: capture.kind,
          file: capture.name,
          bytes: capture.bytes.length,
          url: this.blobUrl(capture.name),
        });
      }
      this.edit(caller, () => ops);
    }

    return {
      scenario: id,
      did: run.did,
      // A probe's verdict. A claim pointing at this scenario as evidence is
      // backed by a check that can be re-run, rather than by a sentence
      // somebody wrote in a document once.
      ...(run.checks.length ? { checks: run.checks, passed: run.passed } : {}),
      stopped: {
        reason: run.outcome.reason,
        at: hex4(run.outcome.at),
        frames: run.outcome.frames,
        cycles: run.outcome.cycles,
        instructions: run.outcome.instructions,
        ...(run.outcome.detail ? { detail: run.outcome.detail } : {}),
      },
      ...(kept.length ? { captured: kept } : {}),
      ...(run.warnings.length ? { warnings: run.warnings } : {}),
    };
  }

  decoders(): { total: number; decoders: { id: string; name: string; source: string }[] } {
    const all = this.program().loaded.project.decoders ?? [];
    return {
      total: all.length,
      decoders: all.map((d) => ({ id: d.id ?? "", name: d.name, source: d.source })),
    };
  }

  /**
   * Keep a decoder in the project, so it can be used again and by somebody else.
   *
   * At project level for the same reason a constant declaration is: it
   * describes no bytes, so there is no layer for it to move with when the stack
   * is reordered. A *use* — a region's `view: "snippet:<id>"` — does belong to a
   * layer, because that is about those bytes.
   */
  addDecoder(caller: Caller, name: string, source: string): EditResult & { decoder: string } {
    // Minted here and returned. A claim refers to a decoder by id
    // (`view: "snippet:<id>"`), so writing one and then calling list_decoders to
    // find out what it was called is a round trip for something this call
    // already knew — and two agents in one run made the same decoder twice
    // looking for it.
    const decoder = newId("dec");
    const result = this.edit(caller, () => [
      { op: "decoder.add", id: decoder, name, source },
    ]);
    return { ...result, decoder };
  }

  /** Revise a decoder by id. An id nothing holds is not found; it never creates. */
  editDecoder(
    caller: Caller,
    id: string,
    fields: { name?: string; source?: string }
  ): EditResult & { decoder: string } {
    this.mustHold((this.program().loaded.project.decoders ?? []), id, "decoder", "list_decoders");
    if (fields.name === undefined && fields.source === undefined) {
      throw new Error("Give at least one field to change: name, source.");
    }
    const result = this.edit(caller, () => [{ op: "decoder.set", id, fields }]);
    return { ...result, decoder: id };
  }

/**
   * Declare a record layout, or revise one by id.
   *
   * Additive from the start, which is the rule this project has now applied
   * four times after being caught three: `add_type` mints and returns an id,
   * `edit_type` corrects by that id. Keying a write by *name* is what made
   * `set_constant` and `set_decoder` fail the offline/online test — a reader who
   * had synced somebody else's declaration of that name replaced it, one who had
   * not made a second, so the same call did two different things depending on
   * what had reached you.
   *
   * Fields are given whole rather than one at a time, because a layout is a
   * small value a caller sends the shape of. What merges per-field is the CRDT
   * map underneath: two readers adding different offsets to one record both
   * survive without either saying so.
   */
  setType(
    caller: Caller,
    type: {
      name: string;
      size: number;
      fields: Record<string, { name: string; type: string; description?: string }>;
      unit?: "bytes" | "bits";
      id?: string;
    }
  ): EditResult & { type: string } {
    const declared = this.program().loaded.project.types ?? [];
    const existing =
      type.id === undefined ? undefined : declared.find((t) => t.id === type.id);
    if (type.id !== undefined && !existing) {
      throw new Error(`No type ${type.id}. list_types shows what this project has.`);
    }

    // An edit that does not restate the unit keeps the one the type has. A
    // bit record whose offsets started being read as bytes halfway through an
    // edit would reject every field it already held.
    const unit = type.unit ?? existing?.unit;
    const idForName = (name: string) => declared.find((t) => t.name === name)?.id;
    // A count written as a constant — `u8[LevelCount]` — resolved through the
    // one constant with that name. Two with the same name resolve to neither,
    // which `byName` already decides: declaring is additive, so a name is not
    // an identity, and a layout is not the place to guess which was meant.
    const countForName = (name: string) => {
      const found = this.program().loaded.constants.byName(name);
      return found === undefined ? undefined : { id: found.id, value: found.value };
    };
    // `address`, not `offset`, because every batch tool here reports what it
    // declined in one shape and the shape is the contract. The value is spelled
    // as an offset — `+$A0` — so nobody reads it as an address in memory.
    const rejected: { address: string; reason: string }[] = [];
    const fields: Record<number, TypeField> = {};

    for (const [key, field] of Object.entries(type.fields)) {
      const offset = parseProjectAddress(key);
      if (!Number.isFinite(offset) || offset < 0) {
        rejected.push({ address: key, reason: "not an offset" });
        continue;
      }
      // A bit record's offsets count bits, and `size` still counts bytes — so
      // the bound is eight times as far, and that is the only place the unit
      // changes anything on this path.
      const bound = unit === "bits" ? type.size * 8 : type.size;
      if (offset >= bound) {
        rejected.push({
          address: key,
          reason:
            unit === "bits"
              ? `outside a ${type.size}-byte record, which is ${bound} bits`
              : `outside a ${type.size}-byte record`,
        });
        continue;
      }
      // A fact about the request, which is the only kind of reason a write here
      // may refuse for — and partial, like every batch: one bad field must not
      // lose the nineteen somebody proved from a copy routine.
      const parsed = parseFieldType(field.type, idForName, countForName);
      if ("error" in parsed) {
        rejected.push({ address: key, reason: parsed.error });
        continue;
      }
      // `bits(n)` needs somewhere to sit, and a byte-addressed record has no
      // sub-byte offsets to give it. Refused rather than rounded up, because a
      // field silently taking a whole byte would be a confident wrong answer
      // about every field after it.
      const widthInBits = fieldBits(parsed, (id) => {
        const held = declared.find((t) => t.id === id)?.size;
        return typeof held === "string" ? Number.parseInt(held.replace("$", ""), 16) : held;
      });
      if (unit !== "bits" && holdsBits(parsed)) {
        rejected.push({
          address: key,
          reason: `bits(n) needs a record whose offsets count bits: declare it unit:"bits"`,
        });
        continue;
      }
      if (widthInBits !== undefined && offset + (unit === "bits" ? widthInBits : 0) > bound) {
        rejected.push({
          address: key,
          reason: `${field.name} is ${widthInBits} bits and would run past bit ${bound}`,
        });
        continue;
      }
      // Minted here: a field is addressed on its own, and no caller supplies
      // an id for something that does not exist yet.
      fields[offset] = { ...field, id: existing?.fields?.[String(offset)]?.id ?? newId("fld") };
    }

    if (Object.keys(fields).length === 0 && Object.keys(type.fields).length > 0) {
      throw new Error(
        `None of the ${Object.keys(type.fields).length} fields could be declared. ` +
          rejected.map((r) => `${r.address}: ${r.reason}`).join(" ")
      );
    }

    // `add` mints and returns; `set` revises the id it was given and never
    // creates one. Fields merge by offset, so revising a layout does not
    // silently drop a field a collaborator added at another offset.
    const id = existing?.id ?? newId("typ");
    const result = this.edit(caller, () =>
      existing
        ? [
            {
              op: "type.set" as const,
              id,
              fields: {
                name: type.name,
                size: type.size,
                ...(unit === undefined ? {} : { unit }),
                fields,
              },
            },
          ]
        : [
            {
              op: "type.add" as const,
              id,
              name: type.name,
              size: type.size,
              ...(unit === undefined ? {} : { unit }),
              fields,
            },
          ]
    );
    return { ...result, type: id, ...(rejected.length ? { rejected } : {}) };
  }

  removeType(caller: Caller, id: string): EditResult {
    const found = (this.program().loaded.project.types ?? []).find((t) => t.id === id);
    if (!found) throw new Error(`No type ${id}. list_types shows what this project has.`);
    // A claim referencing a type that has gone renders its bytes, exactly as a
    // dangling constant renders the literal — so there is no sweep to do, and a
    // delete racing a reference heals itself.
    return this.edit(caller, () => [{ op: "type.remove", id }]);
  }

  /**
   * Every record layout this project declares, and where each is meant.
   *
   * The use sites are the half that makes it usable: `list_constants` grew
   * `boundAt` because two readers bound one constant in two places without
   * either being able to see the other had.
   */
  listTypes(): {
    total: number;
    types: {
      id: string;
      name: string;
      size: number;
      fields: { offset: string; name: string; type: string; description?: string }[];
      unexplainedBytes: number;
      usedAt: string[];
    }[];
  } {
    const loaded = this.program().loaded;
    const index = loaded.types;

    return {
      total: index.size,
      types: index.all().map((type) => {
        const laid = index.layout(type.id);
        const covered = laid.reduce(
          (sum, { field }) => sum + (fieldSize(field.type, index.sizeOf) ?? 0),
          0
        );
        return {
          id: type.id,
          name: type.name,
          size: type.size,
          // Said out loud, because it changes what every offset below means.
          ...(type.unit === undefined ? {} : { unit: type.unit }),
          fields: laid.map(({ offset, field }) => ({
            offset: `+$${offset.toString(16).toUpperCase().padStart(2, "0")}`,
            name: field.name,
            type: formatFieldType(
              field.type,
              (id) => index.get(id)?.name,
              (id) => loaded.constants.get(id)?.name
            ),
            ...(field.description === undefined ? {} : { description: field.description }),
          })),
          // Holes are legal and are the point: a reader who has proved nineteen
          // fields of a 200-byte record has said something true, and this says
          // how much is left rather than pretending the record is finished.
          unexplainedBytes: Math.max(0, type.size - covered),
          usedAt: loaded.claims
            .filter((c) => c.says?.is === "record" && c.says.typeId === type.id)
            .map((c) => hex4(c.at)),
        };
      }),
    };
  }

  removeDecoder(caller: Caller, id: string): EditResult {
    const found = (this.program().loaded.project.decoders ?? []).find((d) => d.id === id);
    if (!found) throw new Error(`No decoder ${id}. list_decoders shows what this project has.`);
    return this.edit(caller, () => [{ op: "decoder.remove", id }]);
  }

  /**
   * What an address *is*, in the units the machine uses.
   *
   * The direction the address sugar cannot serve. `screen(10,2)` gets you to
   * `$0592`; reading a listing and asking "which cell is this" is the question
   * experiment 8's readers actually repeated, and it has no answer you can
   * write into an argument.
   *
   * It is also where the assumptions get said out loud. Both conversions depend
   * on runtime state — the screen base in `$D018`, the VIC bank in `$DD00` —
   * which is not a property of the project, so an answer that did not name the
   * bases it used would be a confident wrong answer for any program that moved
   * its screen.
   */
  where(
    address: number,
    screenBase?: number,
    bank?: number,
    mask?: number
  ): Record<string, unknown> {
    const base = screenBase ?? DEFAULT_SCREEN_BASE;
    const vicBank = bank ?? 0;
    const cell = screenCell(address, base);
    const sprite = spriteAt(address, vicBank);
    const map = this.program().loaded.map;
    const byte = map.readByte(address);

    // **The two bytes here, read as an address.**
    //
    // The most repeated hand-arithmetic of experiment 10 after the places
    // themselves: reader two did it three times — a jump table's entries, two
    // music pointer pairs, a screen row to its colour-RAM twin — and said "there
    // is no tool here that resolves 'the word at this address, read as an
    // address' for me". The editor did it four more times from pairs of
    // immediates in code, which is the harder half and still is.
    //
    // Little-endian first because that is what the machine is; the other order
    // is offered because a hand-written table need not be, which is the same
    // reason `ptr` and `ptrbe` are two field types rather than a type and a
    // flag.
    const lo = map.readByte(address);
    const hi = map.readByte((address + 1) & 0xffff);
    const word =
      lo === undefined || hi === undefined
        ? undefined
        : {
            little: hex4(lo | (hi << 8)),
            big: hex4((lo << 8) | hi),
            // What that address is called, if anything — which is the point:
            // a pointer resolves, and a listing can only show it if it does.
            namedLittle: this.program().labels.resolve(lo | (hi << 8))?.label.name,
          };

    return {
      address: hex4(address),
      ...(byte === undefined
        ? { unmapped: true, note: "No layer in this view supplies this address." }
        : { byte: hex2(byte) }),
      screen:
        cell === undefined
          ? undefined
          : {
              row: cell.row,
              column: cell.column,
              cell: cell.cell,
              colourRam: hex4(cell.colourRam),
              // The answer written so it can be pasted straight back into any
              // address argument. Without it this direction stops at a pair of
              // numbers the caller has to reassemble by hand — which is the
              // arithmetic the places exist to remove, in the other direction.
              place: placeText("screen", [cell.row, cell.column], base, DEFAULT_SCREEN_BASE),
            },
      sprite:
        sprite === undefined
          ? undefined
          : {
              pointer: hex2(sprite.pointer),
              offset: sprite.offset,
              place: placeText("sprite", [sprite.pointer], vicBank, 0),
              // Only offset zero is a sprite's start. Anything else is the
              // middle of a picture, which is worth saying rather than leaving
              // a caller to notice the number is not zero.
              startsHere: sprite.offset === 0,
            },
      // Only where both bytes are there; a word running off the end of the map
      // is not a word.
      ...(word === undefined ? {} : { word }),
      ...(this.fieldAt(address) ?? {}),
      ...(this.registerAt(address, mask) ?? {}),
      assumed: {
        screenBase: hex4(base),
        vicBank: hex4(vicBank),
        note:
          "Both are runtime state — $D018 and $DD00 — not facts about the project. " +
          "Pass screenBase or bank if this program moved them.",
      },
    };
  }

  /**
   * Which field of which record an address is, written as a path.
   *
   * `zones[2].name`, and the same notation whether the array is the program's
   * or the machine's — which is why the places moved to brackets. It is the
   * half of "what is this address" that the model could answer and nothing
   * asked: a reader with a typed table still counted offsets by hand to work
   * out which of nineteen fields a `LDA ($3E),Y` was reaching.
   *
   * Silent where a record claim does not cover the address, and silent inside a
   * hole, because a hole is a real gap in interpretation and naming it would be
   * the confident wrong answer this project refuses.
   */
  private fieldAt(address: number): { field: { path: string; of: string } } | undefined {
    const program = this.program();
    for (const claim of program.loaded.claims) {
      if (claim.says?.is !== "record" || claim.extent === undefined) continue;
      if (address < claim.at || address >= claim.at + claim.extent) continue;
      const type = program.loaded.types.get(claim.says.typeId);
      if (!type || type.size <= 0) continue;

      const index = Math.floor((address - claim.at) / type.size);
      const found = pathAt(type, (address - claim.at) % type.size, program.loaded.types);
      if (!found) continue;

      // The array is named by the claim, so the path reads the way somebody
      // would say it out loud rather than starting at a type name.
      const array = claim.name ?? type.name;
      const within = found.within === 0 ? "" : ` + ${found.within}`;
      return { field: { path: `${array}[${index}]${found.path}${within}`, of: type.name } };
    }
    return undefined;
  }

  /**
   * What the bits of a hardware register mean, when the machine declares them.
   *
   * The other half of "what is this address", and the one three runs of readers
   * did by hand: `$D011` is not a byte, it is seven fields, and `AND #$80` is a
   * question about one of them. With a mask this names the fields that mask
   * touches — `SCROLY.rasterBit8` — which is the sentence a reader was writing
   * into a comment.
   *
   * Platform-owned, so it is reported separately from `field`: one is a fact
   * about the hardware and the other is something somebody in this project
   * said, and running them together would make it impossible to tell which.
   */
  private registerAt(
    address: number,
    mask?: number
  ): { register: Record<string, unknown> } | undefined {
    const found = registerAt(address);
    if (!found) return undefined;
    const byte = this.program().loaded.map.readByte(address);
    return {
      register: {
        name: found.type.name,
        // High bit first, because that is the order a byte is written in. The
        // offset is still the bit number, so b7 is the $80 one.
        bits: Object.entries(found.type.fields)
          .map(([key, field]) => ({ offset: Number(key), field }))
          .sort((a, b) => b.offset - a.offset)
          .map(({ offset, field }) => {
            const width = field.type.is === "bits" ? field.type.width : 8;
            const at = width === 1 ? `b${offset}` : `b${offset + width - 1}..${offset}`;
            const held =
              byte === undefined ? undefined : (byte >>> offset) & ((1 << width) - 1);
            return {
              at,
              name: field.name,
              ...(held === undefined ? {} : { value: held }),
              ...(field.description === undefined ? {} : { description: field.description }),
            };
          }),
        ...(mask === undefined
          ? {}
          : {
              mask: `$${mask.toString(16).toUpperCase().padStart(2, "0")}`,
              touches: fieldsInMask(address, mask),
            }),
      },
    };
  }

  /**
   * The span a claim covers, for a read that wants to be pointed at one.
   *
   * A named claim already holds where it starts, how far it runs and how to
   * draw it — which is exactly what `render` and `export_listing` ask for in
   * three arguments. Without this a name is a display string rather than a
   * handle: you name a sprite, and then still look its address up to draw it.
   *
   * An id nothing holds is an error, never a fallback, like every other id on
   * this surface. A claim with no extent is refused separately and by name,
   * because "this claim has no span" and "there is no such claim" lead
   * somewhere completely different.
   */
  private spanOf(claim: string): { at: number; extent: number; view?: string; name?: string } {
    const found = this.program().loaded.claims.find((c) => c.id === claim);
    if (!found) {
      throw new Error(`No claim ${claim}. claims_at and list_claims give ids.`);
    }
    if (found.extent === undefined) {
      throw new Error(
        `Claim ${claim}${found.name ? ` (${found.name})` : ""} covers a single address, ` +
          `not a span. Give it an extent with edit_claim, or pass start and length.`
      );
    }
    // `view` belongs to the interpretation — a claim says what the bytes *are*
    // and, for the two kinds that can be looked at, how to read them.
    const says = found.says;
    const view =
      says && (says.is === "bitmap" || says.is === "text") ? says.view : undefined;

    return {
      at: found.at,
      extent: found.extent,
      ...(view === undefined ? {} : { view }),
      ...(found.name === undefined ? {} : { name: found.name }),
    };
  }

  /**
   * Play a captured SID log, and hand back a recording.
   *
   * The last mile experiment 9 asked for by name. `capture: sid` was already
   * the right primitive — the editor said so — but there was no path from a
   * write log to something anyone could listen to, so it wrote its own
   * synthesiser from its reading of the game's *stream format* and got every
   * note the same length, wrong by a factor of seven. The log it needed was
   * already captured and already downloaded; what was missing was this.
   *
   * So the durations here are not modelled, they are transcribed: gate on to
   * gate off, at the cycle each write actually happened. `approximated` says
   * what is not — the waveform shape, the envelope curve, and the filter, which
   * is not modelled at all.
   */
  playSid(capture: string, seconds?: number): Record<string, unknown> {
    const captures = this.program().loaded.project.captures ?? [];
    const found = captures.find((c) => c.id === capture);
    if (!found) throw new Error(`No capture ${capture}. list_scenarios shows them.`);
    if (found.kind !== "sid") {
      throw new Error(
        `Capture ${capture} is ${found.kind}, not sid. Only a sound-chip log can be played.`
      );
    }

    const storage = this.room.storage;
    if (!(storage instanceof SqliteStorage)) {
      throw new Error("Playing needs a database; this server holds one file.");
    }
    const bytes = storage.blob(found.file);
    if (!bytes) throw new Error(`The bytes of ${found.file} are not in this database.`);

    const writes = JSON.parse(new TextDecoder().decode(bytes)) as SidWrite[];
    const audio = renderSid(writes, seconds === undefined ? {} : { seconds });
    const name = `render/${capture}${seconds === undefined ? "" : `-${seconds}s`}.wav`;
    const hash = storage.putBlob(name, encodeWav(audio.samples, audio.sampleRate));

    return {
      capture,
      from: found.file,
      writes: writes.length,
      notes: audio.gated,
      seconds: Number(audio.duration.toFixed(2)),
      sampleRate: audio.sampleRate,
      url: this.blobUrl(name),
      hash,
      exact: "when each note starts and stops, and its pitch — both read from the log",
      approximated: audio.approximated,
    };
  }

  /**
   * Read a span *as* something, without saying it is that.
   *
   * **The most repeated workaround of experiment 10.** Reader one decoded about
   * twenty strings by hand across six script runs before committing text
   * claims; reader two did a dozen more the same way, *and* probed undecoded
   * spans by force-adding `root: "routine"`, reading the result, and reverting
   * — twenty times, six of which had to be undone. Both asked for the same
   * thing independently: try a reading on a span without committing to it.
   *
   * `render` already did this for pictures, which is why nobody had to guess at
   * a bitmap. Text and code had no equivalent, so the only way to find out was
   * to write a claim and look — and a probe that writes is a probe that has to
   * be cleaned up, in a document somebody else is reading.
   *
   * It is also the read side of `add_type`, which both readers wanted from the
   * other direction: a declared layout could be shown in a listing and never
   * handed back decoded, so every question about a record meant re-parsing hex.
   *
   * Writes nothing, and says nothing about what the bytes *are* — that is what
   * `add_claim` is for, once you have looked.
   */
  preview(
    start: number,
    length: number,
    as: "text" | "code" | "record",
    options: { encoding?: TextEncoding; typeId?: string } = {}
  ): Record<string, unknown> {
    const program = this.program();
    const map = program.loaded.map;
    const read = map.readBytes(start, length);
    const missing = read.filter((b) => b === undefined).length;
    const common = {
      from: hex4(start),
      bytes: length,
      as,
      ...(missing ? { unmapped: missing } : {}),
      target: this.room.target ?? "default",
    };

    if (as === "text") {
      const encoding = options.encoding ?? "petscii";
      const bytes = read.map((b) => b ?? 0);
      const text = decodeText(bytes, encoding);
      // Every encoding at once when none was named, because the question is
      // usually "which of these is it" and answering one costs three round
      // trips to answer three.
      return {
        ...common,
        encoding,
        text,
        ...(options.encoding === undefined
          ? {
              alternatives: {
                petscii: decodeText(bytes, "petscii"),
                screen: decodeText(bytes, "screen"),
                ascii: decodeText(bytes, "ascii"),
                // A table of key positions is not text and reads as noise under
                // the other three — which is exactly why it belongs beside
                // them: the one column that comes out as words is the answer.
                keycode: decodeText(bytes, "keycode"),
              },
              note:
                "No encoding named, so all four are shown. Digits and space are " +
                "identical in petscii and screen, so only the letters tell those two " +
                "apart. `keycode` reads bytes as keyboard matrix positions, which is " +
                "what a key table holds. A program with its own character set is " +
                "unreadable by any of them — that is what a decoder is for.",
            }
          : {}),
      };
    }

    if (as === "code") {
      // A *linear* decode, deliberately: the question a probe asks is "would
      // these bytes be plausible instructions", not "where does control go".
      // Following flow would need a root, which is the write this exists to
      // avoid.
      const lines: string[] = [];
      let at = start;
      let undecodable = 0;
      let illegal = 0;
      while (at < start + length && lines.length < 200) {
        const decoded = decodeInstruction({ readByte: (a: number) => map.readByte(a) }, at);
        if (!decoded.ok) {
          lines.push(`${hex4(at)}  ??`);
          undecodable += 1;
          at += 1;
          continue;
        }
        const instruction = decoded.instruction;
        if (instruction.illegal) illegal += 1;
        lines.push(`${hex4(at)}  ${formatInstruction(instruction)}`);
        at += instruction.bytes.length;
      }
      return {
        ...common,
        lines,
        undecodable,
        illegal,
        // The honest summary, because the answer to "is this code" is a
        // judgement and this is the evidence for it rather than the verdict.
        note:
          `${undecodable} byte(s) did not decode and ${illegal} instruction(s) are ` +
          `undocumented opcodes. Data read as code usually shows both; real code ` +
          `usually shows neither. Nothing has been written — add_claim root: decides.`,
      };
    }

    const typeId = options.typeId;
    if (!typeId) throw new Error('Reading a span as a record needs a typeId. list_types has them.');
    const type = program.loaded.types.get(typeId);
    if (!type) throw new Error(`No type ${typeId}. list_types shows what this project declares.`);

    const count = Math.floor(length / type.size);
    if (count === 0) {
      throw new Error(
        `${length} bytes is less than one ${type.name}, which is ${type.size}.`
      );
    }

    const laid = program.loaded.types.layout(type.id);
    const records = Array.from({ length: Math.min(count, 64) }, (_unused, index) => {
      const at = start + index * type.size;
      const fields: Record<string, string> = {};
      for (const { offset, field } of laid) {
        const width = fieldSize(field.type, program.loaded.types.sizeOf) ?? 1;
        fields[field.name] = fieldValue(map, at + offset, field.type, width, program.labels);
      }
      return { at: hex4(at), index, fields };
    });

    return {
      ...common,
      type: type.name,
      size: type.size,
      // Derived, never stored — the same rule the listing follows.
      count,
      ...(count > records.length ? { shown: records.length } : {}),
      records,
    };
  }

  /**
   * Draw a span, and hand back a picture.
   *
   * **A read.** It writes nothing to the document, and that is the point: to
   * find out whether a span is a font or a sprite sheet you previously had to
   * add a claim, read the listing, then remove the claim and hunt down the
   * comments it made — which reader one in experiment 9 did, and counted the
   * calls. A person gets this loop for free in the explorer: point at an
   * address, slide the width, stop when a picture appears. Nothing offered it
   * to anyone else.
   *
   * **Two layouts of the same decode**, because they answer different
   * questions. `grid` is a contact sheet — every cell at once, which is how you
   * compare them and how experiment 9's editor found the camel walk cycle, the
   * signature, the payphone, the Pac-Man ghosts and the peace symbol in one
   * plate of 112 blocks. `frames` is the same cells as an animation, which is
   * how you see a walk cycle *move*. Neither replaces the other: a sheet is
   * evidence, an animation is the effect.
   *
   * The PNG goes through `putBlob` and comes back as a URL, for the reason a
   * capture does — an image inline is tens of thousands of tokens for something
   * the caller hands to an image viewer anyway. It is stored without a
   * `file.add`, so a preview costs the document nothing; the blob store is
   * content-addressed, so drawing the same span twice keeps one copy.
   */
  render(request: {
    start?: number;
    length?: number;
    view?: string;
    claim?: string;
    as?: "grid" | "frames";
    delayMs?: number;
  }): Record<string, unknown> {
    const as = request.as ?? "grid";
    const delayMs = request.delayMs ?? 120;

    // Either a claim or a span, and saying both is a fact about the request
    // rather than a judgement about the result — so it is one of the few things
    // a read here refuses.
    if (request.claim !== undefined && request.start !== undefined) {
      throw new Error("Give either a claim or a start, not both.");
    }

    let start: number;
    let length: number;
    let view: string;
    let named: string | undefined;

    if (request.claim !== undefined) {
      const span = this.spanOf(request.claim);
      start = span.at;
      length = span.extent;
      named = span.name;
      // The claim's own view unless the caller overrides it, which is the case
      // worth having: hires and multicolour is a per-sprite bit the program
      // sets at run time and is not in the data, so trying the other one must
      // not mean editing the claim first.
      const chosen = request.view ?? span.view;
      if (chosen === undefined) {
        throw new Error(
          `Claim ${request.claim}${named ? ` (${named})` : ""} says nothing about how to ` +
            `draw it. Pass a view, or give the claim one with edit_claim.`
        );
      }
      view = chosen;
    } else {
      if (request.start === undefined || request.length === undefined || request.view === undefined) {
        throw new Error("Give a claim, or a start, a length and a view.");
      }
      start = request.start;
      length = request.length;
      view = request.view;
    }

    const options = parseBitmapView(view);
    if (!options) {
      throw new Error(
        `${view} is not a view this can draw. Use bits:<bytes-per-row>, char:<columns>, ` +
          `sprite:<columns> or sprite-multi:<columns>.`
      );
    }

    const bytes = this.program().loaded.map.readBytes(start, length);
    const supplied = bytes.filter((byte) => byte !== undefined).length;
    const format = options.format ?? "bits";
    const cells = format === "bits" ? 1 : cellCount(format, length);
    if (cells === 0) {
      throw new Error(
        `${length} bytes is not enough for one ${format}; it needs at least ` +
          `${format === "char" ? 8 : 63}.`
      );
    }

    const name = `render/${this.room.target ?? "default"}-${hex4(start)}-${length}-${view.replace(/:/g, "-")}-${as}.png`;
    const storage = this.room.storage;
    if (!(storage instanceof SqliteStorage)) {
      throw new Error("Drawing needs a database; this server holds one file.");
    }

    let picture: Bitmap;
    let png: Uint8Array;
    if (as === "frames" && format !== "bits") {
      // One cell per frame, each decoded on its own so the animation is the
      // cells in order rather than a sheet that happens to move.
      const pitch = bytesPerCell(options);
      const frames = Array.from({ length: cells }, (_unused, index) =>
        decodeBitmap(bytes.slice(index * pitch, index * pitch + pitch), {
          ...options,
          columns: 1,
        })
      );
      picture = frames[0];
      png = encodeApng(frames, delayMs);
    } else {
      picture = decodeBitmap(bytes, options);
      png = encodePng(picture);
    }

    const hash = storage.putBlob(name, png);

    // Text art only while it is small enough to be worth the tokens. A contact
    // sheet of a hundred sprites as shaded characters is a hundred thousand
    // characters of output nobody reads, and the URL is the answer for that
    // case — said rather than silently omitted.
    const drawable = picture.width * picture.height <= 24 * 21 * 4;

    return {
      from: hex4(start),
      bytes: length,
      view,
      as,
      cells,
      width: picture.width,
      height: picture.height,
      ...(as === "frames" ? { frames: cells, delayMs } : {}),
      url: this.blobUrl(name),
      hash,
      ...(request.claim === undefined ? {} : { claim: request.claim }),
      ...(named === undefined ? {} : { name: named }),
      target: this.room.target ?? "default",
      ...(supplied < length
        ? { unmapped: length - supplied, note: "Bytes no layer supplies were drawn as zero." }
        : {}),
      ...(drawable
        ? { picture: bitmapToText(picture) }
        : {
            note2:
              "Too big to draw as text; fetch the url. " +
              "A sheet this size is meant to be looked at rather than read.",
          }),
    };
  }

  /**
   * Run a decoder over a span, and describe what came out.
   *
   * The escape hatch that stops this growing a mechanism per oddity. A character
   * set is a permutation and a sprite is a bitmap — both are built in — but a
   * title screen packed with run-length encoding and partial frame updates is
   * assembler logic, and the only honest way to express that is code.
   *
   * A bitmap comes back as **text art**, because the caller may be something
   * that cannot look at pixels. That is the same reasoning as everywhere else
   * here: the decoder returns data, and each consumer renders it its own way.
   */
  async decode(
    source: string,
    start: number,
    length: number,
    params: Record<string, unknown> = {}
  ): Promise<Record<string, unknown>> {
    const bytes = this.program().loaded.map.readBytes(start, length);
    const result = await runDecoder(source, bytes, params);

    if (!result.ok || !result.decoded) {
      return { ok: false, why: result.why, ms: result.ms };
    }

    const decoded = result.decoded;
    const common = { ok: true, ms: result.ms, from: hex4(start), bytes: length };

    if (decoded.kind === "bitmap") {
      return { ...common, kind: "bitmap", width: decoded.width, height: decoded.height,
               picture: bitmapToText(decoded) };
    }
    if (decoded.kind === "frames") {
      return {
        ...common,
        kind: "frames",
        frames: decoded.frames.length,
        delayMs: decoded.delayMs,
        width: decoded.frames[0].width,
        height: decoded.frames[0].height,
        // One frame drawn, because thirty would be unreadable and the count
        // plus the first is what says whether the decode worked.
        firstFrame: bitmapToText(decoded.frames[0]),
      };
    }
    return { ...common, kind: "text", lines: decoded.lines };
  }

  /**
   * What a routine touches — its own code, and everything it calls.
   *
   * The question naming one requires, and the first answer here that crosses a
   * call. Its extent is *derived*: 20 of the 50 routines in the reference
   * project are not one contiguous span, one of them tail-jumping across a
   * 2602-byte hole, so a declared extent could not have described them.
   *
   * A **may** answer — everything the routine can touch. An intersection over
   * paths is often unanswerable, and a "must" that is quietly sometimes a "may"
   * is worse than not offering one.
   */
  /**
   * What the code at an address touches, over a scope the caller names.
   *
   * How far to look is a property of the *question*, not of the program, and it
   * used to be baked into two tool names and two result fields — so an agent had
   * to discover by trial that `block_effects` at a routine head answers about one
   * instruction and that the whole-routine answer lived somewhere else. One axis
   * instead, and the tool that used to apologise for its own scope does not have
   * to.
   *
   * The four points differ in what they assume, which is why the answer says
   * which one it is rather than only the numbers:
   *
   * - `block` is exact. A block is straight-line, so every instruction in it
   *   runs and there is no path to have chosen.
   * - `routine` and beyond are unions over paths — what the code *can* touch,
   *   never what it must.
   * - `returning` is the same union, refusing to enter a callee that never comes
   *   back, and naming every place it stopped.
   */
  effects(address: number, follow: EffectScope = "calls"): EffectsAnswer {
    const program = this.program();

    const name = (at: number) => {
      const label = program.labels.resolve(at);
      return label && label.offset === 0 ? `${hex4(at)} (${label.label.name})` : hex4(at);
    };
    // `$(0xD)` is the IL's own notation and appears nowhere else a reader looks.
    // A memory slot is an address, and an address in this project usually has a
    // name — saying `frameCounter` costs a lookup and saves a translation.
    const slot = (node: Parameters<typeof formatVarnode>[0]) => {
      if (node.space !== "ram") return formatVarnode(node);
      const label = program.labels.resolve(node.offset);
      return label && label.offset === 0
        ? `${label.label.name} (${hex4(node.offset)})`
        : hex4(node.offset);
    };
    const flagNames = (offsets: number[]) =>
      offsets.map((offset) => REGISTER_NAMES[offset] ?? String(offset));

    if (follow === "block") {
      const block = this.blockCovering(address);
      const effects = blockEffects(block.instructions);
      const described = describeEffects(effects);
      return {
        scope: "block",
        covers: {
          start: hex4(block.start),
          end: hex4(block.end),
          instructions: block.instructions.length,
          exit: block.exit,
        },
        reads: described.reads,
        writes: described.writes,
        flags: flagNames(effects.flags),
        unmodelled: effects.unmodelled.map((u) => ({ at: hex4(u.address), mnemonic: u.mnemonic })),
        note:
          effects.unmodelled.length > 0
            ? "An instruction here has no modelled semantics, so these lists are " +
              "incomplete by an unknown amount."
            : "Exact: a block is straight-line, so this holds for every input.",
      };
    }

    const routines = this.routines();
    // The address of any block in a routine is a fair way to ask about it — a
    // reader has a line, not necessarily an entry point.
    const found = routines.get(address) ?? routineAt(routines, program.blocks, address);
    if (!found) {
      throw new Error(
        `${hex4(address)} is not in a routine this can see. A routine starts where ` +
          `something calls it, or where mark_function says one starts — and this ` +
          `address is in neither. For the straight-line block at this address, ` +
          `ask with follow: "block".`
      );
    }

    const chosen =
      follow === "routine" ? found.own : follow === "returning" ? found.returning : found.total;

    return {
      scope: follow,
      routine: name(found.entry),
      covers: {
        blocks: found.blocks,
        // More than one whenever it tail-jumps away, which is why no single
        // declared span could have described it.
        spans: found.spans.map((sp) => `${hex4(sp.start)}-${hex4(sp.end - 1)}`),
      },
      reads: [
        ...chosen.reads.map(slot),
        ...(chosen.readsComputedMemory ? ["memory at a computed address"] : []),
      ],
      writes: [
        ...chosen.writes.map(slot),
        ...(chosen.writesComputedMemory ? ["memory at a computed address"] : []),
      ],
      flags: flagNames(chosen.flags),
      calls: found.calls.map(name),
      // Only under `returning`, where it is the whole point: these are the
      // places the walk stopped, and asking about one of them gives the rest.
      ...(follow === "returning" && found.cut.length > 0
        ? { stoppedAt: found.cut.map(name) }
        : {}),
      // Derived from the stack delta, which knows exactly: a block is
      // straight-line, so how far the stack moved needs no guessing.
      returns: found.returns.length > 0 ? found.returns.map((r) => r.why) : undefined,
      // Both halves: the kind is what a caller decides on, the sentence is what
      // a reader sees. Handing over only prose meant an agent that knows a
      // routine is harmless had nothing to match on but a string.
      incomplete:
        found.incomplete.length > 0
          ? found.incomplete.map((gap) => ({ ...gap, why: describeGap(gap) }))
          : undefined,
      note:
        follow === "returning"
          ? "What it can touch without entering anything that never comes back. " +
            "Not a claim that control stops there — stoppedAt names every place " +
            "it did, and asking about one gives the rest."
          : "Everything this routine *can* touch, not what it must. Reachability " +
            "is static, so a computed jump or an RTS-dispatch leads somewhere " +
            "this cannot follow — see list_warnings.",
    };
  }

  /**
   * Run the block at an address with values somebody chose, and report what
   * came out.
   *
   * The complement of `blockEffects`: that says which slots a block touches for
   * every input, this says what happens to them for one. Reading `LDA $D012 /
   * AND #$07 / CMP #$03` tells you the shape; running it with `$D012 = $2A`
   * tells you it takes the branch, which is often the faster route to what the
   * code is for.
   *
   * Deliberately one block and not a routine. A block has no branch inside it,
   * so the instructions that run are known before it starts and no path was
   * chosen on the caller's behalf; running further means following jumps whose
   * targets depend on state nobody supplied, which is an emulator and has to be
   * right about everything an emulator is right about.
   *
   * Every result carries what it rests on — memory read but never given, an
   * instruction with no semantics, decimal arithmetic — because a result that
   * silently assumed zeros looks exactly like one that did not.
   */
  runBlock(
    address: number,
    inputs: { registers?: Record<string, number>; memory?: Record<string, number> } = {}
  ): {
    block: { start: string; end: string };
    executed: { address: string; text: string }[];
    registers: Record<string, string>;
    changed: string[];
    memoryRead: { address: string; value: string; source: string; label?: string }[];
    memoryWritten: { address: string; value: string; label?: string }[];
    exit: Record<string, unknown>;
    warnings: string[];
  } {
    const program = this.program();
    const block = this.blockCovering(address);

    const memory: Record<number, number> = {};
    for (const [key, value] of Object.entries(inputs.memory ?? {})) {
      memory[parseProjectAddress(key)] = value & 0xff;
    }

    const run = runBlock(block, {
      registers: inputs.registers as never,
      memory,
      // The program as loaded stands behind anything the caller did not pin
      // down, and is reported as such: a constant table really does hold these
      // bytes, and zero page really does not.
      image: (at) => program.loaded.map.readByte(at),
    });

    // Exact matches, or inside a declared extent — `an array label+2` is
    // the useful answer for an indexed read and is not a guess, because the
    // extent was declared. A merely *nearby* label is dropped: attaching
    // "SpriteTable" to an address six bytes past it reads as a fact.
    const name = (at: number) => {
      const found = program.labels.resolve(at);
      if (!found) return undefined;
      if (found.offset === 0) return found.label.name;
      return found.within ? `${found.label.name}+${found.offset}` : undefined;
    };
    const byte = (v: number) => `$${v.toString(16).toUpperCase().padStart(2, "0")}`;

    const registers: Record<string, string> = {};
    for (const key of Object.keys(run.registers)) {
      registers[key] = byte(run.registers[key as keyof typeof run.registers]);
    }

    return {
      block: { start: hex4(block.start), end: hex4(block.end) },
      executed: run.executed.map((e) => ({ address: hex4(e.address), text: e.text })),
      registers,
      changed: run.changed,
      memoryRead: run.memoryRead.map((r) => ({
        address: hex4(r.address),
        value: byte(r.value),
        source: r.source,
        ...(name(r.address) ? { label: name(r.address)! } : {}),
      })),
      memoryWritten: run.memoryWritten.map((w) => ({
        address: hex4(w.address),
        value: byte(w.value),
        ...(name(w.address) ? { label: name(w.address)! } : {}),
      })),
      exit: describeExit(run.exit, name),
      warnings: run.warnings,
    };
  }

  /**
   * What the disassembler could not make sense of.
   *
   * `describe_project` reports how many there are, which is enough to know
   * something is wrong and useless for doing anything about it.
   */
  warnings(): { total: number; warnings: string[] } {
    const all = this.program().warnings.map(describeWarning);
    return { total: all.length, warnings: all };
  }

  /**
   * Spans of bytes nothing has explained.
   *
   * The orientation question on a project nobody has worked on yet, and the one
   * thing that had no answer: `unnamed()` ranks what has been *reached* and is
   * still called `sub_`, which on a blank project is almost nothing, because
   * almost nothing is reachable. "What is left" is a different question and it
   * is the one that comes first.
   *
   * A span counts as unexplained when no instruction covers it and no region
   * says what it holds. Declaring a span data or text is an answer — "this is
   * not code" is understanding, not a gap — so those drop out, which is what
   * makes the list shrink as work is done rather than staying the same size.
   *
   * Biggest first: a 400-byte hole is worth looking at before a stray three.
   */
  undecoded(limit = 20, minimumBytes = 1): {
    total: number;
    unexplainedBytes: number;
    spans: { start: string; end: string; bytes: number; inLayer: string }[];
  } {
    const program = this.program();
    const { loaded } = program;

    // Only where bytes actually exist. A symbols layer supplies none and has no
    // range, and the space between layers is not a hole in anything.
    const covered = new Set<number>();
    for (const instruction of program.instructions.all()) {
      for (let i = 0; i < instruction.bytes.length; i++) covered.add(instruction.address + i);
    }

    const spans: { start: string; end: string; bytes: number; inLayer: string }[] = [];
    let unexplainedBytes = 0;

    for (const layer of loaded.map.getLayers().filter((l) => l.hasBytes)) {
      let run: number | undefined;

      const close = (at: number): void => {
        if (run === undefined) return;
        const bytes = at - run;
        unexplainedBytes += bytes;
        if (bytes >= minimumBytes) {
          spans.push({
            start: hex4(run),
            end: hex4(at - 1),
            bytes,
            inLayer: layer.name,
          });
        }
        run = undefined;
      };

      for (let address = layer.start; address < layer.end; address++) {
        // Shadowed bytes are nobody's work queue. The map's rule is that the
        // topmost layer supplying an address wins, and this walked every layer
        // as though it were alone — so a project holding a crunched file under
        // its decrunched image reported every hole twice, once in bytes that
        // cannot be rendered, decoded, or annotated. Both builders in
        // experiment 5 hit it and called it what it is: a doubled work queue of
        // invisible bytes.
        if (loaded.map.layerAt(address) !== layer) {
          close(address);
          continue;
        }

        const kind = loaded.map.getKindAt(address);
        const explained = covered.has(address) || explainsBytes(kind);
        if (explained) close(address);
        else if (run === undefined) run = address;
      }
      close(layer.end);
    }

    spans.sort((a, b) => b.bytes - a.bytes);
    return { total: spans.length, unexplainedBytes, spans: spans.slice(0, limit) };
  }

  /**
   * What has happened since a reader last looked.
   *
   * The substitute for the socket an agent cannot hold. Without it the only way
   * to notice a change is to read the whole disassembly again and diff it —
   * tens of thousands of tokens and a full re-analysis, to discover a label was
   * renamed.
   *
   * The cursor is stable: entries are appended and never renumbered, so a
   * position held across an undo still means what it meant.
   */
  changesSince(
    from: number | string = 0,
    limit = 100
  ): {
    cursor: number;
    changes: {
      seq: number;
      did: string;
      by?: string;
      as?: string;
      action?: string;
      at?: number;
      undone?: boolean;
    }[];
    truncated: boolean;
  } {
    // A tag is a name for a cursor, so it is resolved here rather than being a
    // separate call that returns a number the caller then passes back.
    const cursor = typeof from === "string" ? this.cursorOfTag(from) : from;
    const found = this.room.storage.readOps(cursor);
    const page = found.slice(0, limit);
    // Whose session it was, so a feed can say "basalt" rather than a bare id.
    const names = new Map(
      (this.room.storage instanceof SqliteStorage ? this.room.storage.sessions() : [])
        .filter((s) => s.codename)
        .map((s) => [s.id, s.codename as string])
    );

    return {
      // Where to resume: the last entry actually returned, not the last that
      // exists, or a truncated page would silently skip the remainder.
      cursor: page.at(-1)?.seq ?? cursor,
      truncated: found.length > limit,
      changes: page.map((change) => ({
        seq: change.seq,
        did: describeOp(change.op),
        by: change.author,
        // Entries sharing an `action` were one decision. Rows written before
        // changesets existed carry none, and each stands alone.
        ...(change.session && names.has(change.session)
          ? { as: names.get(change.session) }
          : {}),
        ...(change.changeset ? { action: change.changeset } : {}),
        at: change.at,
        ...(change.undone ? { undone: true } : {}),
      })),
    };
  }

  // --- writes ---------------------------------------------------------

/**
   * Make a claim about an address.
   *
   * One write where there were two, because the model has one noun. Naming an
   * address and saying what a span holds were `add_label` and `set_region`, and
   * the split was never about the machine — it was the shape an assembler source
   * file has. A claim carries a name, an extent, an interpretation and a root,
   * and any combination of them is a thing somebody might want to say.
   *
   * **Always adds.** Correcting what a claim says is `set_claim`, by its id,
   * which is returned here — an address cannot identify one, since several sit
   * at any interesting address and that is the point.
   */
/**
   * Take back a claim, by id.
   *
   * By id and only by id, which is the identity rule this project states first
   * and has now had to apply four times: an address cannot identify a label, a
   * slot cannot identify a comment, a name cannot identify a constant, and a
   * span cannot identify a claim. `claims_at` is how a caller gets the id.
   */
/**
   * Say several things at once, as one action.
   *
   * The same contract every batch here has: apply what is applicable, report
   * what was declined, fail only when nothing was. One bad span must not lose
   * the rest — `bind_constants` was all-or-nothing and rejected 167 good
   * entries over one bad one, in both runs that used it.
   */
/**
   * Where decoding starts, and why each of them is a start.
   *
   * There is no `add_root`/`remove_root` beside this, deliberately: a root is a
   * field on a claim, so adding one is `add_claim root:` and taking one off is
   * `set_claim root: null`. A second spelling for the same write is the thing
   * this redesign exists to remove — one noun, one way to say something about
   * it.
   *
   * A read, though, has nowhere else to live. `describe_project` reports how
   * many there are, which answers "is anything decoding" and not "what did I
   * declare, and can I take it back". A root nothing stored — a PRG's load
   * address — has no id, and says so, because handing back an id that identifies
   * nothing invites a write against an identity nobody owns.
   */
  listRoots(): {
    total: number;
    roots: { address: string; kind?: RootKind; name?: string; id?: string; writable: boolean }[];
  } {
    const program = this.program();
    const claimed = new Map(
      program.loaded.claims
        .filter((c) => c.root !== undefined)
        .map((c) => [c.at, c] as const)
    );

    // Deduplicated: `entryPoints` is a concatenation — declared points, load
    // addresses, every rooted claim — so an address reached two ways appeared
    // twice, and a reader counting roots got a number larger than the list.
    const roots = [...new Set(program.entryPoints)].map((at) => {
      const claim = claimed.get(at);
      return {
        address: hex4(at),
        ...(claim?.root ? { kind: claim.root } : {}),
        ...(claim?.name ? { name: claim.name } : {}),
        ...(claim?.id ? { id: claim.id } : {}),
        // A load address is inherent to the file and not something a project
        // said, so there is nothing to correct and no id to correct it by.
        writable: claim !== undefined,
      };
    });

    return { total: roots.length, roots };
  }

  addClaims(caller: Caller, claims: readonly ClaimInput[]): EditResult {
    if (claims.length === 0) throw new Error("Give at least one claim.");

    // `address` rather than `at`, so every batch tool's rejection list has one
    // shape — the contract is the point of having one.
    const rejected: { address: string; reason: string }[] = [];
    const usable: ClaimInput[] = [];
    for (const claim of claims) {
      try {
        this.checkClaim(claim);
        usable.push(claim);
      } catch (err) {
        rejected.push({
          address: hex4(claim.at),
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (usable.length === 0) {
      throw new Error(
        `None of the ${claims.length} claims could be made. ` +
          rejected.map((r) => `${r.address}: ${r.reason}`).join(" ")
      );
    }

    const span = {
      start: Math.min(...usable.map((c) => c.at)),
      end: Math.max(...usable.map((c) => c.at + (c.extent ?? 1))),
    };
    // Each id beside the address it was minted for.
    //
    // A positional array is what the first batch reader got, and it silently
    // destroyed three unrelated claims: one entry produced no `claim.add` — a
    // name that revised an existing claim rather than adding one — so every id
    // after it lined up with the wrong input, and six `claim.set` calls landed
    // on claims the reader had never looked at. Every call returned `ok`.
    //
    // An index cannot be checked and an address can, which is the whole of why
    // this shape is different. It is the same rule the rest of this surface
    // follows: an id is how you name a thing, and it has to arrive attached to
    // what you asked about.
    const made: { at: string; claim: string }[] = [];
    const result = this.edit(
      caller,
      (loaded) => {
        const ops: Op[] = [];
        for (const claim of usable) {
          const built = this.claimOps(loaded, claim);
          for (const id of claimIds(built)) made.push({ at: hex4(claim.at), claim: id });
          ops.push(...built);
        }
        return ops;
      },
      span
    );
    return {
      ...result,
      ...(made.length ? { claims: made } : {}),
      ...(rejected.length ? { rejected } : {}),
    };
  }

  /**
   * Correct a claim, by id, one field at a time.
   *
   * Partial by construction, and `null` is how a field is *cleared* — the
   * distinction `Partial<>` cannot make, so removing an extent or un-saying an
   * interpretation would otherwise be unexpressible, and the inverse of "set a
   * root on a claim that had none" unwritable.
   */
  setClaim(caller: Caller, id: string, fields: ClaimEdit): EditResult {
    if (Object.keys(fields).length === 0) {
      throw new Error("Give at least one field to change. Omitted means 'leave alone'; null clears.");
    }
    return this.edit(caller, (loaded) => {
      const held = claimById(loaded, id);
      if (!held) {
        throw new Error(
          `No claim ${id} in this project. claims_at reports what covers an address, with ids.`
        );
      }

      // `says` is one field, so writing it replaces the whole interpretation.
      // A caller changing only how to *read* the bytes — an encoding, a decoder
      // — means to change that and not to un-say what the bytes are, so the
      // parts it did not mention come from what is already there. Without this,
      // `edit_claim view:` turned a text span back into a hex dump and clearing
      // the view did not bring it back.
      const merged: ClaimEdit =
        fields.says && fields.says !== null && held.says && !("is" in (fields.says as object))
          ? { ...fields, says: { ...held.says, ...fields.says } as Claim["says"] }
          : fields;

      // `method` is offered as its own argument because that is how a caller
      // thinks about it, and it lives inside `by` beside the author and the
      // source — so it merges, or revising how you know would forget who said
      // it. Settable only at creation until now, which made "I guessed, then I
      // ran it" unsayable: exactly the movement this axis exists to record.
      const withMethod = (raw: ClaimEdit & { method?: ClaimMethod | null }): ClaimEdit => {
        if (raw.method === undefined) return raw;
        const { method, ...rest } = raw;
        return {
          ...rest,
          by: {
            ...held.by,
            ...(method === null ? {} : { method }),
            ...(method === null && held.by.method !== undefined ? { method: undefined } : {}),
          } as Claim["by"],
        };
      };

      // **`at` is absolute here, as it is in every tool, and is converted.**
      // A claim is stored relative to the layer that supplies its bytes, so a
      // raw absolute address written straight into the field would be read back
      // as a layer *offset* and put the claim somewhere nobody chose. That is
      // why there was no way to move one at all: rather than get it wrong, the
      // field was simply not offered, and repositioning meant remove-and-re-add
      // — which loses the id, and dangles every primary and every use bound to
      // it.
      //
      // `placed` writes the position and the frame together, which is the same
      // pair `add_claim` computes. Moving a claim can therefore move it between
      // layers, and the answer reports the scope it ended up in.
      const edit: ClaimEdit =
        merged.at === undefined || merged.at === null
          ? withMethod(merged)
          : { ...withMethod(merged), ...placed(loaded, merged.at) };

      return [{ op: "claim.set", id, fields: edit }];
    });
  }

  removeClaim(caller: Caller, id: string): EditResult {
    return this.edit(caller, (loaded) => {
      const op = labelDeleteByIdOp(loaded, id);
      if (!op) {
        throw new Error(
          `No claim ${id} in this project. claims_at reports what covers an ` +
            `address, with ids.`
        );
      }
      return [op];
    });
  }

  addClaim(caller: Caller, claim: ClaimInput): EditResult {
    this.checkClaim(claim);

    // Worked out before the edit, because afterwards the enclosing claim is no
    // longer the one that was there first. Declaring 32 bytes of a 512-byte
    // span *nests* — the outer claim is untouched and still explains the bytes
    // either side — and "I declared 32 bytes and a 512-byte claim is still
    // there" is exactly the kind of thing a caller should not have to discover
    // by reading the map afterwards.
    const enclosing =
      claim.extent === undefined
        ? undefined
        : this.program().loaded.map.getRegionAt(claim.at);
    const enclosingSpan = enclosing ? claimSpan(enclosing) : undefined;
    const nests =
      claim.extent !== undefined &&
      enclosingSpan !== undefined &&
      enclosingSpan.start <= claim.at &&
      claim.at + claim.extent < enclosingSpan.end;

    const made: { at: string; claim: string }[] = [];
    const result = this.edit(
      caller,
      (loaded) => {
        const ops = this.claimOps(loaded, claim);
        for (const id of claimIds(ops)) made.push({ at: hex4(claim.at), claim: id });
        return ops;
      },
      { start: claim.at, end: claim.at + (claim.extent ?? 1) }
    );
    // The id, because everything that corrects a claim is keyed by one and a
    // caller that has to go and look it up will collide with somebody who did
    // not — which is exactly how two agents made the same decoder twice.
    // And the span, spelled out: `extent` is a count and a reader checking they
    // covered the right bytes should not have to do the arithmetic.
    return {
      ...result,
      ...(made.length ? { claims: made } : {}),
      scope: describeScope(placed(this.program().loaded, claim.at).frame),
      ...(claim.extent !== undefined
        ? {
            covers:
              `${hex4(claim.at)}-${hex4(claim.at + claim.extent - 1)} ` +
              `(${claim.extent} bytes)`,
          }
        : {}),
      ...(nests && enclosing && enclosingSpan
        ? {
            nestedInside:
              `${enclosing.name ?? enclosing.says?.is ?? "code"} ` +
              `(${hex4(enclosingSpan.start)}-${hex4(enclosingSpan.end - 1)}), which is ` +
              `unchanged and still explains the bytes either side. To shrink it ` +
              `instead, remove_claim ${enclosing.id} first.`,
          }
        : {}),
    };
  }

  /**
   * What a claim must say to be worth storing, checked before any of it is
   * written — so a batch can decline one entry and keep the rest.
   */
  /**
   * The record an id names, or a refusal that says what to call to find one.
   *
   * **An unknown id is not found. It never creates.** A write that creates on
   * an unrecognised id is an upsert wearing a different spelling, and it is
   * what made `set_decoder` and `set_constant` fail the offline/online test:
   * the same call did two different things depending on what had reached you.
   */
  private mustHold<T extends { id?: string }>(
    held: readonly T[],
    id: string,
    noun: string,
    lister: string
  ): T {
    const found = held.find((x) => x.id === id);
    if (!found) throw new Error(`No ${noun} ${id}. ${lister} shows what this project has.`);
    return found;
  }

  private checkClaim(claim: ClaimInput): void {
    if (claim.name === undefined && claim.is === undefined && claim.root === undefined) {
      throw new Error(
        "A claim must say something: a name, what the bytes are (`is`), or that " +
          "they should be decoded (`root`). All three are optional individually " +
          "and at least one is required."
      );
    }
    if (claim.is === "record") {
      if (claim.typeId === undefined) {
        throw new Error("A record claim needs a typeId: list_types shows what this project has.");
      }
      if (claim.extent === undefined) {
        throw new Error(
          "A record claim needs an extent: how many records it holds is derived " +
            "from extent / size, so a claim with no extent is one record and " +
            "almost certainly not what you meant."
        );
      }
      return;
    }
    if (claim.is !== undefined) {
      // Target-independent: this checks the span's shape and that a named
      // decoder exists, and a decoder is project-level.
      this.checkedRegion(claim.at, claim.at + (claim.extent ?? 1), claim.is, claim.view);
    }
  }

  /**
   * One claim, as operations.
   *
   * The single and the batch path share this, or they drift: `bind_constants`
   * and `add_comments` disagreed about their own contract precisely because the
   * batch restated what the single call did rather than calling it.
   */
  private claimOps(loaded: LoadedProject, claim: ClaimInput): Op[] {
    // **Always adds.** Every kind of claim mints, and none of them upserts.
    //
    // A claim carrying an `is` or a `root` used to route through `regionSetOp`,
    // which infers an existing claim from a start address and reuses its id —
    // an upsert, under a tool whose own description promises it never replaces,
    // in the noun this project rewrote its model around specifically to stop
    // that. Two readers found it by probing and it ate a name.
    //
    // It is `set_label`'s history repeating a third time. Both earlier times the
    // upsert was justified by single-author use and survived the arrival of a
    // second author unrevisited; this time it survived the *rewrite that existed
    // to remove it*, because one path was left going the old way.
    const says: Interpretation | undefined =
      claim.is === undefined
        ? undefined
        : claim.is === "record"
          ? { is: "record", typeId: claim.typeId! }
          : claim.is === "text"
            ? {
                is: "text",
                ...(claim.encoding === undefined ? {} : { encoding: claim.encoding }),
                // Text carries a view too — a program with its own character set
                // is unreadable by any built-in encoding, so `snippet:<id>` is
                // the only way such a span is legible. This was dropped on the
                // way in, so a decoder could be defined and run and never
                // attached to the text it decodes.
                ...(claim.view === undefined ? {} : { view: claim.view }),
              }
            : claim.is === "bitmap"
              ? { is: "bitmap", ...(claim.view === undefined ? {} : { view: claim.view }) }
              : { is: claim.is };

    const { ops } = claimAddOps(loaded, claim.at, {
      ...(claim.method === undefined ? {} : { method: claim.method }),
      ...(claim.name === undefined ? {} : { name: claim.name }),
      ...(says === undefined ? {} : { says }),
      // An interpretation is surfaced whether or not anything reaches it, which
      // is what `root: "data"` means; a caller's own root wins over that.
      ...(claim.root !== undefined
        ? { root: claim.root }
        : says !== undefined
          ? { root: "data" as const }
          : {}),
      ...(claim.extent === undefined ? {} : { extent: claim.extent }),
    });

    // A comment is its own object and always was. It used to be handed to the
    // span writer as a field that no longer exists, so a claim carrying both an
    // `is` and a `comment` silently kept the first and dropped the second —
    // nineteen findings in one run, on exactly the claims where the comment is
    // the only place the finding lives, because a data claim renders as hex and
    // argues for nothing by itself.
    if (claim.comment !== undefined) {
      // A comment still needs a layer to hold it, and a name no longer does —
      // so commenting a byteless address makes one, exactly as `add_comment`
      // does. Without this the batch threw *inside* the transaction, past the
      // per-claim guard, and one zero-page comment rejected all fifty-one
      // claims with advice the caller had no way to follow. A batch tool that
      // fails whole is not a batch tool, and this one had one path that did.
      const owning = ensureOwningLayer(loaded, claim.at, this.room.projectId);
      if (owning.create) ops.push(owning.create);
      ops.push(commentAddOp(loaded, claim.at, "before", claim.comment, owning.layerId));
    }
    return ops;
  }

  /**
   * Every claim that covers an address, with nothing resolved.
   *
   * The read that makes an additive write safe: naming an address never replaces
   * what is there, so a caller has to be able to see what is there. Nothing here
   * picks a winner — several claims covering one address is the ordinary state,
   * and which of them *renders* is a separate question with its own tool.
   */
  claimsAt(address: number): {
    address: string;
    claims: {
      id: string;
      at: string;
      extent?: number;
      name?: string;
      is?: string;
      encoding?: string;
      view?: string;
      typeId?: string;
      root?: string;
      /** `layer:<id>`, `target:<name>` or `machine` — what this claim belongs to. */
      scope: string;
      by: string;
    }[];
  } {
    const covering = this.program()
      .loaded.claims.filter((c) => address >= c.at && address < c.at + (c.extent ?? 1))
      .sort(compareClaims);

    return {
      address: hex4(address),
      claims: covering.map((c) => ({
        id: c.id,
        at: hex4(c.at),
        ...(c.extent !== undefined ? { extent: c.extent } : {}),
        ...(c.name !== undefined ? { name: c.name } : {}),
        ...(c.says ? { is: c.says.is } : {}),
        // How it renders, which was invisible: a reader could set a decoder or
        // an encoding and had no way to read back what a claim currently asked
        // for. A field only the writer can observe is one that gets fought over.
        ...(c.says?.is === "text" && c.says.encoding ? { encoding: c.says.encoding } : {}),
        ...((c.says?.is === "text" || c.says?.is === "bitmap") && c.says.view
          ? { view: c.says.view }
          : {}),
        ...(c.says?.is === "record" ? { typeId: c.says.typeId } : {}),
        ...(c.root !== undefined ? { root: c.root } : {}),
        // **How the author knows.** Reported because two claims agreeing is
        // only evidence when the methods differ — a reader looking at several
        // claims here has to be able to tell corroboration from one account
        // arriving twice. See invariant E10.
        ...(c.by.method !== undefined ? { method: c.by.method } : {}),
        // The read that verifies the write can see what the write chose. It is
        // not something the caller picks, but it decides whether the claim
        // follows its bytes when a layer is relinked.
        scope: describeScope(c.frame),
        by: c.by.author,
      })),
    };
  }

  /**
   * Where the project contradicts itself.
   *
   * Had no home before. Two people declaring the same span differently used to
   * end with one of them silently winning, so there was nothing to report;
   * declaring is additive now, both stand, and this is how anybody finds out.
   *
   * Containment is not a contradiction — "this 8K block is the zone table" and
   * "these 40 bytes inside it are text" are both true, and reporting that would
   * make the ordinary way of working look like a fault.
   */
  disagreements(): { total: number; findings: { kind: string; what: string }[] } {
    const set = new ClaimSet(this.program().loaded.claims);
    const found = disagreements(set, this.program().loaded.project.evidence ?? []);
    return {
      total: found.length,
      findings: found.map((d) => ({ kind: d.kind, what: describeDisagreement(d) })),
    };
  }

  addLabel(
    caller: Caller,
    address: number,
    name: string,
    type?: LabelType,
    comment?: string,
    extent?: number
  ): EditResult {
    // A comment given here is a comment about the address, not a field on the
    // label — one action, two operations, so undo takes both back together.
    let beside: { address: number; from: string }[] = [];
    const result = this.edit(caller, (loaded) => {
      const built = claimAddOps(loaded, address, {
        name,
        ...(type && ROOT_FOR_TYPE[type] ? { root: ROOT_FOR_TYPE[type] } : {}),
        ...(extent === undefined ? {} : { extent }),
      });
      if (built.addedBeside) beside = [{ address, from: built.addedBeside }];

      // A comment still needs a layer to hold it; a name no longer does. That
      // asymmetry is temporary — comments move up next — and it is why the
      // symbols layer is created here rather than for the name.
      const owning = comment ? ensureOwningLayer(loaded, address, this.room.projectId) : undefined;

      return [
        ...(owning?.create ? [owning.create] : []),
        ...built.ops,
        ...(comment ? [commentAddOp(loaded, address, "before", comment)] : []),
      ];
    });
    // A label inside an instruction resolves in operands and renders no row —
    // the long-standing gap, now said out loud at the point of writing rather
    // than left to be discovered in a listing.
    return this.warnIfInsideInstruction(
      this.warnIfAddedBesideAChosenName(result, beside),
      address,
      "label"
    );
  }

  /**
   * Choose which of several names at an address renders, by claim id.
   *
   * It took a *name*, which is the thing this whole surface stopped keying
   * writes on: two claims at one address may share a name — the reference file
   * has ten such pairs — so the same call chose different claims depending on
   * which arrived first.
   */
  bindPrimaryName(caller: Caller, address: number, claimId: string): EditResult {
    return this.edit(caller, (loaded) => {
      const here = loaded.map.getLabels().getLabelsAt(address);
      const found = here.find((l) => l.id === claimId);
      if (!found) {
        throw new Error(
          `No claim ${claimId} at ${hex4(address)}. claims_at reports every claim ` +
            `covering an address, with ids.`
        );
      }
      return [{ op: "primary.bind", address, labelId: found.id }];
    });
  }

  /**
   * Stop choosing, and fall back to rank.
   *
   * There was no way to do this: a primary could be set and never taken off,
   * which is the `null`-clears gap arriving one level up. Unbinding a key is
   * half of what a binding is.
   */
  unbindPrimaryName(caller: Caller, address: number): EditResult {
    return this.edit(caller, () => [{ op: "primary.unbind", address }]);
  }

  /**
   * Say which label the operands in a span mean.
   *
   * Stored per site, not as a scope. A stored scope has to be reasoned about
   * whenever code moves or a region changes; a binding attached to an
   * instruction simply travels with it. The range is expanded here, so a caller
   * can still say "throughout this routine" in one call.
   *
   * **`at` is what makes `base-1` sayable.** The 1-indexed table idiom — `LDA
   * base-1,X` with X from 1 — has an operand that points one byte *outside* the
   * table it means, so the label the site refers to is not at the address the
   * site holds. Until now that reading came from `labelTolerance` defaulting to
   * 1: a guess, made silently, with nothing behind it and no way to disagree
   * with it. Resolving `$8C99` to `noOfDroidSquadsForLevel-1` is an
   * interpretation of what the instruction means, and an interpretation belongs
   * in something a person can attach evidence to.
   *
   * The operand filter stays exact against `target`, which is the safety: a
   * caller says which address the sites hold and which label that means, and a
   * span still cannot sweep up instructions that refer to something else.
   */
  bindLabel(
    caller: Caller,
    name: string,
    target: number,
    from: number,
    to?: number,
    at?: number
  ): EditResult {
    return this.edit(caller, (loaded) => {
      const lives = at ?? target;
      const label = loaded.map
        .getLabels()
        .getLabelsAt(lives)
        .find((l) => l.name === name);
      if (!label) {
        throw new Error(
          `${hex4(lives)} has no label called ${name}.` +
            (at === undefined
              ? ""
              : ` \`at\` is where the label is; \`address\` is what the operands hold.`)
        );
      }

      const end = to ?? from;
      const sites = this.program()
        .instructions.all()
        .filter((i) => i.address >= from && i.address <= end)
        .filter((i) => {
          const operand = i.operand as { address?: number };
          return operand.address === target;
        });

      if (sites.length === 0) {
        throw new Error(
          `No instruction between ${hex4(from)} and ${hex4(end)} refers to ${hex4(target)}.`
        );
      }

      return sites.map((site) => {
        const layerId = owningLayerId(loaded, site.address);
        return {
          op: "labelUse.bind",
          id: newId("lbl"),
          layerId,
          address: site.address,
          labelId: label.id,
        } as Op;
      });
    });
  }

  unbindLabel(caller: Caller, address: number): EditResult {
    return this.edit(caller, (loaded) => {
      const layerId = owningLayerId(loaded, address);
      const layer = loaded.project.layers.find((l) => l.id === layerId);
      const use = layer?.labelUses?.find((u) => parseProjectAddress(u.address) === address);
      if (!use?.id) throw new Error(`No label is bound at ${hex4(address)}.`);
      return [{ op: "labelUse.unbind", id: use.id, layerId }];
    });
  }

  /**
   * The work as a listing, the way the reference is written.
   *
   * Text rather than rows: it is what a reader compares against a hand-written
   * disassembly, and it costs roughly a fifth of the tokens the same span
   * costs as JSON — so it is also the cheaper way to read a lot at once.
   *
   * The equate block is derived, not stored: the constants actually meant
   * somewhere in the span, so it stays in step with the bindings by
   * construction. A declared constant nobody used does not appear, which is
   * why this is a listing and the `.re64` is the export that round-trips.
   */
  listing(
    start?: number,
    lines?: number,
    end?: number,
    claim?: string
  ): {
    start: string;
    text: string;
    truncated: boolean;
    nextStart?: string;
    claim?: string;
    name?: string;
  } {
    // A claim is a span with a name on it, which is what "list this thing" has
    // always meant — so pointing this at one costs nothing and stops a name
    // being a display string you then have to look the address up from.
    let named: string | undefined;
    if (claim !== undefined) {
      if (start !== undefined) throw new Error("Give either a claim or a start, not both.");
      const span = this.spanOf(claim);
      start = span.at;
      end = span.at + span.extent - 1;
      lines = undefined;
      named = span.name;
    }
    const { rows } = this.rows();
    // The row *containing* the address, not the first one past it. A data row
    // covers eight bytes, so asking for $808C used to skip to $8090 and leave
    // out the row that was being checked.
    const begin = start === undefined ? 0 : rowContaining(rows, start);
    // An end address is the other natural way to ask, since that is what
    // `set_region` takes; it becomes a row count here so there is one rule
    // below rather than two.
    const countTo = (limit: number): number => {
      const stop = rows.findIndex((r, i) => i >= begin && r.address > limit);
      // No row past the limit: the listing simply runs to the end.
      return stop === -1 ? rows.length - begin : Math.max(1, stop - begin);
    };
    const count = lines ?? (end === undefined ? 200 : countTo(end));

    // Same rule as `disassembly`: stop on an address boundary, or a page ending
    // inside a long comment hands back a cursor pointing at itself.
    let last = Math.min(begin + count, rows.length);
    while (last < rows.length && rows[last].address === rows[last - 1].address) last++;
    const page = rows.slice(begin, last);

    const covered = new Set(page.map((r) => r.address));
    const used = this.program().loaded.constants.used((a) => covered.has(a));
    const equates = used.map(
      (c) => `${c.name.padEnd(28)}= $${c.value.toString(16).toUpperCase().padStart(2, "0")}`
    );

    const body = page.map((r) => r.text);
    const text = [...equates, ...(equates.length ? [""] : []), ...body].join("\n");
    const after = rows[last];

    return {
      start: hex4(page[0]?.address ?? start ?? 0),
      text,
      truncated: after !== undefined,
      ...(after ? { nextStart: hex4(after.address) } : {}),
      ...(claim === undefined ? {} : { claim }),
      ...(named === undefined ? {} : { name: named }),
    };
  }

  /**
   * Declare that a name exists for a value.
   *
   * Declaring is not using. Nothing renders differently until a site is bound,
   * because the same value means different things in different places — the
   * reference disassembly names $01 both A_DIRECTION and WHITE — and guessing
   * which was meant is exactly what this design refuses to do.
   */
  /**
   * Declare a name for a byte value. **Always adds; never replaces.**
   *
   * It used to match an existing constant by name and reuse its id, which made
   * the write's identity depend on what the caller had synced: a reader who had
   * seen somebody else's `SHIELD = $04` silently replaced it, and one who had
   * not produced a second constant. The same call, two outcomes — which is this
   * project's own offline/online test failing, and the same defect `set_label`
   * and `set_comment` were each fixed for.
   *
   * A name is prose somebody chose, not a key the system assigns meaning to, so
   * two people can pick the same word for different things. That is why this is
   * additive where `set_target` is rightly keyed by name: a target *is* its name.
   */
  addConstant(
    caller: Caller,
    name: string,
    value: number
  ): EditResult & { constant: string } {
    if (value < 0 || value > 0xff) {
      throw new Error(`A constant names a byte, so its value must be $00-$FF; got ${value}.`);
    }
    // Minted here so it can be returned. `set_decoder` returned no id and two
    // agents collided over it in experiment 3; a write whose result cannot be
    // named again is a write the caller has to go looking for.
    const id = newId("cst");
    const result = this.edit(caller, () => [{ op: "constant.add", id, name, value }]);
    return { ...result, constant: id };
  }

  /** Revise a declared constant, by id. */
  editConstant(caller: Caller, id: string, name?: string, value?: number): EditResult {
    if (value !== undefined && (value < 0 || value > 0xff)) {
      throw new Error(`A constant names a byte, so its value must be $00-$FF; got ${value}.`);
    }
    if (name === undefined && value === undefined) {
      throw new Error("Give at least one field to change: name, value.");
    }
    return this.edit(caller, (loaded) => {
      // Not found, never created — see `mustHold`.
      if (!loaded.constants.byId(id)) {
        throw new Error(`No constant ${id}. list_constants shows what this project has.`);
      }
      // Only what was named. Resending the other field is how an edit reasserts
      // a value a collaborator had just corrected.
      return [
        {
          op: "constant.set",
          id,
          fields: {
            ...(name === undefined ? {} : { name }),
            ...(value === undefined ? {} : { value }),
          },
        },
      ];
    });
  }

  /**
   * Which constant a caller means, by id or by an unambiguous name.
   *
   * The same shape as `remove_label`, which takes an id or an address that names
   * exactly one. An ambiguous name is refused and the candidates are listed,
   * which is also how a caller learns the ids it should have passed.
   */
  private resolveConstant(loaded: LoadedProject, nameOrId: string): { id: string } {
    const byId = loaded.constants.byId(nameOrId);
    if (byId) return byId;

    const held = loaded.constants.allByName(nameOrId);
    if (held.length === 1) return held[0];
    if (held.length === 0) throw new Error(`No constant called ${nameOrId}.`);
    throw new Error(
      `${held.length} constants are called ${nameOrId}: ` +
        held
          .map((c) => `${c.id} ($${c.value.toString(16).toUpperCase().padStart(2, "0")})`)
          .join(", ") +
        `. Say which by id.`
    );
  }

  /**
   * Forget a declared constant, by id.
   *
   * It took a name too, resolved when exactly one constant held it. That is a
   * write keyed on something that is not an identity, and "exactly one" is a
   * property of *what you have synced*: a name that reaches one constant for
   * you reaches two for a peer who has seen somebody else's declaration, so the
   * same call does different things depending on what arrived. Reads may still
   * resolve a name; writes name the thing they change.
   */
  removeConstant(caller: Caller, id: string): EditResult {
    return this.edit(caller, (loaded) => {
      if (!loaded.constants.byId(id)) {
        throw new Error(`No constant ${id}. list_constants shows what this project has.`);
      }
      const existing = { id };
      // Sites bound to it are left alone: a use pointing at nothing renders the
      // literal, so deleting needs no sweep and a delete racing a bind heals.
      return [{ op: "constant.remove", id: existing.id }];
    });
  }



  /**
   * Say that the immediate at this address means a constant, by id.
   *
   * It took a name, resolved against the operand's value on the reasoning that
   * two constants sharing a name necessarily differ in value. Clever, and still
   * a write keyed on something that is not an identity: which constants exist
   * under a name is a property of what you have synced, so the same call bound
   * different things for two peers. Names resolve on reads; writes name what
   * they change.
   */
  bindConstant(caller: Caller, address: number, constantId: string): EditResult {
    return this.edit(caller, (loaded) => {
      const instruction = this.program().instructions.get(address);
      if (!instruction) {
        throw new Error(`No instruction at ${hex4(address)}; nothing there to read as a constant.`);
      }
      if (instruction.operand.type !== "immediate") {
        throw new Error(
          `${hex4(address)} takes no immediate operand, so there is no value to name.`
        );
      }

      const constant = loaded.constants.byId(constantId);
      if (!constant) {
        throw new Error(
          `No constant ${constantId}. list_constants shows what this project has, with ids.`
        );
      }
      // The one check worth keeping: binding a site to a constant it does not
      // load is a wrong answer that renders as a right one.
      if (instruction.operand.value !== constant.value) {
        throw new Error(
          `${hex4(address)} loads $${instruction.operand.value
            .toString(16)
            .toUpperCase()
            .padStart(2, "0")}, but ${constant.name} is $${constant.value
            .toString(16)
            .toUpperCase()
            .padStart(2, "0")}.`
        );
      }

      const { layerId, create } = ensureOwningLayer(loaded, address, this.room.projectId);
      return [
        ...(create ? [create] : []),
        { op: "constantUse.bind", id: newId("cst"), layerId, address, constantId: constant.id },
      ];
    });
  }

  /**
   * Bind several sites at once.
   *
   * `set_constants` batches the declarations, which change no listing by
   * design, while binding — the operation that actually changes what a reader
   * sees — was one call per site. That is backwards for a program that loads
   * the same value in dozens of places.
   */
  bindConstants(
    caller: Caller,
    bindings: readonly { address: number; constant: string }[]
  ): EditResult {
    if (bindings.length === 0) throw new Error("Give at least one binding.");

    // Partial rather than all-or-nothing. This tool exists because "an agent
    // names forty", and rejecting forty over one bad entry means resubmitting
    // the thirty-nine good ones — which is what happened in both experiment
    // runs that used it. The offender is still named; it is simply named
    // *beside* the work that succeeded rather than instead of it.
    let rejected: { address: string; reason: string }[] = [];

    const result = this.edit(caller, (loaded) => {
      rejected = [];
      const ops: Op[] = [];

      for (const entry of bindings) {
        const reject = (reason: string) =>
          rejected.push({ address: hex4(entry.address), reason });

        const constant = loaded.constants.byId(entry.constant);
        if (!constant) {
          reject(`No constant ${entry.constant}. list_constants shows the ids.`);
          continue;
        }

        const instruction = this.program().instructions.get(entry.address);
        if (!instruction || instruction.operand.type !== "immediate") {
          reject(`Takes no immediate operand, so there is no value to name.`);
          continue;
        }
        if (instruction.operand.value !== constant.value) {
          reject(`Loads a different value from ${constant.name}.`);
          continue;
        }

        ops.push({
          op: "constantUse.bind",
          id: newId("cst"),
          layerId: owningLayerId(loaded, entry.address),
          address: entry.address,
          constantId: constant.id,
        } as Op);
      }

      // Nothing usable is still an error: a caller who got every entry wrong
      // should hear that, not a success with an empty delta.
      if (ops.length === 0) {
        throw new Error(
          `None of the ${bindings.length} bindings could be made. ` +
            rejected.map((r) => `${r.address}: ${r.reason}`).join(" ")
        );
      }
      return ops;
    });

    return rejected.length ? { ...result, rejected } : result;
  }

  /**
   * Say what the project is.
   *
   * The reference keeps its provenance and licence in an 18-line file header,
   * and a project had nowhere to put that: `description` existed in the schema
   * and could only arrive by importing a file that already carried one.
   */
  setDescription(caller: Caller, description: string): EditResult {
    return this.edit(caller, () => [
      { op: "meta.set", key: "description", value: description } as Op,
    ]);
  }

  unbindConstant(caller: Caller, address: number): EditResult {
    return this.edit(caller, (loaded) => {
      const layerId = owningLayerId(loaded, address);
      const layer = loaded.project.layers.find((l) => l.id === layerId);
      const use = layer?.constantUses?.find(
        (u) => parseProjectAddress(u.address) === address
      );
      if (!use?.id) throw new Error(`No constant is bound at ${hex4(address)}.`);
      return [{ op: "constantUse.unbind", id: use.id, layerId }];
    });
  }

  constants(): {
    total: number;
    constants: { id: string; name: string; value: string; uses: number; boundAt: string[] }[];
  } {
    const program = this.program();

    return {
      total: program.loaded.constants.all().length,
      constants: program.loaded.constants.all().map((c) => {
        // A real count, and the addresses behind it. This was
        // `used.has(c.id) ? 1 : 0` — a boolean wearing the name of a count, so
        // a constant bound at thirteen sites and one bound at a single site
        // both reported `1`, and the field could not answer the question it
        // appeared to answer.
        const sites = program.loaded.constants.sitesOf(c.id);
        return {
          // Returned because declaring is additive: two constants can share a
          // name, and without the id nothing downstream can say which one it
          // means. The same gap `list_comments` had.
          id: c.id,
          name: c.name,
          value: `$${c.value.toString(16).toUpperCase().padStart(2, "0")}`,
          uses: sites.length,
          boundAt: sites.map(hex4),
        };
      }),
    };
  }

  /**
   * Every instruction loading an immediate, optionally of one value.
   *
   * The other half of naming a constant: having decided that $01 here means
   * A_DIRECTION, the next question is where else $01 is loaded — and whether
   * those sites mean the same thing, which only a reader can say.
   */
  immediates(
    value?: number,
    limit = 100
  ): {
    total: number;
    unnamed?: number;
    next?: string;
    sites: {
      address: string;
      value: string;
      boundTo?: string;
      text?: string;
      inRoutine?: string;
    }[];
  } {
    const program = this.program();
    const { rows, lineForAddress } = this.rows();

    const found = program.instructions
      .all()
      .filter(
        (i) => i.operand.type === "immediate" && (value === undefined || i.operand.value === value)
      );

    const unnamed = found.filter(
      (i) => program.loaded.constants.nameAt(i.address) === undefined
    ).length;

    return {
      total: found.length,
      // **The next call, because this one is an on-ramp and had no exit.**
      // Both readers in experiment 10 called this six times between them, saw
      // the sites, and declared no constants at all — where the run before the
      // claims model declared eighteen. The tool answered its question and
      // stopped, which is out of step with the rest of this surface: a nested
      // claim names how to replace it, an indirect jump names `mark_function`,
      // an orphaned decode names the region that restores it. The one tool
      // whose entire purpose is to lead somewhere led nowhere.
      ...(unnamed === 0
        ? {}
        : {
            unnamed,
            next:
              `${unnamed} of these load a value nothing has named. ` +
              `add_constant declares the name and returns its id; bind_constants ` +
              `takes {address, constant} for each site it means — the list above is ` +
              `that batch. Naming the value is a judgement: the same byte is ` +
              `LEFT_ZAPPER in one routine and WHITE in another, so bind the sites ` +
              `you have read rather than all of them.`,
          }),
      sites: found.slice(0, limit).map((i) => {
        const immediate = i.operand as { value: number };
        return {
          address: hex4(i.address),
          value: `$${immediate.value.toString(16).toUpperCase().padStart(2, "0")}`,
          boundTo: program.loaded.constants.nameAt(i.address),
          text: contentRowAt(rows, lineForAddress, i.address)?.text,
          // The neighbouring `find_instructions` fills this in, and the whole
          // question here is "does this value mean the same thing over there" —
          // which is unanswerable from a bare list of addresses.
          ...(this.routineNameAt(i.address)
            ? { inRoutine: this.routineNameAt(i.address)! }
            : {}),
        };
      }),
    };
  }

  /**
   * Add a symbols layer by name.
   *
   * Rarely needed: naming an address that no layer owns creates one. This is
   * for choosing the name, or for keeping a second set of names separate.
   */
  addSymbolsLayer(caller: Caller, name: string): EditResult {
    return this.edit(caller, () => [
      { op: "layer.add", id: newId("lay"), layerType: "symbols", name, index: 0 } as Op,
    ]);
  }

  /**
   * Take a layer out of the project.
   *
   * The gap `layer.set` is recorded as, from the other side: the operation has
   * existed all along and no tool reached it, so a project accumulated every
   * scratch layer anybody made. Experiment 5's builder ended with four byte
   * layers where it wanted one, worked around it with targets, and said the
   * project "permanently carries dead layers" — which it did.
   *
   * Refuses while the layer still owns annotations, which is what
   * `diffProjects` orders removals last for: a label needs its layer to exist.
   * The refusal names the count, because "it is not empty" without saying how
   * full is a dead end.
   */
  removeLayer(caller: Caller, id: string): EditResult {
    return this.edit(caller, (loaded) => {
      const layer = loaded.project.layers.find((l) => l.id === id);
      if (!layer) {
        throw new Error(
          `No layer has id ${id}. list_targets reports every layer, including ` +
            `the ones the selected target excludes.`
        );
      }
      const held =
        (layer.labels?.length ?? 0) +
        (layer.regions?.length ?? 0) +
        (layer.comments?.length ?? 0);
      if (held > 0) {
        throw new Error(
          `${layer.name ?? id} still holds ${held} annotation(s), and they would ` +
            `go with it. Move or remove them first.`
        );
      }
      return [{ op: "layer.remove", id } as Op];
    });
  }

  /**
   * Add a layer over bytes the project holds.
   *
   * The step that turns an uploaded binary into something to disassemble, and
   * the reason `add_layer` could only make symbols layers until now: a project
   * could be annotated but never *built*.
   *
   * The path is `name` for a plain file or `image.d64:FILE` for one inside a
   * disk image — a form the loader has always understood and nothing could ask
   * for.
   */
  /**
   * Link a machine ROM in, as reference rather than as something to read.
   *
   * Deliberately its own call. A ROM's bytes come from the host rather than
   * from this project's files, it lands where the hardware decodes it rather
   * than anywhere a caller chooses, and it is `reference` — so every argument
   * `add_byte_layer` takes is one this must refuse. Folding them together would
   * be a call with three arguments that are meaningless half the time.
   */
  /**
   * What a newly declared layer is not yet part of.
   *
   * **A layer nobody links supplies nothing**, because a target's layer list is
   * an allowlist rather than a filter — and `ok: true` on a write that changed
   * nothing anybody can see is the confident wrong answer in miniature.
   *
   * Two consecutive experiments were cost real work by this. Run 9's editor
   * called `add_rom_layer` twice, got `ok` twice, saw no change, concluded the
   * problem was `reference: true`, uploaded the ROMs again as raw bytes *and*
   * made a target linking them — two variables at once, and it credited the
   * wrong one in its notes. Run 10's editor inherited that explanation, declared
   * three ROM layers, linked none, and hand-wrote a seventeen-byte KERNAL shim
   * instead of using the ROMs sitting on the disk.
   */
  private linkAdvice(): { linkedInto?: string[]; note?: string } {
    const project = this.program().loaded.project;
    const targets = project.targets ?? [];
    if (targets.length === 0) return {};
    return {
      linkedInto: [],
      note:
        `Declared, and linked into no target — so nothing reads it yet. A target's ` +
        `layer list is an allowlist: add it with set_target on one of ` +
        `${targets.map((t) => `"${t.name}"`).join(", ")}, or add_target for a new view.`,
    };
  }

  addRomLayer(caller: Caller, rom: "basic" | "kernal" | "characters"): EditResult {
    const held = this.program().loaded.project.layers;
    const already = held.find((l) => l.type === "rom" && l.rom === rom);
    if (already) {
      throw new Error(`This project already links the ${rom} ROM as "${already.name}".`);
    }
    const advice = this.linkAdvice();
    const result = this.edit(caller, () => [
      {
        op: "layer.add",
        id: newId("lay"),
        layerType: "rom",
        rom,
        name: `${rom} rom`,
        // Bottom of the stack: reference material shadows nothing, and the
        // program being read must win wherever the two overlap.
        index: 0,
      } as Op,
    ]);
    return { ...result, ...advice };
  }

  /**
   * A layer over bytes: a file this project holds, or bytes given inline.
   *
   * `bytes` is the kind whose content lives *in* the project. That is what a
   * patch wants — a handful of bytes at a known address, on top of the build
   * they change — and there is no file to upload, so the diff shows the change
   * itself rather than a new hash.
   */
  addByteLayer(
    caller: Caller,
    options: {
      type: "prg" | "raw" | "bytes";
      path?: string;
      bytes?: string;
      name?: string;
      address?: number;
      length?: number;
    }
  ): EditResult {
    const { type } = options;
    if (type !== "prg" && options.address === undefined) {
      throw new Error(
        `A ${type} layer has no load address of its own, so it needs one. A .prg ` +
          'carries its own in the first two bytes; use type "prg" for those.'
      );
    }

    let hex: string | undefined;
    let name = options.name;
    if (type === "bytes") {
      if (options.path !== undefined) {
        throw new Error(
          'A "bytes" layer carries its own bytes and reads no file, so it takes ' +
            'no path. Use type "raw" to lay a file at an address.'
        );
      }
      hex = (options.bytes ?? "").replace(/[\s$]/g, "").toUpperCase();
      if (hex.length === 0) {
        throw new Error('A "bytes" layer needs its bytes, as hex — "A9 01 8D 20 D0".');
      }
      // Refused here rather than parsed into NaN and stored: it is a fact about
      // the request, which is the one thing a write is entitled to refuse over.
      if (!/^(?:[0-9A-F]{2})+$/.test(hex)) {
        throw new Error(
          `"${options.bytes}" is not whole bytes of hex. Two hex digits per byte, ` +
            "spaces optional."
        );
      }
      name ??= `patch at ${hex4(options.address!)}`;
    } else {
      if (options.path === undefined) {
        throw new Error(
          `A ${type} layer reads a file, so it needs a path. describe_project ` +
            'lists what this project holds; use type "bytes" to give bytes inline.'
        );
      }
      const held = this.program().loaded.project.files ?? [];
      const path = options.path;
      const image = path.includes(":") ? path.slice(0, path.indexOf(":")) : path;
      if (!held.some((f) => f.name === image)) {
        throw new Error(
          `This project holds no file called "${image}". describe_project lists ` +
            `what it has, and prepare_upload adds one.`
        );
      }
      name ??= image;
    }

    // The stack is declared bottom-up and a byte layer is the foundation, so a
    // new one goes on top of what is already there rather than under it.
    const index = this.program().loaded.project.layers.length;
    const advice = this.linkAdvice();
    const result = this.edit(caller, () => [
      {
        op: "layer.add",
        id: newId("lay"),
        layerType: type,
        name,
        ...(options.path === undefined ? {} : { path: options.path }),
        ...(hex === undefined ? {} : { bytes: hex }),
        ...(options.address === undefined ? {} : { address: options.address }),
        ...(options.length === undefined ? {} : { length: options.length }),
        index,
      } as Op,
    ]);
    return { ...result, ...advice };
  }

  /**
   * Write a comment about an address.
   *
   * `before` owns its own rows above the label and may run to several lines;
   * `inline` shares the instruction's row. Setting the same slot twice revises
   * rather than stacking, since that is one person changing their mind.
   */
  /**
   * The instruction an address falls *inside*, when it is not the start of one.
   *
   * An annotation there is accepted, stored, and renders nowhere: the row model
   * is keyed by instruction start, so nothing ever asks about a byte in the
   * middle. Two comments were lost that way in experiment 4, and the loss is
   * only visible by cross-checking addresses against an exported listing.
   *
   * Exact rather than approximate: no 6502 instruction exceeds three bytes, so
   * two steps back covers every case.
   */
  private insideInstruction(address: number): number | undefined {
    const program = this.program();
    if (program.instructions.has(address)) return undefined;
    for (let back = 1; back <= 2; back++) {
      const instruction = program.instructions.get(address - back);
      if (instruction && instruction.address + instruction.bytes.length > address) {
        return instruction.address;
      }
    }
    return undefined;
  }

  /** Append the mid-instruction warning to a result, when it applies. */
  /**
   * Say so when a write added a name beside one somebody had chosen.
   *
   * Not a warning about damage any more — nothing is destroyed — but the caller
   * still has to know, because two names at one address is a *finding* and the
   * other one is somebody's judgement. `jumpTimer` beside `jumpVelocity` is the
   * sharpest thing either reader said about that byte, and it only means
   * anything if both of them find out.
   */
  private warnIfAddedBesideAChosenName(
    result: EditResult,
    beside: { address: number; from: string }[]
  ): EditResult {
    if (beside.length === 0) return result;
    const list = beside
      .slice(0, 6)
      .map((r) => `${hex4(r.address)} already had "${r.from}"`)
      .join(", ");
    result.warnings = [
      ...(result.warnings ?? []),
      `Added ${beside.length} name(s) beside one somebody had chosen: ${list}` +
        (beside.length > 6 ? `, and ${beside.length - 6} more` : "") +
        `. Both names are kept and the older one still renders. To correct a name ` +
        `rather than add to it, use edit_claim with its id; changes_since says ` +
        `who chose the first.`,
    ];
    return result;
  }

  /** Names a write is about to replace that a person, rather than the walk, chose. */
  private chosenNamesAt(
    loaded: LoadedProject,
    addresses: readonly number[]
  ): { address: number; from: string }[] {
    const found: { address: number; from: string }[] = [];
    for (const address of addresses) {
      for (const layer of loaded.project.layers) {
        const label = layer.labels?.find((l) => parseProjectAddress(l.address) === address);
        if (label) {
          found.push({ address, from: label.name });
          break;
        }
      }
    }
    return found;
  }

  private warnIfInsideInstruction(result: EditResult, address: number, what: string): EditResult {
    const inside = this.insideInstruction(address);
    if (inside === undefined) return result;
    result.warnings = [
      ...(result.warnings ?? []),
      `${hex4(address)} is inside the instruction at ${hex4(inside)}, so this ` +
        `${what} is stored but will not appear in the listing. Put it at ` +
        `${hex4(inside)} to have it render.`,
    ];
    return result;
  }

  addComment(
    caller: Caller,
    address: number,
    text: string,
    placement: CommentPlacement = "before"
  ): EditResult & { comment: string } {
    if (placement === "inline" && text.includes("\n")) {
      throw new Error(
        "An inline comment shares a row with the instruction, so it cannot " +
          "contain newlines. Use placement \"before\" for anything longer."
      );
    }
    // Minted here so it can be returned: editing, moving or removing a comment
    // is by id, and having to call list_comments afterwards to learn what you
    // just wrote is the round trip `set_decoder` used to cost.
    const comment = newId("cmt");
    // Counted before the write, since afterwards this one is among them.
    const already = this.program().loaded.comments.allAt(address).length;

    const result = this.edit(caller, (loaded) => {
      const { layerId, create } = ensureOwningLayer(loaded, address, this.room.projectId);
      const add: Op = { op: "comment.add", id: comment, layerId, address, placement, text };
      return create ? [create, add] : [add];
    });

    // An inline comment shares its row and therefore cannot be wrapped — which
    // is correct, and means a paragraph attached inline runs the listing line
    // to several hundred characters with nothing to say so. The rule is not
    // enforced, because where the limit bites depends on the instruction it
    // sits beside; it is said, once, at the point of writing.
    if (placement === "inline" && text.length > INLINE_COMMENT_HINT) {
      result.warnings = [
        ...(result.warnings ?? []),
        `This inline comment is ${text.length} characters and shares a row with ` +
          `the instruction, so it cannot wrap and will run the line long. ` +
          `Use placement "before" for anything this size.`,
      ];
    }

    const answer = { ...this.warnIfInsideInstruction(result, address, "comment"), comment };
    // Somebody has already written here. Not a refusal and not a conflict —
    // every comment at an address is kept and rendered, which is why nothing was
    // lost when all three readers in experiment 7 wrote the same paragraph about
    // the same 200-byte stride. Worth saying so the fourth does not spend the
    // effort a second time.
    if (already > 0) {
      answer.warnings = [
        ...(answer.warnings ?? []),
        `${hex4(address)} already had ${already} comment(s), and this is kept beside ` +
          `them rather than replacing one. list_comments shows what is there.`,
      ];
    }
    return answer;
  }

  /**
   * Revise a comment by id — its text, its placement, or where it sits among
   * the comments sharing its address.
   *
   * The half that `add_comment` deliberately does not do. Together they replace
   * a single `set_comment` that upserted by `(address, placement)`, which made
   * one agent's write silently destroy another's.
   */
  editComment(
    caller: Caller,
    id: string,
    changes: { text?: string; placement?: CommentPlacement; order?: number }
  ): EditResult {
    if (changes.text === undefined && changes.placement === undefined && changes.order === undefined) {
      throw new Error("Give something to change: text, placement, or order.");
    }
    return this.edit(caller, (loaded) => [commentEditOp(loaded, id, changes)]);
  }

  /**
   * Put the comments at an address in the order given.
   *
   * Ordering was by id — stable on every peer, which is what merge needs, and
   * arbitrary, which is no use once adding freely and arranging later is the
   * intended flow rather than an accident. Declarative on purpose: a caller
   * says what the order should be rather than nudging one comment past
   * another, so the result does not depend on what it believed the order was.
   */
  reorderComments(caller: Caller, address: number, ids: readonly string[]): EditResult {
    const here = this.program().loaded.comments.allAt(address);
    const known = new Set(here.map((c) => c.id));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length) {
      throw new Error(
        `No comment ${unknown.join(", ")} at ${hex4(address)}. ` +
          `It holds ${here.map((c) => c.id).join(", ") || "none"}.`
      );
    }
    // Anything not named keeps its place after those that are, rather than
    // being silently dropped to an arbitrary position.
    const ordered = [...ids, ...here.map((c) => c.id).filter((id) => !ids.includes(id))];
    return this.edit(caller, (loaded) =>
      ordered.map((id, at) => commentEditOp(loaded, id, { order: at }))
    );
  }

  /**
   * Write several comments as one action.
   *
   * The reference has more comments than labels, so the argument that made
   * `add_labels` exist applies here at least as strongly: one round trip each
   * is almost all protocol.
   */
  addComments(
    caller: Caller,
    comments: readonly { address: number; text: string; placement?: CommentPlacement }[]
  ): EditResult {
    if (comments.length === 0) throw new Error("Give at least one comment.");

    // One contract for every batch tool here: apply what you can, report what
    // you declined, fail only if nothing was applicable. A batch exists because
    // an agent writes forty at a time, and losing thirty-nine to one typo is
    // the opposite of why it exists — `bind_constants` was made partial for
    // that reason and this was still all-or-nothing, so two batch tools
    // disagreed about their own contract and a caller could not tell which it
    // would get. Undo stays coherent either way: the changeset covers exactly
    // what was applied.
    let rejected: { address: string; reason: string }[] = [];

    const usable = comments.filter((entry) => {
      if ((entry.placement ?? "before") === "inline" && entry.text.includes("\n")) {
        rejected.push({
          address: hex4(entry.address),
          reason: "inline comments share a row with the instruction and cannot contain newlines",
        });
        return false;
      }
      return true;
    });

    if (usable.length === 0) {
      throw new Error(
        `None of the ${comments.length} comments could be written. ` +
          rejected.map((r) => `${r.address}: ${r.reason}`).join(" ")
      );
    }

    const result = this.edit(caller, (loaded) => {
      const ops: Op[] = [];
      let madeLayer: string | undefined;

      for (const entry of usable) {
        const placement = entry.placement ?? "before";
        if (madeLayer !== undefined && !ownsAddress(loaded, entry.address)) {
          ops.push({
            op: "comment.add",
            id: newId("cmt"),
            layerId: madeLayer,
            address: entry.address,
            placement,
            text: entry.text,
          });
          continue;
        }

        const owning = ensureOwningLayer(loaded, entry.address, this.room.projectId);
        if (owning.create) {
          ops.push(owning.create);
          madeLayer = owning.layerId;
          ops.push({
            op: "comment.add",
            id: newId("cmt"),
            layerId: owning.layerId,
            address: entry.address,
            placement,
            text: entry.text,
          });
        } else {
          ops.push(commentAddOp(loaded, entry.address, placement, entry.text));
        }
      }

      return ops;
    });

    return rejected.length ? { ...result, rejected } : result;
  }

  /** Declare several constants as one action. */
  addConstants(
    caller: Caller,
    constants: readonly { name: string; value: number }[]
  ): EditResult {
    if (constants.length === 0) throw new Error("Give at least one constant.");

    for (const entry of constants) {
      if (entry.value < 0 || entry.value > 0xff) {
        throw new Error(
          `${entry.name} names a byte, so its value must be $00-$FF; got ${entry.value}.`
        );
      }
    }

    // Additive, like the single call: a batch that quietly revised whatever it
    // matched would be the obvious way to get back the behaviour just removed.
    return this.edit(caller, () =>
      constants.map((entry) => ({
        op: "constant.add" as const,
        id: newId("cst"),
        name: entry.name,
        value: entry.value,
      }))
    );
  }

  /**
   * Remove a comment by id.
   *
   * By id, not by slot. An address does not identify a comment — several share
   * one, which is the intended flow — so "remove the comment at $8100" is a
   * question with no answer, and answering it anyway is how one agent's writing
   * disappeared under another's.
   */
  removeComment(caller: Caller, id: string): EditResult {
    return this.edit(caller, (loaded) => {
      for (const layer of loaded.project.layers) {
        if (layer.id && layer.comments?.some((c) => c.id === id)) {
          return [{ op: "comment.remove", id, layerId: layer.id } as Op];
        }
      }
      throw new Error(`No comment ${id}. list_comments shows what this project has.`);
    });
  }



  /**
   * Declare an address a subroutine, optionally saying how far it runs.
   *
   * The extent is *declared*, never inferred. Working out where a routine ends
   * needs basic blocks, and a wrong extent is not visibly wrong — which is why
   * this has stayed an explicit gap. Someone reading the code knows, and saying
   * so is what makes `find_references` able to answer "from which routine"
   * instead of naming the nearest branch target above the call.
   */
  /**
   * Say an address starts a routine.
   *
   * It used to take an extent as well, and that did real damage. A label's
   * `extent` means "this name covers N bytes", so an operand landing inside one
   * renders as `NAME + $000F` — right for an array, wrong for a routine, where
   * it replaced every local branch target: `BPL loc_8050` became
   * `BPL UpdateExplosion + $0010` and the `loc_8050:` row disappeared. Two
   * readers in experiment 2 backed it out of 73 routines between them.
   *
   * Nothing needs it now. A routine's extent is worked out from control flow by
   * `routineEffects`, which also handles the case a declared one never could:
   * 20 of the 50 routines here are not a single contiguous span.
   */
  markFunction(caller: Caller, address: number, name?: string): EditResult {
    return this.edit(caller, (loaded) => markFunctionOps(loaded, address, name));
  }

  unmarkFunction(caller: Caller, address: number): EditResult {
    return this.edit(caller, (loaded) => {
      const ops = unmarkFunctionOps(loaded, address);
      if (ops.length === 0) throw new Error(`${hex4(address)} is not marked as a function`);
      return ops;
    });
  }

  /**
   * Everything a region has to satisfy before it can be written.
   *
   * Extracted so the batch runs the same checks one at a time rather than a
   * laxer second route: a batch that validated less would be the obvious way to
   * write the region that a single call refuses.
   *
   * Returns the view after resolving the one ambiguity in it — an explicit empty
   * string means "take it off", where omitting the argument means "leave it".
   */
  private checkedRegion(
    start: number,
    end: number,
    kind: Interpretation["is"],
    view?: string
  ): string | undefined {
    if (end <= start) {
      throw new Error(
        `A region must cover at least one byte, and end is exclusive: ` +
          `${hex4(start)}-${hex4(end)} covers none. Did you mean end ${hex4(start + 1)}?`
      );
    }
    if (kind === "jumptable" && (end - start) % 2 !== 0) {
      // Every entry is two bytes, so an odd span is an off-by-one at any size,
      // not only the one-byte case. The extractor reads pairs while
      // `addr + 1 < end`, so an odd byte is dropped in silence: a five-entry
      // table declared one byte short yields four entries and reports success.
      const bytes = end - start;
      const entries = (n: number) => `${hex4(start + n * 2)} (${n} ${n === 1 ? "entry" : "entries"})`;
      // Only ends that would hold something: proposing a region of nothing is
      // noise in the one message that has to be read carefully.
      const suggestions = [
        ...((bytes - 1) / 2 >= 1 ? [entries((bytes - 1) / 2)] : []),
        entries((bytes + 1) / 2),
      ];
      throw new Error(
        `A jumptable holds 16-bit addresses, so it covers an even number of ` +
          `bytes; ${hex4(start)}-${hex4(end)} covers ${bytes}. Remember end is ` +
          `exclusive — did you mean end ${suggestions.join(" or ")}?`
      );
    }

    // An explicit empty string clears the view. Omitting the argument is
    // ambiguous — it reads as "leave it alone" — so there was no way to take a
    // `snippet:` back off a region and return it to a built-in encoding, and
    // the only route was to keep editing the decoder instead.
    const viewOrCleared = view === "" ? undefined : view;

    // `snippet:<id>` hands the span to a decoder: as a picture for a bitmap
    // region, as characters for a text one. Checked here rather than at render
    // time, because a listing that quietly ignores an unknown decoder looks
    // exactly like one whose decoder is wrong.
    const snippet = viewOrCleared?.startsWith("snippet:") ? viewOrCleared!.slice("snippet:".length) : undefined;
    if (snippet !== undefined) {
      const known = this.program().loaded.project.decoders ?? [];
      if (!known.some((d) => d.id === snippet)) {
        throw new Error(
          `No decoder ${snippet} in this project. list_decoders shows what it has, ` +
            `and add_decoder adds one.`
        );
      }
    } else if (viewOrCleared !== undefined && !isBitmapView(viewOrCleared)) {
      throw new Error(
        `"${viewOrCleared}" is not a view this can draw. Use bits:<bytes per row>, ` +
          `char:<columns>, sprite:<columns> or sprite-multi:<columns>, or ` +
          `snippet:<decoder id> to hand the bytes to a decoder — for example ` +
          `"char:8" for a character set eight glyphs wide, or "bits:3" to slide ` +
          `a raw bit run at a sprite's width until a picture appears.`
      );
    }
    if (kind === "bitmap" && viewOrCleared === undefined) {
      throw new Error(
        `A bitmap region needs a view saying how to read the bytes: ` +
          `char:<columns> for a character set, sprite:<columns> or ` +
          `sprite-multi:<columns> for sprites, bits:<bytes per row> for ` +
          `anything else.`
      );
    }

    return viewOrCleared;
  }



  undo(caller: Caller): { undone: string | null; version: string } {
    const outcome = this.room.store.undo(caller.userId, caller.sessionId);
    return { ...outcome, version: this.version() };
  }

  /**
   * Apply an edit and report what it did to the program.
   *
   * The instruction delta is the feedback loop: marking a function is how code
   * reachable only through a jump table gets decoded at all, so the count is
   * how a caller tells a productive guess from a wasted one.
   */
  private edit(
    caller: Caller,
    build: (loaded: LoadedProject) => Op[],
    affecting?: { start: number; end: number }
  ): EditResult {
    const before = this.program().instructions.size;
    const decodedBefore = new Set(this.program().instructions.all().map((i) => i.address));
    const warnedBefore = new Set(this.program().warnings.map(describeWarning));
    const ops = build(this.program().loaded);

    const { descriptions } = this.room.store.runOps(
      ops,
      caller.userId,
      Date.now(),
      caller.sessionId
    );
    const after = this.program().instructions.size;

    // What this edit broke, if it broke anything.
    //
    // A label one byte inside an instruction is legitimate 6502 and the model
    // permits it, but the row builder cannot draw two streams claiming one
    // byte, so the decode after it desynchronises into garbage. That is the
    // only way to get a *wrong* disassembly rather than an incomplete one, and
    // it used to return plain `ok`. The renderer still cannot cope; at least
    // the caller is now told, at the moment it becomes true.
    const introduced = this.program()
      .warnings.map(describeWarning)
      .filter((w) => !warnedBefore.has(w));

    return {
      ok: true,
      version: this.version(),
      did: descriptions,
      instructions: { before, after, delta: after - before },
      ...(introduced.length ? { warnings: introduced } : {}),
      ...this.describeLoss(decodedBefore, affecting),
    };
  }

  /**
   * What an edit stopped decoding, when it stopped decoding anything.
   *
   * `delta` reports this already, and that is the problem: a catastrophic
   * -950 arrives in the same field, the same shape and the same tone as a
   * useful +8, and every description here teaches a reader that a positive
   * delta is the reward for a good decision. Declaring the `$EA` filler
   * between two routines as data — which is exactly what the reference
   * listing shows — broke fall-through into the main game loop and deleted two
   * thirds of the program while returning ok.
   *
   * So a loss says so separately, and names the first address that lost the
   * only thing reaching it, which is the address a `code` region has to be put
   * back on.
   */
  private describeLoss(
    decodedBefore: ReadonlySet<number>,
    affecting?: { start: number; end: number }
  ): { orphaned?: { instructions: number; firstAt: string; hint: string } } {
    const now = this.program().instructions;
    // Bytes inside the span just written are not a loss: no longer decoding
    // what was declared data is the point of the edit, not a casualty of it.
    // Counting them made every ordinary region report an orphan.
    const lost = [...decodedBefore]
      .filter((a) => !now.has(a))
      .filter((a) => !affecting || a < affecting.start || a >= affecting.end)
      .sort((a, b) => a - b);
    if (lost.length === 0) return {};

    // The fall-through point, not the lowest casualty. Marking a span data
    // stops the walk at its end, so the instruction *after* it is the one that
    // lost its only predecessor; everything else that stopped decoding did so
    // because it was reached from there. Reporting the lowest address instead
    // names a victim rather than the wound.
    // The fall-through point first: marking a span data stops the walk at its
    // end, so the instruction after it is the one that lost its predecessor,
    // and everything else stopped because it was reached from there.
    const orphan = (affecting && lost.find((a) => a >= affecting.end)) ?? lost[0];

    return {
      orphaned: {
        instructions: lost.length,
        firstAt: hex4(orphan),
        // No claim about *how* it was reached. Fall-through is the usual
        // cause, but the same report follows from removing a jump's only
        // decoding, and asserting a mechanism this cannot check would be a
        // confident guess in the one message meant to be trusted.
        hint:
          `Nothing in this analysis reaches ${hex4(orphan)} any more. If it is ` +
          `still code, say so: add_claim at ${hex4(orphan)} root "location", ` +
          `or mark_function if something reaches it in a way a static walk ` +
          `cannot see.`,
      },
    };
  }

  /** Refuse a write based on a project state that has since moved. */
  expect(version: string | undefined): void {
    const current = this.version();
    if (version !== undefined && version !== current) {
      throw new Error(
        `This project has changed since you read it (now ${current}). ` +
          `Read it again before writing.`
      );
    }
  }
}

export interface DisassemblyLine {
  address: string;
  kind: string;
  text: string;
  mnemonic?: string;
  flow?: string;
  target?: string;
  targetType?: string;
  name?: string;
  labelType?: LabelType;
  source?: string;
  illegal?: boolean;
}

export interface LabelSummary {
  /**
   * Stable identity, for the labels a project owns.
   *
   * Withheld for auto and platform labels for the reason `summarise` gives:
   * their ids are derived rather than stored. Present for everything else,
   * because without it `remove_label` and friends can only be told an address —
   * and an address does not identify a label, which is this project's own rule
   * and was not applied here until two agents lost work to it.
   */
  id?: string;
  address: string;
  name: string;
  type: LabelType;
  source: string;
  /** `layer:<id>`, `target:<name>` or `machine` — what this name belongs to. */
  scope: string;
  references: number;
  writable: boolean;
  /** How many bytes the name covers, when it names an array rather than a spot. */
  extent?: number;
  /**
   * What the name means, for names this project did not choose.
   *
   * Present on the built-in C64 symbols and nowhere else yet. It answers "what
   * is CHROUT" without a ROM and without a second call, which is the whole
   * reason the table carries descriptions.
   */
  description?: string;
}

export interface EditResult {
  ok: true;
  version: string;
  did: string[];
  instructions: { before: number; after: number; delta: number };
  /**
   * The claims this edit made or revised, each beside the address it was made
   * for.
   *
   * Keyed by address rather than by position, because a positional array is
   * what the first batch reader got and it silently destroyed three unrelated
   * claims: one entry produced no new claim, every id after it lined up with
   * the wrong input, and six corrections landed on claims the reader had never
   * looked at. Every call returned `ok`.
   *
   * An index cannot be checked and an address can.
   */
  claims?: { at: string; claim: string }[];
  /**
   * What the claims this edit made belong to: `layer:<id>`, `target:<name>`, or
   * `machine`.
   *
   * Derived, never chosen — the topmost layer supplying the byte, else the
   * target. Reported because it decides whether a claim travels when the stack
   * is reordered or a layer is relinked, and a property only the writer can
   * observe is one that gets fought over. That is what an invisible extent cost
   * two readers in experiment 7.
   */
  scope?: string;
  /**
   * Instructions this edit stopped decoding, when it stopped any.
   *
   * Absent almost always. Present when a decision cut something off — which
   * `delta` also says, in a field a reader is taught to read as good news.
   */
  orphaned?: { instructions: number; firstAt: string; hint: string };
  /**
   * Set when this region was declared *inside* one that already covered the
   * span, rather than replacing it.
   *
   * Both statements stand and nothing becomes unexplained, but "I declared 32
   * bytes and a 512-byte region is still there" is not something a caller
   * should have to discover by reading the map afterwards.
   */
  nestedInside?: string;
  /**
   * Warnings this edit introduced, when it introduced any.
   *
   * Almost always absent. When present it usually means a decode now overlaps
   * itself, which the listing cannot render and which nothing else would say.
   */
  warnings?: string[];
  /**
   * Entries a batch declined, when it declined any but not all.
   *
   * A batch tool that fails whole makes its caller resubmit everything that
   * was already right, which is the opposite of why it is a batch.
   */
  rejected?: { address: string; reason: string }[];
  /**
   * The span a claim covers, inclusive at both ends.
   *
   * Spelled out because `extent` is a count: a reader checking they covered the
   * right bytes should not have to do the arithmetic, and one who assumed an
   * exclusive end has no other way to notice a claim a byte short.
   */
  covers?: string;
}

/**
 * The index of the first row covering an address.
 *
 * Rows are address-ordered and several can share an address — a comment, a
 * label, then the instruction — so this walks back to the first of them, and
 * treats an address inside a multi-byte row as belonging to that row.
 */
function rowContaining(rows: readonly { address: number }[], address: number): number {
  const after = rows.findIndex((r) => r.address > address);
  const last = after < 0 ? rows.length - 1 : after - 1;
  if (last < 0) return 0;

  let first = last;
  while (first > 0 && rows[first - 1].address === rows[last].address) first--;
  return first;
}

/**
 * Whether a byte reading explains the bytes it covers.
 *
 * **Exhaustive on purpose.** This was a hand-written list of four kinds, and
 * `record` — added to `Interpretation` afterwards — was never added to it. So a
 * reader who did the deepest kind of work available, proving a 52-byte record
 * layout and declaring four instances of it, was told by the work queue that
 * all 208 bytes were still unexplained. Both readers in experiment 10 hit it
 * independently and one cross-checked every record claim by hand rather than
 * trust the count.
 *
 * That is this project's most-repeated defect: the vocabulary being closed is
 * checked by the compiler, and whether anything *reads* a member of it is not.
 * A `switch` with a `never` default makes the next interpretation a compile
 * error here rather than a silent omission.
 *
 * `code` and `unknown` are the two readings that explain nothing — the first
 * because code is what bytes are when nobody has said otherwise, the second
 * because it is the absence of a claim wearing the name of a kind.
 */
function explainsBytes(kind: ByteReading | undefined): boolean {
  switch (kind) {
    case undefined:
    case "code":
    case "unknown":
      return false;
    case "data":
    case "text":
    case "bitmap":
    case "jumptable":
    case "record":
      return true;
    default: {
      const unhandled: never = kind;
      return unhandled;
    }
  }
}

/** Whether a field type is, or contains, a run of bits. */
function holdsBits(type: FieldType): boolean {
  return type.is === "bits" || (type.is === "array" && holdsBits(type.of));
}
