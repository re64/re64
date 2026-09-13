# Dependencies, reuse and duplication

## What can be understood independently (no other unit needed)
- D64 container layout (standard).
- Packer stages (self-contained code + data; understood by execution).
- Picture files: format is self-describing enough to decode once the renderer ($4000) is read; renderer is resident code that only needs the line-address table (which itself is derivable from VIC bitmap geometry).
- Dungeon maps: wall grid is interpretable alone (22x22 histogram shows 2-bit fields); header semantics needed NM02.
- Roster files: names readable alone; record semantics needed resident + NM1B code.
- Text strings: encoding (hi-bit ASCII, $DC) is obvious from any file.

## Dependency graph (A needs B)
```
d64.py ----------------------------------------------------------- everything
packer(emulator) -> resident image (main.mem) -> jump table names -> every overlay listing
resident loader ($78B9, table $796C) -> real load addresses -> correct disassembly of ALL NMxx (PRG headers lie)
resident PRINT ($0AC6) -> text encoding rules ('/' plural, $DC) -> monster/item names, map messages, overlay strings
resident line table ($C900) -> picture renderer ($4000) -> picture.py -> pictures (NM50-90, NMF0, resident copies at $D000/$ED00)
SET_PIC_COLORS ($456E) + table $0D99 -> correct picture colours
NM02 (dungeon main) -> map header/flag semantics -> dungeonmap.py ; special types -> table $1B28 -> overlay purposes
NM09 (city main) -> NM04 grid semantics (cell = type<<3 | facade) -> table $1B28/$AEEE -> city overlay purposes
NM1B (guild) + $124F/$43A6/$104E -> character record layout -> roster decoding, party area $CB80
$5170 (combat menu) + $4535 -> item table columns ($A3F7/$A477/$A4F7) ; item names need pointer table $AA09
$4F0A/$6D96/$5AB8 (combat) -> monster columns ($7D28/$7DA8/$7E28/$7EA8); names need $8D0D table
$6412 (cast) -> spell handler table $987C ; stream $971F -> spell numbering -> cost/flags tables
slack.py -> needed BEFORE trusting any $BB00 overlay disassembly (junk creates false code/targets)
NM03 (utilities) -> NMF0 meaning (container of 6 pictures) -> RESIDENT_PICS copy routine $0D54 semantics
```

## Knowledge reusable across units
- 6502 disassembly + tracing (all code units), self-modifying-operand idiom (LDA #imm patched: $0C1A, $4F3B, $6431, decruncher).
- Hi-bit ASCII text encoding: resident, all overlays, maps, intro.
- Jump-table API names: all 40+ overlays read identically once JT is labelled.
- "Coordinate list of (ns,ew) pairs terminated by FF" idiom: map header lists; also NM09 city uses (ns,ew).
- 5-bit packed stats, 12-digit decimal numbers: roster, party area, scratch $C800/$CF00, NM0A? (no).
- Row-address tables (D_B8F3/D_B909 in NM02 = 22*ns; D_B13A/D_B158 in NM09 = 30*(29-ns)): same idiom, different geometry.
- Picture stream format: 66 files + 4 embedded copies in NM04/NM05-08 ($ED00) + 6 in NMF0.
- Overlay slack template: one template explains the tails of ~35 files.

## Same knowledge in multiple places (duplication)
| Knowledge | Places |
|---|---|
| Six resident pictures ($8B,$8C,$8D,$8E,$57,$53) | as files NM8B.. on disk 1 AND concatenated in NMF0 AND in RAM $D000 |
| Pictures $5A-$5D | files NM5A-5D AND embedded at $ED00-$F5FF in NM04 and in each of NM05-NM08 (5 copies on disk) |
| Monster pictures NM5E-NM82 | both disks, byte-identical bodies |
| Font + keyboard matrix tables | resident ($164E/$1D68/$1DF0/$1E30), NM03 ($B518/$B284/$B30C/$B34C), intro (builds line table itself) |
| Line address table $C900/$CA00 | resident data; intro computes it at $4034 |
| Party pointer table (00 CB 80 CB ...) | resident $098D; also in $BB00 slack junk |
| "Insert CHARACTER disk" text | resident $7A91 and $7AD4 (two identical copies) and NM0D/NM1B |
| Temple/Roscoe texts | NM0E and NM10 (NM10 file carries a stale copy of NM0E's text after its own content) |
| Guardian statue text | NM11 and NM16 (NM16's tail = stale NM11 content) |
| Magic mouth (Mangar's tower) text | NM13, NM19, NM1A (stale copies) |
| Equipment type names "Weapon/Shield/.." | resident $A57C and NM0B/NM34 tails (stale) |
| "Lk: HP:" sheet fragment | resident $A229, NM3F/NM43 slack |
| Special-type -> overlay table | resident $1B28 (64 entries) + NM09 remap $AEEE (city types >= 16) |
| Load-address rule | resident table $796C vs. PRG headers on disk (headers are systematically wrong by $8000/$D000) |
| Level chain / tileset | each map repeats its dungeon's chain ($FC00) and tileset id; NM02 also recomputes stairs sense from $FC15 |
| Class/race names | resident $A11E.. ; NM1B repeats race list for creation menu |
| Stats/level formulas | experience thresholds $A70D (13/class) in resident; Review Board NM0B uses J_sub_4516 |
