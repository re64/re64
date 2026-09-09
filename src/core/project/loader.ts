/**
 * Builds a MemoryMap from a parsed project.
 *
 * Shared by the CLI and the server, which previously each carried their own
 * copy of this logic and had already drifted apart in small ways.
 *
 * Layers are added bottom-up: the platform symbol layer first, then project
 * layers in declaration order, so a layer declared later shadows earlier ones.
 * Each layer takes ownership of its own labels and regions as it is built.
 */

import { FieldType, TypeIndex, parseFieldType } from "../memory/type.js";
import { BytesLayer, Layer } from "../memory/layer.js";
import { FileLayer } from "../memory/file-layer.js";
import { SymbolLayer } from "../memory/symbol-layer.js";
import { MemoryMap } from "../memory/memory-map.js";
import { LabelType } from "../memory/label-type.js";
import { NameIndex, LabelUse } from "../claims/names.js";
import { LayerDefault } from "../memory/region.js";
import { CommentIndex } from "../memory/comment.js";
import { ConstantIndex } from "../memory/constant.js";
import { createC64PlatformLayer } from "../c64/symbols.js";
import {
  Project,
  ProjectLayer,
  parseProjectAddress,
  ProjectConstant,
  projectCommentsToComments,
  projectConstantUses,
  projectConstants,
  projectLabelUses,
  projectLabelsToLabels,
  projectRegionsToRegions,
  projectClaims,
  retiredClaimIds,
  ProjectType,
  ProjectTarget,
  targetLinks,
} from "./project.js";
import { derivedId } from "./identity.js";
import { needsMigration, migrateToClaims } from "../claims/migrate.js";
import { Claim, Interpretation, arrayExtent, resolveAt } from "../claims/model.js";

/** How the loader gets at file bytes, so core stays free of node:fs. */
export interface FileLoader {
  (path: string, explicitStart?: number): {
    start: number;
    data: Uint8Array;
    isPrg: boolean;
  };
}

export interface LoadedProject {
  project: Project;
  map: MemoryMap;
  /**
   * The view this was built for, when the project declares any.
   *
   * Absent for a project that declares none: the loader implies a single
   * arrangement over the whole stack, and framing a claim on a target that is
   * not in the file would dangle the moment somebody declared a real one.
   *
   * Carried rather than re-derived because two things need it and both used to
   * guess. A claim framed on a target belongs to *that* target and must not
   * appear in another; and a write has to record which view it was made in, by
   * **id**, since a name is a field somebody can change.
   */
  selectedTarget?: { id: string; name: string };
  /** Load addresses of PRG layers that did not suppress their entry point. */
  prgEntries: number[];
  /** Every user label across all layers, for entry point collection. */
  userLabels: NameIndex;
  /**
   * Everything written about an address, across all layers.
   *
   * Flat rather than per-layer because rendering asks "what is said about this
   * address", and the answer does not depend on which layer holds it.
   */
  comments: CommentIndex;
  /**
   * Every claim, resolved.
   *
   * The stored form. `userLabels` and each layer's `regions` are views derived
   * from it, which is why nothing else needs to know claims exist yet.
   */
  claims: Claim[];
  /** Names for values, and which operands mean them. */
  constants: ConstantIndex;
  /**
   * The record layouts this project declares.
   *
   * Project-level like constants and decoders: a layout describes no bytes of
   * its own, so there is no layer for it to move with when the stack is
   * reordered. A claim referencing one is what belongs to a layer.
   */
  types: TypeIndex;
  /**
   * ROMs this project asked for and this host does not have.
   *
   * Reported rather than thrown: the request is committed and the bytes are
   * not, so a project that wants BASIC banked in stays openable by somebody who
   * has no ROMs. But it must not be *silent* — every answer that would have
   * used those bytes is short, and an unexplained short answer is the failure
   * this project keeps recording.
   */
  romsMissing: string[];
  /**
   * Built layers in *declaration* order, so index i corresponds to
   * project.layers[i]. The map itself stores them in z-order (reversed, with
   * the platform layer at the bottom), which is no use for writing edits back.
   */
  layers: Layer[];
}

function parseHexBytes(hex: string): Uint8Array {
  return new Uint8Array(hex.match(/.{2}/g)?.map((b) => parseInt(b, 16)) ?? []);
}

