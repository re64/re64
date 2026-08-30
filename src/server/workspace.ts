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
  labelDeleteOp,
  labelSetOp,
  makeFileLoader,
  markFunctionOps,
  parseProject,
  regionDeleteOp,
  regionSetOp,
  unmarkFunctionOps,
} from "../core/index.js";
import { projectFromDoc } from "../core/crdt/index.js";
import { databaseFileBytes } from "../store/load.js";
import { FileStorage, ProjectStore, SqliteStorage } from "../store/index.js";
import { nodeFileBytes } from "../node-files.js";

/** Who is asking. Resolved once per connection, never per call. */
export interface Caller {
  userId: string;
  label: string;
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

  describe(): {
    project: string;
    version: string;
    entryPoints: string[];
    layers: { level: number; name: string; start: string; end: string; labels: number }[];
    regions: { start: string; end: string; kind: string; name?: string }[];
    counts: { instructions: number; namedByHand: number; namedAutomatically: number };
    warnings: number;
  } {
    const program = this.program();
    const { loaded } = program;
    const auto = program.labels.filter({ source: "auto" });

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
        namedByHand: program.labels.getAllLabels().length - auto.length,
        namedAutomatically: auto.length,
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
    inbound?: { from: string; type: string; text?: string }[];
    outbound?: { to: string; type: string; name?: string }[];
    incomplete: string;
  } {
    const program = this.program();
    const { rows, lineForAddress } = this.rows();
    const lineAt = (a: number) => rows[lineForAddress[a]]?.text;

    return {
      address: hex4(address),
      ...(direction !== "out"
        ? {
            inbound: program.xrefs.to(address).map((r: Reference) => ({
              from: hex4(r.from),
              type: r.type,
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
        "Inbound references cover absolute addressing only. Zero-page and " +
        "indirect targets are not recorded, so a routine reached that way " +
        "appears to have no callers.",
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
    const invented = label.source.kind === "auto";
    return {
      address: hex4(label.address),
      name: label.name,
      type: label.type,
      source: label.source.kind,
      references: program.xrefs.count(label.address),
      // An auto label's id is derived from the fact that nothing named it.
      // Handing it out invites an edit claiming an identity that means nothing.
      writable: !invented,
    };
  }

  // --- writes ---------------------------------------------------------

  setLabel(
    caller: Caller,
    address: number,
    name: string,
    type?: LabelType,
    comment?: string
  ): EditResult {
    return this.edit(caller, (loaded) => [
      labelSetOp(loaded, address, name, type, comment),
    ]);
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

  setRegion(
    caller: Caller,
    start: number,
    end: number,
    kind: RegionKind,
    name?: string,
    comment?: string
  ): EditResult {
    return this.edit(caller, (loaded) => [
      regionSetOp(loaded, start, end, kind, name, comment),
    ]);
  }

  removeRegion(caller: Caller, start: number): EditResult {
    return this.edit(caller, (loaded) => {
      const op = regionDeleteOp(loaded, start);
      if (!op) throw new Error(`No region starts at ${hex4(start)}`);
      return [op];
    });
  }

  undo(caller: Caller): { undone: string | null; version: string } {
    return { undone: this.room.store.undo(caller.userId), version: this.version() };
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
    const ops = build(this.program().loaded);

    const { descriptions } = this.room.store.runOps(ops, caller.userId, Date.now());
    const after = this.program().instructions.size;

    return {
      ok: true,
      version: this.version(),
      did: descriptions,
      instructions: { before, after, delta: after - before },
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
}
