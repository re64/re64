# 10 — coverage first, then the article over it

Two stages on one document, and two questions.

## The first question: does staging produce a better program?

Experiment 9 ran two readers and an editor on Revenge of the Mutant Camels at
the same time, and produced a very good article over a thinly annotated program
— **34 claims in 47,390 bytes**, nothing at all named in the sprite area, and
zero constants. Not because the readers were idle: nothing in that brief rewarded
coverage, and the editor's standard was *show me*, which is a different
instruction that produces different work.

So this one separates them. Stage one is coverage and structure, with nobody
writing prose. Stage two writes the article from what stage one left behind, and
cannot ask the readers anything, because they have stopped.

The comparison is against experiment 7, which was the deep coverage run on this
binary — 400 labels, 114 regions, 18 constants, 210 comments — but on the model
as it was before claims, types, evidence, scenarios or the machine existed.

## The second question: can the model hold what is *between* things?

Run 7 established that `zoneDataTable` is 42 records of 200 bytes with nineteen
proved fields, and had to write that in prose, because the model could hold one
field per record. `add_type` came out of exactly that, and run 9 used it to
declare a 41-field record.

The same thing may now be happening one level up. Run 9's best material — a
transformation graph, three bitmasks over creature types, a zone name that
explains its own sprites — is all about one thing *referring to* another, and all
of it went into an article because an article was the only container that fit.

**The evidence to read for is workarounds, not wishes.** Nobody asked for a type
system in run 7; they wrote a correct account into prose. The signature is
analysis that is complete, agreed and unstorable — so the reader brief asks for
the workaround list explicitly, with counts, recorded as they happen.

And a caveat on the method, recorded in `docs/decisions/claims.md`: an agent
invents a name for something adjacent to what it has, not for a category it has
never seen. So the usual signal — three readers reaching for the same missing
tool — cannot be relied on here, and the pressure has to be applied deliberately.
It is applied in the brief by describing the *phenomenon* and leaving the shape
of any answer entirely open.

## No prior notes

Both briefs forbid reading the rest of this repository. Experiment 9's readers
found a previous run's 249-line memo within ninety seconds; the editor turned
that into a virtue by refusing it as evidence, but it changed what the run
measured. This one starts from the bytes.

## Running it

    ./setup.sh                      # port 5193, project `camels`

Stage one, two readers, `brief-reader.md`. Snapshot the document. Then stage two,
one editor, `brief-editor.md`, over the same project.

Kept in `run1/`: both readers' findings, the editor's article and notes, the chat,
and the request transcript — which is the half that matters when a report and a
log disagree.
