"""승진평정 참고자료(문서 32~41쪽) 추출 결과 → 학교별 승진 가산점 지정기간 레코드.
사용: python3 -I tools/build_bonus.py [연도=2027]   (build_data.py 실행 후)
출력: data/bonus/promotion_bonus.json|csv, data/bonus/unmatched.json, data/<연도>/validation.json 갱신
원칙: 자료에 실린 지정기간만 기록한다. 자료에 없는 학교는 '확인 필요'(비대상 아님).
      월평정점·상한점은 이 자료에 없으므로 비워 둔다(화면에 '확인 필요').
"""
import json, csv, re, os, sys, datetime, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)
YEAR = sys.argv[1] if len(sys.argv) > 1 else '2027'
TODAY = os.environ.get('CHECK_DATE', datetime.date.today().isoformat())
SRC = dict(
    designation_doc='승진평정 참고자료(사용자 제공 발췌본, 원 문서명·발행일 확인 필요)',
    file='data/docs/promotion_rating_excerpt_p31-41.pdf',
)
RULE = dict(doc='승진평정 참고자료(사용자 제공 발췌본) 나. 선택가산점 평정 — 원 문서명·발행일 확인 필요',
            file='data/docs/promotion_rating_scores_p15-21.pdf', first_doc_page=15)
ISLAND_PTS = {'가': ('0.045', '0.0015'), '나': ('0.036', '0.0012'), '다': ('0.027', '0.0009'), '라': ('0.018', '0.0006')}
RURAL_PTS = {  # 지역 → (월, 일, 근거 설명)
    '면': ('0.018', '0.0006', '면(읍면)'), '읍면': ('0.018', '0.0006', '면(읍면)'), '읍·면': ('0.018', '0.0006', '면(읍면)'),
    '읍': ('0.015', '0.0005', '읍(동)'), '동': ('0.015', '0.0005', '읍(동)'),
    '공단': ('0.012', '0.0004', '공단'),
    '공단A': ('0.018', '0.0006', '공단A → 같은 기간 농어촌 "읍면" 점수(문서 36쪽, 18쪽 마)①)'),
    '공단B': ('0.015', '0.0005', '공단B → 같은 기간 농어촌 "동" 점수(문서 36쪽, 18쪽 마)①)'),
}
def points_for(btype, category, grade):
    """(월평정점, 일평정점, 상한점, 합산상한점, 규정 쪽, 설명) — 근거표에 없으면 None"""
    if btype == '도서벽지':
        if grade in ISLAND_PTS:
            m, d = ISLAND_PTS[grade]
            return m, d, '2.00 (\'97.12.31 이전 경력 2.00)', '[2.00] 농·어촌·접경·공단 가산점과 합산', 16, f'도서·벽지 및 접적지역 {grade}급지'
        return None
    if category == '접경지역':
        return '0.018', '0.0006', '2.00', '[2.00] 도서벽지 가산점과 합산', 17, '접경'
    if '교육감지정' in category or '교육특별' in category:
        return '0.015', '0.0005', '2.00', '[2.00] 도서벽지 가산점과 합산', 17, '교육감지정 접경(교육특별) — 당해 연도 농어촌 읍지역 점수(문서 18쪽 5)'
    if grade in RURAL_PTS:
        m, d, why = RURAL_PTS[grade]
        return m, d, '2.00', '[2.00] 도서벽지 가산점과 합산', 17, why
    return None

COMMON_RULES = {
    '도서벽지': ['2009.12.31자 평정부터 1개월 미만은 일 단위 계산(문서 16쪽)',
              "'13.12.31자 평정부터 농·어촌·접경·공단 가산점과 합산 2.00점 초과 불가(문서 16쪽)",
              '2007.3.1 이후 도서벽지·접경·농어촌 경력은 각 해당 점수만 인정, 중복 인정 불가(문서 16쪽)',
              '도서벽지학교로 지정되어 있고 실 근무경력이 있어야 함(파견·휴직 제외)(문서 16쪽)'],
    '농어촌': ["'09.03.01부터 읍·면 소재 학교만 인정, 동(洞)지역 농어촌 가산점 폐지('09.02.28 이전 동지역 경력은 계속 인정)(문서 17쪽)",
             "'13.12.31자 평정부터 도서·벽지·접적 가산점과 합산 2.00점 초과 불가(문서 18쪽)",
             '2007.3.1 이후 도서벽지·접경·농어촌 경력은 각 해당 점수만 인정, 중복 인정 불가(문서 16쪽)'],
}

