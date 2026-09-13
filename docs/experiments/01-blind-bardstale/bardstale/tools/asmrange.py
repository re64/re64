#!/usr/bin/env python3
"""Print lines of a disassembly listing whose address falls in [start,end]. Usage: asmrange.py FILE START END"""
import sys, re
f, s, e = sys.argv[1], int(sys.argv[2], 16), int(sys.argv[3], 16)
cur = None
for line in open(f):
    m = re.match(r'  ([0-9A-F]{4}) ', line)
    if m: cur = int(m.group(1), 16)
    if cur is not None and s <= cur <= e: sys.stdout.write(line)
    elif cur is not None and cur > e: break
