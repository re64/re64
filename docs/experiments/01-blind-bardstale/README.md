# 1 — a blind investigation of The Bard's Tale

What information does an investigator need to keep when the tool does not tell
them how to organize it? This experiment starts with two C64 disk images and an
agent writing its own tools. Only after the investigation is frozen does a
second agent compare the resulting work with re64 and its proposed redesign.

The purpose is to discover requirements from actual work: where identities and
locations matter, which interpretations travel together, how corrections spread,
and what makes a finding's evidence recoverable. It is also a way to check which
existing re64 capabilities are worth carrying into the redesign. It is not a
benchmark of re64's MCP API: the blind investigator did not use re64.

| | |
|---|---|
| Material | Two 35-track D64 images of The Bard's Tale for the C64 |
| Run | September 13, 2026; one investigation followed by a separate audit |
| Investigator | Claude Code; the transcript identifies the model as Opus 5 |
| Tools | Investigator-written Python disk tools, disassembler, decoders, and partial emulator |
| Output | Unit inventory, 23 numbered findings, format/dependency notes, tools, and two conversation exports |

## Design

1. **Investigate without re64.** The initial brief asks the agent to analyze the
   disks as one project, as completely as practical, writing its own tools. It
   asks for software, data, loaders, overlays, runtime states, formats, and
   relationships; independent units and dependencies; reusable or duplicated
   knowledge; and findings with source, assertion, location, evidence, and
   description. It also asks the agent to retain enough records for a later
   discussion of tools and data structures. The brief names investigative
   concerns but supplies no re64 schema or expected findings.
2. **Reflect on the completed work.** Follow-up questions ask how knowledge was
   organized and what would have helped. Keep those retrospective suggestions
   distinguishable from tools the investigator actually wrote and difficulties
   visible in the record.
3. **Audit the frozen investigation first.** A separate agent is instructed to
   inspect only `bardstale/`: inputs, outputs, code, notes, and transcripts. It
   reconstructs the information-management requirements without reading either
   re64 checkout, using re64 terminology, or designing a replacement system.
4. **Compare semantics and behavior.** The auditor is then allowed to inspect
   both checkouts. It compares the observed requirements with implementation and
   design, distinguishing a differently named solution from a missing one. The
   follow-ups request a decision register, D1–D14, and an architecture input
   document separating requirements, existing strengths, defects, and hypotheses.

The staged instructions and responses are retained in the transcripts. The
reported isolation is part of the experiment's procedure, not an independently
verified claim about every source of model context. This is one investigation
of one game. It supplies no direct test of collaborative editing, CRDT behavior,
or article authoring, and its audit is not a fresh check of today's implementation.

## The two comparison snapshots

