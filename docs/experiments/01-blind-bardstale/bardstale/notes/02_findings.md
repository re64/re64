# Major findings

Format: **F-nn — Assertion** / Source / Location / Evidence / Description

## Disk & container level

**F-01 — Both images are standard 35-track D64s with CBM DOS filesystems; all game content is in directory files (plus one orphan chain).**
- Source: tools/d64.py `bam`, `dir`, `usage`
- Location: bardst-1.d64 ("CITY DISK", id KY), bardst-2.d64 ("BARDS TALE", id rR)
- Evidence: usage map shows every non-empty sector owned by a directory entry, except disk 2 T5/T6 orphan chain (6,7)->(6,17)->(6,9)->(6,19)->(6,11)->(5,0)->(5,10)->(5,20)->(5,8)->(5,18).
- Description: 1541 format-fill (4B 01 01..) initially looked like data; false alarm. Disk 1 has two 0-block "----------------" USR separator entries pointing to 18/18 (collector/cracker cosmetics). "/3532" in the two program names is a release tag, not part of the game.

**F-02 — The orphan chain on disk 2 is a deleted 10-block file (2313 bytes) containing a dungeon overlay (6502 code calling the $08xx jump table + high-bit ASCII dungeon messages).**
- Source: tools/d64.py chain; extracted/d2/orphan_T6S7.bin
- Evidence: text "There are stairs here, going up. Do you wish to take them? [Y-N]", "Darkness!", "Smoke in your eyes!", "There are stairs near...", "Something special is near...", "A trap is near!" ; code uses JSR $0806/$0809 style calls.
- Description: likely an earlier build of a dungeon overlay (candidate: an NM02-like main dungeon overlay fragment). See 01_units.md U-ORPHAN.

## Programs / loaders

**F-03 — "bard's tale/3532" and "bard intro /3532" are two-stage packed programs (LZ bitstream in stack page, then RLE esc $9F), unpacked by running them in my emulator.**
- Source: tools/emu6502.py, tools/unpack_main.py
- Location: file offset 0 BASIC stub "SYS2059"; stage1 decruncher at $00FB-$01FA; stage2 at $0101-$01FB (copied from $0824)
- Evidence: stage 1 stops with JMP $0810 after writing $07F0-$8BAF; stage 2 moves image +$7500 and RLE-decodes $0800-$CAFF (main) / $4000-$B2FF+$C000-$C025 (intro), exits via LDA #$37/STA $01/CLI/JMP $C000.
- Description: RLE: `9F 00`=literal $9F, `9F 01`=next destination from table at $0183 (relocated), `9F nn vv` = nn copies of vv. Final images in extracted/d1/main.mem, intro.mem.

**F-04 — The resident game program occupies $0800-$CAFF; entry $C000 (screen init) -> $0800 (JMP table) -> $08D2 GAME_INIT.**
- Source: disasm/main_traced.asm
- Evidence: $C000 sets multicolor bitmap ($D011|$20, $D016|$10, $D018=$18: screen $0400, bitmap $2000), fills color RAM=1, screen=$CC, draws frame colors, clears $2000-$3FFF, JMP $0800.
- Description: memory map in 03_formats.md "Memory map".

**F-05 — $0800-$08D1 is a 70-entry JMP table = the resident API used by all overlays.**
- Source: usage count over all overlays (tools output in 05_worklog)
- Evidence: 282 uses of $0809 (PRINT), 141 of $0806 (CLEAR_TEXT), 91 of $080F (GETKEY), 48 of $0803 (SHOW_PICTURE) etc.
- Description: full list with names in notes/labels_main.txt / 03_formats.md.

