import { TEXT_ENCODINGS, TextEncoding } from "../c64/text.js";

/**
 * A record layout: what the bytes of one array element mean.
 *
 * The thing the model could not hold. `zoneDataTable` in Revenge of the Mutant
 * Camels is 8,400 bytes that a reader established as **42 records of exactly
 * 200**, nineteen named fields per creature type, proved three ways from the
 * copy routine at `sub_9772`. Exactly one of those fields could be expressed —
 * the name at `+$A0`, as 42 `text` claims — and the other 80% became one `data`
 * blob with the finding living in prose. That is not incomplete analysis. It is
 * finished analysis, discarded for want of a shape.
 *
 * Project-level, beside `constants` and `decoders`, and for the same reason
 * written down there: a *layout* describes no bytes of its own, so there is no
 * layer for it to move with when the stack is reordered. A claim references it;
 * the claim is what belongs to a layer.
 */
export interface RecordType {
  readonly id: string;
  /** What to call it, in a listing's TYPE block and in a menu. */
  readonly name: string;
  /**
   * Bytes per record.
   *
   * Declared rather than derived from the fields, because **holes are legal**.
   * A reader who has proved nineteen fields of a 200-byte record should be able
   * to say so without inventing padding for the rest — the gaps are real gaps
   * in interpretation, and covering them with a filler field would be the
   * `zoneDataTable` cop-out one level down.
   *
   * How many records a claim holds is *derived*: `extent / size`. Storing the
   * count would be a third fact that can disagree with the other two.
   */
  readonly size: number;
  /**
   * Fields by offset.
   *
   * **Keyed by offset, and carrying no ids.** The identity rule this project
   * states first — an address cannot identify a label, because several share
   * one — does not transfer: two fields cannot share an offset, and there are
   * no unions. So the key *is* the identity, two people adding different fields
   * touch different keys, and that is the whole merge property ids were for.
   *
   * A `Y.Map` is unordered and need not be: order derives from offset.
   */
  readonly fields: Readonly<Record<number, Field>>;
}

/**
 * One field of a record.
 *
 * Deliberately small. Every atomic type here was met in a real binary, and the
 * escape hatch for anything else is the one this project already built: a
 * decoder, which is assembler logic expressed as code because that is the only
 * honest way to express assembler logic.
 */
export interface Field {
  readonly name: string;
  readonly type: FieldType;
  /** What it means, where the name does not say. */
  readonly description?: string;
}

/**
 * What a field holds.
 *
 * **Endianness is in the type rather than beside it.** A 6502 is little-endian
 * and a hand-written table need not be — a two-byte value stored high-first is
 * ordinary in a jump table built for `RTS` dispatch — so `u16` and `u16be` are
 * two types rather than one type and a flag. A flag would be a second field
 * that every reader has to remember to look at, which is how `region.comment`
 * reached no consumer for the life of the feature.
 *
 * `char` carries its encoding for the same reason a `text` claim does: neither
 * C64 encoding is ASCII, so reading one as the other produces confident
 * nonsense.
 */
export type FieldType =
  | { readonly is: "u8" }
  | { readonly is: "i8" }
  | { readonly is: "u16" }
  | { readonly is: "u16be" }
  /**
   * An address, which renders as a name rather than a number.
   *
   * Distinct from `u16` because a pointer *resolves*: the reference disassembly
   * of Revenge of the Mutant Camels identified its own linked list of assembler
   * fragments precisely because the links resolve, which is an invariant a
   * model that cannot express the structure cannot express the proof of.
   */
  | { readonly is: "ptr" }
  | { readonly is: "ptrbe" }
  /** Fixed-length text. The length is part of the layout, not of the data. */
  | { readonly is: "char"; readonly length: number; readonly encoding?: TextEncoding }
  /** Bytes this reader has not explained. Never inferred — only declared. */
  | { readonly is: "bytes"; readonly length: number }
  /** A nested record, so `Creature` can sit inside `Zone`. */
  | { readonly is: "record"; readonly typeId: string }
  /**
   * Several of something, laid end to end.
   *
   * **The shape both programs wanted and neither could say.** Camels' zone
   * record is nineteen fields each eight wide — one slot per creature type — so
   * without this it is nineteen separate `bytes(8)` fields whose relationship to
   * each other lives in prose. Gridrunner's three 32-entry level tables are one
   * `LevelParams[32]` each. Two programs, four shapes in common, which is the
   * standard `docs/decisions/claims.md` asks for before a shape is added.
   *
   * A modifier rather than a kind: `u8[8]`, `Creature[42]`, `char(40)[3]`, and
   * `u8[4][8]` nests the way C reads it — four of eight, outer dimension first.
   *
   * `origin` is the index the first element answers to, and it is not
   * decoration: nine of Gridrunner's tables are declared `=*-$01`, so element
   * one is at offset zero and every reader who forgets is off by one for the
   * whole table.
   */
  | {
      readonly is: "array";
      readonly of: FieldType;
      readonly count: number;
      readonly origin?: number;
      /**
       * The constant the count was written as, when it was written as one.
       *
       * `u8[LevelCount]` rather than `u8[32]`, which is the equate an assembler
       * source would write and the reason it is worth having: Gridrunner holds
       * the same 32 in four places within a dozen instructions — a `CMP #$20`
       * and three tables — and naming it once says they are the same 32 instead
       * of leaving four numbers that happen to agree.
       *
       * Two arrays written `[CreatureCount]` also say their counts are the
       * *same* count, which is the whole content of what a shared index would
       * have been, using the noun that already exists. Camels' zone record has
       * roughly nineteen eight-wide fields and every one of those eights is the
       * same eight.
       *
       * The id, so a renamed constant carries the reference with it. The
       * document holds the text, so this is resolved on load and never at rest.
       */
      readonly countId?: string;
    };

