# C64 ROMs

Not in this repository, and not linked from it. They are Commodore's, they are
practically abandoned — widely mirrored for decades without consequence — and
they are still somebody's copyright, so this project neither ships them nor
points at where to get them. Anyone reproducing results here can find them.

`.gitignore` covers `3party/**/*.bin`, so dropping them in this directory is
enough; nothing else needs configuring and nothing will be committed.

## What to put here

Filenames are the ones used below, and the part numbers in them are Commodore's
own — `901227-03` is the third revision of the KERNAL, which is the one in most
breadbin and C64C machines and the one everything documented assumes.

| file | bytes | loads at |
|---|---|---|
| `kernal.901227-03.bin` | 8192 | `$E000-$FFFF` |
| `basic.901226-01.bin` | 8192 | `$A000-$BFFF` |
| `characters.901225-01.bin` | 4096 | `$D000-$DFFF` when banked in |

```
md5     39065497630802346bce17963f13c092   kernal.901227-03.bin
sha256  83c60d47047d7beab8e5b7bf6f67f80daa088b7a6a27de0d7e016f6484042721

md5     57af4ae21d4b705c2991d98ed5c1f7b8   basic.901226-01.bin
sha256  89878cea0a268734696de11c4bae593eaaa506465d2029d619c0e0cbccdfa62d

md5     12a4202f5331d45af846af6c58fba946   characters.901225-01.bin
sha256  fd0d53b8480e86163ac98998976c72cc58d5dd8eb824ed7b829774e74213b420
```

A different KERNAL revision will still load and analyse; the addresses in
`src/core/c64/symbols.ts` are the documented jump table, which is stable across
revisions by design. What will differ is anything derived from the code behind
it.

## What they are for

**Not for shipping analysis results.** re64's built-in knowledge of the machine
is a table of names in `src/core/c64/symbols.ts` — facts about a documented API,
not the ROM's code — and anything derived from these files belongs in the same
category or not at all.

Two uses, and the distinction matters:

- **Deriving facts.** What `SETLFS` reads and writes is a fact about the KERNAL's
  interface, and re64's own analysis can work it out: load the ROM, disassemble
  from the 39 documented entry points, and read the effects off the lifted code.
  Checked against published documentation, the answers come out right — `SETLFS`
  reads `A`, `X`, `Y` and writes `$B8`, `$BA`, `$B9`, which is exactly the
  logical file, device and secondary address. Facts like that can be shipped.
  The ROM cannot.

- **Reading the ROM itself**, as a layer in a project, for anyone who wants to.
  That is a layer you add; it is deliberately not the default, because analysis
  that changes depending on which files somebody happens to have would give two
  collaborators on one shared document two different answers.

One caveat if you do load them: a ROM layer is *always* visible, and a real C64
banks ROM in and out. Writes reach the RAM underneath either way — which is why
`POKE I, PEEK(I)` copies ROM into RAM — but a *read* of `$E000` will return ROM
whether or not the program had it banked in. Put them behind a target rather
than in the default view.
