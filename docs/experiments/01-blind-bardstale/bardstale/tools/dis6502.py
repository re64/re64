#!/usr/bin/env python3
"""6502 disassembler with simple recursive-descent code tracing.

Usage:
  dis6502.py FILE [--org ADDR] [--prg] [--entry ADDR ...] [--linear] [--start OFF] [--end OFF]
             [--labels FILE] [--data RANGE ...] [--comments FILE]
  --prg      : first two bytes are load address
  --entry    : extra entry points (hex). Default: org (or none if --linear)
  --linear   : disassemble linearly instead of tracing
  --data a-b : force byte-dump for address range
  --labels   : file with lines 'ADDR NAME [; comment]'
"""
import sys, argparse

# opcode table: (mnemonic, addressing mode, length)
# modes: imp, acc, imm, zp, zpx, zpy, abs, abx, aby, ind, izx, izy, rel
OPS = {}
def _t(op, mn, mode):
    OPS[op] = (mn, mode)
_tbl = """
00 BRK imp|01 ORA izx|05 ORA zp|06 ASL zp|08 PHP imp|09 ORA imm|0A ASL acc|0D ORA abs|0E ASL abs
10 BPL rel|11 ORA izy|15 ORA zpx|16 ASL zpx|18 CLC imp|19 ORA aby|1D ORA abx|1E ASL abx
20 JSR abs|21 AND izx|24 BIT zp|25 AND zp|26 ROL zp|28 PLP imp|29 AND imm|2A ROL acc|2C BIT abs|2D AND abs|2E ROL abs
30 BMI rel|31 AND izy|35 AND zpx|36 ROL zpx|38 SEC imp|39 AND aby|3D AND abx|3E ROL abx
40 RTI imp|41 EOR izx|45 EOR zp|46 LSR zp|48 PHA imp|49 EOR imm|4A LSR acc|4C JMP abs|4D EOR abs|4E LSR abs
50 BVC rel|51 EOR izy|55 EOR zpx|56 LSR zpx|58 CLI imp|59 EOR aby|5D EOR abx|5E LSR abx
60 RTS imp|61 ADC izx|65 ADC zp|66 ROR zp|68 PLA imp|69 ADC imm|6A ROR acc|6C JMP ind|6D ADC abs|6E ROR abs
70 BVS rel|71 ADC izy|75 ADC zpx|76 ROR zpx|78 SEI imp|79 ADC aby|7D ADC abx|7E ROR abx
81 STA izx|84 STY zp|85 STA zp|86 STX zp|88 DEY imp|8A TXA imp|8C STY abs|8D STA abs|8E STX abs
90 BCC rel|91 STA izy|94 STY zpx|95 STA zpx|96 STX zpy|98 TYA imp|99 STA aby|9A TXS imp|9D STA abx
A0 LDY imm|A1 LDA izx|A2 LDX imm|A4 LDY zp|A5 LDA zp|A6 LDX zp|A8 TAY imp|A9 LDA imm|AA TAX imp|AC LDY abs|AD LDA abs|AE LDX abs
B0 BCS rel|B1 LDA izy|B4 LDY zpx|B5 LDA zpx|B6 LDX zpy|B8 CLV imp|B9 LDA aby|BA TSX imp|BC LDY abx|BD LDA abx|BE LDX aby
C0 CPY imm|C1 CMP izx|C4 CPY zp|C5 CMP zp|C6 DEC zp|C8 INY imp|C9 CMP imm|CA DEX imp|CC CPY abs|CD CMP abs|CE DEC abs
D0 BNE rel|D1 CMP izy|D5 CMP zpx|D6 DEC zpx|D8 CLD imp|D9 CMP aby|DD CMP abx|DE DEC abx
E0 CPX imm|E1 SBC izx|E4 CPX zp|E5 SBC zp|E6 INC zp|E8 INX imp|E9 SBC imm|EA NOP imp|EC CPX abs|ED SBC abs|EE INC abs
F0 BEQ rel|F1 SBC izy|F5 SBC zpx|F6 INC zpx|F8 SED imp|F9 SBC aby|FD SBC abx|FE INC abx
"""
for line in _tbl.strip().splitlines():
    for ent in line.split('|'):
        op, mn, mode = ent.split()
        _t(int(op, 16), mn, mode)
