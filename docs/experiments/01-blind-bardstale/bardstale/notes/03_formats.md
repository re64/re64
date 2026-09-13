# Formats

## Memory map (runtime, $01=$35: RAM everywhere except I/O at $D000)
| Range | Content |
|---|---|
| $0000-$00FF | zero page vars (see labels_main.txt) |
| $0100-$01FF | stack |
| $0400-$07FF | screen RAM = colour nibbles for MC bitmap |
| $0800-$08D1 | resident JMP table (70 entries) |
| $08D2-$1FAD | resident core (init, text, keys, loader glue, IRQ) |
| $2000-$3FFF | bitmap (picture window cols 0-14 lines 5-101; text window cols 21-38 lines 24-119) |
| $4000-$7CB9 | resident game logic (picture draw $4000, 3D view, combat, spells, party mgmt, disk I/O $78B9+) |
| $7CBA-$ADFF | resident data (tables, strings; monster names $8984+, spells $9720+, items $A78E+) |
| $AE00-$BAFF | main-mode overlay: NM09 city / NM02 dungeon / NM03 mode2 |
| $B600-$BFFF | city sub-overlays NM0B-NM1B (overlaps main overlay tail? NM09 ends $B5FE so OK) |
| $BB00-$C7FF | dungeon sub-overlays NM1C-NM44 (<= $BEFE); NMF0 picture $BB00-$C7FF |
| $C000-$C7FF | PICBUF: picture files / roster NM00,NM01 / NM0A |
| $C900-$CAFF | bitmap line address table lo/hi (200 entries each) |
| $CB00-$CEFF | party: slot0 $CB00, members 1-6 at $CB80+$80*(n-1) (128-byte character records); zeroed at init |
| $D000-$DCFF | (RAM under I/O) resident copies of pictures $8B,$8C,$8D,$8E,$57,$53 |
| $E000-$FFEF | NM04 city data (8176 b) or NM05-08 dungeon set (5632 b); $ED00-$F5FF also holds pictures $5A-$5D |
| $F800-$FFEF | NMA0-AF current dungeon map (2032 b); $FC12 = tileset id |

## Text
- chars = ASCII | $80. `$DC` newline (also ends PRINT), `$00`/`$FF` end. `$A0` space triggers word-wrap check.
- `$AF` '/' : plural marker. "Dwar/f\ves\" -> singular "Dwarf", plural "Dwarves" (flag $38).
- PRINT window: cols 21..39, rows 3..14; row 15 scrolls. Caption: row 14, cols 1..13 centered.

## Picture (NM50..NM90, NMF0) — see tools/picture.py docstring
- Loaded at $C000. `E1 E2 body [delay] {E1 E2 body delay}...`
- body written column-major into bitmap lines 8..93 (43 even lines then 43 odd lines), byte columns 2..11.
- `E1 n v` = n+3 copies of v; `E2 x y` = seek (x=line idx, y=col idx*4+8); `E2 x FF` = end of frame.
- delay 0 after first frame = static. Later frames are deltas; delay 0 => read another delay and loop from start.
- Colours from screen RAM $55 (green/green) + colour RAM 1 (white) + bg black in the picture window per $C000 init.

