import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Op } from "../../core/ops/types.js";
import { registerTools } from "./tools.js";

// Exhaustive over patch fields, checked against their actual operation types.
// An exception needs a reason: request parameters and convenience arguments
// are not a one-to-one projection of the document vocabulary.
type SetOp = Extract<Op, { fields: unknown }>;
type Inventory = {
  [O in SetOp as O["op"]]?: {
    [K in keyof O["fields"]]-?: (null extends O["fields"][K] ? true : false) | string
  }
};
const patches = {
  "message.set": { text: false },
  "decoder.set": { name: false, source: false },
  // unit is optional in the entity but not nullable in type.set: "bytes"
  // selects the default interpretation of offsets explicitly.
  "type.set": { name: false, size: false, unit: false },
  "field.set": { name: false, type: false, description: true, offset: false },
  "claim.set": {
    at: "address is an absolute move, required on the entity; cannot clear",
    frame: "derived by placing the absolute address",
    origin: "assigned by the writer, not editable through MCP",
    description: "platform description, not authored through edit_claim",
    says: "is/encoding/view/typeId edit or replace the interpretation",
    name: true, extent: true, root: true,
  },
  "constant.set": { name: false, value: false },
  "target.set": { name: false, layers: false, entryPoints: true, order: true, description: true },
  "evidence.set": {
    kind: false, by: "method edits provenance while preserving author and time",
    scenario: true, capture: true, other: true, note: true,
  },
  "scenario.set": { name: false, description: true, steps: false },
  // placement is optional in the entity but not nullable in comment.set:
  // "before" restores the default (stored as absence by both adapters).
  "comment.set": { address: "comment movement is not exposed", text: false, placement: false, order: true },
} satisfies Inventory;

// These are convenience arguments rather than patch fields. Required record
// typeId cannot be removed; withdraw the interpretation with is:null instead.
const conveniences: Record<string, Record<string, boolean>> = {
  edit_claim: { address: false, is: true, encoding: true, view: true, typeId: false, method: true },
  edit_evidence: { method: true },
};

describe("every registered edit tool's clear contract", () => {
  it("covers every edit tool and field, and accepts null exactly where clearing is supported", () => {
    const registered: { name: string; inputSchema: z.ZodObject; description: string }[] = [];
    registerTools({
      registerTool(name: string, config: { inputSchema: z.ZodObject; description: string }) {
        if (name.startsWith("edit_")) registered.push({ name, ...config });
      },
    }, () => { throw new Error("registration must not need a workspace"); });
    expect(registered.map(t => t.name).sort()).toEqual(
      Object.keys(patches).map(op => `edit_${op.split(".")[0]}`).sort(),
    );
    for (const tool of registered) {
      const op = `${tool.name.slice(5)}.set` as keyof typeof patches;
      const expected: Record<string, boolean> = { ...conveniences[tool.name] };
      for (const [field, clearable] of Object.entries(patches[op])) {
        if (typeof clearable === "boolean") expected[field] = clearable;
      }
      const fields = Object.entries(tool.inputSchema.shape).filter(([key]) =>
        !["project", "target", "id", ...(tool.name === "edit_field" ? ["typeId"] : [])].includes(key));
      expect(fields.map(([key]) => key).sort(), tool.name).toEqual(Object.keys(expected).sort());
      for (const [key, schema] of fields) {
        const field = schema as z.ZodType;
        expect(field.safeParse(null).success, `${tool.name}.${key}`).toBe(expected[key]);
        if (expected[key]) {
          expect(field.safeParse(undefined).success, `${tool.name}.${key} omission`).toBe(true);
          expect(`${field.description ?? ""} ${tool.description}`, `${tool.name}.${key} docs`).toMatch(/null.*clear/is);
        }
      }
    }
  });
});