/** Bytes a field occupies, or undefined when it names a type nothing declares. */
export function fieldSize(
  type: FieldType,
  sizeOf: (typeId: string) => number | undefined
): number | undefined {
  switch (type.is) {
    case "u8":
    case "i8":
      return 1;
    case "u16":
    case "u16be":
    case "ptr":
    case "ptrbe":
      return 2;
    case "char":
    case "bytes":
      return type.length;
    case "record":
      return sizeOf(type.typeId);
    case "array": {
      const each = fieldSize(type.of, sizeOf);
      return each === undefined ? undefined : each * type.count;
    }
    default: {
      const unhandled: never = type;
      throw new Error(`unhandled field type: ${String(unhandled)}`);
    }
  }
}

/**
 * The record layouts a project declares.
 *
 * `used(within?)` mirrors `ConstantIndex.used`: a listing's TYPE block is
 * derived from what is actually meant inside the span being shown, never
 * stored, so it stays in step with the claims by construction. The consequence,
 * said out loud: a declared but unreferenced type appears in no listing.
 * Nothing is lost, because the `.re64` holds declarations explicitly and is the
 * export that round-trips; a listing is a listing.
 */
export class TypeIndex {
  private readonly byId = new Map<string, RecordType>();

  add(type: RecordType): void {
    this.byId.set(type.id, type);
  }

  addAll(types: readonly RecordType[]): void {
    for (const type of types) this.add(type);
  }

  get(id: string): RecordType | undefined {
    return this.byId.get(id);
  }

