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
  ProjectType,
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

export function withDefaultTarget(project: Project): Project {
  if (project.targets?.length) {
    // A project may declare which view to open with — that is a fact about the
    // project, and the reason it survives an export: somebody handed this file
    // should see what it is *for*. It is emphatically not a cursor. Nothing
    // writes it while reading, no tool sets it as a side effect of looking, and
    // it moves no version.
    if (project.defaultTarget !== undefined) return project;
    const first = [...project.targets].sort(
      (a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
    )[0];
    return { ...project, defaultTarget: first.name };
  }

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
        // point the moment a default target existed.
        ...(project.entryPoints === undefined ? {} : { entryPoints: project.entryPoints }),
      },
    ],
    defaultTarget: name,
  };
}

export function projectForTarget(project: Project): Project {
  const target = project.targets?.find((t) => t.name === project.defaultTarget);
  // Unreachable through `buildMemoryMap`, which derives one first. Kept as a
  // guard rather than an assertion because this is exported and a caller may
  // hand it anything.
  if (!target) return project;

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
  // A view nothing declares is refused rather than answered for. Falling back
  // to the default would hand a caller a different stack than the one it named,
  // with no way to tell — the confident wrong answer this project refuses.
  if (
    options.target !== undefined &&
    !(migrated.targets ?? []).some((t) => t.name === options.target)
  ) {
    throw new Error(
      `No target called "${options.target}" in this project. ` +
        `list_targets shows what there is.`
    );
  }
  const project = projectForTarget(
    withDefaultTarget(
      options.target === undefined ? migrated : { ...migrated, defaultTarget: options.target }
    )
  );

  const map = new MemoryMap();
  const prgEntries: number[] = [];
  const userLabels = new NameIndex();
  const comments = new CommentIndex();
  const constants = new ConstantIndex();
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
  const claims = projectClaims(project.claims).flatMap((claim) => {
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
  const parsed = parseFieldType(
    text,
    (name) => declared.find((t) => t.name === name)?.id,
    (name) => {
      // The count a constant names, resolved on load rather than stored, so a
      // constant whose value changes changes the layout that named it. The
      // document holds `u8[LevelCount]`; the number lives only here.
      const found = constants.find((c) => c.name === name);
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
