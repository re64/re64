# Unit inventory

Status: **D**=fully decoded (tool exists), **P**=partially understood, **I**=identified only, **?**=unknown.
"Indep." = can be understood on its own; "Needs" = knowledge required to interpret it.

## A. Containers
| Unit | Status | Indep. | Needs | Notes |
|---|---|---|---|---|
| U-D64-1 bardst-1.d64 "CITY DISK" | D | yes | D64 layout | tools/d64.py |
| U-D64-2 bardst-2.d64 "BARDS TALE" | D | yes | D64 layout | orphan chain T6S7 |
| U-ORPHAN deleted 10-block file (disk 2) | D | partly | NM02 | earlier revision of NM02, aligns with $B216-$BB1F (+1046), 262 bytes differ |
| U-SLACK-BB00 shared junk in $BB00 overlays' last sector | I | yes | — | tools/slack.py; contains party ptr table + text residue |
| U-SLACK-MAP Applesoft BASIC text in map slack | I | yes | — | dev-host residue |
| U-SYMTAB assembler symbol residue $BE95-$BFFF in packed main | I | yes | — | macro names DRAW/PIC/PRINT/Jxx |

## B. Programs
| Unit | Status | Indep. | Needs | Notes |
|---|---|---|---|---|
| U-PACK packer stage1 (LZ bitstream @ $0100) | D (by emulation) | yes | 6502 | tools/unpack_main.py |
| U-PACK2 packer stage2 (RLE $9F) | D | yes | 6502 | same |
| U-MAIN resident program $0800-$CAFF | P (runs in emulator) | no | everything below | disasm/main_traced.asm, labels_main.txt; tools/run_game.py |
| U-MAIN-JT jump table $0800 (70 entries) | D | yes | — | resident API; usage stats in worklog |
| U-MAIN-INIT $C000 screen init, $08D2 game init | D | yes | VIC | |
| U-MAIN-TEXT PRINT/PUTCHAR/NEWLINE/CAPTION/CLEAR ($09E0-$0BFF,$1E60-$1F5F) | D | yes | text encoding | font at $164E-$18xx (resident), line table $C900 |
| U-MAIN-KEYS IRQ $1BC7, KEYSCAN $1CC6, GETKEY $1955, DELAY $1A7A | D | yes | CIA | key matrix tbl $1D68/$1DF0/$1E30 |
| U-MAIN-LOADER $78B9-$7C3F | D | yes | KERNAL | file# -> "NMxx", page table |
| U-MAIN-ROSTER $0C0B-$0D25 | D | yes | record fmt | list/find/free-slot over NM00+NM01 |
| U-MAIN-PIC SHOW_PICTURE $0D26, DRAW_PICTURE $4000 | D | yes | picture fmt | resident pics under ROM |
| U-MAIN-3D drawing primitives $4207 (image blit), $1F60, $713F compass | P | no | dataset fmt | |
| U-MAIN-COMBAT $4207?-$6xxx (combat, spells, damage msgs) | P | no | monster/spell tables | strings $8366-$93F3 |
| U-MAIN-PARTY $71DC-$72F3 (regen, item checks) | P | no | record fmt | |
| U-MAIN-DATA strings/tables $7CBA-$ADFF | P | partly | — | see D. |
| U-INTRO "bard intro /3532" unpacked $4000-$B2FF + $C000 stub | P | yes | 6502 | standalone title demo: poem, credits, SID player $4E3C, exits via reset (disasm/intro.asm) |
| U-NM03 Utilities (start/copy chars/make disk) $AE00 | D(purpose) | yes | JT | own font+keymatrix+1541 cmds |
| U-NM09 City main loop $AE00 | P | no | NM04 grids, JT | key handling, special dispatch |
| U-NM02 Dungeon main loop $AE00 | P (specials D) | no | map fmt, JT | view builder, specials |

