#!/usr/bin/env python3
"""Disassemble an overlay (NMxx) at its real address with resident labels. Usage: disov.py XX [entries...]"""
import sys, os; sys.path.insert(0, os.path.dirname(__file__))
from btfiles import *
from dis6502 import disassemble, load_labels
from slack import analyse
n = int(sys.argv[1], 16)
body = file_body(n); a0 = load_addr(n)
groups = {0xAE: [0x02,0x03,0x09], 0xB6: list(range(0x0B,0x1C)), 0xBB: list(range(0x1C,0x45))}
end = len(body)
g = groups.get(a0 >> 8)
if g:
    res, _ = analyse(g); end = res[n][0]
labels, comments = load_labels(os.path.join(ROOT, 'notes', 'labels_main.txt'))
ovl = os.path.join(ROOT, 'notes', f'labels_nm{n:02x}.txt')
if os.path.exists(ovl):
    l2, c2 = load_labels(ovl); labels.update(l2); comments.update(c2)
entries = [int(x, 16) for x in sys.argv[2:]] or [a0]
lines, is_code, refs = disassemble(bytes(body[:end]), a0, entries, labels=labels, comments=comments)
print(f"; NM{n:02X} at ${a0:04X}, content {end} bytes (file {len(body)})")
print('\n'.join(lines))
