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
  RegionKind,
  analyze,
  analyzeProgram,
  blobPaths,
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
import { projectFromDoc } from "../core/crdt/index.js";
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

export class Workspace {
  private cached?: { key: string; loaded: LoadedProject; program: ProgramAnalysis };
  private cachedRows?: { key: string; rows: AnalysisResult };

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

    return `${store.docVersion}:${fingerprint}`;
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

    const rows = analyze(this.program().loaded);
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
    version: string;
    entryPoints: string[];
    layers: { level: number; name: string; start: string; end: string; labels: number }[];
    regions: { start: string; end: string; kind: string; name?: string }[];
    counts: {
      instructions: number;
      namedByHand: number;
      namedAutomatically: number;
      namedByPlatform: number;
    };
    warnings: number;
  } {
    const program = this.program();
    const { loaded } = program;
    const auto = program.labels.filter({ source: "auto" });
    // Supplied by re64 rather than decided by anyone: the built-in C64 symbol
    // table, and the entry point a PRG layer labels from its load address.
    const supplied = [
      ...program.labels.filter({ source: "platform" }),
      ...program.labels.filter({ source: "layer" }),
    ];

    return {
      project: this.room.projectId,
      version: this.version(),
      entryPoints: program.entryPoints.map(hex4),
      layers: loaded.layers.map((layer, index) => ({
        level: index,
        name: layer.name,
        start: hex4(layer.start),
        end: hex4(layer.end),
        labels: layer.getLabels().length,
      })),
      regions: loaded.map.getAllRegions().map((r) => ({
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

    const slice = rows.slice(from, from + limit);
    const truncated = from + limit < rows.length;

    return {
      start: hex4(slice[0]?.address ?? start),
      truncated,
      nextStart: truncated ? hex4(rows[from + limit].address) : undefined,
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
    const lineAt = (a: number) => rows[lineForAddress[a]]?.text;

    // The nearest named address at or before this one, which is as close to
    // "the routine containing it" as anything gets without a call graph. Only
    // labels that mark somewhere execution can start count: a data name above
    // the call site would be a confident wrong answer.
    const enclosing = (from: number): string | undefined => {
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
        "reached that way appears to have no callers at all.",
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
          covered.has(address) || kind === "data" || kind === "text" || kind === "jumptable";
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
    cursor = 0,
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
    return this.edit(caller, (loaded) => {
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
    labels: readonly { address: number; name: string; type?: LabelType; comment?: string }[]
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
            ? { op: "label.set", id: newId("lbl"), layerId, address: entry.address, name: entry.name, type: entry.type }
            : labelSetOp(loaded, entry.address, entry.name, entry.type)
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
   * `randomValue` throughout and `gridXPos` inside one routine, which is a
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

      const { layerId, create } = ensureOwningLayer(loaded, address, this.room.projectId);
      return create
        ? [
            create,
            { op: "label.set", id: newId("lbl"), layerId, address, name, type, extent } as Op,
          ]
        : [labelAddOp(loaded, address, name, type, extent)];
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
  listing(start?: number, lines = 200): {
    start: string;
    text: string;
    truncated: boolean;
    nextStart?: string;
  } {
    const { rows } = this.rows();
    const from = start === undefined ? 0 : rows.findIndex((r) => r.address >= start);
    const begin = from < 0 ? rows.length : from;
    const page = rows.slice(begin, begin + lines);

    const covered = new Set(page.map((r) => r.address));
    const used = this.program().loaded.constants.used((a) => covered.has(a));
    const equates = used.map(
      (c) => `${c.name.padEnd(28)}= $${c.value.toString(16).toUpperCase().padStart(2, "0")}`
    );

    const body = page.map((r) => r.text);
    const text = [...equates, ...(equates.length ? [""] : []), ...body].join("\n");
    const after = rows[begin + lines];

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
   * reference disassembly names $01 both LEFT_ZAPPER and WHITE — and guessing
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
    constants: { name: string; value: string; uses: number }[];
  } {
    const program = this.program();
    const used = new Set(program.loaded.constants.used().map((c) => c.id));

    return {
      total: program.loaded.constants.all().length,
      constants: program.loaded.constants.all().map((c) => ({
        name: c.name,
        value: `$${c.value.toString(16).toUpperCase().padStart(2, "0")}`,
        uses: used.has(c.id) ? 1 : 0,
      })),
    };
  }

  /**
   * Every instruction loading an immediate, optionally of one value.
   *
   * The other half of naming a constant: having decided that $01 here means
   * LEFT_ZAPPER, the next question is where else $01 is loaded — and whether
   * those sites mean the same thing, which only a reader can say.
   */
  immediates(
    value?: number,
    limit = 100
  ): {
    total: number;
    sites: { address: string; value: string; boundTo?: string; text?: string }[];
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
          text: rows[lineForAddress[i.address]]?.text,
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
    return this.edit(caller, (loaded) => {
      const { layerId, create } = ensureOwningLayer(loaded, address, this.room.projectId);
      if (!create) return [commentSetOp(loaded, address, placement, text)];
      return [
        create,
        { op: "comment.set", id: newId("cmt"), layerId, address, placement, text } as Op,
      ];
    });
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
      if (!op) throw new Error(`This project has no label at ${hex4(address)}`);
      return [op];
    });
  }

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
    encoding?: TextEncoding
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

    const result = this.edit(caller, (loaded) => [
      regionSetOp(loaded, start, end, kind, name, comment, encoding),
    ]);
    return {
      ...result,
      covers: `${hex4(start)}-${hex4(end - 1)} (${end - start} bytes)`,
    };
  }

  removeRegion(caller: Caller, start: number): EditResult {
    return this.edit(caller, (loaded) => {
      const op = regionDeleteOp(loaded, start);
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
  private edit(caller: Caller, build: (loaded: LoadedProject) => Op[]): EditResult {
    const before = this.program().instructions.size;
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
   * Warnings this edit introduced, when it introduced any.
   *
   * Almost always absent. When present it usually means a decode now overlaps
   * itself, which the listing cannot render and which nothing else would say.
   */
  warnings?: string[];
  /**
   * The span a region write actually took, inclusive at both ends.
   *
   * Stated because `end` is exclusive and a reader who assumed otherwise has
   * no other way to notice: the write succeeds and the region is a byte short.
   */
  covers?: string;
}
