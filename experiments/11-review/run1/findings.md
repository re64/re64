# rev — review pass on camels

Tagged `before-rev-review` and `after-rev-review`. Everything below is in the
project; this file only says what and why.

Headline numbers, from `describe_project` before and after: instructions decoded
2451 → 3388, disassembler warnings 146 → 12, hygiene items 206 → 163,
`annotation.insideInstruction` 10 → 0, `label.nameShared` 1 → 0, `ZoneRecord`
unexplained bytes 128 → 0.

## What I resolved

**The whole of experiment 10 was one load address low.** All 78 claims made by
`exp10-one` and `exp10-two` inside the runtime layer sat exactly $0801 below the
bytes they described. `msg_stand_by_player` labelled sprite pixels at $4998
instead of STAND BY YOUR BEAST at $5199; `reserved_9FEF_BFFF` called 8209 bytes
of live code "reserved"; three of the six declared record types
(`HighScoreEntry`, `HighScoreEntryLive`, `PlayerSlot`) were bound to claims that
described nothing at all.

I decided it three ways rather than by pattern-matching. The bytes: $5199 reads
STAND BY YOUR BEAST PLAYER ONE / TWO in screen code and $4998 is bitmap; $56AE is
a plain a–z table and $4EAD is not; $5A00 reads WELCOME TO REVENGE OF THE MUTANT
CAMELS. Nine of the claims carry the correct address inside their own name —
`unresolved_5870_block` sat at $506F, `sub_8834_dispatch_helper` at $8033,
`unreached_9565` at $8D64 — so the authors knew the address and the claim did not
get it. And every single one has a semantic twin by a different author at exactly
+$0801: `irq_dummy_rti`/`NmiRtiOnly`, `plot_char_and_color`/`PrintCharAt`,
`spawn_object_from_template`/`SpawnCreature`, seventy-five more.

I moved them with `edit_claim at:` rather than deleting them. exp10 was right
about the bytes every time; deleting 78 correct readings because the address was
wrong would also have deleted the only evidence in the document that two
independent sessions agree. The full account is a comment at $0801.

Ten of the twelve `annotation.insideInstruction` items and thirty-two
`interpretationsDiffer` items were symptoms of this one fault, and the 937
newly-decoded instructions are code that a displaced `is: data` claim had been
sitting on.

