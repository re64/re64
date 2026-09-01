import { describe, it, expect } from "vitest";
import {
  joinProject,
  leaveProject,
  onParticipantsChange,
  participants,
} from "./participants.js";
import { docFromProject, encodeDoc, applyUpdate, emptyDoc, projectFromDoc } from "./doc.js";
import { parseProject } from "../project/project.js";

const project = () =>
  parseProject(
    JSON.stringify({
      name: "subject",
      layers: [{ type: "bytes", address: "$8000", bytes: "A9 01 60" }],
    })
  );

const lead = { session: "ses_1", user: "lead", name: "lead", kind: "agent" as const };
const gfx = { session: "ses_2", user: "gfx", name: "gfx", kind: "agent" as const };

describe("who is in a project", () => {
  it("lists everyone who has joined", () => {
    const doc = docFromProject(project());
    joinProject(doc, lead, 1000);
    joinProject(doc, gfx, 2000);

    expect(participants(doc).map((p) => p.session).sort()).toEqual(["ses_1", "ses_2"]);
    expect(participants(doc).every((p) => p.online)).toBe(true);
  });

  it("marks a departure rather than deleting it", () => {
    // The point of the design: arriving and leaving are the same kind of event
    // to anyone rendering the list, and the record of who has been here outlives
    // them going away.
    const doc = docFromProject(project());
    joinProject(doc, lead, 1000);
    leaveProject(doc, "ses_1", 5000);

    const [only] = participants(doc);
    expect(only.session).toBe("ses_1");
    expect(only.online).toBe(false);
    expect(only.joinedAt).toBe(1000);
    expect(only.lastSeen).toBe(5000);
  });

  it("brings somebody back online without losing when they first arrived", () => {
    const doc = docFromProject(project());
    joinProject(doc, lead, 1000);
    leaveProject(doc, "ses_1", 2000);
    joinProject(doc, lead, 3000);

    const [back] = participants(doc);
    expect(back.online).toBe(true);
    expect(back.joinedAt).toBe(1000);
  });

  it("is idempotent, because an agent joins on every request it makes", () => {
    // An agent has no connection to open, so its lease is claimed per call.
    // Joining repeatedly must not multiply the row.
    const doc = docFromProject(project());
    joinProject(doc, lead, 1000);
    joinProject(doc, lead, 1100);
    joinProject(doc, lead, 1200);
    expect(participants(doc)).toHaveLength(1);
    expect(participants(doc)[0].lastSeen).toBe(1200);
  });

  it("puts whoever is online first", () => {
    const doc = docFromProject(project());
    joinProject(doc, lead, 1000);
    joinProject(doc, gfx, 2000);
    leaveProject(doc, "ses_2", 3000);
    expect(participants(doc).map((p) => p.session)).toEqual(["ses_1", "ses_2"]);
  });

  it("reaches another peer, which is the whole reason it is in the document", () => {
    const a = docFromProject(project());
    const b = emptyDoc();
    applyUpdate(b, encodeDoc(a));

    joinProject(a, lead, 1000);
    applyUpdate(b, encodeDoc(a));
    expect(participants(b).map((p) => p.session)).toEqual(["ses_1"]);

    leaveProject(a, "ses_1", 2000);
    applyUpdate(b, encodeDoc(a));
    expect(participants(b)[0].online).toBe(false);
  });

  it("notifies on a join and on a leave alike", () => {
    const doc = docFromProject(project());
    let seen = 0;
    const stop = onParticipantsChange(doc, () => seen++);
    joinProject(doc, lead, 1000);
    leaveProject(doc, "ses_1", 2000);
    stop();
    expect(seen).toBe(2);
  });
});

describe("what the project cannot see", () => {
  /**
   * The same load-bearing property chat has, holding for the same reason:
   * `projectFromDoc` whitelists its roots and never looks here. Nothing was
   * written to exclude it, which is exactly why it is asserted — a property that
   * holds by omission is one a later edit can quietly take away, and the first
   * symptom would be a list of people in a file somebody handed to someone else.
   */
  it("does not reach the project", () => {
    const doc = docFromProject(project());
    const before = projectFromDoc(doc);

    joinProject(doc, lead, 1000);
    leaveProject(doc, "ses_1", 2000);

    expect(projectFromDoc(doc)).toEqual(before);
    expect(JSON.stringify(projectFromDoc(doc))).not.toContain("ses_1");
  });

  it("does not move the version, so it re-analyses nothing", () => {
    // ProjectStore.version() hashes JSON.stringify(projectFromDoc(...)), and the
    // browser rebuilds on it. Presence changing the version would re-analyse the
    // program every time somebody's tab woke up.
    const doc = docFromProject(project());
    const before = JSON.stringify(projectFromDoc(doc));
    joinProject(doc, lead, 1000);
    expect(JSON.stringify(projectFromDoc(doc))).toBe(before);
  });
});
