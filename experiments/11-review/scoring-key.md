# Scoring key — what the reviewer had to find

Computed from the before-state before the run started, so whether each
was addressed is checkable in the after-state rather than a matter of
impression. **This is the first experiment here with a partial answer key.**

## 1. 73 addresses carry more than one name

Twenty of them, as a sample — the same thing, differently worded:

- `$0056` — playerState | cur_player
- `$0059` — waveSequencyRandom | RandomZoneModeFlag
- `$1000` — spriteBank0 | spriteSet0
- `$1800` — spriteBank1 | spriteSet1
- `$1D00` — typeSpawnTimer | objectAndSpriteVariables
- `$4000` — spriteBank2 | spriteSet2
- `$4800` — spriteSet3 | spriteBank3
- `$502F` — spriteSetSourceTable | charSetSourceTable
- `$511B` — txtBeastsRemaining | txtBeastsRemaining
- `$5199` — txtStandByYourBeast | txtStandByYourBeast
- `$51C0` — txtSuffixTwoA | txtSuffixTwoA
- `$52C2` — txtOptions | txtOptions
- `$52C9` — txtWaveSequency | txtWaveSequency
- `$52DE` — txtPlayers | txtPlayers
- `$52E8` — txtRandom | txtRandom
- `$533F` — txtDistanceBetweenZones | txtDistanceBetweenZones
- `$540C` — txtBeastsExtinct | txtBeastsExtinct
- `$5434` — txtSuffixTwoB | txtSuffixTwoB
- `$5474` — defaultHighScoreTable | defaultHighScoreTable
- `$55ED` — txtEnterYourName | txtEnterYourName

## 2. Claims that are true and explain nothing

- `$0000`  18431 bytes as `bitmap` — sprite_sheet_main
- `$6700`   8400 bytes as `record` — zoneTable
- `$6700`   8400 bytes as `data` — zoneDataTable
- `$97EE`   8209 bytes as `data` — reserved_9FEF_BFFF
- `$A000`   8192 bytes as `data` — underBasicRom
- `$2400`   7168 bytes as `bitmap` — residentSprites
- `$1000`   2048 bytes as `bitmap` — spriteBank0
- `$4000`   2048 bytes as `bitmap` — spriteBank2
- `$4800`   2048 bytes as `bitmap` — spriteBank3
- `$0801`   2047 bytes as `bitmap` — activeSpriteBank

## 3. The zone table, claimed twice over


## 3. The zone table, claimed twice over

- `zoneDataTable` — ? bytes as `-`
- `zone00` — ? bytes as `-`
- `zoneTable` — 8400 bytes as `record`, typeId `typ_jihlip`
- `zoneDataTable` — 8400 bytes as `data`

One run called it 8,400 bytes of data; another declared a 200-byte
`ZoneRecord` and claimed the same span as an array of it. Both stand, and
forty-two zone names sit inside as `text` — which is most of the 136
`claim.interpretationsDiffer` findings.

## 4. ZoneRecord itself

- 33 fields: {'u8': 32, 'char(40,screen)': 1}
- That is the eight-per-creature-type structure written one byte at a
  time. `u8[8]` is what it is, and **no type in this project uses an
  array**, so there is no example in the document to copy.

## 5. Known errors carried in from the runs

- Run 10 claimed the sprite sheet from `$0801`. Sprites are addressed in
  64-byte blocks from `$0800`, so it is off by one block.
- Run 9 read `$C023`/`$C046` as zone-transition code. They belong to a
  May 2021 patch neither run had placed — the `standalone` target has
  neither routine at all, which is checkable from inside the project.

## 6. Mechanisms with a shipped fix and no use yet

- `add_constant` — 18 constants exist, all from run 7. The two runs on
  the claims model declared none. Four idioms were added to its
  description since, and this is the first run that can test them.
- `add_evidence` — 630 supporting records exist and every one was minted
  by the import. Three deliberate calls exist in the project's history.
- `bind_primary_name` — never called by any run.
