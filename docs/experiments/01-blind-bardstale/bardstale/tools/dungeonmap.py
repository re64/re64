#!/usr/bin/env python3
"""Decode/render Bard's Tale C64 dungeon maps NMA0..NMAF (2032 bytes, loaded at $F800).

Layout (file offset / runtime addr):
  $000 (F800)  22x22 wall grid, index = ns*22 + ew  (ns: 0=south edge .. 21=north; ew: 0=west .. 21=east)
               byte bits: 1-0 = N side, 3-2 = S, 5-4 = E, 7-6 = W ; 0 open, 1 wall, 2 door, 3 secret door(?)
  $200 (FA00)  22x22 flag grid: 01 stairs up, 02 stairs down, 04 coordinate-list special present,
               08 darkness, 10 trap, 20 portal down (needs levitation, else fall dmg), 40 portal up (needs levitation),
               80 one-time special (cleared after use)
  $400 (FC00)  level chain: up to 8 level numbers of this dungeon (FF = unused); $1E indexes it
  $408 (FC08)  ? 4 bytes + FF
  $410 (FC10)  depth (monster difficulty), $411 ?, $412 tileset (NM05+n), $413/$414 city exit ns/ew, $415 stairs-sense flip
  $416 (FC16)  level name, '\\' terminated
  $420 (FC20)  8 x (ns,ew) special-event coords -> $430 8 x special type (16..31 -> LOAD_SPECIAL overlay)
  $440 (FC40) 16 x coords: darkness-zone squares
  $460 (FC60)  8 x coords teleport source -> $470 8 x (ns,ew) destination
  $480 (FC80)  8 x coords spinner
  $490 (FC90)  8 x coords smoke ("Smoke in your eyes!")
  $4A0 (FCA0) 16 x coords damage squares (all members take depth+1..)
  $4C0 (FCC0)  8 x coords -> $EE flag (anti-magic?)   $4D0 (FCD0) 8 x coords -> $EF flag (silence?)
  $4E0 (FCE0)  8 x coords message squares -> $510 (FD10) 8 x string pointer
  $4F0 (FCF0)  8 x coords fixed encounter -> $500 (FD00) 8 x (monster id, count)
  $520+ (FD20) strings (high-bit ASCII), rest slack
"""
import sys, os; sys.path.insert(0, os.path.dirname(__file__))
from btfiles import *

def hitext(b):
    out=[]
    for c in b:
        if c in (0,0xFF,0xDC): break
        out.append(chr(c&0x7f))
    return ''.join(out)

def coords(d, off, n):
    return [(d[off+2*i], d[off+2*i+1]) for i in range(n) if d[off+2*i] != 0xFF]

def parse(n):
    d = file_body(n)
    walls = [[d[ns*22+ew] for ew in range(22)] for ns in range(22)]
    flags = [[d[0x200+ns*22+ew] for ew in range(22)] for ns in range(22)]
    h = {
        'chain': [x for x in d[0x400:0x408] if x != 0xFF],
        'unk408': list(d[0x408:0x410]),
        'depth': d[0x410], 'unk411': d[0x411], 'tileset': d[0x412], 'city_exit': (d[0x413], d[0x414]), 'stairs_flip': d[0x415],
        'name': hitext(d[0x416:0x420]),
        'specials': list(zip(coords(d,0x420,8), d[0x430:0x440])),  # (coords, special type -> overlay via D_1B28)
        'dark': coords(d,0x440,16),
        'teleport': list(zip(coords(d,0x460,8), coords(d,0x470,8))),
        'spinner': coords(d,0x480,8), 'smoke': coords(d,0x490,8), 'damage': coords(d,0x4A0,16),
        'flagEE': coords(d,0x4C0,8), 'flagEF': coords(d,0x4D0,8),
        'messages': [], 'encounters': [],
    }
    for i,(c) in enumerate(coords(d,0x4E0,8)):
        p = d[0x510+2*i] | (d[0x511+2*i]<<8)
        h['messages'].append((c, hitext(d[p-0xF800:])))
    for i,c in enumerate(coords(d,0x4F0,8)):
        h['encounters'].append((c, d[0x500+2*i], d[0x501+2*i]))
    return walls, flags, h