LEN = {'imp':1,'acc':1,'imm':2,'zp':2,'zpx':2,'zpy':2,'abs':3,'abx':3,'aby':3,'ind':3,'izx':2,'izy':2,'rel':2}

C64_SYMS = {
 0xD000:'VIC_SPR0X',0xD010:'VIC_SPRMSB',0xD011:'VIC_CTRL1',0xD012:'VIC_RASTER',0xD015:'VIC_SPRENA',0xD016:'VIC_CTRL2',
 0xD017:'VIC_SPRYEXP',0xD018:'VIC_MEMPTR',0xD019:'VIC_IRQ',0xD01A:'VIC_IRQMASK',0xD01B:'VIC_SPRPRI',0xD01C:'VIC_SPRMC',
 0xD01D:'VIC_SPRXEXP',0xD020:'VIC_BORDER',0xD021:'VIC_BG0',0xD022:'VIC_BG1',0xD023:'VIC_BG2',0xD025:'VIC_SPRMC0',0xD026:'VIC_SPRMC1',
 0xD027:'VIC_SPR0COL',0xD400:'SID_V1FREQLO',0xD401:'SID_V1FREQHI',0xD404:'SID_V1CTRL',0xD405:'SID_V1AD',0xD406:'SID_V1SR',
 0xD418:'SID_VOLUME',0xDC00:'CIA1_PRA',0xDC01:'CIA1_PRB',0xDC02:'CIA1_DDRA',0xDC03:'CIA1_DDRB',0xDC04:'CIA1_TALO',0xDC05:'CIA1_TAHI',
 0xDC0D:'CIA1_ICR',0xDC0E:'CIA1_CRA',0xDD00:'CIA2_PRA',0xDD01:'CIA2_PRB',0xDD02:'CIA2_DDRA',0xDD03:'CIA2_DDRB',0xDD0D:'CIA2_ICR',
 0xFFFA:'NMI_VEC',0xFFFC:'RESET_VEC',0xFFFE:'IRQ_VEC',0x0314:'CINV',0x0316:'CBINV',0x0318:'NMINV',
 0xFFBA:'K_SETLFS',0xFFBD:'K_SETNAM',0xFFC0:'K_OPEN',0xFFC3:'K_CLOSE',0xFFC6:'K_CHKIN',0xFFC9:'K_CHKOUT',0xFFCC:'K_CLRCHN',
 0xFFCF:'K_CHRIN',0xFFD2:'K_CHROUT',0xFFD5:'K_LOAD',0xFFD8:'K_SAVE',0xFFE4:'K_GETIN',0xFFE7:'K_CLALL',0xFFE1:'K_STOP',
 0xFF81:'K_CINT',0xFF84:'K_IOINIT',0xFF87:'K_RAMTAS',0xFF8A:'K_RESTOR',0xFF90:'K_SETMSG',0xFFA5:'K_ACPTR',0xFFA8:'K_CIOUT',
 0xFFAB:'K_UNTALK',0xFFAE:'K_UNLSN',0xFFB1:'K_LISTEN',0xFFB4:'K_TALK',0xFFB7:'K_READST',0xFF96:'K_TKSA',0xFF93:'K_SECOND',
 0xFFE1:'K_STOP',0xFFEA:'K_UDTIM',0xFFDE:'K_RDTIM',0xFFDB:'K_SETTIM',0xFFF0:'K_PLOT',0xFFED:'K_SCREEN',0xFFF3:'K_IOBASE',
 0x0001:'CPU_PORT',0x0000:'CPU_DDR',0xA000:'BASIC_COLD',0xE000:'KERNAL_START',0xE544:'K_CLRSCR',0xFCE2:'K_RESET',0xFDA3:'K_IOINIT_I',0xFF5B:'K_CINT_I',0xE3BF:'B_INIT',
}