  all(): readonly RecordType[] {
    return [...this.byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get size(): number {
    return this.byId.size;
  }

  /** Bytes one record of this type occupies, for nesting. */
  sizeOf = (id: string): number | undefined => this.byId.get(id)?.size;

  /**
   * Fields in the order they appear in memory, with their offsets.
   *
   * Derived from the keys, which is why the fields need no ids and no order of
   * their own. A hole between two fields is left as a hole: it is a real gap in
   * interpretation, and the whole point of allowing one.
   */
  layout(id: string): { offset: number; field: Field }[] {
    const type = this.byId.get(id);
    if (!type) return [];
    return Object.entries(type.fields)
      .map(([offset, field]) => ({ offset: Number(offset), field }))
      .sort((a, b) => a.offset - b.offset);
  }

  /**
   * The types actually meant, with the ones they depend on, dependencies first.
   *
   * So a listing's TYPE block can declare `Creature` before the `Zone` that
   * contains it, the way an assembler source has to.
   */
  used(referenced: Iterable<string>): readonly RecordType[] {
    const out: RecordType[] = [];
    const seen = new Set<string>();

    const visit = (id: string): void => {
      if (seen.has(id)) return;
      seen.add(id);
      const type = this.byId.get(id);
      if (!type) return;
      for (const field of Object.values(type.fields)) {
        // Through arrays as well as directly: `Creature[8]` depends on
        // `Creature` exactly as a bare `Creature` field does, and a TYPE block
        // that declared one and not the other would not assemble.
        for (let inner = field.type; ; ) {
          if (inner.is === "array") {
            inner = inner.of;
            continue;
          }
          if (inner.is === "record") visit(inner.typeId);
          break;
        }
      }
      out.push(type);
    };

    for (const id of referenced) visit(id);
    return out;
  }
}

/**
 * A field type, written the way somebody types it.
 *
 * `u8`, `i8`, `u16`, `u16be`, `ptr`, `ptrbe`, `char(40)`, `char(40,screen)`,
 * `bytes(8)`, or the name of another type.
 *
 * One string rather than a discriminated object, for the reason `view` on a
 * claim is one string: a format and its parameters are one choice, and
 * splitting them would thread three fields through the schema, the serializer,
 * the CRDT assignment, the op, the diff, the inverse and four signatures.
 *
 * A name it does not recognise is taken as a **reference to another type**,
 * resolved by the caller. Unresolvable is not an error here: a dangling type
 * renders its bytes, exactly as a dangling constant renders the literal, so a
 * delete racing a reference heals itself rather than needing a sweep.
 */
export function parseFieldType(
  text: string,
  idForName: (name: string) => string | undefined,
  countForName: (name: string) => { id: string; value: number } | undefined
): FieldType | { readonly error: string } {
  let trimmed = text.trim();

  // Dimensions come off the right and go back on inside-out, which is what
  // makes `u8[4][8]` read as C reads it: four of eight, outer dimension first.
  const dimensions: { count: number; origin: number; countId?: string }[] = [];
  for (;;) {
    const found = /\[\s*([A-Za-z_][A-Za-z0-9_]*|-?\d+)\s*(?:\.\.\s*([A-Za-z_][A-Za-z0-9_]*|-?\d+)\s*)?\]$/.exec(
      trimmed
    );
    if (!found) break;
    const [whole, first, last] = found;

    // A bound may be a declared constant, which is how `[LevelCount]` and
    // `[1..LevelCount]` are written. Resolved here and never stored: the
    // document holds the text, so renaming the constant rewrites the field type
    // on the next save rather than leaving two facts to disagree.
    const bound = (word: string): { value: number; id?: string } | { error: string } => {
      if (/^-?\d+$/.test(word)) return { value: Number(word) };
      const named = countForName(word);
      return named === undefined
        ? {
            error:
              `"${word}" is not a number and is not a constant this project declares. ` +
              `add_constant names one; list_constants shows what there is.`,
          }
        : { value: named.value, id: named.id };
    };

    const low = bound(first);
    if ("error" in low) return low;
    const high = last === undefined ? undefined : bound(last);
    if (high !== undefined && "error" in high) return high;

    if (high === undefined) {
      if (low.value < 1) return { error: `${trimmed}: an array needs at least one element` };
      dimensions.unshift({
        count: low.value,
        origin: 0,
        ...(low.id === undefined ? {} : { countId: low.id }),
      });
    } else {
      if (high.value < low.value) {
        return { error: `${trimmed}: ${first}..${last} runs backwards` };
      }
      dimensions.unshift({
        count: high.value - low.value + 1,
        origin: low.value,
        // The *upper* bound is what a count constant names here: `[1..Levels]`
        // with Levels = 32 is 32 elements, which is the sentence somebody
        // means. It only reads that way while the origin is 1, and neither
        // program has a table where it is not.
        ...(high.id === undefined ? {} : { countId: high.id }),
      });
    }
    trimmed = trimmed.slice(0, found.index).trim();
    if (trimmed.length === 0) return { error: `${whole} needs an element type before it` };
  }

  const element =
    dimensions.length === 0 ? undefined : parseFieldType(trimmed, idForName, countForName);
  if (element !== undefined) {
    if ("error" in element) return element;
    let built = element;
    for (let i = dimensions.length - 1; i >= 0; i--) {
      const { count, origin, countId } = dimensions[i];
      built = {
        is: "array",
        of: built,
        count,
        ...(origin === 0 ? {} : { origin }),
        ...(countId === undefined ? {} : { countId }),
      };
    }
    return built;
  }

  const scalar: Record<string, FieldType> = {
    u8: { is: "u8" },
    i8: { is: "i8" },
    u16: { is: "u16" },
    u16be: { is: "u16be" },
    ptr: { is: "ptr" },
    ptrbe: { is: "ptrbe" },
  };
  if (trimmed in scalar) return scalar[trimmed];

  const call = /^(char|bytes)\(\s*(\d+)\s*(?:,\s*([a-z]+)\s*)?\)$/.exec(trimmed);
  if (call) {
    const [, kind, count, encoding] = call;
    const length = Number(count);
    if (length < 1) return { error: `${trimmed}: a length must be at least 1` };
    if (kind === "bytes") {
      if (encoding) return { error: `bytes takes no encoding: ${trimmed}` };
      return { is: "bytes", length };
    }
    if (encoding !== undefined && !TEXT_ENCODINGS.includes(encoding as TextEncoding)) {
      return { error: `${encoding} is not an encoding. One of: ${TEXT_ENCODINGS.join(", ")}` };
    }
    return {
      is: "char",
      length,
      ...(encoding ? { encoding: encoding as TextEncoding } : {}),
    };
  }

  if (/^(char|bytes)\b/.test(trimmed)) {
    return { error: `${trimmed} needs a length, as ${trimmed.split("(")[0]}(n)` };
  }

  const typeId = idForName(trimmed);
  if (typeId) return { is: "record", typeId };
  return {
    error:
      `"${trimmed}" is not a field type and is not a type this project declares. ` +
      `Use u8, i8, u16, u16be, ptr, ptrbe, char(n), char(n,screen), bytes(n), ` +
      `or the name of a type from list_types. Any of those takes [n] for an ` +
      `array of them, or [first..last] where the first index is not zero.`,
  };
}

/** A field type, written back out the way it was typed. */
export function formatFieldType(
  type: FieldType,
  nameOf: (typeId: string) => string | undefined,
  countName: (constantId: string) => string | undefined = () => undefined
): string {
  switch (type.is) {
    case "char":
      return type.encoding ? `char(${type.length},${type.encoding})` : `char(${type.length})`;
    case "bytes":
      return `bytes(${type.length})`;
    case "record":
      // The name, so a `.re64` reads as somebody wrote it. A reference to a type
      // that has gone keeps the id, which is honest — it says what it pointed
      // at rather than inventing a name for something that is not there.
      return nameOf(type.typeId) ?? type.typeId;
    case "array": {
      // All the dimensions at once, outermost first, so `u8[4][8]` writes back
      // as it was read. Recursing one level per dimension would emit them
      // inside-out — which is what it did until the round trip said so.
      const bounds: string[] = [];
      let element: FieldType = type;
      while (element.is === "array") {
        const origin = element.origin ?? 0;
        // The constant's *current* name, so renaming it rewrites the field type
        // rather than leaving a reference to a word nothing answers to. A
        // constant that has gone falls back to the number, which is honest: the
        // count is still what it was.
        const upper = element.countId === undefined ? undefined : countName(element.countId);
        const last = upper ?? `${origin + element.count - 1}`;
        bounds.push(
          origin === 0 ? (upper ?? `${element.count}`) : `${origin}..${last}`
        );
        element = element.of;
      }
      return `${formatFieldType(element, nameOf, countName)}${bounds.map((b) => `[${b}]`).join("")}`;
    }
    default:
      return type.is;
  }
}

/**
 * Where an offset lands, written the way somebody would say it.
 *
 * `zones[2].name`, `zones[0].creatures[3].speed` — the notation a reader
 * already uses in a comment, made derivable so it can be *the* answer rather
 * than something restated by hand at every site.
 *
 * The point is not the listing, where a 6502's addressing modes often cannot
 * express it anyway. It is everywhere else: an effect summary that says
 * `reads: zones[].nextType` instead of "memory at a computed address", a
 * comment, the note on a claim's method. The transformation graph of Camels'
 * creature types is *derivable* from typed fields, and was prose because there
 * was no way to name the two ends.
 *
 * `within` is how far into the innermost scalar the offset sits, which is not a
 * detail: an offset landing on the second byte of a `ptr` is somebody reading
 * the high half, and a path that quietly rounded it down would say otherwise.
 * `undefined` where the offset falls in a hole — those are real, and a made-up
 * field name for one would be exactly the confident wrong answer.
 */
export function pathAt(
  type: RecordType,
  offset: number,
  index: TypeIndex
): { path: string; within: number } | undefined {
  for (const { offset: at, field } of index.layout(type.id)) {
    const width = fieldSize(field.type, index.sizeOf);
    if (width === undefined || offset < at || offset >= at + width) continue;
    const inner = within(field.type, offset - at, index);
    return inner === undefined ? undefined : { path: `.${field.name}${inner.path}`, within: inner.within };
  }
  return undefined;
}

function within(
  type: FieldType,
  offset: number,
  index: TypeIndex
): { path: string; within: number } | undefined {
  if (type.is === "array") {
    const each = fieldSize(type.of, index.sizeOf);
    if (each === undefined || each === 0) return undefined;
    const at = Math.floor(offset / each);
    const inner = within(type.of, offset % each, index);
    if (inner === undefined) return undefined;
    return { path: `[${at + (type.origin ?? 0)}]${inner.path}`, within: inner.within };
  }
  if (type.is === "record") {
    const nested = index.get(type.typeId);
    if (!nested) return undefined;
    const inner = pathAt(nested, offset, index);
    return inner === undefined ? undefined : { path: inner.path, within: inner.within };
  }
  return { path: "", within: offset };
}