/** A readable layer name: the declared one, else the file basename, else an index. */
function layerName(layer: ProjectLayer, index: number): string {
  if (layer.name) return layer.name;
  if (layer.path) {
    const base = layer.path.split("/").pop() ?? layer.path;
    return base.replace(/\.[^.]+$/, "");
  }
  return `layer${index + 1}`;
}

/**
 * Build a memory map from a parsed project.
 *
 * `loadFile` supplies bytes; `platform` can be disabled for tests that want a
 * map containing nothing but the project's own layers.
 */
/**
 * The project as the selected target sees it.
 *
 * A target is a *view*: it narrows the layer stack and supplies the entry
 * points, and everything downstream — ownership, annotations, analysis — then
 * works on a project that simply has fewer layers. Filtering here rather than
 * inside the build keeps `layers[i]` corresponding to `project.layers[i]`,
 * which several things rely on.
 *
 * No target selected means every layer and the project's own entry points,
 * so a one-layer project declares nothing and behaves exactly as before.
 */
/**
 * The project with a target, deriving one where the file has none.
 *
 * Every project has a stack, so every project has a target: the alternative was
 * two ways to get one — a target's link list when a file declares them, and the
 * *declaration order* of `project.layers` when it does not. The same field
 * meaning two things depending on whether a target is selected is how
 * "entryPoints said 2 while decodeStartsFrom said 19" happened, one field over,
 * in this same function.
 *
 * Derived on load and **persisted by the next write**, which is the precedent
 * this project already set for ids: a file without them stays loadable, the
 * derivation is content-based so every client agrees, and the next write makes
 * it real. Deriving it on every load and never persisting would be worse than
 * the seam it replaces — the thing deciding your z-order would be invisible in
 * the file, absent from `list_targets`, and unreachable by `set_target`.
 *
 * Named after the project rather than `default`, because a name nobody chose is
 * what this codebase keeps being caught by, and because "gridrunner" reads as a
 * fact where a placeholder reads as machinery.
 */
/**
 * A layer's id, derived where the file has none.
 *
 * Shared with the layer construction below rather than restated, because a
 * target links layers *by id* and a derivation that drifted from the one the
 * layers get would silently drop every un-migrated layer out of its own stack.
 * Deterministic, so every client loading the same file agrees — the same
 * property the id derivation has everywhere else here.
 */
function layerIdOf(decl: ProjectLayer, index: number): string {
  return decl.id ?? derivedId("lay", index, decl.type, decl.path ?? decl.name ?? "");
}

/**
 * The one target a project with none implies.
 *
 * A file that declares no targets still has a stack, so it gets exactly one
 * view over it, named after the project — "gridrunner" reads as a fact where
 * "default" reads as machinery. **One, not a default among several**: a project
 * that declares its own targets is left alone, because choosing between them is
 * the reader's business and not the file's.
 *
 * This used to also set `project.defaultTarget`, and that field is gone. It was
 * a document property doing a request's job: every call that named no target
 * silently got whichever target sorted first, and the Camels silver image —
 * which declares five and no default — answered every such call through
 * `loader`, a view linking one layer, where every claim framed on the runtime
 * layer simply does not exist. Which view you are looking through is a property
 * of the looker, not of the program.
 */
export function withSyntheticTarget(project: Project): Project {
  if (project.targets?.length) return project;

  const name = project.name ?? "project";
  return {
    ...project,
    targets: [
      {
        name,
        // Declaration order, so the derived stack is the stack the file already
        // had. A symbols layer is never linked — it supplies no bytes, so it
        // shadows nothing and a target has nothing to say about it.
        layers: project.layers
          .map((l, index) => ({ decl: l, id: layerIdOf(l, index) }))
          .filter(({ decl }) => decl.type !== "symbols")
          .map(({ id }) => id),
        // Moved, not copied: `projectForTarget` lets a target's list *replace*
        // the project's, so leaving them behind would silently drop every entry
        // point the moment a target existed.
        ...(project.entryPoints === undefined ? {} : { entryPoints: project.entryPoints }),
      },
    ],
  };
}

