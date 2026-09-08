import { describe, it, expect } from "vitest";
import {
  RecordType,
  TypeIndex,
  fieldSize,
  formatFieldType,
  parseFieldType,
} from "./type.js";

/**
 * The layout under test is the one a reader actually established: 42 records of
 * 200 bytes in Revenge of the Mutant Camels, with a 40-character name at `+$A0`
 * in screen codes. Only a fraction of the fields are here — enough to exercise
 * holes, nesting and derived order.
 */
const CREATURE: RecordType = {
  id: "typ_creature",
  name: "Creature",
  size: 8,
  fields: {
    0: { name: "sprite", type: { is: "u8" } },
    1: { name: "speed", type: { is: "u8" } },
    2: { name: "behaviour", type: { is: "ptr" } },
  },
};

const ZONE: RecordType = {
  id: "typ_zone",
  name: "Zone",
  size: 200,
  fields: {
    0: { name: "first", type: { is: "record", typeId: "typ_creature" } },
    0xa0: { name: "name", type: { is: "char", length: 40, encoding: "screen" } },
  },
};

const index = () => {
  const idx = new TypeIndex();
  idx.addAll([ZONE, CREATURE]);
  return idx;
};

describe("what a field occupies", () => {
  it("knows its own width, and asks for a nested record's", () => {
    const sizeOf = index().sizeOf;
    expect(fieldSize({ is: "u8" }, sizeOf)).toBe(1);
    expect(fieldSize({ is: "u16be" }, sizeOf)).toBe(2);
    expect(fieldSize({ is: "char", length: 40 }, sizeOf)).toBe(40);
    expect(fieldSize({ is: "record", typeId: "typ_creature" }, sizeOf)).toBe(8);
  });

  it("says nothing rather than guessing when the type is not declared", () => {
    // A dangling reference renders the bytes, exactly as a dangling constant
    // renders the literal: deletion needs no sweep, and a delete racing a
    // reference heals itself.
    expect(fieldSize({ is: "record", typeId: "typ_gone" }, index().sizeOf)).toBeUndefined();
  });
});

describe("a layout", () => {
  it("comes out in memory order, derived from the offsets", () => {
    // Which is why fields need no ids and no order of their own: two of them
    // cannot share an offset, so the key is the identity.
    const laid = index().layout("typ_zone");
    expect(laid.map((f) => f.offset)).toEqual([0, 0xa0]);
    expect(laid.map((f) => f.field.name)).toEqual(["first", "name"]);
  });

  it("leaves a hole as a hole", () => {
    // $08 to $9F is unexplained and stays that way. Inventing a padding field
    // would cover a real gap in interpretation with a confident nothing.
    const laid = index().layout("typ_zone");
    const afterFirst = laid[0].offset + 8;
    expect(laid[1].offset).toBeGreaterThan(afterFirst);
  });

  it("is empty for a type nothing declared", () => {
    expect(index().layout("typ_gone")).toEqual([]);
  });
});

describe("the types a listing has to declare", () => {
  it("brings in what a type depends on, dependencies first", () => {
    // A TYPE block has to declare Creature before the Zone containing it, the
    // way an assembler source does.
    const used = index().used(["typ_zone"]);
    expect(used.map((t) => t.name)).toEqual(["Creature", "Zone"]);
  });

  it("leaves out a type nobody meant", () => {
    // Derived from what is referenced within the span, never stored — so a
    // declared but unbound type appears in no listing, and the `.re64` is where
    // it survives.
    expect(index().used(["typ_creature"]).map((t) => t.name)).toEqual(["Creature"]);
  });

  it("does not loop on a type that contains itself", () => {
    // A linked list: Revenge of the Mutant Camels holds its own assembler
    // source as one, and the reader identified it *because the links resolve*.
    const idx = new TypeIndex();
    idx.add({
      id: "typ_node",
      name: "Node",
      size: 4,
      fields: {
        0: { name: "next", type: { is: "ptr" } },
        2: { name: "self", type: { is: "record", typeId: "typ_node" } },
      },
    });
    expect(idx.used(["typ_node"]).map((t) => t.name)).toEqual(["Node"]);
  });
});

