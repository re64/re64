# Third-party test material

Not part of re64. Kept here so the semantic model can be checked against
something nobody involved in it wrote.

## 6502_functional_test.bin

Klaus Dormann's functional test for the NMOS 6502, from
<https://github.com/Klaus2m5/6502_65C02_functional_tests> (GPL-3).

A 64KB memory image. Load it at `$0000`, start at `$0400`, and run. It computes
results, compares them against expected values, and traps — a branch to itself —
the moment anything differs. Success is reaching the documented end address; any
other trap names the instruction that is wrong.

It is here because reading two references agree does not check anything. Both
Ghidra's `6502.slaspec` and panopticon's `semantic.rs` get `ADC`'s flags wrong,
in different ways, and this program catches all of it.

Run against re64's interpreter, never linked into it, and excluded from the
default test run so a missing file cannot fail the build.
