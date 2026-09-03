/**
 * Klaus Dormann's functional test, run against the lifter and the interpreter.
 *
 * The acceptance bar, and the only check here that nobody involved in this
 * project wrote. Reading two references agree does not verify anything — both
 * published 6502 references get `ADC`'s flags wrong, in different ways — and
 * hand-written cases only test the cases somebody thought of. This program
 * tests the ones nobody thought of, and names the instruction when it fails.
 *
 * It found two real defects that every hand-written test here had passed:
 *
 * - `RETURN` discarded its address, so every `RTS` continued at the byte after
 *   itself rather than at its caller. Invisible until something actually
 *   returned.
 * - Signed overflow across a three-way add combined with `OR`. Both halves
 *   *can* overflow, and then they cancel: `$FF + $80 + 1` is `-128`, which is
 *   representable, so V is clear. Carry genuinely cannot happen twice, and the
 *   asymmetry is the trap.
 *
 * Opt-in twice over. The binary is fetched rather than committed, so its
 * absence skips rather than fails; and 26 million instructions take about
 * thirteen seconds, which does not belong in a suite that otherwise runs in
 * five. Run it with:
 *
 *     RE64_FUNCTIONAL_TEST=1 npx vitest run src/core/il/functional.test.ts
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { Machine } from "./interpret.js";
import { stepMachine } from "./run.js";
import { REG } from "./pcode.js";

const BINARY = "3party/6502-functional-tests/6502_functional_test.bin";

/** Where the test image is entered, per its own documentation. */
const ENTRY = 0x0400;

/**
 * The test's own progress counter.
 *
 * Written before each group runs, so it says how far the program got — which is
 * what makes a trap diagnosable instead of merely a stop.
 */
const TEST_CASE = 0x0200;

/**
 * Where decimal arithmetic starts being tested.
 *
 * `ADC` and `SBC` lift to binary regardless of `D`, so this is the boundary and
 * it is asserted rather than described: reaching it proves everything before it
 * passed, and stopping exactly there proves nothing else regressed into looking
 * like a decimal failure.
 */
const DECIMAL_TEST_CASE = 42;

/**
 * What the program writes when every group has passed.
 *
 * `LDA #$F0 / STA $0200 / JMP *` at the end of the suite. Reaching it is the
 * whole claim: 45 groups, 0 through 43, and this.
 */
const SUCCESS_TEST_CASE = 0xf0;

interface Outcome {
  /** Where it stopped, and why. */
  address: number;
  reason: "trap" | "unmodelled" | "undecodable" | "ran-out";
  steps: number;
  testCase: number;
  mnemonics: Set<string>;
}

function runFunctionalTest(limit: number): Outcome {
  const machine = new Machine();
  machine.memory.set(readFileSync(BINARY), 0);

  const mnemonics = new Set<string>();
  let address = ENTRY;
  let steps = 0;

  for (; steps < limit; steps++) {
    const step = stepMachine(machine, address);
    if (!step) {
      return { address, reason: "undecodable", steps, testCase: machine.memory[TEST_CASE], mnemonics };
    }
    mnemonics.add(step.instruction.mnemonic);

    if (step.flow.kind === "unmodelled") {
      return { address, reason: "unmodelled", steps, testCase: machine.memory[TEST_CASE], mnemonics };
    }
    // The program signals both failure and success by branching to itself.
    if (step.next === address) {
      return { address, reason: "trap", steps, testCase: machine.memory[TEST_CASE], mnemonics };
    }
    address = step.next;
  }

  return { address, reason: "ran-out", steps, testCase: machine.memory[TEST_CASE], mnemonics };
}

const enabled = process.env.RE64_FUNCTIONAL_TEST === "1" && existsSync(BINARY);

describe.skipIf(!enabled)("the 6502 functional test", () => {
  const outcome = enabled ? runFunctionalTest(40_000_000) : undefined!;

  it("runs the whole suite to its success marker", () => {
    // All 45 groups, against a program written by somebody else: arithmetic,
    // flags, every addressing mode, the stack, control flow, and — since
    // decimal was implemented — binary-coded arithmetic and the `D` flag
    // surviving `PHP`, `PLP` and `RTI`.
    //
    // It used to stop at group 42, the decimal section, which was the only
    // thing behind that wall: 43 is also decimal, and 240 is the marker the
    // program writes when everything has passed.
    expect(outcome.testCase).toBe(SUCCESS_TEST_CASE);
  });

  it("exercises every documented instruction on the way there", () => {
    // A pass that skipped instructions would be a pass about nothing. This is
    // what makes the boundary above mean "everything up to here", rather than
    // "the parts that happened to run".
    const documented = [
      "ADC", "AND", "ASL", "BCC", "BCS", "BEQ", "BIT", "BMI", "BNE", "BPL",
      "BRK", "BVC", "BVS", "CLC", "CLD", "CLI", "CLV", "CMP", "CPX", "CPY",
      "DEC", "DEX", "DEY", "EOR", "INC", "INX", "INY", "JMP", "JSR", "LDA",
      "LDX", "LDY", "LSR", "NOP", "ORA", "PHA", "PHP", "PLA", "PLP", "ROL",
      "ROR", "RTI", "RTS", "SBC", "SEC", "SED", "SEI", "STA", "STX", "STY",
      "TAX", "TAY", "TSX", "TXA", "TXS", "TYA",
    ];
    expect(documented.filter((m) => !outcome.mnemonics.has(m))).toEqual([]);
  });

  it("gets the sum decimal mode calls for", () => {
    // $99 + $99 + 1 is $99 carry 1 in BCD, and $33 carry 1 in binary. This used
    // to be the boundary — the model saying what it did not know, at the first
    // point it mattered. It now says the decimal answer.
    const machine = new Machine();
    machine.memory.set(readFileSync(BINARY), 0);
    machine.set({ space: "register", offset: REG.D, size: 1 }, 1);
    machine.set({ space: "register", offset: REG.C, size: 1 }, 1);
    machine.set({ space: "register", offset: REG.A, size: 1 }, 0x99);
    machine.memory[0x1000] = 0x99;
    machine.memory[0x2000] = 0x6d; // ADC $1000
    machine.memory[0x2001] = 0x00;
    machine.memory[0x2002] = 0x10;

    stepMachine(machine, 0x2000);
    expect(machine.register(REG.A)).toBe(0x99);
    expect(machine.register(REG.C)).toBe(1);
  });
});
