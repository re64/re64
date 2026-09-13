#!/usr/bin/env python3
"""Minimal 6502 emulator (official opcodes + a few common illegal NOPs).
Flat 64K memory. Hooks: read/write callbacks by address; step limit; breakpoints.
"""
import sys

class CPU:
    def __init__(self):
        self.mem = bytearray(65536)
        self.a = self.x = self.y = 0
        self.sp = 0xFF
        self.pc = 0
        self.n = self.v = self.d = self.i = self.z = self.c = 0
        self.b = 0
        self.cycles = 0
        self.trace = False
        self.read_hooks = {}
        self.write_hooks = {}
        self.jsr_hooks = {}   # addr -> fn(cpu) ; if returns True, emulate RTS
        self.watch_writes = None  # set of addresses to report

    # memory
    def rd(self, a):
        a &= 0xFFFF
        if a in self.read_hooks: return self.read_hooks[a](self, a)
        return self.mem[a]
    def wr(self, a, v):
        a &= 0xFFFF; v &= 0xFF
        if a in self.write_hooks: self.write_hooks[a](self, a, v); return
        self.mem[a] = v
    def rd16(self, a): return self.rd(a) | (self.rd(a+1) << 8)
    def push(self, v): self.wr(0x100 + self.sp, v); self.sp = (self.sp - 1) & 0xFF
    def pop(self): self.sp = (self.sp + 1) & 0xFF; return self.rd(0x100 + self.sp)
    def flags(self):
        return (self.n<<7)|(self.v<<6)|0x20|(self.b<<4)|(self.d<<3)|(self.i<<2)|(self.z<<1)|self.c
    def set_flags(self, p):
        self.n=(p>>7)&1; self.v=(p>>6)&1; self.d=(p>>3)&1; self.i=(p>>2)&1; self.z=(p>>1)&1; self.c=p&1
    def nz(self, v):
        v &= 0xFF; self.n = v >> 7; self.z = 1 if v == 0 else 0; return v

    def load(self, data, addr):
        self.mem[addr:addr+len(data)] = data

    def step(self):
        pc = self.pc
        op = self.rd(pc)
        self.pc = (pc + 1) & 0xFFFF
        if self.trace:
            print(f"{pc:04X} {op:02X} A={self.a:02X} X={self.x:02X} Y={self.y:02X} SP={self.sp:02X} P={self.flags():02X}")
        self.cycles += 1
        m = self
        def imm():
            v = m.rd(m.pc); m.pc = (m.pc+1)&0xFFFF; return v
        def zp(): return imm()
        def zpx(): return (imm() + m.x) & 0xFF
        def zpy(): return (imm() + m.y) & 0xFF
        def ab():
            v = m.rd16(m.pc); m.pc = (m.pc+2)&0xFFFF; return v
        def abx(): return (ab() + m.x) & 0xFFFF
        def aby(): return (ab() + m.y) & 0xFFFF
        def izx():
            z = zpx(); return m.rd(z) | (m.rd((z+1)&0xFF) << 8)
        def izy():
            z = zp(); return ((m.rd(z) | (m.rd((z+1)&0xFF) << 8)) + m.y) & 0xFFFF
        def rel():
            o = imm(); return (m.pc + ((o ^ 0x80) - 0x80)) & 0xFFFF
        def branch(cond):
            t = rel()
            if cond: m.pc = t
        def adc(v):
            if m.d:
                # decimal mode
                lo = (m.a & 0x0F) + (v & 0x0F) + m.c
                hi = (m.a >> 4) + (v >> 4)
                if lo > 9: lo += 6; hi += 1
                r = (hi << 4) | (lo & 0x0F)
                m.z = 1 if ((m.a + v + m.c) & 0xFF) == 0 else 0
                m.n = (r >> 7) & 1
                m.v = ((m.a ^ r) & (v ^ r) & 0x80) >> 7
                if hi > 9: r += 0x60
                m.c = 1 if r > 0xFF else 0
                m.a = r & 0xFF
            else:
                r = m.a + v + m.c
                m.v = (~(m.a ^ v) & (m.a ^ r) & 0x80) >> 7
                m.c = 1 if r > 0xFF else 0
                m.a = m.nz(r)
        def sbc(v):
            if m.d:
                r = m.a - v - (1 - m.c)
                lo = (m.a & 0x0F) - (v & 0x0F) - (1 - m.c)
                hi = (m.a >> 4) - (v >> 4)
                if lo < 0: lo -= 6; hi -= 1
                if hi < 0: hi -= 6
                m.nz(r & 0xFF)
                m.v = ((m.a ^ v) & (m.a ^ r) & 0x80) >> 7
                m.c = 0 if r < 0 else 1
                m.a = ((hi << 4) | (lo & 0x0F)) & 0xFF
            else:
                v ^= 0xFF
                r = m.a + v + m.c
                m.v = (~(m.a ^ v) & (m.a ^ r) & 0x80) >> 7
                m.c = 1 if r > 0xFF else 0
                m.a = m.nz(r)
        def cmp(r, v):
            d = r - v; m.c = 1 if d >= 0 else 0; m.nz(d & 0xFF)
        def asl(v): m.c = v >> 7; return m.nz((v << 1) & 0xFF)
        def lsr(v): m.c = v & 1; return m.nz(v >> 1)
        def rol(v): c = m.c; m.c = v >> 7; return m.nz(((v << 1) | c) & 0xFF)
        def ror(v): c = m.c; m.c = v & 1; return m.nz((v >> 1) | (c << 7))
        def rmw(addr, f): m.wr(addr, f(m.rd(addr)))

        # dispatch
        if op == 0x00:  # BRK
            m.pc = (m.pc + 1) & 0xFFFF
            m.push(m.pc >> 8); m.push(m.pc & 0xFF); m.b = 1; m.push(m.flags()); m.b = 0; m.i = 1
            m.pc = m.rd16(0xFFFE)
        elif op == 0x01: m.a = m.nz(m.a | m.rd(izx()))
        elif op == 0x05: m.a = m.nz(m.a | m.rd(zp()))
        elif op == 0x06: rmw(zp(), asl)
        elif op == 0x08: m.b = 1; m.push(m.flags()); m.b = 0
        elif op == 0x09: m.a = m.nz(m.a | imm())
        elif op == 0x0A: m.a = asl(m.a)
        elif op == 0x0D: m.a = m.nz(m.a | m.rd(ab()))
        elif op == 0x0E: rmw(ab(), asl)
        elif op == 0x10: branch(not m.n)
        elif op == 0x11: m.a = m.nz(m.a | m.rd(izy()))
        elif op == 0x15: m.a = m.nz(m.a | m.rd(zpx()))
        elif op == 0x16: rmw(zpx(), asl)
        elif op == 0x18: m.c = 0
        elif op == 0x19: m.a = m.nz(m.a | m.rd(aby()))
        elif op == 0x1D: m.a = m.nz(m.a | m.rd(abx()))
        elif op == 0x1E: rmw(abx(), asl)
        elif op == 0x20:
            t = ab(); r = (m.pc - 1) & 0xFFFF
            if t in m.jsr_hooks:
                if m.jsr_hooks[t](m): return
            m.push(r >> 8); m.push(r & 0xFF); m.pc = t
        elif op == 0x21: m.a = m.nz(m.a & m.rd(izx()))
        elif op == 0x24: v = m.rd(zp()); m.z = 1 if (m.a & v) == 0 else 0; m.n = v >> 7; m.v = (v >> 6) & 1
        elif op == 0x25: m.a = m.nz(m.a & m.rd(zp()))
        elif op == 0x26: rmw(zp(), rol)
        elif op == 0x28: m.set_flags(m.pop())
        elif op == 0x29: m.a = m.nz(m.a & imm())
        elif op == 0x2A: m.a = rol(m.a)
        elif op == 0x2C: v = m.rd(ab()); m.z = 1 if (m.a & v) == 0 else 0; m.n = v >> 7; m.v = (v >> 6) & 1
        elif op == 0x2D: m.a = m.nz(m.a & m.rd(ab()))
        elif op == 0x2E: rmw(ab(), rol)
        elif op == 0x30: branch(m.n)
        elif op == 0x31: m.a = m.nz(m.a & m.rd(izy()))
        elif op == 0x35: m.a = m.nz(m.a & m.rd(zpx()))
        elif op == 0x36: rmw(zpx(), rol)
        elif op == 0x38: m.c = 1
        elif op == 0x39: m.a = m.nz(m.a & m.rd(aby()))
        elif op == 0x3D: m.a = m.nz(m.a & m.rd(abx()))
        elif op == 0x3E: rmw(abx(), rol)
        elif op == 0x40: m.set_flags(m.pop()); lo = m.pop(); m.pc = lo | (m.pop() << 8)
        elif op == 0x41: m.a = m.nz(m.a ^ m.rd(izx()))
        elif op == 0x45: m.a = m.nz(m.a ^ m.rd(zp()))
        elif op == 0x46: rmw(zp(), lsr)
        elif op == 0x48: m.push(m.a)
        elif op == 0x49: m.a = m.nz(m.a ^ imm())
        elif op == 0x4A: m.a = lsr(m.a)
        elif op == 0x4C:
            t = ab()
            if t in m.jsr_hooks and m.jsr_hooks[t](m):
                lo = m.pop(); m.pc = ((lo | (m.pop() << 8)) + 1) & 0xFFFF   # hooked tail-call: behave like JSR+RTS
            else: m.pc = t
        elif op == 0x4D: m.a = m.nz(m.a ^ m.rd(ab()))
        elif op == 0x4E: rmw(ab(), lsr)
        elif op == 0x50: branch(not m.v)
        elif op == 0x51: m.a = m.nz(m.a ^ m.rd(izy()))
        elif op == 0x55: m.a = m.nz(m.a ^ m.rd(zpx()))
        elif op == 0x56: rmw(zpx(), lsr)
        elif op == 0x58: m.i = 0
        elif op == 0x59: m.a = m.nz(m.a ^ m.rd(aby()))
        elif op == 0x5D: m.a = m.nz(m.a ^ m.rd(abx()))
        elif op == 0x5E: rmw(abx(), lsr)
        elif op == 0x60: lo = m.pop(); m.pc = ((lo | (m.pop() << 8)) + 1) & 0xFFFF
        elif op == 0x61: adc(m.rd(izx()))
        elif op == 0x65: adc(m.rd(zp()))
        elif op == 0x66: rmw(zp(), ror)
        elif op == 0x68: m.a = m.nz(m.pop())
        elif op == 0x69: adc(imm())
        elif op == 0x6A: m.a = ror(m.a)
        elif op == 0x6C:
            t = ab(); lo = m.rd(t); hi = m.rd((t & 0xFF00) | ((t + 1) & 0xFF)); m.pc = lo | (hi << 8)
        elif op == 0x6D: adc(m.rd(ab()))
        elif op == 0x6E: rmw(ab(), ror)
        elif op == 0x70: branch(m.v)
        elif op == 0x71: adc(m.rd(izy()))
        elif op == 0x75: adc(m.rd(zpx()))
        elif op == 0x76: rmw(zpx(), ror)
        elif op == 0x78: m.i = 1
        elif op == 0x79: adc(m.rd(aby()))
        elif op == 0x7D: adc(m.rd(abx()))
        elif op == 0x7E: rmw(abx(), ror)
        elif op == 0x81: m.wr(izx(), m.a)
        elif op == 0x84: m.wr(zp(), m.y)
        elif op == 0x85: m.wr(zp(), m.a)
        elif op == 0x86: m.wr(zp(), m.x)
        elif op == 0x88: m.y = m.nz(m.y - 1)
        elif op == 0x8A: m.a = m.nz(m.x)
        elif op == 0x8C: m.wr(ab(), m.y)
        elif op == 0x8D: m.wr(ab(), m.a)
        elif op == 0x8E: m.wr(ab(), m.x)
        elif op == 0x90: branch(not m.c)
        elif op == 0x91: m.wr(izy(), m.a)
        elif op == 0x94: m.wr(zpx(), m.y)
        elif op == 0x95: m.wr(zpx(), m.a)
        elif op == 0x96: m.wr(zpy(), m.x)
        elif op == 0x98: m.a = m.nz(m.y)
        elif op == 0x99: m.wr(aby(), m.a)
        elif op == 0x9A: m.sp = m.x
        elif op == 0x9D: m.wr(abx(), m.a)
        elif op == 0xA0: m.y = m.nz(imm())
        elif op == 0xA1: m.a = m.nz(m.rd(izx()))
        elif op == 0xA2: m.x = m.nz(imm())
        elif op == 0xA4: m.y = m.nz(m.rd(zp()))
        elif op == 0xA5: m.a = m.nz(m.rd(zp()))
        elif op == 0xA6: m.x = m.nz(m.rd(zp()))
        elif op == 0xA8: m.y = m.nz(m.a)
        elif op == 0xA9: m.a = m.nz(imm())
        elif op == 0xAA: m.x = m.nz(m.a)
        elif op == 0xAC: m.y = m.nz(m.rd(ab()))
        elif op == 0xAD: m.a = m.nz(m.rd(ab()))
        elif op == 0xAE: m.x = m.nz(m.rd(ab()))
        elif op == 0xB0: branch(m.c)
        elif op == 0xB1: m.a = m.nz(m.rd(izy()))
        elif op == 0xB4: m.y = m.nz(m.rd(zpx()))
        elif op == 0xB5: m.a = m.nz(m.rd(zpx()))
        elif op == 0xB6: m.x = m.nz(m.rd(zpy()))
        elif op == 0xB8: m.v = 0
        elif op == 0xB9: m.a = m.nz(m.rd(aby()))
        elif op == 0xBA: m.x = m.nz(m.sp)
        elif op == 0xBC: m.y = m.nz(m.rd(abx()))
        elif op == 0xBD: m.a = m.nz(m.rd(abx()))
        elif op == 0xBE: m.x = m.nz(m.rd(aby()))
        elif op == 0xC0: cmp(m.y, imm())
        elif op == 0xC1: cmp(m.a, m.rd(izx()))
        elif op == 0xC4: cmp(m.y, m.rd(zp()))
        elif op == 0xC5: cmp(m.a, m.rd(zp()))
        elif op == 0xC6: rmw(zp(), lambda v: m.nz(v - 1))
        elif op == 0xC8: m.y = m.nz(m.y + 1)
        elif op == 0xC9: cmp(m.a, imm())
        elif op == 0xCA: m.x = m.nz(m.x - 1)
        elif op == 0xCC: cmp(m.y, m.rd(ab()))
        elif op == 0xCD: cmp(m.a, m.rd(ab()))
        elif op == 0xCE: rmw(ab(), lambda v: m.nz(v - 1))
        elif op == 0xD0: branch(not m.z)
        elif op == 0xD1: cmp(m.a, m.rd(izy()))
        elif op == 0xD5: cmp(m.a, m.rd(zpx()))
        elif op == 0xD6: rmw(zpx(), lambda v: m.nz(v - 1))
        elif op == 0xD8: m.d = 0
        elif op == 0xD9: cmp(m.a, m.rd(aby()))
        elif op == 0xDD: cmp(m.a, m.rd(abx()))
        elif op == 0xDE: rmw(abx(), lambda v: m.nz(v - 1))
        elif op == 0xE0: cmp(m.x, imm())
        elif op == 0xE1: sbc(m.rd(izx()))
        elif op == 0xE4: cmp(m.x, m.rd(zp()))
        elif op == 0xE5: sbc(m.rd(zp()))
        elif op == 0xE6: rmw(zp(), lambda v: m.nz(v + 1))
        elif op == 0xE8: m.x = m.nz(m.x + 1)
        elif op == 0xE9: sbc(imm())
        elif op == 0xEA: pass
        elif op == 0xEC: cmp(m.x, m.rd(ab()))
        elif op == 0xED: sbc(m.rd(ab()))
        elif op == 0xEE: rmw(ab(), lambda v: m.nz(v + 1))
        elif op == 0xF0: branch(m.z)
        elif op == 0xF1: sbc(m.rd(izy()))
        elif op == 0xF5: sbc(m.rd(zpx()))
        elif op == 0xF6: rmw(zpx(), lambda v: m.nz(v + 1))
        elif op == 0xF8: m.d = 1
        elif op == 0xF9: sbc(m.rd(aby()))
        elif op == 0xFD: sbc(m.rd(abx()))
        elif op == 0xFE: rmw(abx(), lambda v: m.nz(v + 1))
        elif op in (0x1A,0x3A,0x5A,0x7A,0xDA,0xFA): pass  # 1-byte NOPs
        elif op in (0x80,0x82,0x89,0xC2,0xE2,0x04,0x14,0x34,0x44,0x54,0x64,0x74,0xD4,0xF4): imm()
        elif op in (0x0C,0x1C,0x3C,0x5C,0x7C,0xDC,0xFC): ab()
        else:
            raise RuntimeError(f"Illegal opcode {op:02X} at {pc:04X}")

    def run(self, max_steps=10_000_000, stop_pc=None, stop_fn=None):
        for _ in range(max_steps):
            if stop_pc is not None and self.pc == stop_pc: return 'stop_pc'
            if stop_fn and stop_fn(self): return 'stop_fn'
            self.step()
        return 'max_steps'

def load_prg(cpu, path):
    d = open(path, 'rb').read()
    addr = d[0] | (d[1] << 8)
    cpu.load(d[2:], addr)
    return addr, addr + len(d) - 2

if __name__ == '__main__':
    cpu = CPU()
    s, e = load_prg(cpu, sys.argv[1])
    print(f"loaded ${s:04X}-${e:04X}")
