#!/usr/bin/env python3
"""Run the packed main program's two-stage decruncher in the emulator.
Stage 1: bitstream LZ at $0100 -> image at $07F0-$8BAF, then JMP $0810.
Stage 2: move image up to $7C00+, RLE (esc $9F) into final places, JMP $C000.
Outputs a full 64K memory image and a list of written ranges after each stage.
"""
import sys, os; sys.path.insert(0, os.path.dirname(__file__))
from emu6502 import CPU, load_prg

def ranges(written):
    out = []; start = None
    for a in range(65537):
        w = a < 65536 and written[a]
        if w and start is None: start = a
        if not w and start is not None: out.append((start, a - 1)); start = None
    return out

def unpack(path, outprefix, final_pc=0xC000):
    cpu = CPU()
    s, e = load_prg(cpu, path)
    cpu.mem[0x01] = 0x37
    cpu.pc = 0x080B
    written = bytearray(65536)
    def wr(a, v):
        a &= 0xFFFF; written[a] = 1; cpu.mem[a] = v & 0xFF
    cpu.wr = wr
    # stage 1 ends at PC=$0810 (second visit)
    def stop1(c):
        return c.pc == 0x0810 and c.mem[0x0810] == 0x78  # SEI = new code arrived
    r = cpu.run(max_steps=50_000_000, stop_fn=stop1)
    print(f"stage1: {r} PC={cpu.pc:04X} steps={cpu.cycles}")
    print("  written:", ', '.join(f"${a:04X}-${b:04X}" for a, b in ranges(written) if b - a > 4))
    stage1 = bytes(cpu.mem)
    written = bytearray(65536)
    r = cpu.run(max_steps=50_000_000, stop_pc=final_pc)
    print(f"stage2: {r} PC={cpu.pc:04X} steps={cpu.cycles} $01={cpu.mem[1]:02X}")
    rs = [(a, b) for a, b in ranges(written) if b - a > 4]
    print("  written:", ', '.join(f"${a:04X}-${b:04X}" for a, b in rs))
    open(outprefix + '.mem', 'wb').write(bytes(cpu.mem))
    with open(outprefix + '.ranges', 'w') as f:
        for a, b in rs: f.write(f"{a:04X} {b:04X}\n")
    return cpu, rs

if __name__ == '__main__':
    unpack(sys.argv[1], sys.argv[2])
