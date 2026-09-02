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
  Label,
  LabelType,
  LoadedProject,
  Op,
  ProgramAnalysis,
  Reference,
  Row,
  RegionKind,
  BasicBlock,
  BlockRun,
  analyze,
  analyzeProgram,
  analyzeRoutines,
  routineAt,
  targetsOf,
  Effects,
  RoutineEffects,
  blockAt,
  blockEffects,
  describeEffects,
  formatVarnode,
  runBlock,
  REGISTER_NAMES,
  bitmapToText,
  blobPaths,
  isBitmapView,
  buildMemoryMap,
  describeOp,
  labelDeleteOp,
  commentDeleteOp,
  commentSetOp,
  ensureOwningLayer,
  labelAddOp,
  labelSetOp,
  owningLayerId,
  ownsAddress,
  newId,
  makeFileLoader,
  markFunctionOps,
  parseProject,
  parseProjectAddress,
  regionDeleteOp,
  regionSetOp,
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
import { FileStorage, ProjectStore, SqliteStorage } from "../store/index.js";
import { nodeFileBytes } from "../node-files.js";

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
}

const hex4 = (address: number) => `$${address.toString(16).toUpperCase().padStart(4, "0")}`;

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
      program.labels
        .filter({ type: "function" })
        .concat(program.labels.filter({ type: "entry" }))
        .map((l) => l.address)
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

    return buildMemoryMap(projectFromDoc(store.document()), makeFileLoader(bytes));
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
     * Said only when it is bad news: the export is behind the document and why.
     *
     * A write failure reaches nobody otherwise — the live writer is a detached
     * timer that swallows the error to keep the server up, so every tool keeps
     * answering `ok` while nothing leaves the document.
     */
    exportStale?: { failedAt: string; error: string };
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
      regions: loaded.map.getAllRegions().map((r) => ({
        // Reported so a caller can name one. Without this, `set_region` and
        // `remove_region` had to infer which region was meant from its start
        // address — which stopped being unique the moment regions could nest.
        id: r.id,
        start: hex4(r.start),
        end: hex4(r.end),
        kind: r.kind,
        name: r.name,
      })),
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
            ? { name: label.name, labelType: label.type, source: label.source.kind }
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
          .find((l) => l.type === "function" || l.type === "entry" || l.type === "code");
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
      source?: Label["source"]["kind"];
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

  private summarise(label: Label): LabelSummary {
    const program = this.program();
    // An auto label's id is derived from the fact that nothing named it, and
    // handing one out invites an edit claiming an identity that means nothing.
    // A platform label belongs to the built-in symbol layer, which no project
    // owns, so a write to one is refused a layer down.
    //
    // Both were reported writable, which is worse than either gap: it is the
    // field a reader uses to decide what it may edit, so it was planned
    // against and then refused.
    const invented = label.source.kind === "auto";
    const builtIn = label.source.kind === "platform";
    return {
      address: hex4(label.address),
      name: label.name,
      type: label.type,
      source: label.source.kind,
      references: program.xrefs.count(label.address),
      writable: !invented && !builtIn,
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
        `. It may be data, or unreachable from any entry point — find_undecoded says which.`
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
  bytes(start: number, length: number): {
    start: string;
    length: number;
    hex: string;
    base64: string;
    unmapped?: { from: string; to: string }[];
  } {
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

    return {
      total: matches.length,
      truncated: matches.length > limit,
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
    comments: { address: string; placement: string; text: string }[];
  } {
    const all = [...this.program().loaded.comments.all()].sort((a, b) => a.address - b.address);
    return {
      total: all.length,
      truncated: all.length > limit,
      comments: all.slice(0, limit).map((c) => ({
        address: hex4(c.address),
        placement: c.placement,
        text: c.text,
      })),
    };
  }

  /** The decoders this project carries, with their source. */
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
  setDecoder(
    caller: Caller,
    name: string,
    source: string,
    id?: string
  ): EditResult & { decoder: string } {
    const existing = (this.program().loaded.project.decoders ?? []).find(
      (d) => d.id === id || (id === undefined && d.name === name)
    );
    // Minted here so it can be returned. A region refers to a decoder by id
    // (`view: "snippet:<id>"`), so writing one and then having to call
    // list_decoders to find out what it was called is a round trip for
    // something this call already knew.
    const decoder = existing?.id ?? newId("dec");
    const result = this.edit(caller, () => [{ op: "decoder.set", id: decoder, name, source }]);
    return { ...result, decoder };
  }

  removeDecoder(caller: Caller, id: string): EditResult {
    const found = (this.program().loaded.project.decoders ?? []).find((d) => d.id === id);
    if (!found) throw new Error(`No decoder ${id}. list_decoders shows what this project has.`);
    return this.edit(caller, () => [{ op: "decoder.delete", id }]);
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
  routineEffects(address: number): Record<string, unknown> {
    const program = this.program();
    const routines = this.routines();

    // The address of any block in a routine is a fair way to ask about it — a
    // reader has a line, not necessarily an entry point.
    const found = routines.get(address) ?? routineAt(routines, program.blocks, address);

    if (!found) {
      throw new Error(
        `${hex4(address)} is not in a routine this can see. A routine starts where ` +
          `something calls it, or where mark_function says one starts — and this ` +
          `address is in neither.`
      );
    }

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

    const show = (effects: Effects) => ({
      reads: [
        ...effects.reads.map(slot),
        ...(effects.readsComputedMemory ? ["memory at a computed address"] : []),
      ],
      writes: [
        ...effects.writes.map(slot),
        ...(effects.writesComputedMemory ? ["memory at a computed address"] : []),
      ],
    });

    return {
      routine: name(found.entry),
      blocks: found.blocks,
      // More than one whenever it tail-jumps away, which is why no single
      // declared span could have described it.
      spans: found.spans.map((s) => `${hex4(s.start)}-${hex4(s.end - 1)}`),
      itself: show(found.own),
      including_what_it_calls: show(found.total),
      calls: found.calls.map(name),
      // Derived from the stack delta, which knows exactly: a block is
      // straight-line, so how far the stack moved needs no guessing.
      returns: found.returns.length > 0 ? found.returns.map((r) => r.why) : undefined,
      incomplete:
        found.incomplete.length > 0
          ? found.incomplete
          : undefined,
      note:
        "Everything this routine *can* touch, not what it must. Reachability is " +
        "static, so a computed jump or an RTS-dispatch leads somewhere this " +
        "cannot follow — see list_warnings.",
    };
  }

  /**
   * What the block at an address reads and writes, without running it.
   *
   * The first question about a routine nobody has named: not what it is called,
   * but what it depends on and what it leaves behind. Both are unions over the
   * block's lifted operations, which is sound only because a block is
   * straight-line — every instruction in it runs, so nothing has to be assumed
   * about a path.
   *
   * Says which of the two questions it cannot answer rather than guessing:
   * `readsComputedMemory` means an address depended on a register, and an
   * `unmodelled` instruction means both lists are incomplete by an unknown
   * amount.
   */
  blockEffects(address: number): {
    block: { start: string; end: string; instructions: number; exit: string };
    reads: string[];
    writes: string[];
    flags: string[];
    unmodelled: { at: string; mnemonic: string }[];
    note?: string;
  } {
    const program = this.program();
    const block = this.blockCovering(address);
    const effects = blockEffects(block.instructions);
    const described = describeEffects(effects);

    return {
      block: {
        start: hex4(block.start),
        end: hex4(block.end),
        instructions: block.instructions.length,
        exit: block.exit,
      },
      reads: described.reads,
      writes: described.writes,
      flags: effects.flags.map((offset) => REGISTER_NAMES[offset] ?? String(offset)),
      unmodelled: effects.unmodelled.map((u) => ({ at: hex4(u.address), mnemonic: u.mnemonic })),
      // A block ends at the first call, so asking about a routine that opens
      // with `JSR` returns one instruction. That is right and unhelpful, and
      // saying which tool answers the question costs a line.
      ...(block.instructions.length <= 2 && block.exit === "call"
        ? {
            note:
              "This block is the instructions up to its first JSR, which is all " +
              "a block is. For what the whole routine touches, including what it " +
              "calls, ask routine_effects about the same address.",
          }
        : {}),
      ...(effects.unmodelled.length
        ? {
            note:
              "An instruction here has no modelled semantics, so these lists are " +
              "incomplete by an unknown amount.",
          }
        : {}),
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
        const kind = loaded.map.getKindAt(address);
        // Explained: something decoded here, or someone said what it holds.
        const explained =
          covered.has(address) ||
          kind === "data" ||
          kind === "text" ||
          kind === "jumptable" ||
          kind === "bitmap";
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

  /**
   * Every recorded change touching an address range — blame, for a listing.
   *
   * The gap both readers in experiment 3 named from opposite ends of the same
   * collisions: *"the write side is complete and the who-else-touched-this side
   * is not."* They had three collisions in ten minutes — identical header edits
   * four seconds apart, two independently written decoders, five values with two
   * constant names each — and in every case the information needed to avoid it
   * already existed in the ops log with no way to ask for it by address.
   *
   * `changes_since` answers "what happened while I was away", which is a
   * question about *time*. This answers "who has been here", which is a question
   * about *place*, and no amount of the first composes into the second: a
   * collision is discovered by looking where you are about to write.
   *
   * Every op is scanned rather than an index being kept. The log is bounded by
   * edits and this is asked about one address at a time, so the cost is a scan
   * of a few hundred rows — and an index would be a second structure to keep in
   * step with a table that is already append-only.
   */
  changesAt(
    from: number,
    to: number,
    limit = 100
  ): {
    total: number;
    truncated: boolean;
    changes: {
      seq: number;
      did: string;
      at?: string;
      by?: string;
      as?: string;
      action?: string;
      undone?: true;
    }[];
  } {
    const names = new Map(
      (this.room.storage instanceof SqliteStorage ? this.room.storage.sessions() : [])
        .filter((s) => s.codename)
        .map((s) => [s.id, s.codename as string])
    );

    const touching = this.room.storage.readOps(0).filter((change) => {
      const op = change.op as unknown as Record<string, unknown>;
      // An op names its target as `address`, or as a `start`/`end` span. Both
      // shapes are read off the object rather than switched on the op name, so
      // a new operation carrying either is covered the day it is added.
      const at = typeof op.address === "number" ? op.address : undefined;
      if (at !== undefined) return at >= from && at <= to;

      const start = typeof op.start === "number" ? op.start : undefined;
      const end = typeof op.end === "number" ? op.end : start;
      if (start === undefined || end === undefined) return false;
      return start <= to && end >= from;
    });

    return {
      total: touching.length,
      truncated: touching.length > limit,
      changes: touching.slice(-limit).map((change) => ({
        seq: change.seq,
        did: describeOp(change.op),
        ...(change.at ? { at: new Date(change.at).toISOString() } : {}),
        by: change.author,
        ...(change.session && names.has(change.session)
          ? { as: names.get(change.session) }
          : {}),
        ...(change.changeset ? { action: change.changeset } : {}),
        ...(change.undone ? { undone: true as const } : {}),
      })),
    };
  }

  // --- writes ---------------------------------------------------------

  setLabel(
    caller: Caller,
    address: number,
    name: string,
    type?: LabelType,
    comment?: string,
    extent?: number
  ): EditResult {
    // A comment given here is a comment about the address, not a field on the
    // label — one action, two operations, so undo takes both back together.
    const result = this.edit(caller, (loaded) => {
      const { layerId, create } = ensureOwningLayer(loaded, address, this.room.projectId);
      const label: Op = create
        ? { op: "label.set", id: newId("lbl"), layerId, address, name, type, extent }
        : labelSetOp(loaded, address, name, type, extent);

      return [
        ...(create ? [create] : []),
        label,
        ...(comment
          ? [
              create
                ? ({
                    op: "comment.set",
                    id: newId("cmt"),
                    layerId,
                    address,
                    placement: "before",
                    text: comment,
                  } as Op)
                : commentSetOp(loaded, address, "before", comment),
            ]
          : []),
      ];
    });
    // A label inside an instruction resolves in operands and renders no row —
    // the long-standing gap, now said out loud at the point of writing rather
    // than left to be discovered in a listing.
    return this.warnIfInsideInstruction(result, address, "label");
  }

  /**
   * Name several addresses as one action.
   *
   * The reference disassembly has hundreds of labels, and one call each is
   * hundreds of round trips returning an instruction delta nobody asked for.
   * One action means one changeset, so undo takes the batch back whole.
   *
   * At most one symbols layer is created however many unowned addresses are in
   * the batch: the per-address helper is asked once, and later addresses reuse
   * what the first one made — otherwise naming forty zero-page variables would
   * build forty layers.
   */
  setLabels(
    caller: Caller,
    labels: readonly {
      address: number;
      name: string;
      type?: LabelType;
      comment?: string;
      extent?: number;
    }[]
  ): EditResult {
    if (labels.length === 0) throw new Error("Give at least one label.");

    return this.edit(caller, (loaded) => {
      const ops: Op[] = [];
      let madeLayer: string | undefined;

      for (const entry of labels) {
        let layerId: string;
        if (madeLayer !== undefined && !ownsAddress(loaded, entry.address)) {
          layerId = madeLayer;
        } else {
          const owning = ensureOwningLayer(loaded, entry.address, this.room.projectId);
          layerId = owning.layerId;
          if (owning.create) {
            ops.push(owning.create);
            madeLayer = owning.layerId;
          }
        }

        ops.push(
          madeLayer === layerId
            ? {
                op: "label.set",
                id: newId("lbl"),
                layerId,
                address: entry.address,
                name: entry.name,
                type: entry.type,
                extent: entry.extent,
              }
            : labelSetOp(loaded, entry.address, entry.name, entry.type, entry.extent)
        );

        if (entry.comment) {
          ops.push(
            madeLayer === layerId
              ? ({
                  op: "comment.set",
                  id: newId("cmt"),
                  layerId,
                  address: entry.address,
                  placement: "before",
                  text: entry.comment,
                } as Op)
              : commentSetOp(loaded, entry.address, "before", entry.comment)
          );
        }
      }

      return ops;
    });
  }

  /**
   * Add a second name at an address rather than replacing the first.
   *
   * `set_label` renames, which is right for a correction. This is for an
   * address that genuinely has two names — the reference calls `$08`
   * `a scratch byte` throughout and `something specific` inside one routine, which is a
   * finding about the program, not a nickname. Which one a given operand shows
   * is then `bind_label`; without one, the primary wins.
   */
  addLabel(
    caller: Caller,
    address: number,
    name: string,
    type?: LabelType,
    extent?: number
  ): EditResult {
    return this.edit(caller, (loaded) => {
      const already = loaded.map
        .getLabels()
        .getLabelsAt(address)
        .find((l) => l.name === name);
      if (already) throw new Error(`${hex4(address)} is already called ${name}.`);

      // Pin whatever is showing now as the primary, unless something already
      // is. Two user labels at one address tie on rank, so the winner would
      // otherwise be decided by id order — which is random. Adding a second
      // name silently renamed every reference to the address, and did so
      // unpredictably enough that testing it once told you nothing.
      const showing = loaded.map.getLabels().resolve(address)?.label;
      const alreadyChosen = loaded.map.primaryLabels.has(address);
      const pin: Op[] =
        showing && !alreadyChosen
          ? [{ op: "primary.set", address, labelId: showing.id }]
          : [];

      const { layerId, create } = ensureOwningLayer(loaded, address, this.room.projectId);
      return create
        ? [
            create,
            ...pin,
            { op: "label.set", id: newId("lbl"), layerId, address, name, type, extent } as Op,
          ]
        : [...pin, labelAddOp(loaded, address, name, type, extent)];
    });
  }

  /** Choose which of several names at an address is shown by default. */
  setPrimaryLabel(caller: Caller, address: number, name: string): EditResult {
    return this.edit(caller, (loaded) => {
      const found = loaded.map
        .getLabels()
        .getLabelsAt(address)
        .find((l) => l.name === name);
      if (!found) throw new Error(`${hex4(address)} has no label called ${name}.`);
      return [{ op: "primary.set", address, labelId: found.id }];
    });
  }

  /**
   * Say which label the operands in a span mean.
   *
   * Stored per site, not as a scope. A stored scope has to be reasoned about
   * whenever code moves or a region changes; a binding attached to an
   * instruction simply travels with it. The range is expanded here, so a caller
   * can still say "throughout this routine" in one call.
   */
  bindLabel(
    caller: Caller,
    name: string,
    target: number,
    from: number,
    to?: number
  ): EditResult {
    return this.edit(caller, (loaded) => {
      const label = loaded.map
        .getLabels()
        .getLabelsAt(target)
        .find((l) => l.name === name);
      if (!label) throw new Error(`${hex4(target)} has no label called ${name}.`);

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
          op: "label.bind",
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
      return [{ op: "label.unbind", id: use.id, layerId }];
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
  listing(start?: number, lines?: number, end?: number): {
    start: string;
    text: string;
    truncated: boolean;
    nextStart?: string;
  } {
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
  setConstant(caller: Caller, name: string, value: number): EditResult {
    if (value < 0 || value > 0xff) {
      throw new Error(`A constant names a byte, so its value must be $00-$FF; got ${value}.`);
    }
    return this.edit(caller, (loaded) => {
      const existing = loaded.constants.byName(name);
      return [{ op: "constant.set", id: existing?.id ?? newId("cst"), name, value }];
    });
  }

  removeConstant(caller: Caller, name: string): EditResult {
    return this.edit(caller, (loaded) => {
      const existing = loaded.constants.byName(name);
      if (!existing) throw new Error(`No constant called ${name}.`);
      // Sites bound to it are left alone: a use pointing at nothing renders the
      // literal, so deleting needs no sweep and a delete racing a bind heals.
      return [{ op: "constant.delete", id: existing.id }];
    });
  }

  /** Say that the immediate at this address means a constant. */
  bindConstant(caller: Caller, address: number, name: string): EditResult {
    return this.edit(caller, (loaded) => {
      const constant = loaded.constants.byName(name);
      if (!constant) {
        throw new Error(`No constant called ${name}. Declare it first with set_constant.`);
      }

      const instruction = this.program().instructions.get(address);
      if (!instruction) {
        throw new Error(`No instruction at ${hex4(address)}; nothing there to read as a constant.`);
      }
      if (instruction.operand.type !== "immediate") {
        throw new Error(
          `${hex4(address)} takes no immediate operand, so there is no value to name.`
        );
      }
      if (instruction.operand.value !== constant.value) {
        throw new Error(
          `${hex4(address)} loads $${instruction.operand.value
            .toString(16)
            .toUpperCase()
            .padStart(2, "0")}, but ${name} is $${constant.value
            .toString(16)
            .toUpperCase()
            .padStart(2, "0")}.`
        );
      }

      const { layerId, create } = ensureOwningLayer(loaded, address, this.room.projectId);
      return [
        ...(create ? [create] : []),
        { op: "constant.bind", id: newId("cst"), layerId, address, constantId: constant.id },
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
    bindings: readonly { address: number; name: string }[]
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

        const constant = loaded.constants.byName(entry.name);
        if (!constant) {
          reject(`No constant called ${entry.name}. Declare it first.`);
          continue;
        }

        const instruction = this.program().instructions.get(entry.address);
        if (!instruction || instruction.operand.type !== "immediate") {
          reject(`Takes no immediate operand, so there is no value to name.`);
          continue;
        }
        if (instruction.operand.value !== constant.value) {
          reject(`Loads a different value from ${entry.name}.`);
          continue;
        }

        ops.push({
          op: "constant.bind",
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
      return [{ op: "constant.unbind", id: use.id, layerId }];
    });
  }

  constants(): {
    total: number;
    constants: { name: string; value: string; uses: number; boundAt: string[] }[];
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

    return {
      total: found.length,
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

  setComment(
    caller: Caller,
    address: number,
    text: string,
    placement: CommentPlacement = "before"
  ): EditResult {
    if (placement === "inline" && text.includes("\n")) {
      throw new Error(
        "An inline comment shares a row with the instruction, so it cannot " +
          "contain newlines. Use placement \"before\" for anything longer."
      );
    }
    const result = this.edit(caller, (loaded) => {
      const { layerId, create } = ensureOwningLayer(loaded, address, this.room.projectId);
      if (!create) return [commentSetOp(loaded, address, placement, text)];
      return [
        create,
        { op: "comment.set", id: newId("cmt"), layerId, address, placement, text } as Op,
      ];
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

    return this.warnIfInsideInstruction(result, address, "comment");
  }

  /**
   * Write several comments as one action.
   *
   * The reference has more comments than labels, so the argument that made
   * `set_labels` exist applies here at least as strongly: one round trip each
   * is almost all protocol.
   */
  setComments(
    caller: Caller,
    comments: readonly { address: number; text: string; placement?: CommentPlacement }[]
  ): EditResult {
    if (comments.length === 0) throw new Error("Give at least one comment.");

    for (const entry of comments) {
      if ((entry.placement ?? "before") === "inline" && entry.text.includes("\n")) {
        throw new Error(
          `The comment for ${hex4(entry.address)} is inline, so it shares a row ` +
            `with the instruction and cannot contain newlines.`
        );
      }
    }

    return this.edit(caller, (loaded) => {
      const ops: Op[] = [];
      let madeLayer: string | undefined;

      for (const entry of comments) {
        const placement = entry.placement ?? "before";
        if (madeLayer !== undefined && !ownsAddress(loaded, entry.address)) {
          ops.push({
            op: "comment.set",
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
            op: "comment.set",
            id: newId("cmt"),
            layerId: owning.layerId,
            address: entry.address,
            placement,
            text: entry.text,
          });
        } else {
          ops.push(commentSetOp(loaded, entry.address, placement, entry.text));
        }
      }

      return ops;
    });
  }

  /** Declare several constants as one action. */
  setConstants(
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

    return this.edit(caller, (loaded) =>
      constants.map((entry) => ({
        op: "constant.set",
        id: loaded.constants.byName(entry.name)?.id ?? newId("cst"),
        name: entry.name,
        value: entry.value,
      }))
    );
  }

  removeComment(caller: Caller, address: number, placement?: CommentPlacement): EditResult {
    return this.edit(caller, (loaded) => {
      const op = commentDeleteOp(loaded, address, placement);
      if (!op) {
        throw new Error(
          `No comment at ${hex4(address)}${placement ? ` (${placement})` : ""}.`
        );
      }
      return [op];
    });
  }

  removeLabel(caller: Caller, address: number): EditResult {
    return this.edit(caller, (loaded) => {
      const op = labelDeleteOp(loaded, address);
      if (op) return [op];

      // "No label here" contradicts a listing that plainly shows one. Say
      // where the name actually comes from, since that is the fact the caller
      // is missing — a layer's own entry point or the built-in C64 table
      // belongs to nothing this project can edit.
      const showing = loaded.map.getLabels().getLabelsAt(address);
      if (showing.length > 0) {
        const sources = [...new Set(showing.map((l) => l.source.kind))].join(", ");
        throw new Error(
          `${hex4(address)} is named ${showing.map((l) => l.name).join(", ")}, ` +
            `but that comes from ${sources} rather than from this project, so ` +
            `there is nothing here to remove. Use set_label to give it a name ` +
            `of your own.`
        );
      }
      throw new Error(`This project has no label at ${hex4(address)}`);
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
   * Declare what a span holds.
   *
   * `end` is exclusive, and a caller that reads it as inclusive gets a region
   * one byte short. That is silent for most kinds and fatal for a jumptable,
   * where every entry is two bytes: `$8000-$8001` is one byte, contains no
   * address, decodes nothing, and returns ok. On a project with nothing else
   * reachable that is the difference between the whole program and five
   * instructions.
   *
   * So the span it actually took is reported back, and an odd-length jumptable
   * is refused. Odd rather than merely too-short, because the off-by-one is the
   * same mistake at every size and the extractor drops a trailing odd byte
   * without saying so.
   */
  setRegion(
    caller: Caller,
    start: number,
    end: number,
    kind: RegionKind,
    name?: string,
    comment?: string,
    encoding?: TextEncoding,
    view?: string,
    id?: string
  ): EditResult {
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
            `and set_decoder adds one.`
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

    // Worked out before the edit, because afterwards the enclosing region is no
    // longer the one that was there first.
    const enclosing = this.program().loaded.map.getRegionAt(start);
    const nests =
      id === undefined &&
      enclosing !== undefined &&
      enclosing.start <= start &&
      end < enclosing.end;

    const result = this.edit(
      caller,
      (loaded) => [regionSetOp(loaded, start, end, kind, name, comment, encoding, viewOrCleared, id)],
      { start, end }
    );
    return {
      ...result,
      covers: `${hex4(start)}-${hex4(end - 1)} (${end - start} bytes)`,
      // Said out loud, because "I declared 32 bytes and something else changed"
      // is exactly the kind of thing a caller should not have to discover.
      ...(nests
        ? {
            nestedInside:
              `${enclosing.name ?? enclosing.kind} ` +
              `(${hex4(enclosing.start)}-${hex4(enclosing.end - 1)}), which is unchanged and ` +
              `still explains the bytes either side. To shrink it instead, ` +
              `remove_region ${hex4(enclosing.start)} first.`,
          }
        : {}),
    };
  }

  removeRegion(caller: Caller, start: number, id?: string): EditResult {
    return this.edit(caller, (loaded) => {
      const op = regionDeleteOp(loaded, start, id);
      if (!op) throw new Error(`No region starts at ${hex4(start)}`);
      return [op];
    });
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
          `still code, say so: set_region start ${hex4(orphan)} kind "code", ` +
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
  address: string;
  name: string;
  type: LabelType;
  source: string;
  references: number;
  writable: boolean;
}

export interface EditResult {
  ok: true;
  version: string;
  did: string[];
  instructions: { before: number; after: number; delta: number };
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
   * The span a region write actually took, inclusive at both ends.
   *
   * Stated because `end` is exclusive and a reader who assumed otherwise has
   * no other way to notice: the write succeeds and the region is a byte short.
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
