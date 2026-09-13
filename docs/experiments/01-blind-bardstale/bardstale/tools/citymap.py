#!/usr/bin/env python3
"""Render the Skara Brae city grids from NM04 ($F800 special grid, $FC00 street grid). Row r in file = ns 29-r."""
import sys, os; sys.path.insert(0, os.path.dirname(__file__))
from btfiles import *
from PIL import Image, ImageDraw
d = file_body(0x04)
g1 = [[d[0x1800 + r*30 + c] for c in range(30)] for r in range(30)]
g2 = [[d[0x1C00 + r*30 + c] for c in range(30)] for r in range(30)]
NAMES = {1:'Guild',2:'Tavern',3:'Garth',4:'Temple',5:'Review',7:'House',12:'Statue',13:'IronGate',14:'MadGod',15:'Sewer',
         16:'Credits',17:'Roscoe',18:'Kylearan',19:'Castle',20:'Mangar',21:'Gate'}
cell = 28; img = Image.new('RGB', (30*cell+2, 30*cell+40), (30,30,30)); dr = ImageDraw.Draw(img)
for r in range(30):
    ns = 29 - r
    for ew in range(30):
        v = g1[r][ew]; t = v >> 3; f = v & 7
        x0 = 1 + ew*cell; y0 = 1 + r*cell
        if v == 0: col = (70,70,70)
        elif t == 0: col = (150,120,90)
        elif t == 4 and v == 0x21: col = (90,90,140)
        else: col = (200,80,80)
        dr.rectangle([x0,y0,x0+cell-1,y0+cell-1], fill=col, outline=(40,40,40))
        if v and t: dr.text((x0+2,y0+2), NAMES.get(t, str(t))[:7], fill=(255,255,255))
        elif v == 0: dr.text((x0+8,y0+8), f"{g2[r][ew]:02x}", fill=(160,160,160))
dr.text((4, 30*cell+6), "Skara Brae (NM04 $F800). grey=street (street id shown), tan=house, red=special (type name), blue=wall(0x21). North up.", fill=(255,255,255))
img.save('extracted/maps/city.png'); print('extracted/maps/city.png')