def render(walls, flags, h, path, cell=24):
    from PIL import Image, ImageDraw
    W = 22*cell+2; img = Image.new('RGB', (W, W+40), (30,30,30)); dr = ImageDraw.Draw(img)
    for ns in range(22):
        for ew in range(22):
            x0 = 1+ew*cell; y0 = 1+(21-ns)*cell
            v = walls[ns][ew]; f = flags[ns][ew]
            fill = (60,60,60)
            if f & 0x08: fill = (20,20,40)
            dr.rectangle([x0,y0,x0+cell-1,y0+cell-1], fill=fill)
            sides = {'N': v & 3, 'S': (v>>2)&3, 'E': (v>>4)&3, 'W': (v>>6)&3}
            col = {1:(220,220,220), 2:(220,120,40), 3:(200,40,200)}
            for s,t in sides.items():
                if not t: continue
                c = col[t]
                if s=='N': dr.line([x0,y0,x0+cell-1,y0], fill=c, width=2)
                if s=='S': dr.line([x0,y0+cell-1,x0+cell-1,y0+cell-1], fill=c, width=2)
                if s=='E': dr.line([x0+cell-1,y0,x0+cell-1,y0+cell-1], fill=c, width=2)
                if s=='W': dr.line([x0,y0,x0,y0+cell-1], fill=c, width=2)
            lab=''
            if f & 1: lab+='U'
            if f & 2: lab+='D'
            if f & 0x10: lab+='T'
            if f & 0x20: lab+='v'
            if f & 0x40: lab+='^'
            if f & 0x80: lab+='*'
            if lab: dr.text((x0+3,y0+3), lab, fill=(255,255,0))
    def mark(lst, ch, colr):
        for (ns,ew) in lst:
            x0 = 1+ew*cell; y0 = 1+(21-ns)*cell
            dr.text((x0+cell-10,y0+cell-12), ch, fill=colr)
    mark(h['spinner'],'@',(255,80,80)); mark([c for c,_ in h['teleport']],'t',(80,255,255))
    mark([c for c,_ in h['messages']],'m',(120,255,120)); mark([c for c,_,_ in h['encounters']],'!',(255,0,0))
    mark(h['smoke'],'s',(200,200,200)); mark(h['damage'],'x',(255,128,0)); mark([c for c,_ in h['specials']],'S',(255,255,255))
    dr.text((4, W+4), f"{h['name']}  depth={h['depth']} tileset={h['tileset']} chain={h['chain']} exit={h['city_exit']}", fill=(255,255,255))
    img.save(path)

if __name__ == '__main__':
    out = 'extracted/maps'; os.makedirs(out, exist_ok=True)
    for n in range(0xA0, 0xB0):
        walls, flags, h = parse(n)
        render(walls, flags, h, f"{out}/nm{n:02x}.png")
        print(f"== NM{n:02X} '{h['name']}' depth={h['depth']} unk411={h['unk411']} tileset={h['tileset']} chain={h['chain']} unk408={h['unk408']} exit={h['city_exit']} flip={h['stairs_flip']}")
        print("   stairs:", h['specials'], " tele:", h['teleport'], " spin:", h['spinner'], " smoke:", h['smoke'])
        print("   dark:", h['dark'], " dmg:", h['damage'], " EE:", h['flagEE'], " EF:", h['flagEF'])
        for c,t in h['messages']: print(f"   msg@{c}: {t[:70]!r}")
        for c,m,k in h['encounters']: print(f"   enc@{c}: monster {m} x{k}")
        # count wall values
        from collections import Counter
        cnt=Counter()
        for row in walls:
            for v in row:
                for s in range(4): cnt[(v>>(2*s))&3]+=1
        print("   wall-type histogram:", dict(cnt))
