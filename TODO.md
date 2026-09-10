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
- [x] **R5** — a target-framed claim is visible in every target. Fixed, together
      with the R6 residual: a target frame holds the target's **id**, names are
      aliases resolved at the boundary, and the loader asks of a target frame the
      question it always asked of a layer frame.
- [ ] **Open: when is a claim about one arrangement rather than about the
      program?** Fixing R5 honestly made the question real. Camels' 68 hand-named
      zero-page addresses were written while reading `runtime`; framed there and
      filtered, they vanish from the other four views — and `patched` is the same
      program with eleven byte patches, `machine` the same program with ROMs.
      So an unowned byte is now framed on the **address space** by default, true
      in every arrangement, and nothing emits a target frame. Which writes should
      be able to ask for one is undecided.
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

## 4. References in the document are ids

- [x] Claim frames name a target by id; names are aliases resolved at the
      boundary. (R5 + R6 residual.)
- [x] Field types refer to a type and a count constant by id. Names stay as an
      alias layer — `Creature`, or `Creature@typ_kj39fa` where two answer to one
      name — because the suggestion in a name is worth keeping and belongs
      outside the document. Ambiguity refuses and says both.
- [x] The invariant behind the alias layer: no field-type spelling can be
      mistaken for an id. Asserted in `identity.test.ts`.
- [ ] **A capture refers to its bytes by filename**, mutably mapped to a hash.
      This is R8 and it is the same rule.
- [ ] **A layer refers to its file by path.** Same shape, smaller stakes.
- [ ] **Not doing: per-session name tables.** Resolution asks the document as it
      is; a session-scoped table would make one caller's write mean something
      different from another's, which is the offline/online rule's failure case.
      Ambiguity refusing plus `expectVersion` covers what it would have bought.
      Revisit only if something reproduces a gap those two leave.
- [x] **R6 residual** — done with R5 above. Duplicate target names are now
      refused when used to select, and named, rather than the first silently
      winning.

---

# 5. Local resolution, and the session as a replica

The settled position, after getting it backwards once. Anything a caller writes
that has to be **resolved** — a name meaning an id, an ambiguity — resolves
against **that participant's own state**, never against the server's current
global state. The resolved operation carries ids and merges whatever anyone else
did. Two participants resolving one name to different ids is *correct*: the same
shape as two readers naming one routine differently, which the model already
tolerates and hygiene already reports.

Asking the live document is the failure the offline rule names — *"an operation
whose correctness depends on having seen what everyone else did fails the first
direction"*. An MCP session is a proxy for a browser tab, and `src/client/
session.ts` is the model that already does this right.

**Freshness is not correctness.** An agent may work from an out-of-date view
indefinitely, however online its connection is. Nothing forces a merge. An agent
that never merges duplicates work and produces two names for one routine —
which is the design working, not a bug, and worth expecting when a run does it.

## Stage 1 — chat becomes a first-class entity

Independent of the rest; can land first. **Two of `chat.ts`'s arguments hold and
one does not**, which is what makes this smaller than it looks:

- **Holds: a `Y.Array`, not an id-keyed map.** Ordering *is* the content of a
  conversation, and the array CRDT converges it without anyone agreeing a clock.
  This is the opposite of fields and bindings, where position was masquerading as
  identity. Both properties are already there — the array orders, and each entry
  is a `Y.Map` carrying an id — so **no storage change**.
- **Holds: undo must not eat what somebody said.** Keep chat out of the undo
  stack, deliberately and stated. Deleting a message is `remove_message`, an
  explicit act — the same distinction `retire_claim` draws against a sweep.
- **Does not hold: "deliberately not an operation … 'unsay that' is not a
  computable inverse."** It plainly is: `message.add` inverts to
  `message.remove`. The real objection was about undo, and undo is a separate
  question from whether the vocabulary covers it.

Work:

- [ ] `message.add` / `message.set` / `message.remove`. Algebra 42 → 45. The
      round-trip harness is keyed by `Op["op"]`, so it will not compile until
      each has a case.
- [ ] `post_message` **returns the id**. Messages have had ids since they
      existed and no surface has ever exposed one. F1, again.
- [ ] `edit_message` and `remove_message`, by id.
- [ ] Undo skips message ops, as a stated rule with the reason.
- [ ] Chat reaches `changes_since`, which is the point: it is how a session
      peeks at what is waiting without merging it.

**The fork this turns on, and it needs a decision.** `changes_since` is fed from
the ops log, and the socket path derives ops by diffing *projections*. Chat is
excluded from `projectFromDoc` by an explicit whitelist. So chat can only reach
the changes feed if it reaches the projection — which means it reaches the
exported `.re64` too.

- **(A) Chat joins `Project`.** Exported, versioned, diffed, in the feed. One
  mechanism, no special case, and a project carries its own discussion wherever
  it goes. Costs: the file format grows a root, the golden hash moves, and every
  message moves the version — which matters much less once `expectVersion` is
  gone.
- **(B) Chat stays out**, and reaches the feed by a second mechanism that the
  socket path cannot see.

**Recommended: (A).** (B) buys a parallel path for the one root that is small,
and leaves a project's discussion behind when the file is handed to somebody.
The argument it overturns — *"a message … has no place in a `.re64`"* — was made
when chat was not first class.

## Stage 2 — the changes feed becomes complete (R11)

A prerequisite, because stage 3 makes the feed load-bearing as both the peek and
the merge cursor. Today `PUT /api/project` reaches the document and adds **zero**
rows, and undo changes state without advancing the cursor — so a session would be
told nothing is pending when something is. A silent wrong answer in the place we
are about to depend on.

- [ ] Route every accepted write through one action recorder.
- [ ] Undo appends an event referencing the original action, rather than only
      flipping `undone`.

## Stage 3 — the session replica

- [ ] An MCP session holds a **pinned view** of the document. Reads answer from
      the pin; writes apply and propagate immediately. Only the inbox is
      deferred — a connected session has no reason to hold its own writes, so
      there is no outbox and no offline write queue.
- [ ] Name→id resolution moves to the pinned view. **Ambiguity becomes local**:
      two `Creature`s in *my* view must be disambiguated; someone else's
      concurrent second one must not change what my operation meant.
- [ ] `pending` on every answer that has one, **absent when zero** — the
      `hygiene` idiom, because a counter that says `0` ninety-five times trains a
      reader to stop looking. Count and who; *what* is `changes_since`'s job and
      already exists, so nothing to build there until a run asks for it.
- [ ] An explicit `merge` tool. Explicit on purpose: it avoids a per-tool
      classification of which calls sync, and the last two classifications each
      caught tools misclassified in shipped code the moment a test existed.
      A `merge=before` argument stays unbuilt until a run shows agents
      forgetting — an argument on every tool is how `target` got where it was.
- [ ] **`expectVersion` removed**, folded in here because this is what replaces
      it. An offline participant can never supply a valid whole-document hash,
      so it is a second mode by construction, and refusing a write because the
      document moved is refusing to merge.

## Stage 4 — sweep the model and the surface for consistency

Two rules are now settled: **every reference in the document is an id**, and
**everything resolvable resolves locally**. Check them everywhere rather than
where we happened to look.

- [ ] Every entity: three verbs, an id returned by whatever mints it, a
      round-trip case. `post_message` returning no id is one instance; look for
      the rest.
- [ ] Every reference: capture → filename (R8), layer → path, and whatever the
      sweep turns up.
- [ ] Every resolution: anything that reads "current" state to decide what a
      write means.
- [ ] Fold the findings into the Codex queue rather than keeping two lists.
