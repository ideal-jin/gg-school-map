"""승진평정 참고자료(도서·벽지·접적 / 농어촌·공단 / 접경 지정현황, 문서 31~41쪽) 추출기.
점선 테두리 표를 열별 가로 경계로 셀 단위 분해한 뒤, 지정기간 셀마다 같은 높이의 지역·학교명·급지 셀을 붙인다.
사용: python3 -I extract_promo_pdf.py <pdf> <out.json>
"""
import sys, json, re, collections, pdfplumber

def clusters(vals, tol):
    out = []
    for v in sorted(vals):
        if out and v - out[-1][-1] <= tol:
            out[-1].append(v)
        else:
            out.append([v])
    return [sum(c) / len(c) for c in out]

def coverage(segs, a, b):
    """[a,b] 구간을 segs(x0,x1)들이 덮는 비율"""
    ivs = sorted((max(a, s0), min(b, s1)) for s0, s1 in segs if s1 > a and s0 < b)
    tot, cur = 0, None
    for s0, s1 in ivs:
        if cur is None or s0 > cur[1]:
            if cur: tot += cur[1] - cur[0]
            cur = [s0, s1]
        else:
            cur[1] = max(cur[1], s1)
    if cur: tot += cur[1] - cur[0]
    return tot / max(b - a, 1e-6)

def table_cells(pg, bbox):
    x0, top, x1, bot = bbox
    ls = [l for l in pg.lines if l['x0'] >= x0 - 2 and l['x1'] <= x1 + 2 and l['top'] >= top - 2 and l['bottom'] <= bot + 2]
    rs = [r for r in pg.rects if r['x0'] >= x0 - 2 and r['x1'] <= x1 + 2 and r['top'] >= top - 2 and r['bottom'] <= bot + 2]
    segs = [(l['x0'], l['top'], l['x1'], l['bottom']) for l in ls] + [(r['x0'], r['top'], r['x1'], r['bottom']) for r in rs if r['height'] < 1.2 or r['width'] < 1.2]
    vert = collections.defaultdict(float)
    for a, t, b, btm in segs:
        if b - a < 0.3 and btm - t > 0:
            vert[round((a + b) / 2)] += btm - t
    H = bot - top
    xs = clusters([x for x, L in vert.items() if L > 0.25 * H], 3)
    xs = sorted(set([round(x0)] + [round(x) for x in xs] + [round(x1)]))
    xs = [x for i, x in enumerate(xs) if i == 0 or x - xs[i - 1] > 6]
    hseg = collections.defaultdict(list)
    for a, t, b, btm in segs:
        if btm - t < 0.3 and b - a > 0:
            hseg[round((t + btm) / 2 * 2) / 2].append((a - 0.9, b + 0.9))  # 점선 사이 틈 메우기
    ys_all = clusters(list(hseg.keys()), 1.0)
    # 각 y에 대해 가까운 세그먼트 모음
    merged = collections.defaultdict(list)
    for y, sg in hseg.items():
        k = min(ys_all, key=lambda v: abs(v - y))
        merged[k] += sg
    cols = []
    for ca, cb in zip(xs, xs[1:]):
        bounds = [y for y, sg in merged.items() if coverage(sg, ca + 1, cb - 1) > 0.55]
        bounds = sorted(set(bounds + [b for b in (top, bot) if all(abs(b - y) > 2 for y in bounds)]))  # 표 위·아래 테두리
        cols.append(dict(x0=ca, x1=cb, ys=bounds))
    return cols

def words_in(words, x0, x1, y0, y1):
    ws = [w for w in words if x0 - 1 <= (w['x0'] + w['x1']) / 2 <= x1 + 1 and y0 - 0.5 <= (w['top'] + w['bottom']) / 2 <= y1 + 0.5]
    lines = []
    for w in sorted(ws, key=lambda w: (w['top'], w['x0'])):
        if lines and abs(lines[-1][0]['top'] - w['top']) < 2.5:
            lines[-1].append(w)
        else:
            lines.append([w])
    return [' '.join(x['text'] for x in sorted(l, key=lambda w: w['x0'])) for l in lines]

def cell_at(col, y):
    ys = col['ys']
    a = max([v for v in ys if v <= y], default=None)
    b = min([v for v in ys if v > y], default=None)
    return a, b

def main(pdf, outp):
    doc = pdfplumber.open(pdf)
    out = []
    for pi, pg in enumerate(doc.pages):
        words = pg.extract_words(keep_blank_chars=False, use_text_flow=False, x_tolerance=1.5)
        foot = [w['text'] for w in words if re.fullmatch(r'\d{2}', w['text']) and w['top'] > pg.height - 70]
        doc_page = int(foot[0]) if foot else None
        for ti, t in enumerate(pg.find_tables()):
            cols = table_cells(pg, t.bbox)
            # 헤더로 열 역할 정하기
            hdr_y0, hdr_y1 = t.bbox[1], t.bbox[1] + 32
            roles = []
            for c in cols:
                h = ''.join(words_in(words, c['x0'], c['x1'], hdr_y0, hdr_y1)).replace(' ', '')
                roles.append(h)
            def find(*keys):
                for i, h in enumerate(roles):
                    if any(k in h for k in keys):
                        return i
                return None
            ci = dict(kind=find('구분'), region=find('지역'), name=find('학교명', '유치원명'), loc=find('소재지'), period=find('지정기간'),
                      grade=find('급지'), before=find('이전'), after=find('이후'), gubun2=find('지정구분'))
            if ci['period'] is None or ci['name'] is None:
                continue
            pc = cols[ci['period']]
            for a, b in zip(pc['ys'], pc['ys'][1:]):
                if a < hdr_y0 + 8:
                    continue
                txt = ' '.join(words_in(words, pc['x0'], pc['x1'], a, b)).strip()
                if not re.search(r'\d', txt):
                    continue
                mid = (a + b) / 2
                rec = dict(pdf_page=pi + 1, doc_page=doc_page, table=ti, y=round(mid, 1), period=txt, col_roles=roles)
                for k in ('kind', 'region', 'name', 'loc', 'grade', 'before', 'after', 'gubun2'):
                    if ci[k] is None:
                        continue
                    c = cols[ci[k]]
                    if k in ('grade', 'before', 'after'):
                        ya, yb = a, b   # 급지는 지정기간 행과 같은 높이
                    else:
                        ya, yb = cell_at(c, mid)
                        if ya is None or yb is None:
                            continue
                    rec[k] = ' '.join(words_in(words, c['x0'], c['x1'], ya + 0.3, yb - 0.3)).strip()
                    if k in ('name', 'region', 'kind'):
                        rec[k + '_cell'] = [round(ya, 1), round(yb, 1)]
                out.append(rec)
    json.dump(out, open(outp, 'w'), ensure_ascii=False, indent=0)
    print(len(out), 'rows')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
