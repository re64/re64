import type { EvidenceKind, Project, ProjectEvidence } from "../project/project.js";
import { retiredClaimIds } from "../project/project.js";

/**
 * What a request to add or revise a piece of evidence must say.
 *
 * One rule for both verbs, because the rule is a fact about the **request** —
 * "a refutation says why" — and a record that could not have been added in a
 * shape could be edited into it: `add_evidence` refused a refutation pointing
 * at nothing while `edit_evidence` checked nothing at all, so `kind: "refutes"`
 * on a bare support, or `note: null` on the one explanation, went through.
 *
 * Request-aware, not a validation of the whole resulting record. It reads the
 * fields the caller *supplied* — `null` is a clear, absent is "leave alone" —
 * and checks the effective value only where the request reached it:
 *
 * - The refutation rule runs on an add, and on an edit touching `kind`,
 *   `other` or `note`. A method-only edit does not force repair of a record
 *   two peers' edits merged into an incomplete state; hygiene reports that,
 *   because it is a fact about the result and nobody's request was wrong.
 * - A reference is checked only when it is supplied and not null, against the
 *   caller's snapshot. A scenario deleted since the record named it must not
 *   block an edit to a note, and `scenario: null` must be able to clear it;
 *   resupplying a dangling id is a new request to point at it and gets the
 *   refusal an add would.
 *
 * Nothing here runs on merge, replay or migration. Two locally valid edits can
 * merge into a refutation with neither `other` nor a note — each peer cleared
 * one — and both contributions are kept; `explains` is what hygiene asks.
 */
export interface EvidencePatch {
  kind?: EvidenceKind;
  scenario?: string | null;
  capture?: string | null;
  other?: string | null;
  note?: string | null;
}

/** Whether a refutation or a retirement says what it points at: a claim, or a nonblank note. */
export function explains(evidence: { other?: string; note?: string }): boolean {
  return evidence.other !== undefined || (evidence.note !== undefined && evidence.note.trim() !== "");
}

/** The kinds that must explain themselves: each takes something away from a claim. */
const POINTED: readonly EvidenceKind[] = ["refutes", "retires"];

export function checkEvidenceRequest(
  project: Project,
  existing: ProjectEvidence | undefined,
  patch: EvidencePatch & { claim?: string }
): void {
  const claims = project.claims ?? [];
  const known = (id: string): "yes" | "retired" | "no" => {
    if (!claims.some((c) => c.id === id)) return "no";
    return retiredClaimIds(project.evidence).has(id) ? "retired" : "yes";
  };

  // The subject, on an add: a claim that is retired has nothing more said
  // about it, and one that does not exist cannot be pointed at.
  if (existing === undefined) {
    const held = known(patch.claim!);
    if (held === "retired") {
      throw new Error(
        `Claim ${patch.claim} is retired, so nothing more is said about it. ` +
          `restore_claim puts it back first.`
      );
    }
    if (held === "no") {
      throw new Error(`No claim ${patch.claim}. claims_at reports what covers an address, with ids.`);
    }
  }

  // References, where the request supplies one. A retired claim can still be
  // pointed at — "this replaced that" is exactly what retiring records.
  if (patch.other !== undefined && patch.other !== null && known(patch.other) === "no") {
    throw new Error(`No claim ${patch.other} to point at. list_claims shows the ids.`);
  }
  if (
    patch.scenario !== undefined &&
    patch.scenario !== null &&
    !(project.scenarios ?? []).some((x) => x.id === patch.scenario)
  ) {
    throw new Error(`No scenario ${patch.scenario}. list_scenarios shows what there is.`);
  }

  // The shape, where the request reached it. A refutation that names nothing
  // is an opinion with no handle on it: the whole point is that a reader can
  // follow it.
  const touched = existing === undefined || patch.kind !== undefined || patch.other !== undefined || patch.note !== undefined;
  if (!touched) return;
  const effective = {
    kind: patch.kind ?? existing?.kind,
    other: patch.other === null ? undefined : (patch.other ?? existing?.other),
    note: patch.note === null ? undefined : (patch.note ?? existing?.note),
  };
  if (effective.kind !== undefined && POINTED.includes(effective.kind) && !explains(effective)) {
    throw new Error(
      `A ${effective.kind} needs something to point at: another claim (\`other\`), or a note ` +
        `saying why. Otherwise nobody reading it can tell what was wrong.`
    );
  }
}