/**
 * Which target a caller means, by id or by name.
 *
 * **An id wins, and a name is an alias.** Names are what a person types and
 * what `list_targets` shows, so they stay usable — the same latitude
 * `remove_constant` gives — but they are resolved *here*, at the boundary, and
 * never stored. Two targets sharing a name is a hygiene finding rather than
 * something a write prevents, so an ambiguous one is refused and both are named
 * rather than the first silently winning.
 *
 * **Nothing is chosen for the caller.** Where a project declares more than one
 * target and none is named, this refuses and says which there are, because every
 * alternative is a guess: picking the first by `order` is what the removed
 * `defaultTarget` did, and the guess was wrong for the one project in this
 * repository that has several. A project with exactly one target has no choice
 * to make, so a caller that named none gets it.
 */
export function selectTarget(project: Project, named?: string): ProjectTarget | undefined {
  const targets = project.targets ?? [];
  if (named === undefined) return targets.length === 1 ? targets[0] : undefined;

  const byId = targets.find((t) => t.id === named);
  if (byId) return byId;

  const byName = targets.filter((t) => t.name === named);
  if (byName.length > 1) {
    throw new Error(
      `Two targets are called "${named}" in this project, so the name says which ` +
        `one only if you use its id: ${byName.map((t) => t.id ?? "(no id)").join(", ")}. ` +
        `list_targets reports both.`
    );
  }
  return byName[0];
}

export function projectForTarget(project: Project, name?: string): Project {
  const targets = project.targets ?? [];
  const target = selectTarget(project, name);

  if (!target) {
    if (name !== undefined) {
      throw new Error(
        `No target called "${name}" in this project. list_targets shows what there is.`
      );
    }
    if (targets.length === 0) return project;
    throw new Error(
      `This project has ${targets.length} views over its layers and you named none: ` +
        `${targets.map((t) => t.name).join(", ")}. Say which — the bytes at an address ` +
        `differ between them, so there is no answer that is right for all of them.`
    );
  }

  const links = targetLinks(target);
  // By the *derived* id, so a file whose layers have none is still linkable —
  // the ids are content-derived and every client agrees on them, which is what
  // makes an un-migrated file load identically everywhere.
  const declared = new Map(project.layers.map((l, i) => [layerIdOf(l, i), l] as const));

  // A symbols layer is never linked and never filtered. It supplies no bytes,
  // so it shadows nothing and occupies no range, and a target is a statement
  // about which bytes you are reading — there is nothing for it to say about a
  // layer that has none. Keeping it is also the only version that survives the
  // offline test: putting it in each target's list meant writing that whole
  // list to name an address, so two people doing so at once would drop one
  // another's layers out of the view.
  const symbols = project.layers.filter((l) => l.type === "symbols");

  // The target's order *is* the z-order, bottom-up like the file's own `layers`
  // array — which is what makes a layer a dumb byte resource and what finally
  // gives the stack an operation that can reorder it. A link naming a layer the
  // project no longer declares is skipped rather than refused: a delete racing
  // a link heals itself, the same rule a dangling constant follows.
  const linked = links.flatMap((link) => {
    const layer = declared.get(link.layer);
    if (!layer || layer.type === "symbols") return [];
    // Where it lands *here*. Absent means the layer's own address, which for a
    // PRG is the header its file carries.
    return [link.at === undefined ? layer : { ...layer, address: link.at }];
  });

  return {
    ...project,
    layers: [...symbols, ...linked],
    // The target's own list replaces the project's: the same field meaning two
    // things depending on whether a target is selected is how "entryPoints said
    // 2 while decodeStartsFrom said 19" happened.
    ...(target.entryPoints === undefined
      ? { entryPoints: undefined }
      : { entryPoints: target.entryPoints }),
  };
}


/**
 * A claim, as the name index takes it.
 *
 * This was `labelFromClaim`, building a parallel `Label` record out of every
 * field the claim already had. What is left is the one thing that conversion
 * was actually *doing*: narrowing the extent.
 *
 * Only a claim about data offers offsets to operand rendering. A code root
 * carrying an extent must not, or declaring a routine turns `BPL loc_8050` into
 * `BPL UpdateExplosion + $0010` — the bug `arrayExtent` exists for, and the
 * reason this is a function rather than nothing at all.
 */
function nameClaim(claim: Claim): Claim {
  const extent = arrayExtent(claim);
  if (extent === claim.extent) return claim;
  const { extent: _dropped, ...rest } = claim;
  return extent === undefined ? rest : { ...rest, extent };
}

