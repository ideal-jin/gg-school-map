# 경기도 초등 인사구역 · 승진 가산점 학교 지도

「2027학년도 경기도교육공무원인사관리세부기준(유치원, 초등)」(68차 개정 2026. 10. 28., 2027. 3. 1. 시행) [별표1] 초등학교 인사구역 현황표를 학교 단위로 구조화해 지도에 표시합니다.

- **인사구역**(갑·을·병, 병의 가·나·다·라)과 **승진 가산점**(도서·벽지·접적 / 농어촌·공단·접경)은 별개 항목으로 관리합니다.
- 승진 가산점은 사용자가 제공한 **승진평정 참고자료(문서 31~41쪽 발췌)** 의 지정 이력·지정현황에서 학교별 지정기간과 급지를 추출했습니다(`data/bonus/promotion_bonus.csv`, 1,427개 지정기간, 766개 학교·유형).
  - 오늘 날짜가 지정기간 안에 있으면 **현재 지정**, 기간이 끝났으면 **지정 종료**, 자료에 없으면 **확인 필요**입니다. 원문에 "학교가 누락되었을 수 있으며 인정 여부는 증빙서류에 따라 결정"된다고 적혀 있어 '비대상'은 쓰지 않습니다.
  - 2026-11-02 기준 운영교 중 도서·벽지(접적 포함) 현재 지정 31곳, 농어촌·공단·접경 현재 지정 411곳입니다.
  - 월평정점·일평정점·상한점은 같은 자료의 **선택가산점 평정점 표(문서 16~18쪽)** 로 붙였습니다. 도서·벽지·접적: 가 0.045 · 나 0.036 · 다 0.027 · 라 0.018. 농어촌·공단·접경: 면(읍면)·접경 0.018 · 읍(동)·교육감지정 접경(교육특별) 0.015 · 공단 0.012. 상한 2.00, 두 가산점 합산 상한 2.00입니다. 공단A/B는 같은 기간 읍면/동 점수(문서 36·18쪽)입니다.
  - 제공 자료의 학교 중 별표1에 없는 101개 교명(폐교된 분교장, 승격·개명 학교, 유치원·특수학교 표 제외)은 `data/bonus/unmatched.json`과 '자료 점검' 화면에 남겼습니다.
- 인사구역으로 승진 가산점을 추정하지 않습니다(예: 김포 석정초는 인사구역 병·나, 접적 급지 라). 개인별 누적 승진점수 계산은 넣지 않았습니다.

## 실행

```bash
cd site
node server/server.js hash '관리자비밀번호'          # 출력된 scrypt$... 값을 복사
ADMIN_PASSWORD_HASH='scrypt$...' PORT=8080 node server/server.js
# 지도: http://localhost:8080/   관리: http://localhost:8080/admin
```

- Node 18 이상이면 되고 외부 패키지는 필요 없습니다(Leaflet·MarkerCluster·SheetJS는 `vendor/`에 포함).
- 공개 화면만 쓰려면 `site/` 폴더를 정적 호스팅(GitHub Pages, Netlify 등)에 그대로 올려도 됩니다. 단, 이때는 관리 기능이 동작하지 않습니다.
- HTTPS 뒤에서 운영하면 `COOKIE_SECURE=1`을 함께 설정하세요.

## 지도 설정 (API 키)

`config.js`

| 설정 | 설명 |
|---|---|
| `baseMap: 'osm'` (기본) | OpenStreetMap 타일. 키가 필요 없습니다. 트래픽이 많으면 OSM 타일 사용 정책에 따라 다른 타일 서버로 바꾸세요. |
| `baseMap: 'vworld'`, `vworldKey` | 국토교통부 브이월드 배경지도. https://www.vworld.kr → 오픈API → 인증키 발급 시 **서비스 URL에 실제 사이트 도메인**(예: `https://map.example.kr`)을 등록해야 합니다. |

외부 지도 연결(카카오맵·네이버지도 검색 링크)은 키 없이 동작합니다. 배경 타일을 불러오지 못해도 시·군 경계와 학교 마커는 표시됩니다.

## 자료 구조

```
data/
  datasets.json                 연도별 기준 목록(적용 시작·종료일, 원문 PDF)
  2027/schools.json|csv         학교별 레코드(교육지원청, 시·군, 학교명, 구역, 세부구분, 상태, 근거 쪽수, 적용일, 확인일, 위치)
  2027/validation.json          자료 점검 결과(화면 '자료 점검'에서 확인)
  2027/versions/                관리 화면에서 갱신할 때 이전 파일 자동 보관
  bonus/promotion_bonus.csv|json 승진 가산점 지정기간(한 행 = 한 학교의 한 지정기간) — 이전본은 bonus/versions/
  bonus/unmatched.json          가산점 자료 중 별표1과 매칭되지 않은 교명
  history/changes.jsonl         학교별 변경 이력(추가만 하고 덮어쓰지 않음)
  sources/locations_verified.csv 검증 좌표 입력 양식
  ref/                          대조용 참고자료(아래 '출처와 한계')
  raw/byeolpyo1_extract.json    PDF에서 글자 단위로 뽑은 원자료
  docs/                         원문 PDF(상세 화면 '원문 보기' 링크)
tools/
  extract_pdf.py                PDF [별표1] 추출(밑줄=폐·휴교, 음영=신설예정, 적색 글자 자동 인식)
  extract_promo_pdf.py          승진평정 참고자료(점선 표) 셀 단위 추출
  build_bonus.py                지정기간·급지 정규화, 학교 매칭, 점검 결과 추가
  build_data.py                 학교 레코드 생성 + 검증
  fetch_neis.mjs                NEIS 학교기본정보(학교코드·주소·홈페이지) 수집
  geocode.mjs                   주소 → 좌표 후보(브이월드/카카오), 관리자 검토용
```

