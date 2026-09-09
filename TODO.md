# In flight

Short-lived. An item that turns out to carry a decision goes to
`docs/decisions/` and is struck from here; an item nobody has picked up in a
month was not a todo.

## 1. Platform projects, and the ROM rule

- [x] **Reference layers leak into coverage.** `find_undecoded` and `find_bytes`
      filter on `hasBytes` alone, never on `!reference`, so linking the KERNAL
      and BASIC ROMs adds ~16KB of "unexplained bytes" and makes `find_bytes`
      match inside ROM. `layer.ts` says a reference layer is "left out of the
      rendered range and out of nothing else" — coverage is where *nothing else*
      is wrong. A bug today, and what makes a linked ROM harmless.
- [x] **`create_project(name, platform?)`.** `platform: "c64"` declares the three
      rom layers and a target linking them. A closed set, not a `template`
      string: the noun already exists (`origin: "platform"`,
      `createC64PlatformLayer`, `buildMemoryMap`'s `platform` option) and a
      template parameter has no vocabulary anything can check.
      **Declared, never auto-linked** — the project says the same thing on every
      host and one without the bytes reports `romsMissing`.
- [x] **A diagnostic for running without ROMs.** With the ROM linked the emulator
      runs a KERNAL call; without it, it falls into unmapped memory and says so
      in terms of the address rather than of the missing ROM.

## 2. `target` leaves the tools that address by id

Removing `defaultTarget` left `target` declared on all 94 tools, including the
ones that now ignore it. A tool advertising a parameter it does not use is a lie
in the one place agents read.

- [x] Split the registration so a tool declares whether it answers for a view.
- [x] Classify all 94. The rule is **does the answer contain an address**, not
      "is the subject an id" — `list_retired` looked view-free and reports
      absolute addresses; `list_types` is view-free except for `usedAt`, and now
      answers partially and says what it left out.
- [x] A test that every tool is in exactly one class, so a new one cannot be
      added without deciding.
- [ ] **Second pass: scenarios and comments.** A scenario's steps carry addresses
      the author typed rather than ones this resolved; a comment is addressed by
      id but lives inside a layer. Both are arguable and neither is argued yet.

## 3. The Codex review — confirmed, and what it costs

`experiments/codex-review/` — another model's review of the document model.
Re-run against this tree: **fifteen of fifteen reproduce**, one changed shape by
today's work. `TRIAGE.md` is what happened and the order I would fix them in;
`REVIEW.md` is the original.

- [x] Understand it, and re-run every probe rather than trust the prose.
- [x] Fix the stale reference docs it caught (`by` and `supersedes` in the
      developer guide; "`layer.set` does not exist" in the model reference, where
      the real gap is that no tool emits one).
- [ ] **R5** — a target-framed claim is visible in every target. The loader asks
      the question of layer frames and not of target frames. Cheapest P1 here.
- [ ] **R2** — `claim.set` writes every key back, so a partial edit reasserts
      fields a collaborator just changed. This is the review's thesis in one
      operation.
- [ ] **R1** — overlapping MCP requests resolve the caller through server-global
      mutable state, so a claim asked for by one user is recorded as another.
- [ ] **R7** — the scenario cache is keyed on the document version, which does
      not include the target, so a check passes against bytes it never ran on.
      Fix before any experiment is told to use scenarios as evidence.
- [ ] **R3 + R4** — fields are stored by offset and bindings under minted use
      ids, so neither implements the identity its verbs promise. The largest
      item, and the one yesterday's `field.*` work sits on top of.
- [ ] **R9**, then **R8** — publish only after commit; make the document's
      content hash decide the bytes served.
- [ ] **R10, R11, R12** — the history feed: inverse pairing, append-only undo
      events, redo order.
- [ ] **R13, R14, R15** — provenance clear semantics, canonical projection
      order, strict numeric parsing.
- [ ] **R6 residual** — targets are referenced by name, not id. Renaming one
      orphans every target-framed claim and every reader that named it.
      Duplicate names are admitted.