## Character record (128 bytes; NM00/NM01 hold 16 each; party copies at $CB80+$80*(n-1); scratch $CF00, creation $C800)
Sources: VIEW_CHAR $124F, stats unpack $43A6, status line $104E, creation NM1B $B7A0-$B8B3, regen $71DC, combat menu $5170.
| off | meaning |
|---|---|
| 00-0F | name, $FF padded. First char '*' ($AA) => PARTY record: 6 member names at $10,$20,..,$60 |
| 10-13 | 6 x 5-bit packed stats: St, IQ, Dx, Cn, Lk, (6th unknown). unpack: v0=b0>>3, v1=((b0<<2)|(b1>>6))&1F, v2=b1&1F, same for b2/b3 |
| 14-1F | experience, 12 unpacked decimal digits (MSD first) |
| 20-21 | word BE, init 1 (probably level for review / max level) |
| 22-23 | level (BE word) |
| 24-2F | gold, 12 decimal digits |
| 30-31 | max HP (BE) |
| 32-33 | current HP (BE) |
| 34-35 | max SP (BE) |
| 36-37 | current SP (BE) |
| 38 | class 0..9: Wa Wi So Co Ma Ro Ba Pa Hu Mo |
| 39 | race 0..6: Human Elf Dwarf Hobbit Half-Elf Half-Orc Gnome |
| 3A-3D | ? |
| 3E | condition: 0 OK, else index into strings at $A5D0 (3 = dead) |
| 3F | ? (AC?) |
| 40-43 | spell levels: Sorcerer?, Conjurer($41), Magician($42), Wizard? |
| 44-46 | rogue skills (init $14 each) |
| 48 | hunter (init 5); 49 bard (init 1); 4F bard current tune |
| 50-5F | 8 item slots: byte0 flags (bit7 unidentified, low nibble 1=equipped 2=class can't use), byte1 item id (0 empty) |
| 60-7E | unused / leftovers |
| 7F | XOR checksum of bytes 00-7E (verified: 26/32 roster records match; mismatching ones are hand-edited) |
Numbers: 12-digit decimal accumulator at $0380; $0DCA bin->dec, $0ED4 16-bit->digits, $0E1E add, $0E4E sub, $0E01 cmp, $0E7D print.

## Monster table (128 monsters, id 0..127; column arrays in resident)
| addr | content |
|---|---|
| $8D0D + 2*id | name pointer (lo,hi) -> "Sing/sfx\plural-sfx\" ($AF marks suffix pair) |
| $7D28 + id | bits0-2 group size class (-> mask $7CE1), bits4-7 HP dice class |
| $7DA8 + id | bits0-4 armour class; bits 4-7 HP base |
| $7E28 + id | bits0-4 level (to-hit); other bits flags |
| $7EA8 + id | picture index (file NM50+idx) |
| $7F28 + pic | per-picture flag |
| $7CBB/$7CC3 + depth | random encounter: id = (rnd & mask) + base |
| $88B7.. | attack verbs; $8984.. attack-effect suffixes |
Encounter state: $03B0+g monster id of group g (0..3), $03B8+g count, $8330.. group status.

## Item table (126 items, id 1..126)
| addr | content |
|---|---|
| $AA09 + 2*id | name pointer (lo,hi) |
| $A3F7 + id | low nibble type (0 Item,1 Weapon,2 Shield,3 Armor,4 Helm,5 Gloves,6 Instrument,7 Figurine,8 Ring,9 Wand,10 Misc); high nibble special hit effect (drain/wither/stone/critical) |
| $A477 + id | class-usable bitmask (bit chosen per class via $A5FC[class]) |
| $A4F7 + id | effect: 01 HP regen, 02 SP regen, $0A-$0F quest flags, $B0/$B1 light, $B2-$BE summon figurine, ($90..$A7)&$7F>=$10 -> spell via $9577[] |
| $A377 + id | AC bonus (armour) / damage class (weapons, high nibble) |
| $A577 + $A5C5[t] | type names |
See notes/items.txt.

## City data (NM04 at $E000)
| addr | content |
|---|---|
| $E000-$E027 | 20 pointers to facade images |
| $E028-$ECFF | facade images |
| $ED00-$F5FF | pictures $5A,$5B,$5C,$5D (resident copies) |
| $F600-$F6FF | ? small graphics |
| $F700-$F7FF | 2-bit-pixel reversal table (mirroring) |
| $F800-$FB83 | 30x30 special grid, row = 29-ns (north first), col = ew. cell = (special_type<<3) | facade. specials via $1B28 (city variant: >=16 remapped through NM09 $AEEE) |
| $FC00-$FF83 | 30x30 street grid: same but street cells hold street-name id (0x0c Main?, 0x0d, ...) |
Guild at ns=15, ew=24 (exit places party at 15,25 facing east). Dungeon exits (from maps): Cellars (5,28), Catacombs (15,18), Castle (24,4), Kylearan (27,27), Mangar (2,2).


## Loader address rule
see tools/btfiles.py

## Overlay file
- PRG header = real address - $8000 ($AE00/$B600/$BB00 groups) or - $D000 ($E000 group); $C000/$F800 groups have real header.
- size n*256-1; $BB00 group ends with shared junk (tools/slack.py gives true lengths).
