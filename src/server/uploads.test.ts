import { describe, it, expect } from "vitest";
import { UploadTokens } from "./uploads.js";

describe("upload tokens", () => {
  it("carries the project, name and caller, so the bytes cannot arrive unowned", () => {
    const tokens = new UploadTokens();
    const issued = tokens.issue("camels", "revenge.d64", "builder");
    const claimed = tokens.claim(issued.token);
    expect(claimed).toMatchObject({
      projectId: "camels",
      name: "revenge.d64",
      author: "builder",
    });
  });

  it("is good once", () => {
    // Consumed before the bytes are stored, so an abandoned upload cannot be
    // retried against the same token — preparing another costs nothing and
    // leaves a clearer record.
    const tokens = new UploadTokens();
    const issued = tokens.issue("p", "f", "me");
    expect(tokens.claim(issued.token)).toBeDefined();
    expect(tokens.claim(issued.token)).toBeUndefined();
  });

  it("expires, so an unused one is not a credential lying around", () => {
    let now = 1000;
    const tokens = new UploadTokens({ ttlMs: 100, now: () => now });
    const issued = tokens.issue("p", "f", "me");
    now = 1101;
    expect(tokens.claim(issued.token)).toBeUndefined();
    expect(tokens.size).toBe(0);
  });
});
