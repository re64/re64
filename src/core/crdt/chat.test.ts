import { describe, it, expect } from "vitest";
import { chatLength, chatMessages, onChatChange, postChatMessage } from "./chat.js";
import { docFromProject, encodeDoc, applyUpdate, emptyDoc, projectFromDoc } from "./doc.js";
import { parseProject } from "../project/project.js";

const project = () =>
  parseProject(
    JSON.stringify({
      name: "subject",
      layers: [{ type: "bytes", address: "$8000", bytes: "A9 01 60" }],
    })
  );

const said = (author: string, text: string) => ({ author, name: author, text });

describe("saying something", () => {
  it("keeps what was said, oldest first", () => {
    const doc = docFromProject(project());
    postChatMessage(doc, said("marcus", "the header at $8000 is CBM80"));
    postChatMessage(doc, said("agate", "then $83C1 is the real entry"));

    expect(chatMessages(doc).map((m) => m.text)).toEqual([
      "the header at $8000 is CBM80",
      "then $83C1 is the real entry",
    ]);
  });

  it("records the name as it was at the time", () => {
    // A chat log says who spoke *then*. Resolving the name on read would rewrite
    // history every time somebody was renamed.
    const doc = docFromProject(project());
    postChatMessage(doc, { author: "usr_you", name: "marcus", text: "hello" });
    expect(chatMessages(doc)[0]).toMatchObject({ author: "usr_you", name: "marcus" });
  });

  it("refuses a message with nothing in it", () => {
    const doc = docFromProject(project());
    expect(postChatMessage(doc, said("marcus", "   "))).toBeUndefined();
    expect(chatLength(doc)).toBe(0);
  });

  it("notifies both ends", () => {
    const doc = docFromProject(project());
    let heard = 0;
    const stop = onChatChange(doc, () => heard++);
    postChatMessage(doc, said("marcus", "one"));
    expect(heard).toBe(1);
    stop();
    postChatMessage(doc, said("marcus", "two"));
    expect(heard).toBe(1);
  });

  it("reaches another peer", () => {
    const here = docFromProject(project());
    const there = emptyDoc();
    applyUpdate(there, encodeDoc(here));

    postChatMessage(here, said("marcus", "are you seeing this"));
    applyUpdate(there, encodeDoc(here));

    expect(chatMessages(there).map((m) => m.text)).toEqual(["are you seeing this"]);
  });
});

describe("what the project cannot see", () => {
  /**
   * The load-bearing property, and it holds by *omission* — `projectFromDoc`
   * whitelists four roots and simply never looks at chat. Nothing was added to
   * exclude it, which is exactly why it needs a test: a later edit that made the
   * projection exhaustive would take it away silently, and the first symptom
   * would be chat appearing in somebody's exported `.re64`.
   */
  it("does not reach the project", () => {
    const doc = docFromProject(project());
    const before = projectFromDoc(doc);

    postChatMessage(doc, said("marcus", "this must not be in the file"));

    expect(projectFromDoc(doc)).toEqual(before);
    expect(JSON.stringify(projectFromDoc(doc))).not.toContain("must not be in the file");
  });

  it("leaves the projection identical, which is what the version hash is taken over", () => {
    // ProjectStore.version() hashes JSON.stringify(projectFromDoc(...)), so an
    // unchanged projection means an unchanged version — and therefore no stale
    // analysis cache and no 409 for a caller holding the old one.
    const doc = docFromProject(project());
    const before = JSON.stringify(projectFromDoc(doc));
    for (let i = 0; i < 5; i++) postChatMessage(doc, said("agate", `message ${i}`));
    expect(JSON.stringify(projectFromDoc(doc))).toBe(before);
  });
});