/**
 * The record layouts a project declares, indexed.
 *
 * Lifted out of `buildMemoryMap` because it needs no memory map: a layout
 * describes no bytes of its own, so which layers are linked cannot change what
 * one is. `list_types` reached it through a loaded project and therefore
 * through a view, which made asking what layouts exist require a choice of
 * stack that has nothing to do with the answer.
 */
export function projectTypes(project: Project): TypeIndex {
  const types = new TypeIndex();
  for (const declared of project.types ?? []) {
    if (!declared.id) continue;
    types.add({
      id: declared.id,
      name: declared.name,
      size: typeof declared.size === "string" ? parseProjectAddress(declared.size) : declared.size,
      ...(declared.unit === undefined ? {} : { unit: declared.unit }),
      fields: Object.fromEntries(
        Object.entries(declared.fields).map(([offset, field]) => [
          Number(offset),
          {
            name: field.name,
            // Unparseable is not an error here: a field naming a type that has
            // gone renders its bytes, exactly as a dangling constant renders
            // the literal. Hygiene reports it; loading does not refuse.
            type: resolveFieldType(field.type, project.types ?? [], project.constants ?? []),
            ...(field.description === undefined ? {} : { description: field.description }),
          },
        ])
      ),
    });
  }
  return types;
}

export function buildMemoryMap(
  declared: Project,
  loadFile: FileLoader,
  options: { platform?: boolean; loadRom?: RomLoader; target?: string } = {}
): LoadedProject {
  // One form below, whatever the file holds. A project still written with labels
  // and regions is converted here, exactly as `re64 migrate` converts it on disk
  // — the precedent `identity.ts` already records for ids: "files without ids
  // stay loadable; the next write persists real ones."
  //
  // This is what makes the write path's cutover visible. While the projection
  // was additive, an edit to a legacy label produced a `claim.set` naming an id
  // no claim had, and did nothing at all.
  const migrated = needsMigration(declared) ? migrateToClaims(declared).project : declared;

  // Narrowed here rather than by each caller, which is the second half of "one
  // path to a stack". Only the server did it, so `loadProjectFile` — the CLI,
  // the golden test, every core test — ignored targets entirely and read every
  // layer whatever the project said. Two consumers of one project disagreeing
  // about which bytes are in it is the kind of thing nobody notices until a
  // listing and a tool answer differently.
  // A view nothing declares is refused rather than answered for, and so is a
  // choice nobody made. Falling back would hand a caller a different stack than
  // the one it meant, with no way to tell — the confident wrong answer this
  // project refuses.
  // **Which view, resolved once.** A name is an alias for an id here and
  // nowhere deeper: the loader knows which target it chose, and everything that
  // needs to know asks it rather than matching a string again.
  //
  // Only when the project *declares* targets. A file that declares none gets one
  // implied over its whole stack, and framing a claim on a target that is not in
  // the document would dangle the moment somebody declared a real one.
  const declaresTargets = (migrated.targets ?? []).length > 0;
  const withTargets = withSyntheticTarget(migrated);
  const chosen = declaresTargets ? selectTarget(withTargets, options.target) : undefined;
  const project = projectForTarget(withTargets, options.target);

  const map = new MemoryMap();
  const prgEntries: number[] = [];
  const userLabels = new NameIndex();
  const comments = new CommentIndex();
  const constants = new ConstantIndex();
  const types = projectTypes(project);
  // Held until the merged index exists: a site can name a label in any layer.
  const labelUses: LabelUse[] = [];
  constants.declareAll(projectConstants(project.constants));
  const layers: Layer[] = [];

  if (options.platform !== false) {
    map.addLayer(createC64PlatformLayer());
  }

  const { loadRom } = options;
  const romsMissing: string[] = [];

  project.layers.forEach((decl, index) => {
    const name = layerName(decl, index);
    // Derived from position and source when absent: stable for a given file,
    // replaced by a real id on the next write.
    const layerId = layerIdOf(decl, index);
    let layer: Layer;

    if (decl.type === "prg") {
      const { start, data, isPrg } = loadFile(
        decl.path!,
        decl.address === undefined ? undefined : parseProjectAddress(decl.address)
      );
      const suppressEntry = decl.noAutoEntry ?? false;
      layer = new FileLayer(name, decl.path!, start, data, undefined, isPrg, suppressEntry, layerId);
      if (isPrg && !suppressEntry) prgEntries.push(start);
    } else if (decl.type === "raw") {
      const addr = parseProjectAddress(decl.address!);
      const { data } = loadFile(decl.path!, addr);
      layer = new FileLayer(name, decl.path!, addr, data, decl.length, false, false, layerId);
    } else if (decl.type === "rom") {
      // The machine's bytes, not this project's, so they come from wherever the
      // host keeps ROMs rather than from the project's files. A host that has
      // none — a browser, or anybody who has not put them there — gets a layer
      // that supplies nothing and says so, because a project must stay openable
      // by somebody who cannot legally be handed a ROM.
      const rom = decl.rom ?? "kernal";
      const bytes = loadRom?.(rom);
      if (!bytes) {
        romsMissing.push(rom);
        layer = new SymbolLayer(name, [], layerId);
      } else {
        layer = new BytesLayer(name, ROM_AT[rom], bytes, undefined, layerId, decl.reference ?? true);
      }
    } else if (decl.type === "bytes") {
      const addr = parseProjectAddress(decl.address!);
      layer = new BytesLayer(name, addr, parseHexBytes(decl.bytes!), decl.length, layerId);
    } else {
      layer = new SymbolLayer(name, projectLabelsToLabels(decl.labels ?? [], layerId), layerId);
    }

    if (decl.regions?.length) {
      layer.regions.addRegions(projectRegionsToRegions(decl.regions, layerId));
    }

    // A symbol layer receives its labels via the constructor; every other kind
    // takes ownership here, so they move with the layer on reorder.
    const labels = projectLabelsToLabels(decl.labels ?? [], layerId);
    if (decl.type !== "symbols") {
      layer.labels.push(...labels);
    }
    userLabels.addLabels(labels);
    comments.addAll(projectCommentsToComments(decl, layerId));
    constants.bindAll(projectConstantUses(decl, layerId));
    for (const use of projectLabelUses(decl, layerId)) {
      userLabels.bindUse(use.address, use.labelId);
      labelUses.push(use);
    }

    layers.push(layer);
    map.addLayer(layer);
  });

  // Claims, projected onto the structures the analysis already reads.
  //
  // A one-way derivation: claims are the stored form, `Claim` and `Label` are
  // views over them. **Additive for now**, alongside the layer-declared labels
  // and regions rather than instead of them, so a file written either way loads
  // identically and every existing write path keeps working. The legacy reads
  // go when the write path cuts over; doing both at once would put the change
  // that can move the listing in the same commit as the change that cannot. Regions must land on the layer *supplying* their bytes,
  // because `getKindAt` asks the topmost such layer — that z-order is what
  // decides which reading of a shadowed address wins. Labels may land anywhere,
  // since `getLabels()` concatenates, so they go to the map rather than to a
  // layer that would only be arbitrary.
  // Stored form to domain form, and the one place it happens.
  //
  // A layer-framed claim holds an offset into its layer's bytes, so this adds
  // back where that layer landed *in this target* — which is what makes a claim
  // travel when a layer is relinked, by arithmetic rather than by promise.
  // A claim on a layer this target does not link resolves to nothing and is not
  // in this view at all, which is the same rule that makes annotations follow
  // linking, said once rather than in each consumer.
  const layerStart = new Map(layers.map((l) => [l.id, l.start] as const));
  //
  // **Retired claims are filtered here, and only here.** A claim somebody has
  // taken out of the working set must not render, must not compete for the name
  // at its address and must not be reported as a disagreement — and every one of
  // those reads through this list. Filtering once at the one place stored form
  // becomes domain form is what keeps it from being nine filters, eight of which
  // are right. `loaded.project` still carries the claim and its evidence, which
  // is where review reads them from.
  const retired = retiredClaimIds(project.evidence);
  const claims = projectClaims(project.claims).flatMap((claim) => {
    if (retired.has(claim.id)) return [];
    // **A target frame belongs to one target.** The loader asked this of layer
    // frames from the day they existed and never asked it of target frames, so a
    // claim saying "in the runtime arrangement, $02 is the border colour"
    // appeared in every other arrangement too — contaminating names, roots and
    // disagreements across phases of one program.
    //
    // A stored *name* is honoured as a legacy alias rather than dropped: files
    // written before frames carried ids stay loadable, and the next write
    // persists a real one. Same rule ids follow everywhere else here.
    if (claim.frame?.space === "target") {
      if (!chosen) return [];
      if (claim.frame.target !== chosen.id && claim.frame.target !== chosen.name) return [];
    }
    const at = resolveAt(claim.at, claim.frame, (id) => layerStart.get(id));
    return at === undefined ? [] : [at === claim.at ? claim : { ...claim, at }];
  });
  for (const claim of claims) {
    // One claim, two things it may say, and both are read here.
    //
    // A named span used to be two objects: a region, plus a label the region
    // generated at its start. Splitting them is what created the rank the
    // generated label needed — and dropping the generation without reading the
    // name here is what made `characterSetData` render as `dat_8E00`, which the
    // golden hash caught within a minute.
    if (claim.says) {
      const owner = map.layerAt(claim.at);
      // No layer supplies these bytes in this target, so there is nothing here
      // to interpret. The claim is not lost — it simply says nothing about a
      // view that does not load what it describes.
      if (owner) owner.regions.addRegion(claim);
    }
    if (claim.name === undefined) continue;
    const label = nameClaim(claim);
    userLabels.addLabel(label);
    map.claimLabels.push(label);
  }

  for (const [address, labelId] of Object.entries(project.primaryLabels ?? {})) {
    map.primaryLabels.set(parseProjectAddress(address), labelId);
  }

  // Onto the map, not onto an index it hands out: `getLabels()` builds a fresh
  // one each call, so a binding set on the result would be thrown away.
  for (const use of labelUses) map.labelUses.set(use.address, use.labelId);

  return {
    project,
    map,
    ...(chosen === undefined
      ? {}
      : { selectedTarget: { id: chosen.id ?? chosen.name, name: chosen.name } }),
    prgEntries,
    userLabels,
    comments,
    constants,
    types,
    layers,
    claims,
    romsMissing,
  };
}

