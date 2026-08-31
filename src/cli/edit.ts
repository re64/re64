/**
 * Write commands.
 *
 * The headless edit surface: an agent drives these — or `apply` with a batch of
 * operations — without a browser. Every change goes through the same operation
 * layer the UI uses, and is recorded beside the project so `undo` works across
 * invocations.
 *
 * One editor per invocation, holding one store. Every op used to re-read and
 * re-parse the project for itself: a single `label set` cost three reads of the
 * project plus one of the log, and each read could see a different state.
 */

import {
  LabelType,
  LoadedProject,
  Op,
  Project,
  RegionKind,
  labelDeleteOp,
  commentSetOp,
  labelSetOp,
  owningLayerId,
  parseProject,
  regionDeleteOp,
  regionSetOp,
} from "../core/index.js";
import {
  FileStorage,
  ProjectStore,
  SqliteStorage,
  UndoOutcome,
  loadProjectFromDatabase,
  pathsFor,
} from "../store/index.js";
import { loadProjectFile } from "../node-files.js";

export class ProjectEditor {
  private readonly store: ProjectStore;
  private readonly isDatabase: boolean;
  private parsed?: Project;
  private loaded?: LoadedProject;

  /** Takes either a project database or a plain project file. */
  constructor(private readonly projectPath: string) {
    this.isDatabase = projectPath.endsWith("db");
    this.store = new ProjectStore(
      this.isDatabase
        ? new SqliteStorage(projectPath, new SqliteStorage(projectPath).projects()[0]?.id)
        : new FileStorage(pathsFor(projectPath))
    );
  }

  private loadedProject(): LoadedProject {
    return (this.loaded ??= this.isDatabase
      ? loadProjectFromDatabase(this.projectPath)
      : loadProjectFile(this.projectPath));
  }

  owningLayerId(address: number): string {
    return owningLayerId(this.loadedProject(), address);
  }

  labelSetOp(
    _layerId: string,
    address: number,
    name: string,
    type?: LabelType,
    comment?: string
  ): Op[] {
    // A comment is about the address, not a field on the label, so naming and
    // commenting are two operations in one action.
    const loaded = this.loadedProject();
    return [
      labelSetOp(loaded, address, name, type),
      ...(comment ? [commentSetOp(loaded, address, "before", comment)] : []),
    ];
  }

  labelDeleteOp(_layerId: string, address: number): Op | undefined {
    return labelDeleteOp(this.loadedProject(), address);
  }

  regionSetOp(
    _layerId: string,
    start: number,
    end: number,
    kind: RegionKind,
    name?: string,
    view?: string
  ): Op {
    // `comment` and `encoding` still have no CLI surface; `view` does, because
    // a bitmap region without one cannot be drawn at all.
    return regionSetOp(this.loadedProject(), start, end, kind, name, undefined, undefined, view);
  }

  regionDeleteOp(start: number): Op | undefined {
    return regionDeleteOp(this.loadedProject(), start);
  }

  run(ops: readonly Op[], author: string, now: number): string[] {
    const { descriptions } = this.store.runOps(ops, author, now);
    this.parsed = undefined;
    this.loaded = undefined;
    return descriptions;
  }

  undo(author?: string): UndoOutcome {
    this.parsed = undefined;
    return this.store.undo(author);
  }

  redo(author?: string): UndoOutcome {
    this.parsed = undefined;
    return this.store.redo(author);
  }
}

export function openProject(projectPath: string): ProjectEditor {
  return new ProjectEditor(projectPath);
}