SECTION = {  # 문서 쪽 → 표 제목
    31: '도서·벽지·접적·수복 학교 지정현황', 32: '도서·벽지·접적·수복 학교 지정현황', 33: '도서·벽지·접적·수복 학교 지정현황', 34: '도서·벽지·접적·수복 학교 지정현황', 35: '도서·벽지·접적·수복 학교 지정현황',
    36: '농·어촌·공단지역 학교 지정현황', 37: '농·어촌·공단지역 학교 지정현황', 38: '농·어촌·공단지역 학교 지정현황', 39: '농·어촌·공단지역 학교 지정현황',
    40: '농·어촌·공단지역 학교 지정현황', 41: '접경지역 학교 지정현황'}

def ymd(s):
    """'67.04.01' → 1967-04-01, '14.3.1' → 2014-03-01, '2014.03.01' → 2014-03-01"""
    s = s.strip().strip('.')
    m = re.fullmatch(r'(\d{2}|\d{4})\.(\d{1,2})\.(\d{1,2})', s)
    if not m:
        return None
    y = int(m.group(1))
    if y < 100:
        y += 1900 if y >= 50 else 2000
    mo, d = int(m.group(2)), int(m.group(3))
    try:
        return datetime.date(y, mo, d).isoformat()
    except ValueError:
        return None

def parse_periods(raw):
    """지정기간 셀 → [(시작, 종료|None, 해석불가문자열|None, 메모|None)]. 한 셀에 기간이 여럿일 수 있다."""
    p = raw.replace(' ', '').replace('..', '.')
    p = re.sub(r'(\d)-$', r'\1~', p)                 # '21.03.01-' (열린 기간을 '-'로 적은 경우)
    note = None
    if '.031.' in p:                                   # 원문 오기 '73.031.01'
        note = f"원문 '{raw.strip()}'의 '.031.'을 '.03.'으로 해석"
        p = p.replace('.031.', '.03.')
    found = re.findall(r'(\d{2,4}\.\d{1,2}\.\d{1,2})\.?~((?:\d{2,4}\.\d{1,2}\.\d{1,2})?)\.?(?:현재)?', p)
    if not found:
        return [(None, None, raw, note)]
    out = []
    for a, b in found:
        sa, sb = ymd(a), (ymd(b) if b else None)
        out.append((sa, sb, None if sa and (sb or not b) else raw, note))
    return out

def split_names(cell, keep_space_join):
    notes = re.findall(r'\(([^)]*)\)', cell)
    cell = re.sub(r'\([^)]*\)', ',', cell)          # 괄호 주석은 이름 구분자로 처리
    out = []
    for piece in re.split(r'[,，.、]', cell):
        piece = piece.strip()
        if not piece:
            continue
        toks = piece.split()
        if len(toks) > 1 and any(len(t) == 1 for t in toks):   # '대 곡', '서탄내수분 교'처럼 글자가 벌어진 경우
            toks = [''.join(toks)]
        buf = []
        for t in toks:
            if buf and (t in ('분교', '분교장') or (keep_space_join and re.search(r'분교(장)?$', t))):
                buf[-1] = buf[-1] + t               # '양동 고송분교장', '금광조령 / 분교'
            else:
                buf.append(t)
        out += buf
    res = []
    for n in out:
        m = re.match(r'^(.+?)초(.+분교(장)?)$', n)  # '지평초일신분교' → '지평일신분교'
        res.append(m.group(1) + m.group(2) if m else n)
    return res, notes

