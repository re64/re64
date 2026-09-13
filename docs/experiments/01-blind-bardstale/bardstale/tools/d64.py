#!/usr/bin/env python3
"""D64 disk image library + CLI.

Standard 35-track layout. Provides:
  - sector(t,s) access
  - BAM parsing
  - directory listing (with hidden/deleted entries)
  - file chain following (with loop detection)
  - sector usage map (which sectors are claimed by which file chain)
"""
import sys, struct

SECTORS_PER_TRACK = [0] + [21]*17 + [19]*7 + [18]*6 + [17]*5  # index 1..35
TRACK_OFFSET = [0]*36
_o = 0
for t in range(1, 36):
    TRACK_OFFSET[t] = _o
    _o += SECTORS_PER_TRACK[t]
TOTAL_SECTORS = _o  # 683

FTYPES = {0: 'DEL', 1: 'SEQ', 2: 'PRG', 3: 'USR', 4: 'REL'}

def petscii_to_ascii(b):
    out = []
    for c in b:
        if c == 0xA0: out.append(' ')
        elif 0x41 <= c <= 0x5A: out.append(chr(c + 32))   # unshifted letters -> lower
        elif 0xC1 <= c <= 0xDA: out.append(chr(c - 128))  # shifted letters -> upper
        elif 0x20 <= c < 0x7F: out.append(chr(c))
        else: out.append('\\x%02x' % c)
    return ''.join(out)

class D64:
    def __init__(self, path):
        self.path = path
        self.data = open(path, 'rb').read()
        assert len(self.data) in (174848, 175531), len(self.data)

    def lba(self, t, s):
        assert 1 <= t <= 35 and 0 <= s < SECTORS_PER_TRACK[t], (t, s)
        return TRACK_OFFSET[t] + s

    def sector(self, t, s):
        i = self.lba(t, s) * 256
        return self.data[i:i+256]

    def ts_from_lba(self, lba):
        for t in range(1, 36):
            if lba < TRACK_OFFSET[t] + SECTORS_PER_TRACK[t]:
                return t, lba - TRACK_OFFSET[t]
        raise ValueError(lba)

    # ---- BAM ----
    def bam(self):
        b = self.sector(18, 0)
        info = {
            'dir_track': b[0], 'dir_sector': b[1], 'dos_version': chr(b[2]),
            'name': petscii_to_ascii(b[0x90:0xA0]),
            'id': petscii_to_ascii(b[0xA2:0xA4]),
            'dos_type': petscii_to_ascii(b[0xA5:0xA7]),
        }
        free = {}
        for t in range(1, 36):
            e = b[4 + (t-1)*4: 8 + (t-1)*4]
            bits = e[1] | (e[2] << 8) | (e[3] << 16)
            free[t] = (e[0], [bool(bits >> s & 1) for s in range(SECTORS_PER_TRACK[t])])
        info['free'] = free
        return info

    # ---- Directory ----
    def directory(self, include_deleted=True):
        entries = []
        t, s = 18, 1
        seen = set()
        while t != 0 and (t, s) not in seen:
            seen.add((t, s))
            blk = self.sector(t, s)
            for i in range(8):
                e = blk[i*32:(i+1)*32]
                ftype = e[2]
                if ftype == 0 and not include_deleted:
                    continue
                if ftype == 0 and e[3] == 0 and e[4] == 0:
                    continue
                entries.append({
                    'dir_ts': (t, s, i),
                    'type_byte': ftype,
                    'type': FTYPES.get(ftype & 7, '???'),
                    'closed': bool(ftype & 0x80),
                    'locked': bool(ftype & 0x40),
                    'start': (e[3], e[4]),
                    'name': petscii_to_ascii(e[5:21]).rstrip(),
                    'name_raw': e[5:21],
                    'side_ts': (e[21], e[22]),
                    'rel_len': e[23],
                    'blocks': e[30] | (e[31] << 8),
                })
            t, s = blk[0], blk[1]
        return entries

    # ---- File chains ----
    def chain(self, t, s):
        """Return list of (t,s,data_bytes,used_len) following the chain. Stops on loop/invalid."""
        out = []
        seen = set()
        while t != 0:
            if (t, s) in seen or not (1 <= t <= 35) or s >= SECTORS_PER_TRACK[t]:
                out.append(('ERR', t, s))
                break
            seen.add((t, s))
            blk = self.sector(t, s)
            nt, ns = blk[0], blk[1]
            used = 254 if nt != 0 else max(0, ns - 1)
            out.append((t, s, blk[2:2+used], used))
            t, s = nt, ns
        return out

    def read_file(self, t, s):
        parts = self.chain(t, s)
        return b''.join(p[2] for p in parts if p[0] != 'ERR'), parts