## C. Sub-overlays (city, $B600) — special type -> file
| type | file | purpose |
|---|---|---|
| 0 | NM00 | (roster load; used by Guild code) |
| 1 | NM1B | Adventurer's Guild (roster/party mgmt, create char, save) |
| 2 | NM0C | Tavern (8 tavern names; wine cellar entrance) |
| 3 | NM0D | Garth's Equipment Shoppe |
| 4 | NM0E | Temple (8 temple names, healing) |
| 5 | NM0B | Review Board (level up, spells, class change) |
| 6 | — | enter dungeon (SET_MODE 1) |
| 7 | NM0F | empty building |
| 8 | NM10 | '?' command: street name + time of day |
| 12 | NM11 | Statue guardian gate |
| 13 | NM12 | Iron gate (Mangar's; needs item $0F) |
| 14 | NM14 | Temple of the Mad God |
| 15 | NM13 | Sewer portal |
| 16(->$22) | NM16 | Interplay credits building |
| 17(->$24) | NM17 | Roscoe's Energy Emporium |
| 18(->$23) | NM18 | Kylearan's Amber Tower entry |
| 19(->$17) | NM15 | Harkyn's Castle entry |
| 20(->$2A) | NM19 | Mangar's Tower entry |
| 21(->$3B) | NM1A | City gate (snow drift) |

## D. Sub-overlays (dungeon, $BB00) — map special type (via $1B28) -> file
| type | file | purpose |
|---|---|---|
| 9 | NM1C | Treasure chest (traps: POISON NEEDLE.. MINDTRAP) |
| 10 | NM1D | Trap triggered (flag $10) |
| 11 | NM1E | Wandering creature offers to join |
| 16 | NM1F | Long stairs up |
| 17 | NM20 | Spider statue (search) |
| 18 | NM21 | Light beam ray |
| 19 | NM22 | Magic mouth: Tarjan lore |
| 20 | NM23 | Bashar Kavilor fight |
| 21 | NM24 | Sphynx dragon |
| 22 | NM25 | King Aildrek / Witch King |
| 23(->$15) | NM15 | (castle entry, shared with city) |
| 24 | NM26 | Baron's throne |
| 25 | NM27 | Captain of the Guard |
| 26 | NM28 | Six robed warriors |
| 27 | NM29 | Crystal sword |
| 28 | NM2A | Riddle (Master Sorcerer) |
| 29 | NM2B | Silver square |
| 30 | NM2C | Magic mouth riddle -> SHIELDS |
| 31 | NM2D | Harkyn's legions |
| 32 | NM2E | Old statue / Eye |
| 33 | NM2F | Old man question (SKULL tavern) |
| 34(->$16) | NM16 | credits (shared) |
| 35(->$18) | NM18 | (shared) |
| 36(->$17) | NM17 | (shared) |
| 37 | NM30 | Mouth: "one of cold" |
| 38 | NM31 | Mouth: SINISTER |
| 39 | NM32 | Silver triangle |
| 40 | NM33 | Crystal golem |
| 41 | NM34 | Kylearan meeting (key) |
| 42(->$19) | NM19 | (shared) |
| 43 | NM35 | Mouth: perseverence |
| 44 | NM36 | Mouth: CIRCLE -> silver circle |
| 45 | NM37 | Keymaster (5OOOO gold) |
| 46 | NM38 | Seven words of the One God |
| 47 | NM39 | Vampire Lord coffin |
| 48 | NM3A | Sleeping dragons |
| 49 | NM3B | THOR figurine |
| 50 | NM3C | (code only) |
| 51 | NM3D | 3 geometric shapes |
| 52 | NM3E | "What can bind..." |
| 53 | NM3F | (code only, 103 bytes) |
| 54 | NM40 | Pool of boiling liquid |
| 55 | NM41 | Mangar's treasure trove |
| 56 | NM42 | Mouth: "Death to those..." |
| 57 | NM43 | (code only) |
| 58 | NM44 | Mangar final battle + ending |
| 59(->$1A) | NM1A | (shared) |

## E. Data files
| Unit | Status | Notes |
|---|---|---|
| NM00, NM01 roster halves | D | 16x128 records; layout in 03_formats.md; XOR checksum |
| NM0A 256-byte Garth's stock | D | count per item id, $FF unlimited (NM0D) |
| NM04 city set $E000 | P | 20 facade images ($E000 ptrs), $F700 bit-reverse tbl, $F800 30x30 special grid, $FC00 30x30 street grid; pics $5A-$5D at $ED00 |
| NM05-08 dungeon sets | P | 80 draw-record ptrs; wall images; pics $5A-$5D at $ED00 |
| NMA0-AF maps | D | tools/dungeonmap.py |
| NM50-90, NMF0 pictures | D | tools/picture.py |

## F. In-resident data tables (addresses)
| Table | Addr | Status |
|---|---|---|
| attack verbs | $88B7 | I |
| monster names (sing/plural) | ptrs $8D0D, 128 ids | D (notes/monster_names.txt) |
| spells: stream $971F, cost $95B7, flags $9606, handlers $987C | 79 spells | D (notes/spells.txt) |
| spell damage verbs | $93F4 | I |
| class names/abbrevs, race names | $A11E-$A1B6 | I |
| items: names via $AA09, cols $A3F7/$A477/$A4F7/$A377 | 126 items | D (notes/items.txt) |
| experience thresholds | $A703 base/class, $A70D 13/class | I |
| monster stats | $7D28,$7DA8,$7E28,$7EA8 (+$7CBB/$7CC3 encounter) | P |
| picture colour bytes | $0D99 (SET_PIC_COLORS $456E) | D |
| status/condition strings | $A5D0 + $A5F3[cond] | I |
