#!/usr/bin/env python3
"""Extract high-bit ASCII strings (Bard's Tale text encoding: char|0x80, $DC='\\'=newline, $00 end).
Usage: strings_hi.py FILE [--org HEX] [--min N] [--prg]"""
import sys, argparse
ap=argparse.ArgumentParser(); ap.add_argument('file'); ap.add_argument('--org',default='0'); ap.add_argument('--min',type=int,default=4)
ap.add_argument('--prg',action='store_true'); ap.add_argument('--start',default=None); ap.add_argument('--end',default=None)
a=ap.parse_args()
d=open(a.file,'rb').read(); org=int(a.org,16)
if a.prg: org=d[0]|(d[1]<<8); d=d[2:]
s=int(a.start,16)-org if a.start else 0; e=int(a.end,16)-org if a.end else len(d)
def ok(c): return 0xA0<=c<=0xFF and 32<=(c&0x7f)<127
i=s
while i<e:
    if ok(d[i]):
        j=i
        while j<e and (ok(d[j]) or d[j] in (0xDC,)): j+=1
        n=j-i
        if n>=a.min:
            txt=''.join('\\n' if c==0xDC else chr(c&0x7f) for c in d[i:j])
            term = f"{d[j]:02X}" if j<e else '--'
            print(f"${org+i:04X} [{n:3d}] term={term} {txt}")
        i=j
    else: i+=1