def disassemble(mem, org, entries, data_ranges=(), labels=None, comments=None, linear=False, end=None, watch_jumptab=True):
    """mem: bytes; org: base addr. Returns (lines, code_set)."""
    labels = dict(labels or {})
    comments = dict(comments or {})
    n = len(mem)
    lo, hi = org, org + n
    is_code = bytearray(n)   # 1 = instruction start, 2 = instruction body
    forced_data = bytearray(n)
    for a, b in data_ranges:
        for x in range(max(a, lo), min(b, hi)):
            forced_data[x - lo] = 1

    def rd(a): return mem[a - lo]
    refs = {}   # target -> set of kinds ('J','B','S','D')
    def addref(t, k):
        refs.setdefault(t, set()).add(k)

    work = list(entries)
    if linear:
        # mark everything as code linearly
        a = lo
        while a < hi:
            if forced_data[a - lo]:
                a += 1; continue
            op = rd(a)
            if op not in OPS:
                a += 1; continue
            mn, mode = OPS[op]
            l = LEN[mode]
            if a + l > hi: break
            is_code[a - lo] = 1
            for k in range(1, l): is_code[a - lo + k] = 2
            a += l
    else:
        seen = set()
        while work:
            a = work.pop()
            while lo <= a < hi and not forced_data[a - lo]:
                if is_code[a - lo]: break
                op = rd(a)
                if op not in OPS: break
                mn, mode = OPS[op]
                l = LEN[mode]
                if a + l > hi: break
                is_code[a - lo] = 1
                for k in range(1, l): is_code[a - lo + k] = 2
                if mode == 'rel':
                    t = a + 2 + ((rd(a+1) ^ 0x80) - 0x80)
                    addref(t, 'B'); work.append(t)
                elif mode == 'abs' and mn in ('JMP', 'JSR'):
                    t = rd(a+1) | (rd(a+2) << 8)
                    addref(t, 'J' if mn == 'JMP' else 'S')
                    if lo <= t < hi: work.append(t)
                    if mn == 'JMP': break
                elif mode in ('abs','abx','aby','ind'):
                    t = rd(a+1) | (rd(a+2) << 8)
                    addref(t, 'D')
                elif mode in ('zp','zpx','zpy','izx','izy'):
                    addref(rd(a+1), 'Z')
                if mn in ('RTS', 'RTI', 'BRK') or (mn == 'JMP' and mode == 'ind'):
                    break
                a += l
    # second pass: also collect refs for linear mode
    if linear:
        a = lo
        while a < hi:
            if is_code[a - lo] == 1:
                op = rd(a); mn, mode = OPS[op]; l = LEN[mode]
                if mode == 'rel':
                    addref(a + 2 + ((rd(a+1) ^ 0x80) - 0x80), 'B')
                elif mode in ('abs','abx','aby','ind'):
                    t = rd(a+1) | (rd(a+2) << 8)
                    addref(t, 'J' if mn == 'JMP' else 'S' if mn == 'JSR' else 'D')
                elif mode in ('zp','zpx','zpy','izx','izy'):
                    addref(rd(a+1), 'Z')
                a += l
            else:
                a += 1

    def name(t):
        if t in labels: return labels[t]
        if t in C64_SYMS: return C64_SYMS[t]
        if t in refs and lo <= t < hi:
            k = refs[t]
            if 'S' in k: return f"sub_{t:04X}"
            if 'J' in k or 'B' in k: return f"L_{t:04X}"
            return f"D_{t:04X}"
        return None

    def fmt_operand(a, mn, mode):
        if mode in ('imp',): return ''
        if mode == 'acc': return 'A'
        if mode == 'imm': return f"#${rd(a+1):02X}"
        if mode == 'rel':
            t = a + 2 + ((rd(a+1) ^ 0x80) - 0x80)
            return name(t) or f"${t:04X}"
        if mode in ('zp','zpx','zpy','izx','izy'):
            z = rd(a+1)
            s = labels.get(z) or (C64_SYMS.get(z) if z < 2 else None) or f"${z:02X}"
            return {'zp':s,'zpx':s+',X','zpy':s+',Y','izx':f'({s},X)','izy':f'({s}),Y'}[mode]
        t = rd(a+1) | (rd(a+2) << 8)
        s = name(t) or f"${t:04X}"
        return {'abs':s,'abx':s+',X','aby':s+',Y','ind':f'({s})'}[mode]

    lines = []
    a = lo
    while a < hi:
        nm = name(a)
        if nm and (a in refs or a in labels) and (lo <= a < hi):
            kinds = ''.join(sorted(refs.get(a, ''))) 
            lines.append(f"{nm}:  ; refs={kinds}" if kinds else f"{nm}:")
        if is_code[a - lo] == 1:
            op = rd(a); mn, mode = OPS[op]; l = LEN[mode]
            raw = ' '.join(f"{rd(a+k):02X}" for k in range(l))
            cm = comments.get(a, '')
            lines.append(f"  {a:04X}  {raw:9s}  {mn} {fmt_operand(a, mn, mode)}" + (f"   ; {cm}" if cm else ''))
            a += l
        else:
            # data run until next code or label
            b = a
            while b < hi and is_code[b - lo] != 1 and (b == a or (b not in refs and b not in labels)):
                b += 1
                if b - a >= 16: break
            chunk = mem[a-lo:b-lo]
            asc = ''.join(chr(c & 0x7F) if 32 <= (c & 0x7F) < 127 else '.' for c in chunk)
            cm = comments.get(a, '')
            lines.append(f"  {a:04X}  .byte {' '.join(f'{c:02X}' for c in chunk):48s} ; {asc}" + (f"  ; {cm}" if cm else ''))
            a = b
    return lines, is_code, refs

