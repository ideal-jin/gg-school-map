"""별표1(2027 초등학교 인사구역 현황표) 추출기.
pdfplumber로 글자 단위 좌표·색·밑줄(폐·휴교)·음영(신설예정)을 읽어 학교별 레코드를 만든다.
사용: python3 extract_pdf.py <pdf> <out.json>
"""
import sys, json, re, pdfplumber

PAGES = [34, 35, 36, 37]            # PDF 물리 쪽(1부터)
DOC_PAGE = {34: 33, 35: 34, 36: 35, 37: 36}  # 문서 하단 표기 쪽수
SHADE = {(0.8275, 0.8275, 0.9216), (0.7529, 0.8039, 0.9373)}

def col_bounds(pg):
    xs = sorted({round(l['x0']) for l in pg.lines if abs(l['x0'] - l['x1']) < 0.5 and l['bottom'] - l['top'] > 300})
    out = []
    for x in xs:
        if not out or x - out[-1] > 3:
            out.append(x)
    return out  # [left, |교육청|시군|구역|학교명|학교수|right]

def hlines(pg):
    return [l for l in pg.lines if abs(l['top'] - l['bottom']) < 0.5 and l['linewidth'] >= 0.45]

def cell_range(hl, x, y, top, bot):
    """x 위치의 열에서 y를 포함하는 셀의 (위,아래) 경계."""
    ys = sorted({round(l['top'], 1) for l in hl if l['x0'] - 1 <= x <= l['x1'] + 1} | {top, bot})
    above = max([v for v in ys if v <= y + 0.5], default=top)
    below = min([v for v in ys if v > y + 0.5], default=bot)
    return above, below

def _col(r):
    v = r.get('non_stroking_color')
    if v is None:
        return ()
    if isinstance(v, (int, float)):
        v = (v,)
    return tuple(round(x, 4) for x in v)

def char_attrs(pg, ch):
    cx = (ch['x0'] + ch['x1']) / 2
    ul = any(l['linewidth'] < 0.45 and abs(l['top'] - l['bottom']) < 0.5 and l['x0'] - 0.5 <= cx <= l['x1'] + 0.5
             and ch['bottom'] - 2 <= l['top'] <= ch['bottom'] + 3 for l in pg.lines)
    sh = any(r['fill'] and _col(r) in SHADE
             and r['x0'] - 0.5 <= cx <= r['x1'] + 0.5 and r['top'] - 1 <= (ch['top'] + ch['bottom']) / 2 <= r['bottom'] + 1
             for r in pg.rects)
    red = tuple(ch.get('non_stroking_color') or ()) == (1.0, 0.0, 0.0)
    return ul, sh, red

def text_in(pg, x0, x1, y0, y1):
    cs = [c for c in pg.chars if x0 <= (c['x0'] + c['x1']) / 2 <= x1 and y0 <= (c['top'] + c['bottom']) / 2 <= y1 and c['text'].strip()]
    cs.sort(key=lambda c: (round(c['top'] / 3), c['x0']))
    return cs

def lines_of(cs):
    rows = []
    for c in sorted(cs, key=lambda c: c['top']):
        if rows and abs(rows[-1][0]['top'] - c['top']) < 3:
            rows[-1].append(c)
        else:
            rows.append([c])
    return [sorted(r, key=lambda c: c['x0']) for r in rows]

def split_tokens(chars):
    """콤마(괄호 밖)로 학교 토큰 분리. 각 토큰은 [(문자, ul, sh, red)]."""
    toks, cur, depth = [], [], 0
    for t in chars:
        ch = t[0]
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        if ch == ',' and depth == 0:
            toks.append(cur); cur = []
        else:
            cur.append(t)
    if cur:
        toks.append(cur)
    return [t for t in toks if t]

def majority(seq, i):
    return sum(1 for s in seq if s[i]) * 2 > len(seq)

def parse_token(tok):
    """'본교(분교장1, 분교장2)' | '(분교장)' | '본교' → [entries]"""
    s = ''.join(t[0] for t in tok)
    out = []
    m = re.match(r'^([^()]*)(?:\((.*)\))?$', s)
    if not m:
        raise ValueError(s)
    main, inner = m.group(1), m.group(2)
    if main:
        seg = tok[:len(main)]
        out.append(dict(name=main, kind='본교', underline=majority(seg, 1), shaded=majority(seg, 2), red=majority(seg, 3)))
    if inner is not None:
        off = len(main) + 1
        for part in inner.split(','):
            seg = tok[off:off + len(part)]
            off += len(part) + 1
            out.append(dict(name=part, kind='분교장', parent=main or None,
                            underline=majority(seg, 1), shaded=majority(seg, 2), red=majority(seg, 3)))
    return out

def main(pdf, outp):
    pdfd = pdfplumber.open(pdf)
    records, rows_meta = [], []
    for pno in PAGES:
        pg = pdfd.pages[pno - 1]
        xs = col_bounds(pg)
        L, C1, C2, C4, C5, R = xs  # C2~C4: 인사구역, C4~C5: 학교명
        hl = hlines(pg)
        top = min(l['top'] for l in hl); bot = max(l['top'] for l in hl)
        # 학교명 열의 행 경계
        ys = sorted({round(l['top'], 1) for l in hl if l['x0'] <= C4 + 1 and l['x1'] >= C5 - 1})
        for y0, y1 in zip(ys, ys[1:]):
            mid = (y0 + y1) / 2
            names = text_in(pg, C4, C5, y0, y1)
            if not names:
                continue
            txt = ''.join(c['text'] for c in names)
            if txt.replace(' ', '') == '학교명':
                continue
            def celltext(xa, xb):
                cs = []
                for c in pg.chars:
                    cx = (c['x0'] + c['x1']) / 2; cy = (c['top'] + c['bottom']) / 2
                    if xa <= cx <= xb and c['text'].strip():
                        a, b = cell_range(hl, cx, cy, top, bot)
                        if a <= mid <= b:
                            cs.append(c)
                return lines_of(cs)
            office = ' '.join(''.join(c['text'] for c in ln) for ln in celltext(L, C1))
            city = ' '.join(''.join(c['text'] for c in ln) for ln in celltext(C1, C2))
            zone_raw = ''.join(c['text'] for ln in celltext(C2, C4) for c in ln)
            count_raw = ' '.join(''.join(c['text'] for c in ln) for ln in celltext(C5, R))
            seq = []
            for ln in lines_of(names):
                for c in ln:
                    seq.append((c['text'],) + char_attrs(pg, c))
            entries = []
            for tok in split_tokens(seq):
                entries += parse_token(tok)
            rows_meta.append(dict(page=pno, doc_page=DOC_PAGE[pno], office_raw=office, city_raw=city,
                                  zone_raw=zone_raw, count_raw=count_raw, y=round(mid), n=len(entries)))
            for e in entries:
                e.update(page=pno, doc_page=DOC_PAGE[pno], office_raw=office, city_raw=city, zone_raw=zone_raw, row=len(rows_meta) - 1)
                records.append(e)
    json.dump(dict(rows=rows_meta, records=records), open(outp, 'w'), ensure_ascii=False, indent=1)
    for i, r in enumerate(rows_meta):
        print(i, r['doc_page'], '|', r['office_raw'], '|', r['city_raw'], '|', r['zone_raw'], '|', r['count_raw'], '| n=', r['n'])

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
