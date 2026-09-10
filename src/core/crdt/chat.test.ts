import { describe, it, expect } from "vitest";
import { chatLength, chatMessages, onChatChange, postChatMessage } from "./chat.js";
import {
  docFromProject,
  encodeDoc,
  applyUpdate,
  emptyDoc,
  projectFromDoc,
  programFromDoc,
} from "./doc.js";
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

describe("a message is a document change and not a program change", () => {
  /**
   * **This assertion used to say the opposite, and the reversal is the point.**
   *
   * Chat began as a fifth root the projection could not see, so a message
   * reached no `.re64`, no version and no operation log — and that held "by
   * omission", which is why it had a test at all.
   *
   * It comes into the projection because a message became an entity with three
   * verbs. The changes feed is built from the operation log and the socket path
   * derives operations by diffing projections, so a root outside the projection
   * can reach neither, and a session could not be told discussion was waiting
   * for it. A project handed to somebody would also arrive with its conclusions
   * and without the argument that produced them.
   *
   * What the old design was protecting is kept, and split off explicitly: chat
   * moves no version and triggers no re-analysis, because "what does this
   * project hold" and "has the program changed" turned out to be two questions
   * with one answer only while chat was invisible.
   */
  it("reaches the project, and therefore the exported file", () => {
    const doc = docFromProject(project());
    postChatMessage(doc, said("marcus", "this belongs in the file"));

    const held = projectFromDoc(doc).messages ?? [];
    expect(held.map((m) => m.text)).toEqual(["this belongs in the file"]);
    expect(held[0].id, "a message is addressable like everything else").toBeTruthy();
    expect(held[0].author).toBe("marcus");
  });

  it("moves no version, so it re-analyses nothing and stales no cache", () => {
    // `ProjectStore.version()` hashes `programFromDoc`, which is the projection
    // without the conversation. An unchanged program means an unchanged version
    // — and therefore no re-derivation and no rebuild per line of chat, which is
    // the cost the fifth-root design was avoiding and is worth keeping without
    // it.
    const doc = docFromProject(project());
    const before = JSON.stringify(programFromDoc(doc));
    for (let i = 0; i < 5; i++) postChatMessage(doc, said("agate", `message ${i}`));

    expect(JSON.stringify(programFromDoc(doc))).toBe(before);
    // And the full projection did move, which is what makes it exportable and
    // what lets the changes feed see it.
    expect(projectFromDoc(doc).messages).toHaveLength(5);
  });

  it("keeps the order it was said in", () => {
    // A list, not a map. Ordering is the content of a conversation, and the
    // array CRDT converges it without anyone agreeing a clock — the opposite of
    // a field or a binding, where position was masquerading as identity.
    const doc = docFromProject(project());
    for (const text of ["first", "second", "third"]) postChatMessage(doc, said("agate", text));
    expect((projectFromDoc(doc).messages ?? []).map((m) => m.text)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });
});
