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
  newId,
  parseProject,
  parseProjectAddress,
  resolveOwningLayer,
} from "../core/index.js";
import { FileStorage, ProjectStore, pathsFor } from "../store/index.js";
import { loadProjectFile } from "../node-files.js";

export class ProjectEditor {
  private readonly store: ProjectStore;
  private parsed?: Project;
  private loaded?: LoadedProject;

  constructor(private readonly projectPath: string) {
    this.store = new ProjectStore(new FileStorage(pathsFor(projectPath)));
  }

  /**
   * The layer that should own an annotation at an address, by id.
   *
   * Loads the project properly rather than guessing from the schema: a PRG
   * layer's range comes from the file's load header, not from any declared
   * address, so nothing in the JSON alone says where it sits.
   */
  owningLayerId(address: number): string {
    const loaded = (this.loaded ??= loadProjectFile(this.projectPath));
    const index = resolveOwningLayer(loaded, address);
    if (index === undefined) {
      throw new Error(
        `No layer owns ${address.toString(16).toUpperCase()}. Add a layer of ` +
          `type "symbols" to name addresses outside the loaded bytes.`
      );
    }
    const id = loaded.project.layers[index].id;
    if (!id) throw new Error(`Layer ${index} has no id; run: re64 migrate ${this.projectPath}`);
    return id;
  }

  project(): Project {
    return (this.parsed ??= parseProject(this.store.text()));
  }

  /** A label.set op, reusing the id already at that address if there is one. */
  labelSetOp(
    layerId: string,
    address: number,
    name: string,
    type?: LabelType,
    comment?: string
  ): Op {
    const layer = this.project().layers.find((l) => l.id === layerId);
    const existing = layer?.labels?.find((l) => parseProjectAddress(l.address) === address);
    return { op: "label.set", id: existing?.id ?? newId("lbl"), layerId, address, name, type, comment };
  }

  /** A label.delete op, or undefined when nothing is named there. */
  labelDeleteOp(layerId: string, address: number): Op | undefined {
    const layer = this.project().layers.find((l) => l.id === layerId);
    const existing = layer?.labels?.find((l) => parseProjectAddress(l.address) === address);
    return existing?.id ? { op: "label.delete", id: existing.id, layerId } : undefined;
  }

  /** A region.set op, reusing the id of a region with the same start. */
  regionSetOp(
    layerId: string,
    start: number,
    end: number,
    kind: RegionKind,
    name?: string
  ): Op {
    const layer = this.project().layers.find((l) => l.id === layerId);
    const existing = layer?.regions?.find((r) => parseProjectAddress(r.start) === start);
    return { op: "region.set", id: existing?.id ?? newId("rgn"), layerId, start, end, kind, name };
  }

  /** A region.delete op for whichever layer declares a region starting there. */
  regionDeleteOp(start: number): Op | undefined {
    for (const layer of this.project().layers) {
      const found = layer.regions?.find((r) => parseProjectAddress(r.start) === start);
      if (found?.id && layer.id) {
        return { op: "region.delete", id: found.id, layerId: layer.id };
      }
    }
    return undefined;
  }

  run(ops: readonly Op[], author: string, now: number): string[] {
    const { descriptions } = this.store.runOps(ops, author, now);
    this.parsed = undefined;
    this.loaded = undefined;
    return descriptions;
  }

  undo(author?: string): string | null {
    this.parsed = undefined;
    return this.store.undo(author);
  }

  redo(author?: string): string | null {
    this.parsed = undefined;
    return this.store.redo(author);
  }
}

export function openProject(projectPath: string): ProjectEditor {
  return new ProjectEditor(projectPath);
}
