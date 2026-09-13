#!/usr/bin/env python3
"""Trace code from entries in a memory image and list absolute/zp references into a range.
Usage: xrefs.py --files 02,09 --entry AE00 --range F800-FFFF [--code-range AE00-BAFF]"""
import sys, os, argparse; sys.path.insert(0, os.path.dirname(__file__))
from btfiles import *
from dis6502 import OPS, LEN
from collections import defaultdict

def trace(mem, entries, lo, hi):
    is_code = bytearray(65536); work = list(entries)
    while work:
        a = work.pop()
        while lo <= a < hi and not is_code[a]:
            op = mem[a]
            if op not in OPS: break
            mn, mode = OPS[op]; l = LEN[mode]; is_code[a] = 1
            if mode == 'rel': work.append((a + 2 + ((mem[a+1] ^ 0x80) - 0x80)) & 0xFFFF)
            elif mode == 'abs' and mn in ('JMP','JSR'):
                t = mem[a+1] | (mem[a+2] << 8)
                if lo <= t < hi: work.append(t)
                if mn == 'JMP': break
            if mn in ('RTS','RTI','BRK') or (mn == 'JMP' and mode == 'ind'): break
            a += l
    return is_code

def refs_in(mem, is_code, rlo, rhi, clo, chi):
    out = defaultdict(list)
    a = clo
    while a < chi:
        if is_code[a]:
            op = mem[a]; mn, mode = OPS[op]; l = LEN[mode]
            if mode in ('abs','abx','aby','ind') and mn not in ('JMP','JSR'):
                t = mem[a+1] | (mem[a+2] << 8)
                if rlo <= t <= rhi: out[t].append((a, mn, mode))
            elif mode in ('abs',) and mn in ('JMP','JSR'):
                t = mem[a+1] | (mem[a+2] << 8)
                if rlo <= t <= rhi: out[t].append((a, mn, mode))
            elif mode in ('zp','zpx','zpy','izx','izy'):
                t = mem[a+1]
                if rlo <= t <= rhi: out[t].append((a, mn, mode))
            a += l
        else: a += 1
    return out

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--files', default=''); ap.add_argument('--entry', nargs='*', default=[])
    ap.add_argument('--range', required=True); ap.add_argument('--code-range', default='0800-CB00')
    ap.add_argument('--resident-entries', action='store_true')
    a = ap.parse_args()
    files = [int(x, 16) for x in a.files.split(',') if x]
    mem = build_mem(files)
    clo, chi = [int(x, 16) for x in a.code_range.split('-')]
    rlo, rhi = [int(x, 16) for x in a.range.split('-')]
    entries = [int(x, 16) for x in a.entry]
    if a.resident_entries:
        entries += [0xC000, 0x0800, 0x1BC7] + [mem[i+1] | (mem[i+2] << 8) for i in range(0x800, 0x8D2, 3)]
        entries += [int(l.split()[0], 16) for l in open(os.path.join(ROOT, 'notes', 'direct_targets.txt'))]
    is_code = trace(mem, entries, clo, chi + 1)
    out = refs_in(mem, is_code, rlo, rhi, clo, chi + 1)
    for t in sorted(out):
        print(f"${t:04X}: " + ', '.join(f"{mn} {mode}@{x:04X}" for x, mn, mode in out[t]))
