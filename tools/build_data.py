"""별표1 추출 결과 + 참고자료(학교명·코드·좌표)를 결합해 연도별 학교 데이터셋을 만든다.
사용: python3 -I tools/build_data.py  (site/ 에서 실행)
출력: data/2027/schools.json, data/2027/schools.csv, data/2027/validation.json
"""
import json, csv, re, os, sys, datetime, collections
from shapely.geometry import shape, Point

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)
YEAR = 2027
TODAY = os.environ.get('CHECK_DATE', datetime.date.today().isoformat())
DOC = {
    'id': 'GGE-HR-ELEM-2027',
    'title': '2027학년도 경기도교육공무원인사관리세부기준(유치원, 초등)',
    'issuer': '경기도교육청',
    'revision': '68차 개정 2026. 10. 28.',
    'effective_from': '2027-03-01',
    'effective_to': None,
    'table': '[별표1] 2027년 초등학교 인사구역 현황표',
    'table_doc_pages': '33~36쪽 (PDF 34~37쪽)',
    'legend': '밑줄: 폐·휴교 / 음영: 2027학년도 신설예정교',
}
OFFICE = {  # PDF 표기 → 교육지원청 공식 명칭
    '수원': '수원교육지원청', '성남': '성남교육지원청', '의정부': '의정부교육지원청', '안양과천': '안양과천교육지원청',
    '부천': '부천교육지원청', '광명': '광명교육지원청', '동두천양주': '동두천양주교육지원청', '안산': '안산교육지원청',
    '평택': '평택교육지원청', '군포의왕': '군포의왕교육지원청', '고양': '고양교육지원청', '구리남양주': '구리남양주교육지원청',
    '여주': '여주교육지원청', '화성오산': '화성오산교육지원청', '파주': '파주교육지원청', '광주하남': '광주하남교육지원청',
    '연천': '연천교육지원청', '포천': '포천교육지원청', '가평': '가평교육지원청', '양평': '양평교육지원청', '이천': '이천교육지원청',
    '용인': '용인교육지원청', '안성': '안성교육지원청', '김포': '김포교육지원청', '시흥': '시흥교육지원청'}
COUNTY = {'연천', '가평', '양평'}

def city_full(c):
    return c + ('군' if c in COUNTY else '시')

def parse_count(s):
    m = re.match(r'\s*(\d+)?\s*(?:\((\d+)\))?\s*$', s or '')
    return int(m.group(1) or 0), int(m.group(2) or 0)