/**
 * A field type written as text, as the model holds it.
 *
 * A name nothing declares falls back to opaque bytes of unknown width, which is
 * how a dangling reference stays loadable — the honest reading of "this field
 * is a Zone" when there is no Zone is "these bytes, and I cannot say how many".
 */
function resolveFieldType(
  text: string,
  declared: readonly ProjectType[],
  constants: readonly ProjectConstant[]
): FieldType {
  // **An id first, a name as a legacy alias.** The document stores ids now, so
  // this resolves one to itself; a name is honoured because files written before
  // that stay loadable and the next write persists an id — the same latitude
  // every other id here gets. A name that is not unique resolves to nothing
  // rather than to the first match, which is what an ambiguous reference
  // deserves and what the alias layer above refuses outright.
  const unique = <T extends { id?: string; name: string }>(
    held: readonly T[],
    named: string
  ): T | undefined => {
    const byId = held.find((x) => x.id === named);
    if (byId) return byId;
    const byName = held.filter((x) => x.name === named);
    return byName.length === 1 ? byName[0] : undefined;
  };

  const parsed = parseFieldType(
    text,
    (named) => unique(declared, named)?.id,
    (named) => {
      // The count a constant names, resolved on load rather than stored, so a
      // constant whose value changes changes the layout that named it. The
      // document holds `u8[cst_kj39fa]`; the number lives only here.
      const found = unique(constants, named);
      if (!found || found.id === undefined) return undefined;
      const value = typeof found.value === "number" ? found.value : parseProjectAddress(found.value);
      return value === undefined ? undefined : { id: found.id, value };
    }
  );
  return "error" in parsed ? { is: "bytes", length: 1 } : parsed;
}

/**
 * Where each machine ROM lands.
 *
 * Fixed, because these are the addresses the machine decodes them at — unlike a
 * layer's load address, which is a property of a link. A ROM is not linked
 * anywhere; it is where the hardware puts it.
 */
export const ROM_AT: Record<"basic" | "kernal" | "characters", number> = {
  basic: 0xa000,
  kernal: 0xe000,
  characters: 0xd000,
};

/** Bytes for a machine ROM, from wherever the host keeps them. */
export type RomLoader = (rom: "basic" | "kernal" | "characters") => Uint8Array | undefined;
