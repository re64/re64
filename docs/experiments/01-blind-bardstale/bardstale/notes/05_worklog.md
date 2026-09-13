# Work log (chronological)

## Session 1
1. Two D64s, 174848 bytes each (35 tracks, no error bytes). `file` misidentifies as Targa — ignore.
2. Wrote tools/d64.py (BAM, dir, chain, extract, usage map). Disk 1 = "CITY DISK" id KY, disk 2 = "BARDS TALE" id rR.
3. Usage map first showed lots of "data in free sectors" — false alarm: 1541 format fill pattern 4B 01 01... Added to tool.
   -> Lesson: need a library of "known noise patterns" for sector classification.
4. Disk 2 has an orphan chain (deleted file) T6S7->...->T5S18, 10 blocks, saved as extracted/d2/orphan_T6S7.bin. Contains 6502 code + high-bit ASCII text (dungeon messages).
5. Both main PRGs ("bard intro /3532", "bard's tale/3532") are packed: BASIC stub SYS2059, decruncher copied to $00FB-$01FA. Wrote emu6502.py and ran the decruncher instead of reversing it.
   Stage 1: bit-stream LZ -> image $07F0-$8BAF. Stage 2 ($0810): moves image up +$7500, RLE (esc $9F: 9F 00 = literal 9F, 9F 01 = next dest segment, 9F nn vv = nn x vv) -> $0800-$CAFF, then JMP $C000.
   Mistakes: stop condition on PC==$0810 fired on loop head; PC-based write attribution must use PC-after-fetch. 
6. $C000 = screen init (multicolor bitmap $2000, screen $0400), draws UI frame, JMP $0800. $0800 = 70-entry JMP table (resident API for overlays).
7. Loader at $78B9: file# A -> "NM"+hex(A); KERNAL LOAD (SA=0) to page from table D_796C / rules (see 03_formats.md). PRG header addresses are NOT the real addresses.
8. Save routine $7B96: NM00/NM01 = $C000-$C7FF roster halves, NM0A = $C000-$C0FF. Decoded roster records (16 x 128 bytes; '*' = party record).
9. Wrote strings_hi.py; found monster/item/spell/class text, assembler symbol residue ($BE95), and that PRG headers lie about addresses.
10. Built btfiles.py (file->address rules) so every tool agrees on real addresses. Disassembled overlays with disov.py; found the $BB00 slack junk; wrote slack.py. Lesson: sector slack must be modelled BEFORE trusting file contents.
11. Picture format from $4000 renderer -> picture.py; first render had wrong colours (assumed screen RAM from init). Later found SET_PIC_COLORS ($456E) and table $0D99 -> correct C64 palette. Lesson: "colour" is state set elsewhere; keep a list of open questions per unit.
12. Map format from NM02 -> dungeonmap.py; initially misread bit order (N/S swapped) and the $FC20 list ("stairs" vs "special type"); fixed after reading the view builder and LOAD_SPECIAL usage.
13. City grids from NM04 tail + NM09; found orientation by the Guild exit coordinates. citymap.py.
14. Roster record layout: took several passes (misread dump row offsets by $10 once; HP/SP max/cur direction resolved with the dead character SAMSON). Lesson: a record-layout table with per-field evidence would have prevented back-and-forth.
15. Monster/item/spell tables via xrefs.py (traced-code-only xrefs were essential; raw byte scanning was useless).
16. Orphan = old NM02 revision (k-gram alignment). NM0A = Garth's stock. Intro = standalone demo.
17. Headless emulation (run_game.py): KERNAL hooks, IRQ, key injection. Bugs hit: JMP tail-calls to KERNAL not hooked; idle detection sampled PC right after IRQ injection; keys eaten by "insert disk" prompts; view depth $D8 needed for a visible view. Result: full boot->city->dungeon run with screenshots, confirming nearly every static finding.