Both checkouts had unchanged tracked files when this archive was prepared. Their
Git histories and source trees are replaced here by exact commit references to
[`re64/re64`](https://github.com/re64/re64):

| Former directory | HEAD examined | Commit subject |
|---|---|---|
| `re64/` | [`f0c01436d991517dc494025d856f379d0c05a566`](https://github.com/re64/re64/tree/f0c01436d991517dc494025d856f379d0c05a566) | What a peer sends is checked before it becomes the document, and a refusal is said |
| `re64-redesign/` | [`4316c44583d3188a3bfa36f4089e32cbab020bed`](https://github.com/re64/re64/tree/4316c44583d3188a3bfa36f4089e32cbab020bed) | Describe the re64 architecture |

To inspect the same sources, check out these commits in separate directories
outside this archive. Branch names alone would select later work and change the
comparison. The implementation checkout also contained two untracked intermediate
audit exports; both are covered by the retained final audit transcript below.

## What to read

- [Investigation and retrospective questions](bardstale/01-investigation.txt): the original brief, investigation, follow-ups, and workspace inventory.
- [Staged audit, D1–D14, and architecture input](bardstale/02-comparative-audit.txt): the second agent's reconstruction, comparison, and recommendations.
- [Unit inventory](bardstale/notes/01_units.md), [findings](bardstale/notes/02_findings.md), [formats](bardstale/notes/03_formats.md), and [dependencies](bardstale/notes/04_dependencies.md): the structured record left by the investigator.
- [Work log](bardstale/notes/05_worklog.md) and [tooling reflections](bardstale/notes/06_retro_notes.md): corrections, dead ends, and reported friction.
- [Tools](bardstale/tools/), [resident labels](bardstale/notes/labels_main.txt), and [direct targets](bardstale/notes/direct_targets.txt): the machinery and analytical annotations actually used.
- [Subsequent retrospective](99-retrospective.txt): feedback informed by the experiment and later discussion, rather than the original brief or an adopted specification.
- [Current design register](../../03-design-register.md): the later disposition of these observations. D-numbers are historical references, not a development sequence.

The tools and notes preserve their historical interpretations. In particular,
`slack.py` classifies repeated tails, and `disov.py` truncates its listing input
using that classification. This is evidence of the original workflow, not a
rule that such bytes can be removed from the machine state. Likewise, the
audit's alleged stale “32 of 60” mapping is not established just by that count.
Consult the later register before treating an audit recommendation as a current
requirement. No analytical tools were changed or rerun during archiving.

## Transcript cleanup

The two retained exports preserve all conversation content from five earlier
exports. The only differing line was a terminal working-directory banner in the
first audit export. The surviving exports have shorter filenames; the
source-directory names inside them describe the original workspace. Model
terminology in the comparative audit has since been aligned with the current
documentation; its substantive discussion is unchanged.

| Removed export | Retained export containing its conversation |
|---|---|
| `bardstale/2026-09-13-012628-local-command-caveatcaveat-the-messages-below.txt` | `01-investigation.txt` |
| `bardstale/2026-09-13-015918-local-command-caveatcaveat-the-messages-below.txt` | `01-investigation.txt` |
| `bardstale/2026-09-13-021446-there-are-three-directories-here-bardstale-is-th.txt` | `02-comparative-audit.txt`; working-directory banner differed |
| `re64/2026-09-13-023443-there-are-three-directories-here-bardstale-is-th.txt` | `02-comparative-audit.txt` |
| `re64/2026-09-13-024808-there-are-three-directories-here-bardstale-is-th.txt` | `02-comparative-audit.txt` |

## Local material excluded from Git

The disk images and files predominantly reproducing game code, text, tables,
maps, or artwork are excluded by the repository's `.gitignore`. They remain
available in the local experiment, but a clone contains the descriptions below
instead. Original analytical notes and tool implementations remain in the
archive; references from those records to omitted files are
intentional. The inventory describes the archived files, not a corrected or
regenerated set of outputs.

The rules cover complete `extracted/` and `disasm/` directories, including small
companion metadata, and common game/media formats elsewhere in this experiment.
The six bulk text/table dumps in `notes/` are excluded explicitly. Restored
comparison checkouts and ordinary workstation/Python caches are also ignored.
Cache files carry no experimental evidence and are not included in the asset
inventory. New excluded artifacts need a description here when the experiment
is extended.

Reproducing the analysis requires separately supplied game inputs. The retained
tools describe extraction (`d64.py`), decrunching (`unpack_main.py`), overlay
placement (`btfiles.py`), disassembly, text decoding, maps, pictures, and a
headless run. Several table queries and screenshot compositions were ad-hoc;
their exact generating scripts were not all retained. Python and Pillow are
used, but the run did not preserve a complete dependency lock or one-command
reproduction recipe. The README does not substitute descriptions for the actual
inputs needed to rerun those tools.

### File inventory

Paths below are relative to `bardstale/`. Every excluded input or generated
artifact present at archiving has its own row; sizes describe the local files.

<details>
<summary>Original disk images — 2 files</summary>

| File | Bytes | Description |
|---|---:|---|
| `bardst-1.d64` | 174,848 | Original 35-track disk 1, labelled CITY DISK; directory files, allocation state, and unused sectors. |
| `bardst-2.d64` | 174,848 | Original 35-track disk 2, labelled BARDS TALE; includes the orphan sector chain investigated as a deleted overlay. |

</details>

<details>
<summary>disasm — 64 files</summary>

| File | Bytes | Description |
|---|---:|---|
| `disasm/intro.asm` | 169,039 | Generated listing of the unpacked introduction, reproducing instructions and data alongside analysis labels. |
| `disasm/main_linear.asm` | 970,807 | Linear listing of resident memory, including instruction readings and game data. |
| `disasm/main_traced.asm` | 442,489 | Resident-game listing produced by tracing selected entry points, with labels and data bytes. |
| `disasm/nm02.asm` | 41,479 | Generated listing of NM02: dungeon main-loop overlay; reflects the historical overlay tool's tail filtering. |
| `disasm/nm03.asm` | 30,610 | Generated listing of NM03: utilities overlay for starting play and character/disk operations; reflects the historical overlay tool's tail filtering. |
| `disasm/nm09.asm` | 22,333 | Generated listing of NM09: city main-loop overlay; reflects the historical overlay tool's tail filtering. |
| `disasm/nm0b.asm` | 23,158 | Generated listing of NM0B: Review Board (level up, spells, class change); reflects the historical overlay tool's tail filtering. |
| `disasm/nm0c.asm` | 15,017 | Generated listing of NM0C: Tavern (8 tavern names; wine cellar entrance); reflects the historical overlay tool's tail filtering. |
| `disasm/nm0d.asm` | 22,221 | Generated listing of NM0D: Garth's Equipment Shoppe; reflects the historical overlay tool's tail filtering. |
| `disasm/nm0e.asm` | 13,919 | Generated listing of NM0E: Temple (8 temple names, healing); reflects the historical overlay tool's tail filtering. |
| `disasm/nm0f.asm` | 2,519 | Generated listing of NM0F: empty building; reflects the historical overlay tool's tail filtering. |
| `disasm/nm10.asm` | 5,298 | Generated listing of NM10: '?' command: street name + time of day; reflects the historical overlay tool's tail filtering. |
| `disasm/nm11.asm` | 7,821 | Generated listing of NM11: Statue guardian gate; reflects the historical overlay tool's tail filtering. |
| `disasm/nm12.asm` | 4,202 | Generated listing of NM12: Iron gate (Mangar's; needs item $0F); reflects the historical overlay tool's tail filtering. |
| `disasm/nm13.asm` | 1,951 | Generated listing of NM13: Sewer portal; reflects the historical overlay tool's tail filtering. |
| `disasm/nm14.asm` | 3,856 | Generated listing of NM14: Temple of the Mad God; reflects the historical overlay tool's tail filtering. |
| `disasm/nm15.asm` | 2,010 | Generated listing of NM15: Harkyn's Castle entry; reflects the historical overlay tool's tail filtering. |
| `disasm/nm16.asm` | 10,993 | Generated listing of NM16: Interplay credits building; reflects the historical overlay tool's tail filtering. |
| `disasm/nm17.asm` | 7,482 | Generated listing of NM17: Roscoe's Energy Emporium; reflects the historical overlay tool's tail filtering. |
| `disasm/nm18.asm` | 2,421 | Generated listing of NM18: Kylearan's Amber Tower entry; reflects the historical overlay tool's tail filtering. |
| `disasm/nm19.asm` | 4,228 | Generated listing of NM19: Mangar's Tower entry; reflects the historical overlay tool's tail filtering. |
| `disasm/nm1a.asm` | 1,687 | Generated listing of NM1A: City gate (snow drift); reflects the historical overlay tool's tail filtering. |
| `disasm/nm1b.asm` | 27,479 | Generated listing of NM1B: Adventurer's Guild (roster/party mgmt, create char, save); reflects the historical overlay tool's tail filtering. |
| `disasm/nm1c.asm` | 10,695 | Generated listing of NM1C: Treasure chest (traps: POISON NEEDLE.. MINDTRAP); reflects the historical overlay tool's tail filtering. |
| `disasm/nm1d.asm` | 4,530 | Generated listing of NM1D: Trap triggered (flag $10); reflects the historical overlay tool's tail filtering. |
| `disasm/nm1e.asm` | 2,195 | Generated listing of NM1E: Wandering creature offers to join; reflects the historical overlay tool's tail filtering. |
| `disasm/nm1f.asm` | 1,079 | Generated listing of NM1F: Long stairs up; reflects the historical overlay tool's tail filtering. |
| `disasm/nm20.asm` | 2,057 | Generated listing of NM20: Spider statue (search); reflects the historical overlay tool's tail filtering. |
| `disasm/nm21.asm` | 1,792 | Generated listing of NM21: Light beam ray; reflects the historical overlay tool's tail filtering. |
| `disasm/nm22.asm` | 2,071 | Generated listing of NM22: Magic mouth: Tarjan lore; reflects the historical overlay tool's tail filtering. |
| `disasm/nm23.asm` | 1,909 | Generated listing of NM23: Bashar Kavilor fight; reflects the historical overlay tool's tail filtering. |
| `disasm/nm24.asm` | 1,671 | Generated listing of NM24: Sphynx dragon; reflects the historical overlay tool's tail filtering. |
| `disasm/nm25.asm` | 2,925 | Generated listing of NM25: King Aildrek / Witch King; reflects the historical overlay tool's tail filtering. |
| `disasm/nm26.asm` | 2,462 | Generated listing of NM26: Baron's throne; reflects the historical overlay tool's tail filtering. |
| `disasm/nm27.asm` | 1,828 | Generated listing of NM27: Captain of the Guard; reflects the historical overlay tool's tail filtering. |
| `disasm/nm28.asm` | 2,612 | Generated listing of NM28: Six robed warriors; reflects the historical overlay tool's tail filtering. |
| `disasm/nm29.asm` | 1,716 | Generated listing of NM29: Crystal sword; reflects the historical overlay tool's tail filtering. |
| `disasm/nm2a.asm` | 3,721 | Generated listing of NM2A: Riddle (Master Sorcerer); reflects the historical overlay tool's tail filtering. |
| `disasm/nm2b.asm` | 2,024 | Generated listing of NM2B: Silver square; reflects the historical overlay tool's tail filtering. |
| `disasm/nm2c.asm` | 3,573 | Generated listing of NM2C: Magic mouth riddle -> SHIELDS; reflects the historical overlay tool's tail filtering. |
| `disasm/nm2d.asm` | 2,950 | Generated listing of NM2D: Harkyn's legions; reflects the historical overlay tool's tail filtering. |
| `disasm/nm2e.asm` | 4,220 | Generated listing of NM2E: Old statue / Eye; reflects the historical overlay tool's tail filtering. |
| `disasm/nm2f.asm` | 3,852 | Generated listing of NM2F: Old man question (SKULL tavern); reflects the historical overlay tool's tail filtering. |
| `disasm/nm30.asm` | 1,588 | Generated listing of NM30: Mouth: "one of cold"; reflects the historical overlay tool's tail filtering. |
| `disasm/nm31.asm` | 2,209 | Generated listing of NM31: Mouth: SINISTER; reflects the historical overlay tool's tail filtering. |
| `disasm/nm32.asm` | 2,018 | Generated listing of NM32: Silver triangle; reflects the historical overlay tool's tail filtering. |
| `disasm/nm33.asm` | 2,593 | Generated listing of NM33: Crystal golem; reflects the historical overlay tool's tail filtering. |
| `disasm/nm34.asm` | 6,976 | Generated listing of NM34: Kylearan meeting (key); reflects the historical overlay tool's tail filtering. |
| `disasm/nm35.asm` | 1,567 | Generated listing of NM35: Mouth: perseverence; reflects the historical overlay tool's tail filtering. |
| `disasm/nm36.asm` | 3,324 | Generated listing of NM36: Mouth: CIRCLE -> silver circle; reflects the historical overlay tool's tail filtering. |
| `disasm/nm37.asm` | 6,780 | Generated listing of NM37: Keymaster (5OOOO gold); reflects the historical overlay tool's tail filtering. |
| `disasm/nm38.asm` | 2,833 | Generated listing of NM38: Seven words of the One God; reflects the historical overlay tool's tail filtering. |
| `disasm/nm39.asm` | 4,725 | Generated listing of NM39: Vampire Lord coffin; reflects the historical overlay tool's tail filtering. |
| `disasm/nm3a.asm` | 2,159 | Generated listing of NM3A: Sleeping dragons; reflects the historical overlay tool's tail filtering. |
| `disasm/nm3b.asm` | 2,466 | Generated listing of NM3B: THOR figurine; reflects the historical overlay tool's tail filtering. |
| `disasm/nm3c.asm` | 1,323 | Generated listing of NM3C: (code only); reflects the historical overlay tool's tail filtering. |
| `disasm/nm3d.asm` | 1,714 | Generated listing of NM3D: 3 geometric shapes; reflects the historical overlay tool's tail filtering. |
| `disasm/nm3e.asm` | 2,733 | Generated listing of NM3E: "What can bind..."; reflects the historical overlay tool's tail filtering. |
| `disasm/nm3f.asm` | 1,010 | Generated listing of NM3F: (code only, 103 bytes); reflects the historical overlay tool's tail filtering. |
| `disasm/nm40.asm` | 1,462 | Generated listing of NM40: Pool of boiling liquid; reflects the historical overlay tool's tail filtering. |
| `disasm/nm41.asm` | 1,553 | Generated listing of NM41: Mangar's treasure trove; reflects the historical overlay tool's tail filtering. |
| `disasm/nm42.asm` | 1,613 | Generated listing of NM42: Mouth: "Death to those..."; reflects the historical overlay tool's tail filtering. |
| `disasm/nm43.asm` | 1,166 | Generated listing of NM43: (code only); reflects the historical overlay tool's tail filtering. |
| `disasm/nm44.asm` | 7,753 | Generated listing of NM44: Mangar final battle + ending; reflects the historical overlay tool's tail filtering. |

</details>

<details>
<summary>extracted/d1 — 95 files</summary>

| File | Bytes | Description |
|---|---:|---|
| `extracted/d1/----------------.usr` | 0 | Empty separator entry extracted from disk 1; companion directory artifact, no payload bytes. |
| `extracted/d1/bard_intro__3532.prg` | 21,288 | Packed introduction/title program extracted from disk 1, including its PRG load header. |
| `extracted/d1/bard_s_tale_3532.prg` | 23,653 | Packed main game extracted from disk 1, including its PRG load header. |
| `extracted/d1/intro.mem` | 65,536 | Flat 64 KiB memory dump after unpacking the introduction in the partial emulator; not a complete device-state checkpoint. |
| `extracted/d1/intro.ranges` | 20 | Companion metadata listing introduction decruncher write ranges; retained locally with the dump. |
| `extracted/d1/intro_4000_B2FF.prg` | 29,442 | PRG export of the unpacked introduction range $4000–$B2FF. |
| `extracted/d1/intro_C000.prg` | 40 | PRG export of the introduction stub at $C000. |
| `extracted/d1/intro_unpacked.prg` | 28,460 | Unpacked introduction PRG artifact retained during decruncher investigation. |
| `extracted/d1/main.mem` | 65,536 | Flat 64 KiB memory dump after unpacking the resident game; source used by shared-memory queries and renderers. |
| `extracted/d1/main.ranges` | 20 | Companion metadata listing main-game decruncher write ranges; retained locally with the dump. |
| `extracted/d1/main_0800_CAFF.prg` | 49,922 | PRG export of the expanded resident game range $0800–$CAFF. |
| `extracted/d1/main_stage1.mem` | 65,536 | Flat 64 KiB memory dump at the intermediate decrunching stage, before final expansion. |
| `extracted/d1/main_unpacked.prg` | 33,730 | Intermediate unpacked main-program PRG artifact retained during decruncher investigation. |
| `extracted/d1/nm00.prg` | 2,050 | Disk 1 extraction of NM00: saved-character roster, first half; includes the file's PRG header. |
| `extracted/d1/nm01.prg` | 2,050 | Disk 1 extraction of NM01: saved-character roster, second half; includes the file's PRG header. |
| `extracted/d1/nm03.prg` | 3,329 | Disk 1 extraction of NM03: utilities overlay for starting play and character/disk operations; includes the file's PRG header. |
| `extracted/d1/nm04.prg` | 8,178 | Disk 1 extraction of NM04: city graphics and street/special-location grids; includes the file's PRG header. |
| `extracted/d1/nm09.prg` | 2,049 | Disk 1 extraction of NM09: city main-loop overlay; includes the file's PRG header. |
| `extracted/d1/nm0a.prg` | 258 | Disk 1 extraction of NM0A: shop stock-count table; includes the file's PRG header. |
| `extracted/d1/nm0b.prg` | 2,305 | Disk 1 extraction of NM0B: Review Board (level up, spells, class change); includes the file's PRG header. |
| `extracted/d1/nm0c.prg` | 1,793 | Disk 1 extraction of NM0C: Tavern (8 tavern names; wine cellar entrance); includes the file's PRG header. |
| `extracted/d1/nm0d.prg` | 2,049 | Disk 1 extraction of NM0D: Garth's Equipment Shoppe; includes the file's PRG header. |
| `extracted/d1/nm0e.prg` | 1,281 | Disk 1 extraction of NM0E: Temple (8 temple names, healing); includes the file's PRG header. |
| `extracted/d1/nm0f.prg` | 257 | Disk 1 extraction of NM0F: empty building; includes the file's PRG header. |
| `extracted/d1/nm10.prg` | 769 | Disk 1 extraction of NM10: '?' command: street name + time of day; includes the file's PRG header. |
| `extracted/d1/nm11.prg` | 1,025 | Disk 1 extraction of NM11: Statue guardian gate; includes the file's PRG header. |
| `extracted/d1/nm12.prg` | 513 | Disk 1 extraction of NM12: Iron gate (Mangar's; needs item $0F); includes the file's PRG header. |
| `extracted/d1/nm13.prg` | 257 | Disk 1 extraction of NM13: Sewer portal; includes the file's PRG header. |
| `extracted/d1/nm14.prg` | 513 | Disk 1 extraction of NM14: Temple of the Mad God; includes the file's PRG header. |
| `extracted/d1/nm15.prg` | 257 | Disk 1 extraction of NM15: Harkyn's Castle entry; includes the file's PRG header. |
| `extracted/d1/nm16.prg` | 1,787 | Disk 1 extraction of NM16: Interplay credits building; includes the file's PRG header. |
| `extracted/d1/nm17.prg` | 769 | Disk 1 extraction of NM17: Roscoe's Energy Emporium; includes the file's PRG header. |
| `extracted/d1/nm18.prg` | 257 | Disk 1 extraction of NM18: Kylearan's Amber Tower entry; includes the file's PRG header. |
| `extracted/d1/nm19.prg` | 513 | Disk 1 extraction of NM19: Mangar's Tower entry; includes the file's PRG header. |
| `extracted/d1/nm1a.prg` | 257 | Disk 1 extraction of NM1A: City gate (snow drift); includes the file's PRG header. |
| `extracted/d1/nm1b.prg` | 2,498 | Disk 1 extraction of NM1B: Adventurer's Guild (roster/party mgmt, create char, save); includes the file's PRG header. |
| `extracted/d1/nm50.prg` | 450 | Disk 1 extraction of NM50: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm51.prg` | 658 | Disk 1 extraction of NM51: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm52.prg` | 1,090 | Disk 1 extraction of NM52: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm53.prg` | 504 | Disk 1 extraction of NM53: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm54.prg` | 962 | Disk 1 extraction of NM54: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm55.prg` | 422 | Disk 1 extraction of NM55: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm56.prg` | 520 | Disk 1 extraction of NM56: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm57.prg` | 537 | Disk 1 extraction of NM57: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm58.prg` | 521 | Disk 1 extraction of NM58: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm59.prg` | 556 | Disk 1 extraction of NM59: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm5a.prg` | 504 | Disk 1 extraction of NM5A: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm5b.prg` | 502 | Disk 1 extraction of NM5B: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm5c.prg` | 454 | Disk 1 extraction of NM5C: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm5d.prg` | 536 | Disk 1 extraction of NM5D: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm5e.prg` | 528 | Disk 1 extraction of NM5E: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm5f.prg` | 430 | Disk 1 extraction of NM5F: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm60.prg` | 576 | Disk 1 extraction of NM60: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm61.prg` | 1,348 | Disk 1 extraction of NM61: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm62.prg` | 622 | Disk 1 extraction of NM62: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm63.prg` | 1,220 | Disk 1 extraction of NM63: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm64.prg` | 1,158 | Disk 1 extraction of NM64: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm65.prg` | 1,150 | Disk 1 extraction of NM65: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm66.prg` | 730 | Disk 1 extraction of NM66: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm67.prg` | 420 | Disk 1 extraction of NM67: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm68.prg` | 628 | Disk 1 extraction of NM68: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm69.prg` | 422 | Disk 1 extraction of NM69: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm6a.prg` | 484 | Disk 1 extraction of NM6A: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm6b.prg` | 470 | Disk 1 extraction of NM6B: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm6c.prg` | 413 | Disk 1 extraction of NM6C: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm6d.prg` | 527 | Disk 1 extraction of NM6D: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm6e.prg` | 461 | Disk 1 extraction of NM6E: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm6f.prg` | 616 | Disk 1 extraction of NM6F: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm70.prg` | 508 | Disk 1 extraction of NM70: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm71.prg` | 942 | Disk 1 extraction of NM71: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm72.prg` | 638 | Disk 1 extraction of NM72: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm74.prg` | 806 | Disk 1 extraction of NM74: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm75.prg` | 477 | Disk 1 extraction of NM75: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm76.prg` | 580 | Disk 1 extraction of NM76: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm7a.prg` | 530 | Disk 1 extraction of NM7A: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm7d.prg` | 674 | Disk 1 extraction of NM7D: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm7f.prg` | 662 | Disk 1 extraction of NM7F: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm80.prg` | 861 | Disk 1 extraction of NM80: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm81.prg` | 957 | Disk 1 extraction of NM81: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm82.prg` | 530 | Disk 1 extraction of NM82: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm83.prg` | 475 | Disk 1 extraction of NM83: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm84.prg` | 542 | Disk 1 extraction of NM84: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm85.prg` | 690 | Disk 1 extraction of NM85: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm86.prg` | 922 | Disk 1 extraction of NM86: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm87.prg` | 477 | Disk 1 extraction of NM87: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm88.prg` | 536 | Disk 1 extraction of NM88: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm89.prg` | 513 | Disk 1 extraction of NM89: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm8a.prg` | 557 | Disk 1 extraction of NM8A: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm8b.prg` | 486 | Disk 1 extraction of NM8B: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm8c.prg` | 469 | Disk 1 extraction of NM8C: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm8d.prg` | 446 | Disk 1 extraction of NM8D: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm8e.prg` | 474 | Disk 1 extraction of NM8E: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm8f.prg` | 468 | Disk 1 extraction of NM8F: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nm90.prg` | 576 | Disk 1 extraction of NM90: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d1/nmf0.prg` | 3,330 | Disk 1 extraction of NMF0: compressed picture/animation stream; includes the file's PRG header. |

</details>

<details>
<summary>extracted/d2 — 97 files</summary>

| File | Bytes | Description |
|---|---:|---|
| `extracted/d2/nm02.prg` | 3,329 | Disk 2 extraction of NM02: dungeon main-loop overlay; includes the file's PRG header. |
| `extracted/d2/nm05.prg` | 5,634 | Disk 2 extraction of NM05: dungeon drawing dataset 1, including wall graphics; includes the file's PRG header. |
| `extracted/d2/nm06.prg` | 5,634 | Disk 2 extraction of NM06: dungeon drawing dataset 2, including wall graphics; includes the file's PRG header. |
| `extracted/d2/nm07.prg` | 5,634 | Disk 2 extraction of NM07: dungeon drawing dataset 3, including wall graphics; includes the file's PRG header. |
| `extracted/d2/nm08.prg` | 5,634 | Disk 2 extraction of NM08: dungeon drawing dataset 4, including wall graphics; includes the file's PRG header. |
| `extracted/d2/nm1c.prg` | 1,025 | Disk 2 extraction of NM1C: Treasure chest (traps: POISON NEEDLE.. MINDTRAP); includes the file's PRG header. |
| `extracted/d2/nm1d.prg` | 513 | Disk 2 extraction of NM1D: Trap triggered (flag $10); includes the file's PRG header. |
| `extracted/d2/nm1e.prg` | 257 | Disk 2 extraction of NM1E: Wandering creature offers to join; includes the file's PRG header. |
| `extracted/d2/nm1f.prg` | 257 | Disk 2 extraction of NM1F: Long stairs up; includes the file's PRG header. |
| `extracted/d2/nm20.prg` | 257 | Disk 2 extraction of NM20: Spider statue (search); includes the file's PRG header. |
| `extracted/d2/nm21.prg` | 257 | Disk 2 extraction of NM21: Light beam ray; includes the file's PRG header. |
| `extracted/d2/nm22.prg` | 513 | Disk 2 extraction of NM22: Magic mouth: Tarjan lore; includes the file's PRG header. |
| `extracted/d2/nm23.prg` | 513 | Disk 2 extraction of NM23: Bashar Kavilor fight; includes the file's PRG header. |
| `extracted/d2/nm24.prg` | 257 | Disk 2 extraction of NM24: Sphynx dragon; includes the file's PRG header. |
| `extracted/d2/nm25.prg` | 513 | Disk 2 extraction of NM25: King Aildrek / Witch King; includes the file's PRG header. |
| `extracted/d2/nm26.prg` | 513 | Disk 2 extraction of NM26: Baron's throne; includes the file's PRG header. |
| `extracted/d2/nm27.prg` | 257 | Disk 2 extraction of NM27: Captain of the Guard; includes the file's PRG header. |
| `extracted/d2/nm28.prg` | 513 | Disk 2 extraction of NM28: Six robed warriors; includes the file's PRG header. |
| `extracted/d2/nm29.prg` | 257 | Disk 2 extraction of NM29: Crystal sword; includes the file's PRG header. |
| `extracted/d2/nm2a.prg` | 513 | Disk 2 extraction of NM2A: Riddle (Master Sorcerer); includes the file's PRG header. |
| `extracted/d2/nm2b.prg` | 257 | Disk 2 extraction of NM2B: Silver square; includes the file's PRG header. |
| `extracted/d2/nm2c.prg` | 513 | Disk 2 extraction of NM2C: Magic mouth riddle -> SHIELDS; includes the file's PRG header. |
| `extracted/d2/nm2d.prg` | 513 | Disk 2 extraction of NM2D: Harkyn's legions; includes the file's PRG header. |
| `extracted/d2/nm2e.prg` | 513 | Disk 2 extraction of NM2E: Old statue / Eye; includes the file's PRG header. |
| `extracted/d2/nm2f.prg` | 513 | Disk 2 extraction of NM2F: Old man question (SKULL tavern); includes the file's PRG header. |
| `extracted/d2/nm30.prg` | 257 | Disk 2 extraction of NM30: Mouth: "one of cold"; includes the file's PRG header. |
| `extracted/d2/nm31.prg` | 257 | Disk 2 extraction of NM31: Mouth: SINISTER; includes the file's PRG header. |
| `extracted/d2/nm32.prg` | 257 | Disk 2 extraction of NM32: Silver triangle; includes the file's PRG header. |
| `extracted/d2/nm33.prg` | 513 | Disk 2 extraction of NM33: Crystal golem; includes the file's PRG header. |
| `extracted/d2/nm34.prg` | 1,025 | Disk 2 extraction of NM34: Kylearan meeting (key); includes the file's PRG header. |
| `extracted/d2/nm35.prg` | 257 | Disk 2 extraction of NM35: Mouth: perseverence; includes the file's PRG header. |
| `extracted/d2/nm36.prg` | 513 | Disk 2 extraction of NM36: Mouth: CIRCLE -> silver circle; includes the file's PRG header. |
| `extracted/d2/nm37.prg` | 769 | Disk 2 extraction of NM37: Keymaster (5OOOO gold); includes the file's PRG header. |
| `extracted/d2/nm38.prg` | 513 | Disk 2 extraction of NM38: Seven words of the One God; includes the file's PRG header. |
| `extracted/d2/nm39.prg` | 769 | Disk 2 extraction of NM39: Vampire Lord coffin; includes the file's PRG header. |
| `extracted/d2/nm3a.prg` | 513 | Disk 2 extraction of NM3A: Sleeping dragons; includes the file's PRG header. |
| `extracted/d2/nm3b.prg` | 513 | Disk 2 extraction of NM3B: THOR figurine; includes the file's PRG header. |
| `extracted/d2/nm3c.prg` | 257 | Disk 2 extraction of NM3C: (code only); includes the file's PRG header. |
| `extracted/d2/nm3d.prg` | 257 | Disk 2 extraction of NM3D: 3 geometric shapes; includes the file's PRG header. |
| `extracted/d2/nm3e.prg` | 513 | Disk 2 extraction of NM3E: "What can bind..."; includes the file's PRG header. |
| `extracted/d2/nm3f.prg` | 513 | Disk 2 extraction of NM3F: (code only, 103 bytes); includes the file's PRG header. |
| `extracted/d2/nm40.prg` | 257 | Disk 2 extraction of NM40: Pool of boiling liquid; includes the file's PRG header. |
| `extracted/d2/nm41.prg` | 257 | Disk 2 extraction of NM41: Mangar's treasure trove; includes the file's PRG header. |
| `extracted/d2/nm42.prg` | 257 | Disk 2 extraction of NM42: Mouth: "Death to those..."; includes the file's PRG header. |
| `extracted/d2/nm43.prg` | 257 | Disk 2 extraction of NM43: (code only); includes the file's PRG header. |
| `extracted/d2/nm44.prg` | 1,025 | Disk 2 extraction of NM44: Mangar final battle + ending; includes the file's PRG header. |
| `extracted/d2/nm5e.prg` | 527 | Disk 2 extraction of NM5E: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm5f.prg` | 429 | Disk 2 extraction of NM5F: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm60.prg` | 576 | Disk 2 extraction of NM60: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm61.prg` | 1,346 | Disk 2 extraction of NM61: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm62.prg` | 621 | Disk 2 extraction of NM62: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm63.prg` | 1,218 | Disk 2 extraction of NM63: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm64.prg` | 1,156 | Disk 2 extraction of NM64: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm65.prg` | 1,148 | Disk 2 extraction of NM65: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm66.prg` | 730 | Disk 2 extraction of NM66: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm67.prg` | 418 | Disk 2 extraction of NM67: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm68.prg` | 627 | Disk 2 extraction of NM68: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm69.prg` | 421 | Disk 2 extraction of NM69: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm6a.prg` | 484 | Disk 2 extraction of NM6A: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm6b.prg` | 470 | Disk 2 extraction of NM6B: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm6c.prg` | 413 | Disk 2 extraction of NM6C: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm6d.prg` | 523 | Disk 2 extraction of NM6D: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm6e.prg` | 461 | Disk 2 extraction of NM6E: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm6f.prg` | 615 | Disk 2 extraction of NM6F: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm70.prg` | 507 | Disk 2 extraction of NM70: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm71.prg` | 940 | Disk 2 extraction of NM71: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm72.prg` | 637 | Disk 2 extraction of NM72: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm73.prg` | 392 | Disk 2 extraction of NM73: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm74.prg` | 804 | Disk 2 extraction of NM74: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm77.prg` | 981 | Disk 2 extraction of NM77: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm78.prg` | 738 | Disk 2 extraction of NM78: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm79.prg` | 1,064 | Disk 2 extraction of NM79: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm7b.prg` | 703 | Disk 2 extraction of NM7B: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm7c.prg` | 761 | Disk 2 extraction of NM7C: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm7d.prg` | 667 | Disk 2 extraction of NM7D: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm7e.prg` | 553 | Disk 2 extraction of NM7E: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm7f.prg` | 662 | Disk 2 extraction of NM7F: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm80.prg` | 861 | Disk 2 extraction of NM80: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm81.prg` | 957 | Disk 2 extraction of NM81: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nm82.prg` | 530 | Disk 2 extraction of NM82: compressed picture/animation stream; includes the file's PRG header. |
| `extracted/d2/nma0.prg` | 2,034 | Disk 2 extraction of NMA0: dungeon map: Cellars, recorded depth 0; includes the file's PRG header. |
| `extracted/d2/nma1.prg` | 2,034 | Disk 2 extraction of NMA1: dungeon map: Sewers, recorded depth 1; includes the file's PRG header. |
| `extracted/d2/nma2.prg` | 2,034 | Disk 2 extraction of NMA2: dungeon map: Sewers, recorded depth 1; includes the file's PRG header. |
| `extracted/d2/nma3.prg` | 2,034 | Disk 2 extraction of NMA3: dungeon map: Sewers, recorded depth 2; includes the file's PRG header. |
| `extracted/d2/nma4.prg` | 2,034 | Disk 2 extraction of NMA4: dungeon map: Catacombs, recorded depth 2; includes the file's PRG header. |
| `extracted/d2/nma5.prg` | 2,034 | Disk 2 extraction of NMA5: dungeon map: Catacombs, recorded depth 3; includes the file's PRG header. |
| `extracted/d2/nma6.prg` | 2,034 | Disk 2 extraction of NMA6: dungeon map: Catacombs, recorded depth 3; includes the file's PRG header. |
| `extracted/d2/nma7.prg` | 2,034 | Disk 2 extraction of NMA7: dungeon map:  Castle  , recorded depth 3; includes the file's PRG header. |
| `extracted/d2/nma8.prg` | 2,034 | Disk 2 extraction of NMA8: dungeon map:  Castle  , recorded depth 4; includes the file's PRG header. |
| `extracted/d2/nma9.prg` | 2,034 | Disk 2 extraction of NMA9: dungeon map:  Castle  , recorded depth 4; includes the file's PRG header. |
| `extracted/d2/nmaa.prg` | 2,034 | Disk 2 extraction of NMAA: dungeon map:   Tower  , recorded depth 5; includes the file's PRG header. |
| `extracted/d2/nmab.prg` | 2,034 | Disk 2 extraction of NMAB: dungeon map: The Tower, recorded depth 5; includes the file's PRG header. |
| `extracted/d2/nmac.prg` | 2,034 | Disk 2 extraction of NMAC: dungeon map: The Tower, recorded depth 6; includes the file's PRG header. |
| `extracted/d2/nmad.prg` | 2,034 | Disk 2 extraction of NMAD: dungeon map: The Tower, recorded depth 6; includes the file's PRG header. |
| `extracted/d2/nmae.prg` | 2,034 | Disk 2 extraction of NMAE: dungeon map: The Tower, recorded depth 7; includes the file's PRG header. |
| `extracted/d2/nmaf.prg` | 2,034 | Disk 2 extraction of NMAF: dungeon map: The Tower, recorded depth 7; includes the file's PRG header. |
| `extracted/d2/orphan_T6S7.bin` | 2,313 | Raw bytes recovered from the orphan chain starting at track 6, sector 7; compared with the NM02 overlay as a possible earlier revision. |

</details>

<details>
<summary>extracted/maps — 17 files</summary>

| File | Bytes | Description |
|---|---:|---|
| `extracted/maps/city.png` | 49,909 | Rendered city map from NM04, showing the decoded street and special-location grids. |
| `extracted/maps/nma0.png` | 7,734 | Rendered NMA0 dungeon map: Cellars, recorded depth 0, with decoded walls and location annotations. |
| `extracted/maps/nma1.png` | 11,952 | Rendered NMA1 dungeon map: Sewers, recorded depth 1, with decoded walls and location annotations. |
| `extracted/maps/nma2.png` | 10,664 | Rendered NMA2 dungeon map: Sewers, recorded depth 1, with decoded walls and location annotations. |
| `extracted/maps/nma3.png` | 11,401 | Rendered NMA3 dungeon map: Sewers, recorded depth 2, with decoded walls and location annotations. |
| `extracted/maps/nma4.png` | 9,913 | Rendered NMA4 dungeon map: Catacombs, recorded depth 2, with decoded walls and location annotations. |
| `extracted/maps/nma5.png` | 10,980 | Rendered NMA5 dungeon map: Catacombs, recorded depth 3, with decoded walls and location annotations. |
| `extracted/maps/nma6.png` | 12,006 | Rendered NMA6 dungeon map: Catacombs, recorded depth 3, with decoded walls and location annotations. |
| `extracted/maps/nma7.png` | 11,832 | Rendered NMA7 dungeon map:  Castle  , recorded depth 3, with decoded walls and location annotations. |
| `extracted/maps/nma8.png` | 11,480 | Rendered NMA8 dungeon map:  Castle  , recorded depth 4, with decoded walls and location annotations. |
| `extracted/maps/nma9.png` | 10,851 | Rendered NMA9 dungeon map:  Castle  , recorded depth 4, with decoded walls and location annotations. |
| `extracted/maps/nmaa.png` | 11,083 | Rendered NMAA dungeon map:   Tower  , recorded depth 5, with decoded walls and location annotations. |
| `extracted/maps/nmab.png` | 12,697 | Rendered NMAB dungeon map: The Tower, recorded depth 5, with decoded walls and location annotations. |
| `extracted/maps/nmac.png` | 12,122 | Rendered NMAC dungeon map: The Tower, recorded depth 6, with decoded walls and location annotations. |
| `extracted/maps/nmad.png` | 11,753 | Rendered NMAD dungeon map: The Tower, recorded depth 6, with decoded walls and location annotations. |
| `extracted/maps/nmae.png` | 10,124 | Rendered NMAE dungeon map: The Tower, recorded depth 7, with decoded walls and location annotations. |
| `extracted/maps/nmaf.png` | 12,578 | Rendered NMAF dungeon map: The Tower, recorded depth 7, with decoded walls and location annotations. |

</details>

<details>
<summary>extracted/pictures — 160 files</summary>

| File | Bytes | Description |
|---|---:|---|
| `extracted/pictures/contact_sheet.png` | 432,031 | Composite of decoded game pictures for visual comparison, labelled by file identifier. |
| `extracted/pictures/nm50_f0.png` | 2,405 | Decoded picture NM50, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm51_f0.png` | 2,831 | Decoded picture NM51, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm52_f0.png` | 2,475 | Decoded picture NM52, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm52_f1.png` | 2,480 | Decoded picture NM52, frame 1 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm52_f2.png` | 2,489 | Decoded picture NM52, frame 2 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm52_f3.png` | 2,472 | Decoded picture NM52, frame 3 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm52_f4.png` | 2,489 | Decoded picture NM52, frame 4 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm52_f5.png` | 2,480 | Decoded picture NM52, frame 5 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm53_f0.png` | 2,441 | Decoded picture NM53, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm54_f0.png` | 2,772 | Decoded picture NM54, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm54_f1.png` | 2,782 | Decoded picture NM54, frame 1 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm54_f2.png` | 2,749 | Decoded picture NM54, frame 2 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm54_f3.png` | 2,778 | Decoded picture NM54, frame 3 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm54_f4.png` | 2,756 | Decoded picture NM54, frame 4 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm54_f5.png` | 2,749 | Decoded picture NM54, frame 5 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm54_f6.png` | 2,782 | Decoded picture NM54, frame 6 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm54_f7.png` | 2,778 | Decoded picture NM54, frame 7 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm55_f0.png` | 2,453 | Decoded picture NM55, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm56_f0.png` | 2,537 | Decoded picture NM56, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm57_f0.png` | 2,532 | Decoded picture NM57, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm58_f0.png` | 2,261 | Decoded picture NM58, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm59_f0.png` | 2,576 | Decoded picture NM59, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm5a_f0.png` | 2,374 | Decoded picture NM5A, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm5b_f0.png` | 2,258 | Decoded picture NM5B, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm5c_f0.png` | 2,495 | Decoded picture NM5C, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm5d_f0.png` | 2,035 | Decoded picture NM5D, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm5e_f0.png` | 2,434 | Decoded picture NM5E, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm5f_f0.png` | 2,121 | Decoded picture NM5F, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm60_f0.png` | 2,367 | Decoded picture NM60, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm61_f0.png` | 2,458 | Decoded picture NM61, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm61_f1.png` | 2,481 | Decoded picture NM61, frame 1 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm61_f2.png` | 2,417 | Decoded picture NM61, frame 2 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm61_f3.png` | 2,404 | Decoded picture NM61, frame 3 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm61_f4.png` | 2,353 | Decoded picture NM61, frame 4 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm61_f5.png` | 2,333 | Decoded picture NM61, frame 5 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm61_f6.png` | 2,333 | Decoded picture NM61, frame 6 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm61_f7.png` | 2,352 | Decoded picture NM61, frame 7 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm61_f8.png` | 2,353 | Decoded picture NM61, frame 8 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm61_f9.png` | 2,417 | Decoded picture NM61, frame 9 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm62_f0.png` | 2,448 | Decoded picture NM62, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm62_f1.png` | 2,440 | Decoded picture NM62, frame 1 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm62_f2.png` | 2,422 | Decoded picture NM62, frame 2 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm62_f3.png` | 2,417 | Decoded picture NM62, frame 3 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm62_f4.png` | 2,422 | Decoded picture NM62, frame 4 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm62_f5.png` | 2,440 | Decoded picture NM62, frame 5 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm63_f0.png` | 1,766 | Decoded picture NM63, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm63_f1.png` | 1,786 | Decoded picture NM63, frame 1 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm63_f2.png` | 1,799 | Decoded picture NM63, frame 2 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm63_f3.png` | 1,787 | Decoded picture NM63, frame 3 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm63_f4.png` | 1,799 | Decoded picture NM63, frame 4 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm63_f5.png` | 1,786 | Decoded picture NM63, frame 5 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm64_f0.png` | 2,913 | Decoded picture NM64, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm64_f1.png` | 2,955 | Decoded picture NM64, frame 1 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm64_f2.png` | 2,967 | Decoded picture NM64, frame 2 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm64_f3.png` | 2,961 | Decoded picture NM64, frame 3 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm65_f0.png` | 2,727 | Decoded picture NM65, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm65_f1.png` | 2,723 | Decoded picture NM65, frame 1 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm65_f2.png` | 2,746 | Decoded picture NM65, frame 2 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm65_f3.png` | 2,730 | Decoded picture NM65, frame 3 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm65_f4.png` | 2,746 | Decoded picture NM65, frame 4 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm65_f5.png` | 2,723 | Decoded picture NM65, frame 5 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm66_f0.png` | 2,336 | Decoded picture NM66, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm66_f1.png` | 2,340 | Decoded picture NM66, frame 1 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm66_f2.png` | 2,329 | Decoded picture NM66, frame 2 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm66_f3.png` | 2,326 | Decoded picture NM66, frame 3 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm66_f4.png` | 2,329 | Decoded picture NM66, frame 4 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm66_f5.png` | 2,340 | Decoded picture NM66, frame 5 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm67_f0.png` | 1,766 | Decoded picture NM67, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm68_f0.png` | 2,497 | Decoded picture NM68, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm68_f1.png` | 2,496 | Decoded picture NM68, frame 1 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm68_f2.png` | 2,502 | Decoded picture NM68, frame 2 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm68_f3.png` | 2,496 | Decoded picture NM68, frame 3 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm69_f0.png` | 1,950 | Decoded picture NM69, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm6a_f0.png` | 2,021 | Decoded picture NM6A, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm6b_f0.png` | 2,463 | Decoded picture NM6B, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm6c_f0.png` | 2,155 | Decoded picture NM6C, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm6d_f0.png` | 2,437 | Decoded picture NM6D, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm6e_f0.png` | 2,268 | Decoded picture NM6E, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm6f_f0.png` | 2,715 | Decoded picture NM6F, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm70_f0.png` | 2,528 | Decoded picture NM70, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm71_f0.png` | 2,882 | Decoded picture NM71, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm71_f1.png` | 2,888 | Decoded picture NM71, frame 1 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm71_f2.png` | 2,885 | Decoded picture NM71, frame 2 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm71_f3.png` | 2,869 | Decoded picture NM71, frame 3 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm71_f4.png` | 2,885 | Decoded picture NM71, frame 4 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm71_f5.png` | 2,888 | Decoded picture NM71, frame 5 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm72_f0.png` | 2,679 | Decoded picture NM72, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm73_f0.png` | 2,218 | Decoded picture NM73, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm74_f0.png` | 2,913 | Decoded picture NM74, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm74_f1.png` | 2,910 | Decoded picture NM74, frame 1 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm74_f10.png` | 2,913 | Decoded picture NM74, frame 10 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm74_f11.png` | 2,910 | Decoded picture NM74, frame 11 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm74_f12.png` | 2,913 | Decoded picture NM74, frame 12 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm74_f13.png` | 2,926 | Decoded picture NM74, frame 13 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm74_f2.png` | 2,913 | Decoded picture NM74, frame 2 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm74_f3.png` | 2,908 | Decoded picture NM74, frame 3 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm74_f4.png` | 2,913 | Decoded picture NM74, frame 4 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm74_f5.png` | 2,912 | Decoded picture NM74, frame 5 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm74_f6.png` | 2,913 | Decoded picture NM74, frame 6 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm74_f7.png` | 2,928 | Decoded picture NM74, frame 7 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm74_f8.png` | 2,913 | Decoded picture NM74, frame 8 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm74_f9.png` | 2,912 | Decoded picture NM74, frame 9 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm75_f0.png` | 2,272 | Decoded picture NM75, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm76_f0.png` | 2,134 | Decoded picture NM76, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm77_f0.png` | 2,518 | Decoded picture NM77, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm77_f1.png` | 2,514 | Decoded picture NM77, frame 1 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm77_f2.png` | 2,501 | Decoded picture NM77, frame 2 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm77_f3.png` | 2,513 | Decoded picture NM77, frame 3 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm77_f4.png` | 2,501 | Decoded picture NM77, frame 4 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm77_f5.png` | 2,514 | Decoded picture NM77, frame 5 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm78_f0.png` | 1,999 | Decoded picture NM78, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm78_f1.png` | 1,990 | Decoded picture NM78, frame 1 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm78_f2.png` | 2,011 | Decoded picture NM78, frame 2 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm78_f3.png` | 2,033 | Decoded picture NM78, frame 3 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm78_f4.png` | 2,011 | Decoded picture NM78, frame 4 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm78_f5.png` | 1,990 | Decoded picture NM78, frame 5 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm79_f0.png` | 2,821 | Decoded picture NM79, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm79_f1.png` | 2,822 | Decoded picture NM79, frame 1 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm79_f2.png` | 2,835 | Decoded picture NM79, frame 2 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm79_f3.png` | 2,840 | Decoded picture NM79, frame 3 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm79_f4.png` | 2,829 | Decoded picture NM79, frame 4 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm79_f5.png` | 2,840 | Decoded picture NM79, frame 5 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm79_f6.png` | 2,835 | Decoded picture NM79, frame 6 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm79_f7.png` | 2,822 | Decoded picture NM79, frame 7 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm7a_f0.png` | 2,043 | Decoded picture NM7A, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm7b_f0.png` | 2,817 | Decoded picture NM7B, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm7c_f0.png` | 2,402 | Decoded picture NM7C, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm7d_f0.png` | 2,872 | Decoded picture NM7D, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm7e_f0.png` | 2,584 | Decoded picture NM7E, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm7f_f0.png` | 2,399 | Decoded picture NM7F, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm80_f0.png` | 2,098 | Decoded picture NM80, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm80_f1.png` | 2,109 | Decoded picture NM80, frame 1 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm80_f2.png` | 2,101 | Decoded picture NM80, frame 2 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm80_f3.png` | 2,109 | Decoded picture NM80, frame 3 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm81_f0.png` | 2,601 | Decoded picture NM81, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm81_f1.png` | 2,592 | Decoded picture NM81, frame 1 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm81_f2.png` | 2,582 | Decoded picture NM81, frame 2 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm81_f3.png` | 2,592 | Decoded picture NM81, frame 3 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm82_f0.png` | 2,759 | Decoded picture NM82, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm83_f0.png` | 2,722 | Decoded picture NM83, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm84_f0.png` | 2,443 | Decoded picture NM84, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm85_f0.png` | 2,212 | Decoded picture NM85, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm86_f0.png` | 2,491 | Decoded picture NM86, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm86_f1.png` | 2,510 | Decoded picture NM86, frame 1 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm86_f2.png` | 2,494 | Decoded picture NM86, frame 2 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm86_f3.png` | 2,492 | Decoded picture NM86, frame 3 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm86_f4.png` | 2,475 | Decoded picture NM86, frame 4 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm86_f5.png` | 2,494 | Decoded picture NM86, frame 5 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm87_f0.png` | 2,324 | Decoded picture NM87, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm88_f0.png` | 2,485 | Decoded picture NM88, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm89_f0.png` | 2,181 | Decoded picture NM89, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm8a_f0.png` | 2,454 | Decoded picture NM8A, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm8b_f0.png` | 2,206 | Decoded picture NM8B, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm8c_f0.png` | 2,141 | Decoded picture NM8C, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm8d_f0.png` | 2,396 | Decoded picture NM8D, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm8e_f0.png` | 1,795 | Decoded picture NM8E, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm8f_f0.png` | 2,253 | Decoded picture NM8F, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nm90_f0.png` | 2,133 | Decoded picture NM90, frame 0 (zero-based), rendered with the tool's associated palette. |
| `extracted/pictures/nmf0_f0.png` | 2,206 | Decoded picture NMF0, frame 0 (zero-based), rendered with the tool's associated palette. |

</details>

<details>
<summary>extracted/screens — 24 files</summary>

| File | Bytes | Description |
|---|---:|---|
| `extracted/screens/01_boot.png` | 5,531 | Boot/start screen, captured by the partial emulator with substituted disk I/O; description follows the capture name. |
| `extracted/screens/02_utilities.png` | 5,993 | Utilities menu, captured by the partial emulator with substituted disk I/O; description follows the capture name. |
| `extracted/screens/03_city.png` | 8,877 | Initial city view, captured by the partial emulator with substituted disk I/O; description follows the capture name. |
| `extracted/screens/04_party.png` | 10,080 | Party display, captured by the partial emulator with substituted disk I/O; description follows the capture name. |
| `extracted/screens/05_city.png` | 7,959 | City view after party setup, captured by the partial emulator with substituted disk I/O; description follows the capture name. |
| `extracted/screens/06_city_turned.png` | 7,608 | City view after turning, captured by the partial emulator with substituted disk I/O; description follows the capture name. |
| `extracted/screens/07_city_walk.png` | 7,216 | City view after walking, captured by the partial emulator with substituted disk I/O; description follows the capture name. |
| `extracted/screens/08_cellar.png` | 8,459 | First cellar view, captured by the partial emulator with substituted disk I/O; description follows the capture name. |
| `extracted/screens/09_cellar2.png` | 7,197 | Second cellar observation, captured by the partial emulator with substituted disk I/O; description follows the capture name. |
| `extracted/screens/10_cellar3.png` | 7,197 | Third cellar observation, captured by the partial emulator with substituted disk I/O; description follows the capture name. |
| `extracted/screens/11_where.png` | 7,197 | Location-query observation in the cellar sequence, captured by the partial emulator with substituted disk I/O; description follows the capture name. |
| `extracted/screens/12_cellar_lit.png` | 7,767 | Cellar view after lighting, captured by the partial emulator with substituted disk I/O; description follows the capture name. |
| `extracted/screens/13_cellar_fwd.png` | 7,767 | Cellar view after moving forward, captured by the partial emulator with substituted disk I/O; description follows the capture name. |
| `extracted/screens/14_cellar_fwd3.png` | 8,017 | Later forward-movement observation in the cellar, captured by the partial emulator with substituted disk I/O; description follows the capture name. |
| `extracted/screens/15_where.png` | 8,017 | Later location-query observation, captured by the partial emulator with substituted disk I/O; description follows the capture name. |
| `extracted/screens/16_north.png` | 6,305 | North-facing observation, captured by the partial emulator with substituted disk I/O; description follows the capture name. |
| `extracted/screens/17_north1.png` | 7,720 | First northward-movement observation, captured by the partial emulator with substituted disk I/O; description follows the capture name. |
| `extracted/screens/18_north3.png` | 7,968 | Later northward-movement observation, captured by the partial emulator with substituted disk I/O; description follows the capture name. |
| `extracted/screens/19_east.png` | 7,968 | East-facing observation, captured by the partial emulator with substituted disk I/O; description follows the capture name. |
| `extracted/screens/sheet1.png` | 17,888 | Screenshot composite 1 assembling game observations for visual inspection. |
| `extracted/screens/sheet2.png` | 202,226 | Screenshot composite 2 assembling game observations for visual inspection. |
| `extracted/screens/sheet3.png` | 175,045 | Screenshot composite 3 assembling game observations for visual inspection. |
| `extracted/screens/sheet4.png` | 208,776 | Screenshot composite 4 assembling game observations for visual inspection. |
| `extracted/screens/sheet5.png` | 187,799 | Screenshot composite 5 assembling game observations for visual inspection. |

</details>

<details>
<summary>notes — 6 files</summary>

| File | Bytes | Description |
|---|---:|---|
| `notes/items.txt` | 8,149 | Bulk decoded item catalogue with item identifiers, names, types, class masks, and associated table values. |
| `notes/maps_dump.txt` | 13,177 | Bulk dump of dungeon-map headers, locations, messages, encounter data, and wall statistics. |
| `notes/monster_names.txt` | 2,369 | Decoded monster-name table with identifiers, source addresses, and encoded singular/plural forms. |
| `notes/overlay_strings.txt` | 28,063 | Bulk high-bit text scan of code overlays, with addresses and terminators; includes possible false-positive strings. |
| `notes/spells.txt` | 4,998 | Bulk decoded spell table: mnemonics, classes, levels, costs, flags, data columns, and handler addresses. |
| `notes/strings_resident.txt` | 17,329 | Bulk high-bit text scan of resident memory, including game messages and possible false-positive strings. |

</details>

Input SHA-256 fingerprints identify the exact disks used without distributing them:

- `bardst-1.d64`: `145f6a4b54b974ff3b65309601bd45cc020b11cdb33df344d213dd0610c49667`
- `bardst-2.d64`: `a9340f466075b3513b2e006f8d4c921e77196b15cc377a49ab52dbe70e587526`