def main():
    ext = json.load(open(P('data/raw/byeolpyo1_extract.json')))
    rows, recs = ext['rows'], ext['records']
    # 행 메타 정규화
    for r in rows:
        o = re.match(r'^\d+\.\s*(.+?)\s*(\d+)(?:\((\d+)\))?$', r['office_raw'])
        r['office_key'] = o.group(1).replace(' ', '')
        r['office_total'] = (int(o.group(2)), int(o.group(3) or 0))
        c = re.match(r'^(\S+)\s*(\d+)(?:\((\d+)\))?$', r['city_raw'])
        r['city'] = c.group(1)
        r['city_total'] = (int(c.group(2)), int(c.group(3) or 0))
        z = r['zone_raw']
        r['zone'] = '병' if '병' in z else z
        sub = z.replace('병', '')
        r['zone_sub'] = sub if r['zone'] == '병' else None
        r['row_count'] = parse_count(r['count_raw'])
    # 참고자료 적재
    ref_names = {}
    for x in csv.DictReader(open(P('data/ref/edumoa_gyeonggi_schools_20261001.csv'))):
        if x['Level'] == '초등학교':
            ref_names.setdefault(x['Name'], []).append(x['City'])
    ref_codes = collections.defaultdict(list)
    for x in csv.DictReader(open(P('data/ref/myschoolmanager_gyeonggi_neis_codes_202411.csv'))):
        ref_codes[x['schoolName']].append(x['schoolCode'])
    ref_xy = collections.defaultdict(list)
    for x in csv.DictReader(open(P('data/ref/yeongcrew_school_coords_S09.csv'))):
        ref_xy[x['name']].append(x)
    # 전국초중등학교위치표준데이터(공공데이터포털, 한국교육시설안전원) — 학교ID·주소·좌표의 1차 공식 출처
    STD_FILE = 'data/ref/school_location_standard_gyeonggi_20261001.csv'
    std = collections.defaultdict(list)
    std_date = None
    if os.path.exists(P(STD_FILE)):
        for x in csv.DictReader(open(P(STD_FILE), encoding='utf-8-sig')):
            if x['학교급구분'] == '초등학교' or x['학교명'].endswith('국제학교'):
                std[x['학교명']].append(x)
                std_date = x['데이터기준일자']
    # NEIS 학교기본정보(공식, tools/fetch_neis.mjs로 수집) — 있으면 학교코드·주소·홈페이지를 공식값으로 사용
    neis = collections.defaultdict(list)
    np_ = P('data/ref/neis_schoolinfo.csv')
    if os.path.exists(np_):
        for x in csv.DictReader(open(np_, encoding='utf-8-sig')):
            neis[x['SCHUL_NM']].append(x)
    # 관리자 검증 좌표(우선 적용): data/sources/locations_verified.csv
    verified = {}
    vp = P('data/sources/locations_verified.csv')
    if os.path.exists(vp):
        for x in csv.DictReader(open(vp, encoding='utf-8-sig')):
            if x.get('lat') and x.get('lng'):
                verified[(x['city'], x['official_name'])] = x
    geo = {f['properties']['name']: shape(f['geometry']) for f in json.load(open(os.environ.get('FULL_GEO', P('data/geo/gyeonggi_sigungu_detail.geojson'))))['features']}

    # 시·군별 본교명(분교장 상위교 추정용)
    mains_by_city = collections.defaultdict(set)
    for e in recs:
        if e['kind'] == '본교':
            mains_by_city[rows[e['row']]['city']].add(e['name'])

    out = []
    for e in recs:
        r = rows[e['row']]
        city = r['city']
        provisional = bool(re.search(r'\d', e['name']))
        parent = e.get('parent')
        if e['kind'] == '분교장':
            short = e['name']
            if not parent:  # '(대남풍도분교장)'처럼 상위교가 괄호 안에 합쳐 표기된 경우
                cands = sorted([m for m in mains_by_city[city] if short.startswith(m) and len(short) > len(m) + 3], key=len, reverse=True)
                parent = cands[0] if cands else None
                short = short[len(parent):] if parent else short
            official = (parent + '초등학교' + short) if parent else None
            display = f"{parent}초등학교 {short}" if parent else short
        else:
            if e['name'].endswith('학교'):
                official = e['name']
            elif provisional:
                official = None
            else:
                official = e['name'] + '초등학교'
            display = official or f"{e['name']}(가칭)"
        status = '운영'
        notes = []
        if e['underline']:
            status = '폐·휴교'
            notes.append('PDF 밑줄 표기(범례: 폐·휴교)')
        if e['shaded']:
            status = '신설예정'
            notes.append('PDF 음영 표기(범례: 2027학년도 신설예정교)')
        if provisional:
            notes.append('PDF 표기명이 가칭(숫자 포함)으로 공식 교명 미확정')
        if e['red']:
            notes.append('PDF 적색 글자 표기(범례에 의미 설명 없음)')
        if official == '군서미래국제학교':
            notes.append('PDF 시흥 갑구역 별도 행에 기재')
        key = f"{city}|{official or e['name']}"
        rec = dict(
            key=key, year=YEAR, name_pdf=e['name'], name=official, display=display,
            kind=e['kind'] if official != '군서미래국제학교' else '본교', parent=(parent + '초등학교') if (e['kind'] == '분교장' and parent) else None,
            office=OFFICE[r['office_key']], office_short=r['office_key'], city=city_full(city), city_short=city,
            zone=r['zone'], zone_sub=r['zone_sub'], status=status, provisional_name=provisional, pdf_red=e['red'],
            notes=notes,
            source=dict(doc_id=DOC['id'], doc=DOC['title'], table=DOC['table'], doc_page=e['doc_page'], pdf_page=e['page'],
                        effective_from=DOC['effective_from'], effective_to=DOC['effective_to'], checked=TODAY),
        )
        # 학교명 매칭(제3자 사본 — 공식 확인 전)
        rec['name_match'] = {'neis_list_2026': bool(official and official in ref_names)}
        codes = ref_codes.get(official or '', [])
        rec['codes'] = {'neis': codes[0] if len(codes) == 1 else None,
                        'neis_status': ('제3자 사본 대조(2024-11)·공식 확인 필요' if len(codes) == 1 else ('동명 학교 복수' if codes else '미확인'))}
        official_info = [n for n in neis.get(official or '', []) if r['office_key'] in n.get('JU_ORG_NM', '').replace(' ', '')]
        rec['homepage'] = None
        addr = None
        if len(official_info) == 1:
            n = official_info[0]
            rec['codes'] = {'neis': n['SD_SCHUL_CODE'], 'neis_status': f"NEIS 학교기본정보 ({n.get('LOAD_DTM', '')[:8]})"}
            rec['name_match']['neis_official'] = True
            addr = (n['ORG_RDNMA'] + ' ' + n.get('ORG_RDNDA', '')).strip() or None
            hp = n.get('HMPG_ADRES', '').strip()
            if hp and hp.lower() not in ('http://', 'https://'):
                rec['homepage'] = hp if hp.startswith('http') else 'http://' + hp
        # 위치: ① 관리자 검증 좌표 ② 위치표준데이터 ③ 없으면 '위치 확인 필요'(임의 위치 표시 안 함)
        loc = dict(lat=None, lng=None, address=addr, status='위치 확인 필요', source=None, checked=TODAY)
        poly = geo.get(city)
        sm = [x for x in std.get(official or '', []) if r['office_key'] in x['교육지원청명']]
        rec['name_match']['location_standard'] = len(sm) == 1
        if len(sm) == 1:
            x = sm[0]
            rec['codes']['school_id'] = x['학교ID']
            rec['codes']['school_id_status'] = f'전국초중등학교위치표준데이터 학교ID ({x["데이터기준일자"]})'
        v = verified.get((rec['city'], official))
        if v:
            loc.update(lat=float(v['lat']), lng=float(v['lng']), address=v.get('address') or None,
                       status='검증 좌표', source=v.get('source'), checked=v.get('checked') or TODAY)
        elif len(sm) == 1 and status != '폐·휴교':
            x = sm[0]
            lat, lng = float(x['위도']), float(x['경도'])
            in_poly = poly is not None and poly.buffer(0.003).contains(Point(lng, lat))
            addr_ok = rec['city'] in x['소재지도로명주소'] or rec['city'] in x['소재지지번주소']
            kind_ok = (x['본교분교구분'] == '분교') == (rec['kind'] == '분교장')
            loc.update(address=x['소재지도로명주소'] or None, address_jibun=x['소재지지번주소'] or None,
                       source=f'전국초중등학교위치표준데이터(공공데이터포털, 제공 한국교육시설안전원, 기준일 {x["데이터기준일자"]})',
                       data_date=x['데이터기준일자'])
            if in_poly and addr_ok and kind_ok:
                loc.update(lat=lat, lng=lng, status='공식 좌표(위치표준데이터)')
            else:
                why = [w for w, ok in (('좌표가 시·군 경계 밖', in_poly), ('주소의 시·군 불일치', addr_ok), ('본교·분교 구분 불일치', kind_ok)) if not ok]
                loc['status'] = '위치 확인 필요(' + ', '.join(why) + ')'
            # 기존 참고 좌표와의 거리(점검용)
            old = [c for c in ref_xy.get(official, []) if poly is not None and poly.buffer(0.003).contains(Point(float(c['lng']), float(c['lat'])))]
            if len(old) == 1:
                import math
                dy = (float(old[0]['lat']) - lat) * 111000
                dx = (float(old[0]['lng']) - lng) * 111000 * math.cos(math.radians(lat))
                loc['diff_from_ref_m'] = round(math.hypot(dx, dy))
        elif len(sm) > 1:
            loc['status'] = '위치 확인 필요(위치표준데이터 후보 복수)'
        elif status == '운영':
            loc['status'] = '위치 확인 필요(위치표준데이터에 없음)'
        if status == '신설예정':
            loc['status'] = '위치 확인 필요(신설예정교)'
        rec['location'] = loc
        out.append(rec)

    # ---- 검증 ----
    val = dict(generated=TODAY, document=DOC, checks=[])
    def add(name, ok, detail):
        val['checks'].append(dict(name=name, ok=ok, detail=detail))
    # 1) 행별 학교수
    bad = []
    for i, r in enumerate(rows):
        rr = [x for x, e in zip(out, recs) if e['row'] == i]
        calc = (sum(1 for x in rr if x['kind'] == '본교' and x['status'] != '폐·휴교'),
                sum(1 for x in rr if x['kind'] == '분교장' and x['status'] != '폐·휴교'))
        if calc != r['row_count']:
            bad.append(dict(row=i, city=r['city'], zone=r['zone_raw'], pdf=r['row_count'], calc=calc))
    add('행(시·군×구역)별 학교수 = 운영 본교수(운영 분교장수)', not bad, bad or f'{len(rows)}개 행 모두 일치')
    # 2) 시·군 / 교육지원청 합계
    def agg(keyf):
        d = collections.defaultdict(lambda: [0, 0])
        for x in out:
            if x['status'] == '폐·휴교':
                continue
            d[keyf(x)][0 if x['kind'] == '본교' else 1] += 1
        return d
    cagg, oagg = agg(lambda x: x['city_short']), agg(lambda x: x['office_short'])
    cbad = [dict(city=r['city'], pdf=r['city_total'], calc=tuple(cagg[r['city']])) for r in {r['city']: r for r in rows}.values() if tuple(cagg[r['city']]) != r['city_total']]
    obad = [dict(office=r['office_key'], pdf=r['office_total'], calc=tuple(oagg[r['office_key']])) for r in {r['office_key']: r for r in rows}.values() if tuple(oagg[r['office_key']]) != r['office_total']]
    add('시·군 합계 일치', not cbad, cbad or f"{len(cagg)}개 시·군 모두 일치")
    add('교육지원청 합계 일치', not obad, obad or f"{len(oagg)}개 교육지원청 모두 일치")
    # 3) 중복
    dup = [k for k, v in collections.Counter(x['key'] for x in out).items() if v > 1]
    add('중복 학교(시·군+교명)', not dup, dup or '없음')
    dn = collections.defaultdict(set)
    for x in out:
        if x['name']:
            dn[x['name']].add(x['city'])
    same = {k: sorted(v) for k, v in dn.items() if len(v) > 1}
    add('도내 동명 학교(지역으로 구분)', True, same or '없음')
    # 4) 학교명 매칭
    nm = [x['display'] + ' / ' + x['city'] for x in out if x['status'] == '운영' and not x['name_match'].get('location_standard')]
    add(f'학교명 매칭 실패(운영교 ↔ 위치표준데이터 {std_date})', not nm, nm or '없음')
    closed_in_list = [x['display'] for x in out if x['status'] == '폐·휴교' and x['name_match'].get('location_standard')]
    add('폐·휴교 표기 학교 중 위치표준데이터(운영교만 수록)에 남아 있는 학교', not closed_in_list, closed_in_list or '없음')
    ours = {(x['office_short'], x['name']) for x in out if x['name']}
    extra = sorted(f"{n} ({xs[0]['교육지원청명']})" for n, xs in std.items() for x0 in xs[:1] if x0['설립형태'] == '공립'
                   and not any((o, n) in ours for o in OFFICE if o in x0['교육지원청명']))
    add('위치표준데이터의 경기 공립 초등학교 중 별표1에 없는 학교(누락 점검)', not extra, extra or '없음')
    far = sorted([f"{x['display']} / {x['city']}: {x['location']['diff_from_ref_m']}m" for x in out if x['location'].get('diff_from_ref_m', 0) >= 300],
                 key=lambda t: -int(t.rsplit(': ', 1)[1][:-1]))
    add('공식 좌표와 이전 참고 좌표 차이 300m 이상(이전 좌표가 틀렸던 학교)', True, far or '없음')
    # 5) 좌표
    noloc = [x['display'] + ' / ' + x['city'] + ' : ' + x['location']['status'] for x in out if x['status'] != '폐·휴교' and x['location']['lat'] is None]
    add('좌표 미확인(운영·신설예정)', not noloc, noloc)
    cnt = collections.Counter(x['location']['status'] for x in out)
    add('위치 상태 분포', True, dict(cnt))
    # 6) 별표4 신설교 현황(문서 38쪽, PDF 40쪽)과 대조 — 제9조: 신설교는 3년 이내 '을' 구역
    NEW = {2025: ['매교', '규장', '푸른샘', '고덕함박', '평택화양', '평택연화', '청연', '마루', '화성바른', '현민', '청미르', '처인', '도현', '모담'],
           2026: ['위례해솔', '회천새봄', '가재', '평안', '의왕푸른', '서봉', '새동', '다올', '숲노을', '물향기', '운정중앙', '이천중리', '용인솔빛'],
           2027: ['금토', '월암', '봉담2-1', '남동1', '공도1', '장현1']}
    byname = collections.defaultdict(list)
    for x in out:
        byname[x['name_pdf']].append(x)
    prob = []
    for y, names in NEW.items():
        for n in names:
            xs = byname.get(n, [])
            if len(xs) != 1:
                prob.append(f'{y} {n}: 별표1에서 {len(xs)}건'); continue
            x = xs[0]
            x['notes'].append(f'[별표4] {y}학년도 신설교 (문서 38쪽)')
            if x['zone'] != '을':
                prob.append(f'{y} {n}: 별표1 구역 {x["zone"]} (제9조 신설교 을 지정과 다름)')
            if (y == 2027) != (x['status'] == '신설예정'):
                prob.append(f'{y} {n}: 음영(신설예정) 표기 {x["status"]}')
    add('[별표4] 신설교 33곳 ↔ [별표1] 구역·음영 대조 (별표4 원문 "위래해솔"은 "위례해솔"로 대조)', not prob, prob or '모두 일치(을구역, 2027 신설교는 음영)')
    # 7) 승진 가산점
    add('승진 가산점 공식 근거 등록 학교 수', True, 0)
    # 기타 요약
    st = collections.Counter(x['status'] for x in out)
    zt = collections.Counter((x['zone'] + (x['zone_sub'] or '')) for x in out if x['status'] != '폐·휴교')
    val['summary'] = dict(records=len(out), status=dict(st), zones=dict(zt),
                          operating_main=sum(1 for x in out if x['kind'] == '본교' and x['status'] != '폐·휴교'),
                          operating_branch=sum(1 for x in out if x['kind'] == '분교장' and x['status'] != '폐·휴교'),
                          with_location=sum(1 for x in out if x['location']['lat'] is not None))
    os.makedirs(P(f'data/{YEAR}'), exist_ok=True)
    meta = dict(year=YEAR, document=DOC, generated=TODAY, record_count=len(out))
    json.dump(dict(meta=meta, schools=out), open(P(f'data/{YEAR}/schools.json'), 'w'), ensure_ascii=False, indent=0)
    json.dump(val, open(P(f'data/{YEAR}/validation.json'), 'w'), ensure_ascii=False, indent=1)
    cols = ['key', 'office', 'city', 'display', 'name', 'name_pdf', 'kind', 'parent', 'zone', 'zone_sub', 'status', 'provisional_name', 'pdf_red',
            'doc_page', 'pdf_page', 'effective_from', 'effective_to', 'checked', 'neis_code', 'lat', 'lng', 'location_status', 'notes']
    with open(P(f'data/{YEAR}/schools.csv'), 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f); w.writerow(cols)
        for x in out:
            w.writerow([x['key'], x['office'], x['city'], x['display'], x['name'] or '', x['name_pdf'], x['kind'], x['parent'] or '', x['zone'], x['zone_sub'] or '',
                        x['status'], x['provisional_name'], x['pdf_red'], x['source']['doc_page'], x['source']['pdf_page'], x['source']['effective_from'],
                        x['source']['effective_to'] or '', x['source']['checked'], x['codes']['neis'] or '', x['location']['lat'] or '', x['location']['lng'] or '',
                        x['location']['status'], ' / '.join(x['notes'])])
    print(json.dumps(val['summary'], ensure_ascii=False))
    for c in val['checks']:
        d = c['detail']
        print(('OK ' if c['ok'] else 'NG '), c['name'], '→', (d if not isinstance(d, list) or len(d) < 12 else f'{len(d)}건: ' + ', '.join(map(str, d[:12])) + ' …'))

if __name__ == '__main__':
    main()