Two smaller ones. `sprite_sheet_main` ($0000–$47FF, "18431 bytes are a sprite
bitmap") was the one exp10 claim that escaped the displacement, because it was
target-scoped — which put it over zero page, the stack and the BASIC vectors.
Read as intended it is a coarser restatement of seven existing claims, so I
withdrew it and said so in a comment rather than moving it. And two claims both
called `orphanTuneStream`, at $64B4 and $64BA, were rendering as
`orphanTuneStream@<claim id>`; they are not the same thing (the block includes
six bytes of $FF padding and a stray $30 before the stream starts), so $64B4 is
now `orphanTuneBlock`.

I deliberately left the two `label.duplicated` items alone. `FindFreeObjectSlot`
×3 and `LoadHighScoreFile` ×2 are identical names at one address: only one
renders, so removing the others changes nothing a reader can see, and hygiene
itself notes they corroborate each other by different methods. Tidying them would
have been churn.

## What I sharpened

**The 8400-byte zone table.** It was already `record`/`ZoneRecord`, size 200,
with 4 of its 19 columns declared and 128 bytes unexplained. The shape is the
copy loop: `LoadZoneTemplates` ($9699) moves exactly $98 bytes from
`(zoneDataPtr),Y` to `tmplSpawnInterval,Y`, so offset *k* of the record is
$1DA0+*k* — and nineteen `tmpl*` arrays are already named there, eight bytes
apart. So the record is nineteen columns of eight, one column per creature type
0–7, and every column already had a name at the other end of the copy. The eight
bytes at +$98 are not a hole either: `LoadZoneScalars` ($9CB5) reads them one at a
time into $53, $52, $51, $42, $02, SPMC0, SPMC1, and discards the eighth, then
reads straight on into the 40-byte name. `ZoneRecord` now accounts for all 200
bytes. The broad claim was hiding the fact that the entire difficulty curve of
the game is 42 × 8 × 19 numbers in one table.

`PlayerSlot` went from 85 unexplained bytes to 0 — but the interesting half is
that 77 of those bytes are *not used at all*: the slot is 128 bytes because $5F00
and $5F80 are 128 apart, and 51 bytes are live. Saying that is worth more than
leaving them blank.

The four record types that had been bound to displaced claims now describe the
tables they were derived from — the $5474 default high-score table renders as
four `HighScoreEntry` records with rank/score/message instead of one 208-byte
text run, and I refuted the two flat text readings with evidence naming the
record claims rather than removing them.

## What I filled

`find_undecoded` returns zero: there are no spans nothing has spoken about. The
gaps here are named-but-unexplained, so that is where I worked.

The leftover assembler source at $5F26 gave up one more identification. Lines
15140–15190 read `LDA NEXINI / CLC / ADC #$C8 / STA NEXINI / LDA NEXINI+1 /
ADC #$00`, and $93E4–$93EF is that sequence instruction for instruction on
$3E/$3F. So NEXINI is the zone pointer, `$3F` — which had no name at all — is now
`zoneDataPtrHi`, and the $C8 is the record stride. I declared `ZONE_STRIDE = $C8`
and bound it at $93E7, so the line reads `ADC #ZONE_STRIDE`. That is the second
routine identified from the residue by instruction-for-instruction match; SSET at
$92F6 was the first, by an earlier reader.

Still empty: `field80` (+$50 in the zone record) and `animMode` (+$20) are named
after their address and their column and nothing else, at both ends of the copy.
`MusicStep`'s `music_track_1` at $5FFE overlaps the three-voice tune at $6000 and
I did not resolve which reading of that stream is right.

## What I could not record in the project

Three things, with counts.

1. **The `add_claim` receipt reports a layer-relative offset as if it were an
   address.** Asking for `$5199` returns `"did": ["name +$4998 ..."]` — the same
   $0801 that displaced experiment 10, arriving in the one place a writer looks
   to confirm the write landed. Every read surface (`claims_at`, `list_claims`,
   `describe_project`, the listing) answers $5199. I could only write this into
   the project as prose, in the comment at $0801 and in a `post_message`; there is
   nowhere to attach a finding about a tool. 1 defect, 78 claims affected, 2
   sessions that did not notice.

2. **A refuted claim still renders exactly as before.** I probed this
   deliberately: `add_evidence kind:"refutes"` on `clm_e76o3i` changed nothing in
   the listing at $4998. So "decide in the open" and "a reader meets one clear
   answer" pull against each other — the only way to stop a wrong reading
   rendering is `remove_claim`, which also destroys the evidence attached to it,
   including the `supports` record that carries authorship. That is why I moved 78
   claims instead of refuting them: refuting would have left the listing exactly
   as broken as I found it. 1 probe, reverted.

3. **Record fields merge per offset across authors and cannot be un-declared by
   another author.** I replaced `ZoneRecord`'s four per-index columns
   (`spriteFirst0..7` and friends) with `u8[8]` arrays to match the other fifteen;
   the arrays appeared *and* the 28 original per-index fields stayed, so each of
   those four columns rendered twice. `edit_type`'s "a field you leave out is one
   you removed" holds only for your own fields. I had to restore the per-index
   form, so four of nineteen columns are declared in a different shape from the
   other fifteen for no reason a reader can see. 28 fields, 1 revert, noted in the
   comment at $6700 so the inconsistency does not read as a judgement.

Two smaller ones, from the existing document rather than from me: someone at
$88D4 had already written "edit_claim cannot revise a claim's comment or method,
only name/is/extent/root, so this follow-up comment stands next to the original
rather than replacing it" — the same shape of problem, recorded the same way, in
prose. And `find_references` cannot see a table reached only through `(zp),Y`,
which is why the 8400-byte zone table has no inbound references at all; that is
stated honestly in its answer, but it means the biggest table in the program
looks unreferenced.

Things I computed by hand more than twice, which the brief says are findings: the
address arithmetic `claim + $0801` (78 times, in a script); decoding screen codes
to letters (a local table, because `preview` shows four encodings at once and
never says which is right — correct behaviour, but it means every string is read
by eye); and walking BASIC line links to prove the source-residue format, which I
did before finding that three earlier readers had already done it and written it
up better.

## What I would want that does not exist

**A way to retire a claim without erasing it.** Not `remove_claim`, not
`refutes`. A claim marked superseded should stop rendering and stay readable in
`claims_at` and `list_evidence`, with the claim that replaced it named. Every
hard call in this pass — 78 moves, 1 withdrawal, 2 refutations of flat text
readings — was really me choosing between "a reader meets a wrong label" and "the
wrong turn is gone". That choice should not exist.

**Bulk `edit_claim`.** `add_claims`, `add_comments`, `add_constants` and
`bind_constants` all take arrays; `edit_claim` and `remove_claim` take one id. The
single most valuable operation in this session was applying one arithmetic
correction to 78 claims, and it was 78 calls.

**A displacement check in hygiene.** Every ingredient was already in the
document: claims whose names embed an address they do not sit at, and a constant
offset between one author's claims and everyone else's. Three sessions and four
hours did not see it, and it is mechanically detectable. `disagreements` looks for
two claims over one span; this was 78 claims that overlapped nothing, which is
exactly why nothing complained.