describe("a field type, as somebody types it", () => {
  const names: Record<string, string> = { Creature: "typ_creature" };
  const counts: Record<string, { id: string; value: number }> = {
    LevelCount: { id: "con_level", value: 32 },
    CreatureCount: { id: "con_creature", value: 8 },
  };
  const parse = (text: string) => parseFieldType(text, (n) => names[n], (n) => counts[n]);

  it("reads the scalars, including the byte order", () => {
    // Two types rather than one type and a flag: a flag is a second field every
    // reader has to remember to look at, which is how a region's comment
    // reached no consumer for the life of the feature.
    expect(parse("u8")).toEqual({ is: "u8" });
    expect(parse("u16")).toEqual({ is: "u16" });
    expect(parse("u16be")).toEqual({ is: "u16be" });
    expect(parse("ptr")).toEqual({ is: "ptr" });
  });

  it("reads a length, and an encoding where text needs one", () => {
    expect(parse("char(40)")).toEqual({ is: "char", length: 40 });
    expect(parse("char(40,screen)")).toEqual({ is: "char", length: 40, encoding: "screen" });
    expect(parse("bytes(8)")).toEqual({ is: "bytes", length: 8 });
  });

  it("takes an unrecognised name as another type", () => {
    expect(parse("Creature")).toEqual({ is: "record", typeId: "typ_creature" });
  });

  it("says what is wrong rather than guessing", () => {
    // Every one of these is a fact about the request, which is the only kind of
    // reason a write here may refuse for.
    expect(parse("char")).toMatchObject({ error: expect.stringContaining("needs a length") });
    expect(parse("char(40,klingon")).toMatchObject({ error: expect.any(String) });
    expect(parse("char(40,klingon)")).toMatchObject({
      error: expect.stringContaining("is not an encoding"),
    });
    expect(parse("bytes(8,screen)")).toMatchObject({
      error: expect.stringContaining("no encoding"),
    });
    expect(parse("Zone")).toMatchObject({ error: expect.stringContaining("list_types") });
  });

  it("reads an array of anything, including of another array", () => {
    // The shape both programs wanted and neither could say. Camels' zone record
    // is nineteen fields each eight wide; Gridrunner's level tables are three
    // `LevelParams[32]`.
    expect(parse("u8[8]")).toEqual({ is: "array", of: { is: "u8" }, count: 8 });
    expect(parse("Creature[42]")).toEqual({
      is: "array",
      of: { is: "record", typeId: "typ_creature" },
      count: 42,
    });
    expect(parse("char(40)[3]")).toEqual({
      is: "array",
      of: { is: "char", length: 40 },
      count: 3,
    });
    // Outer dimension first, as C reads it: four of eight, not eight of four.
    expect(parse("u8[4][8]")).toEqual({
      is: "array",
      count: 4,
      of: { is: "array", of: { is: "u8" }, count: 8 },
    });
  });

  it("takes an index origin, because nine of Gridrunner's tables are 1-based", () => {
    // `=*-$01`: element one sits at offset zero, and a reader who forgets is
    // off by one for the whole table. Not decoration.
    expect(parse("u8[1..32]")).toEqual({ is: "array", of: { is: "u8" }, count: 32, origin: 1 });
    // Zero origin is the default, and is not written down twice.
    expect(parse("u8[0..7]")).toEqual({ is: "array", of: { is: "u8" }, count: 8 });
    expect(parse("u8[8..1]")).toMatchObject({ error: expect.stringContaining("backwards") });
    expect(parse("u8[0]")).toMatchObject({ error: expect.stringContaining("at least one") });
    expect(parse("[8]")).toMatchObject({ error: expect.stringContaining("element type") });
    expect(parse("Zone[8]")).toMatchObject({ error: expect.stringContaining("list_types") });
  });

  it("takes a count from a constant, so the same number is named once", () => {
    // Gridrunner holds the same 32 in four places within a dozen instructions —
    // a `CMP #$20` and three tables. Naming it says they are the same 32
    // instead of leaving four numbers that happen to agree.
    expect(parse("u8[LevelCount]")).toEqual({
      is: "array",
      of: { is: "u8" },
      count: 32,
      countId: "con_level",
    });
    // And two arrays written `[CreatureCount]` say their eights are the *same*
    // eight, which is the whole content of a shared index without a new noun.
    expect(parse("u8[CreatureCount]")).toMatchObject({ count: 8, countId: "con_creature" });
    // `[1..LevelCount]` is 32 elements numbered 1 to 32, which is the sentence
    // somebody means. The upper bound is what the constant names.
    expect(parse("u8[1..LevelCount]")).toEqual({
      is: "array",
      of: { is: "u8" },
      count: 32,
      origin: 1,
      countId: "con_level",
    });
    expect(parse("u8[Nonesuch]")).toMatchObject({
      error: expect.stringContaining("is not a constant this project declares"),
    });
  });

  it("writes back what it read", () => {
    const nameOf = (id: string) => (id === "typ_creature" ? "Creature" : undefined);
    const countOf = (id: string) =>
      ({ con_level: "LevelCount", con_creature: "CreatureCount" })[id];
    for (const text of ["u8[LevelCount]", "u8[1..LevelCount]", "Creature[CreatureCount][4]"]) {
      expect(formatFieldType(parse(text) as never, nameOf, countOf)).toBe(text);
    }
    // A constant that has gone falls back to the number, which is honest: the
    // count is still what it was when it was read.
    expect(formatFieldType(parse("u8[LevelCount]") as never, nameOf)).toBe("u8[32]");
    for (const text of [
      "u8",
      "i8",
      "u16be",
      "ptr",
      "char(40)",
      "char(40,screen)",
      "bytes(8)",
      "u8[8]",
      "u8[1..32]",
      "char(40)[3]",
      "u8[4][8]",
      "Creature[42]",
    ]) {
      expect(formatFieldType(parse(text) as never, nameOf)).toBe(text);
    }
    expect(formatFieldType({ is: "record", typeId: "typ_creature" }, nameOf)).toBe("Creature");
  });

  it("keeps the id of a type that has gone rather than inventing a name", () => {
    expect(formatFieldType({ is: "record", typeId: "typ_gone" }, () => undefined)).toBe("typ_gone");
  });
});
