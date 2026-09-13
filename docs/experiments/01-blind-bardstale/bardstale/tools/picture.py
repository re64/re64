#!/usr/bin/env python3
"""Decode Bard's Tale C64 picture files (NM50..NM90, NMF0) — format reverse-engineered from DRAW_PICTURE ($4000).

Stream (loaded at $C000):
  frame := E1 E2 body   (E1 = RLE escape, E2 = position escape, chosen per frame)
  body  := bytes placed column-major: for pass in (even lines, odd lines): for col in 0..9: for line in 0..42
           E1 n v  -> (n+3) copies of v
           E2 x y  -> reposition: x = line index (8..$5D, parity = pass), y = column index*4+8 ; y==$FF -> end of frame
  after frame: delay byte. 0 = no animation. else: next frame follows (delta drawn over previous).
           after a later frame, delay byte 0 means: read one more delay byte and restart from $C000.
Picture area: bitmap lines 8..93 (86 lines), byte columns 2..11 (80 hires px = 40 multicolor px).
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

W_CELLS = 10; LINES = 86; LINE0 = 8; CELL0 = 2

def decode(data, max_frames=32):
    """Yield (frame_bitmap[86 lines][10 cells], delay) for each frame. Bitmap persists between frames."""
    bm = [[0]*W_CELLS for _ in range(LINES)]
    pos = 0
    frames = []
    def rd():
        nonlocal pos
        if pos >= len(data): raise EOFError
        v = data[pos]; pos += 1; return v
    first = True
    for _ in range(max_frames):
        try:
            e1 = rd(); e2 = rd()
            x = LINE0; y = 8
            run = 0; runv = 0
            end = False
            while not end:
                # inner loops mirror the 6502 code
                while True:
                    if run:
                        run -= 1; v = runv
                    else:
                        v = rd()
                        if v == e1:
                            run = rd() + 3; runv = rd(); run -= 1; v = runv
                        elif v == e2:
                            x = rd(); y = rd()
                            if y == 0xFF: end = True; break
                            continue
                    bm[x - LINE0][(y // 4) - 2] = v
                    x += 2
                    if x >= 0x5E:
                        x -= 0x56; y += 4
                        if y >= 0x30:
                            x += 1; y = 8
                            if x >= 0x0A: end = True; break
            delay = rd()
            frames.append(([row[:] for row in bm], delay))
            if delay == 0:
                if first: break
                _restart_delay = rd()  # then restarts from beginning -> we stop
                break
            first = False
        except EOFError:
            break
    return frames

C64 = [(0,0,0),(255,255,255),(136,0,0),(170,255,238),(204,68,204),(0,204,85),(0,0,170),(238,238,119),
       (221,136,85),(102,68,0),(255,119,119),(51,51,51),(119,119,119),(170,255,102),(0,136,255),(187,187,187)]
# resident table D_0D99: colour byte per picture index (pic-$50); >= $32 -> $26. hi nibble = %01, lo nibble = %10, %11 = white
PIC_COLORS = bytes.fromhex('2656262626262626262626262626262626262626262626262726265c26262626262626592626262626262626262626265784')
def palette_for(picnum):
    i = picnum - 0x50
    cb = PIC_COLORS[i] if 0 <= i < 0x32 else 0x26
    return {0: C64[0], 1: C64[cb >> 4], 2: C64[cb & 15], 3: C64[1]}
PALETTE = palette_for(0x50)

def to_image(bm, scale=4, palette=PALETTE):
    from PIL import Image
    img = Image.new('RGB', (W_CELLS*4, LINES))
    px = img.load()
    for l in range(LINES):
        for c in range(W_CELLS):
            b = bm[l][c]
            for k in range(4):
                v = (b >> (6 - 2*k)) & 3
                px[c*4+k, l] = palette[v]
    return img.resize((W_CELLS*4*scale*2, LINES*scale), 0)

if __name__ == '__main__':
    from btfiles import file_body
    out = sys.argv[1] if len(sys.argv) > 1 else 'extracted/pictures'
    os.makedirs(out, exist_ok=True)
    nums = list(range(0x50, 0x91)) + [0xF0]
    for n in nums:
        try: d = file_body(n)
        except FileNotFoundError: continue
        frames = decode(d)
        for i, (bm, delay) in enumerate(frames):
            to_image(bm, palette=palette_for(n)).save(f"{out}/nm{n:02x}_f{i}.png")
        print(f"NM{n:02X}: {len(frames)} frames, delays={[f[1] for f in frames]}, bytes={len(d)}")