**F-06 — Overlay loader: file number A -> filename "NM"+2 hex digits; loaded by KERNAL LOAD with secondary address 0 to a page chosen by a table, NOT by the PRG header.**
- Source: disasm/main_traced.asm $78B9-$7951, table $796C
- Evidence: SETLFS(15,8,0), SETNAM("NMxx"), LOAD with X=0,Y=page; page = D_796C[A] for A<$50; $C0 for $50-$9F; $F8 for >=$A0; $BB for $F0.
- Description: PRG headers are $8000 lower than reality for $2E00/$3600/$3B00 files, $1000 for $E000 files: consistent with the developers assembling overlays with a "load under ROM" trick (KERNAL LOAD can't target $D000+ visible RAM otherwise). Loader keeps $2D = current file to avoid reloads; 10 picture numbers ($5A-$5D,$8B-$8E,$57,$53) are served from RAM under ROM instead of disk (copy routine $0D54).

**F-07 — NM00/NM01 are the character roster (2 x 16 records x 128 bytes) and NM0A a 256-byte state block; they are the only files the game writes (routine $7B96: "I", "S0:NMxx", SAVE $C000..).**
- Source: disasm $7B96-$7C3F; extracted/d1/nm00.prg
- Evidence: save end-page table $7C25 = C8 C8 C1; roster dump shows names (HIPASIA, EL CID, SAMSON, MARKUS, ...), party records starting with '*' (e.g. "*ATEAM") listing 6 member names.
- Description: record layout in 03_formats.md. This disk image contains a player's saved roster (personal data of the original owner).

**F-08 — Game modes and overlay dispatch: SET_MODE ($19F0) loads NM09 (city, +NM04 data at $E000), NM02 (dungeon) or NM03 (mode 2) to $AE00 and jumps there; LOAD_SPECIAL ($1B15) maps 32 special-location types to sub-overlays via table $1B28.**
- Evidence: D_1A5F = 09 02 03 ; D_1B28 = 00 1B 0C 0D 0E 0B 00 0F 10 1C 1D 1E 11 12 14 13 1F 20 21 22 23 24 25 15 26 27 28 29 2A 2B 2C 2D; type 6 = "enter dungeon" (SET_MODE 1); type 0 loads NM00 = roster (Adventurer's Guild).
- Description: city sub-overlays load at $B600, dungeon ones at $BB00.

**F-09 — Dungeon level entry ($620E): map NM(A0+level) -> $F800; byte at map offset $412 ($FC12) selects tileset/text set NM05..NM08 -> $E000 (cached in $F8).**

**F-10 — Picture format (NM50-NM90, NMF0) fully decoded; renderer at $4000.**
- Source: tools/picture.py; extracted/pictures/*.png
- Evidence: all 66 files decode without error; contact sheet shows buildings/monsters/NPCs; animation frame counts plausible (e.g. NM74 14 frames).
- Description: see 03_formats.md "Picture". NM50-5D = city buildings by day, NM88-90 = the same buildings at night. NM5E-82 (monsters) duplicated on both disks byte-identically (trailing-length differences only).

**F-11 — Overlay files have sizes n*256-1 and the $BB00 group carries identical slack junk in the final sector; true content lengths are 100-470 bytes for most dungeon overlays.**
- Source: tools/slack.py
- Evidence: e.g. NM3F content $BB00-$BB66 (103 bytes), 408 bytes of shared junk; junk contains party pointer table fragment (00 CD 80 CD 00 CE) and text fragments ("AMPIRE", "ld man").
- Description: the junk is developer memory leftovers; false JSR/JMP targets ($2004, $2032, $1010, $1210) came from it. Must exclude slack when disassembling.

**F-12 — $BE95-$BFFF of the packed resident image contains leftover assembler symbol-table text (NOTEPTRTC, NUM ADR, SCNT, INC2, ADD, MLSR, DRAW, PIC, WAIT, WRITE, PRINT, JPL, JMI, JNE, JEQ, JCS, JCC).**
- Source: tools/strings_hi.py on main.mem
- Description: developer-tool residue packed along with the program (the $BB00-$BFFF region is overlay space at runtime, so this is never used). The macro names (DRAW/PIC/WAIT/WRITE/PRINT/Jxx) match the style of calls the overlays make.

**F-13 — Text encoding: ASCII with bit 7 set; $DC ('\') = newline/terminator, $00/$FF terminators, $AF ('/') begins a singular/plural suffix pair "sing\plur\" selected by $38.**
- Source: PRINT $0AC6, PRINT_CAPTION $0B7D; monster name table $8984+

**F-14 — Dungeon map format (NMA0-NMAF) fully decoded and rendered; the 16 levels are: Cellars(A0), Sewers x3 (A1-A3), Catacombs x3 (A4-A6), Castle x3 (A7-A9), Tower (AA = Kylearan's), The Tower x5 (AB-AF = Mangar's).**
- Source: tools/dungeonmap.py (docstring = spec), notes/maps_dump.txt, extracted/maps/*.png; derived from NM02 $AF27 (movement), $B2A1-$B512 (view builder), $B015-$B19A (specials)
- Evidence: rendered Cellars matches the known layout; in-game texts ("IRKM DESMET DAEM", Harkyn's castle...) decode; wall-type histogram shows only values 0..3.
- Description: 22x22 torus; coordinates (ns, ew), facing 0..3 = N,E,S,W; wall byte bits 1-0 N, 3-2 S, 5-4 E, 7-6 W. Flag grid + header coordinate lists at +$400 (see 03_formats.md). Special-event squares carry a type 16..31 that maps through the resident table $1B28 to overlays NM1F..NM2D. Level chain at +$400 lists sibling levels; exit-to-city coords at +$413. Slack after the strings contains Applesoft BASIC token text ("SET CONSTANTS FOR LOOP -- S9 IS SIZE OF EACH VOLUME; OH IS OVERHEAD AT START OF DRIVE") => the maps were produced on an Apple II host.

**F-15 — NM03 is the "Utilities" program (Start game / Copy characters / Make character disk) and NMF0 is a 13-page container of the six "resident" pictures ($8B,$8C,$8D,$8E,$57,$53) that NM03 copies to $D000-$DCFF under the I/O area.**
- Source: disasm/nm03.asm $AE00-$AE24; byte comparison NMF0 vs NM8B.. (all MATCH).
- Description: NM03 also embeds its own keyboard matrix + font + 1541 block commands ("#U1:13 0", "B-P 13 0", "N0:BT,") for the disk-duplication utility.

**F-16 — The whole game runs headlessly in my emulator (tools/run_game.py) with hooked KERNAL disk calls, a timer IRQ and injected keys; the static analysis is confirmed end-to-end.**
- Source: extracted/screens/*.png (boot prompt, Utilities, Guild, party listing, city 3D view with "Facing south", wine cellar walls, "OUCH!").
- Evidence: the loader requested exactly NM03, NMF0, NM09, NM04, NM1B, NM50, NM00/NM01 (roster search), NM02, NMA0, NM06 in the predicted order and at the predicted addresses; the party line shows the roster records (SAMSON Dead, EL CID 9998 HP, MARKUS 24/21...) decoded as in 03_formats.md; walking into cells whose wall bits I decoded as walls produces "OUCH!"; the stairs-up prompt fires at (0,0) where flag bit 0 is set.
- Description: needed hooks: $FDA3 (IOINIT), SETLFS/SETNAM/OPEN/LOAD/SAVE/CLOSE/CLRCHN/CLALL/READST/LISTEN/SECOND/CIOUT/UNLSN/TALK/TKSA/ACPTR/UNTALK, a $D000-$DFFF banking model (I/O visible when $01&7 in 5..7), IRQ = KERNAL-style push of A/X/Y + jump via $0314. Key injection = write hi-bit ASCII to $2A. View depth $D8 (0 = dark), $E0 level, $28/$29 position, $24 facing.

**F-17 — NM0A is Garth's shop stock: 256 bytes indexed by item id, count per item ($FF = unlimited), decremented on purchase / incremented on sale (NM0D $B7F0/$B874), saved with SAVE_FILE(2).**

**F-18 — Item table: 126 items; columns $A3F7 (type nibble + special-hit nibble), $A477 (class mask), $A4F7 (effect code), $A377 (AC bonus / damage class); names via little-endian pointer table at $AA09.** (notes/items.txt)

**F-19 — Spell table: 79 spells in a stream at $971F (level byte, class marker $F0-$F3 = Sorcerer/Conjurer/Magician/Wizard, 4-char mnemonics); parallel tables $95B7 cost, $9606 flags (bit3 combat-usable, bits0-2 target type), $987C handler pointers (24 distinct handlers).** (notes/spells.txt). Costs match the published BT1 values.

**F-20 — The deleted file on disk 2 is an earlier revision of NM02: its 2313 bytes align with NM02 $B216-$BB1F (offset +1046) with 262 differing bytes; its first four blocks were overwritten by later files.**

**F-21 — "bard intro /3532" is a standalone title demo ($4000-$B2FF): poem text ("The song I sing..."), credits "By Michael Cranford (c) 1985 Interplay Productions", own IRQ, SID music player ($4E3C..), own line-address table generation; it exits with JMP $FCE2 (reset). It shares no runtime with the game.**

**F-22 — Character sheet/party line semantics verified: "Hits" column = max HP ($30-31), "Cond" column = current HP ($32-33) or condition text; AC shown as 10-AC-ish signed value; class abbreviations from $A175.**

**F-23 — Copy-protection / crack residue: JT entry $083F -> $19C8 is a bare RTS called 34x from overlays (typical of a NOPed protection or sound hook); NM1B's "Leave the game" resets via a stub copied to $0800 (LDA #$37/STA $01/CLI/JMP ($FFFC)); the "/3532" tag is the cracker's.**
