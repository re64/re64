import { describe, it, expect } from "vitest";
import { runProgram } from "./program.js";
import { MemoryMap } from "../memory/memory-map.js";
import { BytesLayer } from "../memory/layer.js";

const mapOf = (start: number, bytes: number[]) => {
  const map = new MemoryMap();
  map.addLayer(new BytesLayer("test", start, new Uint8Array(bytes)));
  return map;
};

describe("running a whole program", () => {
  it("follows code the program wrote and jumped to", () => {
    // The rule that had to change, found by running the real thing. A loader
    // relocates itself and jumps to the copy, so "stop where no layer supplies
    // a byte" stops at the program's own code — on Revenge of the Mutant Camels
    // that was $0100 after 1,258 of the 1,768,853 instructions that matter.
    //
    // $0800: LDA #$60 / STA $0300   — write an RTS into unmapped memory
    //        JMP $0300              — and run it
    const run = runProgram(mapOf(0x0800, [0xa9, 0x60, 0x8d, 0x00, 0x03, 0x4c, 0x00, 0x03]), {
      from: 0x0800,
    });

    // Reaching $0300 and executing the RTS there means relocation was followed.
    expect(run.instructions).toBeGreaterThan(3);
    expect(run.wrote.some((w) => w.start === "$0300")).toBe(true);
  });

  it("stops where nothing supplied a byte and nothing wrote one", () => {
    // $0800: JMP $FFBA — a KERNAL call, which is how a loader signals it is done
    const run = runProgram(mapOf(0x0800, [0x4c, 0xba, 0xff]), { from: 0x0800 });
    expect(run.reason).toBe("left the program");
    expect(run.stoppedAt).toBe("$FFBA");
  });

  it("stops at an address the caller names", () => {
    // NOP NOP NOP RTS, stopping on the third byte.
    const run = runProgram(mapOf(0x0800, [0xea, 0xea, 0xea, 0x60]), {
      from: 0x0800,
      stopAt: 0x0802,
    });
    expect(run.reason).toBe("reached the stop address");
    expect(run.instructions).toBe(2);
  });

  it("says when it ran out of budget rather than finishing", () => {
    // $0800: JMP $0800 — forever.
    const run = runProgram(mapOf(0x0800, [0x4c, 0x00, 0x08]), {
      from: 0x0800,
      maxInstructions: 500,
    });
    expect(run.reason).toBe("budget");
    expect(run.instructions).toBe(500);
  });

  it("stops on an instruction it cannot model rather than guessing", () => {
    // $02 is an undocumented opcode; the lifter emits CALLOTHER for it.
    const run = runProgram(mapOf(0x0800, [0x02]), { from: 0x0800 });
    expect(run.reason).toBe("unmodelled instruction");
    expect(run.detail).toContain("$0800");
  });

  it("reports hardware it touched, since it does not emulate any", () => {
    // LDA #$01 / STA $D020 — a border colour write, which this cannot honour.
    const run = runProgram(mapOf(0x0800, [0xa9, 0x01, 0x8d, 0x20, 0xd0, 0x4c, 0xba, 0xff]), {
      from: 0x0800,
    });
    expect(run.ioTouched).toContain("$D020");
  });

  it("sees the layer stack through its z-order, so a target's view is what runs", () => {
    const map = new MemoryMap();
    map.addLayer(new BytesLayer("under", 0x0800, new Uint8Array([0x4c, 0xba, 0xff])));
    // Shadowing it: an RTS-into-nowhere instead, at the same address.
    map.addLayer(new BytesLayer("over", 0x0800, new Uint8Array([0x4c, 0x34, 0x12])));

    expect(runProgram(map, { from: 0x0800 }).stoppedAt).toBe("$1234");
  });
});