def cli():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('image')
    ap.add_argument('cmd', choices=['dir', 'bam', 'extract', 'usage', 'sector', 'chain'])
    ap.add_argument('args', nargs='*')
    a = ap.parse_args()
    d = D64(a.image)
    if a.cmd == 'bam':
        b = d.bam()
        print(f"name={b['name']!r} id={b['id']!r} dos={b['dos_type']!r} dir={b['dir_track']},{b['dir_sector']}")
        total_free = 0
        for t in range(1, 36):
            n, bits = b['free'][t]
            total_free += n if t != 18 else 0
            print(f"  T{t:2d} free={n:2d} " + ''.join('.' if f else '#' for f in bits))
        print("blocks free (excl 18):", total_free)
    elif a.cmd == 'dir':
        for e in d.directory():
            flag = '' if e['closed'] else '*'
            lock = '<' if e['locked'] else ''
            print(f"{e['blocks']:4d} {e['name']!r:20s} {flag}{e['type']}{lock}  start={e['start']} dir@{e['dir_ts']} raw={e['name_raw'].hex()}")
    elif a.cmd == 'sector':
        t, s = int(a.args[0]), int(a.args[1])
        blk = d.sector(t, s)
        for i in range(0, 256, 16):
            row = blk[i:i+16]
            print(f"{i:02x}: {row.hex(' ')}  {''.join(chr(c) if 32 <= c < 127 else '.' for c in row)}")
    elif a.cmd == 'chain':
        t, s = int(a.args[0]), int(a.args[1])
        for p in d.chain(t, s):
            print(p[:2], p[3] if p[0] != 'ERR' else 'ERR')
    elif a.cmd == 'extract':
        import os
        outdir = a.args[0] if a.args else '.'
        os.makedirs(outdir, exist_ok=True)
        for e in d.directory(include_deleted=False):
            data, parts = d.read_file(*e['start'])
            safe = ''.join(c if c.isalnum() or c in '-_.' else '_' for c in e['name']) or 'unnamed'
            fn = os.path.join(outdir, f"{safe}.{e['type'].lower()}")
            open(fn, 'wb').write(data)
            err = any(p[0] == 'ERR' for p in parts)
            print(f"{fn}: {len(data)} bytes, {len(parts)} blocks{' ERR' if err else ''}")
    elif a.cmd == 'usage':
        # map every sector to owner
        owner = {}
        for e in d.directory():
            for p in d.chain(*e['start']):
                if p[0] == 'ERR': break
                owner.setdefault((p[0], p[1]), []).append(e['name'])
        bam = d.bam()
        for t in range(1, 36):
            row = ''
            for s in range(SECTORS_PER_TRACK[t]):
                blk = d.sector(t, s)
                empty = all(c == 0 for c in blk) or (blk[0] == 0x4B and all(c == 1 for c in blk[1:]))
                o = owner.get((t, s))
                free = bam['free'][t][1][s]
                if (t, s) in ((18, 0),): ch = 'B'
                elif t == 18 and o is None and not free: ch = 'D'
                elif o: ch = 'f' if free else 'F'   # f = file but BAM says free (inconsistent)
                elif empty: ch = '.' if free else '0'  # 0 = allocated but empty
                else: ch = 'x' if not free else '?'    # x = data, allocated, no dir owner ; ? = data, free
                row += ch
            print(f"T{t:2d} {row}")
        print("Legend: F=file(alloc) f=file(BAM free!) x=data,alloc,no owner ?=data,free .=empty,free 0=empty,alloc B=BAM D=dir")

if __name__ == '__main__':
    cli()
