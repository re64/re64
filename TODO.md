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

- [ ] Split the registration so a tool declares whether it answers for a view.
- [ ] Classify all 94. The rule is **does the answer contain an address**, not
      "is the subject an id" — `list_retired` looked view-free and reports
      absolute addresses; `list_types` is view-free except for `usedAt`, and now
      answers partially and says what it left out.
- [ ] A test that every tool is in exactly one class, so a new one cannot be
      added without deciding.

## 3. Read the Codex review

`~/Desktop/Privat/Projects/re64-codex/experiments/codex-review` — a review of the
document model and design by another model. Understand it, **confirm or refute
each finding against the code**, then plan. Findings are claims until reproduced;
the experiment rule applies — an unreliable narrator is still worth reading, and
the code decides.