다시 만들기: `python3 -I tools/extract_pdf.py <PDF> data/raw/byeolpyo1_extract.json && python3 -I tools/build_data.py` (shapely 필요: `pip install shapely`)

## 승진 가산점 갱신

- 원문 PDF가 바뀌면: `python3 -I tools/extract_promo_pdf.py <PDF> data/raw/promo_extract.json && python3 -I tools/build_data.py && python3 -I tools/build_bonus.py`
- 직접 고치려면 `data/bonus/promotion_bonus.csv`를 내려받아 수정한 뒤 `/admin` → '승진 가산점' → 미리보기 → 적용. 한 행이 한 지정기간이며 `designation_doc`, `evidence_page`, `start_date`, `verified_date`가 필수입니다. 지정이 끝났으면 `end_date`를 넣고, 진행 중이면 비워 둡니다.
- 월평정점·상한점을 넣을 때는 근거 평정 규정(`rule_doc`)을 같이 적어야 합니다. 비워 두면 화면에 '확인 필요'로 표시됩니다.
- 평정점 표가 바뀌면 `tools/build_bonus.py`의 `ISLAND_PTS`, `RURAL_PTS`, `points_for()`를 고치고 다시 빌드하세요.
- 원 문서명·발행일이 확인되면 `tools/build_bonus.py`의 `SRC['designation_doc']`, `RULE['doc']`를 고치고 다시 빌드하세요.

## 연도별 갱신

- 새 연도 기준이 나오면 PDF를 `tools/extract_pdf.py`로 추출합니다. 표의 쪽 번호(`PAGES`, `DOC_PAGE`)는 연도마다 확인해야 합니다. 그다음 `build_data.py`의 `YEAR`·`DOC`를 바꿔 `data/<연도>/`를 만들고, `datasets.json`에 항목을 추가합니다.
- 또는 `/admin`에서 새 연도로 schools CSV를 올리면서 적용 시작일과 근거 문서명을 입력합니다. 직전 연도 기준의 종료일은 자동으로 기록되고, 이전 연도 파일은 그대로 보관됩니다.

## 위치·주소 자료

- **학교ID·도로명주소·지번주소·좌표**: 공공데이터포털 「전국초중등학교위치표준데이터」(제공 한국교육시설안전원, 데이터기준일 2026-10-01). 경기도분만 `data/ref/school_location_standard_gyeonggi_20261001.csv`에 보관합니다.
  - 학교명과 교육지원청으로 대조합니다. 도내 동명 학교 6쌍도 이 방법으로 구분됩니다.
  - 다음 세 조건을 모두 통과해야 '공식 좌표'로 지도에 표시합니다: 좌표가 PDF상 시·군 경계 안에 있음, 주소의 시·군이 일치함, 본교·분교 구분이 일치함.
  - 결과: 운영교 1,377곳 모두 통과(분교장 12곳 포함). 표준데이터의 경기 공립 초등학교 중 별표1에 빠진 학교는 없습니다.
  - 지도에 없는 곳: 신설예정 6곳, 다올초, 군서미래국제학교. 이 학교들은 표준데이터에 없어 '위치 확인 필요'로 남겨 두었습니다.
- 이전에 쓰던 제3자 참고 좌표는 표시에 쓰지 않고 점검용으로만 남겼습니다. 300m 이상 차이 난 학교는 여주초(1.5km)와 시화나래초(960m)입니다.
- 홈페이지 주소는 표준데이터에 없습니다. `NEIS_KEY=... node tools/fetch_neis.mjs`로 NEIS 학교기본정보를 받아 `build_data.py`를 다시 실행하면 채워집니다(`open.neis.go.kr` 접속 허용 필요).
- 새 표준데이터로 갱신하는 방법: 공공데이터포털에서 CSV(CP949)를 받아 경기도 행만 위 파일로 바꾸고 `python3 -I tools/build_data.py && python3 -I tools/build_bonus.py`를 실행합니다.
- 시·군 경계는 GitHub `southkorea/southkorea-maps`(통계청 2018 시군구 경계)를 사용합니다.

## PDF 표기 해석

- 밑줄 = 폐·휴교, 음영 = 2027학년도 신설예정교(표 상단 범례).
- 학교수 `23(1)` = 운영 본교 23 + 운영 분교장 1. 71개 행, 31개 시·군, 25개 교육지원청의 합계가 추출 결과와 모두 일치합니다.
- 적색 글자(예: 천보, 연푸른, 과천율목)는 범례에 설명이 없어 '적색 표기'로만 기록했습니다.
- 신설예정교 중 숫자가 붙은 이름(봉담2-1, 남동1, 공도1, 장현1)은 가칭이라 공식 학교명을 '확인 필요'로 두었습니다.
- 전보 가산(제16조③ 지역가산표: 을 50%, 병 가·나 100%, 병 다·라 70%, 5학급 이하·분교장 30%)은 승진 가산점과 따로 표시합니다. 5학급 이하 여부는 학급수 자료가 없어 '확인 필요'입니다.
