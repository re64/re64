import { describe, it, expect } from "vitest";
import { VERSION } from "./index.js";

describe("core", () => {
  it("exports a version string", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
