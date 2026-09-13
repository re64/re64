# Retrospective notes: what would have helped organising this project

(Written while working; raw material for answering the user's later questions.)

## Pain points actually experienced
1. **Address identity crisis.** The same bytes have up to four "addresses": disk track/sector, file offset, PRG header address (wrong!), real load address, and (for pictures) a copy address under ROM. I repeatedly converted by hand (e.g. map offset $412 <-> $FC12, NM04 tail $F800 <-> file 0x1800). A single "location" type with automatic conversions between (image, T/S), (file, offset), (runtime addr, memory context) would have removed a whole class of slips.
2. **Memory context is not one thing.** "What is at $C000?" depends on which overlay/picture/roster is loaded, and on $01 banking. I built build_mem() late. A first-class notion of *memory configuration* (resident + set of loaded units + bank bits) that every disassembly/xref query takes as a parameter was needed from day one.
3. **Labels lived in several places**: labels_main.txt, per-overlay label files (never really created), comments in tool docstrings, findings notes. Renaming a routine (PRINT_MSG_ID -> SET_PIC_COLORS) required editing text in three places; the JT auto-labels were generated once and went stale. Want: one symbol database (addr, context, name, kind, confidence, evidence) from which listings, notes and tool constants are generated.
4. **Evidence tracking.** Findings notes list evidence in prose. Several times I had to re-derive *why* I believed something (e.g. bit order of wall bytes, HP max/cur). Each assertion should link to the exact instruction addresses / tool output that supports it, and to the assertions it depends on, so that a correction propagates (when I flipped N/S, three notes were affected).
5. **Open questions were scattered.** "6th 5-bit stat field?", "$20-21 meaning?", "$7F28 flag?", "$FC08 bytes?" are buried in prose. A queue of open questions per unit, with priority, would have let me pick cheap ones off when I was already in the relevant code.
6. **Slack / junk / stale copies.** A large fraction of "interesting strings" were stale copies (NM10 carrying NM0E text, NM16 carrying NM11, slack in $BB00 files, Applesoft in maps, symbol table in the packed image). I needed a way to mark byte ranges as "not content, explained by X" so they stop showing up in every scan. A range-annotation layer over each file (content / slack / duplicate-of / unknown) would have saved time and prevented the false-target scare ($2004 etc.).
7. **Tool output not persisted / reproducible.** Many ad-hoc python heredocs produced facts (e.g. JT usage counts) that only exist in this transcript. A "notebook" of named, re-runnable queries with cached results, referenced from findings, would have kept records consistent.
8. **Disassembler limitations.** No data-region typing (tables of pointers, coordinate lists, strings) inside listings; no cross-context labels (overlay listing could not label $FC12 as map field); self-modified operands (LDA #imm patched at runtime) made static reading misleading three times. Want: typed data directives, per-context label sets, and an "observed at runtime" annotation channel fed by the emulator (values seen at an address, dynamic call targets).
9. **Emulator as oracle came late.** Running the decruncher/pictures/game gave certainty cheaply. The ideal loop: static hypothesis -> emulator probe -> record as evidence. A harness for "run to routine X with state S and dump Y" plus a trace/xref feed back into the symbol DB would have been the single most valuable tool.
10. **Unit inventory drift.** The inventory (01_units.md) was written mid-way and hand-maintained; statuses went stale as soon as I learned more. Should be generated from the same DB as everything else.

## Data structures I wish I had
- Location = (container, path-within-container, offset) with converters to runtime address given a memory configuration.
- Unit = {id, kind, location(s), size, real address, dependencies, status, open questions, duplicates-of}.
- Assertion = {id, statement, subject unit/addresses, evidence links (tool run ids, instruction addresses, screenshots), depends-on assertions, confidence}.
- Symbol = {address, memory-context, name, kind, size/type, comment, assertion id}.
- RangeAnnotation = {location range, class: code/data/text/table/picture/slack/dup(of), format id}.
- ToolRun = {command, inputs (unit ids), outputs (files), summary} so notes can cite runs.

## Tools I wish I had (beyond what I built)
- A binary "region map" viewer over a memory configuration (what unit owns each byte, what type).
- Format description language (like Kaitai) so picture/map/record specs are executable and diff-able, instead of prose + Python.
- Automatic duplicate/near-duplicate detection across files (k-gram) run up-front (would have flagged NMF0, the $ED00 picture copies, the stale overlay tails, the orphan immediately).
- String scanner that knows the text encoding *and* string terminators, and reports "unreferenced strings" (found the dead $A100-$A2FF sheet strings only by accident).
- Runtime tracer producing: dynamic JSR/JMP targets, memory read/write heat maps per routine, first-seen values of interesting cells; merged into the static xref.
- Screenshot-diff harness for the emulated game (drives regression when the format tools are edited).
