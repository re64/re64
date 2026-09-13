#!/usr/bin/env python3
"""Detect trailing 'slack' junk in overlay files: bytes at the same in-memory address that are identical
across several unrelated overlays are considered buffer leftovers, not content."""
import sys, os; sys.path.insert(0, os.path.dirname(__file__))
from btfiles import *
from collections import Counter, defaultdict

def analyse(group):
    bymem = defaultdict(dict)   # addr -> {file: byte}
    for n in group:
        b = file_body(n); a0 = load_addr(n)
        for i, c in enumerate(b): bymem[a0+i][n] = c
    # majority byte per address over files that cover it
    maj = {}
    for a, d in bymem.items():
        c = Counter(d.values()).most_common(1)[0]
        if c[1] >= 3: maj[a] = c[0]
    res = {}
    for n in group:
        b = file_body(n); a0 = load_addr(n)
        # walk backwards while byte == majority template
        # smallest s such that b[s:] matches the template in >=90% of positions (and len>=8)
        L = len(b); match = [1 if maj.get(a0+i) == b[i] else 0 for i in range(L)]
        suffix = [0]*(L+1)
        for i in range(L-1, -1, -1): suffix[i] = suffix[i+1] + match[i]
        end = L
        for s in range(0, L-8):
            if suffix[s] >= 0.9*(L-s): end = s; break
        res[n] = (end, len(b))
    return res, maj

if __name__ == '__main__':
    groups = {'B600': list(range(0x0B,0x1C)), 'BB00': list(range(0x1C,0x45)), 'AE00': [0x02,0x03,0x09]}
    for name, g in groups.items():
        res, maj = analyse(g)
        print(f"== group {name}")
        for n,(end,ln) in res.items():
            print(f"NM{n:02X} content ${load_addr(n):04X}-${load_addr(n)+end-1:04X} ({end} bytes), slack {ln-end}")