def main():
    rows = json.load(open(P('data/raw/promo_extract.json')))
    # 병합 셀 누락 보정: 같은 표에서 바로 아래 행의 학교명·지역을 이어 받음
    for i, r in enumerate(rows):
        if not r.get('name'):
            for nx in rows[i + 1:i + 4]:
                if nx['pdf_page'] == r['pdf_page'] and nx['table'] == r['table'] and nx.get('name') and nx['y'] - r['y'] < 30:
                    r['name'], r['region'], r['fill_note'] = nx['name'], nx.get('region'), '병합 셀: 아래 행의 학교명으로 보정'
                    break
    data = json.load(open(P(f'data/{YEAR}/schools.json')))
    schools = data['schools']
    # 별칭 → 학교 (교육지원청별)
    alias = collections.defaultdict(dict)
    def add(office, name, s):
        alias[office].setdefault(name, set()).add(s['key'])
    for s in schools:
        o = s['office_short']
        if s['kind'] == '본교':
            add(o, s['name_pdf'], s)
            if s['name']:
                add(o, s['name'].replace('초등학교', ''), s)
        else:
            par = (s['parent'] or '').replace('초등학교', '')
            short = s['display'].split(' ')[-1] if ' ' in s['display'] else s['name_pdf']
            for v in {short, short.replace('분교장', '분교')}:
                add(o, par + v, s)
                add(o, v, s)
    REGION_TO_OFFICE = {r: r for r in alias}
    by_key = {s['key']: s for s in schools}

    recs, unmatched, skipped = [], [], []
    for r in rows:
        roles = ''.join(r['col_roles'])
        if '유치원명' in roles:
            skipped.append(f"{r['doc_page']}쪽 유치원·특수학교 표: {r.get('name')}"); continue
        dp = r['doc_page']
        section = SECTION.get(dp, '')
        region = (r.get('region') or '').replace(' ', '')
        if dp <= 35:
            btype = '도서벽지'
            if dp == 31 and not r.get('kind'):
                r['kind'] = '벽지'
            category = r.get('kind') or ('접적' if dp == 35 else '')
            grade = (r.get('grade') or '').replace(' ', '')
        elif dp <= 40:
            btype = '농어촌'
            b = (r.get('before') or '').replace(' ', '')
            a = (r.get('after') or '').replace(' ', '')
            grade = a or b
            category = '공단' if grade.startswith('공단') else '농어촌'
        else:
            btype = '농어촌'
            if r.get('gubun2'):
                category = r['gubun2'].replace(' ', '')
                section = '접경(교육특별) 지역 중 교육감이 지정하는 학교 근무경력 가산점'
                grade = '농어촌 읍과 동일점수' if '접경' in category else ''
            else:
                category = '접경지역'
                grade = ''
        names, ann = split_names(r.get('name') or '', keep_space_join=(dp <= 35))
        for nm in names:
            nm0 = nm.replace(' ', '')
            office = REGION_TO_OFFICE.get(region)
            keys = None
            if office:
                for v in (nm0, nm0 + '장', re.sub(r'초$', '', nm0), re.sub(r'(초등)?학교$', '', nm0)):
                    keys = alias[office].get(v)
                    if keys:
                        break
            if not keys and office:
                cands = {k for n, ks in alias[office].items() if n.endswith(nm0) and len(nm0) >= 4 for k in ks}
                keys = cands if len(cands) == 1 else None
            row = dict(region=region, name_in_doc=nm0, doc_page=dp, pdf_page=r['pdf_page'], period=r['period'], section=section)
            if not keys or len(keys) != 1:
                unmatched.append(dict(row, reason='별표1에서 학교를 찾지 못함' if not keys else '후보 복수'))
                continue
            key = next(iter(keys))
            conds = []
            if grade == '공단A' or (category == '공단' and 'A' in grade):
                conds.append('공단A: 동일기간 농·어촌 "읍면"에 해당하는 점수 부여(문서 36쪽)')
            if grade == '공단B':
                conds.append('공단B: 동일기간 농·어촌 "동"에 해당하는 점수 부여(문서 36쪽)')
            if '교육감지정' in category:
                conds.append('접경(교육특별) 지역 중 교육감 지정 학교 근무경력 가산점: 농어촌 "읍"과 동일점수 부여(문서 41쪽)')
            pts = points_for(btype, category, grade)
            if category == '접경지역':
                conds = conds + ['접경지역 가산점은 2014.2.28자 경력까지 부여(문서 18쪽 라)②)']
            for start, end, bad, pnote in parse_periods(r['period']):
                note = []
                if ann: note.append('자료 표기: ' + ', '.join(ann))
                if bad: note.append('기간 표기 해석 불가: ' + bad)
                if pnote: note.append(pnote)
                if r.get('fill_note'): note.append(r['fill_note'])
                if r.get('loc'): note.append('소재지: ' + r['loc'])
                recs.append(dict(
                    school_key=key, school_name=by_key[key]['display'], bonus_type=btype, category=category, grade=grade,
                    start_date=start or '', end_date=end or '', open_ended=bool(start and not end and not bad),
                    status='지정', monthly_points=(pts[0] if pts else ''), daily_points=(pts[1] if pts else ''),
                    cap_points=(pts[2] if pts else ''), combined_cap_points=(pts[3] if pts else ''),
                    points_basis=(pts[5] if pts else ''), conditions=' / '.join(conds),
                    rule_doc=(f"{RULE['doc']} {pts[4]}쪽" if pts else ''), rule_page=(pts[4] if pts else None),
                    rule_pdf_page=(pts[4] - RULE['first_doc_page'] + 1 if pts else None), designation_doc=f"{SRC['designation_doc']} · {section}", evidence_page=str(dp),
                    pdf_page=r['pdf_page'], verified_date=TODAY, note=' / '.join(note), name_in_doc=nm0, region_in_doc=region))
    # 중복 제거
    seen, uniq = set(), []
    for x in recs:
        k = (x['school_key'], x['bonus_type'], x['category'], x['grade'], x['start_date'], x['end_date'])
        if k not in seen:
            seen.add(k); uniq.append(x)
    recs = sorted(uniq, key=lambda x: (x['school_key'], x['bonus_type'], x['start_date']))
    os.makedirs(P('data/bonus'), exist_ok=True)
    meta = dict(updated=TODAY, source=SRC, rule=RULE, common_rules=COMMON_RULES,
                scope='지정 자료: 문서 32~41쪽 발췌. 평정점: 문서 15~21쪽 발췌(3) 도서·벽지 및 접적지역, 4) 농·어촌·공단·접경, 5) 교육감 지정 접경).',
                caution=['도서·벽지·접적·수복: 도서·벽지교육진흥법 시행규칙 및 발령대장, 교육장 발행 경력확인서가 인정 기준이며 본 자료의 학교명·지정기간·급지는 참고로만 활용(문서 31쪽 유의사항)',
                         '농·어촌·공단: 본 자료에는 학교가 누락되었을 수 있으며, 인정 여부는 증빙서류에 따라 결정됨(문서 36쪽 유의사항)'])
    json.dump(dict(meta, records=recs), open(P('data/bonus/promotion_bonus.json'), 'w'), ensure_ascii=False, indent=0)
    cols = ['school_key', 'school_name', 'bonus_type', 'category', 'grade', 'start_date', 'end_date', 'status', 'monthly_points', 'daily_points',
            'cap_points', 'combined_cap_points', 'conditions', 'rule_doc', 'designation_doc', 'evidence_page', 'verified_date', 'note']
    with open(P('data/bonus/promotion_bonus.csv'), 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction='ignore'); w.writeheader(); w.writerows(recs)
    json.dump(dict(unmatched=unmatched, skipped=skipped), open(P('data/bonus/unmatched.json'), 'w'), ensure_ascii=False, indent=1)

    # 현재(오늘) 지정 상태 요약
    def active(x, d):
        return x['start_date'] and x['start_date'] <= d and (x['open_ended'] or (x['end_date'] and x['end_date'] >= d))
    st = collections.Counter()
    per = collections.defaultdict(list)
    for x in recs:
        per[(x['school_key'], x['bonus_type'])].append(x)
    for (k, t), xs in per.items():
        st[(t, '현재 지정' if any(active(x, TODAY) for x in xs) else '지정 종료(이력만)')] += 1
    cur = {t: sum(1 for s in schools if s['status'] != '폐·휴교' and any(active(x, TODAY) for x in per.get((s['key'], t), []))) for t in ('도서벽지', '농어촌')}
    val = json.load(open(P(f'data/{YEAR}/validation.json')))
    val['checks'] = [c for c in val['checks'] if not c['name'].startswith('승진 가산점')]
    val['checks'].append(dict(name='승진 가산점 지정 자료 반영(문서 31~41쪽)', ok=True,
        detail=f"지정기간 레코드 {len(recs)}건 · 학교-유형 {len(per)}건 · 오늘({TODAY}) 기준 운영교 중 도서벽지 지정 {cur['도서벽지']}곳, 농어촌·공단·접경 지정 {cur['농어촌']}곳 · 상태 {dict((f'{a}:{b}', n) for (a, b), n in st.items())}"))
    val['checks'].append(dict(name='승진 가산점 자료의 학교 중 별표1과 매칭 실패(폐교·교명 변경·표기 차이 추정)', ok=not unmatched,
        detail=[f"{u['doc_page']}쪽 {u['region']} {u['name_in_doc']} ({u['period']}) — {u['reason']}" for u in unmatched]))
    nopts = sorted({f"{x['bonus_type']} {x['category']} {x['grade']}" for x in recs if not x['monthly_points']})
    val['checks'].append(dict(name='승진 가산점 평정점 연결(문서 16~18쪽 평정점 표)', ok=not nopts,
        detail=nopts or f"{len(recs)}개 지정기간 모두 월평정점·일평정점·상한점 연결"))
    json.dump(val, open(P(f'data/{YEAR}/validation.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'records {len(recs)}, school-type {len(per)}, unmatched {len(unmatched)}, skipped {len(skipped)}, current {cur}')

if __name__ == '__main__':
    main()