def load_labels(path):
    labs = {}; cms = {}
    for line in open(path):
        line = line.split('#', 1)[0].strip()
        if not line: continue
        parts = line.split(None, 2)
        addr = int(parts[0], 16)
        labs[addr] = parts[1]
        if len(parts) > 2: cms[addr] = parts[2].lstrip('; ')
    return labs, cms

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('file')
    ap.add_argument('--org', default=None)
    ap.add_argument('--prg', action='store_true')
    ap.add_argument('--entry', nargs='*', default=[])
    ap.add_argument('--linear', action='store_true')
    ap.add_argument('--data', nargs='*', default=[])
    ap.add_argument('--labels', default=None)
    ap.add_argument('--skip', type=int, default=0, help='skip N bytes after load address')
    a = ap.parse_args()
    mem = open(a.file, 'rb').read()
    if a.prg:
        org = mem[0] | (mem[1] << 8); mem = mem[2:]
    else:
        org = int(a.org, 16) if a.org else 0
    if a.skip:
        org += a.skip; mem = mem[a.skip:]
    entries = [int(e, 16) for e in a.entry] or ([org] if not a.linear else [])
    drs = []
    for d in a.data:
        x, y = d.split('-'); drs.append((int(x, 16), int(y, 16)))
    labels, comments = load_labels(a.labels) if a.labels else ({}, {})
    lines, _, _ = disassemble(mem, org, entries, drs, labels, comments, linear=a.linear)
    print(f"; {a.file}  org=${org:04X} len={len(mem)} end=${org+len(mem)-1:04X}")
    print('\n'.join(lines))

if __name__ == '__main__':
    main()
