# Bard's Tale (C64) — bardst-1.d64 / bardst-2.d64 analysis

Layout of this workspace:
- `tools/`      my own tools (d64.py, dis6502.py, emu6502.py, unpack_main.py, asmrange.py, ...)
- `extracted/`  files pulled out of the images (d1/, d2/), unpacked memory images
- `disasm/`     disassembly listings
- `notes/`      findings, unit inventory, dependency graph, format specs, work log

Notes files:
- `01_units.md`        inventory of every unit (files, memory regions, formats) with status
- `02_findings.md`     major findings: source / assertion / location / evidence / description
- `03_formats.md`      byte-level format specs
- `04_dependencies.md` what depends on what, what is reusable, duplicated knowledge
- `05_worklog.md`      chronological log incl. dead ends and tool needs (for the retrospective)
- `06_retro_notes.md`  running notes on "what tools/data structures would have helped"
