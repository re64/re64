#!/usr/bin/env python3
"""Headless run of the resident game in emu6502 with hooked KERNAL disk I/O, timer IRQ, key injection,
and bitmap screenshots. Usage: run_game.py SCRIPT   where SCRIPT is a python list of steps:
  ('key', 'S') / ('key', 0x8D) : inject key (chars are converted to hi-bit ASCII)
  ('wait', n)      : run n IRQ frames
  ('shot', 'name') : save extracted/screens/name.png
  ('until', 'GETKEY') : run until the CPU is idle in GETKEY (polling) then continue
"""
import sys, os; sys.path.insert(0, os.path.dirname(__file__))
from emu6502 import CPU
from btfiles import *

C64 = [(0,0,0),(255,255,255),(136,0,0),(170,255,238),(204,68,204),(0,204,85),(0,0,170),(238,238,119),
       (221,136,85),(102,68,0),(255,119,119),(51,51,51),(119,119,119),(170,255,102),(0,136,255),(187,187,187)]

class Game:
    def __init__(self):
        self.cpu = CPU()
        self.cpu.mem[:] = open(os.path.join(ROOT,'extracted/d1/main.mem'),'rb').read()
        self.cpu.pc = 0xC000
        self.io = bytearray(0x1000)          # $D000-$DFFF I/O + colour RAM image
        self.io[0xC0D] = 0x81                # CIA1 ICR: timer A fired
        self.name = b''; self.lfs = (0,0,0); self.cmd = b''; self.err = list(b'00, OK,00,00\r')
        self.log = []; self.frame = 0
        self.loaded = []
        c = self.cpu
        # banking for $D000-$DFFF
        for a in range(0xD000, 0xE000):
            c.read_hooks[a] = self.rd_io; c.write_hooks[a] = self.wr_io
        H = c.jsr_hooks
        H[0xFDA3] = lambda c: True                               # IOINIT
        H[0xFFBA] = self.k_setlfs; H[0xFFBD] = self.k_setnam; H[0xFFC0] = lambda c: self.rts(c, a=0, clc=True)
        H[0xFFB7] = lambda c: self.rts(c, a=0)                  # READST
        H[0xFFC3] = lambda c: self.rts(c, clc=True); H[0xFFCC] = lambda c: self.rts(c); H[0xFFE7] = lambda c: self.rts(c)
        H[0xFFD5] = self.k_load; H[0xFFD8] = self.k_save
        H[0xFFB1] = lambda c: self.rts(c); H[0xFF93] = lambda c: self.rts(c); H[0xFFA8] = self.k_ciout
        H[0xFFAE] = self.k_unlsn; H[0xFFB4] = lambda c: self.rts(c); H[0xFF96] = lambda c: self.rts(c)
        H[0xFFA5] = self.k_acptr; H[0xFFAB] = lambda c: self.rts(c)
    # --- helpers
    def rts(self, c, a=None, clc=False):
        if a is not None: c.a = a
        if clc: c.c = 0
        return True
    def io_visible(self):
        p = self.cpu.mem[1] & 7
        return p in (5,6,7)
    def rd_io(self, c, a):
        if self.io_visible():
            if a == 0xDC01: return self.kbd_read()
            if a == 0xD012: return (self.frame * 37) & 0xFF
            return self.io[a - 0xD000]
        return c.mem[a]
    def wr_io(self, c, a, v):
        if self.io_visible(): self.io[a - 0xD000] = v
        else: c.mem[a] = v
    def kbd_read(self): return 0xFF   # no key pressed via matrix (keys are injected into $2A)
    # --- KERNAL
    def k_setlfs(self, c): self.lfs = (c.a, c.x, c.y); return True
    def k_setnam(self, c):
        p = c.x | (c.y << 8); self.name = bytes(c.mem[p:p+c.a]); return True
    def k_load(self, c):
        name = self.name.decode('latin1'); dest = c.x | (c.y << 8)
        try:
            n = int(name[2:4], 16); body = file_body(n)
        except Exception as e:
            self.log.append(f"LOAD {name} FAILED {e}"); c.c = 1; c.a = 4; return True
        c.mem[dest:dest+len(body)] = body
        self.loaded.append((name, dest)); self.log.append(f"LOAD {name} -> ${dest:04X} ({len(body)} b)")
        end = dest + len(body); c.x = end & 0xFF; c.y = end >> 8; c.c = 0; c.a = 0
        return True
    def k_save(self, c):
        self.log.append(f"SAVE {self.name} (ignored)"); c.c = 0; return True
    def k_ciout(self, c): self.cmd += bytes([c.a]); return True
    def k_unlsn(self, c):
        if self.cmd: self.log.append(f"DISKCMD {self.cmd!r}"); self.cmd = b''
        return True
    def k_acptr(self, c):
        if not self.err: self.err = list(b'00, OK,00,00\r')
        c.a = self.err.pop(0); c.n = 0; return True
    # --- IRQ
    def irq(self):
        c = self.cpu
        if c.i: return
        c.push(c.pc >> 8); c.push(c.pc & 0xFF); c.push(c.flags()); c.i = 1
        c.push(c.a); c.push(c.x); c.push(c.y)
        c.pc = c.mem[0x314] | (c.mem[0x315] << 8)
    def run_frames(self, n, steps_per_frame=16000):
        for _ in range(n):
            self.cpu.run(max_steps=steps_per_frame)
            self.irq(); self.frame += 1
    def key(self, k):
        if isinstance(k, str): k = ord(k.upper()) | 0x80
        self.cpu.mem[0x2A] = k
    def in_getkey(self):
        return 0x1955 <= self.cpu.pc <= 0x19C0 or 0x1CC6 <= self.cpu.pc <= 0x1D50
    def wait_idle(self, max_frames=600, steps_per_frame=16000):
        hits = 0
        for _ in range(max_frames):
            self.cpu.run(max_steps=steps_per_frame)
            idle = self.in_getkey() and self.cpu.mem[0x2A] == 0
            self.irq(); self.frame += 1
            hits = hits + 1 if idle else 0
            if hits >= 3: return True
        return False
    # --- screen
    def screenshot(self, path, scale=3):
        from PIL import Image
        m = self.cpu.mem; img = Image.new('RGB', (320, 200)); px = img.load()
        bg = C64[self.io[0x021] & 15]
        for row in range(25):
            for col in range(40):
                scr = m[0x0400 + row*40 + col]; cr = self.io[0x800 + row*40 + col] & 15
                pal = {0: bg, 1: C64[scr >> 4], 2: C64[scr & 15], 3: C64[cr]}
                base = 0x2000 + row*320 + col*8
                for l in range(8):
                    b = m[base + l]
                    for k in range(4):
                        v = (b >> (6 - 2*k)) & 3
                        px[col*8 + k*2, row*8 + l] = pal[v]; px[col*8 + k*2 + 1, row*8 + l] = pal[v]
        img.resize((320*scale, 200*scale), 0).save(path)

if __name__ == '__main__':
    os.makedirs(os.path.join(ROOT,'extracted/screens'), exist_ok=True)
    g = Game()
    script = eval(open(sys.argv[1]).read()) if len(sys.argv) > 1 else []
    for step in script:
        op = step[0]
        if op == 'key': g.key(step[1]); g.run_frames(6)
        elif op == 'wait': g.run_frames(step[1])
        elif op == 'call': g.cpu.a = step[2]; g.cpu.pc = step[1]; g.run_frames(6)
        elif op == 'poke': g.cpu.mem[step[1]] = step[2]
        elif op == 'idle': print('idle:', g.wait_idle())
        elif op == 'shot': g.screenshot(os.path.join(ROOT,'extracted/screens',step[1]+'.png')); print('shot', step[1], f"pc={g.cpu.pc:04X}")
        elif op == 'print': print(step[1], f"pc={g.cpu.pc:04X} frame={g.frame} $28,$29={g.cpu.mem[0x28]},{g.cpu.mem[0x29]} facing={g.cpu.mem[0x24]} mode={g.cpu.mem[0xD4]}")
    print('\n'.join(g.log[-40:]))
